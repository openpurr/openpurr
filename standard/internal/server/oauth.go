package server

// OAuth 2.1 for the MCP server, so clients that can't send a personal access token (Claude.ai
// connectors) can connect: the MCP authorization spec (2025-11-25). A port of
// lite/src/office/oauth.ts.
//
//	/.well-known/oauth-protected-resource[/mcp]   which authorization server protects /mcp (RFC 9728)
//	/.well-known/oauth-authorization-server       endpoints and capabilities (RFC 8414)
//	/oauth/register                               Dynamic Client Registration (RFC 7591), public clients only
//	/oauth/authorize                              checks the request, then hands off to the dashboard's consent screen
//	/oauth/token                                  authorization_code (PKCE S256 required) and refresh_token
//	/oauth/revoke                                 token revocation (RFC 7009)
//
// Clients are identified either by a Client ID Metadata Document (the client_id is an HTTPS URL to
// their metadata, fetched and cached) or by an ID from /oauth/register. Redirect URIs must match a
// registered one exactly and be HTTPS or localhost.
//
// Consent happens on the dashboard (/admin/oauth/consent, which calls /admin/v1/oauth/requests/*):
// the session cookie is SameSite=Strict, so it isn't sent on the cross-site navigation from the
// client, but it is on the dashboard's own requests.
//
// Tokens: access tokens (oat_..., 1 hour) work only at /mcp (the resource they were issued for);
// refresh tokens (ort_..., 30 days) rotate on every use. Only SHA-256 hashes are stored. What a
// token can do is the operator's role limited to the approved scopes, exactly like a personal
// access token.

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unicode/utf16"

	"github.com/jackc/pgx/v5"

	"github.com/openpurr/openpurr/standard/internal/authcrypto"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
)

// OAuthScopes are the scopes a client can ask for (a subset of the access token scopes).
var OAuthScopes = []string{"read", "write:grants", "write:webhooks", "write:config"}

var oauthScopeInfo = map[string]struct{ label, needs string }{
	"read":           {"Look up customers, purchases, charts, webhook deliveries and the audit log", permRead},
	"write:grants":   {"Grant and revoke promotional entitlements", permGrantsManage},
	"write:webhooks": {"Replay webhook events", permWebhooksReplay},
	"write:config":   {"Change the configuration: apps, products, entitlements, offerings and webhooks", permConfigManage},
}

const (
	OAuthAccessPrefix   = "oat_"
	oauthRefreshPrefix  = "ort_"
	oauthClientPrefix   = "opc_"
	oauthAccessTTL      = 3600_000
	oauthRefreshTTL     = 30 * 86_400_000
	oauthRequestTTL     = 10 * 60_000
	oauthCodeTTL        = 2 * 60_000
	oauthMetadataTTL    = 86_400_000
	oauthMetadataMax    = 64 * 1024
	oauthMetadataWait   = 5 * time.Second
	oauthGrantUseStamp  = 3600_000
	oauthRedirectMaxLen = 2000
)

// mcpResource is the MCP server's canonical URI: tokens are issued for, and only accepted at, it.
func (s *server) mcpResource(r *http.Request) string { return s.requestOrigin(r) + "/mcp" }

func (s *server) resourceMetadataURL(r *http.Request) string {
	return s.requestOrigin(r) + "/.well-known/oauth-protected-resource/mcp"
}

// --- URLs, the WHATWG way where it matters --------------------------------------------------------

// webURL parses an absolute URL as a browser would for the checks here: a scheme, and a host for
// http and https. Scheme and host are lowercased.
func webURL(raw string) (*url.URL, bool) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Opaque != "" {
		return nil, false
	}
	u.Scheme = strings.ToLower(u.Scheme)
	if (u.Scheme == "http" || u.Scheme == "https") && u.Host == "" {
		return nil, false
	}
	u.Host = strings.ToLower(u.Host)
	return u, true
}

// hostname is URL.hostname: IPv6 addresses keep their brackets.
func hostname(u *url.URL) string {
	h := u.Hostname()
	if strings.Contains(h, ":") {
		return "[" + h + "]"
	}
	return h
}

// urlOrigin is URL.origin for http(s): scheme, host and any non-default port.
func urlOrigin(u *url.URL) string {
	port := u.Port()
	if (u.Scheme == "https" && port == "443") || (u.Scheme == "http" && port == "80") {
		port = ""
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "null"
	}
	o := u.Scheme + "://" + hostname(u)
	if port != "" {
		o += ":" + port
	}
	return o
}

// urlHost is URL.host: the host name and any non-default port.
func urlHost(u *url.URL) string { return strings.TrimPrefix(urlOrigin(u), u.Scheme+"://") }

// urlString is URL.toString() for an https URL without credentials or fragment.
func urlString(u *url.URL) string {
	path := u.EscapedPath()
	if path == "" {
		path = "/"
	}
	s := urlOrigin(u) + path
	if u.RawQuery != "" || u.ForceQuery {
		s += "?" + u.RawQuery
	}
	return s
}

// sameResource compares URIs the way RFC 8707 asks: case-insensitive scheme and host, no trailing
// slash, and no fragment on the first.
func sameResource(a, b string) bool {
	x, okX := webURL(a)
	y, okY := webURL(b)
	if !okX || !okY {
		return false
	}
	return urlOrigin(x) == urlOrigin(y) && strings.TrimRight(x.EscapedPath(), "/") == strings.TrimRight(y.EscapedPath(), "/") && x.Fragment == ""
}

var localhostNames = []string{"localhost", "127.0.0.1", "[::1]"}

