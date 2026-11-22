package server

// The admin API, /admin/v1: what the dashboard and the CLI use. A port of lite/src/office/admin.ts.
// Permissions and audit logging are enforced here, once. Every write is audited with the operator,
// the access token if one was used, and the source (dashboard or api).

import (
	"errors"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"github.com/jackc/pgx/v5"

	"github.com/openpurr/openpurr/standard/internal/authcrypto"
	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
	"github.com/openpurr/openpurr/standard/internal/secretkeys"
	"github.com/openpurr/openpurr/standard/internal/webhooks"
)

// Edition is what this server reports itself as (GET /admin/v1/settings and /usage), so the
// dashboard can show the right text.
const Edition = "standard"

const setupLinkMs = 24 * 3600_000

var (
	adminRoutesOnce sync.Once
	adminRoutes     *adminRouter
)

func buildAdminRoutes() *adminRouter {
	rt := &adminRouter{}
	get, post, put, patch, del := http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete

	rt.add(get, "/me", "", adminMe)
	rt.add(patch, "/me", "", adminPatchMe)
	rt.add(get, "/projects", permRead, adminProjects)
	rt.add(get, "/apps", permRead, adminApps)

	rt.add(get, "/operators", permRead, adminOperators)
	rt.add(post, "/operators", permOperatorsManage, adminCreateOperator)
	rt.add(patch, "/operators/:id", permOperatorsManage, adminUpdateOperator)
	rt.add(post, "/operators/:id/reset", permOperatorsManage, adminResetOperator)

	rt.add(get, "/tokens", "", adminTokens)
	rt.add(post, "/tokens", "", adminCreateToken)
	rt.add(del, "/tokens/:id", "", adminRevokeToken)

	rt.add(get, "/secret-keys", permKeysManage, adminSecretKeys)
	rt.add(post, "/secret-keys", permKeysManage, adminCreateSecretKey)
	rt.add(post, "/secret-keys/:id/revoke", permKeysManage, adminRevokeSecretKey)
	rt.add(post, "/secret-keys/:id/expire", permKeysManage, adminExpireSecretKey)

	rt.add(get, "/customers", permRead, adminCustomers)
	rt.add(get, "/customers/:app_user_id", permRead, adminCustomer)
	rt.add(post, "/customers/:app_user_id/grants", permGrantsManage, adminGrant)
	rt.add(post, "/customers/:app_user_id/grants/:grant_id/revoke", permGrantsManage, adminRevokeGrant)

	rt.add(post, "/import", permCustomersImport, adminImport)

	rt.add(get, "/experiments", permRead, adminExperiments)
	rt.add(post, "/experiments", permConfigManage, adminCreateExperiment)
	rt.add(get, "/experiments/:id", permRead, adminExperiment)
	rt.add(patch, "/experiments/:id", permConfigManage, adminUpdateExperiment)
	rt.add(post, "/experiments/:id/start", permConfigManage, adminStartExperiment)
	rt.add(post, "/experiments/:id/stop", permConfigManage, adminStopExperiment)
	rt.add(del, "/experiments/:id", permConfigManage, adminDeleteExperiment)
	rt.add(get, "/experiments/:id/results", permRead, adminExperimentResults)

	rt.add(get, "/metrics", permRead, adminMetrics)
	rt.add(get, "/metrics/:chart", permRead, adminChart)
	rt.add(post, "/metrics/refresh", permRead, adminRefreshMetrics)

	// OAuth: the consent screen and connected apps (oauth.go).
	rt.add(get, "/oauth/requests/:id", "", adminOAuthRequest)
	rt.add(post, "/oauth/requests/:id/:decision", "", adminOAuthDecide)
	rt.add(get, "/oauth/grants", "", adminOAuthGrants)
	rt.add(post, "/oauth/grants/:id/revoke", "", adminRevokeOAuthGrant)

	rt.add(get, "/doctor", permRead, adminDoctor)

	rt.add(get, "/webhooks/deliveries", permRead, adminDeliveries)
	rt.add(post, "/webhooks/events/:id/replay", permWebhooksReplay, adminReplay)

	rt.add(get, "/audit", permAuditRead, adminAudit)

	rt.add(get, "/config", permRead, adminConfig)
	rt.add(post, "/config/validate", permRead, adminValidateConfig)
	rt.add(put, "/config", permConfigManage, adminSaveConfig)
	rt.add(get, "/config/versions", permRead, adminConfigVersions)
	rt.add(get, "/config/versions/:id", permRead, adminConfigVersion)
	rt.add(post, "/config/versions/:id/restore", permConfigManage, adminRestoreConfig)

	rt.add(get, "/settings", permRead, adminSettings)
	rt.add(put, "/settings", permSettingsManage, adminPutSettings)

	// Moving between editions (admin_export.go): owners who see every app.
	rt.add(get, "/export", "", adminExportInfo)
	rt.add(post, "/export", "", adminExportInfo)
	rt.add(get, "/export/customer-info", "", adminExportCustomerInfo)
	rt.add(get, "/export/tables/:table", "", adminExportTable)

	rt.add(get, "/usage", permRead, adminUsage)
	rt.add(post, "/usage/refresh", permRead, adminUsageRefresh)
	return rt
}

