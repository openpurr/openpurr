package server

// Deployment-wide settings, the free-plan usage report (Lite only: Standard answers that it doesn't
// apply), and the setup checks (GET /admin/v1/doctor, a port of lite/src/office/doctor.ts with
// Standard's own checks where Lite's are about Cloudflare). Ports of admin.ts, setup.ts and the
// parts of usage.ts the dashboard reads.

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/db"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
)

func (s *server) setting(ctx context.Context, key string) (*string, error) {
	var v string
	err := s.Pool.QueryRow(ctx, "SELECT value FROM setting WHERE key = $1", key).Scan(&v)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}

// storedSDKURL is the stored SDK URL, or nil when it hasn't been set.
func (s *server) storedSDKURL(ctx context.Context) (*string, error) {
	v, err := s.setting(ctx, "sdk_url")
	if err != nil || v == nil || *v == "" {
		return nil, err
	}
	return v, nil
}

func (s *server) cloudflarePlan(ctx context.Context) (string, error) {
	v, err := s.setting(ctx, "cloudflare_plan")
	if err != nil {
		return "", err
	}
	if v != nil && *v == "paid" {
		return "paid", nil
	}
	return "free", nil
}

// parseSDKURL checks an SDK URL as typed: a bare https origin (http only for localhost).
func parseSDKURL(input string) (string, string) {
	u, err := url.Parse(jsobj.Trim(input))
	if err != nil || u.Scheme == "" || u.Host == "" || u.Opaque != "" {
		return "", "Enter a full address, e.g. https://purchases.example.com."
	}
	scheme := strings.ToLower(u.Scheme)
	host := strings.ToLower(u.Hostname())
	if scheme != "https" && !(scheme == "http" && (host == "localhost" || host == "127.0.0.1")) {
		return "", "The SDK URL must use https (http is allowed only for localhost)."
	}
	if (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return "", "Enter just the address, e.g. https://purchases.example.com, with no path: the SDK adds /v1 itself."
	}
	origin := scheme + "://" + host
	if port := u.Port(); port != "" && !(scheme == "https" && port == "443") && !(scheme == "http" && port == "80") {
		origin += ":" + port
	}
	return origin, ""
}

// sdkURLGuess is what the dashboard's setup code shows until the SDK URL is set. Standard serves
// the SDK API and the back office from one server, so it's this server's own address (Lite guesses
// the SDK Worker's workers.dev address).
func (s *server) sdkURLGuess(r *http.Request) string { return s.requestOrigin(r) }

func (q *adminReq) settings() (*jsobj.Object, error) {
	required, err := requireTOTPForEveryone(q.ctx, q.s.Pool)
	if err != nil {
		return nil, err
	}
	plan, err := q.s.cloudflarePlan(q.ctx)
	if err != nil {
		return nil, err
	}
	sdkURL, err := q.s.storedSDKURL(q.ctx)
	if err != nil {
		return nil, err
	}
	// sdk_url is what was set (null if nothing); sdk_url_guess is shown until then.
	return jsobj.New("require_totp", required, "cloudflare_plan", plan, "sdk_url", strOrNull(sdkURL),
		"sdk_url_guess", q.s.sdkURLGuess(q.r), "edition", Edition), nil
}

func adminSettings(q *adminReq) {
	out, err := q.settings()
	if err != nil {
		q.internal(err)
		return
	}
	q.json(http.StatusOK, out)
}