// validRedirect is a redirect URI clients may use: HTTPS, or http on localhost (native and CLI
// clients). No fragments.
func validRedirect(v any) bool {
	s, ok := v.(string)
	if !ok || jsobj.UTF16Len(s) > oauthRedirectMaxLen {
		return false
	}
	u, ok := webURL(s)
	if !ok || u.Fragment != "" {
		return false
	}
	if u.Scheme == "https" {
		return true
	}
	return u.Scheme == "http" && contains(localhostNames, hostname(u))
}

func isLocalhost(uri string) bool {
	u, ok := webURL(uri)
	return ok && contains(localhostNames, hostname(u))
}

// s256 is the PKCE S256 challenge for a verifier.
func s256(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// slice16 is JavaScript's s.slice(0, n): the first n UTF-16 code units (a split pair is dropped).
func slice16(s string, n int) string {
	if jsobj.UTF16Len(s) <= n {
		return s
	}
	units := utf16.Encode([]rune(s))[:n]
	if len(units) > 0 && utf16.IsSurrogate(rune(units[len(units)-1])) && units[len(units)-1] < 0xdc00 {
		units = units[:len(units)-1]
	}
	return string(utf16.Decode(units))
}

// withParams sets query parameters on a URL the way URLSearchParams.set does: the existing query
// is re-serialized as application/x-www-form-urlencoded, a key that's there is replaced in place,
// and new keys are appended in order.
func withParams(raw string, kv ...string) string {
	base, query := raw, ""
	if i := strings.IndexByte(raw, '?'); i >= 0 {
		base, query = raw[:i], raw[i+1:]
	}
	type pair struct{ k, v string }
	var list []pair
	for _, part := range strings.Split(query, "&") {
		if part == "" {
			continue
		}
		k, v, _ := strings.Cut(part, "=")
		list = append(list, pair{formDecode(k), formDecode(v)})
	}
	for i := 0; i+1 < len(kv); i += 2 {
		k, v := kv[i], kv[i+1]
		found := -1
		kept := list[:0]
		for _, p := range list {
			if p.k == k {
				if found >= 0 {
					continue
				}
				found = len(kept)
				p.v = v
			}
			kept = append(kept, p)
		}
		list = kept
		if found < 0 {
			list = append(list, pair{k, v})
		}
	}
	parts := make([]string, len(list))
	for i, p := range list {
		parts[i] = formEncode(p.k) + "=" + formEncode(p.v)
	}
	if len(parts) == 0 {
		return base
	}
	return base + "?" + strings.Join(parts, "&")
}

func formDecode(s string) string {
	v, err := url.QueryUnescape(s)
	if err != nil {
		return strings.ReplaceAll(s, "+", " ")
	}
	return v
}

// formEncode is the application/x-www-form-urlencoded serializer (URLSearchParams.toString).
func formEncode(s string) string {
	const hex = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '*', c == '-', c == '.', c == '_':
			b.WriteByte(c)
		case c == ' ':
			b.WriteByte('+')
		default:
			b.WriteByte('%')
			b.WriteByte(hex[c>>4])
			b.WriteByte(hex[c&15])
		}
	}
	return b.String()
}

// --- responses -------------------------------------------------------------------------------------

// CORS for the metadata and token endpoints (no cookies involved), for browser-based clients.
func setCORS(h http.Header) {
	h.Set("Access-Control-Allow-Origin", "*")
	h.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	h.Set("Access-Control-Allow-Headers", "Content-Type, Authorization, MCP-Protocol-Version")
	h.Set("Access-Control-Max-Age", "86400")
}

func oauthJSON(w http.ResponseWriter, status int, body any, extra ...string) {
	h := w.Header()
	setCORS(h)
	h.Set("Cache-Control", "no-store")
	for i := 0; i+1 < len(extra); i += 2 {
		h.Set(extra[i], extra[i+1])
	}
	writeJSON(w, status, body)
}

func oauthError(w http.ResponseWriter, status int, code, description string) {
	oauthJSON(w, status, jsobj.New("error", code, "error_description", description))
}

func writeText(w http.ResponseWriter, status int, text string, extra ...string) {
	h := w.Header()
	for i := 0; i+1 < len(extra); i += 2 {
		h.Set(extra[i], extra[i+1])
	}
	h.Set("Content-Type", "text/plain; charset=UTF-8")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, text)
}

func redirect(w http.ResponseWriter, location string) {
	w.Header().Set("Location", location)
	w.WriteHeader(http.StatusFound)
}

func notFoundJSON(w http.ResponseWriter) {
	writeJSON(w, http.StatusNotFound, jsobj.New("code", 0.0, "message", "Not found"))
}

// --- discovery -------------------------------------------------------------------------------------

// wellKnown serves /.well-known/*.
func (s *server) wellKnown(w http.ResponseWriter, r *http.Request) {
	path := r.URL.EscapedPath()
	if r.Method == http.MethodOptions {
		setCORS(w.Header())
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		notFoundJSON(w)
		return
	}
	origin := s.requestOrigin(r)
	switch path {
	case "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp":
		oauthJSON(w, http.StatusOK, jsobj.New(
			"resource", s.mcpResource(r),
			"authorization_servers", []any{origin},
			"scopes_supported", stringsToAny(OAuthScopes),
			"bearer_methods_supported", []any{"header"},
			"resource_name", "openpurr",
		))
	case "/.well-known/oauth-authorization-server":
		oauthJSON(w, http.StatusOK, jsobj.New(
			"issuer", origin,
			"authorization_endpoint", origin+"/oauth/authorize",
			"token_endpoint", origin+"/oauth/token",
			"registration_endpoint", origin+"/oauth/register",
			"revocation_endpoint", origin+"/oauth/revoke",
			"response_types_supported", []any{"code"},
			"grant_types_supported", []any{"authorization_code", "refresh_token"},
			"code_challenge_methods_supported", []any{"S256"},
			"token_endpoint_auth_methods_supported", []any{"none"},
			"revocation_endpoint_auth_methods_supported", []any{"none"},
			"scopes_supported", stringsToAny(OAuthScopes),
			"client_id_metadata_document_supported", true,
			"authorization_response_iss_parameter_supported", true,
		))
	default:
		notFoundJSON(w)
	}
}