// admin serves /admin/v1/* (except the sign-in routes).
func (s *server) admin(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := &adminReq{s: s, w: w, r: r, ctx: ctx, now: s.Clock.Now()}
	cfg, err := s.Config.GetFresh(ctx)
	if err != nil {
		q.internal(err)
		return
	}
	q.cfg = cfg
	if !s.adminAuthenticate(q) {
		return
	}
	adminRoutesOnce.Do(func() { adminRoutes = buildAdminRoutes() })
	route, params := adminRoutes.match(r.Method, strings.TrimPrefix(r.URL.EscapedPath(), "/admin/v1"))
	if route == nil {
		q.notFound("Endpoint")
		return
	}
	if route.perm != "" && !q.p.can(route.perm) {
		hint := ""
		if q.p.via == "token" {
			hint = " (check the token's scopes)"
		}
		q.forbidden("This needs the " + route.perm + " permission" + hint + ".")
		return
	}
	q.params = params
	route.h(q)
}

// adminAuthenticate sets q.p, or answers 401/403 and returns false.
func (s *server) adminAuthenticate(q *adminReq) bool {
	r := q.r
	header := r.Header.Get("Authorization")
	// OAuth access tokens are issued for the MCP server only (their audience is /mcp).
	if strings.HasPrefix(header, "Bearer oat_") {
		q.fail(http.StatusUnauthorized, "invalid_token", "OAuth access tokens only work at /mcp. Use a personal access token for the admin API.")
		return false
	}
	if strings.HasPrefix(header, "Bearer "+AccessTokenPrefix) {
		p, err := s.tokenPrincipal(q.ctx, jsobj.Trim(header[7:]), q.now)
		if err != nil {
			q.internal(err)
			return false
		}
		if p == nil {
			q.fail(http.StatusUnauthorized, "invalid_token", "Invalid, expired or revoked access token.")
			return false
		}
		q.p = p
		return true
	}
	sess, err := s.sessionFor(q.ctx, r, q.now)
	if err != nil {
		q.internal(err)
		return false
	}
	if sess == nil || sess.kind == "setup" {
		// Signed in by Identity-Aware Proxy, for this request only (iap.go).
		o, err := s.iapOperator(q.ctx, r, q.now)
		if err != nil {
			q.internal(err)
			return false
		}
		if o == nil {
			q.fail(http.StatusUnauthorized, "signed_out", "Sign in, or send a personal access token.")
			return false
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead && !s.sameOrigin(r) {
			q.fail(http.StatusForbidden, "bad_origin", "Requests must come from the openpurr dashboard.")
			return false
		}
		// Two-step sign-in is IAP's (the Google account's), not openpurr's: see iap.go.
		q.p = principalOf(o, "iap", nil, nil)
		return true
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead && !s.sameOrigin(r) {
		q.fail(http.StatusForbidden, "bad_origin", "Requests must come from the openpurr dashboard.")
		return false
	}
	// When the owner requires two-step sign-in, operators without it can only see who they are.
	if sess.op.TOTPEnabled == 0 && r.URL.EscapedPath() != "/admin/v1/me" {
		required, err := requireTOTPForEveryone(q.ctx, s.Pool)
		if err != nil {
			q.internal(err)
			return false
		}
		if required {
			q.fail(http.StatusForbidden, "totp_enrollment_required", "Set up two-step sign-in to continue.")
			return false
		}
	}
	q.p = principalOf(sess.op, "session", nil, nil)
	return true
}

// --- me ------------------------------------------------------------------------------------------

func adminMe(q *adminReq) {
	q.json(http.StatusOK, jsobj.New("operator", publicOperator(q.p.op), "via", q.p.via, "permissions", stringsToAny(q.p.perms)))
}

// officeLocales are the dashboard's languages (lite/src/office/locales.ts).
var officeLocales = []string{"en", "de", "es", "fr", "it", "nl", "pl", "pt-br", "tr", "id", "vi", "ar", "hi", "ja", "ko", "zh-cn", "zh-tw"}

// adminPatchMe changes your own preferences: anyone signed in, with any token scope.
func adminPatchMe(q *adminReq) {
	raw, ok := q.prop("locale")
	if !ok {
		q.bad(`Nothing to change: send {"locale": …}.`)
		return
	}
	var locale *string
	if s, isStr := raw.(string); isStr && s != "" {
		locale = &s
	} else if raw != nil && !(isStr && s == "") {
		q.bad("locale must be null (follow the browser) or one of " + strings.Join(officeLocales, ", ") + ".")
		return
	}
	if locale != nil && !contains(officeLocales, *locale) {
		q.bad("locale must be null (follow the browser) or one of " + strings.Join(officeLocales, ", ") + ".")
		return
	}
	me := *q.p.op
	err := q.tx(func(tx pgx.Tx) error {
		if _, err := tx.Exec(q.ctx, "UPDATE operator SET locale = $1 WHERE id = $2", locale, me.ID); err != nil {
			return err
		}
		return q.audit(tx, "operator.locale", &me.ID, jsobj.New("locale", strOrNull(locale)))
	})
	if err != nil {
		q.internal(err)
		return
	}
	me.Locale = locale
	q.json(http.StatusOK, jsobj.New("operator", publicOperator(&me)))
}

// chartProducts are an app's products as charts name them: Google Play base plans separately.
func chartProducts(app *config.App) []string {
	out := []string{}
	for _, id := range app.ProductOrder {
		p := app.Products[id]
		if len(p.BasePlans) > 0 {
			for _, b := range p.BasePlans {
				out = append(out, p.ID+":"+b)
			}
		} else {
			out = append(out, p.ID)
		}
	}
	return out
}

// --- projects and apps ---------------------------------------------------------------------------

func adminProjects(q *adminReq) {
	list := []any{}
	for _, project := range visibleProjects(q.cfg, q.p) {
		apps := []any{}
		for _, id := range project.AppOrder {
			if q.p.canSeeApp(id) {
				apps = append(apps, jsobj.New("id", id, "store", string(project.Apps[id].Store)))
			}
		}
		ents := []any{}
		for _, e := range project.Entitlements {
			ents = append(ents, e.ID)
		}
		list = append(list, jsobj.New("id", project.ID, "name", project.Name, "apps", apps, "entitlement_ids", ents,
			"current_offering_id", strOrNull(project.CurrentOffering)))
	}
	q.json(http.StatusOK, jsobj.New("projects", list))
}

// allApps is every app in the config's order.
func allApps(cfg *config.Config) []*config.App {
	var out []*config.App
	for _, pid := range cfg.ProjectOrder {
		project := cfg.Projects[pid]
		for _, id := range project.AppOrder {
			out = append(out, project.Apps[id])
		}
	}
	return out
}

func appIDs(cfg *config.Config) []string {
	var out []string
	for _, a := range allApps(cfg) {
		out = append(out, a.ID)
	}
	return out
}

func adminApps(q *adminReq) {
	only := q.query("project")
	list := []any{}
	for _, a := range allApps(q.cfg) {
		if !q.p.canSeeApp(a.ID) || (only != "" && a.ProjectID != only) {
			continue
		}
		var bundle, pkg any
		if a.BundleID != "" {
			bundle = a.BundleID
		}
		if a.PackageName != "" {
			pkg = a.PackageName
		}
		list = append(list, jsobj.New("id", a.ID, "project_id", a.ProjectID, "store", string(a.Store), "bundle_id", bundle,
			"package_name", pkg, "products", stringsToAny(chartProducts(a))))
	}
	q.json(http.StatusOK, jsobj.New("apps", list))
}

// --- operators -----------------------------------------------------------------------------------

func adminOperators(q *adminReq) {
	rows, err := q.s.Pool.Query(q.ctx, "SELECT "+operatorColumns+" FROM operator o ORDER BY o.created_at, o.id")
	if err != nil {
		q.internal(err)
		return
	}
	ops, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (*operator, error) {
		var o operator
		return &o, r.Scan(o.targets()...)
	})
	if err != nil {
		q.internal(err)
		return
	}
	list := []any{}
	for _, o := range ops {
		v := publicOperator(o)
		v.Set("disabled", o.DisabledAt != nil)
		v.Set("last_login_at", numOrNull(o.LastLoginAt))
		list = append(list, v)
	}
	q.json(http.StatusOK, jsobj.New("operators", list))
}

// mayManage: owners are managed only by owners.
func mayManage(p *principal, targetRole string) bool {
	return p.can(permOperatorsManage) && (targetRole != "owner" || p.op.Role == "owner")
}

// setupLink stores a 24-hour setup link and returns it. The token rides in the #fragment, so it
// never reaches server logs or Referer headers.
func (q *adminReq) setupLink(operatorID string) (string, error) {
	token := authcrypto.RandomToken()
	if _, err := q.s.Pool.Exec(q.ctx,
		"INSERT INTO login_link (token_hash, operator_id, purpose, expires_at, created_at) VALUES ($1, $2, 'setup', $3, $4)",
		authcrypto.SHA256Hex(token), operatorID, q.now+setupLinkMs, q.now); err != nil {
		return "", err
	}
	return q.s.requestOrigin(q.r) + "/admin/link#token=" + token, nil
}

// parseApps reads app_ids: absent (undefined, false), null (all apps), or app IDs from the config.
// It answers 400 and returns ok=false for anything else.
func (q *adminReq) parseApps(raw any, present bool) (apps []string, set bool, ok bool) {
	if !present {
		return nil, false, true
	}
	if raw == nil {
		return nil, true, true
	}
	list, isList := raw.([]any)
	valid := isList
	if isList {
		for _, e := range list {
			s, isStr := e.(string)
			if !isStr || q.cfg.Apps[s] == nil {
				valid = false
				break
			}
			apps = append(apps, s)
		}
	}
	if !valid {
		q.bad("app_ids must be null (all apps) or a list of app IDs from the config: " + strings.Join(appIDs(q.cfg), ", ") + ".")
		return nil, false, false
	}
	if apps == nil {
		apps = []string{}
	}
	return apps, true, true
}

func appsJSON(apps []string) *string {
	if apps == nil {
		return nil
	}
	s := jsobj.Stringify(stringsToAny(apps))
	return &s
}

var emailPattern = regexp.MustCompile(`^[^@\s]+@[^@\s]+$`)

func adminCreateOperator(q *adminReq) {
	email := ""
	if v, ok := q.propString("email"); ok {
		email = strings.ToLower(jsobj.Trim(v))
	}
	if !emailPattern.MatchString(email) {
		q.bad("A valid email is required.")
		return
	}
	role, _ := q.propString("role")
	if !contains(roles, role) {
		q.bad("role must be one of: " + strings.Join(roles, ", ") + ".")
		return
	}
	if !mayManage(q.p, role) {
		q.forbidden("Only owners can add owners.")
		return
	}
	rawApps, present := q.prop("app_ids")
	apps, _, ok := q.parseApps(rawApps, present)
	if !ok {
		return
	}
	var exists bool
	if err := q.s.Pool.QueryRow(q.ctx, "SELECT EXISTS (SELECT 1 FROM operator WHERE lower(email) = lower($1))", email).Scan(&exists); err != nil {
		q.internal(err)
		return
	}
	if exists {
		q.fail(http.StatusConflict, "exists", "That email already has an account.")
		return
	}
	name := email
	if v, ok := q.propString("name"); ok && jsobj.Trim(v) != "" {
		name = jsobj.Trim(v)
	}
	id := ledger.NewUUID()
	var appsValue any
	if apps != nil {
		appsValue = stringsToAny(apps)
	}
	err := q.tx(func(tx pgx.Tx) error {
		if _, err := tx.Exec(q.ctx, "INSERT INTO operator (id, email, name, role, app_ids, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
			id, email, name, role, appsJSON(apps), q.now); err != nil {
			return err
		}
		return q.audit(tx, "operator.created", &email, jsobj.New("role", role, "app_ids", appsValue))
	})
	if err != nil {
		// Two invites for one email at the same moment: the unique index decides.
		if isUniqueViolation(err) {
			q.fail(http.StatusConflict, "exists", "That email already has an account.")
			return
		}
		q.internal(err)
		return
	}
	link, err := q.setupLink(id)
	if err != nil {
		q.internal(err)
		return
	}
	q.json(http.StatusCreated, jsobj.New("id", id, "setup_link", link, "setup_link_expires_in_hours", 24.0))
}

func (q *adminReq) operatorByID(id string, activeOnly bool) (*operator, error) {
	query := "SELECT " + operatorColumns + " FROM operator o WHERE o.id = $1"
	if activeOnly {
		query += " AND o.disabled_at IS NULL"
	}
	return findOperator(q.ctx, q.s.Pool, query, []any{id})
}

func adminUpdateOperator(q *adminReq) {
	p := q.p
	target, err := q.operatorByID(q.params["id"], false)
	if err != nil {
		q.internal(err)
		return
	}
	if target == nil {
		q.notFound("Operator")
		return
	}
	if !mayManage(p, target.Role) {
		q.forbidden("Only owners can change owners.")
		return
	}
	roleRaw, roleSet := q.prop("role")
	role, _ := roleRaw.(string)
	if roleSet {
		if !contains(roles, role) {
			q.bad("role must be one of: " + strings.Join(roles, ", ") + ".")
			return
		}
		if target.ID == p.op.ID {
			q.forbidden("You can't change your own role.")
			return
		}
		if !mayManage(p, role) {
			q.forbidden("Only owners can make someone an owner.")
			return
		}
	}
	rawApps, present := q.prop("app_ids")
	apps, appsSet, ok := q.parseApps(rawApps, present)
	if !ok {
		return
	}
	disabledRaw, disabledSet := q.prop("disabled")
	disable := disabledRaw == true
	enable := disabledRaw == false && disabledSet
	if disable && target.ID == p.op.ID {
		q.forbidden("You can't disable yourself.")
		return
	}
	name := ""
	if v, ok := q.propString("name"); ok {
		name = jsobj.Trim(v)
	}
	if !roleSet && !appsSet && name == "" && !disable && !enable {
		q.bad("Nothing to change. Send role, app_ids, name or disabled.")
		return
	}

	var appsDetail any = undef
	if appsSet {
		if apps == nil {
			appsDetail = nil
		} else {
			appsDetail = stringsToAny(apps)
		}
	}
	forbidden := ""
	err = q.tx(func(tx pgx.Tx) error {
		// Never leave the deployment without an active owner. Owners are locked while counting, so
		// two owners demoting each other at once can't both succeed.
		losingOwner := target.Role == "owner" && ((roleSet && role != "owner") || disable)
		if losingOwner {
			rows, err := tx.Query(q.ctx, "SELECT id FROM operator WHERE role = 'owner' AND disabled_at IS NULL FOR UPDATE")
			if err != nil {
				return err
			}
			ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
			if err != nil {
				return err
			}
			if len(ids) <= 1 {
				forbidden = "This is the only owner. Make someone else an owner first."
				return nil
			}
		}
		exec := func(sql string, args ...any) error {
			_, err := tx.Exec(q.ctx, sql, args...)
			return err
		}
		if roleSet {
			if err := exec("UPDATE operator SET role = $1 WHERE id = $2", role, target.ID); err != nil {
				return err
			}
		}
		if appsSet {
			if err := exec("UPDATE operator SET app_ids = $1 WHERE id = $2", appsJSON(apps), target.ID); err != nil {
				return err
			}
		}
		if name != "" {
			if err := exec("UPDATE operator SET name = $1 WHERE id = $2", name, target.ID); err != nil {
				return err
			}
		}
		if disable {
			if err := exec("UPDATE operator SET disabled_at = $1 WHERE id = $2", q.now, target.ID); err != nil {
				return err
			}
			if err := exec("DELETE FROM session WHERE operator_id = $1", target.ID); err != nil {
				return err
			}
			if err := exec("UPDATE access_token SET revoked_at = $1 WHERE operator_id = $2 AND revoked_at IS NULL", q.now, target.ID); err != nil {
				return err
			}
		} else if enable {
			if err := exec("UPDATE operator SET disabled_at = NULL, failed_logins = 0, locked_until = NULL WHERE id = $1", target.ID); err != nil {
				return err
			}
		}
		return q.audit(tx, "operator.updated", &target.Email,
			obj("role", orUndef(roleRaw, roleSet), "app_ids", appsDetail, "disabled", orUndef(disabledRaw, disabledSet)))
	})
	if err != nil {
		q.internal(err)
		return
	}
	if forbidden != "" {
		q.forbidden(forbidden)
		return
	}
	updated, err := q.operatorByID(target.ID, false)
	if err != nil {
		q.internal(err)
		return
	}
	q.json(http.StatusOK, obj("operator", publicOperator(updated), "disabled", orUndef(disabledRaw, disabledSet && disabledRaw != nil)))
}

// adminResetOperator clears the password and two-step sign-in, ends sessions and issues a new
// setup link.
func adminResetOperator(q *adminReq) {
	p := q.p
	target, err := q.operatorByID(q.params["id"], true)
	if err != nil {
		q.internal(err)
		return
	}
	if target == nil {
		q.notFound("Operator")
		return
	}
	if !mayManage(p, target.Role) {
		q.forbidden("Only owners can reset owners.")
		return
	}
	if target.ID == p.op.ID {
		q.forbidden("Change your own password from your account instead.")
		return
	}
	err = q.tx(func(tx pgx.Tx) error {
		for _, sql := range []string{
			"UPDATE operator SET password_hash = NULL, totp_enabled = 0, totp_secret = NULL, totp_last_step = NULL, failed_logins = 0, locked_until = NULL WHERE id = $1",
			"DELETE FROM recovery_code WHERE operator_id = $1",
			"DELETE FROM session WHERE operator_id = $1",
		} {
			if _, err := tx.Exec(q.ctx, sql, target.ID); err != nil {
				return err
			}
		}
		return q.audit(tx, "operator.reset", &target.Email, nil)
	})
	if err != nil {
		q.internal(err)
		return
	}
	link, err := q.setupLink(target.ID)
	if err != nil {
		q.internal(err)
		return
	}
	q.json(http.StatusOK, jsobj.New("setup_link", link, "setup_link_expires_in_hours", 24.0))
}

// --- personal access tokens (your own) -----------------------------------------------------------

func adminTokens(q *adminReq) {
	rows, err := q.s.Pool.Query(q.ctx,
		`SELECT id, token_prefix, name, scopes, created_at, last_used_at, expires_at, revoked_at FROM access_token
		 WHERE operator_id = $1 ORDER BY created_at, id`, q.p.op.ID)
	if err != nil {
		q.internal(err)
		return
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (any, error) {
		var id, prefix, name, scopes string
		var created int64
		var lastUsed, expires, revoked *int64
		if err := r.Scan(&id, &prefix, &name, &scopes, &created, &lastUsed, &expires, &revoked); err != nil {
			return nil, err
		}
		parsed, _ := jsobj.Parse([]byte(scopes))
		return jsobj.New("id", id, "token_prefix", prefix, "name", name, "scopes", parsed, "created_at", float64(created),
			"last_used_at", numOrNull(lastUsed), "expires_at", numOrNull(expires), "revoked_at", numOrNull(revoked)), nil
	})
	if err != nil {
		q.internal(err)
		return
	}
	if list == nil {
		list = []any{}
	}
	q.json(http.StatusOK, jsobj.New("tokens", list))
}

// stringListProp reads a list of strings that each pass ok; false if it isn't one.
func stringListProp(raw any, ok func(string) bool) ([]string, bool) {
	list, isList := raw.([]any)
	if !isList || len(list) == 0 {
		return nil, false
	}
	out := make([]string, 0, len(list))
	for _, e := range list {
		s, isStr := e.(string)
		if !isStr || !ok(s) {
			return nil, false
		}
		out = append(out, s)
	}
	return out, true
}

func adminCreateToken(q *adminReq) {
	p := q.p
	// Tokens are minted from a signed-in session only, never by another token.
	if p.via != "session" {
		q.forbidden("Create access tokens from the dashboard.")
		return
	}
	name, ok := q.propString("name")
	if !ok || jsobj.Trim(name) == "" {
		q.bad("name is required.")
		return
	}
	name = jsobj.Trim(name)
	rawScopes, _ := q.prop("scopes")
	scopes, ok := stringListProp(rawScopes, func(s string) bool { return contains(TokenScopes, s) })
	if !ok {
		q.bad("scopes must list some of: " + strings.Join(TokenScopes, ", ") + ".")
		return
	}
	var expiresAt *int64
	if days, present := q.prop("expires_in_days"); present {
		d, isNum := days.(float64)
		if !isNum || d < 1 || d > 3650 {
			q.bad("expires_in_days must be 1–3650, or left out for no expiry.")
			return
		}
		at := q.now + int64(math.Round(d*86_400_000))
		expiresAt = &at
	}
	token := AccessTokenPrefix + authcrypto.RandomToken()
	id := ledger.NewUUID()
	err := q.tx(func(tx pgx.Tx) error {
		if _, err := tx.Exec(q.ctx,
			`INSERT INTO access_token (id, operator_id, token_hash, token_prefix, name, scopes, created_at, expires_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			id, p.op.ID, authcrypto.SHA256Hex(token), token[:10], name, jsobj.Stringify(stringsToAny(scopes)), q.now, expiresAt); err != nil {
			return err
		}
		return q.audit(tx, "token.created", &id, jsobj.New("name", name, "scopes", stringsToAny(scopes)))
	})
	if err != nil {
		q.internal(err)
		return
	}
	// Shown once. Effective access is the operator's role, limited to these scopes.
	q.json(http.StatusCreated, jsobj.New("id", id, "token", token, "scopes", stringsToAny(scopes)))
}

func adminRevokeToken(q *adminReq) {
	id := q.params["id"]
	found := false
	err := q.tx(func(tx pgx.Tx) error {
		tag, err := tx.Exec(q.ctx, "UPDATE access_token SET revoked_at = $1 WHERE id = $2 AND operator_id = $3 AND revoked_at IS NULL", q.now, id, q.p.op.ID)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		found = true
		return q.audit(tx, "token.revoked", &id, nil)
	})
	if err != nil {
		q.internal(err)
		return
	}
	if !found {
		q.notFound("Token")
		return
	}
	q.json(http.StatusOK, jsobj.New())
}

// --- secret keys (server-to-server) --------------------------------------------------------------

func adminSecretKeys(q *adminReq) {
	only := q.query("project")
	query := `SELECT id, project_id, key_prefix, name, scopes, created_at, last_used_at, expires_at, revoked_at FROM api_key`
	var args []any
	if only != "" {
		query += " WHERE project_id = $1"
		args = append(args, only)
	}
	rows, err := q.s.Pool.Query(q.ctx, query+" ORDER BY created_at, id", args...)
	if err != nil {
		q.internal(err)
		return
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (any, error) {
		var id, project, prefix, name, scopes string
		var created int64
		var lastUsed, expires, revoked *int64
		if err := r.Scan(&id, &project, &prefix, &name, &scopes, &created, &lastUsed, &expires, &revoked); err != nil {
			return nil, err
		}
		parsed, _ := jsobj.Parse([]byte(scopes))
		return jsobj.New("id", id, "project_id", project, "key_prefix", prefix, "name", name, "scopes", parsed,
			"created_at", float64(created), "last_used_at", numOrNull(lastUsed), "expires_at", numOrNull(expires), "revoked_at", numOrNull(revoked)), nil
	})
	if err != nil {
		q.internal(err)
		return
	}
	if list == nil {
		list = []any{}
	}
	q.json(http.StatusOK, jsobj.New("secret_keys", list))
}

func adminCreateSecretKey(q *adminReq) {
	name, ok := q.propString("name")
	if !ok || jsobj.Trim(name) == "" {
		q.bad("name is required.")
		return
	}
	name = jsobj.Trim(name)
	requested, _ := q.propString("project")
	project := q.project(requested)
	if project == nil {
		return
	}
	scopes := []string{"customers:read"}
	if raw, present := q.prop("scopes"); present && raw != nil {
		list, ok := stringListProp(raw, func(s string) bool { return contains(secretkeys.Scopes, s) })
		if !ok {
			q.bad("scopes must list some of: " + strings.Join(secretkeys.Scopes, ", ") + ".")
			return
		}
		scopes = list
	}
	key := secretkeys.Prefix + authcrypto.RandomToken()
	id := ledger.NewUUID()
	err := q.tx(func(tx pgx.Tx) error {
		if _, err := tx.Exec(q.ctx,
			"INSERT INTO api_key (id, project_id, key_hash, key_prefix, name, scopes, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
			id, project.ID, secretkeys.Hash(key), key[:10], name, jsobj.Stringify(stringsToAny(scopes)), q.now); err != nil {
			return err
		}
		return q.audit(tx, "secret_key.created", &id, jsobj.New("name", name, "scopes", stringsToAny(scopes), "project", project.ID))
	})
	if err != nil {
		q.internal(err)
		return
	}
	q.json(http.StatusCreated, jsobj.New("id", id, "key", key, "scopes", stringsToAny(scopes), "project_id", project.ID)) // shown once
}

func adminRevokeSecretKey(q *adminReq) {
	id := q.params["id"]
	found := false
	err := q.tx(func(tx pgx.Tx) error {
		tag, err := tx.Exec(q.ctx, "UPDATE api_key SET revoked_at = $1 WHERE id = $2 AND revoked_at IS NULL", q.now, id)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		found = true
		return q.audit(tx, "secret_key.revoked", &id, nil)
	})
	if err != nil {
		q.internal(err)
		return
	}
	if !found {
		q.notFound("Secret key")
		return
	}
	q.json(http.StatusOK, jsobj.New("note", "Revoked. It stops working within a minute (lookups are cached briefly)."))
}

// adminExpireSecretKey is for rotation: create a new key, switch your backend over, then expire the
// old one.
func adminExpireSecretKey(q *adminReq) {
	raw, _ := q.prop("in_hours")
	hours, ok := raw.(float64)
	if !ok || hours < 0 || hours > 24*90 {
		q.bad("in_hours must be 0–2160.")
		return
	}
	at := q.now + int64(math.Round(hours*3600_000))
	id := q.params["id"]
	found := false
	err := q.tx(func(tx pgx.Tx) error {
		tag, err := tx.Exec(q.ctx, "UPDATE api_key SET expires_at = $1 WHERE id = $2 AND revoked_at IS NULL", at, id)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		found = true
		return q.audit(tx, "secret_key.expiry_set", &id, jsobj.New("expires_at", float64(at)))
	})
	if err != nil {
		q.internal(err)
		return
	}
	if !found {
		q.notFound("Secret key")
		return
	}
	q.json(http.StatusOK, jsobj.New("expires_at", float64(at)))
}

// --- webhooks ------------------------------------------------------------------------------------

func adminDeliveries(q *adminReq) {
	status := q.query("status")
	if status != "" && !contains(webhooks.DeliveryStatuses, status) {
		q.bad("status must be pending, delivered or failed.")
		return
	}
	limit := q.queryLimit("limit", 50, 200)
	list, err := webhooks.ListDeliveries(q.ctx, q.s.Pool, status, limit)
	if err != nil {
		q.internal(err)
		return
	}
	out := []any{}
	for _, d := range list {
		app, _ := d.Get("app_id")
		if id, ok := app.(string); ok && !q.p.canSeeApp(id) {
			continue
		}
		out = append(out, d)
	}
	q.json(http.StatusOK, jsobj.New("deliveries", out))
}

// jsNumber is JavaScript's Number(s) for a query parameter (NaN when it isn't one).
func jsNumber(s string) float64 {
	t := jsobj.Trim(s)
	if t == "" {
		return 0
	}
	if strings.HasPrefix(t, "0x") || strings.HasPrefix(t, "0X") {
		if n, err := strconv.ParseUint(t[2:], 16, 64); err == nil {
			return float64(n)
		}
		return math.NaN()
	}
	switch t {
	case "Infinity", "+Infinity":
		return math.Inf(1)
	case "-Infinity":
		return math.Inf(-1)
	}
	for _, c := range t {
		if !(c >= '0' && c <= '9' || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') {
			return math.NaN()
		}
	}
	n, err := strconv.ParseFloat(t, 64)
	if err != nil {
		return math.NaN()
	}
	return n
}

// queryLimit is Lite's `Math.min(Number(q ?? def) || def, max)`.
func (q *adminReq) queryLimit(name string, def, max int) int {
	n := float64(def)
	if q.hasQuery(name) {
		if v := jsNumber(q.query(name)); v != 0 && !math.IsNaN(v) {
			n = v
		}
	}
	n = math.Min(n, float64(max))
	if n < 1 {
		// Below one (Postgres refuses a negative LIMIT, SQLite reads it as no limit) it's the
		// largest page, as on Lite.
		return max
	}
	return int(n)
}

func adminReplay(q *adminReq) {
	id := q.params["id"]
	appID, _, found, err := webhooks.EventApp(q.ctx, q.s.Pool, id)
	if err != nil {
		q.internal(err)
		return
	}
	if !found || !q.p.canSeeApp(appID) {
		q.notFound("Event")
		return
	}
	// The same event (same id and body) goes out again: consumers deduplicate on event.id.
	err = q.tx(func(tx pgx.Tx) error {
		if err := webhooks.Replay(q.ctx, tx, id, q.now); err != nil {
			return err
		}
		return q.audit(tx, "webhook.replayed", &id, nil)
	})
	if err != nil {
		q.internal(err)
		return
	}
	q.s.deliverIDsLater(q.cfg, []string{id})
	q.json(http.StatusOK, jsobj.New("replayed", id))
}

// --- audit log -----------------------------------------------------------------------------------

func adminAudit(q *adminReq) {
	var before int64
	if v := jsNumber(q.query("before")); !math.IsNaN(v) && v != 0 {
		before = int64(v)
	}
	limit := q.queryLimit("limit", 100, 500)
	query := "SELECT id, at, operator_id, actor, token_id, source, action, target, details, ip FROM audit_log"
	args := []any{limit}
	if before != 0 {
		query += " WHERE id < $2"
		args = append(args, before)
	}
	rows, err := q.s.Pool.Query(q.ctx, query+" ORDER BY id DESC LIMIT $1", args...)
	if err != nil {
		q.internal(err)
		return
	}
	var lastID int64
	entries, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (any, error) {
		var id, at int64
		var operatorID, actor, tokenID, target, details, ip *string
		var source, action string
		if err := r.Scan(&id, &at, &operatorID, &actor, &tokenID, &source, &action, &target, &details, &ip); err != nil {
			return nil, err
		}
		lastID = id
		var d any
		if details != nil && *details != "" {
			d, _ = jsobj.Parse([]byte(*details))
		}
		return jsobj.New("id", float64(id), "at", float64(at), "operator_id", strOrNull(operatorID), "actor", strOrNull(actor),
			"token_id", strOrNull(tokenID), "source", source, "action", action, "target", strOrNull(target), "details", d, "ip", strOrNull(ip)), nil
	})
	if err != nil {
		q.internal(err)
		return
	}
	var next any
	if len(entries) == limit && limit > 0 {
		next = float64(lastID)
	}
	if entries == nil {
		entries = []any{}
	}
	q.json(http.StatusOK, jsobj.New("entries", entries, "next_before", next))
}

// --- config --------------------------------------------------------------------------------------
//
// The whole config is one document: every project, app, product, entitlement, offering and webhook.
// Each save is a new version, so the history is a list of documents and a rollback is saving an old
// one again. Saves name the version they were made from (base_id), so two people editing at once
// can't overwrite each other: the second save gets 409. It holds no secrets: store keys and webhook
// secrets are environment variables, named here.

func configProblems(q *adminReq, problems []string) {
	q.json(http.StatusBadRequest, jsobj.New("code", "invalid_config", "message", "The config has problems.", "problems", stringsToAny(problems)))
}

func versionJSON(v *config.StoredVersion) *jsobj.Object {
	return jsobj.New("id", float64(v.ID), "document", v.Document, "created_at", float64(v.CreatedAt),
		"created_by", strOrNull(v.CreatedBy), "note", strOrNull(v.Note))
}

func adminConfig(q *adminReq) {
	v, err := config.CurrentVersion(q.ctx, q.s.Pool)
	if err != nil {
		q.internal(err)
		return
	}
	if v == nil {
		q.json(http.StatusOK, jsobj.New("id", 0.0, "document", q.cfg.Document, "created_at", nil, "created_by", nil, "note", nil))
		return
	}
	q.json(http.StatusOK, versionJSON(v))
}

func adminValidateConfig(q *adminReq) {
	doc, _ := q.prop("document")
	next, err := config.Parse(doc)
	if err != nil {
		var ce *config.Error
		if errors.As(err, &ce) {
			q.json(http.StatusOK, jsobj.New("valid", false, "problems", stringsToAny(ce.Problems)))
			return
		}
		q.internal(err)
		return
	}
	problems, err := config.ChangeProblems(q.ctx, q.s.Pool, q.cfg, next)
	if err != nil {
		q.internal(err)
		return
	}
	if problems == nil {
		problems = []string{}
	}
	q.json(http.StatusOK, jsobj.New("valid", len(problems) == 0, "problems", stringsToAny(problems)))
}

// saveVersion validates, checks the change against the current config, and saves a new version.
func saveVersion(q *adminReq, document any, baseRaw any, note *string, action string, extra ...any) {
	base, ok := baseRaw.(float64)
	if !ok || base != math.Trunc(base) || base < 0 || math.IsInf(base, 0) {
		q.bad("base_id must be the id of the version you changed (from GET /admin/v1/config; 0 if there's none).")
		return
	}
	if note != nil && jsobj.UTF16Len(*note) > 500 {
		q.bad("note can be at most 500 characters.")
		return
	}
	next, err := config.Parse(document)
	if err != nil {
		var ce *config.Error
		if errors.As(err, &ce) {
			configProblems(q, ce.Problems)
			return
		}
		q.internal(err)
		return
	}
	problems, err := config.ChangeProblems(q.ctx, q.s.Pool, q.cfg, next)
	if err != nil {
		q.internal(err)
		return
	}
	if len(problems) > 0 {
		configProblems(q, problems)
		return
	}
	by := q.p.op.Email
	id, _, err := config.Save(q.ctx, q.s.Pool, next.Document, int64(base), &by, note, q.now)
	if err != nil {
		var ce *config.Error
		switch {
		case errors.As(err, &ce):
			configProblems(q, ce.Problems)
		case errors.Is(err, config.ErrConflict):
			q.fail(http.StatusConflict, "conflict", err.Error())
		default:
			q.internal(err)
		}
		return
	}
	q.s.Config.Invalidate()
	q.s.Experiments.Forget()
	// Audited once saved (a refused save writes nothing).
	details := jsobj.New("base_id", base, "note", strOrNull(note))
	for i := 0; i+1 < len(extra); i += 2 {
		details.Set(extra[i].(string), extra[i+1])
	}
	idStr := strconv.FormatInt(id, 10)
	if err := q.audit(q.s.Pool, action, &idStr, details); err != nil {
		q.internal(err)
		return
	}
	q.json(http.StatusCreated, jsobj.New("id", float64(id)))
}

func adminSaveConfig(q *adminReq) {
	doc, _ := q.prop("document")
	base, _ := q.prop("base_id")
	var note *string
	if s, ok := q.propString("note"); ok && jsobj.Trim(s) != "" {
		t := jsobj.Trim(s)
		note = &t
	}
	saveVersion(q, doc, base, note, "config.saved")
}

func adminConfigVersions(q *adminReq) {
	limit := q.queryLimit("limit", 50, 200)
	var before int64
	if v := jsNumber(q.query("before")); !math.IsNaN(v) && v != 0 {
		before = int64(v)
	}
	versions, err := config.ListVersions(q.ctx, q.s.Pool, limit, before)
	if err != nil {
		q.internal(err)
		return
	}
	list := []any{}
	for _, v := range versions {
		list = append(list, jsobj.New("id", float64(v.ID), "created_at", float64(v.CreatedAt), "created_by", strOrNull(v.CreatedBy), "note", strOrNull(v.Note)))
	}
	var next any
	if len(versions) == limit {
		next = float64(versions[len(versions)-1].ID)
	}
	q.json(http.StatusOK, jsobj.New("versions", list, "next_before", next))
}

// versionParam is Lite's `Number(c.req.param("id")) || 0`; a fraction matches no version.
func versionParam(q *adminReq) int64 {
	n := jsNumber(q.params["id"])
	if math.IsNaN(n) || math.IsInf(n, 0) || n != math.Trunc(n) || math.Abs(n) > 1<<53 {
		return 0
	}
	return int64(n)
}

func adminConfigVersion(q *adminReq) {
	id := versionParam(q)
	var v *config.StoredVersion
	var err error
	if id != 0 {
		v, err = config.GetVersion(q.ctx, q.s.Pool, id)
	}
	if err != nil {
		q.internal(err)
		return
	}
	if v == nil {
		q.notFound("Config version")
		return
	}
	q.json(http.StatusOK, versionJSON(v))
}

// adminRestoreConfig is a rollback: the old document is saved again as the newest version.
func adminRestoreConfig(q *adminReq) {
	id := versionParam(q)
	var v *config.StoredVersion
	var err error
	if id != 0 {
		v, err = config.GetVersion(q.ctx, q.s.Pool, id)
	}
	if err != nil {
		q.internal(err)
		return
	}
	if v == nil {
		q.notFound("Config version")
		return
	}
	base, _ := q.prop("base_id")
	note := "Restored version " + strconv.FormatInt(id, 10)
	saveVersion(q, v.Document, base, &note, "config.restored", "restored", float64(id))
}

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "SQLSTATE 23505")
}
