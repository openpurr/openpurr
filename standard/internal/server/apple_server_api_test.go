package server_test

// StoreKit 1 receipts and restores through the App Store Server API, end to end against a fake
// API. Mirrors lite/test/apple-server-api.test.ts (the parts over HTTP) and the receipt cases of
// lite/test/apple-receipt.test.ts.

import (
	"context"
	"encoding/base64"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/apple"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/testdata"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

// withAppleAPI is the test config with App Store Server API access for the iOS app.
func withAppleAPI(secret string) any {
	raw := testdata.TestConfig()
	ios := prop(raw, "apps", "ios").(*jsobj.Object)
	api := jsobj.New("issuer_id", tu.APIIssuerID, "key_id", tu.APIKeyID)
	if secret != "" {
		api.Set("private_key_secret", secret)
	}
	ios.Set("app_store_server_api", api)
	return raw
}

// appleAPIEnv is a server whose iOS app has API access, talking to a fake API.
func appleAPIEnv(t *testing.T) (*tu.Env, *tu.FakeApple) {
	fake := tu.NewFakeApple(t)
	env := tu.Start(t, tu.Options{
		Config:    withAppleAPI(""),
		StoreBase: fake.Server.URL,
		Secrets:   map[string]string{"APPLE_IAP_KEY": tu.AppleFixtures().APIKeyPEM},
	})
	return env, fake
}

func ok(body any) tu.AppleRoute { return func(*http.Request) (int, any) { return 200, body } }

// appleHistory programs Apple's answers for a sandbox customer with an annual subscription (chain
// 3000000000), a lifetime purchase, an older renewal and a product the config doesn't list.
// Production doesn't know these purchases (404 by default), so the server falls back to sandbox.
func appleHistory(env *tu.Env, fake *tu.FakeApple, expires int64, status int, grace int64) {
	now := env.Clock.Now()
	sub := tu.SignJWS(tu.Transaction(now, tu.Fields{"transactionId": "3000000001", "originalTransactionId": "3000000000", "productId": "pro_annual", "expiresDate": expires}))
	lifetime := tu.SignJWS(tu.Transaction(now, tu.Fields{"transactionId": "3000000002", "productId": "lifetime", "type": "Non-Consumable", "expiresDate": nil}))
	oldRenewal := tu.SignJWS(tu.Transaction(now, tu.Fields{"transactionId": "2999999999", "originalTransactionId": "3000000000", "productId": "pro_annual", "expiresDate": expires - 365*tu.Day}))
	unknown := tu.SignJWS(tu.Transaction(now, tu.Fields{"transactionId": "3000000003", "productId": "discontinued_product"}))
	renewal := jsobj.New("originalTransactionId", "3000000000", "productId", "pro_annual", "autoRenewStatus", 1.0, "signedDate", float64(now))
	if grace != 0 {
		renewal.Set("gracePeriodExpiresDate", float64(grace))
	}
	statuses := ok(jsobj.New("data", []any{jsobj.New("subscriptionGroupIdentifier", "g", "lastTransactions", []any{jsobj.New(
		"originalTransactionId", "3000000000", "status", float64(status), "signedTransactionInfo", sub, "signedRenewalInfo", tu.SignJWS(renewal))})}))
	fake.Set(map[string]tu.AppleRoute{
		"sandbox GET /inApps/v2/history/3000000001":       ok(jsobj.New("signedTransactions", []any{sub, lifetime, oldRenewal, unknown}, "hasMore", false, "revision", "r")),
		"sandbox GET /inApps/v1/subscriptions/3000000001": statuses,
		"sandbox GET /inApps/v1/subscriptions/3000000005": statuses,
	})
}

var sk1Receipt = tu.BuildAppReceipt("", []tu.ReceiptInApp{{ProductID: "pro_annual", TransactionID: "3000000001"}}, false)

func TestAppStoreServerAPIOverHTTP(t *testing.T) {
	t.Run("calls Apple's hosts with a bearer token Apple accepts, reused across calls", func(t *testing.T) {
		env, fake := appleAPIEnv(t)
		appleHistory(env, fake, env.Clock.Now()+200*tu.Day, apple.StatusActive, 0)
		if res := receipt(env, "api-token", sk1Receipt); res.Status != 200 {
			t.Fatalf("%d %s", res.Status, res.Body)
		}
		reqs := fake.Requests()
		if len(reqs) != 3 {
			t.Fatalf("requests %+v", reqs)
		}
		token := strings.TrimPrefix(reqs[0].Authorization, "Bearer ")
		parts := strings.Split(token, ".")
		header, _ := base64.RawURLEncoding.DecodeString(parts[0])
		claims, _ := base64.RawURLEncoding.DecodeString(parts[1])
		if string(header) != `{"alg":"ES256","kid":"TESTKEY123","typ":"JWT"}` {
			t.Errorf("header %s", header)
		}
		c, _ := jsobj.Parse(claims)
		if prop(c, "iss") != tu.APIIssuerID || prop(c, "aud") != "appstoreconnect-v1" || prop(c, "bid") != tu.BundleID ||
			prop(c, "exp").(float64)-prop(c, "iat").(float64) > 3600 {
			t.Errorf("claims %s", claims)
		}
		for _, r := range reqs {
			if r.Authorization != reqs[0].Authorization {
				t.Error("the token should be reused")
			}
		}
		// Signed with the In-App Purchase key.
		if !verifyES256(t, token) {
			t.Error("token signature doesn't verify with the API key")
		}
	})

	t.Run("asks for history newest first, falls back to sandbox, asks statuses there", func(t *testing.T) {
		env, fake := appleAPIEnv(t)
		appleHistory(env, fake, env.Clock.Now()+200*tu.Day, apple.StatusActive, 0)
		if res := receipt(env, "api-fallback", sk1Receipt); res.Status != 200 {
			t.Fatalf("%d %s", res.Status, res.Body)
		}
		var got []string
		for _, r := range fake.Requests() {
			got = append(got, r.Environment+" "+r.Path+"?"+r.Query)
		}
		want := []string{
			"production /inApps/v2/history/3000000001?sort=DESCENDING",
			"sandbox /inApps/v2/history/3000000001?sort=DESCENDING",
			"sandbox /inApps/v1/subscriptions/3000000001?",
		}
		if !slices.Equal(got, want) {
			t.Errorf("requests %q", got)
		}
		var envs []string
		rows, _ := env.Pool.Query(context.Background(), "SELECT DISTINCT environment FROM store_transaction")
		for rows.Next() {
			var e string
			_ = rows.Scan(&e)
			envs = append(envs, e)
		}
		if !slices.Equal(envs, []string{"sandbox"}) {
			t.Errorf("environments %v", envs)
		}
	})

	t.Run("reports Apple's errors: rate limits and outages keep the purchase queued", func(t *testing.T) {
		env, fake := appleAPIEnv(t)
		for _, c := range []struct {
			status int
			want   int
		}{{429, 503}, {500, 503}, {401, 500}} {
			fake.Set(map[string]tu.AppleRoute{"production GET /inApps/v2/history/3000000001": func(*http.Request) (int, any) {
				return c.status, jsobj.New("errorCode", 4290000.0, "errorMessage", "Rate limit exceeded.")
			}})
			if res := receipt(env, "api-err", sk1Receipt); res.Status != c.want {
				t.Errorf("Apple %d: got %d %s", c.status, res.Status, res.Body)
			}
		}
	})
}

func verifyES256(t *testing.T, token string) bool {
	t.Helper()
	i := strings.LastIndexByte(token, '.')
	sig, err := base64.RawURLEncoding.DecodeString(token[i+1:])
	if err != nil || len(sig) != 64 {
		return false
	}
	return tu.VerifyES256(&tu.AppleFixtures().APIKey.PublicKey, token[:i], sig)
}

func TestStoreKit1Receipts(t *testing.T) {
	t.Run("resolves the receipt with Apple and grants what Apple reports", func(t *testing.T) {
		env, fake := appleAPIEnv(t)
		expires := env.Clock.Now() + 200*tu.Day
		appleHistory(env, fake, expires, apple.StatusActive, 0)
		res := receipt(env, "sk1-user", sk1Receipt)
		if res.Status != 200 {
			t.Fatalf("%d %s", res.Status, res.Body)
		}
		sub := prop(res.JSON(t), "subscriber")
		if prop(sub, "entitlements", "pro", "product_identifier") != "lifetime" || prop(sub, "entitlements", "pro", "expires_date") != nil ||
			prop(sub, "entitlements", "annual_perks", "product_identifier") != "pro_annual" ||
			prop(sub, "entitlements", "annual_perks", "expires_date") != iso(float64(expires)) ||
			prop(sub, "subscriptions", "pro_annual", "store_transaction_id") != "3000000001" ||
			prop(sub, "subscriptions", "discontinued_product") != nil {
			t.Errorf("%s", res.Body)
		}
		// Only what CustomerInfo needs is stored: the old renewal and the unknown product are not.
		rows, _ := env.Pool.Query(context.Background(), "SELECT transaction_id || ':' || source FROM store_transaction ORDER BY transaction_id")
		var got []string
		for rows.Next() {
			var s string
			_ = rows.Scan(&s)
			got = append(got, s)
		}
		if !slices.Equal(got, []string{"3000000001:store_api", "3000000002:store_api"}) {
			t.Errorf("stored %v", got)
		}
	})

	t.Run("records the subscription status Apple reports (here, a grace period)", func(t *testing.T) {
		env, fake := appleAPIEnv(t)
		now := env.Clock.Now()
		grace := now + 10*tu.Day
		appleHistory(env, fake, now-tu.Day, apple.StatusGracePeriod, grace)
		sub := prop(receipt(env, "sk1-grace", sk1Receipt).JSON(t), "subscriber", "subscriptions", "pro_annual")
		if prop(sub, "expires_date") != iso(float64(grace)) || prop(sub, "grace_period_expires_date") != iso(float64(grace)) ||
			prop(sub, "billing_issues_detected_at") == nil {
			t.Errorf("%s", jsobj.Stringify(sub))
		}
	})

	t.Run("returns an empty CustomerInfo for a receipt with no purchases, without calling Apple", func(t *testing.T) {
		env, fake := appleAPIEnv(t)
		for _, xcode := range []bool{false, true} {
			res := receipt(env, "sk1-empty", tu.BuildAppReceipt("", nil, xcode))
			if res.Status != 200 || len(keys(prop(res.JSON(t), "subscriber", "entitlements"))) != 0 {
				t.Errorf("%d %s", res.Status, res.Body)
			}
		}
		if len(fake.Requests()) != 0 {
			t.Error("Apple shouldn't be called")
		}
	})

	t.Run("keeps the purchase queued (5xx) when the key is missing", func(t *testing.T) {
		fake := tu.NewFakeApple(t)
		env := tu.Start(t, tu.Options{Config: withAppleAPI("MISSING_IAP_KEY"), StoreBase: fake.Server.URL, Secrets: map[string]string{}})
		res := receipt(env, "sk1-nokey", sk1Receipt)
		if res.Status != 503 || !strings.Contains(prop(res.JSON(t), "message").(string), "MISSING_IAP_KEY") {
			t.Errorf("%d %s", res.Status, res.Body)
		}
		if len(fake.Requests()) != 0 {
			t.Error("Apple shouldn't be called")
		}
	})

	t.Run("rejects a malformed receipt, or one Apple doesn't recognize, with a 4xx", func(t *testing.T) {
		env, _ := appleAPIEnv(t)
		if res := receipt(env, "sk1-bad", base64.StdEncoding.EncodeToString([]byte("garbage"))); res.Status != 400 {
			t.Errorf("%d %s", res.Status, res.Body)
		}
		res := receipt(env, "sk1-unknown", sk1Receipt)
		if res.Status != 400 || prop(res.JSON(t), "code") != 7103.0 {
			t.Errorf("%d %s", res.Status, res.Body)
		}
	})

	t.Run("reads transaction IDs from DER and Xcode receipts, and rejects malformed ones", func(t *testing.T) {
		env, fake := appleAPIEnv(t)
		inApp := []tu.ReceiptInApp{{ProductID: "pro_monthly", TransactionID: "2000000444", OriginalTransactionID: "2000000111"}}
		for _, xcode := range []bool{false, true} {
			receipt(env, "rcpt", tu.BuildAppReceipt("", inApp, xcode))
		}
		var asked []string
		for _, r := range fake.Requests() {
			if r.Environment == "production" {
				asked = append(asked, r.Path)
			}
		}
		if !slices.Equal(asked, []string{"/inApps/v2/history/2000000444", "/inApps/v2/history/2000000444"}) {
			t.Errorf("asked %v", asked)
		}
		good, _ := base64.StdEncoding.DecodeString(tu.BuildAppReceipt("", inApp, false))
		before := len(fake.Requests())
		nested := "\x04\x00"
		for range 40 {
			nested = "\x30\x80" + nested + "\x00\x00"
		}
		for _, bad := range []string{"not base64!!", base64.StdEncoding.EncodeToString([]byte("hello")),
			base64.StdEncoding.EncodeToString(good[:40]), base64.StdEncoding.EncodeToString(good[:len(good)-3]),
			base64.StdEncoding.EncodeToString([]byte(nested))} {
			res := receipt(env, "rcpt-bad", bad)
			if res.Status != 400 || prop(res.JSON(t), "code") != 7103.0 {
				t.Errorf("%q: %d %s", bad, res.Status, res.Body)
			}
		}
		if len(fake.Requests()) != before {
			t.Error("malformed receipts shouldn't reach Apple")
		}
	})
}

func TestRestores(t *testing.T) {
	t.Run("refresh subscription status from Apple when the app has API access", func(t *testing.T) {
		env, fake := appleAPIEnv(t)
		now := env.Clock.Now()
		grace := now + 5*tu.Day
		appleHistory(env, fake, now-tu.Day, apple.StatusGracePeriod, grace)
		jws := tu.SignJWS(tu.Transaction(now, tu.Fields{"transactionId": "3000000005", "originalTransactionId": "3000000000", "productId": "pro_annual", "expiresDate": now - tu.Day}))
		res := receipt(env, "restore-user", jws, "is_restore", true)
		if res.Status != 200 || prop(res.JSON(t), "subscriber", "entitlements", "pro", "grace_period_expires_date") != iso(float64(grace)) {
			t.Errorf("%d %s", res.Status, res.Body)
		}
	})

	t.Run("still succeed when Apple's API is down: the signed transaction stands on its own", func(t *testing.T) {
		env, fake := appleAPIEnv(t) // every API call answers 404
		jws := tu.SignJWS(tu.Transaction(env.Clock.Now(), tu.Fields{"productId": "pro_monthly"}))
		res := receipt(env, "restore-down", jws, "is_restore", true)
		if res.Status != 200 || prop(res.JSON(t), "subscriber", "entitlements", "pro", "product_identifier") != "pro_monthly" {
			t.Errorf("%d %s", res.Status, res.Body)
		}
		if len(fake.Requests()) == 0 {
			t.Error("Apple should have been asked")
		}
	})
}
