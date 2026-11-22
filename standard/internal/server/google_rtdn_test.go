package server_test

// Google Play Real-time Developer Notifications pushed by Pub/Sub. Mirrors
// lite/test/google-rtdn.test.ts, with webhook events checked on webhook_event (delivery arrives
// with the job loop).

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/openpurr/openpurr/standard/internal/jsobj"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

func subNotification(token string, typ int) *jsobj.Object {
	return jsobj.New("subscriptionNotification", jsobj.New("version", "1.0", "notificationType", float64(typ), "purchaseToken", token))
}

func playInfo(t *testing.T, env *tu.Env, user string) any {
	t.Helper()
	return prop(env.Call("/v1/subscribers/"+user, tu.CallOptions{Platform: "android"}).JSON(t), "subscriber")
}

func parseISO(t *testing.T, v any) int64 {
	t.Helper()
	s, _ := v.(string)
	at, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatalf("not a date: %v", v)
	}
	return at.UnixMilli()
}

func TestGooglePushAuthentication(t *testing.T) {
	t.Run("accepts only a valid Pub/Sub token from the configured push account and audience", func(t *testing.T) {
		env, fake := tu.StartGoogle(t, true)
		test := jsobj.New("testNotification", jsobj.New("version", "1.0"))
		now := env.Clock.Now()
		aud := env.PushAudience()
		if res := env.PostGoogleNotification(test, tu.NotifyOptions{}); res.Status != 200 {
			t.Fatalf("%d %s", res.Status, res.Body)
		}
		good := tu.PushToken(now, aud, nil, "")
		parts := strings.Split(good, ".")
		cases := map[string]string{
			"no token":       "-",
			"audience":       tu.PushToken(now, "https://elsewhere.example/hook", nil, ""),
			"email":          tu.PushToken(now, aud, tu.GoogleFields{"email": "someone@else.iam.gserviceaccount.com"}, ""),
			"expired":        tu.PushToken(now, aud, tu.GoogleFields{"exp": float64(now/1000 - 3600)}, ""),
			"issuer":         tu.PushToken(now, aud, tu.GoogleFields{"iss": "https://evil.example"}, ""),
			"unknown key":    tu.PushToken(now, aud, nil, "unknown-kid"),
			"unverified":     tu.PushToken(now, aud, tu.GoogleFields{"email_verified": false}, ""),
			"bad signature":  parts[0] + "." + parts[1] + ".AAAA",
			"not base64url":  parts[0] + "." + parts[1] + ".%%%",
			"not a JWT":      "abc",
			"malformed JSON": "e30." + strings.TrimRight(parts[1], "=") + "x." + parts[2],
		}
		for name, token := range cases {
			if res := env.PostGoogleNotification(test, tu.NotifyOptions{Token: token}); res.Status != 401 {
				t.Errorf("%s: %d %s", name, res.Status, res.Body)
			}
		}
		// The keys were fetched once, and again for the unknown kid.
		if n := fake.KeyFetches.Load(); n != 2 {
			t.Errorf("%d key fetches", n)
		}
		// Within the allowed clock skew.
		late := tu.PushToken(now, aud, tu.GoogleFields{"exp": float64(now/1000 - 200)}, "")
		if res := env.PostGoogleNotification(test, tu.NotifyOptions{Token: late}); res.Status != 200 {
			t.Errorf("skew: %d %s", res.Status, res.Body)
		}
	})

	t.Run("a configured audience replaces the URL", func(t *testing.T) {
		raw := tu.GoogleConfig(false)
		api := prop(raw, "apps", "android", "google_play_api").(*jsobj.Object)
		api.Set("pubsub_audience", "https://openpurr.example/notifications/google")
		fake := tu.NewFakeGoogle(t)
		env := tu.Start(t, tu.Options{Config: raw, StoreBase: fake.Server.URL, Secrets: tu.GoogleSecrets()})
		test := jsobj.New("testNotification", jsobj.New())
		if res := env.PostGoogleNotification(test, tu.NotifyOptions{}); res.Status != 401 {
			t.Errorf("default audience: %d", res.Status)
		}
		token := tu.PushToken(env.Clock.Now(), "https://openpurr.example/notifications/google", nil, "")
		if res := env.PostGoogleNotification(test, tu.NotifyOptions{Token: token}); res.Status != 200 {
			t.Errorf("%d %s", res.Status, res.Body)
		}
	})

	t.Run("401 when no app has a push account", func(t *testing.T) {
		env := tu.Start(t, tu.Options{})
		res := env.PostGoogleNotification(jsobj.New("testNotification", jsobj.New()), tu.NotifyOptions{})
		if res.Status != 401 || prop(res.JSON(t), "message") != "No Google Play app has google_play_api.pubsub_push_account configured." {
			t.Errorf("%d %s", res.Status, res.Body)
		}
	})

	t.Run("acknowledges malformed messages (so Pub/Sub stops retrying) and answers 5xx for an unknown package", func(t *testing.T) {
		env, _ := tu.StartGoogle(t, true)
		raw := "%%%not base64%%%"
		if res := env.PostGoogleNotification(jsobj.New(), tu.NotifyOptions{RawData: &raw}); res.Status != 200 || prop(res.JSON(t), "message") != "Ignored: malformed message." {
			t.Errorf("%d %s", res.Status, res.Body)
		}
		res := env.PostGoogleNotification(jsobj.New("packageName", "com.unknown.app", "testNotification", jsobj.New()), tu.NotifyOptions{})
		if res.Status != 500 || prop(res.JSON(t), "message") != "No app in the config has package com.unknown.app with Pub/Sub push configured." {
			t.Errorf("%d %s", res.Status, res.Body)
		}
	})

	t.Run("a test notification is recorded", func(t *testing.T) {
		env, _ := tu.StartGoogle(t, true)
		env.PostGoogleNotification(jsobj.New("testNotification", jsobj.New("version", "1.0")), tu.NotifyOptions{MessageID: "test-1"})
		var kind, env2 string
		if err := env.Pool.QueryRow(context.Background(),
			"SELECT notification_type, environment FROM store_notification WHERE store = 'play_store' AND notification_id = 'test-1'").Scan(&kind, &env2); err != nil || kind != "TEST" || env2 != "production" {
			t.Errorf("%s %s %v", kind, env2, err)
		}
	})
}

