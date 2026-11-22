package server_test

// Google Play purchases posted to /v1/receipts, verified against a fake Play Developer API.
// Mirrors lite/test/google-play.test.ts.

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/openpurr/openpurr/standard/internal/jsobj"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

func isoSeconds(ms int64) string {
	return time.UnixMilli(ms).UTC().Format("2006-01-02T15:04:05Z")
}

func TestGooglePlaySubscriptions(t *testing.T) {
	t.Run("verifies with the Play Developer API, records the price paid and acknowledges", func(t *testing.T) {
		env, fake := tu.StartGoogle(t, false)
		now := env.Clock.Now()
		expiry := now + 30*tu.Day
		fake.SetSub("tok-sub-1", tu.PlaySubscription(now, tu.PlaySub{Expiry: expiry, OrderID: "GPA.0001-0001-0001-00001"}))
		fake.Route("GET /orders/GPA.0001-0001-0001-00001", func(*http.Request) (int, any) {
			return 200, jsobj.New("orderId", "GPA.0001-0001-0001-00001", "total", jsobj.New("currencyCode", "EUR", "units", "4", "nanos", 490000000.0))
		})
		res := env.PlayReceipt("gp-user", "tok-sub-1", "pro", "monthly")
		if res.Status != 200 {
			t.Fatalf("%d %s", res.Status, res.Body)
		}
		body := res.JSON(t)
		sub := prop(body, "subscriber", "subscriptions", "pro")
		if prop(sub, "store") != "play_store" || prop(sub, "is_sandbox") != true || prop(sub, "product_plan_identifier") != "monthly" ||
			prop(sub, "expires_date") != isoSeconds(expiry) || prop(sub, "store_transaction_id") != "GPA.0001-0001-0001-00001" ||
			jsobj.Stringify(prop(sub, "price")) != `{"amount":4.49,"currency":"EUR"}` || prop(sub, "period_type") != "normal" {
			t.Errorf("%s", jsobj.Stringify(sub))
		}
		if prop(body, "subscriber", "entitlements", "pro", "product_identifier") != "pro" || prop(body, "subscriber", "entitlements", "pro", "product_plan_identifier") != "monthly" {
			t.Errorf("%s", res.Body)
		}
		if got := jsobj.Stringify(prop(body, "purchased_products")); got != `{"pro":{"should_consume":false}}` {
			t.Errorf("purchased_products %s", got)
		}
		if fake.Requested("POST /purchases/subscriptions/pro/tokens/tok-sub-1:acknowledge") != 1 {
			t.Errorf("not acknowledged: %v", fake.Requests())
		}
	})

	t.Run("falls back to the plan's recurring price when the Orders API isn't allowed, and 0 for a free trial", func(t *testing.T) {
		env, fake := tu.StartGoogle(t, false)
		now := env.Clock.Now()
		fake.SetSub("tok-sub-2", tu.PlaySubscription(now, tu.PlaySub{Ack: true, OrderID: "GPA.0002-0002-0002-00002"}))
		fake.Route("GET /orders/GPA.0002-0002-0002-00002", func(*http.Request) (int, any) {
			return 403, jsobj.New("error", jsobj.New("message", "The caller does not have permission"))
		})
		fake.SetSub("tok-trial", tu.PlaySubscription(now, tu.PlaySub{Ack: true, Phase: "freeTrial", OrderID: "GPA.0003-0003-0003-00003"}))
		sub := prop(env.PlayReceipt("gp-price", "tok-sub-2", "pro", "monthly").JSON(t), "subscriber", "subscriptions", "pro")
		if got := jsobj.Stringify(prop(sub, "price")); got != `{"amount":4.99,"currency":"USD"}` {
			t.Errorf("price %s", got)
		}
		trial := prop(env.PlayReceipt("gp-trial", "tok-trial", "pro", "monthly").JSON(t), "subscriber", "subscriptions", "pro")
		if prop(trial, "period_type") != "trial" || jsobj.Stringify(prop(trial, "price")) != `{"amount":0,"currency":"USD"}` {
			t.Errorf("%s", jsobj.Stringify(trial))
		}
		// Already acknowledged: no acknowledge call.
		for _, r := range fake.Requests() {
			if r.Method == http.MethodPost {
				t.Errorf("unexpected %s %s", r.Method, r.Path)
			}
		}
	})

	t.Run("keeps a failed acknowledgement for the scheduled job to retry", func(t *testing.T) {
		env, fake := tu.StartGoogle(t, false)
		fake.SetSub("tok-ackfail", tu.PlaySubscription(env.Clock.Now(), tu.PlaySub{}))
		fake.Route("POST /purchases/subscriptions/pro/tokens/tok-ackfail:acknowledge", func(*http.Request) (int, any) { return 503, jsobj.New() })
		if res := env.PlayReceipt("gp-ack", "tok-ackfail", "pro", "monthly"); res.Status != 200 {
			t.Fatalf("%d %s", res.Status, res.Body)
		}
		var kind, product, lastError string
		var attempts int
		var created int64
		if err := env.Pool.QueryRow(context.Background(),
			"SELECT kind, product_id, attempts, last_error, created_at FROM play_ack_pending WHERE purchase_token = 'tok-ackfail'").
			Scan(&kind, &product, &attempts, &lastError, &created); err != nil {
			t.Fatal(err)
		}
		if kind != "subscription" || product != "pro" || attempts != 1 || created != env.Clock.Now() ||
			!strings.HasPrefix(lastError, "Error: Google Play Developer API 503") {
			t.Errorf("%s %s %d %q %d", kind, product, attempts, lastError, created)
		}
	})

	t.Run("an upgrade (a new token linked to the old one) replaces the old subscription", func(t *testing.T) {
		env, fake := tu.StartGoogle(t, false)
		now := env.Clock.Now()
		fake.SetSub("tok-monthly", tu.PlaySubscription(now, tu.PlaySub{Ack: true, BasePlanID: "monthly", OrderID: "GPA.0004-0004-0004-00004"}))
		fake.SetSub("tok-annual", tu.PlaySubscription(now, tu.PlaySub{Ack: true, BasePlanID: "annual", OrderID: "GPA.0005-0005-0005-00005",
			Expiry: now + 365*tu.Day, LinkedPurchaseToken: "tok-monthly"}))
		env.PlayReceipt("gp-upgrade", "tok-monthly", "pro", "monthly")
		version := ledgerVersion(t, env, "gp-upgrade")
		body := env.PlayReceipt("gp-upgrade", "tok-annual", "pro", "annual").JSON(t)
		if prop(body, "subscriber", "entitlements", "pro", "product_plan_identifier") != "annual" || prop(body, "subscriber", "entitlements", "annual_perks") == nil {
			t.Errorf("%s", jsobj.Stringify(body))
		}
		var upgraded int
		if err := env.Pool.QueryRow(context.Background(), "SELECT is_upgraded FROM store_transaction WHERE original_transaction_id = 'tok-monthly'").Scan(&upgraded); err != nil || upgraded != 1 {
			t.Errorf("is_upgraded %d %v", upgraded, err)
		}
		if ledgerVersion(t, env, "gp-upgrade") <= version {
			t.Error("the upgrade didn't bump the ledger version")
		}
	})

	t.Run("an upgrade invalidates the snapshot of whoever owns the replaced subscription", func(t *testing.T) {
		env, fake := tu.StartGoogle(t, false)
		now := env.Clock.Now()
		fake.SetSub("tok-a", tu.PlaySubscription(now, tu.PlaySub{Ack: true, OrderID: "GPA.0010-0000-0000-00001"}))
		fake.SetSub("tok-b", tu.PlaySubscription(now, tu.PlaySub{Ack: true, OrderID: "GPA.0010-0000-0000-00002", LinkedPurchaseToken: "tok-a"}))
		env.PlayReceipt("gp-first", "tok-a", "pro", "monthly")
		if prop(env.Call("/v1/subscribers/gp-first", tu.CallOptions{Platform: "android"}).JSON(t), "subscriber", "entitlements", "pro") == nil {
			t.Fatal("no entitlement")
		}
		env.PlayReceipt("gp-second", "tok-b", "pro", "monthly")
		if e := prop(env.Call("/v1/subscribers/gp-first", tu.CallOptions{Platform: "android"}).JSON(t), "subscriber", "entitlements", "pro"); e != nil {
			t.Errorf("the replaced subscription still grants access: %s", jsobj.Stringify(e))
		}
	})

	t.Run("answers 4xx for a token Google doesn't know, 5xx when Google is down or the purchase is pending", func(t *testing.T) {
		env, fake := tu.StartGoogle(t, false)
		fake.Route("GET /purchases/subscriptionsv2/tokens/tok-down", func(*http.Request) (int, any) { return 503, jsobj.New() })
		fake.SetSub("tok-pending", tu.PlaySubscription(env.Clock.Now(), tu.PlaySub{State: "SUBSCRIPTION_STATE_PENDING"}))
		fake.Route("GET /purchases/subscriptionsv2/tokens/tok-forbidden", func(*http.Request) (int, any) { return 401, jsobj.New() })
		unknown := env.PlayReceipt("gp-err", "tok-unknown", "pro", "monthly")
		if unknown.Status != 400 || prop(unknown.JSON(t), "code") != 7103.0 {
			t.Errorf("%d %s", unknown.Status, unknown.Body)
		}
		for token, status := range map[string]int{"tok-down": 503, "tok-pending": 503, "tok-forbidden": 500} {
			if res := env.PlayReceipt("gp-err", token, "pro", "monthly"); res.Status != status {
				t.Errorf("%s: %d %s", token, res.Status, res.Body)
			}
		}
	})

	t.Run("answers 5xx, keeping the purchase on the device, when the service account secret isn't set", func(t *testing.T) {
		fake := tu.NewFakeGoogle(t)
		env := tu.Start(t, tu.Options{Config: tu.GoogleConfig(false), StoreBase: fake.Server.URL, Secrets: map[string]string{}})
		res := env.PlayReceipt("gp-nokey", "tok-x", "pro", "monthly")
		if res.Status != 503 || !strings.Contains(prop(res.JSON(t), "message").(string), "GOOGLE_SERVICE_ACCOUNT") {
			t.Errorf("%d %s", res.Status, res.Body)
		}
	})

	t.Run("reuses the access token", func(t *testing.T) {
		env, fake := tu.StartGoogle(t, false)
		now := env.Clock.Now()
		fake.SetSub("tok-t1", tu.PlaySubscription(now, tu.PlaySub{Ack: true}))
		fake.SetSub("tok-t2", tu.PlaySubscription(now, tu.PlaySub{Ack: true}))
		env.PlayReceipt("gp-tokens", "tok-t1", "pro", "monthly")
		env.PlayReceipt("gp-tokens", "tok-t2", "pro", "monthly")
		if n := fake.TokenFetches.Load(); n != 1 {
			t.Errorf("%d token exchanges", n)
		}
	})
}