// --- clients ---------------------------------------------------------------------------------------

type oauthClient struct {
	id           string
	kind         string // registered | metadata_document
	name         string
	clientURI    *string
	redirectURIs []string
}

type clientError struct{ msg string }

func (e *clientError) Error() string { return e.msg }

var digitsAndDots = regexp.MustCompile(`^[\d.]+$`)

// metadataURL is a Client ID Metadata Document URL: HTTPS with a path, a real host name (no IPs or
// localhost).
func metadataURL(clientID string) *url.URL {
	u, ok := webURL(clientID)
	if !ok || u.Scheme != "https" || u.EscapedPath() == "" || u.EscapedPath() == "/" || u.User != nil || u.Fragment != "" {
		return nil
	}
	h := hostname(u)
	if h == "localhost" || digitsAndDots.MatchString(h) || strings.HasPrefix(h, "[") {
		return nil
	}
	return u
}

// NewMetadataClient is the HTTP client for Client ID Metadata Documents: no redirects, five
// seconds, and only public addresses (a client_id is any HTTPS URL a stranger chooses, so it must
// not reach this server's own network).
func NewMetadataClient() *http.Client {
	dialer := &net.Dialer{Timeout: oauthMetadataWait, Control: func(_, address string, _ syscall.RawConn) error {
		host, _, err := net.SplitHostPort(address)
		if err != nil {
			return err
		}
		ip := net.ParseIP(host)
		if ip == nil || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
			return errors.New("refusing to connect to a non-public address")
		}
		return nil
	}}
	return &http.Client{
		Timeout:       oauthMetadataWait,
		Transport:     &http.Transport{DialContext: dialer.DialContext, TLSHandshakeTimeout: oauthMetadataWait, Proxy: nil},
		CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("redirects aren't followed") },
	}
}

func (s *server) fetchMetadataDocument(ctx context.Context, u *url.URL) (*oauthClient, error) {
	id := urlString(u)
	ctx, cancel := context.WithTimeout(ctx, oauthMetadataWait)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, id, nil)
	if err != nil {
		return nil, &clientError{"Couldn't fetch the client's metadata document at " + id + "."}
	}
	req.Header.Set("Accept", "application/json")
	res, err := s.MetadataClient.Do(req)
	if err != nil {
		return nil, &clientError{"Couldn't fetch the client's metadata document at " + id + "."}
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, &clientError{"The client's metadata document at " + id + " answered HTTP " + strconv.Itoa(res.StatusCode) + "."}
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, oauthMetadataMax+1))
	if err != nil {
		return nil, &clientError{"Couldn't fetch the client's metadata document at " + id + "."}
	}
	if len(body) > oauthMetadataMax {
		return nil, &clientError{"The client's metadata document is too large."}
	}
	doc, err := jsobj.Parse(body)
	if err != nil {
		return nil, &clientError{"The client's metadata document isn't valid JSON."}
	}
	if v, _ := jsobj.Prop(doc, "client_id"); v != id {
		return nil, &clientError{"The client's metadata document has a different client_id than its URL."}
	}
	var redirects []string
	if raw, _ := jsobj.Prop(doc, "redirect_uris"); raw != nil {
		if list, ok := raw.([]any); ok {
			for _, e := range list {
				if validRedirect(e) {
					redirects = append(redirects, e.(string))
				}
			}
		}
	}
	if len(redirects) == 0 {
		return nil, &clientError{"The client's metadata document has no usable redirect_uris (HTTPS or localhost)."}
	}
	name := hostname(u)
	if v, _ := jsobj.Prop(doc, "client_name"); v != nil {
		if str, ok := v.(string); ok && jsobj.Trim(str) != "" {
			name = slice16(jsobj.Trim(str), 100)
		}
	}
	return &oauthClient{id: id, kind: "metadata_document", name: name, clientURI: clientURIOf(doc), redirectURIs: redirects}, nil
}

func clientURIOf(doc any) *string {
	v, _ := jsobj.Prop(doc, "client_uri")
	if str, ok := v.(string); ok && strings.HasPrefix(str, "https://") {
		out := slice16(str, 500)
		return &out
	}
	return nil
}

// resolveClient is the client for a client_id: a registered one, or a metadata document (cached
// for a day). Nil when it's neither.
func (s *server) resolveClient(ctx context.Context, clientID string, now int64) (*oauthClient, error) {
	var c oauthClient
	var redirects string
	var fetchedAt *int64
	err := s.Pool.QueryRow(ctx, "SELECT id, kind, name, client_uri, redirect_uris, fetched_at FROM oauth_client WHERE id = $1", clientID).
		Scan(&c.id, &c.kind, &c.name, &c.clientURI, &redirects, &fetchedAt)
	found := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if found && (c.kind == "registered" || (fetchedAt != nil && *fetchedAt != 0 && now-*fetchedAt < oauthMetadataTTL)) {
		c.redirectURIs = parseStringList(redirects)
		return &c, nil
	}
	u := metadataURL(clientID)
	if u == nil {
		return nil, nil
	}
	client, err := s.fetchMetadataDocument(ctx, u)
	if err != nil {
		return nil, err
	}
	if _, err := s.Pool.Exec(ctx,
		`INSERT INTO oauth_client (id, kind, name, client_uri, redirect_uris, created_at, fetched_at) VALUES ($1, 'metadata_document', $2, $3, $4, $5, $5)
		 ON CONFLICT (id) DO UPDATE SET name = excluded.name, client_uri = excluded.client_uri, redirect_uris = excluded.redirect_uris, fetched_at = excluded.fetched_at`,
		client.id, client.name, client.clientURI, jsobj.Stringify(stringsToAny(client.redirectURIs)), now); err != nil {
		return nil, err
	}
	return client, nil
}