func TestGoogleSubscriptionNotifications(t *testing.T) {
	t.Run("records a purchase that arrives before the app posts it; the app's receipt then reports it once", func(t *testing.T) {
		env, fake := tu.StartGoogle(t, true)
		fake.SetSub("rt-1", tu.PlaySubscription(env.Clock.Now(), tu.PlaySub{OrderID: "GPA.1000-0000-0000-00001"}))
		if res := env.PostGoogleNotification(subNotification("rt-1", 4), tu.NotifyOptions{}); res.Status != 200 {
			t.Fatalf("%d %s", res.Status, res.Body)
		}
		if got := eventTypes(t, env); len(got) != 0 {
			t.Errorf("nobody owns it yet, but: %v", got)
		}
		// The server acknowledged it as a safety net.
		if fake.Requested("POST /purchases/subscriptions/pro/tokens/rt-1:acknowledge") != 1 {
			t.Error("not acknowledged")
		}
		env.PlayReceipt("rt-user", "rt-1", "pro", "monthly")
		if got := strings.Join(eventTypes(t, env), ","); got != "INITIAL_PURCHASE" {
			t.Errorf("%s", got)
		}
		if prop(playInfo(t, env, "rt-user"), "entitlements", "pro") == nil {
			t.Error("no entitlement")
		}
	})

	t.Run("ignores a redelivered message", func(t *testing.T) {
		env, fake := tu.StartGoogle(t, true)
		fake.SetSub("rt-dup", tu.PlaySubscription(env.Clock.Now(), tu.PlaySub{Ack: true}))
		env.PlayReceipt("rt-dup-user", "rt-dup", "pro", "monthly")
		n := jsobj.New("subscriptionNotification", jsobj.New("notificationType", 3.0, "purchaseToken", "rt-dup"))
		first := env.PostGoogleNotification(n, tu.NotifyOptions{MessageID: "fixed-1"})
		again := env.PostGoogleNotification(n, tu.NotifyOptions{MessageID: "fixed-1"})
		if first.Status != 200 || string(again.Body) != `{"message":"Already processed."}` {
			t.Errorf("%d %s / %s", first.Status, first.Body, again.Body)
		}
	})

	t.Run("RENEWED extends access with the new order", func(t *testing.T) {
		env, fake := tu.StartGoogle(t, true)
		now := env.Clock.Now()
		fake.SetSub("rt-renew", tu.PlaySubscription(now, tu.PlaySub{Ack: true, OrderID: "GPA.2000-0000-0000-00001", Expiry: now + tu.Day}))
		env.PlayReceipt("rt-renew-user", "rt-renew", "pro", "monthly")
		newExpiry := now + 31*tu.Day
		fake.SetSub("rt-renew", tu.PlaySubscription(now, tu.PlaySub{Ack: true, OrderID: "GPA.2000-0000-0000-00001..0", Expiry: newExpiry}))
		env.PostGoogleNotification(subNotification("rt-renew", 2), tu.NotifyOptions{})
		if got := strings.Join(eventTypes(t, env), ","); got != "INITIAL_PURCHASE,RENEWAL" {
			t.Errorf("%s", got)
		}
		if got := parseISO(t, prop(playInfo(t, env, "rt-renew-user"), "entitlements", "pro", "expires_date")); got != newExpiry/1000*1000 {
			t.Errorf("expires %d, want %d", got, newExpiry)
		}
	})

	t.Run("grace period then account hold: one billing issue, then access ends", func(t *testing.T) {
		env, fake := tu.StartGoogle(t, true)
		now := env.Clock.Now()
		fake.SetSub("rt-bill", tu.PlaySubscription(now, tu.PlaySub{Ack: true, OrderID: "GPA.3000-0000-0000-00001"}))
		env.PlayReceipt("rt-bill-user", "rt-bill", "pro", "monthly")
		mark := len(eventTypes(t, env))

		fake.SetSub("rt-bill", tu.PlaySubscription(now, tu.PlaySub{Ack: true, OrderID: "GPA.3000-0000-0000-00001", State: "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", Expiry: now + 3*tu.Day}))
		env.PostGoogleNotification(subNotification("rt-bill", 6), tu.NotifyOptions{})
		sub := prop(playInfo(t, env, "rt-bill-user"), "subscriptions", "pro")
		if prop(sub, "billing_issues_detected_at") == nil || prop(sub, "grace_period_expires_date") == nil {
			t.Errorf("%s", jsobj.Stringify(sub))
		}

		fake.SetSub("rt-bill", tu.PlaySubscription(now, tu.PlaySub{Ack: true, OrderID: "GPA.3000-0000-0000-00001", State: "SUBSCRIPTION_STATE_ON_HOLD", Expiry: now - 1000}))
		env.PostGoogleNotification(subNotification("rt-bill", 5), tu.NotifyOptions{})
		if got := strings.Join(eventTypes(t, env)[mark:], ","); got != "BILLING_ISSUE,CANCELLATION,EXPIRATION" {
			t.Errorf("%s", got)
		}
		sub = prop(playInfo(t, env, "rt-bill-user"), "subscriptions", "pro")
		if parseISO(t, prop(sub, "expires_date")) >= now {
			t.Errorf("%s", jsobj.Stringify(sub))
		}
	})

	t.Run("a user cancellation: CANCELLATION (UNSUBSCRIBE) and unsubscribe_detected_at", func(t *testing.T) {
		env, fake := tu.StartGoogle(t, true)
		now := env.Clock.Now()
		fake.SetSub("rt-cancel", tu.PlaySubscription(now, tu.PlaySub{Ack: true}))
		env.PlayReceipt("rt-cancel-user", "rt-cancel", "pro", "monthly")
		canceled := tu.PlaySubscription(now, tu.PlaySub{Ack: true, State: "SUBSCRIPTION_STATE_CANCELED", AutoRenewOff: true})
		canceled.Set("canceledStateContext", jsobj.New("userInitiatedCancellation", jsobj.New()))
		fake.SetSub("rt-cancel", canceled)
		env.PostGoogleNotification(subNotification("rt-cancel", 3), tu.NotifyOptions{})
		all := events(t, env)
		last := all[len(all)-1]
		if prop(last, "type") != "CANCELLATION" || prop(last, "cancel_reason") != "UNSUBSCRIBE" {
			t.Errorf("%s", jsobj.Stringify(last))
		}
		if prop(playInfo(t, env, "rt-cancel-user"), "subscriptions", "pro", "unsubscribe_detected_at") == nil {
			t.Error("no unsubscribe_detected_at")
		}
	})

	t.Run("pauses: SUBSCRIPTION_PAUSED when scheduled, EXPIRATION when it starts, with auto_resume_date", func(t *testing.T) {
		env, fake := tu.StartGoogle(t, true)
		now := env.Clock.Now()
		fake.SetSub("rt-pause", tu.PlaySubscription(now, tu.PlaySub{Ack: true}))
		env.PlayReceipt("rt-pause-user", "rt-pause", "pro", "monthly")
		resume := now + 30*tu.Day
		fake.SetSub("rt-pause", tu.PlaySubscription(now, tu.PlaySub{Ack: true, AutoResume: resume}))
		env.PostGoogleNotification(subNotification("rt-pause", 11), tu.NotifyOptions{})
		fake.SetSub("rt-pause", tu.PlaySubscription(now, tu.PlaySub{Ack: true, State: "SUBSCRIPTION_STATE_PAUSED", Expiry: now - 1000, AutoResume: resume}))
		env.PostGoogleNotification(subNotification("rt-pause", 10), tu.NotifyOptions{})
		all := events(t, env)[1:]
		var got []string
		for _, e := range all {
			reason, _ := jsobj.Prop(e, "expiration_reason")
			got = append(got, prop(e, "type").(string)+"/"+jsobj.String(reason, reason != nil))
		}
		if strings.Join(got, ",") != "SUBSCRIPTION_PAUSED/undefined,EXPIRATION/SUBSCRIPTION_PAUSED" {
			t.Errorf("%v", got)
		}
		if prop(all[0], "auto_resume_at_ms") != float64(resume) {
			t.Errorf("%s", jsobj.Stringify(all[0]))
		}
		if prop(playInfo(t, env, "rt-pause-user"), "subscriptions", "pro", "auto_resume_date") == nil {
			t.Error("no auto_resume_date")
		}
	})

	t.Run("a revocation (refund) ends access and reports a negative price", func(t *testing.T) {
		env, fake := tu.StartGoogle(t, true)
		now := env.Clock.Now()
		fake.SetSub("rt-revoke", tu.PlaySubscription(now, tu.PlaySub{Ack: true, OrderID: "GPA.4000-0000-0000-00001"}))
		env.PlayReceipt("rt-revoke-user", "rt-revoke", "pro", "monthly")
		fake.SetSub("rt-revoke", tu.PlaySubscription(now, tu.PlaySub{Ack: true, OrderID: "GPA.4000-0000-0000-00001", State: "SUBSCRIPTION_STATE_EXPIRED"}))
		env.PostGoogleNotification(subNotification("rt-revoke", 12), tu.NotifyOptions{})
		all := events(t, env)
		last := all[len(all)-1]
		if prop(last, "type") != "CANCELLATION" || prop(last, "cancel_reason") != "CUSTOMER_SUPPORT" || prop(last, "price_in_purchased_currency") != -4.99 {
			t.Errorf("%s", jsobj.Stringify(last))
		}
		if parseISO(t, prop(playInfo(t, env, "rt-revoke-user"), "entitlements", "pro", "expires_date")) > now {
			t.Error("still entitled")
		}
	})

	t.Run("a plan change by notification: the new token inherits the owner; PRODUCT_CHANGE + INITIAL_PURCHASE", func(t *testing.T) {
		env, fake := tu.StartGoogle(t, true)
		now := env.Clock.Now()
		fake.SetSub("rt-old", tu.PlaySubscription(now, tu.PlaySub{Ack: true, BasePlanID: "monthly", OrderID: "GPA.5000-0000-0000-00001"}))
		env.PlayReceipt("rt-change-user", "rt-old", "pro", "monthly")
		mark := len(events(t, env))
		fake.SetSub("rt-new", tu.PlaySubscription(now, tu.PlaySub{Ack: true, BasePlanID: "annual", OrderID: "GPA.5000-0000-0000-00002", LinkedPurchaseToken: "rt-old", Expiry: now + 365*tu.Day}))
		env.PostGoogleNotification(subNotification("rt-new", 4), tu.NotifyOptions{})
		var got []string
		for _, e := range events(t, env)[mark:] {
			np, _ := jsobj.Prop(e, "new_product_id")
			got = append(got, prop(e, "type").(string)+"/"+jsobj.String(np, np != nil))
		}
		if strings.Join(got, ",") != "PRODUCT_CHANGE/pro:annual,INITIAL_PURCHASE/undefined" {
			t.Errorf("%v", got)
		}
		if prop(playInfo(t, env, "rt-change-user"), "entitlements", "pro", "product_plan_identifier") != "annual" {
			t.Error("not annual")
		}
	})

	t.Run("a notification that links a token to another customer's invalidates that customer's snapshot", func(t *testing.T) {
		env, fake := tu.StartGoogle(t, false)
		now := env.Clock.Now()
		fake.SetSub("rt-a", tu.PlaySubscription(now, tu.PlaySub{Ack: true, OrderID: "GPA.5100-0000-0000-00001"}))
		fake.SetSub("rt-b", tu.PlaySubscription(now, tu.PlaySub{Ack: true, OrderID: "GPA.5100-0000-0000-00002"}))
		env.PlayReceipt("rt-first", "rt-a", "pro", "monthly")
		env.PlayReceipt("rt-second", "rt-b", "pro", "monthly")
		if prop(playInfo(t, env, "rt-first"), "entitlements", "pro") == nil {
			t.Fatal("no entitlement")
		}
		// Google now reports rt-b as replacing rt-a.
		fake.SetSub("rt-b", tu.PlaySubscription(now, tu.PlaySub{Ack: true, OrderID: "GPA.5100-0000-0000-00002", LinkedPurchaseToken: "rt-a"}))
		if res := env.PostGoogleNotification(subNotification("rt-b", 2), tu.NotifyOptions{}); res.Status != 200 {
			t.Fatalf("%d %s", res.Status, res.Body)
		}
		if e := prop(playInfo(t, env, "rt-first"), "entitlements", "pro"); e != nil {
			t.Errorf("the replaced subscription still grants access: %s", jsobj.Stringify(e))
		}
	})

	t.Run("ignores a token Google no longer knows", func(t *testing.T) {
		env, _ := tu.StartGoogle(t, true)
		res := env.PostGoogleNotification(subNotification("rt-gone", 2), tu.NotifyOptions{})
		if res.Status != 200 || string(res.Body) != `{"message":"Ignored: Google no longer knows this purchase."}` {
			t.Errorf("%d %s", res.Status, res.Body)
		}
	})

	t.Run("5xx for a product the config doesn't list, or Google being down", func(t *testing.T) {
		env, fake := tu.StartGoogle(t, true)
		fake.SetSub("rt-unknown", tu.PlaySubscription(env.Clock.Now(), tu.PlaySub{ProductID: "discontinued"}))
		res := env.PostGoogleNotification(subNotification("rt-unknown", 2), tu.NotifyOptions{})
		if res.Status != 500 || prop(res.JSON(t), "message") != "Product discontinued is not in the config." {
			t.Errorf("%d %s", res.Status, res.Body)
		}
		fake.Route("GET /purchases/subscriptionsv2/tokens/rt-down", func(*http.Request) (int, any) { return 503, jsobj.New() })
		if res := env.PostGoogleNotification(subNotification("rt-down", 2), tu.NotifyOptions{}); res.Status != 503 {
			t.Errorf("%d %s", res.Status, res.Body)
		}
	})
}

