package server_test

// App Store Server Notifications V2 scenarios: each one is delivered the way Apple does, then
// checked through GET /v1/subscribers, which is what the SDK sees. Mirrors
// lite/test/notifications.test.ts.

import (
	"context"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/apple"
	"github.com/openpurr/openpurr/standard/internal/customerinfo"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

func subscriberOf(env *tu.Env, user string) any { return prop(get(env, user), "subscriber") }

// subscribed posts a purchase from the app, so the customer owns the chain.
func subscribed(env *tu.Env, user string, overrides tu.Fields) *jsobj.Object {
	env.T.Helper()
	f := tu.Fields{"productId": "pro_monthly"}
	for k, v := range overrides {
		f[k] = v
	}
	res, payload := env.PostAppleTransaction(user, f)
	if res.Status != 200 {
		env.T.Fatalf("%d %s", res.Status, res.Body)
	}
	return payload
}

func notify(env *tu.Env, spec tu.NotificationSpec) *tu.Response {
	env.T.Helper()
	signed, _ := tu.SignNotification(env.Clock.Now(), spec)
	return env.PostNotification(signed)
}

func TestNotificationDelivery(t *testing.T) {
	env := tu.Start(t, tu.Options{})

	t.Run("accepts a valid notification and records it once", func(t *testing.T) {
		tx := subscribed(env, "n-dup", nil)
		signed, payload := tu.SignNotification(env.Clock.Now(), tu.NotificationSpec{Type: "DID_RENEW", Transaction: tx, Status: tu.Status(1)})
		if res := env.PostNotification(signed); res.Status != 200 || string(res.Body) != `{"message":"OK"}` {
			t.Fatalf("%d %s", res.Status, res.Body)
		}
		again := env.PostNotification(signed)
		if again.Status != 200 || string(again.Body) != `{"message":"Already processed."}` {
			t.Fatalf("%d %s", again.Status, again.Body)
		}
		var typ, appID, payloadText string
		uuid, _ := payload.Get("notificationUUID")
		err := env.Pool.QueryRow(context.Background(), "SELECT notification_type, app_id, payload FROM store_notification WHERE notification_id = $1", uuid).
			Scan(&typ, &appID, &payloadText)
		if err != nil || typ != "DID_RENEW" || appID != "ios" || payloadText != signed {
			t.Errorf("%s %s %v", typ, appID, err)
		}
	})

	t.Run("rejects a bad signature or body with 400", func(t *testing.T) {
		signed, _ := tu.SignNotification(env.Clock.Now(), tu.NotificationSpec{Type: "TEST"})
		parts := splitJWS(signed)
		// A signature that isn't base64url is invalid too, not a server error Apple would retry.
		for _, bad := range []string{parts[0] + "." + parts[1] + ".AAAA", "not-a-jws", parts[0] + "." + parts[1] + ".%%%"} {
			if res := env.PostNotification(bad); res.Status != 400 {
				t.Errorf("%d %s", res.Status, res.Body)
			}
		}
		res := env.Request("POST", "/notifications/apple", `{"nope":1}`)
		if res.Status != 400 || string(res.Body) != `{"message":"Expected {\"signedPayload\": \"...\"}."}` {
			t.Errorf("%d %s", res.Status, res.Body)
		}
		if res := env.Request("GET", "/notifications/apple", ""); res.Status != 404 {
			t.Errorf("GET: %d", res.Status)
		}
	})

	t.Run("rejects a notification without its UUID or type", func(t *testing.T) {
		res := env.PostNotification(tu.SignJWS(jsobj.New("notificationType", "TEST", "signedDate", float64(env.Clock.Now()))))
		if res.Status != 400 || string(res.Body) != `{"message":"Notification is missing notificationUUID or notificationType."}` {
			t.Errorf("%d %s", res.Status, res.Body)
		}
	})

	t.Run("rejects a forged transaction inside a validly signed notification", func(t *testing.T) {
		outer := jsobj.New(
			"notificationType", "DID_RENEW",
			"notificationUUID", ledger.NewUUID(),
			"signedDate", float64(env.Clock.Now()),
			"data", jsobj.New("bundleId", tu.BundleID, "environment", "Sandbox", "signedTransactionInfo", "eyJhbGciOiJub25lIn0.e30.x", "status", 1.0),
		)
		res := env.PostNotification(tu.SignJWS(outer))
		if res.Status != 400 || string(res.Body) != `{"message":"Invalid signed data in notification: unexpected alg none"}` {
			t.Errorf("%d %s", res.Status, res.Body)
		}
	})

	t.Run("answers 5xx for an unknown bundle or product, so Apple retries after a config fix", func(t *testing.T) {
		tx := tu.Transaction(env.Clock.Now(), tu.Fields{"productId": "not_configured"})
		unknownProduct, payload := tu.SignNotification(env.Clock.Now(), tu.NotificationSpec{Type: "SUBSCRIBED", Subtype: "INITIAL_BUY", Transaction: tx})
		if res := env.PostNotification(unknownProduct); res.Status != 500 || string(res.Body) != `{"message":"Product not_configured is not in the config."}` {
			t.Errorf("%d %s", res.Status, res.Body)
		}
		if res := notify(env, tu.NotificationSpec{Type: "TEST", BundleID: "com.someone.else"}); res.Status != 500 ||
			string(res.Body) != `{"message":"No app in the config has bundle ID com.someone.else."}` {
			t.Errorf("%d %s", res.Status, res.Body)
		}
		// Not marked as processed, so Apple's retry is handled once the config knows the product.
		uuid, _ := payload.Get("notificationUUID")
		var n int
		_ = env.Pool.QueryRow(context.Background(), "SELECT count(*) FROM store_notification WHERE notification_id = $1", uuid).Scan(&n)
		if n != 0 {
			t.Fatal("a failed notification was recorded")
		}
		fixed := withProduct("not_configured")
		if _, _, err := saveAndLoad(t, env, fixed); err != nil {
			t.Fatal(err)
		}
		if res := env.PostNotification(unknownProduct); res.Status != 200 || string(res.Body) != `{"message":"OK"}` {
			t.Errorf("%d %s", res.Status, res.Body)
		}
	})

	t.Run("accepts Apple's TEST notification", func(t *testing.T) {
		if res := notify(env, tu.NotificationSpec{Type: "TEST"}); res.Status != 200 {
			t.Errorf("%d %s", res.Status, res.Body)
		}
	})
}

func withProduct(id string) any {
	raw := withAppleAPI("")
	products := prop(raw, "apps", "ios", "products").(*jsobj.Object)
	products.Set(id, jsobj.New("type", "subscription"))
	return raw
}

func TestNotificationOwnership(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	now := env.Clock.Now()
	tx := tu.Transaction(now, tu.Fields{"productId": "pro_annual", "expiresDate": now + 300*tu.Day})
	if res := notify(env, tu.NotificationSpec{Type: "SUBSCRIBED", Subtype: "INITIAL_BUY", Transaction: tx, Status: tu.Status(1)}); res.Status != 200 {
		t.Fatalf("%d %s", res.Status, res.Body)
	}
	if len(keys(prop(subscriberOf(env, "n-first"), "entitlements"))) != 0 {
		t.Fatal("nobody owns it yet")
	}
	var source string
	_ = env.Pool.QueryRow(context.Background(), "SELECT source FROM store_transaction WHERE transaction_id = $1", str(tx, "transactionId")).Scan(&source)
	if source != "notification" {
		t.Errorf("source %q", source)
	}
	receipt(env, "n-first", tu.SignJWS(tx))
	if prop(subscriberOf(env, "n-first"), "entitlements", "pro", "product_identifier") != "pro_annual" {
		t.Fatal("the receipt should assign the purchase")
	}
}

func TestRenewalsAndStatus(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	now := env.Clock.Now()

	t.Run("DID_RENEW extends the entitlement with the new transaction", func(t *testing.T) {
		first := subscribed(env, "n-renew", tu.Fields{"expiresDate": now + tu.Day})
		expires := num(first, "expiresDate")
		renewal := tu.Transaction(now, tu.Fields{"productId": "pro_monthly", "originalTransactionId": str(first, "originalTransactionId"),
			"purchaseDate": expires, "expiresDate": expires + float64(30*tu.Day)})
		notify(env, tu.NotificationSpec{Type: "DID_RENEW", Transaction: renewal, Status: tu.Status(1)})
		info := subscriberOf(env, "n-renew")
		if prop(info, "entitlements", "pro", "expires_date") != iso(num(renewal, "expiresDate")) ||
			prop(info, "subscriptions", "pro_monthly", "store_transaction_id") != str(renewal, "transactionId") {
			t.Errorf("%s", jsobj.Stringify(info))
		}
	})

	t.Run("auto-renew off sets unsubscribe_detected_at; turning it back on clears it", func(t *testing.T) {
		tx := subscribed(env, "n-autorenew", nil)
		off := now - 1000
		notify(env, tu.NotificationSpec{Type: "DID_CHANGE_RENEWAL_STATUS", Subtype: "AUTO_RENEW_DISABLED", Transaction: tx,
			Renewal: tu.Fields{"autoRenewStatus": 0}, SignedDate: off, Status: tu.Status(1)})
		sub := prop(subscriberOf(env, "n-autorenew"), "subscriptions", "pro_monthly")
		if prop(sub, "unsubscribe_detected_at") != customerinfo.ISO(off) {
			t.Errorf("%s", jsobj.Stringify(sub))
		}
		notify(env, tu.NotificationSpec{Type: "DID_CHANGE_RENEWAL_STATUS", Subtype: "AUTO_RENEW_ENABLED", Transaction: tx,
			Renewal: tu.Fields{"autoRenewStatus": 1}, Status: tu.Status(1)})
		if v := prop(subscriberOf(env, "n-autorenew"), "subscriptions", "pro_monthly", "unsubscribe_detected_at"); v != nil {
			t.Errorf("unsubscribe_detected_at %v", v)
		}
	})

	t.Run("a grace period keeps access: expires_date moves to the grace end", func(t *testing.T) {
		expired := now - 2*tu.Day
		tx := subscribed(env, "n-grace", tu.Fields{"purchaseDate": expired - 30*tu.Day, "expiresDate": expired})
		graceEnd := now + 14*tu.Day
		failedAt := expired + 1000
		notify(env, tu.NotificationSpec{Type: "DID_FAIL_TO_RENEW", Subtype: "GRACE_PERIOD", Transaction: tx,
			Renewal: tu.Fields{"gracePeriodExpiresDate": graceEnd, "isInBillingRetryPeriod": true}, Status: tu.Status(apple.StatusGracePeriod), SignedDate: failedAt})
		info := subscriberOf(env, "n-grace")
		g := customerinfo.ISO(graceEnd)
		if prop(info, "entitlements", "pro", "expires_date") != g || prop(info, "entitlements", "pro", "grace_period_expires_date") != g ||
			prop(info, "subscriptions", "pro_monthly", "expires_date") != g ||
			prop(info, "subscriptions", "pro_monthly", "billing_issues_detected_at") != customerinfo.ISO(failedAt) ||
			prop(info, "management_url") == nil {
			t.Errorf("%s", jsobj.Stringify(info))
		}
	})

	t.Run("billing recovery clears the billing issue and grace period", func(t *testing.T) {
		expired := now - tu.Day
		tx := subscribed(env, "n-recover", tu.Fields{"purchaseDate": expired - 30*tu.Day, "expiresDate": expired})
		notify(env, tu.NotificationSpec{Type: "DID_FAIL_TO_RENEW", Subtype: "GRACE_PERIOD", Transaction: tx,
			Renewal: tu.Fields{"gracePeriodExpiresDate": now + 10*tu.Day}, Status: tu.Status(apple.StatusGracePeriod), SignedDate: now - 1000})
		renewed := tu.Transaction(now, tu.Fields{"originalTransactionId": str(tx, "originalTransactionId"), "purchaseDate": now, "expiresDate": now + 30*tu.Day})
		notify(env, tu.NotificationSpec{Type: "DID_RENEW", Subtype: "BILLING_RECOVERY", Transaction: renewed, Status: tu.Status(apple.StatusActive)})
		sub := prop(subscriberOf(env, "n-recover"), "subscriptions", "pro_monthly")
		if prop(sub, "expires_date") != iso(num(renewed, "expiresDate")) || prop(sub, "billing_issues_detected_at") != nil ||
			prop(sub, "grace_period_expires_date") != nil {
			t.Errorf("%s", jsobj.Stringify(sub))
		}
	})

	t.Run("billing retry without grace: billing issue flagged, access ends at expiry", func(t *testing.T) {
		expired := now - tu.Day
		tx := subscribed(env, "n-retry", tu.Fields{"purchaseDate": expired - 30*tu.Day, "expiresDate": expired})
		notify(env, tu.NotificationSpec{Type: "DID_FAIL_TO_RENEW", Transaction: tx, Renewal: tu.Fields{"isInBillingRetryPeriod": true},
			Status: tu.Status(apple.StatusBillingRetry)})
		info := subscriberOf(env, "n-retry")
		if prop(info, "subscriptions", "pro_monthly", "billing_issues_detected_at") == nil ||
			prop(info, "entitlements", "pro", "expires_date") != customerinfo.ISO(expired) || prop(info, "management_url") != nil {
			t.Errorf("%s", jsobj.Stringify(info))
		}
	})

	t.Run("infers billing retry and grace from renewal info when the notification has no status", func(t *testing.T) {
		expired := now - tu.Day
		tx := subscribed(env, "n-infer", tu.Fields{"purchaseDate": expired - 30*tu.Day, "expiresDate": expired})
		notify(env, tu.NotificationSpec{Type: "DID_FAIL_TO_RENEW", Subtype: "GRACE_PERIOD", Transaction: tx,
			Renewal: tu.Fields{"gracePeriodExpiresDate": now + 3*tu.Day}})
		var status int
		var grace int64
		_ = env.Pool.QueryRow(context.Background(), "SELECT status, grace_period_expires_at FROM subscription_state WHERE original_transaction_id = $1",
			str(tx, "originalTransactionId")).Scan(&status, &grace)
		if status != apple.StatusGracePeriod || grace != now+3*tu.Day {
			t.Errorf("status %d grace %d", status, grace)
		}
	})

	t.Run("ignores status that's older than what's stored (out-of-order delivery)", func(t *testing.T) {
		tx := subscribed(env, "n-order", nil)
		newer, _ := tu.SignNotification(now, tu.NotificationSpec{Type: "DID_CHANGE_RENEWAL_STATUS", Transaction: tx, Renewal: tu.Fields{"autoRenewStatus": 1}, SignedDate: now})
		older, _ := tu.SignNotification(now, tu.NotificationSpec{Type: "DID_CHANGE_RENEWAL_STATUS", Transaction: tx, Renewal: tu.Fields{"autoRenewStatus": 0}, SignedDate: now - 60_000})
		env.PostNotification(newer)
		env.PostNotification(older)
		if v := prop(subscriberOf(env, "n-order"), "subscriptions", "pro_monthly", "unsubscribe_detected_at"); v != nil {
			t.Errorf("unsubscribe_detected_at %v", v)
		}
	})
}

func TestRefundsRevocationsAndUpgrades(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	now := env.Clock.Now()

	t.Run("REFUND ends access at the revocation time", func(t *testing.T) {
		tx := subscribed(env, "n-refund", nil)
		revoked := now - 1000
		refunded := tu.Copy(tx, tu.Fields{"revocationDate": revoked, "revocationReason": 0})
		notify(env, tu.NotificationSpec{Type: "REFUND", Transaction: refunded, Status: tu.Status(apple.StatusRevoked)})
		info := subscriberOf(env, "n-refund")
		r := customerinfo.ISO(revoked)
		if prop(info, "subscriptions", "pro_monthly", "refunded_at") != r || prop(info, "subscriptions", "pro_monthly", "expires_date") != r ||
			prop(info, "entitlements", "pro", "expires_date") != r {
			t.Errorf("%s", jsobj.Stringify(info))
		}
	})

	t.Run("REVOKE (family sharing ended) removes a one-time purchase", func(t *testing.T) {
		tx := subscribed(env, "n-revoke", tu.Fields{"productId": "lifetime", "type": "Non-Consumable", "expiresDate": nil, "inAppOwnershipType": "FAMILY_SHARED"})
		if prop(subscriberOf(env, "n-revoke"), "entitlements", "pro", "product_identifier") != "lifetime" {
			t.Fatal("not granted")
		}
		notify(env, tu.NotificationSpec{Type: "REVOKE", Transaction: tu.Copy(tx, tu.Fields{"revocationDate": now})})
		info := subscriberOf(env, "n-revoke")
		if len(keys(prop(info, "entitlements"))) != 0 || len(keys(prop(info, "non_subscriptions"))) != 0 {
			t.Errorf("%s", jsobj.Stringify(info))
		}
	})

	t.Run("an upgraded transaction stops granting; the upgrade's product takes over", func(t *testing.T) {
		monthly := subscribed(env, "n-upgrade", tu.Fields{"expiresDate": now + 20*tu.Day})
		annual := tu.Transaction(now, tu.Fields{"productId": "pro_annual", "originalTransactionId": str(monthly, "originalTransactionId"), "expiresDate": now + 365*tu.Day})
		notify(env, tu.NotificationSpec{Type: "DID_CHANGE_RENEWAL_PREF", Subtype: "UPGRADE", Transaction: tu.Copy(monthly, tu.Fields{"isUpgraded": true})})
		notify(env, tu.NotificationSpec{Type: "DID_RENEW", Transaction: annual, Status: tu.Status(1)})
		info := subscriberOf(env, "n-upgrade")
		if prop(info, "entitlements", "pro", "product_identifier") != "pro_annual" || prop(info, "entitlements", "annual_perks", "product_identifier") != "pro_annual" {
			t.Errorf("%s", jsobj.Stringify(info))
		}
	})
}

func TestNotificationSnapshots(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	now := env.Clock.Now()
	// A notification drops the owner's snapshot in its transaction and rebuilds it afterwards.
	tx := subscribed(env, "snap-notify", tu.Fields{"expiresDate": now - tu.Day})
	grace := now + 5*tu.Day
	before := env.Call("/v1/subscribers/snap-notify", tu.CallOptions{}).Header.Get("ETag")
	notify(env, tu.NotificationSpec{Type: "DID_FAIL_TO_RENEW", Subtype: "GRACE_PERIOD", Transaction: tx,
		Renewal: tu.Fields{"gracePeriodExpiresDate": grace}, Status: tu.Status(apple.StatusGracePeriod)})
	res := env.Call("/v1/subscribers/snap-notify", tu.CallOptions{})
	if prop(res.JSON(t), "subscriber", "entitlements", "pro", "grace_period_expires_date") != customerinfo.ISO(grace) {
		t.Errorf("%s", res.Body)
	}
	if etag := res.Header.Get("ETag"); etag == "" || etag == before {
		t.Errorf("the snapshot should be rebuilt: %q then %q", before, etag)
	}
}
