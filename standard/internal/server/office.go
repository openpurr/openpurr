package server

// The back office's shared parts: operators, who is calling (sessions and personal access
// tokens), what they may do, the audit log, and the small router the admin API uses. Ports of
// lite/src/office/principal.ts, project.ts and the helpers of auth.ts and admin.ts.
//
// Two ways in:
//   - the dashboard session cookie (full and recovery sessions, not setup; changes must be
//     same-origin, see office_auth.go);
//   - "Authorization: Bearer pat_..." personal access tokens, for the CLI and MCP (which also takes
//     OAuth access tokens, oauth.go).
//
// Permission = the operator's ROLE, further limited by the token's SCOPES when a token is used:
//
//	viewer     read
//	developer  read, replay webhooks, manage secret keys, grant entitlements
//	admin      everything except managing owners and owner-only settings
//	owner      everything
//
// An operator limited to certain apps (app_ids) only sees those apps' data.

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/openpurr/openpurr/standard/internal/authcrypto"
	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
)

// Permissions.
const (
	permRead            = "read"
	permAuditRead       = "audit:read"
	permWebhooksReplay  = "webhooks:replay"
	permKeysManage      = "keys:manage"
	permGrantsManage    = "grants:manage"
	permOperatorsManage = "operators:manage"
	permConfigManage    = "config:manage"
	permSettingsManage  = "settings:manage"
	permCustomersImport = "customers:import"
)

var rolePermissions = map[string][]string{
	"viewer":    {permRead},
	"developer": {permRead, permWebhooksReplay, permKeysManage, permGrantsManage},
	"admin":     {permRead, permAuditRead, permWebhooksReplay, permKeysManage, permGrantsManage, permOperatorsManage, permConfigManage, permCustomersImport},
	"owner":     {permRead, permAuditRead, permWebhooksReplay, permKeysManage, permGrantsManage, permOperatorsManage, permConfigManage, permSettingsManage, permCustomersImport},
}

var scopePermissions = map[string][]string{
	"read":           {permRead, permAuditRead},
	"write:webhooks": {permWebhooksReplay},
	"write:grants":   {permGrantsManage},
	"write:config":   {permConfigManage},
	"admin":          {permKeysManage, permOperatorsManage, permConfigManage, permSettingsManage, permAuditRead, permCustomersImport},
}

// Roles, most powerful first.
var roles = []string{"owner", "admin", "developer", "viewer"}

// An operator row.
type operator struct {
	ID           string
	Email        string
	Name         string
	Role         string
	AppIDs       *string
	PasswordHash *string
	TOTPSecret   *string
	TOTPEnabled  int
	TOTPLastStep *int64
	FailedLogins int
	LockedUntil  *int64
	DisabledAt   *int64
	LastLoginAt  *int64
	Locale       *string
	CreatedAt    int64
}

const operatorColumns = `o.id, o.email, o.name, o.role, o.app_ids, o.password_hash, o.totp_secret, o.totp_enabled,
  o.totp_last_step, o.failed_logins, o.locked_until, o.disabled_at, o.last_login_at, o.locale, o.created_at`

func (o *operator) targets() []any {
	return []any{&o.ID, &o.Email, &o.Name, &o.Role, &o.AppIDs, &o.PasswordHash, &o.TOTPSecret, &o.TOTPEnabled,
		&o.TOTPLastStep, &o.FailedLogins, &o.LockedUntil, &o.DisabledAt, &o.LastLoginAt, &o.Locale, &o.CreatedAt}
}

