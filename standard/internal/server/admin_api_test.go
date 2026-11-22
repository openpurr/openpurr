package server_test

// The admin API. Mirrors lite/test/admin-api.test.ts, the admin parts of projects, secret-keys,
// doctor and setup-urls, plus the dashboard's static files and Standard's edition reporting.

import (
	"net/url"
	"slices"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/openpurr/openpurr/standard/internal/jsobj"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

func ids(t *testing.T, list any, key string) []string {
	t.Helper()
	var out []string
	for _, e := range list.([]any) {
		v, _ := jsobj.Prop(e, key)
		out = append(out, v.(string))
	}
	return out
}

func strs(v ...any) []any { return v }

func TestAdminAuthentication(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	owner := env.OwnerToken()

	t.Run("lists the configured apps, limited to the operator's apps", func(t *testing.T) {
		all := expectStatus(t, env.Admin("GET", "/apps", tu.Auth{Session: env.CreateOperator(owner, "viewer", nil).Session}, nil), 200)
		want := `{"id":"ios","project_id":"default","store":"app_store","bundle_id":"com.example.openpurr","package_name":null,"products":["pro_monthly","pro_annual","lifetime","coins_100"]}`
		if got := jsobj.Stringify(all.Get(t, "apps").([]any)[0]); got != want {
			t.Errorf("\n got %s\nwant %s", got, want)
		}
		android := all.Get(t, "apps").([]any)[1]
		if got := jsobj.Stringify(prop(android, "products")); got != `["pro:monthly","pro:annual","lifetime","coins_100"]` {
			t.Errorf("%s", got)
		}
		limited := env.Admin("GET", "/apps", tu.Auth{Session: env.CreateOperator(owner, "viewer", []string{"android"}).Session}, nil)
		if got := ids(t, limited.Get(t, "apps"), "id"); !slices.Equal(got, []string{"android"}) {
			t.Errorf("%v", got)
		}
	})

	t.Run("needs a session or a valid access token", func(t *testing.T) {
		expectStatus(t, env.Admin("GET", "/me", tu.Auth{}, nil), 401)
		expectStatus(t, env.Admin("GET", "/me", tu.Auth{Token: "pat_not-a-real-token"}, nil), 401)
		if c := code(t, env.Admin("GET", "/me", tu.Auth{Token: "oat_whatever"}, nil)); c != "invalid_token" {
			t.Error(c)
		}
		op := env.CreateOperator(owner, "viewer", nil)
		me := env.Admin("GET", "/me", tu.Auth{Session: op.Session}, nil)
		if me.Get(t, "via") != "session" || jsobj.Stringify(me.Get(t, "permissions")) != `["read"]` {
			t.Errorf("%s", me.Body)
		}
		token := env.CreateToken(t, op.Session, "read")
		if env.Admin("GET", "/me", tu.Auth{Token: token}, nil).Get(t, "via") != "token" {
			t.Error("token")
		}
		// Unknown endpoints answer 404 once signed in.
		if c := code(t, env.Admin("GET", "/nope", tu.Auth{Token: token}, nil)); c != "not_found" {
			t.Error(c)
		}
		if c := code(t, env.Admin("GET", "/nope", tu.Auth{}, nil)); c != "signed_out" {
			t.Error(c)
		}
	})

	t.Run("requires same-origin for session writes, but not for tokens", func(t *testing.T) {
		op := env.CreateOperator(owner, "developer", nil)
		if c := code(t, env.Admin("POST", "/secret-keys", tu.Auth{Session: op.Session, Origin: "-"}, jsobj.New("name", "x"))); c != "bad_origin" {
			t.Error(c)
		}
		token := env.CreateToken(t, op.Session, "admin")
		expectStatus(t, env.Admin("POST", "/secret-keys", tu.Auth{Token: token, Origin: "-"}, jsobj.New("name", "x")), 201)
	})

	t.Run("stamps a token's last use at most hourly", func(t *testing.T) {
		op := env.CreateOperator(owner, "viewer", nil)
		token := env.CreateToken(t, op.Session, "read")
		env.Admin("GET", "/me", tu.Auth{Token: token}, nil)
		list := env.Admin("GET", "/tokens", tu.Auth{Session: op.Session}, nil).Get(t, "tokens").([]any)
		if prop(list[0], "last_used_at") != float64(env.Clock.Now()) || prop(list[0], "token_prefix") != token[:10] {
			t.Errorf("%s", jsobj.Stringify(list))
		}
	})
}

func TestRolesAndOperators(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	owner := env.OwnerToken()

	t.Run("lets each role do only its part, and a token only its role AND its scopes", func(t *testing.T) {
		viewer := env.CreateOperator(owner, "viewer", nil)
		developer := env.CreateOperator(owner, "developer", nil)
		expectStatus(t, env.Admin("GET", "/operators", tu.Auth{Session: viewer.Session}, nil), 200)
		res := expectStatus(t, env.Admin("POST", "/secret-keys", tu.Auth{Session: viewer.Session}, jsobj.New("name", "k")), 403)
		if res.Get(t, "message") != "This needs the keys:manage permission." {
			t.Errorf("%s", res.Body)
		}
		expectStatus(t, env.Admin("POST", "/secret-keys", tu.Auth{Session: developer.Session}, jsobj.New("name", "k")), 201)
		expectStatus(t, env.Admin("POST", "/operators", tu.Auth{Session: developer.Session}, jsobj.New("email", "x@example.com", "role", "viewer")), 403)
		expectStatus(t, env.Admin("GET", "/audit", tu.Auth{Session: developer.Session}, nil), 403)
		readOnly := env.CreateToken(t, developer.Session, "read")
		res = expectStatus(t, env.Admin("POST", "/secret-keys", tu.Auth{Token: readOnly}, jsobj.New("name", "k")), 403)
		if !strings.Contains(res.Get(t, "message").(string), "check the token's scopes") {
			t.Errorf("%s", res.Body)
		}
		overScoped := env.CreateToken(t, viewer.Session, "admin")
		expectStatus(t, env.Admin("POST", "/secret-keys", tu.Auth{Token: overScoped}, jsobj.New("name", "k")), 403)
	})

	t.Run("mints tokens only from a session; a token works until revoked", func(t *testing.T) {
		op := env.CreateOperator(owner, "developer", nil)
		created := expectStatus(t, env.Admin("POST", "/tokens", tu.Auth{Session: op.Session}, jsobj.New("name", "cli", "scopes", strs("read"), "expires_in_days", 30.0)), 201)
		token := created.Get(t, "token").(string)
		expectStatus(t, env.Admin("POST", "/tokens", tu.Auth{Token: token}, jsobj.New("name", "x", "scopes", strs("read"))), 403)
		for _, bad := range []*jsobj.Object{jsobj.New("scopes", strs("read")), jsobj.New("name", "x", "scopes", strs("everything")), jsobj.New("name", "x", "scopes", strs("read"), "expires_in_days", 0.0)} {
			expectStatus(t, env.Admin("POST", "/tokens", tu.Auth{Session: op.Session}, bad), 400)
		}
		list := env.Admin("GET", "/tokens", tu.Auth{Session: op.Session}, nil).Get(t, "tokens").([]any)
		if len(list) != 1 || prop(list[0], "expires_at") != float64(env.Clock.Now()+30*tu.Day) {
			t.Errorf("%s", jsobj.Stringify(list))
		}
		expectStatus(t, env.Admin("DELETE", "/tokens/"+created.Get(t, "id").(string), tu.Auth{Session: op.Session}, nil), 200)
		expectStatus(t, env.Admin("GET", "/me", tu.Auth{Token: token}, nil), 401)
		expectStatus(t, env.Admin("DELETE", "/tokens/"+created.Get(t, "id").(string), tu.Auth{Session: op.Session}, nil), 404)
		// Expired tokens stop working.
		short := expectStatus(t, env.Admin("POST", "/tokens", tu.Auth{Session: op.Session}, jsobj.New("name", "x", "scopes", strs("read"), "expires_in_days", 1.0)), 201)
		env.Clock.Add(tu.Day + 1)
		expectStatus(t, env.Admin("GET", "/me", tu.Auth{Token: short.Get(t, "token").(string)}, nil), 401)
	})

	t.Run("admins invite non-owners; only owners add owners", func(t *testing.T) {
		adminOp := env.CreateOperator(owner, "admin", nil)
		invited := expectStatus(t, env.Admin("POST", "/operators", tu.Auth{Session: adminOp.Session}, jsobj.New("email", " New@Example.com ", "role", "developer")), 201)
		if !strings.HasPrefix(invited.Get(t, "setup_link").(string), env.Server.URL+"/admin/link#token=") || invited.Get(t, "setup_link_expires_in_hours") != 24.0 {
			t.Errorf("%s", invited.Body)
		}
		if c := code(t, env.Admin("POST", "/operators", tu.Auth{Session: adminOp.Session}, jsobj.New("email", "new@example.com", "role", "viewer"))); c != "exists" {
			t.Error(c)
		}
		expectStatus(t, env.Admin("POST", "/operators", tu.Auth{Session: adminOp.Session}, jsobj.New("email", "o@example.com", "role", "owner")), 403)
		expectStatus(t, env.Admin("POST", "/operators", tu.Auth{Session: adminOp.Session}, jsobj.New("email", "nope", "role", "viewer")), 400)
		expectStatus(t, env.Admin("POST", "/operators", tu.Auth{Session: adminOp.Session}, jsobj.New("email", "a@example.com", "role", "viewer", "app_ids", strs("not-an-app"))), 400)
		o2 := env.CreateOperator(owner, "owner", nil)
		expectStatus(t, env.Admin("POST", "/operators", tu.Auth{Session: o2.Session}, jsobj.New("email", "o2@example.com", "role", "owner")), 201)
	})
}

func TestLastOwnerAndDisabling(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	ownerToken := env.OwnerToken()
	owner := env.CreateOperator(ownerToken, "owner", nil)
	resetOwner := env.Admin("GET", "/me", tu.Auth{Token: ownerToken}, nil).Get(t, "operator", "id").(string)
	expectStatus(t, env.Admin("PATCH", "/operators/"+resetOwner, tu.Auth{Session: owner.Session}, jsobj.New("disabled", true)), 200)
	expectStatus(t, env.Admin("GET", "/me", tu.Auth{Token: ownerToken}, nil), 401)

	other := expectStatus(t, env.Admin("POST", "/operators", tu.Auth{Session: owner.Session}, jsobj.New("email", "other@example.com", "role", "admin")), 201).Get(t, "id").(string)
	promoted := expectStatus(t, env.Admin("PATCH", "/operators/"+other, tu.Auth{Session: owner.Session}, jsobj.New("role", "owner", "name", "Other")), 200)
	if promoted.Get(t, "operator", "role") != "owner" || promoted.Get(t, "operator", "name") != "Other" || strings.Contains(string(promoted.Body), `"disabled"`) {
		t.Errorf("%s", promoted.Body)
	}
	expectStatus(t, env.Admin("PATCH", "/operators/"+other, tu.Auth{Session: owner.Session}, jsobj.New("role", "admin")), 200)
	expectStatus(t, env.Admin("PATCH", "/operators/"+owner.ID, tu.Auth{Session: owner.Session}, jsobj.New("role", "admin")), 403)
	res := expectStatus(t, env.Admin("PATCH", "/operators/"+owner.ID, tu.Auth{Session: owner.Session}, jsobj.New("disabled", true)), 403)
	if res.Get(t, "message") != "You can't disable yourself." {
		t.Errorf("%s", res.Body)
	}
	expectStatus(t, env.Admin("PATCH", "/operators/"+other, tu.Auth{Session: owner.Session}, jsobj.New()), 400)
	expectStatus(t, env.Admin("PATCH", "/operators/nobody", tu.Auth{Session: owner.Session}, jsobj.New("name", "x")), 404)

	t.Run("disabling ends sessions and revokes tokens; reset issues a new setup link", func(t *testing.T) {
		dev := env.CreateOperator(env.OwnerToken(), "developer", nil)
		token := env.CreateToken(t, dev.Session, "read")
		expectStatus(t, env.Admin("PATCH", "/operators/"+dev.ID, tu.Auth{Session: owner.Session}, jsobj.New("disabled", true)), 200)
		expectStatus(t, env.Admin("GET", "/me", tu.Auth{Session: dev.Session}, nil), 401)
		expectStatus(t, env.Admin("GET", "/me", tu.Auth{Token: token}, nil), 401)
		r, _ := env.Login(dev.Email, tu.Password)
		expectStatus(t, r, 401)
		// Enabling again lets them sign in (the token stays revoked).
		expectStatus(t, env.Admin("PATCH", "/operators/"+dev.ID, tu.Auth{Session: owner.Session}, jsobj.New("disabled", false)), 200)
		r, _ = env.Login(dev.Email, tu.Password)
		expectStatus(t, r, 200)
		expectStatus(t, env.Admin("GET", "/me", tu.Auth{Token: token}, nil), 401)

		dev2 := env.CreateOperator(env.OwnerToken(), "developer", nil)
		reset := expectStatus(t, env.Admin("POST", "/operators/"+dev2.ID+"/reset", tu.Auth{Session: owner.Session}, jsobj.New()), 200)
		for _, o := range env.Admin("GET", "/operators", tu.Auth{Session: owner.Session}, nil).Get(t, "operators").([]any) {
			if prop(o, "id") == dev2.ID && (prop(o, "has_password") != false || prop(o, "totp_enabled") != false || prop(o, "disabled") != false) {
				t.Errorf("%s", jsobj.Stringify(o))
			}
		}
		expectStatus(t, env.Admin("GET", "/me", tu.Auth{Session: dev2.Session}, nil), 401)
		link := expectStatus(t, env.Admin("POST", "/auth/link", tu.Auth{}, jsobj.New("token", tu.LinkToken(reset.Get(t, "setup_link").(string)))), 200)
		if link.Get(t, "session") != "setup" {
			t.Errorf("%s", link.Body)
		}
		expectStatus(t, env.Admin("POST", "/operators/"+owner.ID+"/reset", tu.Auth{Session: owner.Session}, jsobj.New()), 403)
	})
}

func TestAdminCustomers(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	owner := env.OwnerToken()
	viewer := env.CreateOperator(owner, "viewer", nil)

	t.Run("shows CustomerInfo, attributes and transactions; app-limited operators see only their apps", func(t *testing.T) {
		env.PostAppleTransaction("admin-cust", tu.Fields{"productId": "pro_monthly"})
		setAttributes(env, "admin-cust", `{"$email":{"value":"c@example.com","updated_at_ms":1}}`)
		res := expectStatus(t, env.Admin("GET", "/customers/admin-cust", tu.Auth{Session: viewer.Session}, nil), 200)
		keys := res.JSON(t).(*jsobj.Object).Keys()
		want := []string{"customer", "aliases", "customer_info", "attributes", "transactions", "subscription_states", "webhook_events", "grants", "entitlement_ids", "experiments"}
		if !slices.Equal(keys, want) {
			t.Errorf("%v", keys)
		}
		if res.Get(t, "customer_info", "subscriber", "entitlements", "pro") == nil || res.Get(t, "attributes", "$email", "value") != "c@example.com" {
			t.Errorf("%s", res.Body)
		}
		tx := res.Get(t, "transactions").([]any)[0]
		if prop(tx, "app_id") != "ios" || prop(tx, "product_id") != "pro_monthly" || len(tx.(*jsobj.Object).Keys()) != 21 {
			t.Errorf("%s", jsobj.Stringify(tx))
		}
		if jsobj.Stringify(res.Get(t, "entitlement_ids")) != `["pro","annual_perks"]` {
			t.Errorf("%s", res.Body)
		}
		limited := env.Admin("GET", "/customers/admin-cust", tu.Auth{Session: env.CreateOperator(owner, "viewer", []string{"android"}).Session}, nil)
		lk := limited.JSON(t).(*jsobj.Object)
		if lk.Has("customer_info") || lk.Has("grants") || jsobj.Stringify(limited.Get(t, "transactions")) != "[]" {
			t.Errorf("%s", limited.Body)
		}
		expectStatus(t, env.Admin("GET", "/customers/nobody-here", tu.Auth{Session: viewer.Session}, nil), 404)
	})

	t.Run("lists the newest customers first, a page at a time", func(t *testing.T) {
		env := tu.Start(t, tu.Options{})
		token := env.OwnerToken()
		var made []string
		for _, u := range []string{"page-a", "page-b", "page-c"} {
			setAttributes(env, u, `{"$displayName":{"value":"x","updated_at_ms":1}}`)
			made = append(made, env.CustomerID("default", u))
			env.Clock.Add(1000)
		}
		first := expectStatus(t, env.Admin("GET", "/customers?limit=2", tu.Auth{Token: token}, nil), 200)
		if got := ids(t, first.Get(t, "customers"), "id"); !slices.Equal(got, []string{made[2], made[1]}) {
			t.Errorf("%v", got)
		}
		next := first.Get(t, "next_before").(string)
		if next != jsobj.FormatNumber(float64(tu.T0+1000))+":"+made[1] {
			t.Errorf("%s", next)
		}
		second := env.Admin("GET", "/customers?limit=2&before="+url.QueryEscape(next), tu.Auth{Token: token}, nil)
		if got := ids(t, second.Get(t, "customers"), "id"); !slices.Equal(got, []string{made[0]}) || second.Get(t, "next_before") != nil {
			t.Errorf("%s", second.Body)
		}
		expectStatus(t, env.Admin("GET", "/customers?before=nonsense", tu.Auth{Token: token}, nil), 400)
		expectStatus(t, env.Admin("GET", "/customers?q="+strings.Repeat("x", 257), tu.Auth{Token: token}, nil), 400)
	})

	t.Run("finds customers by app user ID prefix, email or transaction ID, with a purchase summary", func(t *testing.T) {
		env := tu.Start(t, tu.Options{})
		token := env.OwnerToken()
		anon := "$RCAnonymousID:abcdef0123456789abcdef0123456789"
		now := env.Clock.Now()
		_, first := env.PostAppleTransaction(anon, tu.Fields{"productId": "pro_monthly", "purchaseDate": now - 40*tu.Day, "expiresDate": now - tu.Day})
		tx1 := prop(first, "transactionId").(string)
		renewal := tu.Transaction(now, tu.Fields{"productId": "pro_annual", "originalTransactionId": tx1, "purchaseDate": now - tu.Day, "expiresDate": now + tu.Day})
		receipt(env, anon, tu.SignJWS(renewal))
		setAttributes(env, anon, `{"$email":{"value":"Pat.Search@Example.com","updated_at_ms":1}}`)
		expectStatus(t, env.Call("/v1/subscribers/identify", tu.CallOptions{Body: jsobj.New("app_user_id", anon, "new_app_user_id", "member-search")}), 201)
		id := env.CustomerID("default", anon)
		setAttributes(env, "member-search-nopurchases", `{"$displayName":{"value":"x","updated_at_ms":1}}`)
		lonely := env.CustomerID("default", "member-search-nopurchases")
		search := func(q, extra string) []string {
			res := expectStatus(t, env.Admin("GET", "/customers?q="+url.QueryEscape(q)+extra, tu.Auth{Token: token}, nil), 200)
			return ids(t, res.Get(t, "customers"), "id")
		}
		if got := search("member-search", ""); len(got) != 2 || !slices.Contains(got, id) || !slices.Contains(got, lonely) {
			t.Errorf("%v", got)
		}
		for q, want := range map[string][]string{"pat.search@example.com": {id}, tx1: {id}, prop(renewal, "transactionId").(string): {id}, "no-such-customer": nil} {
			if got := search(q, ""); !slices.Equal(got, want) {
				t.Errorf("%s: %v", q, got)
			}
		}
		if got := search("member-search", "&purchases=1"); !slices.Equal(got, []string{id}) {
			t.Errorf("%v", got)
		}
		row := env.Admin("GET", "/customers?q="+url.QueryEscape(anon), tu.Auth{Token: token}, nil).Get(t, "customers").([]any)[0]
		want := `{"id":"` + id + `","app_user_id":"` + anon + `","email":"Pat.Search@Example.com","first_seen":` + jsobj.FormatNumber(float64(tu.T0)) +
			`,"purchases":2,"last_purchase_at":` + jsobj.FormatNumber(float64(now-tu.Day)) + `,"last_product":"pro_annual","active":true,"stores":["app_store"]}`
		if got := jsobj.Stringify(row); got != want {
			t.Errorf("\n got %s\nwant %s", got, want)
		}
	})
}

func TestAdminGrants(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	owner := env.OwnerToken()
	user := "dash-grant"
	env.PostAppleTransaction(user, tu.Fields{"productId": "coins_100", "type": "Consumable", "expiresDate": nil})
	dev := env.CreateOperator(owner, "developer", nil)
	path := "/customers/" + user + "/grants"

	created := expectStatus(t, env.Admin("POST", path, tu.Auth{Session: dev.Session}, jsobj.New("entitlement_id", "pro", "duration", "three_day", "note", " beta tester ")), 201)
	grant := created.Get(t, "grant").(*jsobj.Object)
	want := `{"id":"` + prop(grant, "id").(string) + `","entitlement_id":"pro","duration":"three_day","starts_at":` + itoa(env.Clock.Now()) +
		`,"expires_at":` + itoa(env.Clock.Now()+3*tu.Day) + `,"note":"beta tester","granted_by":"` + dev.Email + `","source":"dashboard","created_at":` + itoa(env.Clock.Now()) +
		`,"revoked_at":null,"revoked_by":null}`
	if got := jsobj.Stringify(grant); got != want {
		t.Errorf("\n got %s\nwant %s", got, want)
	}
	custom := expectStatus(t, env.Admin("POST", path, tu.Auth{Session: dev.Session}, jsobj.New("entitlement_id", "annual_perks", "expires_at", iso(float64(env.Clock.Now()+40*tu.Day)))), 201)
	if custom.Get(t, "grant", "duration") != "custom" || custom.Get(t, "grant", "expires_at") != float64(env.Clock.Now()+40*tu.Day) {
		t.Errorf("%s", custom.Body)
	}
	monthly := expectStatus(t, env.Admin("POST", path, tu.Auth{Session: dev.Session}, jsobj.New("entitlement_id", "pro", "duration", "monthly")), 201)
	if got, want := monthly.Get(t, "grant", "expires_at").(float64), float64(time.UnixMilli(env.Clock.Now()).UTC().AddDate(0, 1, 0).UnixMilli()); got != want {
		t.Errorf("monthly ends %v, want %v", got, want)
	}

	detail := env.Admin("GET", "/customers/"+user, tu.Auth{Session: dev.Session}, nil)
	if len(detail.Get(t, "grants").([]any)) != 3 || detail.Get(t, "customer_info", "subscriber", "entitlements", "pro", "product_identifier") != "rc_promo_pro_monthly" &&
		detail.Get(t, "customer_info", "subscriber", "entitlements", "pro", "product_identifier") != "rc_promo_pro_three_day" {
		t.Errorf("%s", detail.Body)
	}
	// The SDK sees the grant.
	sdk := env.Call("/v1/subscribers/"+user, tu.CallOptions{})
	if sdk.Get(t, "subscriber", "entitlements", "pro") == nil {
		t.Errorf("%s", sdk.Body)
	}

	for _, g := range []string{prop(grant, "id").(string), monthly.Get(t, "grant", "id").(string)} {
		expectStatus(t, env.Admin("POST", path+"/"+g+"/revoke", tu.Auth{Session: dev.Session}, jsobj.New()), 200)
	}
	if c := env.Admin("POST", path+"/"+prop(grant, "id").(string)+"/revoke", tu.Auth{Session: dev.Session}, jsobj.New()); c.Status != 400 {
		t.Errorf("%s", c.Body)
	}
	if env.Call("/v1/subscribers/"+user, tu.CallOptions{}).Get(t, "subscriber", "entitlements", "pro") != nil {
		t.Error("still granted")
	}

	viewer := env.CreateOperator(owner, "viewer", nil)
	expectStatus(t, env.Admin("POST", path, tu.Auth{Session: viewer.Session}, jsobj.New("entitlement_id", "pro", "duration", "weekly")), 403)
	limited := env.CreateOperator(owner, "admin", []string{"ios"})
	expectStatus(t, env.Admin("POST", path, tu.Auth{Session: limited.Session}, jsobj.New("entitlement_id", "pro", "duration", "weekly")), 403)
	expectStatus(t, env.Admin("POST", "/customers/nobody-here/grants", tu.Auth{Session: dev.Session}, jsobj.New("entitlement_id", "pro", "duration", "weekly")), 404)
	for _, bad := range []*jsobj.Object{
		jsobj.New("entitlement_id", "pro", "expires_at", "2001-01-01"),
		jsobj.New("entitlement_id", "pro", "expires_at", "not a date"),
		jsobj.New("entitlement_id", "nope", "duration", "weekly"),
		jsobj.New("entitlement_id", "pro", "duration", "fortnightly"),
		jsobj.New("entitlement_id", "pro", "expires_at", float64(env.Clock.Now()+11*365*tu.Day)),
	} {
		expectStatus(t, env.Admin("POST", path, tu.Auth{Session: dev.Session}, bad), 400)
	}

	var audited int
	env.QueryRow("SELECT count(*) FROM audit_log WHERE action IN ('grant.created', 'grant.revoked') AND target = $1", []any{user}, &audited)
	if audited != 5 {
		t.Errorf("audit %d", audited)
	}

	t.Run("moves an anonymous user's grants to the account on logIn", func(t *testing.T) {
		anon := "$RCAnonymousID:0123456789abcdef0123456789abcdef"
		setAttributes(env, anon, `{"$displayName":{"value":"x","updated_at_ms":1}}`)
		expectStatus(t, env.Admin("POST", "/customers/"+url.PathEscape(anon)+"/grants", tu.Auth{Token: owner}, jsobj.New("entitlement_id", "pro", "duration", "lifetime")), 201)
		res := env.Call("/v1/subscribers/identify", tu.CallOptions{Body: jsobj.New("app_user_id", anon, "new_app_user_id", "granted-member")})
		if res.Get(t, "subscriber", "entitlements", "pro", "product_identifier") != "rc_promo_pro_lifetime" {
			t.Errorf("%s", res.Body)
		}
	})
}

func TestAdminWebhooksAuditSettings(t *testing.T) {
	t.Run("lists deliveries and replays an event", func(t *testing.T) {
		env, receiver := startWithReceiver(t)
		owner := env.OwnerToken()
		receipt(env, "admin-wh", tu.SignJWS(tu.Transaction(env.Clock.Now(), nil)))
		dev := env.CreateOperator(owner, "developer", nil)
		list := expectStatus(t, env.Admin("GET", "/webhooks/deliveries?status=delivered", tu.Auth{Session: dev.Session}, nil), 200).Get(t, "deliveries").([]any)
		if len(list) != 1 {
			t.Fatalf("%v", list)
		}
		id := prop(list[0], "event_id").(string)
		expectStatus(t, env.Admin("GET", "/webhooks/deliveries?status=lost", tu.Auth{Session: dev.Session}, nil), 400)
		expectStatus(t, env.Admin("POST", "/webhooks/events/"+id+"/replay", tu.Auth{Session: dev.Session}, jsobj.New()), 200)
		got := receiver.Received()
		if len(got) != 2 || got[1].Raw != got[0].Raw {
			t.Fatalf("%v", got)
		}
		expectStatus(t, env.Admin("POST", "/webhooks/events/no-such-event/replay", tu.Auth{Session: dev.Session}, jsobj.New()), 404)
		expectStatus(t, env.Admin("POST", "/webhooks/events/"+id+"/replay", tu.Auth{Session: env.CreateOperator(owner, "viewer", nil).Session}, jsobj.New()), 403)
		androidOnly := env.CreateOperator(owner, "developer", []string{"android"})
		expectStatus(t, env.Admin("POST", "/webhooks/events/"+id+"/replay", tu.Auth{Session: androidOnly.Session}, jsobj.New()), 404)
		if l := env.Admin("GET", "/webhooks/deliveries", tu.Auth{Session: androidOnly.Session}, nil).Get(t, "deliveries").([]any); len(l) != 0 {
			t.Errorf("%v", l)
		}
	})

	t.Run("records admin writes with who and how, readable by admins", func(t *testing.T) {
		env := tu.Start(t, tu.Options{})
		owner := env.CreateOperator(env.OwnerToken(), "owner", nil)
		enrollTOTP(t, env, owner.Session)
		token := env.CreateToken(t, owner.Session, "admin")
		env.Admin("POST", "/secret-keys", tu.Auth{Token: token, IP: "198.51.100.7"}, jsobj.New("name", "audited"))
		entries := env.Admin("GET", "/audit?limit=5", tu.Auth{Session: owner.Session}, nil)
		e := entries.Get(t, "entries").([]any)[0]
		if prop(e, "action") != "secret_key.created" || prop(e, "source") != "api" || prop(e, "operator_id") != owner.ID || prop(e, "token_id") == nil ||
			prop(e, "ip") != "198.51.100.7" || jsobj.Stringify(prop(e, "details")) != `{"name":"audited","scopes":["customers:read"],"project":"default"}` {
			t.Errorf("%s", jsobj.Stringify(e))
		}
		if entries.Get(t, "next_before") == nil {
			t.Error("next_before")
		}
		noTOTP := env.CreateOperator(env.OwnerToken(), "owner", nil)
		expectStatus(t, env.Admin("PUT", "/settings", tu.Auth{Session: noTOTP.Session}, jsobj.New("require_totp", true)), 403)
		expectStatus(t, env.Admin("PUT", "/settings", tu.Auth{Session: owner.Session}, jsobj.New("require_totp", false)), 200)
		adminOp := env.CreateOperator(env.OwnerToken(), "admin", nil)
		expectStatus(t, env.Admin("PUT", "/settings", tu.Auth{Session: adminOp.Session}, jsobj.New("require_totp", false)), 403)
		expectStatus(t, env.Admin("PUT", "/settings", tu.Auth{Session: owner.Session}, jsobj.New()), 400)
		expectStatus(t, env.Admin("PUT", "/settings", tu.Auth{Session: owner.Session}, jsobj.New("cloudflare_plan", "gold")), 400)
	})

	t.Run("keeps the SDK URL as a deployment-wide setting that owners set, and says which edition this is", func(t *testing.T) {
		env := tu.Start(t, tu.Options{})
		owner := env.CreateOperator(env.OwnerToken(), "owner", nil)
		viewer := env.CreateOperator(env.OwnerToken(), "viewer", nil)
		put := func(session string, v any) *tu.Response {
			return env.Admin("PUT", "/settings", tu.Auth{Session: session}, jsobj.New("sdk_url", v))
		}
		got := jsobj.Stringify(env.Admin("GET", "/settings", tu.Auth{Session: viewer.Session}, nil).JSON(t))
		if got != `{"require_totp":false,"cloudflare_plan":"free","sdk_url":null,"sdk_url_guess":"`+env.Server.URL+`","edition":"standard"}` {
			t.Errorf("%s", got)
		}
		for in, want := range map[string]string{"https://Purchases.Example.com:443/": "https://purchases.example.com", "http://localhost:8080": "http://localhost:8080", " https://x.example.com:8443 ": "https://x.example.com:8443"} {
			if res := put(owner.Session, in); res.Get(t, "sdk_url") != want {
				t.Errorf("%s: %s", in, res.Body)
			}
		}
		for in, msg := range map[string]string{"https://purchases.example.com/v1": "no path", "http://purchases.example.com": "https", "purchases": "full address", "https://a.example.com/?x=1": "no path"} {
			if res := put(owner.Session, in); res.Status != 400 || !strings.Contains(res.Get(t, "message").(string), msg) {
				t.Errorf("%s: %s", in, res.Body)
			}
		}
		expectStatus(t, put(viewer.Session, "https://x.example.com"), 403)
		expectStatus(t, put(owner.Session, 5.0), 400)
		if put(owner.Session, "").Get(t, "sdk_url") != nil || put(owner.Session, nil).Get(t, "sdk_url") != nil {
			t.Error("not cleared")
		}
		usage := env.Admin("GET", "/usage", tu.Auth{Session: viewer.Session}, nil)
		if usage.Get(t, "edition") != "standard" || usage.Get(t, "configured") != false || jsobj.Stringify(usage.Get(t, "metrics")) != "[]" {
			t.Errorf("%s", usage.Body)
		}
		expectStatus(t, env.Admin("POST", "/usage/refresh", tu.Auth{Session: owner.Session}, jsobj.New()), 400)
		expectStatus(t, env.Admin("GET", "/metrics", tu.Auth{Session: viewer.Session}, nil), 501)
	})

	t.Run("dashboard language: any operator sets their own, from the dashboard's languages", func(t *testing.T) {
		env := tu.Start(t, tu.Options{})
		dev := env.CreateOperator(env.OwnerToken(), "developer", nil)
		if env.Admin("GET", "/me", tu.Auth{Session: dev.Session}, nil).Get(t, "operator", "locale") != nil {
			t.Error("locale set")
		}
		if env.Admin("PATCH", "/me", tu.Auth{Session: dev.Session}, jsobj.New("locale", "ja")).Get(t, "operator", "locale") != "ja" {
			t.Error("ja")
		}
		bad := expectStatus(t, env.Admin("PATCH", "/me", tu.Auth{Session: dev.Session}, jsobj.New("locale", "klingon")), 400)
		if !strings.Contains(bad.Get(t, "message").(string), "zh-tw") {
			t.Errorf("%s", bad.Body)
		}
		expectStatus(t, env.Admin("PATCH", "/me", tu.Auth{Session: dev.Session}, jsobj.New()), 400)
		token := env.CreateToken(t, dev.Session, "read")
		if env.Admin("PATCH", "/me", tu.Auth{Token: token, Origin: "-"}, jsobj.New("locale", "zh-tw")).Get(t, "operator", "locale") != "zh-tw" {
			t.Error("token")
		}
		if env.Admin("PATCH", "/me", tu.Auth{Session: dev.Session}, jsobj.New("locale", nil)).Get(t, "operator", "locale") != nil {
			t.Error("null")
		}
	})
}

func TestConfigAPI(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	owner := env.CreateOperator(env.OwnerToken(), "owner", nil)
	auth := tu.Auth{Session: owner.Session}
	current := expectStatus(t, env.Admin("GET", "/config", auth, nil), 200)
	keys := current.JSON(t).(*jsobj.Object).Keys()
	if !slices.Equal(keys, []string{"id", "document", "created_at", "created_by", "note"}) || current.Get(t, "created_by") != "import" {
		t.Errorf("%s", current.Body)
	}
	base := current.Get(t, "id").(float64)

	valid := env.Admin("POST", "/config/validate", auth, jsobj.New("document", current.Get(t, "document")))
	if string(valid.Body) != `{"valid":true,"problems":[]}` {
		t.Errorf("%s", valid.Body)
	}
	invalid := expectStatus(t, env.Admin("PUT", "/config", auth, jsobj.New("document", jsobj.New("version", 2.0, "projects", jsobj.New("rose", jsobj.New("apps", []any{}))), "base_id", base)), 400)
	if invalid.Get(t, "code") != "invalid_config" || !strings.Contains(jsobj.Stringify(invalid.Get(t, "problems")), "projects.rose.apps") {
		t.Errorf("%s", invalid.Body)
	}
	expectStatus(t, env.Admin("PUT", "/config", auth, jsobj.New("document", current.Get(t, "document"))), 400)
	expectStatus(t, env.Admin("PUT", "/config", auth, jsobj.New("document", current.Get(t, "document"), "base_id", base, "note", strings.Repeat("n", 501))), 400)

	both := twoProjects().(*jsobj.Object)
	projects, _ := both.Get("projects")
	def, _ := jsobj.Prop(current.Get(t, "document"), "projects")
	d, _ := jsobj.Prop(def, "default")
	projects.(*jsobj.Object).Set("default", d)
	saved := expectStatus(t, env.Admin("PUT", "/config", auth, jsobj.New("document", both, "base_id", base, "note", " Add Rose and Gold ")), 201)
	expectStatus(t, env.Admin("PUT", "/config", auth, jsobj.New("document", both, "base_id", base)), 409)
	if got := ids(t, env.Admin("GET", "/projects", auth, nil).Get(t, "projects"), "id"); !slices.Equal(got, []string{"rose", "gold", "default"}) {
		t.Errorf("%v", got)
	}
	expectStatus(t, env.Call("/v1/subscribers/anyone/offerings", tu.CallOptions{Key: tu.Key(roseKey)}), 200)
	expectStatus(t, env.Admin("GET", "/customers", auth, nil), 400)
	expectStatus(t, env.Admin("GET", "/customers?project=rose", auth, nil), 200)
	expectStatus(t, env.Admin("GET", "/customers?project=nope", auth, nil), 404)

	versions := env.Admin("GET", "/config/versions", auth, nil)
	list := versions.Get(t, "versions").([]any)
	if len(list) != 2 || prop(list[0], "note") != "Add Rose and Gold" || versions.Get(t, "next_before") != nil {
		t.Errorf("%s", versions.Body)
	}
	if one := env.Admin("GET", "/config/versions/1?limit=1", auth, nil); one.Get(t, "id") != 1.0 {
		t.Errorf("%s", one.Body)
	}
	expectStatus(t, env.Admin("GET", "/config/versions/1.5", auth, nil), 404)
	if page := env.Admin("GET", "/config/versions?limit=1", auth, nil); page.Get(t, "next_before") != saved.Get(t, "id") {
		t.Errorf("%s", page.Body)
	}
	expectStatus(t, env.Admin("POST", "/config/versions/1/restore", auth, jsobj.New("base_id", saved.Get(t, "id"))), 201)
	if got := ids(t, env.Admin("GET", "/projects", auth, nil).Get(t, "projects"), "id"); !slices.Equal(got, []string{"default"}) {
		t.Errorf("%v", got)
	}
	expectStatus(t, env.Call("/v1/subscribers/anyone/offerings", tu.CallOptions{Key: tu.Key(roseKey)}), 401)
	var actions []string
	rows, _ := env.Pool.Query(t.Context(), "SELECT action || ' ' || details FROM audit_log WHERE action LIKE 'config.%' ORDER BY id")
	for rows.Next() {
		var a string
		_ = rows.Scan(&a)
		actions = append(actions, a)
	}
	want := []string{`config.saved {"base_id":1,"note":"Add Rose and Gold"}`, `config.restored {"base_id":2,"note":"Restored version 1","restored":1}`}
	if !slices.Equal(actions, want) {
		t.Errorf("%v", actions)
	}

	dev := env.CreateOperator(env.OwnerToken(), "developer", nil)
	expectStatus(t, env.Admin("PUT", "/config", tu.Auth{Session: dev.Session}, jsobj.New("document", both, "base_id", 3.0)), 403)
}

func TestSecretKeysAPI(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	token := env.OwnerToken()
	created := expectStatus(t, env.Admin("POST", "/secret-keys", tu.Auth{Token: token}, jsobj.New("name", " backend ")), 201)
	key := created.Get(t, "key").(string)
	if !strings.HasPrefix(key, "sk_") || created.Get(t, "project_id") != "default" || jsobj.Stringify(created.Get(t, "scopes")) != `["customers:read"]` {
		t.Errorf("%s", created.Body)
	}
	expectStatus(t, env.Call("/v1/subscribers/srv", tu.CallOptions{Key: tu.Key(key)}), 200)
	id := created.Get(t, "id").(string)
	set := expectStatus(t, env.Admin("POST", "/secret-keys/"+id+"/expire", tu.Auth{Token: token}, jsobj.New("in_hours", 1.0)), 200)
	if set.Get(t, "expires_at") != float64(env.Clock.Now()+3600_000) {
		t.Errorf("%s", set.Body)
	}
	expectStatus(t, env.Admin("POST", "/secret-keys/"+id+"/expire", tu.Auth{Token: token}, jsobj.New("in_hours", 9999.0)), 400)
	expectStatus(t, env.Admin("POST", "/secret-keys/"+id+"/revoke", tu.Auth{Token: token}, nil), 200)
	expectStatus(t, env.Admin("POST", "/secret-keys/"+id+"/revoke", tu.Auth{Token: token}, nil), 404)
	list := env.Admin("GET", "/secret-keys", tu.Auth{Token: token}, nil).Get(t, "secret_keys").([]any)
	if len(list) != 1 || prop(list[0], "revoked_at") == nil || prop(list[0], "key_prefix") != key[:10] {
		t.Errorf("%s", jsobj.Stringify(list))
	}
	if l := env.Admin("GET", "/secret-keys?project=other", tu.Auth{Token: token}, nil).Get(t, "secret_keys").([]any); len(l) != 0 {
		t.Errorf("%v", l)
	}
	expectStatus(t, env.Admin("POST", "/secret-keys", tu.Auth{Token: token}, jsobj.New("name", "x", "scopes", strs("grants:write"))), 400)
	expectStatus(t, env.Admin("POST", "/secret-keys", tu.Auth{Token: token}, jsobj.New("name", "x", "project", "nope")), 404)
}

func TestDoctor(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	viewer := env.CreateOperator(env.OwnerToken(), "viewer", nil)
	run := func() map[string]*jsobj.Object {
		res := expectStatus(t, env.Admin("GET", "/doctor", tu.Auth{Session: viewer.Session}, nil), 200)
		out := map[string]*jsobj.Object{}
		for _, c := range res.Get(t, "checks").([]any) {
			o := c.(*jsobj.Object)
			out[prop(o, "id").(string)] = o
			if s := prop(o, "status"); (s == "warn" || s == "fail") && prop(o, "fix") == nil {
				t.Errorf("no fix: %s", jsobj.Stringify(o))
			}
		}
		if !strings.Contains(res.Get(t, "summary").(string), "warning") {
			t.Errorf("%s", res.Body)
		}
		return out
	}
	checks := run()
	for id, status := range map[string]string{"database": "ok", "sdk-url": "info", "app:ios:server-api": "warn", "app:android:play-api": "warn",
		"app:ios:notifications": "warn", "cron": "info", "fx": "info", "two-step": "warn"} {
		if c := checks[id]; c == nil || prop(c, "status") != status {
			t.Errorf("%s: %v", id, jsobj.Stringify(c))
		}
	}
	for _, liteOnly := range []string{"storage", "usage", "domain"} {
		if checks[liteOnly] != nil {
			t.Errorf("%s is Lite's", liteOnly)
		}
	}
	if fix := prop(checks["app:ios:notifications"], "fix").(string); !strings.Contains(fix, env.Server.URL+"/notifications/apple") {
		t.Error(fix)
	}
	signed, _ := tu.SignNotification(env.Clock.Now(), tu.NotificationSpec{Type: "TEST"})
	expectStatus(t, env.PostNotification(signed), 200)
	if c := run()["app:ios:notifications"]; prop(c, "status") != "ok" {
		t.Errorf("%s", jsobj.Stringify(c))
	}
}

func TestDashboard(t *testing.T) {
	files := fstest.MapFS{
		"index.html":      {Data: []byte("<!doctype html><title>openpurr</title>")},
		"js/app.js":       {Data: []byte("export {};")},
		"app.css":         {Data: []byte("body{}")},
		"_headers":        {Data: []byte("# comment\n/*\n  Content-Security-Policy: default-src 'none'\n  X-Frame-Options: DENY\n/other\n  X-Other: no\n")},
		".gitkeep":        {Data: nil},
		"locales/ja.json": {Data: []byte("{}")},
	}
	env := tu.Start(t, tu.Options{Dashboard: files})
	get := func(path string) *tu.Response { return env.Request("GET", path, "") }
	for path, wantType := range map[string]string{"/admin": "text/html", "/admin/customers/x": "text/html", "/": "text/html", "/js/app.js": "javascript", "/app.css": "text/css", "/locales/ja.json": "application/json"} {
		res := get(path)
		if res.Status != 200 || !strings.Contains(res.Header.Get("Content-Type"), wantType) ||
			res.Header.Get("Content-Security-Policy") != "default-src 'none'" || res.Header.Get("X-Frame-Options") != "DENY" || res.Header.Get("X-Other") != "" {
			t.Errorf("%s: %d %v", path, res.Status, res.Header)
		}
	}
	for _, path := range []string{"/_headers", "/.gitkeep", "/nope", "/admin/v1/me"} {
		if res := get(path); res.Status == 200 {
			t.Errorf("%s served", path)
		}
	}
	if res := get("/nope"); string(res.Body) != `{"code":0,"message":"Not found"}` {
		t.Errorf("%s", res.Body)
	}
	empty := tu.Start(t, tu.Options{Dashboard: fstest.MapFS{}})
	if res := empty.Request("GET", "/admin", ""); res.Status != 404 || !strings.Contains(string(res.Body), "go generate") {
		t.Errorf("%d %s", res.Status, res.Body)
	}
}
