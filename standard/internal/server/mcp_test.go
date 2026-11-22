package server_test

// The MCP server (/mcp): transport rules, token auth and scopes, and the tools, including
// promotional grants end to end (what the SDK sees afterwards). Mirrors lite/test/mcp.test.ts and
// the check_setup part of doctor.test.ts. Every tool's exact text and structured output, for many
// more inputs, is checked against Lite's own in mcp_golden_test.go.

import (
	"io"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/jsobj"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

const day = int64(86_400_000)

// mcpPost POSTs a raw body to /mcp.
func mcpPost(t *testing.T, env *tu.Env, body, token string, headers map[string]string) *tu.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, env.Server.URL+"/mcp", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	return send(t, env, req)
}

func send(t *testing.T, env *tu.Env, req *http.Request) *tu.Response {
	t.Helper()
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	env.Deps.Deferred.Wait()
	return &tu.Response{Status: res.StatusCode, Header: res.Header, Body: data}
}

var rpcN int

func rpc(t *testing.T, env *tu.Env, token, method string, params any) *tu.Response {
	t.Helper()
	rpcN++
	msg := jsobj.New("jsonrpc", "2.0", "id", float64(rpcN), "method", method)
	if params != nil {
		msg.Set("params", params)
	}
	return mcpPost(t, env, jsobj.Stringify(msg), token, map[string]string{"MCP-Protocol-Version": "2025-11-25"})
}

// callTool calls a tool and returns its result.
func callTool(t *testing.T, env *tu.Env, token, name string, args *jsobj.Object) *jsobj.Object {
	t.Helper()
	if args == nil {
		args = jsobj.New()
	}
	res := expectStatus(t, rpc(t, env, token, "tools/call", jsobj.New("name", name, "arguments", args)), 200)
	result, ok := res.Get(t, "result").(*jsobj.Object)
	if !ok {
		t.Fatalf("no result: %s", res.Body)
	}
	return result
}

func toolText(r *jsobj.Object) string {
	var parts []string
	content, _ := r.Get("content")
	for _, c := range content.([]any) {
		text, _ := jsobj.Prop(c, "text")
		parts = append(parts, text.(string))
	}
	return strings.Join(parts, "\n")
}

func isError(r *jsobj.Object) bool {
	v, _ := r.Get("isError")
	return v == true
}

func structured(r *jsobj.Object, path ...string) any {
	v, _ := r.Get("structuredContent")
	return prop(v, path...)
}

func toolNames(t *testing.T, env *tu.Env, token string) []string {
	t.Helper()
	return ids(t, rpc(t, env, token, "tools/list", nil).Get(t, "result", "tools"), "name")
}

func tokenFor(t *testing.T, env *tu.Env, owner, role string, apps []string, scopes ...string) (string, tu.Operator) {
	t.Helper()
	op := env.CreateOperator(owner, role, apps)
	return env.CreateToken(t, op.Session, scopes...), op
}

func mustMatch(t *testing.T, pattern, text string) {
	t.Helper()
	if !regexp.MustCompile(pattern).MatchString(text) {
		t.Errorf("%q doesn't match %s", text, pattern)
	}
}

