package apple_test

// The App Store Server API client and its bearer tokens. Mirrors the client part of
// lite/test/apple-server-api.test.ts and the App Store part of lite/test/store-tokens.test.ts.

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/apple"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/outbound"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

const now = int64(1_800_000_000_000)

func creds() apple.Credentials {
	return apple.Credentials{IssuerID: tu.APIIssuerID, KeyID: tu.APIKeyID, BundleID: tu.BundleID, PrivateKeyPEM: tu.AppleFixtures().APIKeyPEM}
}

func clients(fake *tu.FakeApple) apple.Clients {
	httpClient := outbound.NewClient(fake.Server.URL)
	tokens := apple.NewTokens(func() int64 { return now })
	return apple.Clients{
		Production: apple.NewClient(creds(), "production", httpClient, tokens),
		Sandbox:    apple.NewClient(creds(), "sandbox", httpClient, tokens),
	}
}

func decodePart(t *testing.T, s string) any {
	t.Helper()
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	v, _ := jsobj.Parse(b)
	return v
}

func TestClient(t *testing.T) {
	ctx := context.Background()

	t.Run("calls Apple's hosts with a bearer token Apple accepts, reused across calls", func(t *testing.T) {
		fake := tu.NewFakeApple(t)
		fake.Set(map[string]tu.AppleRoute{"sandbox POST /inApps/v1/notifications/test": func(*http.Request) (int, any) {
			return 200, jsobj.New("testNotificationToken", "tok-1")
		}})
		c := clients(fake).Sandbox
		for range 2 {
			if tok, err := c.RequestTestNotification(ctx); err != nil || tok != "tok-1" {
				t.Fatalf("%q %v", tok, err)
			}
		}
		reqs := fake.Requests()
		if reqs[0].Environment != "sandbox" || reqs[0].Authorization != reqs[1].Authorization {
			t.Errorf("%+v", reqs)
		}
		token := strings.TrimPrefix(reqs[0].Authorization, "Bearer ")
		parts := strings.Split(token, ".")
		if jsobj.Stringify(decodePart(t, parts[0])) != `{"alg":"ES256","kid":"TESTKEY123","typ":"JWT"}` {
			t.Errorf("header %s", jsobj.Stringify(decodePart(t, parts[0])))
		}
		want := `{"iss":"` + tu.APIIssuerID + `","iat":1800000000,"exp":1800003000,"aud":"appstoreconnect-v1","bid":"com.example.openpurr"}`
		if got := jsobj.Stringify(decodePart(t, parts[1])); got != want {
			t.Errorf("claims %s", got)
		}
		sig, _ := base64.RawURLEncoding.DecodeString(parts[2])
		if len(sig) != 64 || !tu.VerifyES256(&tu.AppleFixtures().APIKey.PublicKey, parts[0]+"."+parts[1], sig) {
			t.Error("signature doesn't verify with the key")
		}
	})

	t.Run("mints a new token near expiry", func(t *testing.T) {
		at := now
		tokens := apple.NewTokens(func() int64 { return at })
		first, _ := tokens.Mint(creds())
		at += 44 * 60_000
		if again, _ := tokens.Mint(creds()); again != first {
			t.Error("reused until 5 minutes before expiry")
		}
		at += 2 * 60_000
		if later, _ := tokens.Mint(creds()); later == first {
			t.Error("a fresh token near expiry")
		}
	})

	t.Run("pages through transaction history newest first, up to the page limit", func(t *testing.T) {
		fake := tu.NewFakeApple(t)
		page := func(id string, more bool, rev string) any {
			return jsobj.New("signedTransactions", []any{tu.SignJWS(jsobj.New("transactionId", id))}, "hasMore", more, "revision", rev)
		}
		pages := map[string]any{"": page("tx1", true, "r1"), "r1": page("tx2", true, "r2"), "r2": page("tx3", false, "r3")}
		fake.Set(map[string]tu.AppleRoute{"production GET /inApps/v2/history/tx1": func(r *http.Request) (int, any) {
			return 200, pages[r.URL.Query().Get("revision")]
		}})
		c := clients(fake).Production
		all, complete, err := c.TransactionHistory(ctx, "tx1", 5)
		if err != nil || !complete || len(all) != 3 {
			t.Fatalf("%v %v %d", err, complete, len(all))
		}
		var ids []string
		for _, tx := range all {
			ids = append(ids, apple.Str(tx, "transactionId"))
		}
		if !slices.Equal(ids, []string{"tx1", "tx2", "tx3"}) {
			t.Errorf("%v", ids)
		}
		if q := fake.Requests()[1].Query; q != "sort=DESCENDING&revision=r1" {
			t.Errorf("query %q", q)
		}
		capped, complete, _ := c.TransactionHistory(ctx, "tx1", 2)
		if complete || len(capped) != 2 {
			t.Errorf("capped: %v %d", complete, len(capped))
		}
	})

	t.Run("falls back to sandbox when production doesn't know the transaction", func(t *testing.T) {
		fake := tu.NewFakeApple(t)
		fake.Set(map[string]tu.AppleRoute{"sandbox GET /inApps/v2/history/42": func(*http.Request) (int, any) {
			return 200, jsobj.New("signedTransactions", []any{}, "hasMore", false)
		}})
		_, env, err := apple.InEitherEnvironment(clients(fake), func(c *apple.Client) ([]any, error) {
			txs, _, err := c.TransactionHistory(ctx, "42", 3)
			return txs, err
		})
		if err != nil || env != "sandbox" {
			t.Fatalf("%v %q", err, env)
		}
	})

	t.Run("reports Apple's error codes, and which errors are worth retrying", func(t *testing.T) {
		fake := tu.NewFakeApple(t)
		fake.Set(map[string]tu.AppleRoute{
			"production GET /inApps/v1/subscriptions/1": func(*http.Request) (int, any) {
				return 429, jsobj.New("errorCode", 4290000.0, "errorMessage", "Rate limit exceeded.")
			},
			"production GET /inApps/v1/subscriptions/2": func(*http.Request) (int, any) { return 401, jsobj.New() },
		})
		c := clients(fake).Production
		_, err := c.SubscriptionStatuses(ctx, "1")
		var apiErr *apple.APIError
		if !errors.As(err, &apiErr) || apiErr.Status != 429 || apiErr.ErrorCode != 4290000 || !apiErr.Retryable() ||
			apiErr.Error() != "App Store Server API 429 4290000: Rate limit exceeded." {
			t.Errorf("%v", err)
		}
		_, err = c.SubscriptionStatuses(ctx, "2")
		if !errors.As(err, &apiErr) || apiErr.Status != 401 || apiErr.Retryable() || apiErr.NotFound() ||
			apiErr.Error() != "App Store Server API 401: GET /inApps/v1/subscriptions/2" {
			t.Errorf("%v", err)
		}
		_, err = c.SubscriptionStatuses(ctx, "3")
		if !errors.As(err, &apiErr) || !apiErr.NotFound() {
			t.Errorf("%v", err)
		}
	})

	t.Run("escapes IDs like encodeURIComponent", func(t *testing.T) {
		fake := tu.NewFakeApple(t)
		_, _ = clients(fake).Production.SubscriptionStatuses(ctx, "a b/c$")
		if p := fake.Requests()[0].EscapedPath; p != "/inApps/v1/subscriptions/a%20b%2Fc%24" {
			t.Errorf("path %q", p)
		}
	})

	t.Run("reads subscription statuses, skipping incomplete entries", func(t *testing.T) {
		fake := tu.NewFakeApple(t)
		tx := tu.SignJWS(jsobj.New("transactionId", "5", "originalTransactionId", "4"))
		renewal := tu.SignJWS(jsobj.New("originalTransactionId", "4", "signedDate", 1.0))
		fake.Set(map[string]tu.AppleRoute{"production GET /inApps/v1/subscriptions/5": func(*http.Request) (int, any) {
			return 200, jsobj.New("data", []any{jsobj.New("lastTransactions", []any{
				jsobj.New("originalTransactionId", "4", "status", 1.0, "signedTransactionInfo", tx, "signedRenewalInfo", renewal),
				jsobj.New("originalTransactionId", "9", "status", 1.0, "signedTransactionInfo", tx),
			})})
		}})
		got, err := clients(fake).Production.SubscriptionStatuses(ctx, "5")
		if err != nil || len(got) != 1 || got[0].OriginalTransactionID != "4" || got[0].Status != 1 || apple.Str(got[0].Transaction, "transactionId") != "5" {
			t.Errorf("%+v %v", got, err)
		}
	})
}

func TestClientsFor(t *testing.T) {
	secret := func(m map[string]string) func(string) (string, bool) {
		return func(k string) (string, bool) { v, ok := m[k]; return v, ok }
	}
	app := tu.TestApp(t, true)
	if _, err := apple.ClientsFor(app, secret(map[string]string{}), http.DefaultClient, apple.NewTokens(func() int64 { return now })); err == nil ||
		err.Error() != "The secret APPLE_IAP_KEY (App Store In-App Purchase key) isn't set." {
		t.Errorf("%v", err)
	}
	if _, err := apple.ClientsFor(app, secret(map[string]string{"APPLE_IAP_KEY": "nope"}), http.DefaultClient, nil); err == nil {
		t.Error("a value that isn't a key is refused")
	}
	if _, err := apple.ClientsFor(app, secret(map[string]string{"APPLE_IAP_KEY": tu.AppleFixtures().APIKeyPEM}), http.DefaultClient, nil); err != nil {
		t.Error(err)
	}
	noAPI := tu.TestApp(t, false)
	if _, err := apple.ClientsFor(noAPI, secret(nil), http.DefaultClient, nil); err == nil || err.Error() != "App ios has no app_store_server_api in the config." {
		t.Errorf("%v", err)
	}
}
