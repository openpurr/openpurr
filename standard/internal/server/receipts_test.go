package server_test

// POST /v1/receipts with App Store purchases, refunds, entitlement selection, unverified Google
// Play purchases, restores and transfers. Mirrors the purchase parts of lite/test/sdk.test.ts.

import (
	"context"
	"encoding/base64"
	"strings"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/customerinfo"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

func receipt(env *tu.Env, user string, fetchToken any, extra ...any) *tu.Response {
	body := jsobj.New("app_user_id", user, "fetch_token", fetchToken)
	for i := 0; i+1 < len(extra); i += 2 {
		body.Set(extra[i].(string), extra[i+1])
	}
	return env.Call("/v1/receipts", tu.CallOptions{Body: body})
}

func get(env *tu.Env, user string) any {
	return env.Call("/v1/subscribers/"+user, tu.CallOptions{}).JSON(env.T)
}

func iso(ms float64) string { return customerinfo.ISO(int64(ms)) }

func num(o *jsobj.Object, k string) float64 {
	v, _ := o.Get(k)
	f, _ := v.(float64)
	return f
}

func str(o *jsobj.Object, k string) string {
	v, _ := o.Get(k)
	s, _ := v.(string)
	return s
}

func TestReceiptValidation(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	res := env.Call("/v1/receipts", tu.CallOptions{Body: jsobj.New("app_user_id", "u1")})
	if res.Status != 400 || prop(res.JSON(t), "code") != 7226.0 {
		t.Fatalf("%d %s", res.Status, res.Body)
	}
	if env.Count("customer") != 0 {
		t.Fatal("nothing should be written")
	}
}

func TestAppStorePurchases(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	now := float64(env.Clock.Now())

	t.Run("verifies a StoreKit 2 transaction, records it and grants the entitlement", func(t *testing.T) {
		res, payload := env.PostAppleTransaction(tu.Anon, tu.Fields{"productId": "pro_monthly"})
		if res.Status != 200 {
			t.Fatalf("%d %s", res.Status, res.Body)
		}
		body := res.JSON(t)
		expectValidCustomerInfo(t, body)
		if got := prop(body, "subscriber", "entitlements", "pro", "expires_date"); got != iso(num(payload, "expiresDate")) {
			t.Errorf("expires_date %v", got)
		}
		sub := prop(body, "subscriber", "subscriptions", "pro_monthly")
		if prop(sub, "store") != "app_store" || prop(sub, "is_sandbox") != true || prop(sub, "period_type") != "normal" ||
			prop(sub, "store_transaction_id") != str(payload, "transactionId") ||
			prop(sub, "price", "amount") != 9.99 || prop(sub, "price", "currency") != "USD" {
			t.Errorf("subscription %s", jsobj.Stringify(sub))
		}
		if prop(body, "subscriber", "management_url") != "https://apps.apple.com/account/subscriptions" {
			t.Errorf("management_url %v", prop(body, "subscriber", "management_url"))
		}
		var verified int
		var source, environment string
		err := env.Pool.QueryRow(context.Background(), "SELECT verified, source, environment FROM store_transaction WHERE transaction_id = $1",
			str(payload, "transactionId")).Scan(&verified, &source, &environment)
		if err != nil || verified != 1 || source != "sdk" || environment != "sandbox" {
			t.Errorf("row %d %s %s %v", verified, source, environment, err)
		}
	})

	t.Run("is idempotent: posting the same transaction twice stores it once", func(t *testing.T) {
		tx := tu.Transaction(env.Clock.Now(), tu.Fields{"productId": "lifetime", "type": "Non-Consumable", "expiresDate": nil})
		jws := tu.SignJWS(tx)
		for range 2 {
			if res := receipt(env, "u-idem", jws); res.Status != 200 {
				t.Fatalf("%d %s", res.Status, res.Body)
			}
		}
		var n int
		_ = env.Pool.QueryRow(context.Background(), "SELECT count(*) FROM store_transaction WHERE transaction_id = $1", str(tx, "transactionId")).Scan(&n)
		if n != 1 {
			t.Fatalf("%d rows", n)
		}
	})

	t.Run("echoes a consumable's store_transaction_id so StoreKit can finish it", func(t *testing.T) {
		res, payload := env.PostAppleTransaction("u-coins", tu.Fields{"productId": "coins_100", "type": "Consumable", "expiresDate": nil})
		body := res.JSON(t)
		expectValidCustomerInfo(t, body)
		list, _ := prop(body, "subscriber", "non_subscriptions", "coins_100").([]any)
		if len(list) != 1 || prop(list[0], "store_transaction_id") != str(payload, "transactionId") {
			t.Errorf("non_subscriptions %s", res.Body)
		}
		if len(keys(prop(body, "subscriber", "entitlements"))) != 0 {
			t.Error("a consumable grants nothing")
		}
	})

	t.Run("maps free and paid offers to trial and intro", func(t *testing.T) {
		env.PostAppleTransaction("u-offers", tu.Fields{"productId": "pro_monthly", "offerType": 1, "offerDiscountType": "FREE_TRIAL"})
		res, _ := env.PostAppleTransaction("u-offers", tu.Fields{"productId": "pro_annual", "offerType": 3, "offerDiscountType": "PAY_UP_FRONT"})
		subs := prop(res.JSON(t), "subscriber", "subscriptions")
		if prop(subs, "pro_monthly", "period_type") != "trial" || prop(subs, "pro_annual", "period_type") != "intro" {
			t.Errorf("%s", jsobj.Stringify(subs))
		}
	})

	t.Run("rejects a signature that isn't base64url with a 4xx, so the SDK stops retrying", func(t *testing.T) {
		parts := splitJWS(tu.SignJWS(tu.Transaction(env.Clock.Now(), nil)))
		res := receipt(env, "u-garbage", parts[0]+"."+parts[1]+".%%%")
		if res.Status != 400 || prop(res.JSON(t), "code") != 7103.0 || prop(res.JSON(t), "message") != "Invalid transaction: malformed JWS signature" {
			t.Fatalf("%d %s", res.Status, res.Body)
		}
	})

	t.Run("rejects a forged transaction with a 4xx (nothing to retry)", func(t *testing.T) {
		jws := tu.SignJWS(tu.Transaction(env.Clock.Now(), nil))
		parts := splitJWS(jws)
		forged := parts[0] + "." + b64url(`{"productId":"lifetime"}`) + "." + parts[2]
		before := env.Count("store_transaction")
		res := receipt(env, "u-forge", forged)
		if res.Status != 400 || prop(res.JSON(t), "code") != 7103.0 {
			t.Fatalf("%d %s", res.Status, res.Body)
		}
		// Rejected before anything is written: no transaction, and no customer.
		if env.Count("store_transaction") != before || env.CustomerID("default", "u-forge") != "" {
			t.Error("a forged transaction wrote something")
		}
	})

	t.Run("rejects a transaction signed under an untrusted root", func(t *testing.T) {
		f := tu.AppleFixtures()
		jws := tu.SignJWSWith(tu.Transaction(env.Clock.Now(), nil), f.Stray.X5C, f.Stray.LeafKey)
		res := receipt(env, "u-stray", jws)
		if res.Status != 400 || prop(res.JSON(t), "code") != 7103.0 || prop(res.JSON(t), "message") != "Invalid transaction: root certificate is not trusted" {
			t.Fatalf("%d %s", res.Status, res.Body)
		}
	})

	t.Run("keeps the purchase queued (5xx) when the product or bundle doesn't match the config", func(t *testing.T) {
		res, _ := env.PostAppleTransaction("u-cfg", tu.Fields{"productId": "not_configured"})
		if res.Status != 500 || prop(res.JSON(t), "message") != "Product not_configured is not in the config." {
			t.Errorf("%d %s", res.Status, res.Body)
		}
		res, _ = env.PostAppleTransaction("u-cfg", tu.Fields{"bundleId": "com.someone.else"})
		if res.Status != 500 || prop(res.JSON(t), "code") != 7110.0 ||
			prop(res.JSON(t), "message") != "transaction is for bundle com.someone.else, but app ios is com.example.openpurr" {
			t.Errorf("%d %s", res.Status, res.Body)
		}
		res, _ = env.PostAppleTransaction("u-cfg", tu.Fields{"productId": "lifetime"})
		if res.Status != 500 || prop(res.JSON(t), "message") != `Apple says lifetime is "Auto-Renewable Subscription", but the config says non_consumable` {
			t.Errorf("%d %s", res.Status, res.Body)
		}
	})

	t.Run("keeps StoreKit 1 receipts queued (5xx) without App Store Server API access", func(t *testing.T) {
		res := receipt(env, "u-sk1", "MIIT-base64-receipt")
		if res.Status != 503 || prop(res.JSON(t), "message") != "StoreKit 1 receipt: App ios has no app_store_server_api in the config." {
			t.Fatalf("%d %s", res.Status, res.Body)
		}
	})

	t.Run("a non-string fetch_token is an internal error, as in Lite", func(t *testing.T) {
		if res := receipt(env, "u-num", 12.0); res.Status != 500 {
			t.Fatalf("%d %s", res.Status, res.Body)
		}
	})
	_ = now
}

func TestRefunds(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	now := env.Clock.Now()

	t.Run("ends a refunded subscription's access at the refund time", func(t *testing.T) {
		purchase := now - 5*tu.Day
		tx := tu.Transaction(now, tu.Fields{"productId": "pro_monthly", "purchaseDate": purchase})
		receipt(env, "u-refund", tu.SignJWS(tx))
		revoked := purchase + 2*tu.Day
		body := receipt(env, "u-refund", tu.SignJWS(tu.Copy(tx, tu.Fields{"revocationDate": revoked, "revocationReason": 0}))).JSON(t)
		want := customerinfo.ISO(revoked)
		sub := prop(body, "subscriber", "subscriptions", "pro_monthly")
		if prop(sub, "refunded_at") != want || prop(sub, "expires_date") != want ||
			prop(body, "subscriber", "entitlements", "pro", "expires_date") != want {
			t.Errorf("%s", jsobj.Stringify(body))
		}
		if prop(body, "subscriber", "management_url") != nil {
			t.Error("management_url should be null")
		}
		var reason string
		_ = env.Pool.QueryRow(context.Background(), "SELECT revocation_reason FROM store_transaction WHERE transaction_id = $1", str(tx, "transactionId")).Scan(&reason)
		if reason != "0" {
			t.Errorf("revocation_reason %q", reason)
		}
	})

	t.Run("drops a refunded one-time purchase entirely", func(t *testing.T) {
		_, payload := env.PostAppleTransaction("u-refund2", tu.Fields{"productId": "lifetime", "type": "Non-Consumable", "expiresDate": nil})
		body := receipt(env, "u-refund2", tu.SignJWS(tu.Copy(payload, tu.Fields{"revocationDate": now}))).JSON(t)
		if len(keys(prop(body, "subscriber", "non_subscriptions"))) != 0 || len(keys(prop(body, "subscriber", "entitlements"))) != 0 {
			t.Errorf("%s", jsobj.Stringify(body))
		}
	})
}

func TestEntitlementSelection(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	now := env.Clock.Now()

	t.Run("lifetime beats any subscription; the furthest expiry wins otherwise", func(t *testing.T) {
		env.PostAppleTransaction("u-pick", tu.Fields{"productId": "pro_monthly", "expiresDate": now + 10*tu.Day})
		res, _ := env.PostAppleTransaction("u-pick", tu.Fields{"productId": "pro_annual", "expiresDate": now + 300*tu.Day})
		body := res.JSON(t)
		if prop(body, "subscriber", "entitlements", "pro", "product_identifier") != "pro_annual" ||
			prop(body, "subscriber", "entitlements", "annual_perks", "product_identifier") != "pro_annual" {
			t.Errorf("%s", res.Body)
		}
		res, _ = env.PostAppleTransaction("u-pick", tu.Fields{"productId": "lifetime", "type": "Non-Consumable", "expiresDate": nil})
		pro := prop(res.JSON(t), "subscriber", "entitlements", "pro")
		if prop(pro, "product_identifier") != "lifetime" || prop(pro, "expires_date") != nil {
			t.Errorf("%s", jsobj.Stringify(pro))
		}
	})

	t.Run("keeps expired entitlements, with their past expiry", func(t *testing.T) {
		purchase := now - 60*tu.Day
		res, _ := env.PostAppleTransaction("u-expired", tu.Fields{"productId": "pro_monthly", "purchaseDate": purchase, "expiresDate": purchase + 30*tu.Day})
		body := res.JSON(t)
		if prop(body, "subscriber", "entitlements", "pro", "expires_date") != customerinfo.ISO(purchase+30*tu.Day) {
			t.Errorf("%s", res.Body)
		}
		if prop(body, "subscriber", "management_url") != nil {
			t.Error("management_url should be null")
		}
	})

	t.Run("expires when the clock passes the expiry", func(t *testing.T) {
		res, _ := env.PostAppleTransaction("u-clock", tu.Fields{"productId": "pro_monthly", "purchaseDate": now - tu.Day, "expiresDate": now + tu.Day})
		if prop(res.JSON(t), "subscriber", "management_url") == nil {
			t.Fatal("active subscription should have a management URL")
		}
		env.Clock.Add(2 * tu.Day)
		defer env.Clock.Store(now)
		if body := get(env, "u-clock"); prop(body, "subscriber", "management_url") != nil {
			t.Errorf("%s", jsobj.Stringify(body))
		}
	})
}

func TestGooglePlayUnverified(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	sub := env.Call("/v1/receipts", tu.CallOptions{Platform: "android", Body: jsobj.New(
		"app_user_id", "u-play",
		"fetch_token", "play-token-1",
		"product_ids", []any{"pro"},
		"platform_product_ids", []any{jsobj.New("product_id", "pro", "base_plan_id", "annual", "offer_id", nil)},
	)})
	body := sub.JSON(t)
	expectValidCustomerInfo(t, body)
	if prop(body, "subscriber", "subscriptions", "pro", "product_plan_identifier") != "annual" ||
		prop(body, "subscriber", "entitlements", "pro", "product_plan_identifier") != "annual" ||
		prop(body, "subscriber", "entitlements", "annual_perks") == nil {
		t.Errorf("%s", sub.Body)
	}
	if prop(body, "subscriber", "management_url") != "https://play.google.com/store/account/subscriptions?sku=pro&package=com.example.openpurr" {
		t.Errorf("management_url %v", prop(body, "subscriber", "management_url"))
	}
	if jsobj.Stringify(prop(body, "purchased_products")) != `{"pro":{"should_consume":false}}` {
		t.Errorf("purchased_products %s", jsobj.Stringify(prop(body, "purchased_products")))
	}
	coins := env.Call("/v1/receipts", tu.CallOptions{Platform: "android", Body: jsobj.New(
		"app_user_id", "u-play", "fetch_token", "play-token-2", "product_ids", []any{"coins_100"})})
	if jsobj.Stringify(prop(coins.JSON(t), "purchased_products")) != `{"coins_100":{"should_consume":true}}` {
		t.Errorf("%s", coins.Body)
	}
	unknown := env.Call("/v1/receipts", tu.CallOptions{Platform: "android", Body: jsobj.New(
		"app_user_id", "u-play", "fetch_token", "play-token-3", "product_ids", []any{"nope"})})
	if unknown.Status != 500 {
		t.Errorf("%d %s", unknown.Status, unknown.Body)
	}
}

func TestCustomersAndTransfers(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	now := env.Clock.Now()

	t.Run("logIn: 201 for a new user, 200 after; anonymous purchases come along", func(t *testing.T) {
		env.PostAppleTransaction(tu.Anon, tu.Fields{"productId": "lifetime", "type": "Non-Consumable", "expiresDate": nil})
		first := env.Call("/v1/subscribers/identify", tu.CallOptions{Body: jsobj.New("app_user_id", tu.Anon, "new_app_user_id", "user@example")})
		if first.Status != 201 {
			t.Fatalf("%d %s", first.Status, first.Body)
		}
		body := first.JSON(t)
		expectValidCustomerInfo(t, body)
		if prop(body, "subscriber", "entitlements", "pro", "product_identifier") != "lifetime" || prop(body, "subscriber", "original_app_user_id") != tu.Anon {
			t.Errorf("%s", first.Body)
		}
		again := env.Call("/v1/subscribers/identify", tu.CallOptions{Body: jsobj.New("app_user_id", tu.Anon, "new_app_user_id", "user@example")})
		if again.Status != 200 {
			t.Fatalf("%d", again.Status)
		}
		if prop(get(env, tu.Anon), "subscriber", "entitlements", "pro", "product_identifier") != "lifetime" {
			t.Error("both IDs should see the purchase")
		}
	})

	t.Run("logIn to an existing account merges the anonymous user's purchases into it", func(t *testing.T) {
		env.PostAppleTransaction("existing@example", tu.Fields{"productId": "pro_monthly"})
		anon := "$RCAnonymousID:ffffffffffffffffffffffffffffffff"
		env.PostAppleTransaction(anon, tu.Fields{"productId": "lifetime", "type": "Non-Consumable", "expiresDate": nil})
		res := env.Call("/v1/subscribers/identify", tu.CallOptions{Body: jsobj.New("app_user_id", anon, "new_app_user_id", "existing@example")})
		body := res.JSON(t)
		if res.Status != 200 || prop(body, "subscriber", "original_app_user_id") != "existing@example" ||
			strings.Join(keys(prop(body, "subscriber", "subscriptions")), ",") != "pro_monthly" ||
			strings.Join(keys(prop(body, "subscriber", "non_subscriptions")), ",") != "lifetime" {
			t.Errorf("%d %s", res.Status, res.Body)
		}
	})

	t.Run("restoring a named user's purchase transfers it (RevenueCat's default)", func(t *testing.T) {
		jws := tu.SignJWS(tu.Transaction(now, tu.Fields{"productId": "pro_annual", "expiresDate": now + 300*tu.Day}))
		receipt(env, "alice", jws)
		receipt(env, "bob", jws, "is_restore", true)
		if len(keys(prop(get(env, "alice"), "subscriber", "entitlements"))) != 0 {
			t.Error("alice should have lost the purchase")
		}
		if prop(get(env, "bob"), "subscriber", "entitlements", "pro", "product_identifier") != "pro_annual" {
			t.Error("bob should have the purchase")
		}
	})

	t.Run("restoring an anonymous user's purchase merges that anonymous user in", func(t *testing.T) {
		anon := "$RCAnonymousID:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
		jws := tu.SignJWS(tu.Transaction(now, tu.Fields{"productId": "pro_monthly"}))
		receipt(env, anon, jws)
		receipt(env, "carol", jws, "is_restore", true)
		body := get(env, anon)
		if prop(body, "subscriber", "original_app_user_id") != "carol" || prop(body, "subscriber", "entitlements", "pro") == nil {
			t.Errorf("%s", jsobj.Stringify(body))
		}
	})

	t.Run("attributes ride along with a receipt; invalid ones are skipped", func(t *testing.T) {
		jws := tu.SignJWS(tu.Transaction(now, tu.Fields{"productId": "pro_monthly"}))
		res := receipt(env, "dave", jws, "attributes", jsobj.New(
			"$email", jsobj.New("value", "d@example.com", "updated_at_ms", 1.0),
			"bad", "not an object"))
		if res.Status != 200 {
			t.Fatalf("%d %s", res.Status, res.Body)
		}
		var value string
		_ = env.Pool.QueryRow(context.Background(), `SELECT value FROM subscriber_attribute a JOIN customer c ON c.id = a.customer_id
			WHERE c.app_user_id = 'dave' AND a.key = '$email'`).Scan(&value)
		if value != "d@example.com" {
			t.Errorf("attribute %q", value)
		}
	})
}

func splitJWS(jws string) []string { return strings.Split(jws, ".") }

func b64url(s string) string { return base64.RawURLEncoding.EncodeToString([]byte(s)) }