// findOperator reads one operator (the query selects operatorColumns, then extra columns into
// extra), or nil.
func findOperator(ctx context.Context, db ledger.DB, query string, args []any, extra ...any) (*operator, error) {
	var o operator
	err := db.QueryRow(ctx, query, args...).Scan(append(extra, o.targets()...)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

// appList is an operator's app_ids: nil for all apps.
func appList(raw *string) []string {
	if raw == nil || *raw == "" {
		return nil
	}
	v, err := jsobj.Parse([]byte(*raw))
	list, ok := v.([]any)
	if err != nil || !ok {
		return nil
	}
	out := []string{}
	for _, e := range list {
		if s, ok := e.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func stringList(list []string) []any {
	if list == nil {
		return nil
	}
	return stringsToAny(list)
}

// publicOperator is an operator as the API shows it (lite/src/office/auth.ts).
func publicOperator(o *operator) *jsobj.Object {
	var apps any
	if o.AppIDs != nil && *o.AppIDs != "" {
		apps = stringList(appList(o.AppIDs))
	}
	return jsobj.New(
		"id", o.ID,
		"email", o.Email,
		"name", o.Name,
		"role", o.Role,
		"app_ids", apps,
		"totp_enabled", o.TOTPEnabled != 0,
		"has_password", o.PasswordHash != nil && *o.PasswordHash != "",
		"locale", strOrNull(o.Locale),
	)
}

func strOrNull(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}

func numOrNull(p *int64) any {
	if p == nil {
		return nil
	}
	return float64(*p)
}

// principal is who is calling the admin API.
type principal struct {
	op      *operator
	via     string // "session" or "token"
	tokenID *string
	// Permissions in Lite's order (the role's, limited by the token's scopes).
	perms []string
	// App IDs this operator may see; nil = all apps.
	apps []string
}

func (p *principal) can(perm string) bool {
	for _, x := range p.perms {
		if x == perm {
			return true
		}
	}
	return false
}

func (p *principal) canSeeApp(appID string) bool {
	if p.apps == nil {
		return true
	}
	for _, a := range p.apps {
		if a == appID {
			return true
		}
	}
	return false
}

// source is how the caller's writes are audited.
func (p *principal) source() string {
	if p.via == "token" {
		return "api"
	}
	return "dashboard"
}

// principalOf combines the role's permissions with the token's scopes (nil: a session, no limit).
func principalOf(o *operator, via string, tokenID *string, scopes []string) *principal {
	perms := append([]string(nil), rolePermissions[o.Role]...)
	if scopes != nil {
		allowed := map[string]bool{}
		for _, s := range scopes {
			for _, perm := range scopePermissions[s] {
				allowed[perm] = true
			}
		}
		kept := perms[:0]
		for _, perm := range perms {
			if allowed[perm] {
				kept = append(kept, perm)
			}
		}
		perms = kept
	}
	if perms == nil {
		perms = []string{}
	}
	return &principal{op: o, via: via, tokenID: tokenID, perms: perms, apps: appList(o.AppIDs)}
}

// How often a token's last_used_at is stamped.
const lastUsedEveryMs = 3600_000

// tokenPrincipal is the principal for a personal access token, or nil if it's invalid, expired,
// revoked or its operator is disabled.
func (s *server) tokenPrincipal(ctx context.Context, token string, now int64) (*principal, error) {
	var tokenID, scopes string
	var lastUsed *int64
	o, err := findOperator(ctx, s.Pool,
		`SELECT t.id, t.scopes, t.last_used_at, `+operatorColumns+` FROM access_token t JOIN operator o ON o.id = t.operator_id
		 WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > $2) AND o.disabled_at IS NULL`,
		[]any{authcrypto.SHA256Hex(token), now}, &tokenID, &scopes, &lastUsed)
	if err != nil || o == nil {
		return nil, err
	}
	if lastUsed == nil || now-*lastUsed > lastUsedEveryMs {
		s.Deferred.Go("stamp token use", func(ctx context.Context) error {
			_, err := s.Pool.Exec(ctx, "UPDATE access_token SET last_used_at = $1 WHERE id = $2", s.Clock.Now(), tokenID)
			return err
		})
	}
	list := []string{}
	if v, err := jsobj.Parse([]byte(scopes)); err == nil {
		if arr, ok := v.([]any); ok {
			for _, e := range arr {
				if s, ok := e.(string); ok {
					list = append(list, s)
				}
			}
		}
	}
	id := tokenID
	return principalOf(o, "token", &id, list), nil
}

// --- projects (lite/src/office/project.ts) --------------------------------------------------------

// canSeeProject: an operator limited to some apps sees the projects those apps belong to.
func canSeeProject(p *principal, project *config.Project) bool {
	if p.apps == nil {
		return true
	}
	for _, id := range project.AppOrder {
		if p.canSeeApp(id) {
			return true
		}
	}
	return false
}

func visibleProjects(cfg *config.Config, p *principal) []*config.Project {
	var out []*config.Project
	for _, id := range cfg.ProjectOrder {
		if project := cfg.Projects[id]; canSeeProject(p, project) {
			out = append(out, project)
		}
	}
	return out
}

// chooseProject is the requested project, or the only one the caller can see; else the status and
// message to answer with.
func chooseProject(cfg *config.Config, p *principal, requested string) (*config.Project, int, string) {
	if requested != "" {
		project := cfg.Projects[requested]
		if project == nil || !canSeeProject(p, project) {
			return nil, http.StatusNotFound, "Project " + requested + " not found."
		}
		return project, 0, ""
	}
	visible := visibleProjects(cfg, p)
	if len(visible) == 1 {
		return visible[0], 0, ""
	}
	if len(visible) == 0 {
		return nil, http.StatusNotFound, "There are no projects yet. Add one to the config first."
	}
	ids := make([]string, len(visible))
	for i, v := range visible {
		ids[i] = v.ID
	}
	return nil, http.StatusBadRequest, "This deployment has several projects; say which with project: " + strings.Join(ids, ", ") + "."
}

// --- the audit log ---------------------------------------------------------------------------------

// auditEntry is an audit_log row. Details nil is stored as NULL.
type auditEntry struct {
	operatorID *string
	actor      *string
	tokenID    *string
	source     string
	action     string
	target     *string
	details    *jsobj.Object
	ip         *string
}

func writeAudit(ctx context.Context, db ledger.DB, now int64, e auditEntry) error {
	source := e.source
	if source == "" {
		source = "dashboard"
	}
	var details *string
	if e.details != nil {
		d := jsobj.Stringify(e.details)
		details = &d
	}
	_, err := db.Exec(ctx,
		`INSERT INTO audit_log (at, operator_id, actor, token_id, source, action, target, details, ip) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		now, e.operatorID, e.actor, e.tokenID, source, e.action, e.target, details, e.ip)
	return err
}

// operatorAudit is an audit entry about an operator, by themselves.
func operatorAudit(o *operator, action string, ip *string) auditEntry {
	id, email := o.ID, o.Email
	return auditEntry{operatorID: &id, actor: &email, action: action, ip: ip}
}

func strp(s string) *string { return &s }

// obj builds an object from alternating keys and values, leaving out values that are undef
// (JSON.stringify drops undefined properties).
func obj(kv ...any) *jsobj.Object {
	o := jsobj.New()
	for i := 0; i+1 < len(kv); i += 2 {
		if _, skip := kv[i+1].(undefinedT); skip {
			continue
		}
		o.Set(kv[i].(string), kv[i+1])
	}
	return o
}

// undef is JavaScript's undefined inside obj().
type undefinedT struct{}

var undef = undefinedT{}

// orUndef is v when it was present, else undef.
func orUndef(v any, ok bool) any {
	if !ok {
		return undef
	}
	return v
}

// --- the admin request ------------------------------------------------------------------------------

// adminReq is one back-office request.
type adminReq struct {
	s      *server
	w      http.ResponseWriter
	r      *http.Request
	ctx    context.Context
	cfg    *config.Config
	now    int64
	p      *principal
	params map[string]string

	bodyRead bool
	body     any

	// src overrides how writes are audited ("mcp" for the MCP server's tools).
	src string
}

// source is how this request's writes are audited.
func (q *adminReq) source() string {
	if q.src != "" {
		return q.src
	}
	return q.p.source()
}

// bodyValue is Lite's `(await c.req.json().catch(() => null)) ?? {}`.
func (q *adminReq) bodyValue() any {
	if !q.bodyRead {
		q.bodyRead = true
		q.body = jsobj.New()
		if q.r.Body != nil {
			raw, _ := io.ReadAll(io.LimitReader(q.r.Body, maxBodyBytes+1))
			if len(raw) <= maxBodyBytes {
				if v, err := jsobj.Parse(raw); err == nil && v != nil {
					q.body = v
				}
			}
		}
	}
	return q.body
}

// prop is `body.k` (undefined: false).
func (q *adminReq) prop(k string) (any, bool) {
	return jsobj.Prop(q.bodyValue(), k)
}

// propString is the property when it's a string.
func (q *adminReq) propString(k string) (string, bool) {
	v, _ := q.prop(k)
	s, ok := v.(string)
	return s, ok
}

// query is c.req.query(k): the first value, "" when absent.
func (q *adminReq) query(k string) string {
	return q.r.URL.Query().Get(k)
}

func (q *adminReq) hasQuery(k string) bool {
	_, ok := q.r.URL.Query()[k]
	return ok
}

func (q *adminReq) json(status int, v any) { writeJSON(q.w, status, v) }

func (q *adminReq) fail(status int, code, message string) {
	writeJSON(q.w, status, jsobj.New("code", code, "message", message))
}

func (q *adminReq) bad(message string)       { q.fail(http.StatusBadRequest, "bad_request", message) }
func (q *adminReq) forbidden(message string) { q.fail(http.StatusForbidden, "forbidden", message) }
func (q *adminReq) notFound(what string) {
	q.fail(http.StatusNotFound, "not_found", what+" not found.")
}

func (q *adminReq) internal(err error) { q.s.internalError(q.w, q.r, err) }

// ip is the client address for the audit log (nil when unknown).
func (q *adminReq) ip() *string {
	if ip := q.s.clientIP(q.r); ip != "" {
		return &ip
	}
	return nil
}

// audit is an audit row for the current caller.
func (q *adminReq) audit(db ledger.DB, action string, target *string, details *jsobj.Object) error {
	p := q.p
	id, email := p.op.ID, p.op.Email
	return writeAudit(q.ctx, db, q.now, auditEntry{
		operatorID: &id, actor: &email, tokenID: p.tokenID, source: q.source(),
		action: action, target: target, details: details, ip: q.ip(),
	})
}

// project is the project a request is about (?project= or the body's, or the caller's only
// project). On failure it has answered and returns nil.
func (q *adminReq) project(requested string) *config.Project {
	if requested == "" {
		requested = q.query("project")
	}
	project, status, message := chooseProject(q.cfg, q.p, requested)
	if project == nil {
		code := "bad_request"
		if status == http.StatusNotFound {
			code = "not_found"
		}
		q.fail(status, code, message)
	}
	return project
}

// tx runs fn in a transaction.
func (q *adminReq) tx(fn func(tx pgx.Tx) error) error {
	return pgx.BeginFunc(q.ctx, q.s.Pool, fn)
}

// --- routing ---------------------------------------------------------------------------------------

type adminRoute struct {
	method string
	parts  []string
	perm   string
	h      func(q *adminReq)
}

type adminRouter struct{ routes []adminRoute }

func (rt *adminRouter) add(method, pattern, perm string, h func(q *adminReq)) {
	rt.routes = append(rt.routes, adminRoute{method: method, parts: strings.Split(strings.Trim(pattern, "/"), "/"), perm: perm, h: h})
}

// match finds the route for a path below the prefix, with its parameters (percent-decoded, as
// Hono's c.req.param does).
func (rt *adminRouter) match(method, rest string) (*adminRoute, map[string]string) {
	parts := strings.Split(strings.Trim(rest, "/"), "/")
	for i := range rt.routes {
		route := &rt.routes[i]
		if route.method != method && !(route.method == http.MethodGet && method == http.MethodHead) {
			continue
		}
		if len(route.parts) != len(parts) {
			continue
		}
		params := map[string]string{}
		ok := true
		for j, part := range route.parts {
			if strings.HasPrefix(part, ":") {
				if parts[j] == "" {
					ok = false
					break
				}
				params[part[1:]] = safeDecode(parts[j])
			} else if part != parts[j] {
				ok = false
				break
			}
		}
		if ok {
			return route, params
		}
	}
	return nil, nil
}

// requestOrigin is this server's origin as the browser sees it: PUBLIC_URL when set, else the
// request's scheme and host (the scheme from X-Forwarded-Proto behind a proxy that ends TLS). A
// request forwarded by Lite (forwarded.go) has the origin its client called.
func (s *server) requestOrigin(r *http.Request) string {
	if f := forwardedOf(r); f != nil {
		return f.origin
	}
	if s.PublicURL != "" {
		return s.PublicURL
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	} else if p := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0])); p == "https" || p == "http" {
		scheme = p
	}
	return scheme + "://" + r.Host
}

// sameOrigin is the CSRF check: a cookie-authenticated request that changes something must come
// from this origin.
func (s *server) sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	return origin != "" && origin == s.requestOrigin(r)
}