func parseStringList(raw string) []string {
	out := []string{}
	if v, err := jsobj.Parse([]byte(raw)); err == nil {
		if list, ok := v.([]any); ok {
			for _, e := range list {
				if s, ok := e.(string); ok {
					out = append(out, s)
				}
			}
		}
	}
	return out
}

// --- endpoints -------------------------------------------------------------------------------------

// oauth serves /oauth/*.
func (s *server) oauth(w http.ResponseWriter, r *http.Request) {
	path := r.URL.EscapedPath()
	if r.Method == http.MethodOptions {
		setCORS(w.Header())
		w.WriteHeader(http.StatusNoContent)
		return
	}
	switch {
	case path == "/oauth/register" && r.Method == http.MethodPost:
		s.oauthRegister(w, r)
	case path == "/oauth/authorize" && (r.Method == http.MethodGet || r.Method == http.MethodHead):
		s.oauthAuthorize(w, r)
	case path == "/oauth/token" && r.Method == http.MethodPost:
		s.oauthToken(w, r)
	case path == "/oauth/revoke" && r.Method == http.MethodPost:
		s.oauthRevoke(w, r)
	default:
		notFoundJSON(w)
	}
}

// formParams is the token and revocation endpoints' body (form or JSON) as an object of strings:
// a repeated form field keeps its last value, as Hono's parseBody does.
func formParams(r *http.Request) map[string]string {
	out := map[string]string{}
	raw, _ := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes+1))
	if len(raw) > maxBodyBytes {
		return out
	}
	ct := r.Header.Get("Content-Type")
	if strings.Contains(ct, "application/json") {
		if v, err := jsobj.Parse(raw); err == nil {
			if o, ok := v.(*jsobj.Object); ok {
				for _, k := range o.Keys() {
					if v, _ := o.Get(k); v != nil {
						if s, ok := v.(string); ok {
							out[k] = s
						}
					}
				}
			}
		}
		return out
	}
	media, _, _ := mime.ParseMediaType(ct)
	switch media {
	case "application/x-www-form-urlencoded":
		// Pairs with bad percent-encoding are skipped; the rest are read.
		values, _ := url.ParseQuery(string(raw))
		for k, list := range values {
			if len(list) > 0 {
				out[k] = list[len(list)-1]
			}
		}
	case "multipart/form-data":
		req := &http.Request{Header: http.Header{"Content-Type": {ct}}, Body: io.NopCloser(strings.NewReader(string(raw)))}
		if err := req.ParseMultipartForm(maxBodyBytes); err == nil && req.MultipartForm != nil {
			for k, list := range req.MultipartForm.Value {
				if len(list) > 0 {
					out[k] = list[len(list)-1]
				}
			}
		}
	}
	return out
}

func (s *server) oauthRegister(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if ip := s.clientIP(r); ip != "" && s.Limiters.IP != nil && !s.Limiters.IP.Allow(ctx, "oauth-register:"+ip) {
		oauthError(w, http.StatusTooManyRequests, "slow_down", "Too many registrations; try again in a minute.")
		return
	}
	raw, _ := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes+1))
	var b any
	parsed := false
	if len(raw) <= maxBodyBytes {
		if v, err := jsobj.Parse(raw); err == nil {
			b, parsed = v, true
		}
	}
	_, isList := b.([]any)
	if !parsed || !(jsobj.IsObject(b) || isList) {
		oauthError(w, http.StatusBadRequest, "invalid_client_metadata", "Send the client metadata as JSON.")
		return
	}
	redirectsRaw, _ := jsobj.Prop(b, "redirect_uris")
	redirects, ok := redirectsRaw.([]any)
	valid := ok && len(redirects) > 0 && len(redirects) <= 10
	for _, e := range redirects {
		valid = valid && validRedirect(e)
	}
	if !valid {
		oauthError(w, http.StatusBadRequest, "invalid_redirect_uri", "redirect_uris must list 1 to 10 HTTPS or localhost URLs.")
		return
	}
	if method, present := jsobj.Prop(b, "token_endpoint_auth_method"); present && method != "none" {
		oauthError(w, http.StatusBadRequest, "invalid_client_metadata", `Only public clients are supported (token_endpoint_auth_method "none"), with PKCE.`)
		return
	}
	grantTypes := any([]any{"authorization_code", "refresh_token"})
	if v, present := jsobj.Prop(b, "grant_types"); present && v != nil {
		grantTypes = v
	}
	list, isArr := grantTypes.([]any)
	okGrants := isArr
	for _, g := range list {
		okGrants = okGrants && (g == "authorization_code" || g == "refresh_token")
	}
	if !okGrants {
		oauthError(w, http.StatusBadRequest, "invalid_client_metadata", "grant_types may only include authorization_code and refresh_token.")
		return
	}
	name := "Unnamed MCP client"
	if v, _ := jsobj.Prop(b, "client_name"); v != nil {
		if str, ok := v.(string); ok && jsobj.Trim(str) != "" {
			name = slice16(jsobj.Trim(str), 100)
		}
	}
	clientURI := clientURIOf(b)
	id := oauthClientPrefix + authcrypto.RandomToken()
	now := s.Clock.Now()
	if _, err := s.Pool.Exec(ctx, "INSERT INTO oauth_client (id, kind, name, client_uri, redirect_uris, created_at) VALUES ($1, 'registered', $2, $3, $4, $5)",
		id, name, clientURI, jsobj.Stringify(redirects), now); err != nil {
		s.internalError(w, r, err)
		return
	}
	out := jsobj.New("client_id", id, "client_id_issued_at", float64(now/1000), "client_name", name)
	if clientURI != nil {
		out.Set("client_uri", *clientURI)
	}
	out.Set("redirect_uris", redirects)
	out.Set("grant_types", grantTypes)
	out.Set("response_types", []any{"code"})
	out.Set("token_endpoint_auth_method", "none")
	oauthJSON(w, http.StatusCreated, out)
}

var codeChallengePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43,128}$`)

func (s *server) oauthAuthorize(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	now := s.Clock.Now()
	q := r.URL.Query()
	has := func(k string) bool { _, ok := q[k]; return ok }
	// Until the client and redirect URI are known good, errors are shown here, never redirected.
	page := func(message string) {
		writeText(w, http.StatusBadRequest, "openpurr couldn't start signing in this app: "+message, "Cache-Control", "no-store")
	}
	clientID := q.Get("client_id")
	if clientID == "" {
		page("client_id is missing.")
		return
	}
	client, err := s.resolveClient(ctx, clientID, now)
	if err != nil {
		var ce *clientError
		if errors.As(err, &ce) {
			page(ce.msg)
			return
		}
		s.internalError(w, r, err)
		return
	}
	if client == nil {
		page("this app isn't registered (unknown client_id).")
		return
	}
	redirectURI, hasRedirect := q.Get("redirect_uri"), has("redirect_uri")
	if !hasRedirect && len(client.redirectURIs) == 1 {
		redirectURI, hasRedirect = client.redirectURIs[0], true
	}
	if !hasRedirect || redirectURI == "" || !contains(client.redirectURIs, redirectURI) {
		page("the redirect_uri doesn't match one the app registered.")
		return
	}
	origin := s.requestOrigin(r)
	back := func(kv ...string) {
		if has("state") {
			kv = append(kv, "state", q.Get("state"))
		}
		kv = append(kv, "iss", origin)
		redirect(w, withParams(redirectURI, kv...))
	}
	if q.Get("response_type") != "code" {
		back("error", "unsupported_response_type", "error_description", "Only response_type=code is supported.")
		return
	}
	challenge := q.Get("code_challenge")
	if challenge == "" || q.Get("code_challenge_method") != "S256" {
		back("error", "invalid_request", "error_description", "PKCE with code_challenge_method=S256 is required.")
		return
	}
	if !codeChallengePattern.MatchString(challenge) {
		back("error", "invalid_request", "error_description", "code_challenge isn't a valid S256 challenge.")
		return
	}
	resource := s.mcpResource(r)
	if has("resource") && !sameResource(q.Get("resource"), resource) {
		back("error", "invalid_target", "error_description", "This server only issues tokens for "+resource+".")
		return
	}
	var requested []string
	if scope := q.Get("scope"); scope != "" {
		for _, sc := range strings.FieldsFunc(scope, isJSSpace) {
			if contains(OAuthScopes, sc) && !contains(requested, sc) {
				requested = append(requested, sc)
			}
		}
	} else {
		requested = append(requested, OAuthScopes...)
	}
	if len(requested) == 0 {
		back("error", "invalid_scope", "error_description", "Scopes: "+strings.Join(OAuthScopes, " ")+".")
		return
	}
	var state *string
	if has("state") {
		v := q.Get("state")
		state = &v
	}
	id := authcrypto.RandomToken()
	if _, err := s.Pool.Exec(ctx,
		`INSERT INTO oauth_request (id, client_id, redirect_uri, state, code_challenge, scope, resource, created_at, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		id, client.id, redirectURI, state, challenge, strings.Join(requested, " "), resource, now, now+oauthRequestTTL); err != nil {
		s.internalError(w, r, err)
		return
	}
	redirect(w, "/admin/oauth/consent?request="+jsobj.EncodeURIComponent(id))
}

// isJSSpace is \s in a JavaScript regular expression.
func isJSSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
		return true
	}
	return r >= 0x2000 && r <= 0x200A
}

type oauthTokens struct {
	access, refresh               string
	accessHash, refreshHash       string
	accessExpires, refreshExpires int64
}

// newTokens is a fresh access and refresh token pair (stored as hashes).
func newTokens(now int64) oauthTokens {
	access := OAuthAccessPrefix + authcrypto.RandomToken()
	refresh := oauthRefreshPrefix + authcrypto.RandomToken()
	return oauthTokens{access: access, refresh: refresh, accessHash: authcrypto.SHA256Hex(access), refreshHash: authcrypto.SHA256Hex(refresh),
		accessExpires: now + oauthAccessTTL, refreshExpires: now + oauthRefreshTTL}
}

func tokenResponse(w http.ResponseWriter, t oauthTokens, scopes []string) {
	oauthJSON(w, http.StatusOK, jsobj.New("access_token", t.access, "token_type", "Bearer", "expires_in", float64(oauthAccessTTL/1000),
		"refresh_token", t.refresh, "scope", strings.Join(scopes, " ")), "Pragma", "no-cache")
}

// errOAuth is a refusal from inside a transaction.
type errOAuth struct{ code, msg string }

func (e *errOAuth) Error() string { return e.msg }