func TestGooglePlayOneTimeProducts(t *testing.T) {
	product := func(now int64, orderID string) *jsobj.Object {
		return jsobj.New("orderId", orderID, "purchaseTimeMillis", jsobj.FormatNumber(float64(now-1000)), "purchaseState", 0.0,
			"acknowledgementState", 0.0, "purchaseType", 0.0, "regionCode", "DE")
	}

	t.Run("acknowledges a non-consumable; leaves a consumable to the device, which consumes it", func(t *testing.T) {
		env, fake := tu.StartGoogle(t, false)
		now := env.Clock.Now()
		fake.SetProduct("tok-life", product(now, "GPA.0006-0006-0006-00006"))
		fake.SetProduct("tok-coins", product(now, "GPA.0007-0007-0007-00007"))
		life := env.PlayReceipt("gp-otp", "tok-life", "lifetime", "").JSON(t)
		if prop(life, "subscriber", "entitlements", "pro", "product_identifier") != "lifetime" || prop(life, "subscriber", "entitlements", "pro", "expires_date") != nil {
			t.Errorf("%s", jsobj.Stringify(life))
		}
		first := prop(life, "subscriber", "non_subscriptions", "lifetime").([]any)[0]
		if prop(first, "store") != "play_store" || prop(first, "is_sandbox") != true || prop(first, "store_transaction_id") != "GPA.0006-0006-0006-00006" {
			t.Errorf("%s", jsobj.Stringify(first))
		}
		if got := jsobj.Stringify(prop(life, "purchased_products")); got != `{"lifetime":{"should_consume":false}}` {
			t.Errorf("%s", got)
		}
		coins := env.PlayReceipt("gp-otp", "tok-coins", "coins_100", "").JSON(t)
		if got := jsobj.Stringify(prop(coins, "purchased_products")); got != `{"coins_100":{"should_consume":true}}` {
			t.Errorf("%s", got)
		}
		var posts []string
		for _, r := range fake.Requests() {
			if r.Method == http.MethodPost {
				posts = append(posts, r.Path)
			}
		}
		if strings.Join(posts, ",") != "/purchases/products/lifetime/tokens/tok-life:acknowledge" {
			t.Errorf("%v", posts)
		}
	})

	t.Run("doesn't grant a refunded (canceled) one-time purchase", func(t *testing.T) {
		env, fake := tu.StartGoogle(t, false)
		now := env.Clock.Now()
		fake.SetProduct("tok-refunded", jsobj.New("orderId", "GPA.0008-0008-0008-00008", "purchaseTimeMillis", jsobj.FormatNumber(float64(now-tu.Day)),
			"purchaseState", 1.0, "acknowledgementState", 1.0))
		body := env.PlayReceipt("gp-refunded", "tok-refunded", "lifetime", "").JSON(t)
		if got := jsobj.Stringify(prop(body, "subscriber", "entitlements")); got != "{}" {
			t.Errorf("%s", got)
		}
	})
}

// ledgerVersion is the ledger version of an app user's customer.
func ledgerVersion(t *testing.T, env *tu.Env, appUserID string) int64 {
	t.Helper()
	var v int64
	if err := env.Pool.QueryRow(context.Background(),
		"SELECT c.ledger_version FROM customer c JOIN customer_alias a ON a.customer_id = c.id WHERE a.app_user_id = $1", appUserID).Scan(&v); err != nil {
		t.Fatal(err)
	}
	return v
}