// adminPutSettings changes the settings sent.
func adminPutSettings(q *adminReq) {
	totp, totpSet := q.prop("require_totp")
	plan, planSet := q.prop("cloudflare_plan")
	sdkRaw, sdkSet := q.prop("sdk_url")
	if !totpSet && !planSet && !sdkSet {
		q.bad("Send require_totp, cloudflare_plan and/or sdk_url.")
		return
	}
	if _, ok := totp.(bool); totpSet && !ok {
		q.bad("require_totp must be true or false.")
		return
	}
	if planSet && plan != "free" && plan != "paid" {
		q.bad("cloudflare_plan must be free or paid.")
		return
	}
	if totp == true && q.p.op.TOTPEnabled == 0 {
		q.forbidden("Turn on two-step sign-in for yourself first.")
		return
	}
	// sdk_url: an address, or null or "" to go back to the guess.
	var sdkURL *string
	if sdkSet {
		str, isStr := sdkRaw.(string)
		if sdkRaw != nil && !isStr {
			q.bad("sdk_url must be an address or null.")
			return
		}
		if isStr && jsobj.Trim(str) != "" {
			origin, problem := parseSDKURL(str)
			if problem != "" {
				q.bad(problem)
				return
			}
			sdkURL = &origin
		}
	}
	set := func(tx pgx.Tx, key, value string) error {
		_, err := tx.Exec(q.ctx,
			`INSERT INTO setting (key, value, updated_at) VALUES ($1, $2, $3)
			 ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, key, value, q.now)
		return err
	}
	err := q.tx(func(tx pgx.Tx) error {
		if totpSet {
			value := "false"
			if totp == true {
				value = "true"
			}
			if err := set(tx, "require_totp", value); err != nil {
				return err
			}
			if err := q.audit(tx, "setting.require_totp", nil, jsobj.New("value", totp)); err != nil {
				return err
			}
		}
		if planSet {
			if err := set(tx, "cloudflare_plan", plan.(string)); err != nil {
				return err
			}
			if err := q.audit(tx, "setting.cloudflare_plan", nil, jsobj.New("value", plan)); err != nil {
				return err
			}
		}
		if sdkSet {
			if sdkURL != nil {
				if err := set(tx, "sdk_url", *sdkURL); err != nil {
					return err
				}
			} else if _, err := tx.Exec(q.ctx, "DELETE FROM setting WHERE key = 'sdk_url'"); err != nil {
				return err
			}
			if err := q.audit(tx, "setting.sdk_url", nil, jsobj.New("value", strOrNull(sdkURL))); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		q.internal(err)
		return
	}
	adminSettings(q)
}

// --- usage ---------------------------------------------------------------------------------------

// Lite watches Cloudflare's free-plan daily limits. Standard has no such limits: the report says
// so (configured false, no metrics) and names the edition, so the dashboard can leave it out.
func adminUsage(q *adminReq) {
	plan, err := q.s.cloudflarePlan(q.ctx)
	if err != nil {
		q.internal(err)
		return
	}
	q.json(http.StatusOK, jsobj.New("configured", false, "plan", plan, "updated_at", nil, "error", nil, "error_at", nil,
		"metrics", []any{}, "edition", Edition, "available", false))
}

func adminUsageRefresh(q *adminReq) {
	q.bad("Usage alerts watch Cloudflare's free-plan daily limits, which openpurr Standard doesn't have.")
}

// --- setup checks ----------------------------------------------------------------------------------

// check is one setup check.
type check struct {
	id, title, status, message, fix string
}

func (c check) json() *jsobj.Object {
	o := jsobj.New("id", c.id, "title", c.title, "status", c.status, "message", c.message)
	if c.fix != "" {
		o.Set("fix", c.fix)
	}
	return o
}

func day(ms int64) string { return time.UnixMilli(ms).UTC().Format("2006-01-02") }

// runChecks is the setup check list: is this deployment ready, and if not, exactly what to do.
// Every check reads only small, indexed amounts of data.
func (q *adminReq) runChecks() ([]check, error) {
	ctx, pool, now := q.ctx, q.s.Pool, q.now
	cfg, p := q.cfg, q.p
	origin := q.s.requestOrigin(q.r)
	var checks []check
	add := func(c check) { checks = append(checks, c) }

	// Database schema.
	expected := db.LatestMigration()
	var applied *string
	if err := pool.QueryRow(ctx, "SELECT max(version) FROM "+db.MigrationsTable).Scan(&applied); err != nil {
		return nil, err
	}
	switch {
	case applied != nil && *applied == expected:
		add(check{id: "database", title: "Database", status: "ok", message: "Up to date (" + expected + ")."})
	case applied == nil || *applied < expected:
		have := "none"
		if applied != nil {
			have = *applied
		}
		add(check{id: "database", title: "Database", status: "fail",
			message: "Migrations are behind: the newest applied is " + have + ", this version needs " + expected + ".",
			fix:     "Restart the server: it applies its migrations at startup."})
	default:
		add(check{id: "database", title: "Database", status: "warn",
			message: "The database (" + *applied + ") is newer than this server expects (" + expected + ").",
			fix:     "Deploy the latest openpurr Standard on every replica."})
	}

	// The SDK's address, for the dashboard's setup code.
	sdkURL, err := q.s.storedSDKURL(ctx)
	if err != nil {
		return nil, err
	}
	if sdkURL == nil {
		add(check{id: "sdk-url", title: "SDK URL", status: "info",
			message: "Not set, so the dashboard's setup code guesses " + q.s.sdkURLGuess(q.r) + " for Purchases.proxyURL.",
			fix:     "Set it on the dashboard's Settings page: the address your apps reach openpurr at, ideally a domain you own."})
	} else {
		add(check{id: "sdk-url", title: "SDK URL", status: "ok", message: "Apps use " + *sdkURL + "."})
	}

	// Projects and their apps. With one project, checks keep their plain IDs; with several, each is
	// prefixed with its project.
	projects := visibleProjects(cfg, p)
	var apps []*config.App
	for _, a := range allApps(cfg) {
		if p.canSeeApp(a.ID) {
			apps = append(apps, a)
		}
	}
	if len(apps) == 0 {
		add(check{id: "apps", title: "Apps", status: "fail", message: "No apps in the config.", fix: "Add a project and its apps to the config (PUT /admin/v1/config)."})
	}
	type running struct{ id, projectID, name, variants string }
	rows, err := pool.Query(ctx, "SELECT id, project_id, name, variants FROM experiment WHERE status = 'running'")
	if err != nil {
		return nil, err
	}
	experiments, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (running, error) {
		var x running
		return x, r.Scan(&x.id, &x.projectID, &x.name, &x.variants)
	})
	if err != nil {
		return nil, err
	}
	several := len(projects) > 1
	for _, project := range projects {
		id := func(c string) string {
			if several {
				return "project:" + project.ID + ":" + c
			}
			return c
		}
		title := func(t string) string {
			if several {
				return project.Name + ": " + t
			}
			return t
		}
		if len(project.Apps) == 0 && len(apps) > 0 {
			add(check{id: id("apps"), title: title("Apps"), status: "warn", message: "This project has no apps yet.", fix: "Add its apps to the config."})
		}
		for _, appID := range project.AppOrder {
			app := project.Apps[appID]
			if len(app.Products) == 0 && p.canSeeApp(app.ID) {
				add(check{id: "app:" + app.ID + ":products", title: app.ID + ": Products", status: "warn",
					message: "No products yet, so nothing can be bought in this app.",
					fix:     "Add the app's products (as in App Store Connect or Play Console) to the config."})
			}
		}
		if len(project.Entitlements) == 0 {
			add(check{id: id("entitlements"), title: title("Entitlements"), status: "warn", message: "No entitlements are configured, so purchases unlock nothing.", fix: "Add entitlements to the config."})
		}
		for _, exp := range experiments {
			if exp.projectID != project.ID {
				continue
			}
			var missing []string
			if v, err := jsobj.Parse([]byte(exp.variants)); err == nil {
				list, _ := v.([]any)
				for _, variant := range list {
					offering, _ := jsobj.Prop(variant, "offering_id")
					oid, _ := offering.(string)
					if !hasOffering(project, oid) {
						missing = append(missing, oid)
					}
				}
			}
			if len(missing) > 0 {
				add(check{id: id("experiment"), title: title("Price experiment"), status: "warn",
					message: `"` + exp.name + `" is running, but its variant offerings ` + strings.Join(missing, ", ") + " are no longer in the config: their customers see the current offering instead.",
					fix:     "Put the offerings back in the config, or stop the experiment (Experiments page)."})
			} else {
				add(check{id: id("experiment"), title: title("Price experiment"), status: "info", message: `"` + exp.name + `" is running: new customers see one of its offerings as the current one.`})
			}
		}
		if project.CurrentOffering == nil {
			add(check{id: id("offerings"), title: title("Offerings"), status: "info", message: "No current offering: Purchases.getOfferings() returns none.", fix: "Mark one offering current in the config if your paywall uses offerings."})
		}
	}

	last := map[string]int64{}
	rows, err = pool.Query(ctx, "SELECT app_id, max(received_at) FROM store_notification WHERE received_at > $1 AND app_id IS NOT NULL GROUP BY app_id", now-90*dayMs)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var appID string
		var at int64
		if err := rows.Scan(&appID, &at); err != nil {
			rows.Close()
			return nil, err
		}
		last[appID] = at
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	secretSet := func(name string) bool {
		v, ok := q.s.Secret(name)
		return ok && v != ""
	}
	for _, app := range apps {
		if app.Store == config.AppStore {
			api := app.AppStoreServerAPI
			cid, ctitle := "app:"+app.ID+":server-api", app.ID+": App Store Server API"
			switch {
			case api == nil:
				add(check{id: cid, title: ctitle, status: "warn",
					message: "No In-App Purchase key configured: StoreKit 1 receipts (older SDKs, restores of old purchases) can't be resolved, and subscriptions can't be refreshed from Apple.",
					fix:     "In App Store Connect → Users and Access → Integrations → In-App Purchase, create a key. Add issuer_id and key_id under app_store_server_api in the app's config, then set the environment variable APPLE_IAP_KEY on the server to the .p8 file's contents."})
			case !secretSet(api.PrivateKeySecret):
				add(check{id: cid, title: ctitle, status: "fail",
					message: "The config names the secret " + api.PrivateKeySecret + ", but it isn't set on this server.",
					fix:     "Set the environment variable " + api.PrivateKeySecret + " on the server (every replica) to the .p8 file's contents."})
			default:
				add(check{id: cid, title: ctitle, status: "ok", message: "Key " + api.KeyID + " configured."})
			}
			nid, ntitle := "app:"+app.ID+":notifications", app.ID+": App Store Server Notifications"
			if at, ok := last[app.ID]; ok {
				add(check{id: nid, title: ntitle, status: "ok", message: "Last received " + day(at) + "."})
			} else {
				add(check{id: nid, title: ntitle, status: "warn",
					message: "None received in the last 90 days. Without them, renewals, refunds and cancellations only show up when the app next sends a receipt.",
					fix:     "In App Store Connect → your app → App Information → App Store Server Notifications, set both the production and sandbox URL to " + origin + "/notifications/apple (Version 2). Then send a test notification (App Store Server API: Request a Test Notification)."})
			}
		} else {
			api := app.GooglePlayAPI
			cid, ctitle := "app:"+app.ID+":play-api", app.ID+": Google Play Developer API"
			switch {
			case api == nil:
				c := check{id: cid, title: ctitle, status: "fail",
					message: "No service account: Google Play purchases are refused (they stay queued on the device).",
					fix:     "Create a service account with Play Console access (View financial data, Manage orders and subscriptions), add google_play_api to the app's config, then set the environment variable GOOGLE_SERVICE_ACCOUNT on the server to its JSON key."}
				if app.AllowUnverifiedPurchases {
					c.status = "warn"
					c.message = "No service account: purchases are accepted without verification (allow_unverified_purchases). Anyone with the public SDK key could grant themselves access. Development only."
				}
				add(c)
			case !secretSet(api.ServiceAccountSecret):
				add(check{id: cid, title: ctitle, status: "fail",
					message: "The config names the secret " + api.ServiceAccountSecret + ", but it isn't set on this server.",
					fix:     "Set the environment variable " + api.ServiceAccountSecret + " on the server (every replica) to the service account's JSON key."})
			default:
				add(check{id: cid, title: ctitle, status: "ok", message: "Service account configured."})
			}
			nid, ntitle := "app:"+app.ID+":notifications", app.ID+": Real-time developer notifications"
			if at, ok := last[app.ID]; ok {
				add(check{id: nid, title: ntitle, status: "ok", message: "Last received " + day(at) + "."})
			} else {
				status := "info"
				if api != nil {
					status = "warn"
				}
				add(check{id: nid, title: ntitle, status: status,
					message: "None received in the last 90 days. Without them, renewals, cancellations and refunds only show up when the app next syncs.",
					fix:     "Create a Pub/Sub topic, set it in Play Console → Monetization setup → Real-time developer notifications, and add a push subscription to " + origin + "/notifications/google with authentication on (set pubsub_push_account in the config). Then use \"Send test notification\" in the Play Console."})
			}
		}
	}

	// Webhooks (IDs are unique within a project).
	for _, project := range projects {
		for _, w := range project.Webhooks {
			var missing []string
			for _, name := range []string{w.AuthorizationSecret, w.SigningSecret} {
				if name != "" && !secretSet(name) {
					missing = append(missing, name)
				}
			}
			wid, wtitle := "webhook:"+w.ID, "Webhook "+w.ID
			if several {
				wid, wtitle = "webhook:"+project.ID+":"+w.ID, project.Name+": webhook "+w.ID
			}
			if len(missing) > 0 {
				plural := ""
				if len(missing) > 1 {
					plural = "s"
				}
				fixes := make([]string, len(missing))
				for i, name := range missing {
					fixes[i] = "set the environment variable " + name + " on the server"
				}
				fix := strings.Join(fixes, "; ")
				add(check{id: wid, title: wtitle, status: "fail",
					message: "Secret" + plural + " " + strings.Join(missing, ", ") + " not set: deliveries can't be signed or authorized.",
					fix:     strings.ToUpper(fix[:1]) + fix[1:] + "."})
			} else {
				host := w.URL
				if u, err := url.Parse(w.URL); err == nil {
					host = u.Host
				}
				add(check{id: wid, title: wtitle, status: "ok", message: "Sends to " + host + "."})
			}
		}
	}
	var failed int64
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM webhook_delivery WHERE status = 'failed' AND created_at > $1", now-dayMs).Scan(&failed); err != nil {
		return nil, err
	}
	if failed > 0 {
		word := "deliveries"
		if failed == 1 {
			word = "delivery"
		}
		add(check{id: "webhook-failures", title: "Webhook deliveries", status: "warn",
			message: fmt.Sprintf("%d %s gave up in the last 24 hours.", failed, word),
			fix:     "See Webhooks in the dashboard (or openpurr webhooks --status failed), fix the endpoint, then replay."})
	}

	// Background jobs and exchange rates.
	var lastJob *int64
	if err := pool.QueryRow(ctx, "SELECT max(updated_at) FROM job_state WHERE key LIKE 'job_slot:%'").Scan(&lastJob); err != nil {
		return nil, err
	}
	switch {
	case lastJob == nil:
		add(check{id: "cron", title: "Scheduled job", status: "info", message: "Hasn't run yet (the server runs its jobs every 5 minutes)."})
	case now-*lastJob > 2*3600_000:
		add(check{id: "cron", title: "Scheduled job", status: "warn",
			message: "Last ran " + time.UnixMilli(*lastJob).UTC().Format("2006-01-02 15:04") + " UTC. It should run every 5 minutes.",
			fix:     "Check that a server is running and its logs for job errors: the jobs run inside the server process."})
	default:
		add(check{id: "cron", title: "Scheduled job", status: "ok", message: "Running."})
	}
	var fxDate *string
	if err := pool.QueryRow(ctx, "SELECT max(date) FROM fx_rate").Scan(&fxDate); err != nil {
		return nil, err
	}
	switch {
	case fxDate == nil || *fxDate == "":
		add(check{id: "fx", title: "Exchange rates", status: "info", message: "None fetched yet (the scheduled job fetches them daily). Until then, non-USD revenue isn't in USD totals."})
	default:
		t, err := time.Parse("2006-01-02", *fxDate)
		if err == nil && now-t.UnixMilli() > 5*dayMs {
			add(check{id: "fx", title: "Exchange rates", status: "warn", message: "The newest rates are from " + *fxDate + ".", fix: "Check the server's logs for refresh-exchange-rates errors."})
		} else {
			add(check{id: "fx", title: "Exchange rates", status: "ok", message: "Rates from " + *fxDate + "."})
		}
	}

	// Operator security.
	required, err := requireTOTPForEveryone(ctx, pool)
	if err != nil {
		return nil, err
	}
	if !required {
		var owners, withTOTP int64
		if err := pool.QueryRow(ctx, "SELECT count(*), coalesce(sum(totp_enabled), 0) FROM operator WHERE role = 'owner' AND disabled_at IS NULL").Scan(&owners, &withTOTP); err != nil {
			return nil, err
		}
		status := "warn"
		if withTOTP > 0 && withTOTP >= owners {
			status = "info"
		}
		add(check{id: "two-step", title: "Two-step sign-in", status: status,
			message: "Not required for everyone. Anyone who can sign in can grant entitlements or manage keys (depending on their role).",
			fix:     "Set up two-step sign-in under Your account, then turn on Settings → Require two-step sign-in."})
	} else {
		add(check{id: "two-step", title: "Two-step sign-in", status: "ok", message: "Required for everyone."})
	}
	return checks, nil
}

func hasOffering(project *config.Project, id string) bool {
	for _, o := range project.Offerings {
		if o.ID == id {
			return true
		}
	}
	return false
}

// summarizeChecks is a one-line verdict.
func summarizeChecks(checks []check) string {
	fails, warns := 0, 0
	for _, c := range checks {
		switch c.status {
		case "fail":
			fails++
		case "warn":
			warns++
		}
	}
	plural := func(n int, word string) string {
		if n == 1 {
			return fmt.Sprintf("%d %s", n, word)
		}
		return fmt.Sprintf("%d %ss", n, word)
	}
	switch {
	case fails > 0:
		s := plural(fails, "problem") + " to fix"
		if warns > 0 {
			s += ", " + plural(warns, "warning")
		}
		return s + "."
	case warns > 0:
		return "Working, with " + plural(warns, "warning") + "."
	}
	return "Everything checks out."
}

func adminDoctor(q *adminReq) {
	checks, err := q.runChecks()
	if err != nil {
		q.internal(err)
		return
	}
	list := make([]any, len(checks))
	for i, c := range checks {
		list[i] = c.json()
	}
	q.json(http.StatusOK, jsobj.New("summary", summarizeChecks(checks), "checks", list))
}
