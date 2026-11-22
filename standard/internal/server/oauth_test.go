package server_test

// OAuth 2.1 for the MCP server, end to end the way Claude.ai does it: 401 → metadata discovery →
// registration (or a Client ID Metadata Document) → authorize → consent on the dashboard → token
// exchange with PKCE → /mcp → refresh → revoke. Plus the attacks the spec cares about, expiry, and
// what Standard adds: one winner when a code or refresh token is used twice at once, and Client ID
// Metadata Documents fetched only from public addresses. Mirrors lite/test/oauth.test.ts.

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/server"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

const (
	callback    = "https://claude.ai/api/mcp/auth_callback"
	metadataDoc = "https://client.example/oauth/metadata.json"
)

func pkce() (verifier, challenge string) {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	verifier = base64.RawURLEncoding.EncodeToString(b)
	sum := sha256.Sum256([]byte(verifier))
	return verifier, base64.RawURLEncoding.EncodeToString(sum[:])
}

type oauthEnv struct {
	*tu.Env
	t     *testing.T
	owner string
}

func (e *oauthEnv) do(method, path, contentType, body string) *tu.Response {
	e.t.Helper()
	req, err := http.NewRequest(method, e.Server.URL+path, strings.NewReader(body))
	if err != nil {
		e.t.Fatal(err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	return send(e.t, e.Env, req)
}

func (e *oauthEnv) register(extra ...any) *tu.Response {
	body := jsobj.New("client_name", "Claude", "redirect_uris", []any{callback})
	for i := 0; i+1 < len(extra); i += 2 {
		body.Set(extra[i].(string), extra[i+1])
	}
	return e.do("POST", "/oauth/register", "application/json", jsobj.Stringify(body))
}

func (e *oauthEnv) authorizeURL(clientID, challenge string, extra ...string) string {
	q := url.Values{"response_type": {"code"}, "client_id": {clientID}, "redirect_uri": {callback}, "code_challenge": {challenge},
		"code_challenge_method": {"S256"}, "state": {"xyz"}, "scope": {"read write:grants"}, "resource": {e.Server.URL + "/mcp"}}
	for i := 0; i+1 < len(extra); i += 2 {
		q.Set(extra[i], extra[i+1])
	}
	return "/oauth/authorize?" + q.Encode()
}

// startAuthorize starts an authorization and returns the pending request's ID.
func (e *oauthEnv) startAuthorize(clientID, challenge string) string {
	e.t.Helper()
	start := expectStatus(e.t, e.do("GET", e.authorizeURL(clientID, challenge), "", ""), 302)
	consent, err := url.Parse(start.Header.Get("Location"))
	if err != nil || consent.Path != "/admin/oauth/consent" {
		e.t.Fatalf("location %s", start.Header.Get("Location"))
	}
	return consent.Query().Get("request")
}

// approvedCode authorizes, approves on the dashboard as session, and returns the code.
func (e *oauthEnv) approvedCode(clientID, session, challenge string, scopes ...string) string {
	e.t.Helper()
	id := e.startAuthorize(clientID, challenge)
	body := jsobj.New()
	if scopes != nil {
		body.Set("scopes", stringsAny(scopes))
	}
	decided := expectStatus(e.t, e.Admin("POST", "/oauth/requests/"+id+"/approve", tu.Auth{Session: session}, body), 200)
	back, _ := url.Parse(decided.Get(e.t, "redirect").(string))
	if back.Scheme+"://"+back.Host+back.Path != callback || back.Query().Get("state") != "xyz" || back.Query().Get("iss") != e.Server.URL {
		e.t.Fatalf("redirect %s", back)
	}
	return back.Query().Get("code")
}

func stringsAny(list []string) []any {
	out := make([]any, len(list))
	for i, s := range list {
		out[i] = s
	}
	return out
}

func (e *oauthEnv) exchange(params ...string) *tu.Response {
	q := url.Values{}
	for i := 0; i+1 < len(params); i += 2 {
		q.Set(params[i], params[i+1])
	}
	return e.do("POST", "/oauth/token", "application/x-www-form-urlencoded", q.Encode())
}

func (e *oauthEnv) mcpStatus(token string) (int, string) {
	r := mcpPost(e.t, e.Env, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`, token, nil)
	return r.Status, r.Header.Get("WWW-Authenticate")
}

// connected is a registered client, a signed-in owner and the tokens they approved.
func (e *oauthEnv) connected() (clientID string, owner tu.Operator, tokens *tu.Response) {
	e.t.Helper()
	clientID = e.register().Get(e.t, "client_id").(string)
	owner = e.CreateOperator(e.owner, "owner", nil)
	verifier, challenge := pkce()
	code := e.approvedCode(clientID, owner.Session, challenge)
	return clientID, owner, expectStatus(e.t, e.exchange("grant_type", "authorization_code", "code", code, "client_id", clientID, "code_verifier", verifier), 200)
}

func newOAuthEnv(t *testing.T) *oauthEnv {
	env := tu.Start(t, tu.Options{})
	return &oauthEnv{Env: env, t: t, owner: env.OwnerToken()}
}

func TestOAuthDiscovery(t *testing.T) {
	e := newOAuthEnv(t)
	_, header := e.mcpStatus("")
	if header != `Bearer resource_metadata="`+e.Server.URL+`/.well-known/oauth-protected-resource/mcp", scope="read"` {
		t.Error(header)
	}
	for _, path := range []string{"/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"} {
		prm := expectStatus(t, e.do("GET", path, "", ""), 200)
		want := `{"resource":"` + e.Server.URL + `/mcp","authorization_servers":["` + e.Server.URL + `"],"scopes_supported":["read","write:grants","write:webhooks","write:config"],"bearer_methods_supported":["header"],"resource_name":"openpurr"}`
		if string(prm.Body) != want {
			t.Errorf("%s", prm.Body)
		}
	}
	as := expectStatus(t, e.do("GET", "/.well-known/oauth-authorization-server", "", ""), 200)
	if as.Get(t, "issuer") != e.Server.URL || as.Get(t, "token_endpoint") != e.Server.URL+"/oauth/token" || as.Get(t, "client_id_metadata_document_supported") != true ||
		as.Header.Get("Cache-Control") != "no-store" || as.Header.Get("Access-Control-Allow-Origin") != "*" {
		t.Errorf("%s %v", as.Body, as.Header)
	}
	preflight := expectStatus(t, e.do("OPTIONS", "/oauth/token", "", ""), 204)
	if preflight.Header.Get("Access-Control-Allow-Origin") != "*" {
		t.Error(preflight.Header)
	}
	expectStatus(t, e.do("GET", "/.well-known/other", "", ""), 404)
}

func TestOAuthCodeFlow(t *testing.T) {
	e := newOAuthEnv(t)

	t.Run("registers, authorizes, exchanges with PKCE, calls /mcp, refreshes and revokes", func(t *testing.T) {
		reg := expectStatus(t, e.register(), 201)
		clientID := reg.Get(t, "client_id").(string)
		if !strings.HasPrefix(clientID, "opc_") {
			t.Error(clientID)
		}
		owner := e.CreateOperator(e.owner, "owner", nil)
		verifier, challenge := pkce()
		code := e.approvedCode(clientID, owner.Session, challenge)
		if r := e.exchange("grant_type", "authorization_code", "code", code, "client_id", clientID, "code_verifier", strings.Repeat("wrong", 10), "redirect_uri", callback); r.Get(t, "error") != "invalid_grant" {
			t.Errorf("%s", r.Body)
		}
		tokenRes := expectStatus(t, e.exchange("grant_type", "authorization_code", "code", code, "client_id", clientID, "code_verifier", verifier, "redirect_uri", callback, "resource", e.Server.URL+"/mcp"), 200)
		if tokenRes.Header.Get("Cache-Control") != "no-store" || tokenRes.Get(t, "token_type") != "Bearer" || tokenRes.Get(t, "expires_in") != 3600.0 || tokenRes.Get(t, "scope") != "read write:grants" {
			t.Errorf("%s", tokenRes.Body)
		}
		access, refresh := tokenRes.Get(t, "access_token").(string), tokenRes.Get(t, "refresh_token").(string)
		if !strings.HasPrefix(access, "oat_") || !strings.HasPrefix(refresh, "ort_") {
			t.Error(access, refresh)
		}
		// Only hashes are stored.
		if n := e.Count("oauth_grant WHERE access_hash = '" + access + "' OR refresh_hash = '" + refresh + "'"); n != 0 {
			t.Error("a token is stored in the clear")
		}
		names := toolNames(t, e.Env, access)
		if !containsStr(names, "grant_entitlement") || containsStr(names, "replay_webhook") {
			t.Error(names)
		}
		expectStatus(t, e.Admin("GET", "/me", tu.Auth{Token: access}, nil), 401) // OAuth tokens are only for /mcp

		refreshed := expectStatus(t, e.exchange("grant_type", "refresh_token", "refresh_token", refresh, "client_id", clientID), 200)
		if status, _ := e.mcpStatus(access); status != 401 {
			t.Error("rotated out")
		}
		if r := e.exchange("grant_type", "refresh_token", "refresh_token", refresh, "client_id", clientID); r.Get(t, "error") != "invalid_grant" {
			t.Errorf("%s", r.Body)
		}
		newAccess := refreshed.Get(t, "access_token").(string)
		if status, _ := e.mcpStatus(newAccess); status != 200 {
			t.Error(status)
		}
		narrowed := expectStatus(t, e.exchange("grant_type", "refresh_token", "refresh_token", refreshed.Get(t, "refresh_token").(string), "client_id", clientID, "scope", "read admin"), 200)
		if narrowed.Get(t, "scope") != "read" {
			t.Errorf("%s", narrowed.Body)
		}
		newAccess = narrowed.Get(t, "access_token").(string)

		grants := expectStatus(t, e.Admin("GET", "/oauth/grants", tu.Auth{Session: owner.Session}, nil), 200).Get(t, "grants").([]any)
		if len(grants) != 1 || prop(grants[0], "client_name") != "Claude" || jsobj.Stringify(prop(grants[0], "scopes")) != `["read"]` {
			t.Fatalf("%s", jsobj.Stringify(grants))
		}
		grantID := prop(grants[0], "id").(string)
		// The consent routes are for the dashboard, not access tokens.
		patToken := e.CreateToken(t, owner.Session, "read")
		expectStatus(t, e.Admin("POST", "/oauth/grants/"+grantID+"/revoke", tu.Auth{Token: patToken}, nil), 403)
		expectStatus(t, e.Admin("POST", "/oauth/grants/"+grantID+"/revoke", tu.Auth{Session: owner.Session}, nil), 200)
		expectStatus(t, e.Admin("POST", "/oauth/grants/"+grantID+"/revoke", tu.Auth{Session: owner.Session}, nil), 404)
		status, header := e.mcpStatus(newAccess)
		if status != 401 || !strings.Contains(header, `error="invalid_token"`) {
			t.Error(status, header)
		}
		var actions []string
		rows, err := e.Pool.Query(t.Context(), "SELECT action || ' ' || target FROM audit_log WHERE operator_id = $1 AND action LIKE 'oauth.%' ORDER BY id", owner.ID)
		if err != nil {
			t.Fatal(err)
		}
		for rows.Next() {
			var a string
			_ = rows.Scan(&a)
			actions = append(actions, a)
		}
		if strings.Join(actions, ",") != "oauth.authorized Claude,oauth.revoked Claude" {
			t.Error(actions)
		}
	})

	t.Run("a code works once; using it again ends what it created", func(t *testing.T) {
		clientID := e.register().Get(t, "client_id").(string)
		owner := e.CreateOperator(e.owner, "owner", nil)
		verifier, challenge := pkce()
		code := e.approvedCode(clientID, owner.Session, challenge)
		first := expectStatus(t, e.exchange("grant_type", "authorization_code", "code", code, "client_id", clientID, "code_verifier", verifier), 200)
		if status, _ := e.mcpStatus(first.Get(t, "access_token").(string)); status != 200 {
			t.Fatal(status)
		}
		if r := e.exchange("grant_type", "authorization_code", "code", code, "client_id", clientID, "code_verifier", verifier); r.Get(t, "error") != "invalid_grant" {
			t.Errorf("%s", r.Body)
		}
		if status, _ := e.mcpStatus(first.Get(t, "access_token").(string)); status != 401 {
			t.Error(status)
		}
	})

	t.Run("two exchanges of one code at once: one gets tokens, and they end", func(t *testing.T) {
		clientID := e.register().Get(t, "client_id").(string)
		owner := e.CreateOperator(e.owner, "owner", nil)
		verifier, challenge := pkce()
		code := e.approvedCode(clientID, owner.Session, challenge)
		var wg sync.WaitGroup
		var ok atomic.Int32
		var access atomic.Value
		for range 4 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				r := e.exchange("grant_type", "authorization_code", "code", code, "client_id", clientID, "code_verifier", verifier)
				if r.Status == 200 {
					ok.Add(1)
					access.Store(r.Get(t, "access_token").(string))
				}
			}()
		}
		wg.Wait()
		if ok.Load() != 1 {
			t.Fatalf("%d exchanges succeeded", ok.Load())
		}
		if status, _ := e.mcpStatus(access.Load().(string)); status != 401 {
			t.Error("the reuse should have ended the grant")
		}
	})

	t.Run("two refreshes with one token at once: one wins", func(t *testing.T) {
		clientID, _, tokens := e.connected()
		refresh := tokens.Get(t, "refresh_token").(string)
		var wg sync.WaitGroup
		var ok atomic.Int32
		for range 4 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if e.exchange("grant_type", "refresh_token", "refresh_token", refresh, "client_id", clientID).Status == 200 {
					ok.Add(1)
				}
			}()
		}
		wg.Wait()
		if ok.Load() != 1 {
			t.Errorf("%d refreshes succeeded", ok.Load())
		}
	})

	t.Run("a viewer can only approve what their role allows, and denying redirects with access_denied", func(t *testing.T) {
		clientID := e.register().Get(t, "client_id").(string)
		viewer := e.CreateOperator(e.owner, "viewer", nil)
		verifier, challenge := pkce()
		id := e.startAuthorize(clientID, challenge)
		view := expectStatus(t, e.Admin("GET", "/oauth/requests/"+id, tu.Auth{Session: viewer.Session}, nil), 200)
		if view.Get(t, "client", "name") != "Claude" || view.Get(t, "redirect_host") != "claude.ai" || view.Get(t, "localhost") != false {
			t.Errorf("%s", view.Body)
		}
		if got := jsobj.Stringify(view.Get(t, "scopes")); got != `[{"scope":"read","label":"Look up customers, purchases, charts, webhook deliveries and the audit log","allowed":true},{"scope":"write:grants","label":"Grant and revoke promotional entitlements","allowed":false}]` {
			t.Error(got)
		}
		decided := expectStatus(t, e.Admin("POST", "/oauth/requests/"+id+"/approve", tu.Auth{Session: viewer.Session}, jsobj.New("scopes", []any{"read", "write:grants"})), 200)
		back, _ := url.Parse(decided.Get(t, "redirect").(string))
		r := e.exchange("grant_type", "authorization_code", "code", back.Query().Get("code"), "client_id", clientID, "code_verifier", verifier)
		if r.Get(t, "scope") != "read" {
			t.Errorf("%s", r.Body)
		}

		id2 := e.startAuthorize(clientID, challenge)
		if r := e.Admin("POST", "/oauth/requests/"+id2+"/approve", tu.Auth{Session: viewer.Session}, jsobj.New("scopes", []any{"write:grants"})); r.Status != 400 || r.Get(t, "message") != "Pick at least one permission you have." {
			t.Errorf("%s", r.Body)
		}
		expectStatus(t, e.Admin("POST", "/oauth/requests/"+id2+"/maybe", tu.Auth{Session: viewer.Session}, nil), 404)
		denied := expectStatus(t, e.Admin("POST", "/oauth/requests/"+id2+"/deny", tu.Auth{Session: viewer.Session}, nil), 200)
		if u, _ := url.Parse(denied.Get(t, "redirect").(string)); u.Query().Get("error") != "access_denied" || !strings.HasSuffix(u.RawQuery, "&error=access_denied") {
			t.Error(u)
		}
		expectStatus(t, e.Admin("GET", "/oauth/requests/"+id2, tu.Auth{Session: viewer.Session}, nil), 404)
		patToken := e.CreateToken(t, viewer.Session, "read")
		id3 := e.startAuthorize(clientID, challenge)
		expectStatus(t, e.Admin("GET", "/oauth/requests/"+id3, tu.Auth{Token: patToken}, nil), 403)
	})

	t.Run("refuses bad requests", func(t *testing.T) {
		clientID := e.register().Get(t, "client_id").(string)
		_, challenge := pkce()
		// Before the redirect URI is trusted: an error page, no redirect.
		page := expectStatus(t, e.do("GET", e.authorizeURL("opc_unknown", challenge), "", ""), 400)
		if page.Header.Get("Content-Type") != "text/plain; charset=UTF-8" || page.Header.Get("Location") != "" {
			t.Error(page.Header)
		}
		expectStatus(t, e.do("GET", e.authorizeURL(clientID, challenge, "redirect_uri", "https://evil.example/cb"), "", ""), 400)
		errorOf := func(extra ...string) string {
			r := expectStatus(t, e.do("GET", e.authorizeURL(clientID, challenge, extra...), "", ""), 302)
			u, _ := url.Parse(r.Header.Get("Location"))
			if u.Query().Get("iss") != e.Server.URL || u.Query().Get("state") != "xyz" {
				t.Error(u)
			}
			return u.Query().Get("error")
		}
		for _, c := range []struct{ want, k, v string }{
			{"invalid_request", "code_challenge_method", "plain"},
			{"invalid_request", "code_challenge", "short"},
			{"invalid_target", "resource", "https://other.example/mcp"},
			{"invalid_scope", "scope", "admin everything"},
			{"unsupported_response_type", "response_type", "token"},
		} {
			if got := errorOf(c.k, c.v); got != c.want {
				t.Errorf("%s=%s: %s", c.k, c.v, got)
			}
		}
		expectStatus(t, e.register("redirect_uris", []any{"http://example.com/cb"}), 400) // http only on localhost
		expectStatus(t, e.register("redirect_uris", []any{"https://claude.ai/cb#frag"}), 400)
		expectStatus(t, e.register("redirect_uris", []any{"http://localhost:8123/cb"}), 201)
		expectStatus(t, e.register("redirect_uris", []any{"http://[::1]:8123/cb"}), 201)
		expectStatus(t, e.register("token_endpoint_auth_method", "client_secret_basic"), 400)
		expectStatus(t, e.register("grant_types", []any{"client_credentials"}), 400)
		expectStatus(t, e.do("POST", "/oauth/register", "application/json", "nope"), 400)
		if r := e.exchange("grant_type", "password"); r.Get(t, "error") != "unsupported_grant_type" {
			t.Errorf("%s", r.Body)
		}
		if r := e.exchange("grant_type", "authorization_code"); r.Get(t, "error") != "invalid_request" {
			t.Errorf("%s", r.Body)
		}
		// A token from /oauth/revoke is gone (form or JSON body).
		owner := e.CreateOperator(e.owner, "owner", nil)
		for _, asJSON := range []bool{false, true} {
			verifier, challenge := pkce()
			code := e.approvedCode(clientID, owner.Session, challenge)
			tokens := expectStatus(t, e.exchange("grant_type", "authorization_code", "code", code, "client_id", clientID, "code_verifier", verifier), 200)
			var revoked *tu.Response
			if asJSON {
				revoked = e.do("POST", "/oauth/revoke", "application/json", `{"token":"`+tokens.Get(t, "access_token").(string)+`"}`)
			} else {
				revoked = e.do("POST", "/oauth/revoke", "application/x-www-form-urlencoded", "token="+tokens.Get(t, "refresh_token").(string))
			}
			expectStatus(t, revoked, 200)
			if status, _ := e.mcpStatus(tokens.Get(t, "access_token").(string)); status != 401 {
				t.Error(status)
			}
		}
		expectStatus(t, e.do("POST", "/oauth/revoke", "application/x-www-form-urlencoded", "token=unknown"), 200)
	})
}

func TestOAuthExpiry(t *testing.T) {
	e := newOAuthEnv(t)

	t.Run("a sign-in request lasts 10 minutes", func(t *testing.T) {
		clientID := e.register().Get(t, "client_id").(string)
		owner := e.CreateOperator(e.owner, "owner", nil)
		_, challenge := pkce()
		id := e.startAuthorize(clientID, challenge)
		e.Clock.Add(11 * 60_000)
		expectStatus(t, e.Admin("GET", "/oauth/requests/"+id, tu.Auth{Session: owner.Session}, nil), 404)
		expectStatus(t, e.Admin("POST", "/oauth/requests/"+id+"/approve", tu.Auth{Session: owner.Session}, jsobj.New()), 404)
	})

	t.Run("an authorization code lasts 2 minutes", func(t *testing.T) {
		clientID := e.register().Get(t, "client_id").(string)
		owner := e.CreateOperator(e.owner, "owner", nil)
		verifier, challenge := pkce()
		code := e.approvedCode(clientID, owner.Session, challenge)
		e.Clock.Add(3 * 60_000)
		if r := e.exchange("grant_type", "authorization_code", "code", code, "client_id", clientID, "code_verifier", verifier); r.Get(t, "error") != "invalid_grant" {
			t.Errorf("%s", r.Body)
		}
	})

	t.Run("an access token lasts an hour; the refresh token still gets a new one", func(t *testing.T) {
		clientID, _, tokens := e.connected()
		access := tokens.Get(t, "access_token").(string)
		e.Clock.Add(59 * 60_000)
		if status, _ := e.mcpStatus(access); status != 200 {
			t.Error(status)
		}
		e.Clock.Add(2 * 60_000)
		status, header := e.mcpStatus(access)
		if status != 401 || !strings.Contains(header, `error="invalid_token"`) {
			t.Error(status, header)
		}
		refreshed := expectStatus(t, e.exchange("grant_type", "refresh_token", "refresh_token", tokens.Get(t, "refresh_token").(string), "client_id", clientID), 200)
		if status, _ := e.mcpStatus(refreshed.Get(t, "access_token").(string)); status != 200 {
			t.Error(status)
		}
	})

	t.Run("a refresh token lasts 30 days", func(t *testing.T) {
		clientID, _, tokens := e.connected()
		e.Clock.Add(31 * 86_400_000)
		if r := e.exchange("grant_type", "refresh_token", "refresh_token", tokens.Get(t, "refresh_token").(string), "client_id", clientID); r.Get(t, "error") != "invalid_grant" {
			t.Errorf("%s", r.Body)
		}
	})

	t.Run("a disabled operator's tokens stop working", func(t *testing.T) {
		clientID, owner, tokens := e.connected()
		expectStatus(t, e.Admin("PATCH", "/operators/"+owner.ID, tu.Auth{Token: e.owner}, jsobj.New("disabled", true)), 200)
		if status, _ := e.mcpStatus(tokens.Get(t, "access_token").(string)); status != 401 {
			t.Error(status)
		}
		if r := e.exchange("grant_type", "refresh_token", "refresh_token", tokens.Get(t, "refresh_token").(string), "client_id", clientID); r.Get(t, "error") != "invalid_grant" {
			t.Errorf("%s", r.Body)
		}
	})
}

// metadataHost serves Client ID Metadata Documents for client.example.
type metadataHost struct {
	mu    sync.Mutex
	docs  map[string]string
	count int
}

func (m *metadataHost) RoundTrip(r *http.Request) (*http.Response, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.count++
	doc, ok := m.docs[r.URL.String()]
	status := 200
	if !ok {
		status, doc = 404, "not found"
	}
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(doc)), Header: http.Header{"Content-Type": {"application/json"}}, Request: r}, nil
}

func TestClientIDMetadataDocuments(t *testing.T) {
	e := newOAuthEnv(t)
	host := &metadataHost{docs: map[string]string{
		metadataDoc: `{"client_id":"` + metadataDoc + `","client_name":"Example MCP Client","redirect_uris":["` + callback + `"]}`,
		"https://client.example/oauth/other.json": `{"client_id":"https://client.example/oauth/metadata.json","redirect_uris":["` + callback + `"]}`,
		"https://client.example/oauth/http.json":  `{"client_id":"https://client.example/oauth/http.json","redirect_uris":["http://example.com/cb"]}`,
	}}
	e.Deps.MetadataClient = &http.Client{Transport: host}

	t.Run("uses an HTTPS URL as the client_id, fetching, caching and checking the document", func(t *testing.T) {
		owner := e.CreateOperator(e.owner, "owner", nil)
		verifier, challenge := pkce()
		id := e.startAuthorize(metadataDoc, challenge)
		view := expectStatus(t, e.Admin("GET", "/oauth/requests/"+id, tu.Auth{Session: owner.Session}, nil), 200)
		if view.Get(t, "client", "name") != "Example MCP Client" || view.Get(t, "client", "metadata_url") != metadataDoc || view.Get(t, "client", "kind") != "metadata_document" {
			t.Errorf("%s", view.Body)
		}
		fetches := host.count
		code := e.approvedCode(metadataDoc, owner.Session, challenge)
		if host.count != fetches {
			t.Error("the document is cached for a day")
		}
		tokens := expectStatus(t, e.exchange("grant_type", "authorization_code", "code", code, "client_id", metadataDoc, "code_verifier", verifier), 200)
		if status, _ := e.mcpStatus(tokens.Get(t, "access_token").(string)); status != 200 {
			t.Error(status)
		}
		grants := e.Admin("GET", "/oauth/grants", tu.Auth{Session: owner.Session}, nil).Get(t, "grants").([]any)
		if prop(grants[0], "client_id") != metadataDoc {
			t.Errorf("%s", jsobj.Stringify(grants))
		}
		e.Clock.Add(86_400_000 + 1)
		e.startAuthorize(metadataDoc, challenge)
		if host.count != fetches+1 {
			t.Error("a day-old document is fetched again")
		}
	})

	t.Run("refuses a document whose client_id doesn't match its URL, or without usable redirects", func(t *testing.T) {
		_, challenge := pkce()
		bad := expectStatus(t, e.do("GET", e.authorizeURL("https://client.example/oauth/other.json", challenge), "", ""), 400)
		if !strings.Contains(string(bad.Body), "different client_id") {
			t.Errorf("%s", bad.Body)
		}
		bad = expectStatus(t, e.do("GET", e.authorizeURL("https://client.example/oauth/http.json", challenge), "", ""), 400)
		if !strings.Contains(string(bad.Body), "no usable redirect_uris") {
			t.Errorf("%s", bad.Body)
		}
		bad = expectStatus(t, e.do("GET", e.authorizeURL("https://client.example/oauth/missing.json", challenge), "", ""), 400)
		if !strings.Contains(string(bad.Body), "answered HTTP 404") {
			t.Errorf("%s", bad.Body)
		}
	})

	t.Run("refuses non-HTTPS or IP client IDs", func(t *testing.T) {
		_, challenge := pkce()
		before := host.count
		for _, id := range []string{"http://client.example/meta.json", "https://10.0.0.1/meta.json", "https://localhost/meta.json", "https://[::1]/meta.json", "https://client.example/"} {
			expectStatus(t, e.do("GET", e.authorizeURL(id, challenge), "", ""), 400)
		}
		if host.count != before {
			t.Error("fetched a refused client ID")
		}
	})

	t.Run("the real client only reaches public addresses", func(t *testing.T) {
		local := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, "{}") }))
		defer local.Close()
		if _, err := server.NewMetadataClient().Get(local.URL); err == nil || !strings.Contains(err.Error(), "non-public") {
			t.Errorf("reached %s: %v", local.URL, err)
		}
	})
}

func containsStr(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}
