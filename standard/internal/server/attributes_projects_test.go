package server_test

// Subscriber attributes, projects, intro eligibility and experiments. Mirrors
// lite/test/attributes.test.ts, projects.test.ts, intro-eligibility.test.ts and the SDK side of
// experiments.test.ts.

import (
	"fmt"
	"net/url"
	"slices"
	"sort"
	"strings"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
	"github.com/openpurr/openpurr/standard/internal/testdata"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

func setAttributes(env *tu.Env, user, attributes string) *tu.Response {
	return env.Call("/v1/subscribers/"+url.PathEscape(user)+"/attributes", tu.CallOptions{Body: `{"attributes":` + attributes + `}`})
}

func attributesOf(t *testing.T, env *tu.Env, user string) string {
	t.Helper()
	id := env.CustomerID("default", user)
	if id == "" {
		return "{}"
	}
	attrs, err := ledger.ReadAttributes(t.Context(), env.Pool, id)
	if err != nil {
		t.Fatal(err)
	}
	return jsobj.Stringify(attrs)
}

func TestAttributes(t *testing.T) {
	env := tu.Start(t, tu.Options{})

	t.Run("stores what the SDK syncs", func(t *testing.T) {
		res := setAttributes(env, "attr-1", `{"$email":{"value":"a@example.com","updated_at_ms":1000},"plan_interest":{"value":"annual","updated_at_ms":1000}}`)
		if res.Status != 200 {
			t.Fatal(res.Status)
		}
		if got := attributesOf(t, env, "attr-1"); got != `{"$email":{"value":"a@example.com","updated_at_ms":1000},"plan_interest":{"value":"annual","updated_at_ms":1000}}` {
			t.Fatal(got)
		}
	})

	t.Run("keeps the newest value when syncs arrive out of order", func(t *testing.T) {
		setAttributes(env, "attr-2", `{"$email":{"value":"new@example.com","updated_at_ms":2000}}`)
		setAttributes(env, "attr-2", `{"$email":{"value":"old@example.com","updated_at_ms":1000}}`)
		if got := attributesOf(t, env, "attr-2"); !strings.Contains(got, "new@example.com") {
			t.Fatal(got)
		}
	})

	t.Run("clears an attribute sent as an empty string, and an older value can't bring it back", func(t *testing.T) {
		setAttributes(env, "attr-3", `{"$displayName":{"value":"Sam","updated_at_ms":1000}}`)
		setAttributes(env, "attr-3", `{"$displayName":{"value":"","updated_at_ms":2000}}`)
		setAttributes(env, "attr-3", `{"$displayName":{"value":"Sam","updated_at_ms":1500}}`)
		if got := attributesOf(t, env, "attr-3"); got != "{}" {
			t.Fatal(got)
		}
	})

	t.Run("never overwrites attribution data once set", func(t *testing.T) {
		setAttributes(env, "attr-4", `{"$mediaSource":{"value":"facebook","updated_at_ms":1000}}`)
		setAttributes(env, "attr-4", `{"$mediaSource":{"value":"tiktok","updated_at_ms":5000}}`)
		if got := attributesOf(t, env, "attr-4"); !strings.Contains(got, "facebook") {
			t.Fatal(got)
		}
	})

	t.Run("stores the valid attributes and reports the invalid ones with 400 / 7263", func(t *testing.T) {
		res := setAttributes(env, "attr-5", fmt.Sprintf(`{"good_key":{"value":"ok","updated_at_ms":1},"bad key":{"value":"x","updated_at_ms":1},"1starts_with_digit":{"value":"x","updated_at_ms":1},"long_value":{"value":"%s","updated_at_ms":1},"num":{"value":5}}`, strings.Repeat("x", 501)))
		if res.Status != 400 || prop(res.JSON(t), "code") != 7263.0 {
			t.Fatal(res.Status, string(res.Body))
		}
		var names []string
		for _, e := range prop(res.JSON(t), "attribute_errors").([]any) {
			names = append(names, prop(e, "key_name").(string))
		}
		sort.Strings(names)
		if !slices.Equal(names, []string{"1starts_with_digit", "bad key", "long_value", "num"}) {
			t.Fatal(names)
		}
		if got := attributesOf(t, env, "attr-5"); got != `{"good_key":{"value":"ok","updated_at_ms":1}}` {
			t.Fatal(got)
		}
	})

	t.Run("allows at most 50 custom attributes, but reserved keys and updates still work", func(t *testing.T) {
		parts := make([]string, 50)
		for i := range parts {
			parts[i] = fmt.Sprintf(`"k%d":{"value":"v","updated_at_ms":1}`, i)
		}
		if res := setAttributes(env, "attr-6", "{"+strings.Join(parts, ",")+"}"); res.Status != 200 {
			t.Fatal(res.Status)
		}
		res := setAttributes(env, "attr-6", `{"k51":{"value":"v","updated_at_ms":2},"k0":{"value":"updated","updated_at_ms":2},"$email":{"value":"e@example.com","updated_at_ms":2}}`)
		if res.Status != 400 || jsobj.Stringify(prop(res.JSON(t), "attribute_errors")) != `[{"key_name":"k51","message":"Customers can have at most 50 custom attributes."}]` {
			t.Fatal(res.Status, string(res.Body))
		}
		got := attributesOf(t, env, "attr-6")
		if !strings.Contains(got, `"k0":{"value":"updated"`) || !strings.Contains(got, "e@example.com") || strings.Contains(got, `"k51"`) {
			t.Fatal(got)
		}
	})

	t.Run("merge with the account on logIn, newest value winning per key", func(t *testing.T) {
		anon := "$RCAnonymousID:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
		setAttributes(env, "attr-account", `{"$email":{"value":"old@example.com","updated_at_ms":1000},"plan":{"value":"free","updated_at_ms":1000}}`)
		setAttributes(env, anon, `{"$email":{"value":"new@example.com","updated_at_ms":2000},"onboarding":{"value":"done","updated_at_ms":2000}}`)
		env.Call("/v1/subscribers/identify", tu.CallOptions{Body: jsobj.New("app_user_id", anon, "new_app_user_id", "attr-account")})
		if got := attributesOf(t, env, "attr-account"); got != `{"$email":{"value":"new@example.com","updated_at_ms":2000},"onboarding":{"value":"done","updated_at_ms":2000},"plan":{"value":"free","updated_at_ms":1000}}` {
			t.Fatal(got)
		}
	})

	t.Run("rejects a body that isn't JSON, and ignores missing attributes", func(t *testing.T) {
		if res := env.Call("/v1/subscribers/attr-8/attributes", tu.CallOptions{Body: "nope"}); res.Status != 400 || prop(res.JSON(t), "code") != 7226.0 {
			t.Fatal(res.Status)
		}
		if res := env.Call("/v1/subscribers/attr-8/attributes", tu.CallOptions{Body: "[]"}); res.Status != 200 {
			t.Fatal(res.Status)
		}
		if res := env.Call("/v1/subscribers/attr-8/attributes", tu.CallOptions{Body: `{"attributes":[1]}`}); res.Status != 400 ||
			jsobj.Stringify(prop(res.JSON(t), "attribute_errors")) != `[{"key_name":"","message":"attributes must be an object"}]` {
			t.Fatal(res.Status, string(res.Body))
		}
		if env.CustomerID("default", "attr-8") != "" {
			t.Fatal("no customer for nothing stored")
		}
	})
}

func twoProjects() any {
	g := testdata.Load()
	for _, c := range g.ConfigCases {
		if c.Name == "two_projects" {
			return testdata.Value(c.Document)
		}
	}
	panic("two_projects missing")
}

const (
	roseKey = "appl_rose_ios_0123456789"
	goldKey = "appl_gold_ios_0123456789"
)

func TestProjectsOnTheSDKAPI(t *testing.T) {
	env := tu.Start(t, tu.Options{Config: twoProjects()})
	now := env.Clock.Now()

	t.Run("keeps the same app user ID in two projects as two customers", func(t *testing.T) {
		env.Purchase("rose", "user_123", tu.Tx{AppID: "rose_ios", ProductID: "rose_monthly", ExpiresAt: tu.Ms(now + 20*tu.Day)})
		rose := env.Call("/v1/subscribers/user_123", tu.CallOptions{Key: tu.Key(roseKey)})
		if !slices.Equal(keys(prop(rose.JSON(t), "subscriber", "entitlements")), []string{"pro"}) {
			t.Fatal(string(rose.Body))
		}
		gold := env.Call("/v1/subscribers/user_123", tu.CallOptions{Key: tu.Key(goldKey)})
		if jsobj.Stringify(prop(gold.JSON(t), "subscriber", "entitlements")) != "{}" {
			t.Fatal(string(gold.Body))
		}
		env.Call("/v1/subscribers/user_123/attributes", tu.CallOptions{Key: tu.Key(goldKey), Body: `{"attributes":{"$email":{"value":"g@example.com","updated_at_ms":1}}}`})
		rows, err := env.Pool.Query(t.Context(), "SELECT c.project_id FROM customer_alias a JOIN customer c ON c.id = a.customer_id WHERE a.app_user_id = 'user_123' ORDER BY c.project_id")
		if err != nil {
			t.Fatal(err)
		}
		var projects []string
		for rows.Next() {
			var p string
			_ = rows.Scan(&p)
			projects = append(projects, p)
		}
		if !slices.Equal(projects, []string{"gold", "rose"}) {
			t.Fatal(projects)
		}
	})

	t.Run("logs in within the caller's project only", func(t *testing.T) {
		env.Purchase("rose", "rose-buyer", tu.Tx{AppID: "rose_ios", ProductID: "rose_monthly", ExpiresAt: tu.Ms(now + 20*tu.Day)})
		res := env.Call("/v1/subscribers/identify", tu.CallOptions{Key: tu.Key(goldKey), Body: jsobj.New("app_user_id", "$RCAnonymousID:gold0000000000000000000000000000", "new_app_user_id", "rose-buyer")})
		if res.Status != 201 || jsobj.Stringify(prop(res.JSON(t), "subscriber", "entitlements")) != "{}" {
			t.Fatal(res.Status, string(res.Body))
		}
	})

	t.Run("serves each project's offerings", func(t *testing.T) {
		rose := env.Call("/v1/subscribers/anyone/offerings", tu.CallOptions{Key: tu.Key(roseKey)})
		gold := env.Call("/v1/subscribers/anyone/offerings", tu.CallOptions{Key: tu.Key(goldKey)})
		if prop(rose.JSON(t), "current_offering_id") != "rose_ios_default" || prop(gold.JSON(t), "current_offering_id") != "gold_ios_default" {
			t.Fatal(string(rose.Body), string(gold.Body))
		}
		if offerings := prop(gold.JSON(t), "offerings").([]any); len(offerings) != 1 || prop(offerings[0], "identifier") != "gold_ios_default" {
			t.Fatal(string(gold.Body))
		}
	})

	t.Run("lets a secret key read only its own project's customers", func(t *testing.T) {
		env.Purchase("rose", "secret-test", tu.Tx{AppID: "rose_ios", ProductID: "rose_monthly", ExpiresAt: tu.Ms(now + 20*tu.Day)})
		roseSecret, _ := createKey(t, env, keyOpts{project: "rose"})
		goldSecret, _ := createKey(t, env, keyOpts{project: "gold"})
		rose := serverGet(env, "secret-test", roseSecret, nil)
		if !slices.Equal(keys(prop(rose.JSON(t), "subscriber", "entitlements")), []string{"pro"}) {
			t.Fatal(string(rose.Body))
		}
		gold := serverGet(env, "secret-test", goldSecret, nil)
		if jsobj.Stringify(prop(gold.JSON(t), "subscriber", "entitlements")) != "{}" {
			t.Fatal(string(gold.Body))
		}
	})
}

func eligibility(env *tu.Env, user string, products []string, token, platform string) string {
	list := make([]any, len(products))
	for i, p := range products {
		list[i] = p
	}
	res := env.Call("/v1/subscribers/"+user+"/intro_eligibility", tu.CallOptions{Platform: platform, Body: jsobj.New("product_identifiers", list, "fetch_token", token)})
	return string(res.Body)
}

func TestIntroEligibility(t *testing.T) {
	env := tu.Start(t, tu.Options{})

	t.Run("is true for a new customer when the product's group is known, and null otherwise", func(t *testing.T) {
		if got := eligibility(env, "elig-new", []string{"pro_annual", "pro_monthly", "lifetime", "nonexistent"}, "", ""); got != `{"pro_annual":true,"pro_monthly":null,"lifetime":null,"nonexistent":null}` {
			t.Fatal(got)
		}
	})

	t.Run("is false once the customer has subscribed to anything in the same group", func(t *testing.T) {
		env.Purchase("default", "elig-subscriber", tu.Tx{ProductID: "pro_monthly", SubscriptionGroup: tu.Str("21000000")})
		if got := eligibility(env, "elig-subscriber", []string{"pro_annual", "pro_monthly"}, "", ""); got != `{"pro_annual":false,"pro_monthly":false}` {
			t.Fatal(got)
		}
		// Someone else is still eligible, and now pro_monthly's group is known for them too.
		if got := eligibility(env, "elig-other", []string{"pro_annual", "pro_monthly"}, "", ""); got != `{"pro_annual":true,"pro_monthly":true}` {
			t.Fatal(got)
		}
	})

	t.Run("uses the receipt's purchases to answer ineligible before they reach the ledger", func(t *testing.T) {
		receipt := tu.BuildAppReceipt("", []tu.ReceiptInApp{{ProductID: "pro_annual", TransactionID: "4000000001"}}, false)
		if got := eligibility(env, "elig-receipt", []string{"pro_annual"}, receipt, ""); got != `{"pro_annual":false}` {
			t.Fatal(got)
		}
		// A malformed receipt just means less information.
		if got := eligibility(env, "elig-receipt-2", []string{"pro_annual"}, "not-a-receipt", ""); got != `{"pro_annual":true}` {
			t.Fatal(got)
		}
	})

	t.Run("answers unknown for Google Play apps", func(t *testing.T) {
		if got := eligibility(env, "elig-android", []string{"pro"}, "", "android"); got != `{"pro":null}` {
			t.Fatal(got)
		}
	})
}

func TestOfferingsInARunningExperiment(t *testing.T) {
	raw := testdata.TestConfig().(*jsobj.Object)
	offerings, _ := raw.Get("offerings")
	alt := jsobj.CloneValue(offerings.([]any)[0]).(*jsobj.Object)
	alt.Set("id", "cheaper")
	alt.Delete("current")
	raw.Set("offerings", append(offerings.([]any), alt))
	env := tu.Start(t, tu.Options{Config: raw})
	now := env.Clock.Now()

	// An existing customer from before the experiment keeps the current offering.
	env.Purchase("default", "old-customer", tu.Tx{})
	env.Exec(`INSERT INTO experiment (id, project_id, name, variants, status, created_at, started_at)
		VALUES ('exp_1', 'default', 'Price test', '[{"id":"a","offering_id":"default","weight":0},{"id":"b","offering_id":"cheaper","weight":100}]', 'running', $1, $2)`, now, now+1)

	res := env.Call("/v1/subscribers/old-customer/offerings", tu.CallOptions{})
	if prop(res.JSON(t), "current_offering_id") != "default" {
		t.Fatal(string(res.Body))
	}
	res = env.Call("/v1/subscribers/new-person/offerings", tu.CallOptions{})
	if prop(res.JSON(t), "current_offering_id") != "cheaper" || len(prop(res.JSON(t), "offerings").([]any)) != 2 {
		t.Fatal(string(res.Body))
	}
	var variant string
	if err := env.Pool.QueryRow(t.Context(), "SELECT variant FROM experiment_enrollment WHERE app_user_id = 'new-person'").Scan(&variant); err != nil || variant != "b" {
		t.Fatal(variant, err)
	}
	if env.Count("experiment_enrollment") != 1 {
		t.Fatal("only new customers enroll")
	}
}

func TestPickVariantMatchesLite(t *testing.T) {
	// Lite's pickVariant("exp_1", who, 50/50) for these IDs (computed with lite/src/experiments.ts).
	variants := []ledger.Variant{{ID: "a", OfferingID: "x", Weight: 50}, {ID: "b", OfferingID: "y", Weight: 50}}
	want := map[string]string{"user-1": "b", "user-2": "a", "user-3": "b", "$RCAnonymousID:abc": "b", "émoji😀": "b"}
	for who, w := range want {
		if got := ledger.PickVariant("exp_1", who, variants).ID; got != w {
			t.Errorf("%s: %s, want %s", who, got, w)
		}
	}
}
