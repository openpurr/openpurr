package server_test

// Importing purchases (lite/test/import.test.ts) and price experiments in the admin API (the admin
// parts of lite/test/experiments.test.ts).

import (
	"slices"
	"strings"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/apple"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/testdata"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

func importRow(env *tu.Env, token string, row *jsobj.Object, extra ...any) *tu.Response {
	body := jsobj.New("row", row)
	for i := 0; i+1 < len(extra); i += 2 {
		body.Set(extra[i].(string), extra[i+1])
	}
	return env.Admin("POST", "/import", tu.Auth{Token: token}, body)
}

func TestImportAppStore(t *testing.T) {
	env, fake := appleAPIEnv(t)
	token := env.OwnerToken()
	appleHistory(env, fake, env.Clock.Now()+200*tu.Day, apple.StatusActive, 0)

	t.Run("reports what would happen on a dry run, writing nothing", func(t *testing.T) {
		res := expectStatus(t, importRow(env, token, jsobj.New("app_user_id", "rc-user", "transaction_id", "3000000001"), "dry_run", true), 200)
		if res.Get(t, "dry_run") != true || res.Get(t, "created") != true || env.CustomerID("default", "rc-user") != "" {
			t.Fatalf("%s", res.Body)
		}
	})

	t.Run("asks Apple for the customer's history and makes the row's app user the owner", func(t *testing.T) {
		row := jsobj.New("app_user_id", "rc-user", "transaction_id", "3000000001", "aliases", "rc-alias|rc-user",
			"attributes", jsobj.New("$email", "rc@example.com", "empty", ""), "first_seen", "1600000000")
		res := expectStatus(t, importRow(env, token, row), 200)
		// The lifetime purchase's original transaction ID is the fixture's next ID.
		lifetimeChain := res.Get(t, "transaction_ids").([]any)[1].(string)
		want := `{"app_user_id":"rc-user","app_id":"ios","dry_run":false,"created":true,"transactions":2,` +
			`"transaction_ids":["3000000002","` + lifetimeChain + `","3000000001","3000000000"],"kept_owner":[],"skipped_products":["discontinued_product"],` +
			`"aliases_added":["rc-alias"],"aliases_skipped":[],"attributes":1}`
		if string(res.Body) != want {
			t.Errorf("\n got %s\nwant %s", res.Body, want)
		}
		var firstSeen int64
		env.QueryRow("SELECT first_seen FROM customer WHERE app_user_id = 'rc-user'", nil, &firstSeen)
		if firstSeen != 1_600_000_000_000 {
			t.Errorf("first_seen %d", firstSeen)
		}
		sdk := env.Call("/v1/subscribers/rc-alias", tu.CallOptions{})
		if sdk.Get(t, "subscriber", "entitlements", "pro") == nil {
			t.Errorf("%s", sdk.Body)
		}
		var webhooks int
		env.QueryRow("SELECT count(*) FROM webhook_event", nil, &webhooks)
		var audit string
		env.QueryRow("SELECT details FROM audit_log WHERE action = 'customers.import'", nil, &audit)
		if webhooks != 0 || audit != `{"project":"default","store":null,"app":null}` {
			t.Errorf("%d %s", webhooks, audit)
		}
	})

	t.Run("is safe to run again", func(t *testing.T) {
		res := expectStatus(t, importRow(env, token, jsobj.New("app_user_id", "rc-user", "transaction_id", "3000000001")), 200)
		if res.Get(t, "created") != false || jsobj.Stringify(res.Get(t, "kept_owner")) != "[]" {
			t.Errorf("%s", res.Body)
		}
	})

	t.Run("never takes a purchase away from its owner", func(t *testing.T) {
		res := expectStatus(t, importRow(env, token, jsobj.New("app_user_id", "someone-else", "transaction_id", "3000000001")), 200)
		kept := res.Get(t, "kept_owner").([]any)
		if len(kept) != 2 || prop(kept[1], "original_transaction_id") != "3000000000" || prop(kept[0], "app_user_id") != "rc-user" {
			t.Errorf("%s", res.Body)
		}
		if env.Call("/v1/subscribers/someone-else", tu.CallOptions{}).Get(t, "subscriber", "entitlements", "pro") != nil {
			t.Error("transferred")
		}
	})

	t.Run("explains rows it can't import", func(t *testing.T) {
		for _, c := range []struct {
			row    *jsobj.Object
			status int
			code   string
		}{
			{jsobj.New("app_user_id", "x", "transaction_id", "404404"), 422, "not_found_at_store"},
			{jsobj.New("transaction_id", "1"), 400, "bad_row"},
			{jsobj.New("app_user_id", "x", "transaction_id", "1", "purchase_token", "t"), 400, "bad_row"},
			{jsobj.New("app_user_id", "x", "store", "amazon", "transaction_id", "1"), 400, "bad_row"},
			{jsobj.New("app_user_id", "x", "store", "google", "transaction_id", "GPA.1"), 400, "bad_row"},
			{jsobj.New("app_user_id", "x", "transaction_id", "1", "first_seen", "yesterday"), 400, "bad_row"},
			{jsobj.New("app_user_id", "x", "transaction_id", "1", "aliases", strs("a", "b", "c", "d", "e", "f")), 400, "bad_row"},
			{jsobj.New("app_user_id", "x", "transaction_id", "1", "attributes", jsobj.New("bad key!", "v")), 400, "bad_row"},
			{jsobj.New("app_user_id", "x", "transaction_id", "1", "app", "nope"), 400, "bad_row"},
			{jsobj.New("app_user_id", "x"), 400, "bad_row"},
			{jsobj.New("app_user_id", "new-person", "aliases", "y"), 422, "no_customer"},
		} {
			res := importRow(env, token, c.row)
			if res.Status != c.status || code(t, res) != c.code {
				t.Errorf("%s: %d %s", jsobj.Stringify(c.row), res.Status, res.Body)
			}
		}
		expectStatus(t, env.Admin("POST", "/import", tu.Auth{Token: token}, jsobj.New("row", "x")), 400)
	})

	t.Run("adds aliases and attributes to an existing customer without overwriting what the app set", func(t *testing.T) {
		setAttributes(env, "rc-user", `{"$email":{"value":"app@example.com","updated_at_ms":5}}`)
		res := expectStatus(t, importRow(env, token, jsobj.New("app_user_id", "rc-user", "aliases", strs("rc-second", "someone-else"), "attributes", jsobj.New("$email", "old@example.com", "plan", "gold"))), 200)
		if jsobj.Stringify(res.Get(t, "aliases_added")) != `["rc-second"]` || jsobj.Stringify(res.Get(t, "aliases_skipped")) != `["someone-else"]` || res.Get(t, "app_id") != nil {
			t.Errorf("%s", res.Body)
		}
		if got := attributesOf(t, env, "rc-user"); !strings.Contains(got, `"$email":{"value":"app@example.com"`) || !strings.Contains(got, `"plan":{"value":"gold","updated_at_ms":1}`) {
			t.Errorf("%s", got)
		}
	})

	t.Run("needs the customers:import permission and all apps", func(t *testing.T) {
		dev := env.CreateOperator(token, "developer", nil)
		expectStatus(t, env.Admin("POST", "/import", tu.Auth{Session: dev.Session}, jsobj.New("row", jsobj.New())), 403)
		limited := env.CreateOperator(token, "admin", []string{"ios"})
		expectStatus(t, env.Admin("POST", "/import", tu.Auth{Session: limited.Session}, jsobj.New("row", jsobj.New())), 403)
	})

	t.Run("stops with 409 when the In-App Purchase key is missing", func(t *testing.T) {
		env := tu.Start(t, tu.Options{Config: withAppleAPI(""), Secrets: map[string]string{}})
		res := importRow(env, env.OwnerToken(), jsobj.New("app_user_id", "x", "transaction_id", "1"))
		if res.Status != 409 || code(t, res) != "store_not_configured" {
			t.Errorf("%d %s", res.Status, res.Body)
		}
	})
}

func TestImportGooglePlay(t *testing.T) {
	env, fake := tu.StartGoogle(t, false)
	token := env.OwnerToken()
	now := env.Clock.Now()
	fake.SetSub("rc-play-token", tu.PlaySubscription(now, tu.PlaySub{BasePlanID: "monthly", OrderID: "GPA.1111-1111-1111-11111"}))
	res := expectStatus(t, importRow(env, token, jsobj.New("app_user_id", "play-user", "purchase_token", "rc-play-token", "product_id", "pro:monthly")), 200)
	if res.Get(t, "app_id") != "android" || res.Get(t, "transactions") != 1.0 {
		t.Fatalf("%s", res.Body)
	}
	if fake.Requested("POST /purchases/subscriptions/pro/tokens/rc-play-token:acknowledge") != 1 {
		t.Errorf("not acknowledged: %v", fake.Requests())
	}
	if env.Call("/v1/subscribers/play-user", tu.CallOptions{Platform: "android"}).Get(t, "subscriber", "entitlements", "pro") == nil {
		t.Error("no entitlement")
	}
	unknown := importRow(env, token, jsobj.New("app_user_id", "play-user", "purchase_token", "t2", "product_id", "gone"))
	if unknown.Status != 422 || code(t, unknown) != "unknown_products" {
		t.Errorf("%s", unknown.Body)
	}
	missing := importRow(env, token, jsobj.New("app_user_id", "play-user", "purchase_token", "t3", "product_id", "pro"))
	if missing.Status != 422 || code(t, missing) != "not_found_at_store" {
		t.Errorf("%s", missing.Body)
	}
}

func TestExperimentsAPI(t *testing.T) {
	env := tu.Start(t, tu.Options{Config: experimentConfig()})
	owner := env.OwnerToken()
	adminOp := env.CreateOperator(owner, "admin", nil)
	viewer := env.CreateOperator(owner, "viewer", nil)
	auth := tu.Auth{Session: adminOp.Session}
	variants := func(pairs ...any) []any {
		var out []any
		for i := 0; i+1 < len(pairs); i += 2 {
			out = append(out, jsobj.New("offering_id", pairs[i], "weight", pairs[i+1]))
		}
		return out
	}
	for body, msg := range map[*jsobj.Object]string{
		jsobj.New("name", "x", "variants", variants("default", 100.0)):                              "2 to 4",
		jsobj.New("name", "x", "variants", variants("default", 50.0, "nope", 50.0)):                 "must be one of the project's offerings: default, higher",
		jsobj.New("name", "x", "variants", variants("default", 50.0, "default", 50.0)):              "two variants",
		jsobj.New("name", "x", "variants", variants("default", 50.5, "higher", 49.5)):               "whole percent",
		jsobj.New("name", "x", "variants", variants("default", 60.0, "higher", 60.0)):               "add up to 120",
		jsobj.New("name", " ", "variants", variants("default", 50.0, "higher", 50.0)):               "name is required",
		jsobj.New("name", "x", "notes", 5.0, "variants", variants("default", 50.0, "higher", 50.0)): "notes must be a string",
	} {
		res := expectStatus(t, env.Admin("POST", "/experiments", auth, body), 400)
		if !strings.Contains(res.Get(t, "message").(string), msg) {
			t.Errorf("%s: %s", msg, res.Body)
		}
	}
	good := jsobj.New("name", " Price test ", "variants", variants("default", 50.0, "higher", 50.0))
	expectStatus(t, env.Admin("POST", "/experiments", tu.Auth{Session: viewer.Session}, good), 403)
	created := expectStatus(t, env.Admin("POST", "/experiments", auth, good), 201)
	id := created.Get(t, "experiment", "id").(string)
	exp := created.Get(t, "experiment").(*jsobj.Object)
	if !strings.HasPrefix(id, "exp_") || len(id) != 20 || prop(exp, "name") != "Price test" || prop(exp, "status") != "draft" ||
		jsobj.Stringify(prop(exp, "variants")) != `[{"id":"a","offering_id":"default","weight":50,"offering_exists":true},{"id":"b","offering_id":"higher","weight":50,"offering_exists":true}]` ||
		!slices.Equal(exp.Keys(), []string{"id", "project_id", "name", "notes", "status", "variants", "created_at", "created_by", "started_at", "stopped_at"}) {
		t.Errorf("%s", created.Body)
	}
	if env.Admin("GET", "/experiments/"+id+"/results", auth, nil).Get(t, "results") != nil {
		t.Error("draft results")
	}
	patched := expectStatus(t, env.Admin("PATCH", "/experiments/"+id, auth, jsobj.New("notes", nil, "variants", variants("default", 30.0, "higher", 70.0))), 200)
	if patched.Get(t, "experiment", "variants").([]any)[1].(*jsobj.Object).Keys()[2] != "weight" || prop(patched.Get(t, "experiment", "variants").([]any)[1], "weight") != 70.0 {
		t.Errorf("%s", patched.Body)
	}
	expectStatus(t, env.Admin("POST", "/experiments/"+id+"/start", auth, jsobj.New()), 200)
	expectStatus(t, env.Admin("POST", "/experiments/"+id+"/start", auth, jsobj.New()), 409)
	expectStatus(t, env.Admin("PATCH", "/experiments/"+id, auth, jsobj.New("variants", variants("default", 50.0, "higher", 50.0))), 409)
	expectStatus(t, env.Admin("PATCH", "/experiments/"+id, auth, jsobj.New("name", "Renamed")), 200)
	second := expectStatus(t, env.Admin("POST", "/experiments", auth, good), 201).Get(t, "experiment", "id").(string)
	other := expectStatus(t, env.Admin("POST", "/experiments/"+second+"/start", auth, jsobj.New()), 409)
	if !strings.Contains(other.Get(t, "message").(string), `"Renamed" is already running`) {
		t.Errorf("%s", other.Body)
	}
	expectStatus(t, env.Admin("DELETE", "/experiments/"+id, auth, nil), 409)

	// Enroll someone and buy: results count them.
	env.Clock.Add(60_000)
	offerings := env.Call("/v1/subscribers/exp-buyer/offerings", tu.CallOptions{})
	current := offerings.Get(t, "current_offering_id").(string)
	env.Clock.Add(60_000)
	env.PostAppleTransaction("exp-buyer", tu.Fields{"productId": "pro_monthly", "price": 9990.0, "currency": "USD",
		"purchaseDate": env.Clock.Now(), "originalPurchaseDate": env.Clock.Now(), "expiresDate": env.Clock.Now() + 30*tu.Day})
	env.Clock.Add(1000)
	list := env.Admin("GET", "/experiments", auth, nil).Get(t, "experiments").([]any)
	if len(list) != 2 || prop(list[slices.IndexFunc(list, func(x any) bool { return prop(x, "id") == id })], "enrolled") != 1.0 {
		t.Errorf("%s", jsobj.Stringify(list))
	}
	results := expectStatus(t, env.Admin("GET", "/experiments/"+id+"/results?environment=sandbox", auth, nil), 200).Get(t, "results")
	variantIdx := 0
	if current == "higher" {
		variantIdx = 1
	}
	v := prop(results, "variants").([]any)[variantIdx]
	if prop(v, "customers") != 1.0 || prop(v, "paying") != 1.0 || prop(v, "active_subscriptions") != 1.0 || prop(results, "environment") != "sandbox" {
		t.Errorf("%s", jsobj.Stringify(results))
	}
	limited := env.CreateOperator(owner, "admin", []string{"ios"})
	expectStatus(t, env.Admin("GET", "/experiments/"+id+"/results", tu.Auth{Session: limited.Session}, nil), 403)
	prod := expectStatus(t, env.Admin("GET", "/experiments/"+id+"/results", auth, nil), 200)
	if prop(prod.Get(t, "results"), "environment") != "production" {
		t.Errorf("%s", prod.Body)
	}

	stopped := expectStatus(t, env.Admin("POST", "/experiments/"+id+"/stop", auth, jsobj.New()), 200)
	if stopped.Get(t, "experiment", "status") != "stopped" {
		t.Errorf("%s", stopped.Body)
	}
	expectStatus(t, env.Admin("POST", "/experiments/"+second+"/start", auth, jsobj.New()), 200)
	expectStatus(t, env.Admin("DELETE", "/experiments/"+id, auth, nil), 200)
	expectStatus(t, env.Admin("GET", "/experiments/"+id, auth, nil), 404)
	var audited int
	env.QueryRow("SELECT count(*) FROM audit_log WHERE action LIKE 'experiment.%'", nil, &audited)
	if audited != 8 {
		t.Errorf("audit %d", audited)
	}
}

// experimentConfig is the test config with a second offering, "higher".
func experimentConfig() any {
	raw := testdata.TestConfig().(*jsobj.Object)
	offerings, _ := raw.Get("offerings")
	alt := jsobj.CloneValue(offerings.([]any)[0]).(*jsobj.Object)
	alt.Set("id", "higher")
	alt.Delete("current")
	raw.Set("offerings", append(offerings.([]any), alt))
	return raw
}