func TestGoogleOneTimeAndVoidedNotifications(t *testing.T) {
	t.Run("a one-time purchase: NON_RENEWING_PURCHASE; a voided order: refund", func(t *testing.T) {
		env, fake := tu.StartGoogle(t, true)
		now := env.Clock.Now()
		fake.SetProduct("ot-1", jsobj.New("orderId", "GPA.6000-0000-0000-00001", "purchaseTimeMillis", jsobj.FormatNumber(float64(now)),
			"purchaseState", 0.0, "acknowledgementState", 1.0, "purchaseType", 0.0))
		env.PlayReceipt("ot-user", "ot-1", "lifetime", "")
		env.PostGoogleNotification(jsobj.New("oneTimeProductNotification", jsobj.New("version", "1.0", "notificationType", 1.0, "purchaseToken", "ot-1", "sku", "lifetime")), tu.NotifyOptions{})
		// One event, whichever reported it first.
		if got := strings.Join(eventTypes(t, env), ","); got != "NON_RENEWING_PURCHASE" {
			t.Errorf("%s", got)
		}

		env.PostGoogleNotification(jsobj.New("voidedPurchaseNotification", jsobj.New("purchaseToken", "ot-1", "orderId", "GPA.6000-0000-0000-00001", "productType", 2.0, "refundType", 1.0)), tu.NotifyOptions{})
		all := events(t, env)
		last := all[len(all)-1]
		if prop(last, "type") != "CANCELLATION" || prop(last, "cancel_reason") != "CUSTOMER_SUPPORT" {
			t.Errorf("%s", jsobj.Stringify(last))
		}
		if got := jsobj.Stringify(prop(playInfo(t, env, "ot-user"), "entitlements")); got != "{}" {
			t.Errorf("%s", got)
		}
		var reason string
		if err := env.Pool.QueryRow(context.Background(), "SELECT revocation_reason FROM store_transaction WHERE transaction_id = 'GPA.6000-0000-0000-00001'").Scan(&reason); err != nil || reason != "voided" {
			t.Errorf("%q %v", reason, err)
		}
	})
}
