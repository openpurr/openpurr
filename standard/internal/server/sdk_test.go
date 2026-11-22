package server_test

// Drives the SDK API the way the SDKs do (headers and bodies per spec/sdk-wire-contract.md) and
// checks every response against the keys each platform requires. Mirrors lite/test/sdk.test.ts;
// purchases are written to the ledger directly until the receipt endpoint exists.

import (
	"net/url"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/openpurr/openpurr/standard/internal/customerinfo"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

var isoDate = regexp.MustCompile(`^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$`)

func prop(v any, path ...string) any {
	for _, p := range path {
		v, _ = jsobj.Prop(v, p)
	}
	return v
}

func keys(v any) []string {
	o, _ := v.(*jsobj.Object)
	if o == nil {
		return nil
	}
	return o.Keys()
}

// expectValidCustomerInfo checks the union of what iOS and Android require (wire contract,
// CustomerInfo section).
func expectValidCustomerInfo(t *testing.T, body any) {
	t.Helper()
	if s, _ := prop(body, "request_date").(string); !isoDate.MatchString(s) {
		t.Errorf("request_date %q", s)
	}
	if _, ok := prop(body, "subscriber", "original_app_user_id").(string); !ok {
		t.Error("original_app_user_id missing")
	}
	if s, _ := prop(body, "subscriber", "first_seen").(string); !strings.HasSuffix(s, "Z") {
		t.Errorf("first_seen %q", s)
	}
	subs, ok1 := prop(body, "subscriber", "subscriptions").(*jsobj.Object)
	nonSubs, ok2 := prop(body, "subscriber", "non_subscriptions").(*jsobj.Object)
	if !ok1 || !ok2 {
		t.Fatal("subscriptions and non_subscriptions must be objects")
	}
	ents, _ := prop(body, "subscriber", "entitlements").(*jsobj.Object)
	for _, id := range ents.Keys() {
		e, _ := ents.Get(id)
		if prop(e, "purchase_date") == nil {
			t.Errorf("entitlement %s has no purchase_date", id)
		}
		pid, _ := prop(e, "product_identifier").(string)
		target, ok := subs.Get(pid)
		if !ok {
			if list, isList := prop(nonSubs, pid).([]any); isList && len(list) > 0 {
				target, ok = list[0], true
			}
		}
		if !ok {
			t.Errorf("entitlement points at missing product %s", pid)
			continue
		}
		if prop(target, "original_purchase_date") == nil || prop(target, "store") == nil {
			t.Errorf("product %s lacks original_purchase_date or store", pid)
		}
		if _, isBool := prop(target, "is_sandbox").(bool); !isBool {
			t.Errorf("product %s lacks is_sandbox", pid)
		}
	}
	for _, id := range subs.Keys() {
		s, _ := subs.Get(id)
		if prop(s, "period_type") == nil {
			t.Errorf("subscription %s lacks period_type", id)
		}
	}
	for _, id := range nonSubs.Keys() {
		list, _ := nonSubs.Get(id)
		for _, n := range list.([]any) {
			if _, isBool := prop(n, "is_sandbox").(bool); !isBool {
				t.Errorf("non-subscription %s lacks is_sandbox", id)
			}
		}
	}
}

func TestAuth(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	t.Run("rejects unknown keys with a JSON 7225 error", func(t *testing.T) {
		res := env.Call("/v1/subscribers/"+url.PathEscape(tu.Anon), tu.CallOptions{Key: tu.Key("appl_wrong_key_0000000")})
		if res.Status != 401 || !strings.HasPrefix(res.Header.Get("Content-Type"), "application/json") {
			t.Fatalf("%d %s", res.Status, res.Header.Get("Content-Type"))
		}
		if prop(res.JSON(t), "code") != 7225.0 {
			t.Fatal(string(res.Body))
		}
	})
	t.Run("rejects a missing key, even on unknown routes", func(t *testing.T) {
		for _, path := range []string{"/v1/subscribers/u1", "/v1/nothing/here"} {
			if res := env.Call(path, tu.CallOptions{Key: tu.Key("")}); res.Status != 401 {
				t.Errorf("%s: %d", path, res.Status)
			}
		}
	})
	t.Run("serves the DEBUG health check without a key", func(t *testing.T) {
		res := env.Call("/v1/subscribers/x/health_report_availability", tu.CallOptions{Key: tu.Key("")})
		if string(res.Body) != `{"report_logs":false}` {
			t.Fatal(string(res.Body))
		}
	})
	t.Run("answers unknown routes with a JSON 404 after the key check", func(t *testing.T) {
		res := env.Call("/v1/receipts", tu.CallOptions{})
		if res.Status != 404 || string(res.Body) != `{"code":0,"message":"Not implemented: GET /v1/receipts"}` {
			t.Fatalf("%d %s", res.Status, res.Body)
		}
		res = env.Call("/v1/subscribers//offerings", tu.CallOptions{})
		if res.Status != 404 || !strings.Contains(string(res.Body), "Not implemented") {
			t.Fatalf("%d %s", res.Status, res.Body)
		}
		res = env.Call("/elsewhere", tu.CallOptions{})
		if res.Status != 404 || string(res.Body) != `{"code":0,"message":"Not found"}` {
			t.Fatalf("%d %s", res.Status, res.Body)
		}
	})
}

func TestStartupCalls(t *testing.T) {
	env := tu.Start(t, tu.Options{})

	t.Run("returns an empty CustomerInfo for a new anonymous user, without writing", func(t *testing.T) {
		// iOS sends $ and : raw; Android percent-encodes them. Both must resolve to the same user.
		for _, path := range []string{"/v1/subscribers/" + tu.Anon, "/v1/subscribers/" + url.PathEscape(tu.Anon), "/v1/subscribers/%24RCAnonymousID%3A0123456789abcdef0123456789abcdef"} {
			res := env.Call(path, tu.CallOptions{})
			if res.Status != 200 {
				t.Fatalf("%s: %d", path, res.Status)
			}
			body := res.JSON(t)
			expectValidCustomerInfo(t, body)
			if prop(body, "subscriber", "original_app_user_id") != tu.Anon || prop(body, "subscriber", "management_url") != nil {
				t.Fatal(string(res.Body))
			}
			want := `{"request_date":"2027-01-15T08:00:00Z","request_date_ms":1800000000000,"subscriber":{"original_app_user_id":"$RCAnonymousID:0123456789abcdef0123456789abcdef","original_application_version":null,"original_purchase_date":null,"first_seen":"2027-01-15T08:00:00Z","last_seen":"2027-01-15T08:00:00Z","management_url":null,"subscriptions":{},"non_subscriptions":{},"other_purchases":{},"entitlements":{},"subscriber_attributes":{}}}`
			if string(res.Body) != want {
				t.Fatalf("body\n got: %s\nwant: %s", res.Body, want)
			}
		}
		if n := env.Count("customer"); n != 0 {
			t.Fatalf("%d customers", n)
		}
	})

	t.Run("never answers 304, even when an ETag is sent", func(t *testing.T) {
		res := env.Call("/v1/subscribers/u1", tu.CallOptions{Headers: map[string]string{"X-RevenueCat-ETag": "abc", "If-None-Match": "*"}})
		if res.Status != 200 {
			t.Fatal(res.Status)
		}
	})

	t.Run("serves each app its own packages from the config", func(t *testing.T) {
		ios := env.Call("/v1/subscribers/u1/offerings", tu.CallOptions{})
		want := `{"current_offering_id":"default","offerings":[{"identifier":"default","description":"Standard","metadata":{"headline":"Go Pro"},"packages":[{"identifier":"$rc_monthly","platform_product_identifier":"pro_monthly"},{"identifier":"$rc_annual","platform_product_identifier":"pro_annual"},{"identifier":"$rc_lifetime","platform_product_identifier":"lifetime"}]}],"placements":null,"targeting":null}`
		if string(ios.Body) != want {
			t.Fatalf("ios\n got: %s\nwant: %s", ios.Body, want)
		}
		android := env.Call("/v1/subscribers/u1/offerings", tu.CallOptions{Platform: "android"})
		pkg := prop(android.JSON(t), "offerings").([]any)[0]
		first := prop(pkg, "packages").([]any)[0]
		if jsobj.Stringify(first) != `{"identifier":"$rc_monthly","platform_product_identifier":"pro","platform_product_plan_identifier":"monthly"}` {
			t.Fatal(jsobj.Stringify(first))
		}
	})

	t.Run("serves the product entitlement mapping per app, expanding Play base plans", func(t *testing.T) {
		ios := env.Call("/v1/product_entitlement_mapping", tu.CallOptions{})
		m := prop(ios.JSON(t), "product_entitlement_mapping")
		if got := jsobj.Stringify(prop(m, "pro_annual")); got != `{"product_identifier":"pro_annual","base_plan_id":null,"entitlements":["pro","annual_perks"]}` {
			t.Fatal(got)
		}
		if prop(m, "coins_100") != nil {
			t.Fatal("consumables grant nothing")
		}
		android := env.Call("/v1/product_entitlement_mapping", tu.CallOptions{Platform: "android"})
		want := `{"product_entitlement_mapping":{"pro:monthly":{"product_identifier":"pro","base_plan_id":"monthly","entitlements":["pro"]},"pro:annual":{"product_identifier":"pro","base_plan_id":"annual","entitlements":["pro","annual_perks"]},"lifetime":{"product_identifier":"lifetime","base_plan_id":null,"entitlements":["pro"]}}}`
		if string(android.Body) != want {
			t.Fatalf("android\n got: %s\nwant: %s", android.Body, want)
		}
	})

	t.Run("answers remote config with 204", func(t *testing.T) {
		res := env.Call("/v1/config/app", tu.CallOptions{Body: jsobj.New("app_user_id", "u1", "fetch_context", "app_start")})
		if res.Status != 204 || len(res.Body) != 0 {
			t.Fatal(res.Status)
		}
	})

	t.Run("accepts attributes, events, diagnostics and aliases with 200", func(t *testing.T) {
		for _, c := range []struct {
			path string
			body any
		}{
			{"/v1/subscribers/u1/attributes", jsobj.New("attributes", jsobj.New())},
			{"/v1/events", jsobj.New("events", []any{})},
			{"/v1/diagnostics", jsobj.New("entries", []any{})},
			{"/v1/subscribers/u1/alias", jsobj.New("new_app_user_id", "x")},
		} {
			res := env.Call(c.path, tu.CallOptions{Body: c.body})
			if res.Status != 200 || string(res.Body) != "{}" {
				t.Errorf("%s: %d %s", c.path, res.Status, res.Body)
			}
		}
	})
}

func TestReceiptsAreNotRecordedYet(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	res := env.Call("/v1/receipts", tu.CallOptions{Body: jsobj.New("app_user_id", "u1")})
	if res.Status != 400 || prop(res.JSON(t), "code") != 7226.0 {
		t.Fatalf("%d %s", res.Status, res.Body)
	}
	// A 5xx keeps the purchase queued on the device until purchases are supported.
	res = env.Call("/v1/receipts", tu.CallOptions{Body: jsobj.New("app_user_id", "u1", "fetch_token", "eyJ.x.y")})
	if res.Status != 503 || prop(res.JSON(t), "code") != 7110.0 {
		t.Fatalf("%d %s", res.Status, res.Body)
	}
	if env.Count("customer") != 0 {
		t.Fatal("nothing should be written")
	}
}

func TestCustomerInfoFromTheLedger(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	now := env.Clock.Now()

	t.Run("grants the entitlement of an App Store subscription", func(t *testing.T) {
		env.Purchase("default", tu.Anon, tu.Tx{ProductID: "pro_monthly", TransactionID: "1001", PriceMicros: tu.Ms(9_990_000)})
		res := env.Call("/v1/subscribers/"+tu.Anon, tu.CallOptions{})
		body := res.JSON(t)
		expectValidCustomerInfo(t, body)
		if got := jsobj.Stringify(prop(body, "subscriber", "entitlements")); got != `{"pro":{"expires_date":"2027-02-13T08:00:00Z","grace_period_expires_date":null,"product_identifier":"pro_monthly","purchase_date":"2027-01-14T08:00:00Z"}}` {
			t.Fatal(got)
		}
		sub := prop(body, "subscriber", "subscriptions", "pro_monthly")
		if prop(sub, "store") != "app_store" || prop(sub, "is_sandbox") != true || prop(sub, "store_transaction_id") != "1001" ||
			jsobj.Stringify(prop(sub, "price")) != `{"amount":9.99,"currency":"USD"}` {
			t.Fatal(jsobj.Stringify(sub))
		}
		if prop(body, "subscriber", "management_url") != "https://apps.apple.com/account/subscriptions" {
			t.Fatal(prop(body, "subscriber", "management_url"))
		}
		// Computed from the ledger (no snapshot yet), so no ETag.
		if res.Header.Get("ETag") != "" {
			t.Fatal("unexpected ETag")
		}
	})

	t.Run("lifetime beats any subscription; the furthest expiry wins otherwise", func(t *testing.T) {
		env.Purchase("default", "u-pick", tu.Tx{ProductID: "pro_monthly", ExpiresAt: tu.Ms(now + 10*tu.Day)})
		env.Purchase("default", "u-pick", tu.Tx{ProductID: "pro_annual", ExpiresAt: tu.Ms(now + 300*tu.Day)})
		body := env.Call("/v1/subscribers/u-pick", tu.CallOptions{}).JSON(t)
		if prop(body, "subscriber", "entitlements", "pro", "product_identifier") != "pro_annual" ||
			prop(body, "subscriber", "entitlements", "annual_perks", "product_identifier") != "pro_annual" {
			t.Fatal(jsobj.Stringify(body))
		}
		env.Purchase("default", "u-pick", tu.Tx{ProductID: "lifetime", ProductType: "non_consumable"})
		body = env.Call("/v1/subscribers/u-pick", tu.CallOptions{}).JSON(t)
		pro := prop(body, "subscriber", "entitlements", "pro")
		if prop(pro, "product_identifier") != "lifetime" || prop(pro, "expires_date") != nil {
			t.Fatal(jsobj.Stringify(pro))
		}
	})

	t.Run("ends a refunded subscription at the refund time and drops refunded one-time purchases", func(t *testing.T) {
		revoked := now - 3*tu.Day
		env.Purchase("default", "u-refund", tu.Tx{ProductID: "pro_monthly", PurchasedAt: now - 5*tu.Day, RevokedAt: tu.Ms(revoked)})
		env.Purchase("default", "u-refund", tu.Tx{ProductID: "lifetime", ProductType: "non_consumable", RevokedAt: tu.Ms(now)})
		body := env.Call("/v1/subscribers/u-refund", tu.CallOptions{}).JSON(t)
		iso := customerinfo.ISO(revoked)
		sub := prop(body, "subscriber", "subscriptions", "pro_monthly")
		if prop(sub, "refunded_at") != iso || prop(sub, "expires_date") != iso || prop(body, "subscriber", "entitlements", "pro", "expires_date") != iso {
			t.Fatal(jsobj.Stringify(body))
		}
		if jsobj.Stringify(prop(body, "subscriber", "non_subscriptions")) != "{}" || prop(body, "subscriber", "management_url") != nil {
			t.Fatal(jsobj.Stringify(body))
		}
	})

	t.Run("echoes a consumable's store_transaction_id", func(t *testing.T) {
		env.Purchase("default", "u-coins", tu.Tx{ProductID: "coins_100", ProductType: "consumable", TransactionID: "7777"})
		body := env.Call("/v1/subscribers/u-coins", tu.CallOptions{}).JSON(t)
		expectValidCustomerInfo(t, body)
		list := prop(body, "subscriber", "non_subscriptions", "coins_100").([]any)
		if prop(list[0], "store_transaction_id") != "7777" || jsobj.Stringify(prop(body, "subscriber", "entitlements")) != "{}" {
			t.Fatal(jsobj.Stringify(body))
		}
	})

	t.Run("keys Play subscriptions by product with the base plan", func(t *testing.T) {
		env.Purchase("default", "u-play", tu.Tx{AppID: "android", Store: "play_store", ProductID: "pro", BasePlanID: tu.Str("annual"), TransactionID: "GPA.1", OriginalTransactionID: "token-1"})
		body := env.Call("/v1/subscribers/u-play", tu.CallOptions{Platform: "android"}).JSON(t)
		expectValidCustomerInfo(t, body)
		if prop(body, "subscriber", "subscriptions", "pro", "product_plan_identifier") != "annual" ||
			prop(body, "subscriber", "entitlements", "pro", "product_plan_identifier") != "annual" ||
			prop(body, "subscriber", "entitlements", "annual_perks") == nil {
			t.Fatal(jsobj.Stringify(body))
		}
		if prop(body, "subscriber", "management_url") != "https://play.google.com/store/account/subscriptions?sku=pro&package=com.example.openpurr" {
			t.Fatal(prop(body, "subscriber", "management_url"))
		}
	})

	t.Run("keeps expired entitlements, with their past expiry", func(t *testing.T) {
		env.Purchase("default", "u-expired", tu.Tx{ProductID: "pro_monthly", PurchasedAt: now - 60*tu.Day})
		body := env.Call("/v1/subscribers/u-expired", tu.CallOptions{}).JSON(t)
		if prop(body, "subscriber", "entitlements", "pro", "expires_date") != customerinfo.ISO(now-30*tu.Day) || prop(body, "subscriber", "management_url") != nil {
			t.Fatal(jsobj.Stringify(body))
		}
	})

	t.Run("shows promotional grants", func(t *testing.T) {
		id := env.Purchase("default", "u-grant", tu.Tx{ProductID: "pro_monthly", ExpiresAt: tu.Ms(now + 5*tu.Day)})
		env.Exec(`INSERT INTO promotional_grant (id, customer_id, entitlement_id, duration, starts_at, expires_at, source, created_at)
			VALUES ('g1', $1, 'pro', 'yearly', $2, $3, 'dashboard', $2)`, id, now, now+365*tu.Day)
		body := env.Call("/v1/subscribers/u-grant", tu.CallOptions{}).JSON(t)
		expectValidCustomerInfo(t, body)
		if prop(body, "subscriber", "entitlements", "pro", "product_identifier") != "rc_promo_pro_yearly" ||
			prop(body, "subscriber", "subscriptions", "rc_promo_pro_yearly", "store") != "promotional" {
			t.Fatal(jsobj.Stringify(body))
		}
	})
}

func TestCustomersAndLogIn(t *testing.T) {
	env := tu.Start(t, tu.Options{})

	t.Run("logIn: 201 for a new user, 200 after; anonymous purchases come along", func(t *testing.T) {
		env.Purchase("default", tu.Anon, tu.Tx{ProductID: "lifetime", ProductType: "non_consumable"})
		first := env.Call("/v1/subscribers/identify", tu.CallOptions{Body: jsobj.New("app_user_id", tu.Anon, "new_app_user_id", "user@example")})
		if first.Status != 201 {
			t.Fatal(first.Status)
		}
		body := first.JSON(t)
		expectValidCustomerInfo(t, body)
		if prop(body, "subscriber", "entitlements", "pro", "product_identifier") != "lifetime" {
			t.Fatal(string(first.Body))
		}
		// The anonymous ID was aliased, so it's still the original.
		if prop(body, "subscriber", "original_app_user_id") != tu.Anon {
			t.Fatal(string(first.Body))
		}
		// The response comes from a fresh snapshot.
		if !regexp.MustCompile(`^"[0-9a-f]{24}"$`).MatchString(first.Header.Get("ETag")) {
			t.Fatalf("ETag %q", first.Header.Get("ETag"))
		}
		again := env.Call("/v1/subscribers/identify", tu.CallOptions{Body: jsobj.New("app_user_id", tu.Anon, "new_app_user_id", "user@example")})
		if again.Status != 200 {
			t.Fatal(again.Status)
		}
		// Both IDs see the same purchases, now from the snapshot (with its ETag).
		viaAnon := env.Call("/v1/subscribers/"+url.PathEscape(tu.Anon), tu.CallOptions{})
		if prop(viaAnon.JSON(t), "subscriber", "entitlements", "pro", "product_identifier") != "lifetime" {
			t.Fatal(string(viaAnon.Body))
		}
		if viaAnon.Header.Get("ETag") != first.Header.Get("ETag") {
			t.Fatalf("ETag %q, want %q", viaAnon.Header.Get("ETag"), first.Header.Get("ETag"))
		}
	})

	t.Run("logIn to an existing account merges the anonymous user's purchases into it", func(t *testing.T) {
		env.Purchase("default", "existing@example", tu.Tx{ProductID: "pro_monthly"})
		anon := "$RCAnonymousID:ffffffffffffffffffffffffffffffff"
		env.Purchase("default", anon, tu.Tx{ProductID: "lifetime", ProductType: "non_consumable"})
		res := env.Call("/v1/subscribers/identify", tu.CallOptions{Body: jsobj.New("app_user_id", anon, "new_app_user_id", "existing@example")})
		if res.Status != 200 {
			t.Fatal(res.Status)
		}
		body := res.JSON(t)
		if prop(body, "subscriber", "original_app_user_id") != "existing@example" ||
			!slices.Equal(keys(prop(body, "subscriber", "subscriptions")), []string{"pro_monthly"}) ||
			!slices.Equal(keys(prop(body, "subscriber", "non_subscriptions")), []string{"lifetime"}) {
			t.Fatal(string(res.Body))
		}
		// The anonymous customer is gone; its ID now points at the account.
		if env.CustomerID("default", anon) != env.CustomerID("default", "existing@example") {
			t.Fatal("anonymous ID not moved")
		}
	})

	t.Run("logIn moves an anonymous user's promotional grants to the account", func(t *testing.T) {
		env.Purchase("default", "grant-account", tu.Tx{ProductID: "coins_100", ProductType: "consumable"})
		anon := "$RCAnonymousID:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
		env.Purchase("default", anon, tu.Tx{ProductID: "coins_100", ProductType: "consumable"})
		now := time.Now().UnixMilli()
		env.Exec(`INSERT INTO promotional_grant (id, customer_id, entitlement_id, duration, starts_at, expires_at, source, created_at)
			VALUES ('grant-1', $1, 'pro', 'weekly', $2, $3, 'api', $2)`, env.CustomerID("default", anon), now, now+7*86_400_000)
		res := env.Call("/v1/subscribers/identify", tu.CallOptions{Body: jsobj.New("app_user_id", anon, "new_app_user_id", "grant-account")})
		if res.Status != 200 || prop(res.JSON(t), "subscriber", "entitlements", "pro", "product_identifier") != "rc_promo_pro_weekly" {
			t.Fatalf("%d %s", res.Status, res.Body)
		}
	})

	t.Run("a named user logging in to another account keeps their own purchases", func(t *testing.T) {
		env.Purchase("default", "alice", tu.Tx{ProductID: "pro_annual"})
		res := env.Call("/v1/subscribers/identify", tu.CallOptions{Body: jsobj.New("app_user_id", "alice", "new_app_user_id", "bob")})
		if res.Status != 201 || jsobj.Stringify(prop(res.JSON(t), "subscriber", "entitlements")) != "{}" {
			t.Fatalf("%d %s", res.Status, res.Body)
		}
		alice := env.Call("/v1/subscribers/alice", tu.CallOptions{})
		if prop(alice.JSON(t), "subscriber", "entitlements", "pro") == nil {
			t.Fatal(string(alice.Body))
		}
	})

	t.Run("requires both IDs", func(t *testing.T) {
		for _, body := range []any{jsobj.New("app_user_id", "x"), jsobj.New("new_app_user_id", "x"), "not json", jsobj.New("app_user_id", "", "new_app_user_id", "x")} {
			res := env.Call("/v1/subscribers/identify", tu.CallOptions{Body: body})
			if res.Status != 400 || prop(res.JSON(t), "code") != 7226.0 {
				t.Errorf("%v: %d %s", body, res.Status, res.Body)
			}
		}
	})
}

func TestSnapshots(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	now := env.Clock.Now()
	ctx := t.Context()
	cfg, err := env.Loader.Get(ctx)
	if err != nil {
		t.Fatal(err)
	}
	project := cfg.Projects["default"]
	read := func(user string) *customerinfo.Read {
		r, err := customerinfo.ReadCustomerInfo(ctx, env.Pool, project, user, customerinfo.RenderOptions{Now: now, RequestStore: "app_store"})
		if err != nil {
			t.Fatal(err)
		}
		return r
	}

	t.Run("serve reads from one row, identical to computing from the ledger", func(t *testing.T) {
		id := env.Purchase("default", "snap-1", tu.Tx{ProductID: "pro_annual", ExpiresAt: tu.Ms(now + 300*tu.Day)})
		computed := read("snap-1")
		if computed.Source != customerinfo.FromComputed {
			t.Fatal(computed.Source)
		}
		fresh, err := customerinfo.Refresh(ctx, env.Pool, cfg, id, now)
		if err != nil || fresh == nil {
			t.Fatal(err)
		}
		fromSnapshot := read("snap-1")
		if fromSnapshot.Source != customerinfo.FromSnapshot || fromSnapshot.ETag != fresh.ETag {
			t.Fatal(fromSnapshot.Source)
		}
		if jsobj.Stringify(fromSnapshot.Body) != jsobj.Stringify(computed.Body) {
			t.Fatal("snapshot and computed bodies differ")
		}
		res := env.Call("/v1/subscribers/snap-1", tu.CallOptions{})
		if res.Header.Get("ETag") != fresh.ETag || res.Status != 200 {
			t.Fatal(res.Header.Get("ETag"))
		}
	})

	t.Run("change their ETag when CustomerInfo changes", func(t *testing.T) {
		id := env.Purchase("default", "snap-etag", tu.Tx{ProductID: "pro_monthly"})
		a, _ := customerinfo.Refresh(ctx, env.Pool, cfg, id, now)
		env.PurchaseFor(id, tu.Tx{ProductID: "lifetime", ProductType: "non_consumable"})
		b, _ := customerinfo.Refresh(ctx, env.Pool, cfg, id, now)
		if a.ETag == b.ETag {
			t.Fatal("same ETag")
		}
	})

	t.Run("are recomputed, not served, when the config changes", func(t *testing.T) {
		id := env.Purchase("default", "snap-config", tu.Tx{ProductID: "pro_annual", ExpiresAt: tu.Ms(now + 300*tu.Day)})
		if _, err := customerinfo.Refresh(ctx, env.Pool, cfg, id, now); err != nil {
			t.Fatal(err)
		}
		changed := cfg.Document.Clone()
		ents := prop(changed, "projects", "default", "entitlements").(*jsobj.Object)
		ents.Delete("annual_perks")
		next, _, err := saveAndLoad(t, env, changed)
		if err != nil {
			t.Fatal(err)
		}
		np := next.Projects["default"]
		if np.Version == project.Version {
			t.Fatal("version didn't change")
		}
		r, err := customerinfo.ReadCustomerInfo(ctx, env.Pool, np, "snap-config", customerinfo.RenderOptions{Now: now})
		if err != nil {
			t.Fatal(err)
		}
		if r.Source != customerinfo.FromComputed || !slices.Equal(keys(prop(r.Body, "subscriber", "entitlements")), []string{"pro"}) {
			t.Fatal(r.Source, jsobj.Stringify(r.Body))
		}
	})

	t.Run("make an unknown user's read empty", func(t *testing.T) {
		r := read("snap-nobody")
		if r.Source != customerinfo.FromEmpty || jsobj.Stringify(prop(r.Body, "subscriber", "entitlements")) != "{}" {
			t.Fatal(r.Source)
		}
	})
}