func TestMCPTransport(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	owner := env.OwnerToken()
	token, _ := tokenFor(t, env, owner, "viewer", nil, "read")

	t.Run("needs a token, and says where to sign in", func(t *testing.T) {
		r := mcpPost(t, env, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`, "", nil)
		expectStatus(t, r, 401)
		want := `Bearer resource_metadata="` + env.Server.URL + `/.well-known/oauth-protected-resource/mcp", scope="read"`
		if got := r.Header.Get("WWW-Authenticate"); got != want {
			t.Errorf("got %s", got)
		}
		bad := expectStatus(t, mcpPost(t, env, `{"jsonrpc":"2.0","id":1,"method":"ping"}`, "pat_not_a_real_token", nil), 401)
		if !strings.HasSuffix(bad.Header.Get("WWW-Authenticate"), `, error="invalid_token"`) {
			t.Error(bad.Header.Get("WWW-Authenticate"))
		}
	})

	t.Run("follows the Streamable HTTP rules", func(t *testing.T) {
		for _, method := range []string{"GET", "DELETE"} {
			req, _ := http.NewRequest(method, env.Server.URL+"/mcp", nil)
			req.Header.Set("Authorization", "Bearer "+token)
			r := expectStatus(t, send(t, env, req), 405)
			if r.Header.Get("Allow") != "POST" {
				t.Error(r.Header)
			}
		}
		if r := expectStatus(t, mcpPost(t, env, `{"jsonrpc":"2.0","method":"notifications/initialized"}`, token, nil), 202); len(r.Body) != 0 {
			t.Errorf("%s", r.Body)
		}
		expectStatus(t, mcpPost(t, env, `{"jsonrpc":"2.0","id":1,"method":"ping"}`, token, map[string]string{"Origin": "https://evil.example"}), 403)
		expectStatus(t, mcpPost(t, env, `{"jsonrpc":"2.0","id":1,"method":"ping"}`, token, map[string]string{"Origin": env.Server.URL}), 200)
		expectStatus(t, mcpPost(t, env, `{"jsonrpc":"2.0","id":1,"method":"ping"}`, token, map[string]string{"MCP-Protocol-Version": "1999-01-01"}), 400)
		expectStatus(t, mcpPost(t, env, `[{}]`, token, nil), 400) // no batches
		expectStatus(t, mcpPost(t, env, `not json`, token, nil), 400)
		if c := rpc(t, env, token, "resources/list", nil).Get(t, "error", "code"); c != -32601.0 {
			t.Error(c)
		}
		if c := rpc(t, env, token, "tools/call", jsobj.New("name", "nope")).Get(t, "error", "code"); c != -32602.0 {
			t.Error(c)
		}
	})

	t.Run("negotiates the protocol version", func(t *testing.T) {
		older := rpc(t, env, token, "initialize", jsobj.New("protocolVersion", "2025-06-18", "capabilities", jsobj.New(), "clientInfo", jsobj.New("name", "test", "version", "1")))
		if older.Get(t, "result", "protocolVersion") != "2025-06-18" || older.Get(t, "result", "serverInfo", "name") != "openpurr" {
			t.Errorf("%s", older.Body)
		}
		mustMatch(t, "explain_entitlement", older.Get(t, "result", "instructions").(string))
		if v := rpc(t, env, token, "initialize", jsobj.New("protocolVersion", "2099-01-01")).Get(t, "result", "protocolVersion"); v != "2025-11-25" {
			t.Error(v)
		}
	})

	t.Run("lists only the tools a token can use", func(t *testing.T) {
		reader, _ := tokenFor(t, env, owner, "owner", nil, "read")
		names := toolNames(t, env, reader)
		for _, n := range []string{"lookup_customer", "explain_entitlement", "get_metrics", "get_audit_log"} {
			if !slices.Contains(names, n) {
				t.Error(n)
			}
		}
		if slices.Contains(names, "grant_entitlement") {
			t.Error("read can't grant")
		}
		granter, _ := tokenFor(t, env, owner, "developer", nil, "read", "write:grants")
		names = toolNames(t, env, granter)
		if !slices.Contains(names, "revoke_grant") || slices.Contains(names, "get_audit_log") {
			t.Error(names)
		}
		viewer, _ := tokenFor(t, env, owner, "viewer", nil, "read", "write:grants")
		if slices.Contains(toolNames(t, env, viewer), "grant_entitlement") {
			t.Error("a scope can't give more than the role")
		}
		limited, _ := tokenFor(t, env, owner, "owner", []string{"ios"}, "read", "write:grants")
		if slices.Contains(toolNames(t, env, limited), "grant_entitlement") {
			t.Error("grants span apps")
		}
		r := callTool(t, env, limited, "grant_entitlement", jsobj.New("app_user_id", "x", "entitlement_id", "pro", "duration", "weekly"))
		if !isError(r) || toolText(r) != "This needs access to all apps." {
			t.Error(toolText(r))
		}
		if names := toolNames(t, env, owner); !slices.Equal(names, []string{"lookup_customer", "search_customers", "explain_entitlement", "get_metrics",
			"get_experiments", "get_config", "save_config", "list_webhook_deliveries", "replay_webhook", "grant_entitlement", "revoke_grant",
			"check_setup", "get_audit_log"}) {
			t.Error(names)
		}
		for _, tool := range rpc(t, env, owner, "tools/list", nil).Get(t, "result", "tools").([]any) {
			if k := tool.(*jsobj.Object).Keys(); !slices.Equal(k, []string{"name", "title", "description", "inputSchema", "annotations"}) {
				t.Error(k)
			}
		}
	})

	t.Run("limits tool calls per token", func(t *testing.T) {
		limit := 2
		limited := tu.Start(t, tu.Options{UserLimit: &limit})
		tok := limited.OwnerToken()
		for range 2 {
			if r := callTool(t, limited, tok, "get_audit_log", nil); isError(r) {
				t.Fatal(toolText(r))
			}
		}
		if r := callTool(t, limited, tok, "get_audit_log", nil); toolText(r) != "Too many calls; wait a minute and try again." {
			t.Error(toolText(r))
		}
	})
}

func TestMCPTools(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	owner := env.OwnerToken()
	now := env.Clock.Now()

	t.Run("explains why a customer does or doesn't have an entitlement", func(t *testing.T) {
		token, _ := tokenFor(t, env, owner, "owner", nil, "read")
		env.PostAppleTransaction("explain-yes", tu.Fields{"productId": "pro_monthly"})
		yes := callTool(t, env, token, "explain_entitlement", jsobj.New("app_user_id", "explain-yes", "entitlement_id", "pro"))
		mustMatch(t, `^Yes: .* has pro until`, toolText(yes))
		if structured(yes, "has_entitlement") != true || structured(yes, "source") != "purchase" {
			t.Errorf("%s", jsobj.Stringify(yes))
		}
		env.PostAppleTransaction("explain-lapsed", tu.Fields{"productId": "pro_monthly", "purchaseDate": now - 60*day})
		no := toolText(callTool(t, env, token, "explain_entitlement", jsobj.New("app_user_id", "explain-lapsed", "entitlement_id", "pro")))
		mustMatch(t, `^No: pro ended on`, no)
		mustMatch(t, `expired on`, no)
		env.PostAppleTransaction("explain-coins", tu.Fields{"productId": "coins_100", "type": "Consumable", "expiresDate": nil})
		never := toolText(callTool(t, env, token, "explain_entitlement", jsobj.New("app_user_id", "explain-coins", "entitlement_id", "annual_perks")))
		mustMatch(t, `never bought a product that unlocks annual_perks`, never)
		mustMatch(t, `coins_100, which no entitlement includes`, never)
		mustMatch(t, `no customer`, toolText(callTool(t, env, token, "explain_entitlement", jsobj.New("app_user_id", "nobody-at-all", "entitlement_id", "pro"))))
		bad := callTool(t, env, token, "explain_entitlement", jsobj.New("app_user_id", "explain-yes", "entitlement_id", "gold"))
		if !isError(bad) {
			t.Error("gold")
		}
		mustMatch(t, `Entitlements: pro, annual_perks`, toolText(bad))
	})

	t.Run("looks up and finds customers, reads the config and charts", func(t *testing.T) {
		token, _ := tokenFor(t, env, owner, "owner", nil, "read")
		env.PostAppleTransaction("lookup-annual", tu.Fields{"productId": "pro_annual", "expiresDate": now + 300*day})
		found := callTool(t, env, token, "lookup_customer", jsobj.New("app_user_id", "lookup-annual"))
		mustMatch(t, `pro: active until`, toolText(found))
		if structured(found, "purchases").([]any)[0].(*jsobj.Object).Keys()[0] != "app_id" || prop(structured(found, "purchases").([]any)[0], "product_id") != "pro_annual" {
			t.Errorf("%s", jsobj.Stringify(structured(found, "purchases")))
		}
		search := callTool(t, env, token, "search_customers", jsobj.New("query", "lookup-ann"))
		if got := ids(t, structured(search, "customers"), "app_user_id"); !slices.Contains(got, "lookup-annual") {
			t.Error(got)
		}
		cfg := callTool(t, env, token, "get_config", nil)
		mustMatch(t, `pro \(Pro\): ios: pro_monthly, pro_annual, lifetime; android: pro, lifetime`, toolText(cfg))
		// Standard serves the SDK API itself: until the SDK URL is set, it's this server's address.
		mustMatch(t, `^SDK URL \(Purchases.proxyURL\): not set\. It's this server's address, probably `+regexp.QuoteMeta(env.Server.URL), toolText(cfg))
		mustMatch(t, regexp.QuoteMeta("store notifications to "+env.Server.URL+"/notifications/apple"), toolText(cfg))
		if structured(cfg, "sdk_url") != env.Server.URL || structured(cfg, "sdk_url_source") != "guess" {
			t.Errorf("%v %v", structured(cfg, "sdk_url"), structured(cfg, "sdk_url_source"))
		}
		mrr := callTool(t, env, token, "get_metrics", jsobj.New("chart", "mrr", "environment", "sandbox", "interval", "month"))
		mustMatch(t, `\| month \| mrr \|`, toolText(mrr))
		if !isError(callTool(t, env, token, "get_metrics", jsobj.New("chart", "nope"))) || !isError(callTool(t, env, token, "get_metrics", jsobj.New("chart", "constructor"))) {
			t.Error("unknown charts")
		}
		if r := callTool(t, env, token, "get_metrics", jsobj.New("chart", "mrr", "to", "not a date")); toolText(r) != "from and to must be dates (YYYY-MM-DD), from on or before to." {
			t.Error(toolText(r))
		}
		if r := callTool(t, env, token, "lookup_customer", nil); !isError(r) || toolText(r) != "app_user_id is required." {
			t.Error(toolText(r))
		}
		if r := callTool(t, env, token, "lookup_customer", jsobj.New("app_user_id", 5.0)); toolText(r) != "app_user_id must be a string." {
			t.Error(toolText(r))
		}
		if r := mcpPost(t, env, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"lookup_customer","arguments":[1]}}`, token, nil); prop(r.JSON(t), "result", "content") == nil ||
			!strings.Contains(string(r.Body), "arguments must be an object.") {
			t.Errorf("%s", r.Body)
		}
	})

	t.Run("grants and revokes an entitlement; the SDK sees it as a promotional entitlement", func(t *testing.T) {
		token, op := tokenFor(t, env, owner, "developer", nil, "read", "write:grants")
		user := "grant-user"
		env.Call("/v1/subscribers/"+user+"/attributes", tu.CallOptions{Body: jsobj.New("attributes", jsobj.New("$email", jsobj.New("value", "g@example.com", "updated_at_ms", float64(now))))})
		granted := callTool(t, env, token, "grant_entitlement", jsobj.New("app_user_id", user, "entitlement_id", "pro", "duration", "monthly", "note", "support make-good"))
		if isError(granted) {
			t.Fatal(toolText(granted))
		}
		mustMatch(t, `^Granted pro to grant-user until `, toolText(granted))
		grantID := structured(granted, "grant", "id").(string)
		if structured(granted, "product_identifier") != "rc_promo_pro_monthly" {
			t.Error(structured(granted, "product_identifier"))
		}
		info := env.Call("/v1/subscribers/"+user, tu.CallOptions{})
		if prop(info.JSON(t), "subscriber", "entitlements", "pro", "product_identifier") != "rc_promo_pro_monthly" ||
			prop(info.JSON(t), "subscriber", "subscriptions", "rc_promo_pro_monthly", "store") != "promotional" {
			t.Errorf("%s", info.Body)
		}
		mustMatch(t, `from a promotional grant`, toolText(callTool(t, env, token, "explain_entitlement", jsobj.New("app_user_id", user, "entitlement_id", "pro"))))
		var actor, source string
		var tokenID *string
		env.QueryRow("SELECT actor, source, token_id FROM audit_log WHERE action = 'grant.created' AND target = $1", []any{user}, &actor, &source, &tokenID)
		if actor != op.Email || source != "mcp" || tokenID == nil {
			t.Errorf("%s %s %v", actor, source, tokenID)
		}

		if r := callTool(t, env, token, "revoke_grant", jsobj.New("app_user_id", user, "grant_id", grantID)); isError(r) {
			t.Fatal(toolText(r))
		}
		if e := prop(env.Call("/v1/subscribers/"+user, tu.CallOptions{}).JSON(t), "subscriber", "entitlements", "pro"); e != nil {
			t.Error("still has pro")
		}
		if !isError(callTool(t, env, token, "revoke_grant", jsobj.New("app_user_id", user, "grant_id", grantID))) {
			t.Error("revoked twice")
		}
		mustMatch(t, `Give a duration`, toolText(callTool(t, env, token, "grant_entitlement", jsobj.New("app_user_id", user, "entitlement_id", "pro"))))
		mustMatch(t, `duration must be one of`, toolText(callTool(t, env, token, "grant_entitlement", jsobj.New("app_user_id", user, "entitlement_id", "pro", "duration", "forever"))))
		mustMatch(t, `No customer`, toolText(callTool(t, env, token, "grant_entitlement", jsobj.New("app_user_id", "no-such-user", "entitlement_id", "pro", "duration", "weekly"))))
		reader, _ := tokenFor(t, env, owner, "owner", nil, "read")
		mustMatch(t, `grants:manage permission \(check the token's scopes, and your role\)`, toolText(callTool(t, env, reader, "grant_entitlement", jsobj.New("app_user_id", user, "entitlement_id", "pro", "duration", "weekly"))))
	})

	t.Run("a grant never shortens access a purchase already gives, and lifetime wins", func(t *testing.T) {
		token, _ := tokenFor(t, env, owner, "owner", nil, "read", "write:grants")
		env.PostAppleTransaction("both", tu.Fields{"productId": "pro_annual", "expiresDate": now + 200*day})
		callTool(t, env, token, "grant_entitlement", jsobj.New("app_user_id", "both", "entitlement_id", "pro", "duration", "weekly"))
		if p := prop(env.Call("/v1/subscribers/both", tu.CallOptions{}).JSON(t), "subscriber", "entitlements", "pro", "product_identifier"); p != "pro_annual" {
			t.Error(p)
		}
		callTool(t, env, token, "grant_entitlement", jsobj.New("app_user_id", "both", "entitlement_id", "pro", "duration", "lifetime"))
		pro := prop(env.Call("/v1/subscribers/both", tu.CallOptions{}).JSON(t), "subscriber", "entitlements", "pro")
		if prop(pro, "product_identifier") != "rc_promo_pro_lifetime" || prop(pro, "expires_date") != nil {
			t.Errorf("%s", jsobj.Stringify(pro))
		}
	})

	t.Run("get_config returns the document and its version; save_config saves a new version, refusing stale or invalid ones", func(t *testing.T) {
		token, op := tokenFor(t, env, owner, "owner", nil, "read", "write:config")
		got := callTool(t, env, token, "get_config", nil)
		base := structured(got, "version_id").(float64)
		document := structured(got, "document").(*jsobj.Object)
		document = jsobj.CloneValue(document).(*jsobj.Object)
		prop(document, "projects", "default").(*jsobj.Object).Set("name", "Renamed")
		saved := callTool(t, env, token, "save_config", jsobj.New("document", document, "base_id", base, "note", "Rename"))
		if isError(saved) {
			t.Fatal(toolText(saved))
		}
		id := structured(saved, "version_id").(float64)
		version := env.Admin("GET", "/config/versions/"+jsobj.FormatNumber(id), tu.Auth{Token: owner}, nil)
		if version.Get(t, "created_by") != op.Email || version.Get(t, "note") != "Rename" || version.Get(t, "document", "projects", "default", "name") != "Renamed" {
			t.Errorf("%s", version.Body)
		}
		stale := callTool(t, env, token, "save_config", jsobj.New("document", document, "base_id", base))
		if !isError(stale) {
			t.Error("stale save")
		}
		mustMatch(t, `changed by someone else`, toolText(stale))
		prop(document, "projects", "default", "apps", "ios").(*jsobj.Object).Set("sdk_keys", []any{"test_nope_nope_nope_nope"})
		invalid := callTool(t, env, token, "save_config", jsobj.New("document", document, "base_id", id))
		mustMatch(t, `apps\.ios\.sdk_keys\[0\]: must not start with test_`, toolText(invalid))
		var source string
		env.QueryRow("SELECT source FROM audit_log WHERE action = 'config.saved' ORDER BY id DESC LIMIT 1", nil, &source)
		if source != "mcp" {
			t.Error(source)
		}
		devToken, _ := tokenFor(t, env, owner, "developer", nil, "read", "write:config")
		adminToken, _ := tokenFor(t, env, owner, "admin", nil, "read", "write:config")
		if slices.Contains(toolNames(t, env, devToken), "save_config") || !slices.Contains(toolNames(t, env, adminToken), "save_config") {
			t.Error("save_config offered to the wrong tokens")
		}
	})

	t.Run("check_setup answers the same checks as the doctor", func(t *testing.T) {
		viewer := env.CreateOperator(owner, "viewer", nil)
		doctor := expectStatus(t, env.Admin("GET", "/doctor", tu.Auth{Session: viewer.Session}, nil), 200)
		token := env.CreateToken(t, viewer.Session, "read")
		r := callTool(t, env, token, "check_setup", nil)
		if structured(r, "summary") != doctor.Get(t, "summary") || jsobj.Stringify(structured(r, "checks")) != jsobj.Stringify(doctor.Get(t, "checks")) {
			t.Errorf("%s\n%s", jsobj.Stringify(structured(r, "checks")), jsobj.Stringify(doctor.Get(t, "checks")))
		}
		text := toolText(r)
		if !strings.HasPrefix(text, doctor.Get(t, "summary").(string)+"\n\n") {
			t.Error(text)
		}
		mustMatch(t, `(?m)^! .*\n  Fix: `, text)
	})
}
