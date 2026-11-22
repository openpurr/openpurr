package server_test

// Which webhook events App Store receipts and notifications record, and their bodies. Mirrors the
// App Store parts of lite/test/webhooks.test.ts, checked on webhook_event and webhook_delivery
// (delivery itself arrives with the job loop).

import (
	"context"
	"regexp"
	"slices"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/apple"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/testdata"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

func withWebhook(extra ...any) any {
	raw := testdata.TestConfig()
	hook := jsobj.New("id", "backend", "url", "http://localhost:9/hooks/backend", "authorization_secret", "WEBHOOK_AUTH", "signing_secret", "WEBHOOK_SECRET")
	for i := 0; i+1 < len(extra); i += 2 {
		hook.Set(extra[i].(string), extra[i+1])
	}
	raw.(*jsobj.Object).Set("webhooks", []any{hook})
	return raw
}

// events are the recorded event bodies, in the order they were written (a fresh table's physical
// order).
func events(t *testing.T, env *tu.Env) []any {
	t.Helper()
	rows, err := env.Pool.Query(context.Background(), "SELECT body FROM webhook_event WHERE created_at > 0 ORDER BY created_at, ctid")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []any
	for rows.Next() {
		var body string
		if err := rows.Scan(&body); err != nil {
			t.Fatal(err)
		}
		v, _ := jsobj.Parse([]byte(body))
		out = append(out, prop(v, "event"))
	}
	return out
}

func eventTypes(t *testing.T, env *tu.Env) []string {
	var out []string
	for _, e := range events(t, env) {
		out = append(out, prop(e, "type").(string))
	}
	return out
}

func TestWebhookEventsFromReceipts(t *testing.T) {
	t.Run("a RevenueCat-shaped INITIAL_PURCHASE with a pending delivery", func(t *testing.T) {
		env := tu.Start(t, tu.Options{Config: withWebhook()})
		now := env.Clock.Now()
		tx := tu.Transaction(now, tu.Fields{"productId": "pro_annual", "expiresDate": now + 365*tu.Day})
		receipt(env, "wh-buyer", tu.SignJWS(tx), "attributes", jsobj.New("$email", jsobj.New("value", "b@example.com", "updated_at_ms", 1.0)))
		list := events(t, env)
		if len(list) != 1 {
			t.Fatalf("%d events", len(list))
		}
		e := list[0].(*jsobj.Object)
		want := `{"type":"INITIAL_PURCHASE","event_timestamp_ms":` + itoa(now) + `,"app_id":"ios","app_user_id":"wh-buyer",` +
			`"original_app_user_id":"wh-buyer","aliases":["wh-buyer"],"environment":"SANDBOX","store":"APP_STORE","product_id":"pro_annual",` +
			`"period_type":"NORMAL","purchased_at_ms":` + itoa(int64(num(tx, "purchaseDate"))) + `,"expiration_at_ms":` + itoa(int64(num(tx, "expiresDate"))) +
			`,"entitlement_id":null,"entitlement_ids":["pro","annual_perks"],"presented_offering_id":null,"transaction_id":"` + str(tx, "transactionId") +
			`","original_transaction_id":"` + str(tx, "originalTransactionId") + `","is_family_share":false,"country_code":"US","currency":"USD",` +
			`"price":9.99,"price_in_purchased_currency":9.99,"tax_percentage":null,"commission_percentage":null,"takehome_percentage":null,` +
			`"offer_code":null,"subscriber_attributes":{"$email":{"value":"b@example.com","updated_at_ms":1}}}`
		id := str(e, "id")
		e.Delete("id")
		if got := jsobj.Stringify(e); got != want {
			t.Errorf("event\n got %s\nwant %s", got, want)
		}
		if !regexp.MustCompile(`^[0-9a-f-]{36}$`).MatchString(id) {
			t.Errorf("id %q", id)
		}
		var endpoint, status string
		var attempts int
		var next int64
		err := env.Pool.QueryRow(context.Background(), "SELECT endpoint, status, attempts, next_attempt_at FROM webhook_delivery WHERE event_id = $1", id).
			Scan(&endpoint, &status, &attempts, &next)
		if err != nil || endpoint != "backend" || status != "pending" || attempts != 0 || next != now+5*60_000 {
			t.Errorf("delivery %s %s %d %d %v", endpoint, status, attempts, next, err)
		}
	})

	t.Run("nothing when no webhook is configured", func(t *testing.T) {
		env := tu.Start(t, tu.Options{})
		env.PostAppleTransaction("wh-none", nil)
		if env.Count("webhook_event") != 0 {
			t.Fatal("no events without webhooks")
		}
	})

	t.Run("filters by environment and event type", func(t *testing.T) {
		env := tu.Start(t, tu.Options{Config: withWebhook("environments", []any{"production"})})
		env.PostAppleTransaction("wh-filter", nil) // a sandbox purchase
		env2 := tu.Start(t, tu.Options{Config: withWebhook("events", []any{"RENEWAL"})})
		env2.PostAppleTransaction("wh-filter-2", nil) // INITIAL_PURCHASE
		if env.Count("webhook_event") != 0 || env2.Count("webhook_event") != 0 {
			t.Fatal("filtered events were recorded")
		}
	})

	t.Run("one event per fact: receipt then notification", func(t *testing.T) {
		env := tu.Start(t, tu.Options{Config: withWebhook()})
		tx := tu.Transaction(env.Clock.Now(), nil)
		receipt(env, "wh-dedupe", tu.SignJWS(tx))
		notify(env, tu.NotificationSpec{Type: "SUBSCRIBED", Subtype: "INITIAL_BUY", Transaction: tx, Status: tu.Status(1)})
		if got := eventTypes(t, env); !slices.Equal(got, []string{"INITIAL_PURCHASE"}) {
			t.Errorf("%v", got)
		}
		if env.Count("webhook_delivery") != 1 {
			t.Errorf("%d deliveries", env.Count("webhook_delivery"))
		}
	})

	t.Run("a notification before the receipt waits for an owner", func(t *testing.T) {
		env := tu.Start(t, tu.Options{Config: withWebhook()})
		tx := tu.Transaction(env.Clock.Now(), nil)
		notify(env, tu.NotificationSpec{Type: "SUBSCRIBED", Subtype: "INITIAL_BUY", Transaction: tx, Status: tu.Status(1)})
		if env.Count("webhook_event") != 0 {
			t.Fatal("nobody owns it yet")
		}
		receipt(env, "wh-late-owner", tu.SignJWS(tx))
		list := events(t, env)
		if len(list) != 1 || prop(list[0], "type") != "INITIAL_PURCHASE" || prop(list[0], "app_user_id") != "wh-late-owner" {
			t.Errorf("%v", list)
		}
	})

	t.Run("restoring an old purchase doesn't announce it as new", func(t *testing.T) {
		env := tu.Start(t, tu.Options{Config: withWebhook()})
		now := env.Clock.Now()
		receipt(env, "wh-old", tu.SignJWS(tu.Transaction(now, tu.Fields{"purchaseDate": now - 4*tu.Day, "expiresDate": now + 20*tu.Day})), "is_restore", true)
		if env.Count("webhook_event") != 0 {
			t.Fatal("old purchases aren't announced")
		}
	})

	t.Run("TRANSFER when a named user's purchase is restored by someone else", func(t *testing.T) {
		env := tu.Start(t, tu.Options{Config: withWebhook()})
		now := env.Clock.Now()
		jws := tu.SignJWS(tu.Transaction(now, tu.Fields{"productId": "pro_annual", "expiresDate": now + 300*tu.Day}))
		receipt(env, "wh-alice", jws)
		receipt(env, "wh-bob", jws, "is_restore", true)
		list := events(t, env)[1:] // after alice's INITIAL_PURCHASE
		if len(list) != 1 || prop(list[0], "type") != "TRANSFER" || prop(list[0], "app_user_id") != "wh-bob" ||
			jsobj.Stringify(prop(list[0], "transferred_from")) != `["wh-alice"]` || jsobj.Stringify(prop(list[0], "transferred_to")) != `["wh-bob"]` {
			t.Errorf("%s", jsobj.Stringify(list))
		}
		if prop(list[0], "product_id") != nil {
			t.Error("TRANSFER has no transaction fields")
		}
	})
}

func TestWebhookEventsFromNotifications(t *testing.T) {
	start := func(t *testing.T) *tu.Env { return tu.Start(t, tu.Options{Config: withWebhook()}) }
	// subscribedUser posts a purchase. Its INITIAL_PURCHASE is then set aside, keeping its dedupe
	// key, as Lite's tests clear only the receiver.
	subscribedUser := func(env *tu.Env, user string, f tu.Fields) *jsobj.Object {
		tx := subscribed(env, user, f)
		env.Exec("UPDATE webhook_event SET created_at = 0")
		return tx
	}

	t.Run("DID_RENEW: RENEWAL, flagged as a trial conversion after a trial", func(t *testing.T) {
		env := start(t)
		now := env.Clock.Now()
		trial := subscribedUser(env, "wh-renew", tu.Fields{"offerType": 1, "offerDiscountType": "FREE_TRIAL", "expiresDate": now + tu.Day})
		renewal := tu.Transaction(now, tu.Fields{"originalTransactionId": str(trial, "originalTransactionId"), "purchaseDate": now, "expiresDate": now + 30*tu.Day})
		notify(env, tu.NotificationSpec{Type: "DID_RENEW", Transaction: renewal, Status: tu.Status(1)})
		list := events(t, env)
		if len(list) != 1 || prop(list[0], "type") != "RENEWAL" || prop(list[0], "is_trial_conversion") != true ||
			prop(list[0], "transaction_id") != str(renewal, "transactionId") || prop(list[0], "app_user_id") != "wh-renew" {
			t.Errorf("%s", jsobj.Stringify(list))
		}
	})

	t.Run("auto-renew off and on: CANCELLATION (UNSUBSCRIBE), then UNCANCELLATION", func(t *testing.T) {
		env := start(t)
		tx := subscribedUser(env, "wh-cancel", nil)
		notify(env, tu.NotificationSpec{Type: "DID_CHANGE_RENEWAL_STATUS", Subtype: "AUTO_RENEW_DISABLED", Transaction: tx, Renewal: tu.Fields{"autoRenewStatus": 0}, Status: tu.Status(1)})
		env.Clock.Add(1)
		notify(env, tu.NotificationSpec{Type: "DID_CHANGE_RENEWAL_STATUS", Subtype: "AUTO_RENEW_ENABLED", Transaction: tx, Status: tu.Status(1)})
		list := events(t, env)
		if len(list) != 2 || prop(list[0], "type") != "CANCELLATION" || prop(list[0], "cancel_reason") != "UNSUBSCRIBE" ||
			prop(list[1], "type") != "UNCANCELLATION" || prop(list[1], "cancel_reason") != nil {
			t.Errorf("%s", jsobj.Stringify(list))
		}
	})

	t.Run("billing failure with grace: BILLING_ISSUE + CANCELLATION now, EXPIRATION when grace ends", func(t *testing.T) {
		env := start(t)
		now := env.Clock.Now()
		tx := subscribedUser(env, "wh-grace", tu.Fields{"expiresDate": now - tu.Day})
		graceEnd := now + 10*tu.Day
		notify(env, tu.NotificationSpec{Type: "DID_FAIL_TO_RENEW", Subtype: "GRACE_PERIOD", Transaction: tx, Renewal: tu.Fields{"gracePeriodExpiresDate": graceEnd}, Status: tu.Status(apple.StatusGracePeriod)})
		env.Clock.Add(1)
		notify(env, tu.NotificationSpec{Type: "GRACE_PERIOD_EXPIRED", Transaction: tx, Status: tu.Status(apple.StatusBillingRetry)})
		list := events(t, env)
		var got []string
		for _, e := range list {
			got = append(got, jsobj.Stringify([]any{prop(e, "type"), prop(e, "cancel_reason"), prop(e, "expiration_reason"), prop(e, "grace_period_expiration_at_ms")}))
		}
		want := []string{
			`["BILLING_ISSUE",null,null,` + itoa(graceEnd) + `]`,
			`["CANCELLATION","BILLING_ERROR",null,null]`,
			`["EXPIRATION",null,"BILLING_ERROR",null]`,
		}
		if !slices.Equal(got, want) {
			t.Errorf("%v", got)
		}
	})

	t.Run("billing failure without grace expires now, and Apple's later EXPIRED doesn't repeat it", func(t *testing.T) {
		env := start(t)
		tx := subscribedUser(env, "wh-retry", tu.Fields{"expiresDate": env.Clock.Now() - tu.Day})
		notify(env, tu.NotificationSpec{Type: "DID_FAIL_TO_RENEW", Transaction: tx, Status: tu.Status(apple.StatusBillingRetry)})
		env.Clock.Add(1)
		notify(env, tu.NotificationSpec{Type: "EXPIRED", Subtype: "BILLING_RETRY", Transaction: tx, Status: tu.Status(apple.StatusExpired)})
		if got := eventTypes(t, env); !slices.Equal(got, []string{"BILLING_ISSUE", "CANCELLATION", "EXPIRATION"}) {
			t.Errorf("%v", got)
		}
	})

	t.Run("REFUND: CANCELLATION with CUSTOMER_SUPPORT and a negative price", func(t *testing.T) {
		env := start(t)
		tx := subscribedUser(env, "wh-refund", nil)
		notify(env, tu.NotificationSpec{Type: "REFUND", Transaction: tu.Copy(tx, tu.Fields{"revocationDate": env.Clock.Now(), "revocationReason": 0}), Status: tu.Status(apple.StatusRevoked)})
		list := events(t, env)
		if len(list) != 1 || prop(list[0], "type") != "CANCELLATION" || prop(list[0], "cancel_reason") != "CUSTOMER_SUPPORT" ||
			prop(list[0], "price") != -9.99 || prop(list[0], "price_in_purchased_currency") != -9.99 {
			t.Errorf("%s", jsobj.Stringify(list))
		}
	})

	t.Run("an upgrade: PRODUCT_CHANGE naming the new product", func(t *testing.T) {
		env := start(t)
		tx := subscribedUser(env, "wh-upgrade", nil)
		notify(env, tu.NotificationSpec{Type: "DID_CHANGE_RENEWAL_PREF", Subtype: "UPGRADE", Transaction: tx, Renewal: tu.Fields{"autoRenewProductId": "pro_annual"}})
		list := events(t, env)
		if len(list) != 1 || prop(list[0], "type") != "PRODUCT_CHANGE" || prop(list[0], "new_product_id") != "pro_annual" || prop(list[0], "product_id") != "pro_monthly" {
			t.Errorf("%s", jsobj.Stringify(list))
		}
	})

	t.Run("a non-USD price is converted at the purchase date's rate, or null without one", func(t *testing.T) {
		env := start(t)
		now := env.Clock.Now()
		day := func(ms int64) string { return isoDay(ms) }
		env.Exec("INSERT INTO fx_rate (date, currency, per_usd, source) VALUES ($1, 'EUR', 0.9, 'test')", day(now-3*tu.Day))
		receipt(env, "wh-eur", tu.SignJWS(tu.Transaction(now, tu.Fields{"currency": "EUR", "price": 8990})))
		receipt(env, "wh-sar", tu.SignJWS(tu.Transaction(now, tu.Fields{"currency": "SAR", "price": 8990})))
		list := events(t, env)
		if len(list) != 2 || prop(list[0], "price") != 9.99 || prop(list[0], "price_in_purchased_currency") != 8.99 ||
			prop(list[1], "price") != nil || prop(list[1], "price_in_purchased_currency") != 8.99 {
			t.Errorf("%s", jsobj.Stringify(list))
		}
	})
}

func itoa(n int64) string { return jsobj.FormatNumber(float64(n)) }

func isoDay(ms int64) string { return iso(float64(ms))[:10] }