func (s *server) oauthToken(w http.ResponseWriter, r *http.Request) {
	p := formParams(r)
	ctx := r.Context()
	now := s.Clock.Now()
	has := func(k string) bool { _, ok := p[k]; return ok }
	switch p["grant_type"] {
	case "authorization_code":
		if p["code"] == "" || p["client_id"] == "" || p["code_verifier"] == "" {
			oauthError(w, http.StatusBadRequest, "invalid_request", "code, client_id and code_verifier are required.")
			return
		}
		var t oauthTokens
		var scopes []string
		// One transaction with the request row locked: a code can't be exchanged twice at once,
		// and a second use always finds (and ends) what the first created.
		var reused *string
		err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
			var id, clientID, redirectURI, challenge, resource string
			var expiresAt int64
			var operatorID, granted, grantID *string
			var usedAt *int64
			err := tx.QueryRow(ctx,
				`SELECT id, client_id, redirect_uri, code_challenge, resource, expires_at, operator_id, granted_scope, used_at, grant_id
				 FROM oauth_request WHERE code_hash = $1 FOR UPDATE`, authcrypto.SHA256Hex(p["code"])).
				Scan(&id, &clientID, &redirectURI, &challenge, &resource, &expiresAt, &operatorID, &granted, &usedAt, &grantID)
			if errors.Is(err, pgx.ErrNoRows) {
				return &errOAuth{"invalid_grant", "Unknown or expired authorization code."}
			}
			if err != nil {
				return err
			}
			if usedAt != nil {
				// A code used twice may have been stolen: end what the first use created.
				reused = grantID
				return &errOAuth{"invalid_grant", "This authorization code was already used."}
			}
			if expiresAt < now {
				return &errOAuth{"invalid_grant", "The authorization code expired; sign in again."}
			}
			if clientID != p["client_id"] {
				return &errOAuth{"invalid_grant", "The code was issued to another client."}
			}
			if has("redirect_uri") && p["redirect_uri"] != redirectURI {
				return &errOAuth{"invalid_grant", "redirect_uri doesn't match the authorization request."}
			}
			if has("resource") && !sameResource(p["resource"], resource) {
				return &errOAuth{"invalid_target", "resource doesn't match the authorization request."}
			}
			if subtle.ConstantTimeCompare([]byte(s256(p["code_verifier"])), []byte(challenge)) != 1 {
				return &errOAuth{"invalid_grant", "code_verifier doesn't match the code_challenge (PKCE)."}
			}
			var active bool
			if operatorID != nil {
				if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM operator WHERE id = $1 AND disabled_at IS NULL)", *operatorID).Scan(&active); err != nil {
					return err
				}
			}
			if !active || granted == nil {
				return &errOAuth{"invalid_grant", "The operator who approved this is no longer active."}
			}
			scopes = strings.Split(*granted, " ")
			t = newTokens(now)
			newGrant := ledger.NewUUID()
			if _, err := tx.Exec(ctx,
				`INSERT INTO oauth_grant (id, client_id, operator_id, scopes, resource, access_hash, access_expires_at, refresh_hash, refresh_expires_at, created_at)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
				newGrant, clientID, *operatorID, jsobj.Stringify(stringsToAny(scopes)), resource, t.accessHash, t.accessExpires, t.refreshHash, t.refreshExpires, now); err != nil {
				return err
			}
			_, err = tx.Exec(ctx, "UPDATE oauth_request SET used_at = $1, grant_id = $2 WHERE id = $3", now, newGrant, id)
			return err
		})
		var refused *errOAuth
		if errors.As(err, &refused) {
			if reused != nil {
				if _, err := s.Pool.Exec(ctx, "UPDATE oauth_grant SET revoked_at = $1 WHERE id = $2 AND revoked_at IS NULL", now, *reused); err != nil {
					s.internalError(w, r, err)
					return
				}
			}
			oauthError(w, http.StatusBadRequest, refused.code, refused.msg)
			return
		}
		if err != nil {
			s.internalError(w, r, err)
			return
		}
		tokenResponse(w, t, scopes)
	case "refresh_token":
		if p["refresh_token"] == "" || p["client_id"] == "" {
			oauthError(w, http.StatusBadRequest, "invalid_request", "refresh_token and client_id are required.")
			return
		}
		hash := authcrypto.SHA256Hex(p["refresh_token"])
		var id, clientID, scopesRaw string
		err := s.Pool.QueryRow(ctx,
			`SELECT g.id, g.client_id, g.scopes FROM oauth_grant g JOIN operator o ON o.id = g.operator_id
			 WHERE g.refresh_hash = $1 AND g.revoked_at IS NULL AND g.refresh_expires_at > $2 AND o.disabled_at IS NULL`, hash, now).
			Scan(&id, &clientID, &scopesRaw)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			s.internalError(w, r, err)
			return
		}
		if err != nil || clientID != p["client_id"] {
			oauthError(w, http.StatusBadRequest, "invalid_grant", "Unknown, expired or revoked refresh token.")
			return
		}
		scopes := parseStringList(scopesRaw)
		if p["scope"] != "" {
			var narrower []string
			for _, sc := range strings.FieldsFunc(p["scope"], isJSSpace) {
				if contains(scopes, sc) && !contains(narrower, sc) {
					narrower = append(narrower, sc)
				}
			}
			if len(narrower) == 0 {
				oauthError(w, http.StatusBadRequest, "invalid_scope", "Refresh can only keep or narrow the approved scopes.")
				return
			}
			scopes = narrower
		}
		t := newTokens(now)
		// Rotation: the old refresh token stops working now (and only one of two concurrent
		// refreshes with it succeeds).
		tag, err := s.Pool.Exec(ctx,
			`UPDATE oauth_grant SET access_hash = $1, access_expires_at = $2, refresh_hash = $3, refresh_expires_at = $4, scopes = $5
			 WHERE id = $6 AND refresh_hash = $7 AND revoked_at IS NULL`,
			t.accessHash, t.accessExpires, t.refreshHash, t.refreshExpires, jsobj.Stringify(stringsToAny(scopes)), id, hash)
		if err != nil {
			s.internalError(w, r, err)
			return
		}
		if tag.RowsAffected() == 0 {
			oauthError(w, http.StatusBadRequest, "invalid_grant", "Unknown, expired or revoked refresh token.")
			return
		}
		tokenResponse(w, t, scopes)
	default:
		oauthError(w, http.StatusBadRequest, "unsupported_grant_type", "grant_type must be authorization_code or refresh_token.")
	}
}

// oauthRevoke is RFC 7009: always 200, whether or not the token was known.
func (s *server) oauthRevoke(w http.ResponseWriter, r *http.Request) {
	p := formParams(r)
	if token := p["token"]; token != "" {
		hash := authcrypto.SHA256Hex(token)
		if _, err := s.Pool.Exec(r.Context(), "UPDATE oauth_grant SET revoked_at = $1 WHERE (access_hash = $2 OR refresh_hash = $2) AND revoked_at IS NULL",
			s.Clock.Now(), hash); err != nil {
			s.internalError(w, r, err)
			return
		}
	}
	setCORS(w.Header())
	w.WriteHeader(http.StatusOK)
}

// --- used by the MCP server and the admin API ------------------------------------------------------

// oauthTokenOwner is the principal behind an OAuth access token, if it's valid for resource.
func (s *server) oauthTokenOwner(ctx context.Context, token, resource string, now int64) (*principal, error) {
	var grantID, scopes, grantResource string
	var lastUsed *int64
	o, err := findOperator(ctx, s.Pool,
		`SELECT g.id, g.scopes, g.resource, g.last_used_at, `+operatorColumns+` FROM oauth_grant g JOIN operator o ON o.id = g.operator_id
		 WHERE g.access_hash = $1 AND g.revoked_at IS NULL AND g.access_expires_at > $2 AND o.disabled_at IS NULL`,
		[]any{authcrypto.SHA256Hex(token), now}, &grantID, &scopes, &grantResource, &lastUsed)
	if err != nil || o == nil {
		return nil, err
	}
	if !sameResource(grantResource, resource) {
		return nil, nil // audience: only tokens issued for this server
	}
	if lastUsed == nil || now-*lastUsed > oauthGrantUseStamp {
		id := grantID
		s.Deferred.Go("stamp oauth grant use", func(ctx context.Context) error {
			_, err := s.Pool.Exec(ctx, "UPDATE oauth_grant SET last_used_at = $1 WHERE id = $2", s.Clock.Now(), id)
			return err
		})
	}
	return principalOf(o, "token", &grantID, parseStringList(scopes)), nil
}

// pendingOAuth is the consent screen's view of a pending authorization (nil when there's none).
func (q *adminReq) pendingOAuth(id string) (*jsobj.Object, string, error) {
	var reqID, redirectURI, scope, clientID, kind, name string
	var expiresAt int64
	var codeHash, clientURI *string
	err := q.s.Pool.QueryRow(q.ctx,
		`SELECT r.id, r.redirect_uri, r.scope, r.expires_at, r.code_hash, c.id, c.kind, c.name, c.client_uri
		 FROM oauth_request r JOIN oauth_client c ON c.id = r.client_id WHERE r.id = $1`, id).
		Scan(&reqID, &redirectURI, &scope, &expiresAt, &codeHash, &clientID, &kind, &name, &clientURI)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", err
	}
	if codeHash != nil || expiresAt < q.now {
		return nil, "", nil
	}
	var metadataURL any
	if kind == "metadata_document" {
		metadataURL = clientID
	}
	host := ""
	if u, ok := webURL(redirectURI); ok {
		host = urlHost(u)
	}
	scopes := []any{}
	for _, sc := range strings.Split(scope, " ") {
		info, known := oauthScopeInfo[sc]
		label, needs := sc, permRead
		if known {
			label, needs = info.label, info.needs
		}
		scopes = append(scopes, jsobj.New("scope", sc, "label", label, "allowed", q.p.can(needs)))
	}
	return jsobj.New(
		"id", reqID,
		"client", jsobj.New("name", name, "uri", strOrNull(clientURI), "kind", kind, "metadata_url", metadataURL),
		"redirect_host", host,
		"redirect_uri", redirectURI,
		"localhost", isLocalhost(redirectURI),
		"scopes", scopes,
	), name, nil
}

const oauthRequestGone = "Sign-in request (it may have expired: start again from the app)"

// sessionOnly: the consent screen and revoking connected apps are for the dashboard.
func sessionOnly(q *adminReq) bool {
	if q.p.via != "session" {
		q.forbidden("This is for the dashboard (signed in), not access tokens.")
		return false
	}
	return true
}

func adminOAuthRequest(q *adminReq) {
	if !sessionOnly(q) {
		return
	}
	pending, _, err := q.pendingOAuth(q.params["id"])
	if err != nil {
		q.internal(err)
		return
	}
	if pending == nil {
		q.notFound(oauthRequestGone)
		return
	}
	q.json(http.StatusOK, pending)
}

// adminOAuthDecide approves (with the chosen scopes) or denies a pending authorization, and says
// where to send the browser.
func adminOAuthDecide(q *adminReq) {
	decision := q.params["decision"]
	if decision != "approve" && decision != "deny" {
		q.notFound("Endpoint")
		return
	}
	if !sessionOnly(q) {
		return
	}
	id := q.params["id"]
	pending, clientName, err := q.pendingOAuth(id)
	if err != nil {
		q.internal(err)
		return
	}
	if pending == nil {
		q.notFound(oauthRequestGone)
		return
	}
	var redirectURI string
	var state *string
	if err := q.s.Pool.QueryRow(q.ctx, "SELECT redirect_uri, state FROM oauth_request WHERE id = $1", id).Scan(&redirectURI, &state); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			q.notFound(oauthRequestGone)
			return
		}
		q.internal(err)
		return
	}
	var kv []string
	if state != nil {
		kv = append(kv, "state", *state)
	}
	kv = append(kv, "iss", q.s.requestOrigin(q.r))
	op := q.p.op
	if decision == "deny" {
		// Only a request not yet decided can be denied, so a deny racing an approval (or another
		// deny) can't remove the approved request; the loser gets a 404, as on Lite.
		deleted := false
		err := q.tx(func(tx pgx.Tx) error {
			tag, err := tx.Exec(q.ctx, "DELETE FROM oauth_request WHERE id = $1 AND code_hash IS NULL", id)
			if err != nil || tag.RowsAffected() == 0 {
				return err
			}
			deleted = true
			e := operatorAudit(op, "oauth.denied", q.ip())
			e.target = &clientName
			return writeAudit(q.ctx, tx, q.now, e)
		})
		if err != nil {
			q.internal(err)
			return
		}
		if !deleted {
			q.notFound(oauthRequestGone)
			return
		}
		q.json(http.StatusOK, jsobj.New("redirect", withParams(redirectURI, append(kv, "error", "access_denied")...)))
		return
	}
	var allowed []string
	scopesV, _ := pending.Get("scopes")
	for _, s := range scopesV.([]any) {
		o := s.(*jsobj.Object)
		if ok, _ := o.Get("allowed"); ok == true {
			sc, _ := o.Get("scope")
			allowed = append(allowed, sc.(string))
		}
	}
	chosen := allowed
	if raw, _ := q.prop("scopes"); raw != nil {
		if list, ok := raw.([]any); ok {
			chosen = nil
			for _, e := range list {
				if s, ok := e.(string); ok {
					chosen = append(chosen, s)
				}
			}
		}
	}
	var scopes []string
	for _, sc := range chosen {
		if contains(allowed, sc) && !contains(scopes, sc) { // each scope once, in the order given
			scopes = append(scopes, sc)
		}
	}
	if len(scopes) == 0 {
		q.bad("Pick at least one permission you have.")
		return
	}
	code := authcrypto.RandomToken()
	clientV, _ := pending.Get("client")
	clientRef, _ := clientV.(*jsobj.Object).Get("metadata_url")
	if clientRef == nil {
		clientRef = clientName
	}
	hostV, _ := pending.Get("redirect_host")
	updated := false
	err = q.tx(func(tx pgx.Tx) error {
		tag, err := tx.Exec(q.ctx, "UPDATE oauth_request SET operator_id = $1, granted_scope = $2, code_hash = $3, expires_at = $4 WHERE id = $5 AND code_hash IS NULL",
			op.ID, strings.Join(scopes, " "), authcrypto.SHA256Hex(code), q.now+oauthCodeTTL, id)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		updated = true
		e := operatorAudit(op, "oauth.authorized", q.ip())
		e.target = &clientName
		e.details = jsobj.New("client", clientRef, "scopes", stringsToAny(scopes), "redirect_host", hostV)
		return writeAudit(q.ctx, tx, q.now, e)
	})
	if err != nil {
		q.internal(err)
		return
	}
	if !updated {
		q.notFound(oauthRequestGone)
		return
	}
	q.json(http.StatusOK, jsobj.New("redirect", withParams(redirectURI, append(kv, "code", code)...)))
}

// adminOAuthGrants lists your connected apps.
func adminOAuthGrants(q *adminReq) {
	rows, err := q.s.Pool.Query(q.ctx,
		`SELECT g.id, g.scopes, g.created_at, g.last_used_at, g.refresh_expires_at, c.name, c.client_uri, c.kind, c.id
		 FROM oauth_grant g JOIN oauth_client c ON c.id = g.client_id
		 WHERE g.operator_id = $1 AND g.revoked_at IS NULL AND g.refresh_expires_at > $2 ORDER BY g.created_at DESC, g.id COLLATE "C" DESC`, q.p.op.ID, q.now)
	if err != nil {
		q.internal(err)
		return
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (any, error) {
		var id, scopes, name, kind, clientID string
		var created, refreshExpires int64
		var lastUsed *int64
		var clientURI *string
		if err := r.Scan(&id, &scopes, &created, &lastUsed, &refreshExpires, &name, &clientURI, &kind, &clientID); err != nil {
			return nil, err
		}
		o := jsobj.New("id", id, "scopes", stringsToAny(parseStringList(scopes)), "created_at", float64(created), "last_used_at", numOrNull(lastUsed),
			"refresh_expires_at", float64(refreshExpires), "client_name", name, "client_uri", strOrNull(clientURI), "kind", kind)
		if kind == "metadata_document" {
			o.Set("client_id", clientID)
		}
		return o, nil
	})
	if err != nil {
		q.internal(err)
		return
	}
	if list == nil {
		list = []any{}
	}
	q.json(http.StatusOK, jsobj.New("grants", list))
}

func adminRevokeOAuthGrant(q *adminReq) {
	if !sessionOnly(q) {
		return
	}
	id := q.params["id"]
	found := false
	err := q.tx(func(tx pgx.Tx) error {
		var name string
		err := tx.QueryRow(q.ctx,
			`SELECT c.name FROM oauth_grant g JOIN oauth_client c ON c.id = g.client_id
			 WHERE g.id = $1 AND g.operator_id = $2 AND g.revoked_at IS NULL FOR UPDATE OF g`, id, q.p.op.ID).Scan(&name)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if _, err := tx.Exec(q.ctx, "UPDATE oauth_grant SET revoked_at = $1 WHERE id = $2", q.now, id); err != nil {
			return err
		}
		found = true
		e := operatorAudit(q.p.op, "oauth.revoked", q.ip())
		e.target = &name
		return writeAudit(q.ctx, tx, q.now, e)
	})
	if err != nil {
		q.internal(err)
		return
	}
	if !found {
		q.notFound("Connected app")
		return
	}
	q.json(http.StatusOK, jsobj.New("revoked", id))
}
