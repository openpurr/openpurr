package server

// The MCP server: /mcp, so an AI assistant (Claude Code, Claude Desktop, any MCP client) can look
// up customers, explain entitlements, read charts and grant access. A port of
// lite/src/office/mcp.ts: the same tools, with the same definitions, in the same order, giving the
// same text and structured results.
//
// Transport: MCP Streamable HTTP, stateless. Each JSON-RPC request is a POST answered with one JSON
// response (no SSE: no tool here streams or calls back). GET and DELETE answer 405, which the spec
// allows. Notifications and client responses get 202.
//
// Auth: "Authorization: Bearer pat_..." personal access tokens (the same as the admin API), or
// OAuth access tokens issued for this endpoint (oauth.go). Either way every tool is limited by the
// operator's role and the token's scopes and by the apps they may see. Unauthenticated requests get
// 401 with WWW-Authenticate pointing at the protected-resource metadata, which starts OAuth.
// tools/list only lists what the token can use. Changes are audited with source "mcp". Browser
// requests from other sites are refused (Origin check), and calls are rate limited per token.

import (
	"context"
	"errors"
	"io"
	"math"
	"math/big"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/customerinfo"
	"github.com/openpurr/openpurr/standard/internal/fx"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
	"github.com/openpurr/openpurr/standard/internal/metrics"
	"github.com/openpurr/openpurr/standard/internal/webhooks"
)

// MCPProtocolVersions are the protocol versions the server speaks, newest first.
var MCPProtocolVersions = []string{"2025-11-25", "2025-06-18", "2025-03-26"}

const mcpInstructions = `openpurr is a self-hosted, RevenueCat-compatible subscription backend. Customers are identified by app user ID (what the app passes to the RevenueCat SDK); a customer can have several (aliases). A deployment has one or more projects (one per title); each has its own apps, entitlements and customers. Projects, apps, products and entitlements come from the deployment's config (get_config). When there are several projects, pass project to the customer tools.
- To answer "why does (or doesn't) a customer have X", use explain_entitlement: it checks every purchase and grant and says what decided it.
- To find a customer by email, transaction ID or the start of an ID, use search_customers.
- Charts (get_metrics) are in USD at each purchase date's exchange rate, days in UTC, and production data unless you ask for sandbox.
- grant_entitlement gives access without a purchase; revoke_grant ends it. Both are audited; confirm with the user before granting or revoking.`

// --- tools -----------------------------------------------------------------------------------------

type toolResult struct {
	text       string
	structured *jsobj.Object
	isError    bool
}

// toolError is a refusal shown to the assistant as the tool's error text.
type toolError struct{ msg string }

func (e *toolError) Error() string { return e.msg }

type mcpTool struct {
	name, title, description string
	inputSchema              *jsobj.Object
	annotations              *jsobj.Object
	permission               string
	// Needs access to all apps (entitlements and grants aren't per app).
	allApps bool
	run     func(q *adminReq, args *jsobj.Object) (*toolResult, error)
}

func readOnly() *jsobj.Object { return jsobj.New("readOnlyHint", true, "openWorldHint", false) }

func writeHints(destructive, idempotent, openWorld bool) *jsobj.Object {
	return jsobj.New("readOnlyHint", false, "destructiveHint", destructive, "idempotentHint", idempotent, "openWorldHint", openWorld)
}

func strProp(description string) *jsobj.Object {
	return jsobj.New("type", "string", "description", description)
}

func appUserIDProp() *jsobj.Object {
	return strProp("The customer's app user ID (or any alias, including $RCAnonymousID:…).")
}

func projectProp() *jsobj.Object {
	return strProp("The project (get_config lists them). Needed only when the deployment has several projects.")
}

func schema(properties *jsobj.Object, required ...string) *jsobj.Object {
	o := jsobj.New("type", "object")
	if properties != nil {
		o.Set("properties", properties)
	}
	if len(required) > 0 {
		o.Set("required", stringsToAny(required))
	}
	o.Set("additionalProperties", false)
	return o
}

func enumOf(values []string) *jsobj.Object {
	return jsobj.New("type", "string", "enum", stringsToAny(values))
}

func intProp(min, max float64, description string) *jsobj.Object {
	o := jsobj.New("type", "integer", "minimum", min, "maximum", max)
	if description != "" {
		o.Set("description", description)
	}
	return o
}

var storeNames = map[string]string{"app_store": "App Store", "play_store": "Google Play", "promotional": "promotional grant"}

func storeName(store string) string {
	if n, ok := storeNames[store]; ok {
		return n
	}
	return store
}

// --- formatting (Lite's helpers) -------------------------------------------------------------------

func dayOrNever(ms *int64) string {
	if ms == nil {
		return "never"
	}
	return day(*ms)
}

// when is a moment as "2026-03-15 12:00 UTC".
func when(ms int64) string { return time.UnixMilli(ms).UTC().Format("2006-01-02 15:04") + " UTC" }

func productLabel(t *ledger.Transaction) string {
	if t.BasePlanID != nil && *t.BasePlanID != "" {
		return t.ProductID + ":" + *t.BasePlanID
	}
	return t.ProductID
}

func num64(f float64) string { return jsobj.FormatNumber(f) }

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}

// jsToFixed is Number.prototype.toFixed: the exact value rounded half up to digits decimals.
func jsToFixed(x float64, digits int) string {
	if math.IsNaN(x) {
		return "NaN"
	}
	if math.Abs(x) >= 1e21 || math.IsInf(x, 0) {
		return jsobj.FormatNumber(x)
	}
	sign := ""
	if x < 0 {
		sign = "-"
		x = -x
	}
	exact := new(big.Float).SetPrec(2048).SetFloat64(x).Text('f', 1100)
	intPart, frac, _ := strings.Cut(exact, ".")
	frac += strings.Repeat("0", digits+1)
	kept := intPart + frac[:digits]
	n := new(big.Int)
	n.SetString(kept, 10)
	if frac[digits] >= '5' {
		n.Add(n, big.NewInt(1))
	}
	s := n.String()
	if digits > 0 {
		if len(s) <= digits {
			s = strings.Repeat("0", digits-len(s)+1) + s
		}
		s = s[:len(s)-digits] + "." + s[len(s)-digits:]
	}
	if s == strings.Repeat("0", len(s)) || strings.Trim(s, "0.") == "" {
		sign = ""
	}
	return sign + s
}

// str reads a string argument: missing ("" or null) is an error when required.
func str(args *jsobj.Object, key string, required bool, max int) (string, bool, error) {
	v, ok := args.Get(key)
	if !ok || v == nil || v == "" {
		if required {
			return "", false, &toolError{key + " is required."}
		}
		return "", false, nil
	}
	s, isStr := v.(string)
	if !isStr {
		return "", false, &toolError{key + " must be a string."}
	}
	if jsobj.UTF16Len(s) > max {
		return "", false, &toolError{key + " is too long."}
	}
	return s, true, nil
}

// num reads a number argument in [min, max], rounded down.
func num(args *jsobj.Object, key string, min, max float64) (float64, bool, error) {
	v, ok := args.Get(key)
	if !ok || v == nil {
		return 0, false, nil
	}
	f, isNum := v.(float64)
	if !isNum || math.IsNaN(f) || math.IsInf(f, 0) || f < min || f > max {
		return 0, false, &toolError{key + " must be a number from " + num64(min) + " to " + num64(max) + "."}
	}
	return math.Floor(f), true, nil
}

// purchaseStatus says how a subscription purchase stands, in words.
func purchaseStatus(t *ledger.Transaction, state *ledger.SubscriptionState, now int64) string {
	if t.RevokedAt != nil {
		reason := ""
		if t.RevocationReason != nil && *t.RevocationReason != "" {
			reason = " (" + *t.RevocationReason + ")"
		}
		return "refunded on " + day(*t.RevokedAt) + reason
	}
	if t.IsUpgraded != 0 {
		return "replaced by an upgrade"
	}
	if t.ExpiresAt == nil {
		if t.ProductType == "consumable" {
			return "consumable"
		}
		return "owned for life"
	}
	expires := *t.ExpiresAt
	var grace *int64
	if state != nil && state.GracePeriodExpiresAt != nil && *state.GracePeriodExpiresAt != 0 && *state.GracePeriodExpiresAt > expires {
		grace = state.GracePeriodExpiresAt
	}
	end := expires
	if grace != nil {
		end = *grace
	}
	var parts []string
	truthy := func(p *int64) bool { return p != nil && *p != 0 }
	if end > now {
		parts = append(parts, "active until "+day(end))
		if grace != nil {
			parts = append(parts, "in a billing grace period (payment failed; access continues until "+day(*grace)+")")
		}
		if t.PeriodType == "trial" {
			parts = append(parts, "free trial")
		}
		if state != nil && state.AutoRenew != nil && *state.AutoRenew == 0 {
			on := ""
			if truthy(state.UnsubscribeDetectedAt) {
				on = " on " + day(*state.UnsubscribeDetectedAt)
			}
			parts = append(parts, "auto-renew turned off"+on+", so it won't renew")
		} else if state != nil && state.AutoRenew != nil && *state.AutoRenew == 1 {
			parts = append(parts, "renews automatically")
		}
	} else {
		parts = append(parts, "expired on "+day(end))
		if t.PeriodType == "trial" {
			parts = append(parts, "a free trial that didn't convert")
		}
		if state != nil && state.Status != nil && *state.Status == 3 {
			parts = append(parts, "the store is still retrying a failed payment (billing retry)")
		} else if state != nil && truthy(state.BillingIssueDetectedAt) {
			parts = append(parts, "a billing problem was seen on "+day(*state.BillingIssueDetectedAt))
		}
		if state != nil && truthy(state.UnsubscribeDetectedAt) {
			parts = append(parts, "auto-renew was turned off on "+day(*state.UnsubscribeDetectedAt))
		}
		if grace != nil {
			parts = append(parts, "after a billing grace period ran out")
		}
	}
	return strings.Join(parts, "; ")
}

type purchaseChain struct {
	latest *ledger.Transaction
	first  int64
	count  int
}

// latestPerChain is the latest purchase of each purchase chain (renewals share the original
// transaction ID), the most recent first.
func latestPerChain(transactions []ledger.Transaction) []*purchaseChain {
	byKey := map[string]*purchaseChain{}
	var chains []*purchaseChain
	for i := range transactions {
		t := &transactions[i]
		key := t.Store + ":" + t.OriginalTransactionID
		c := byKey[key]
		if c == nil {
			c = &purchaseChain{latest: t, first: t.PurchasedAt, count: 1}
			byKey[key] = c
			chains = append(chains, c)
			continue
		}
		c.count++
		c.first = min(c.first, t.PurchasedAt)
		if t.PurchasedAt > c.latest.PurchasedAt {
			c.latest = t
		}
	}
	sort.SliceStable(chains, func(i, j int) bool { return chains[i].latest.PurchasedAt > chains[j].latest.PurchasedAt })
	return chains
}

func stateFor(states []ledger.SubscriptionState, t *ledger.Transaction) *ledger.SubscriptionState {
	for i := range states {
		if states[i].Store == t.Store && states[i].OriginalTransactionID == t.OriginalTransactionID {
			return &states[i]
		}
	}
	return nil
}

func chainLine(c *purchaseChain, states []ledger.SubscriptionState, now int64) string {
	t := c.latest
	var flags []string
	if t.Environment == "sandbox" {
		flags = append(flags, "sandbox")
	}
	if t.Verified == 0 {
		flags = append(flags, "not verified with the store")
	}
	if t.OwnershipType == "FAMILY_SHARED" {
		flags = append(flags, "family sharing")
	}
	renewals := ""
	if c.count > 1 {
		renewals = ", " + strconv.Itoa(c.count-1) + plural(c.count-1, " renewal", " renewals")
	}
	flagText := ""
	if len(flags) > 0 {
		flagText = ", " + strings.Join(flags, ", ")
	}
	return "- " + productLabel(t) + " (" + storeName(t.Store) + ", app " + t.AppID + flagText + "): bought " + day(c.first) + renewals + "; " +
		purchaseStatus(t, stateFor(states, t), now) + ". Transaction " + t.TransactionID + "."
}

func grantLine(g *ledger.Grant, now int64) string {
	var state string
	switch {
	case g.RevokedAt != nil:
		state = "revoked on " + day(*g.RevokedAt)
		if g.RevokedBy != nil && *g.RevokedBy != "" {
			state += " by " + *g.RevokedBy
		}
	case g.ExpiresAt == nil:
		state = "for life"
	case *g.ExpiresAt > now:
		state = "active until " + day(*g.ExpiresAt)
	default:
		state = "ended on " + day(*g.ExpiresAt)
	}
	line := "- " + g.EntitlementID + ", " + g.Duration + " grant (" + state + "), given " + day(g.StartsAt)
	if g.GrantedBy != nil && *g.GrantedBy != "" {
		line += " by " + *g.GrantedBy
	}
	if g.Note != nil && *g.Note != "" {
		line += ` — "` + *g.Note + `"`
	}
	return line + ". Grant ID " + g.ID + "."
}

func refLabel(r config.ProductRef) string {
	if r.BasePlanID != nil && *r.BasePlanID != "" {
		return r.ProductID + ":" + *r.BasePlanID
	}
	return r.ProductID
}

func findEntitlement(project *config.Project, id string) *config.Entitlement {
	for _, e := range project.Entitlements {
		if e.ID == id {
			return e
		}
	}
	return nil
}

// unlockingProducts is which products unlock an entitlement, per app the caller can see.
func unlockingProducts(project *config.Project, entitlementID string, p *principal) string {
	e := findEntitlement(project, entitlementID)
	if e == nil {
		return ""
	}
	var parts []string
	for _, app := range e.ProductApps {
		if !p.canSeeApp(app) {
			continue
		}
		var labels []string
		for _, r := range e.Products[app] {
			label := refLabel(r)
			if r.BasePlanID == nil || *r.BasePlanID == "" {
				if a := project.Apps[app]; a != nil {
					if prod := a.Products[r.ProductID]; prod != nil && len(prod.BasePlans) > 0 {
						label += " (any base plan)"
					}
				}
			}
			labels = append(labels, label)
		}
		parts = append(parts, app+": "+strings.Join(labels, ", "))
	}
	return strings.Join(parts, "; ")
}

// visibleCustomer is a customer's ledger with the purchases in apps the caller can't see left out
// (and how many were).
type visibleCustomer struct {
	*ledger.Loaded
	hidden int
}

func (q *adminReq) loadVisible(project *config.Project, appUserID string) (*visibleCustomer, error) {
	data, err := ledger.LoadCustomer(q.ctx, q.s.Pool, project.ID, appUserID)
	if err != nil || data.Customer == nil {
		return nil, err
	}
	var visible []ledger.Transaction
	for _, t := range data.Transactions {
		if q.p.canSeeApp(t.AppID) {
			visible = append(visible, t)
		}
	}
	hidden := len(data.Transactions) - len(visible)
	out := *data
	out.Transactions = visible
	return &visibleCustomer{Loaded: &out, hidden: hidden}, nil
}

// snapshotEntitlements are a snapshot's subscriber.entitlements.
func snapshotEntitlements(snapshot *jsobj.Object) *jsobj.Object {
	sub, _ := snapshot.Get("subscriber")
	if o, ok := sub.(*jsobj.Object); ok {
		if e, _ := o.Get("entitlements"); e != nil {
			if eo, ok := e.(*jsobj.Object); ok {
				return eo
			}
		}
	}
	return jsobj.New()
}

func entString(e *jsobj.Object, k string) (string, bool) {
	v, _ := e.Get(k)
	s, ok := v.(string)
	return s, ok
}

// activeAt is `expires_date === null || Date.parse(expires_date) > now`.
func activeAt(e *jsobj.Object, now int64) bool {
	exp, ok := entString(e, "expires_date")
	return !ok || jsDateParse(exp) > float64(now)
}

func (q *adminReq) projectArg(args *jsobj.Object) (*config.Project, error) {
	requested, _, err := str(args, "project", false, 50)
	if err != nil {
		return nil, err
	}
	project, _, message := chooseProject(q.cfg, q.p, requested)
	if project == nil {
		return nil, &toolError{message}
	}
	return project, nil
}

func hiddenNote(hidden int) string {
	return strconv.Itoa(hidden) + plural(hidden, " purchase is", " purchases are")
}

// --- the tool list ---------------------------------------------------------------------------------

var mcpTools = buildMCPTools()

func buildMCPTools() []*mcpTool {
	var chartList []string
	var chartIDs []string
	for _, c := range metrics.Charts {
		chartList = append(chartList, c.ID+" ("+c.Label+")")
		chartIDs = append(chartIDs, c.ID)
	}
	return []*mcpTool{
		{
			name:        "lookup_customer",
			title:       "Look up a customer",
			description: "Everything about one customer: app user IDs, attributes (email…), entitlements and when they end, subscriptions with their status, recent purchases and promotional grants.",
			inputSchema: schema(jsobj.New("app_user_id", appUserIDProp(), "project", projectProp()), "app_user_id"),
			annotations: readOnly(),
			permission:  permRead,
			run:         toolLookupCustomer,
		},
		{
			name:        "search_customers",
			title:       "Search customers",
			description: "Find customers by the start of an app user ID, an exact email (the $email attribute), or an exact store transaction ID (Apple transaction or original transaction ID, Google order ID or purchase token). Without a query, lists the newest customers.",
			inputSchema: schema(jsobj.New(
				"query", strProp("App user ID prefix, email, or transaction ID."),
				"purchases_only", jsobj.New("type", "boolean", "description", "Only customers who bought something."),
				"limit", intProp(1, 50, "At most this many (default 20)."),
				"project", projectProp(),
			)),
			annotations: readOnly(),
			permission:  permRead,
			run:         toolSearchCustomers,
		},
		{
			name:        "explain_entitlement",
			title:       "Explain an entitlement",
			description: "Why a customer does or doesn't have an entitlement right now: which purchase or grant decides it, and what happened to each relevant purchase (expired, refunded, auto-renew off, billing problems, sandbox, not verified). Also says which products unlock it and flags purchases of products no entitlement includes.",
			inputSchema: schema(jsobj.New(
				"app_user_id", appUserIDProp(),
				"entitlement_id", strProp("The entitlement, e.g. pro. get_config lists them."),
				"project", projectProp(),
			), "app_user_id", "entitlement_id"),
			annotations: readOnly(),
			permission:  permRead,
			run:         toolExplainEntitlement,
		},
		{
			name:  "get_metrics",
			title: "Get a chart",
			description: "A chart's values per day, week or month: " + strings.Join(chartList, ", ") +
				". Money is USD at each purchase date's exchange rate. Running charts (MRR, active subscriptions, trials) give the value at the end of each period; the others give totals per period. subscription_status is a current breakdown.",
			inputSchema: schema(jsobj.New(
				"chart", enumOf(chartIDs),
				"from", strProp("First day, YYYY-MM-DD (default: 90 days before to)."),
				"to", strProp("Last day, YYYY-MM-DD (default: today)."),
				"interval", jsobj.New("type", "string", "enum", []any{"day", "week", "month"}, "description", "Default: month for ranges over 120 days, else week over 31 days, else day."),
				"environment", enumOf([]string{"production", "sandbox"}),
				"app", strProp("Only this app (get_config lists app IDs)."),
				"store", enumOf([]string{"app_store", "play_store"}),
				"product", strProp("Only this product (Google base plans as product:base_plan)."),
				"project", strProp("Only this project (get_config lists them). Default: every project."),
			), "chart"),
			annotations: readOnly(),
			permission:  permRead,
			run:         toolGetMetrics,
		},
		{
			name:        "get_experiments",
			title:       "Get price experiments",
			description: "A project's price experiments (each variant shows customers new to the app a different offering as the current one) and, for operators who see every app, each started experiment's results per variant: customers enrolled, trials, trial conversions, paying customers, revenue and revenue per customer (USD, net of refunds), active subscriptions, MRR, churned subscribers, products bought, and versus the control (variant a) the lift and the chance (0 to 1) that the variant's true conversion rate and revenue per customer are higher. enough_data false means it's too early to call. Results are up to 5 minutes old.",
			inputSchema: schema(jsobj.New(
				"project", strProp("Project ID; only needed when you can see several (get_config lists them)."),
				"environment", jsobj.New("type", "string", "enum", []any{"production", "sandbox"}, "description", "Which purchases count (default production)."),
			)),
			annotations: readOnly(),
			permission:  permRead,
			run:         toolGetExperiments,
		},
		{
			name:        "get_config",
			title:       "Get the configuration",
			description: "The SDK URL apps use as Purchases.proxyURL, and the deployment's projects and, for each, its apps (store, bundle ID or package name, SDK keys, products, store notification URL), entitlements (which products unlock each, per app) and offerings. For operators with access to every app, the structured result also has the whole config document and its version_id, for save_config. No secrets.",
			inputSchema: schema(nil),
			annotations: readOnly(),
			permission:  permRead,
			run:         toolGetConfig,
		},
		{
			name:        "save_config",
			title:       "Save the configuration",
			description: `Saves an edited config document (from get_config) as a new version: {"version": 2, "projects": {"<id>": {"name", "apps", "entitlements", "offerings", "webhooks"}}}. Pass the version_id you edited as base_id; if someone saved since, it's refused and you get the config again and redo the edit. Invalid documents are refused with every problem listed. Takes effect in the back office at once and in the SDK within a minute. Change only what the user asked for, and confirm with them first.`,
			inputSchema: schema(jsobj.New(
				"document", jsobj.New("type", "object", "description", "The whole config document, edited."),
				"base_id", jsobj.New("type", "integer", "minimum", 0.0, "description", "version_id from get_config."),
				"note", strProp("What changed, for the history (e.g. Added product pro_annual to rose_ios)."),
			), "document", "base_id"),
			annotations: writeHints(true, false, false),
			permission:  permConfigManage,
			allApps:     true,
			run:         toolSaveConfig,
		},
		{
			name:        "list_webhook_deliveries",
			title:       "List webhook deliveries",
			description: "Recent webhook deliveries to your endpoints: event type and ID, endpoint, status (pending = retrying, delivered, failed), attempts and the last error.",
			inputSchema: schema(jsobj.New(
				"status", enumOf([]string{"pending", "delivered", "failed"}),
				"limit", jsobj.New("type", "integer", "minimum", 1.0, "maximum", 100.0),
			)),
			annotations: readOnly(),
			permission:  permRead,
			run:         toolListDeliveries,
		},
		{
			name:        "replay_webhook",
			title:       "Replay a webhook event",
			description: "Sends a webhook event to its endpoints again, with the same event ID and body (consumers deduplicate on event.id).",
			inputSchema: schema(jsobj.New("event_id", jsobj.New("type", "string")), "event_id"),
			annotations: writeHints(false, true, true),
			permission:  permWebhooksReplay,
			run:         toolReplayWebhook,
		},
		{
			name:  "grant_entitlement",
			title: "Grant an entitlement",
			description: "Gives a customer an entitlement without a purchase, for a duration (" + strings.Join(grantDurations, ", ") +
				") or until a date. The app sees it on its next CustomerInfo fetch, as a promotional entitlement. Audited. Confirm with the user first.",
			inputSchema: schema(jsobj.New(
				"app_user_id", appUserIDProp(),
				"entitlement_id", jsobj.New("type", "string"),
				"duration", enumOf(grantDurations),
				"expires_at", strProp("Instead of duration: when it ends (ISO 8601 date or time)."),
				"note", strProp("Why (shown in the dashboard and audit log)."),
				"project", projectProp(),
			), "app_user_id", "entitlement_id"),
			annotations: writeHints(false, false, false),
			permission:  permGrantsManage,
			allApps:     true,
			run:         toolGrantEntitlement,
		},
		{
			name:        "revoke_grant",
			title:       "Revoke a grant",
			description: "Ends a promotional grant now (lookup_customer or explain_entitlement shows grant IDs). Purchases aren't affected. Audited. Confirm with the user first.",
			inputSchema: schema(jsobj.New("app_user_id", appUserIDProp(), "grant_id", jsobj.New("type", "string"), "project", projectProp()), "app_user_id", "grant_id"),
			annotations: writeHints(true, true, false),
			permission:  permGrantsManage,
			allApps:     true,
			run:         toolRevokeGrant,
		},
		{
			name:        "check_setup",
			title:       "Check the setup",
			description: "Checks this openpurr deployment: database migrations, custom domain, store credentials per app, store notifications received, webhook secrets and failures, the scheduled job, exchange rates and two-step sign-in. Each problem comes with the exact fix.",
			inputSchema: schema(nil),
			annotations: readOnly(),
			permission:  permRead,
			run:         toolCheckSetup,
		},
		{
			name:        "get_audit_log",
			title:       "Read the audit log",
			description: "Recent sign-ins, credential changes and every change made through the dashboard, admin API, CLI or MCP: who, when, what, and through which token.",
			inputSchema: schema(jsobj.New(
				"limit", jsobj.New("type", "integer", "minimum", 1.0, "maximum", 100.0),
				"action", strProp("Only this action, e.g. grant.created or auth.login."),
			)),
			annotations: readOnly(),
			permission:  permAuditRead,
			run:         toolAuditLog,
		},
	}
}

func (t *mcpTool) allowed(p *principal) bool {
	return p.can(t.permission) && (!t.allApps || p.apps == nil)
}

// --- the tools' code -------------------------------------------------------------------------------

func toolLookupCustomer(q *adminReq, args *jsobj.Object) (*toolResult, error) {
	appUserID, _, err := str(args, "app_user_id", true, 256)
	if err != nil {
		return nil, err
	}
	project, err := q.projectArg(args)
	if err != nil {
		return nil, err
	}
	data, err := q.loadVisible(project, appUserID)
	if err != nil {
		return nil, err
	}
	if data == nil {
		return &toolResult{text: `No customer with app user ID "` + appUserID + `". Try search_customers with an email, a transaction ID or the start of the ID.`, isError: true}, nil
	}
	now := q.now
	customer := data.Customer
	attributes, err := ledger.ReadAttributes(q.ctx, q.s.Pool, customer.ID)
	if err != nil {
		return nil, err
	}
	rows, err := q.s.Pool.Query(q.ctx, `SELECT app_user_id FROM customer_alias WHERE customer_id = $1 ORDER BY created_at, app_user_id COLLATE "C"`, customer.ID)
	if err != nil {
		return nil, err
	}
	aliases, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	allApps := q.p.apps == nil
	snap := *data.Loaded
	if !allApps {
		snap.Grants = nil
	}
	snapshot := customerinfo.ComputeSnapshot(appUserID, &snap, project, now)
	ents := snapshotEntitlements(snapshot)
	entList := []any{}
	var entLines []string
	for _, id := range ents.Keys() {
		v, _ := ents.Get(id)
		e := v.(*jsobj.Object)
		active := activeAt(e, now)
		expires, hasExpires := entString(e, "expires_date")
		product, _ := entString(e, "product_identifier")
		var expiresV any
		if hasExpires {
			expiresV = expires
		}
		entList = append(entList, jsobj.New("id", id, "active", active, "expires", expiresV, "product", product))
		var state string
		switch {
		case active && hasExpires:
			state = "active until " + expires[:min(10, len(expires))]
		case active:
			state = "active for life"
		default:
			state = "expired " + expires[:min(10, len(expires))]
		}
		from := product
		if strings.HasPrefix(product, "rc_promo_") {
			from = "a promotional grant"
		}
		entLines = append(entLines, "- "+id+": "+state+" (from "+from+")")
	}
	chains := latestPerChain(data.Transactions)
	var attrParts []string
	for _, k := range attributes.Keys() {
		v, _ := attributes.Get(k)
		val, ok := jsobj.Prop(v, "value")
		attrParts = append(attrParts, k+"="+jsobj.String(val, ok))
	}
	lines := []string{"Customer " + customer.AppUserID + " (first seen " + day(customer.FirstSeen) + ").", "App user IDs: " + strings.Join(aliases, ", ")}
	if len(attrParts) > 0 {
		lines = append(lines, "Attributes: "+strings.Join(attrParts, ", "))
	} else {
		lines = append(lines, "No attributes.")
	}
	lines = append(lines, "")
	if len(entLines) > 0 {
		lines = append(lines, "Entitlements:\n"+strings.Join(entLines, "\n"))
	} else {
		lines = append(lines, "No entitlements.")
	}
	lines = append(lines, "")
	if len(chains) > 0 {
		var cl []string
		for _, c := range chains[:min(25, len(chains))] {
			cl = append(cl, chainLine(c, data.States, now))
		}
		lines = append(lines, "Purchases (latest per subscription or one-time purchase):\n"+strings.Join(cl, "\n"))
	} else {
		lines = append(lines, "No purchases.")
	}
	if len(chains) > 25 {
		lines = append(lines, "("+strconv.Itoa(len(chains)-25)+" more not shown.)")
	} else {
		lines = append(lines, "")
	}
	if allApps && len(data.Grants) > 0 {
		var gl []string
		for i := range data.Grants {
			gl = append(gl, grantLine(&data.Grants[i], now))
		}
		lines = append(lines, "\nPromotional grants:\n"+strings.Join(gl, "\n"))
	} else {
		lines = append(lines, "")
	}
	if data.hidden > 0 {
		lines = append(lines, "\n"+hiddenNote(data.hidden)+" in apps your access doesn't include.")
	} else {
		lines = append(lines, "")
	}
	text := jsobj.Trim(collapseBlankLines(strings.Join(lines, "\n")))

	purchases := []any{}
	for _, c := range chains {
		o := transactionJSON(c.latest)
		o.Set("first_purchased_at", float64(c.first))
		o.Set("purchases_in_chain", float64(c.count))
		purchases = append(purchases, o)
	}
	structured := jsobj.New(
		"customer", jsobj.New("original_app_user_id", customer.AppUserID, "first_seen", float64(customer.FirstSeen), "aliases", stringsToAny(aliases)),
		"attributes", attributes,
		"entitlements", entList,
		"purchases", purchases,
	)
	if allApps {
		grants := []any{}
		for i := range data.Grants {
			grants = append(grants, grantJSON(&data.Grants[i]))
		}
		structured.Set("grants", grants)
	}
	return &toolResult{text: text, structured: structured}, nil
}

// collapseBlankLines is `.replace(/\n{3,}/g, "\n\n")`.
func collapseBlankLines(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); {
		if s[i] != '\n' {
			b.WriteByte(s[i])
			i++
			continue
		}
		j := i
		for j < len(s) && s[j] == '\n' {
			j++
		}
		if j-i >= 3 {
			b.WriteString("\n\n")
		} else {
			b.WriteString(s[i:j])
		}
		i = j
	}
	return b.String()
}

func toolSearchCustomers(q *adminReq, args *jsobj.Object) (*toolResult, error) {
	query, _, err := str(args, "query", false, 256)
	if err != nil {
		return nil, err
	}
	limit, hasLimit, err := num(args, "limit", 1, 50)
	if err != nil {
		return nil, err
	}
	if !hasLimit {
		limit = 20
	}
	purchasesOnly := false
	if v, _ := args.Get("purchases_only"); v == true {
		purchasesOnly = true
	}
	project, err := q.projectArg(args)
	if err != nil {
		return nil, err
	}
	list, err := searchCustomers(q.ctx, q.s.Pool, project.ID, q.p.apps, query, purchasesOnly, &limit, "", q.now)
	if err != nil {
		var bad *badInput
		if errors.As(err, &bad) {
			return nil, &toolError{bad.msg}
		}
		return nil, err
	}
	customersV, _ := list.Get("customers")
	customers, _ := customersV.([]any)
	if len(customers) == 0 {
		text := "No customers yet."
		if query != "" {
			text = `No customers match "` + query + `".`
		}
		return &toolResult{text: text, structured: jsobj.New("customers", []any{})}, nil
	}
	var rows []string
	for _, c := range customers {
		x := c.(*jsobj.Object)
		get := func(k string) any { v, _ := x.Get(k); return v }
		line := "- " + get("app_user_id").(string)
		if e, ok := get("email").(string); ok && e != "" {
			line += " <" + e + ">"
		}
		var firstSeen int64 = int64(get("first_seen").(float64))
		line += ": first seen " + day(firstSeen) + "; "
		n := int(get("purchases").(float64))
		if n > 0 {
			var last *int64
			if f, ok := get("last_purchase_at").(float64); ok {
				l := int64(f)
				last = &l
			}
			active := "nothing active"
			if get("active") == true {
				active = "something active"
			}
			line += strconv.Itoa(n) + plural(n, " purchase", " purchases") + ", latest " + jsobj.String(get("last_product"), true) + " on " + dayOrNever(last) + ", " + active
		} else {
			line += "no purchases"
		}
		rows = append(rows, line)
	}
	return &toolResult{text: strconv.Itoa(len(customers)) + plural(len(customers), " customer", " customers") + ":\n" + strings.Join(rows, "\n"), structured: list}, nil
}

func toolExplainEntitlement(q *adminReq, args *jsobj.Object) (*toolResult, error) {
	appUserID, _, err := str(args, "app_user_id", true, 256)
	if err != nil {
		return nil, err
	}
	entitlementID, _, err := str(args, "entitlement_id", true, 256)
	if err != nil {
		return nil, err
	}
	project, err := q.projectArg(args)
	if err != nil {
		return nil, err
	}
	if findEntitlement(project, entitlementID) == nil {
		var ids []string
		for _, e := range project.Entitlements {
			ids = append(ids, e.ID)
		}
		list := strings.Join(ids, ", ")
		if list == "" {
			list = "none"
		}
		return &toolResult{text: `There's no entitlement "` + entitlementID + `" in project ` + project.ID + `. Entitlements: ` + list + ".", isError: true}, nil
	}
	unlocks := unlockingProducts(project, entitlementID, q.p)
	data, err := q.loadVisible(project, appUserID)
	if err != nil {
		return nil, err
	}
	if data == nil {
		return &toolResult{
			text: `No: there's no customer with app user ID "` + appUserID + `". Products that unlock ` + entitlementID + ": " + unlocks +
				".\nIf they did buy, the purchase may be under another app user ID (an anonymous ID before logIn, or another account): try search_customers with their email or the store transaction ID from their receipt.",
			structured: jsobj.New("has_entitlement", false, "reason", "no_customer"),
		}, nil
	}
	now := q.now
	allApps := q.p.apps == nil
	var grants []ledger.Grant
	if allApps {
		grants = data.Grants
	}
	snap := *data.Loaded
	snap.Grants = grants
	snapshot := customerinfo.ComputeSnapshot(appUserID, &snap, project, now)
	var e *jsobj.Object
	if v, ok := snapshotEntitlements(snapshot).Get(entitlementID); ok {
		e, _ = v.(*jsobj.Object)
	}
	active := e != nil && activeAt(e, now)
	var relevant []ledger.Transaction
	var unmapped []string
	for _, t := range data.Transactions {
		ents := project.EntitlementsFor(t.AppID, t.ProductID, t.BasePlanID)
		if contains(ents, entitlementID) {
			relevant = append(relevant, t)
		}
		if len(ents) == 0 && !contains(unmapped, productLabel(&t)) {
			unmapped = append(unmapped, productLabel(&t))
		}
	}
	chains := latestPerChain(relevant)
	var relevantGrants []*ledger.Grant
	for i := range grants {
		if grants[i].EntitlementID == entitlementID {
			relevantGrants = append(relevantGrants, &grants[i])
		}
	}
	fromGrant := false
	product := ""
	if e != nil {
		product, _ = entString(e, "product_identifier")
		fromGrant = strings.HasPrefix(product, "rc_promo_")
	}
	expires, hasExpires := "", false
	if e != nil {
		expires, hasExpires = entString(e, "expires_date")
	}
	var verdict string
	switch {
	case active:
		until := "for life"
		if hasExpires && expires != "" {
			until = "until " + expires[:min(10, len(expires))]
		}
		from := "a promotional grant"
		if !fromGrant {
			from = "a purchase of " + product
			if plan, ok := entString(e, "product_plan_identifier"); ok && plan != "" {
				from += ":" + plan
			}
		}
		verdict = "Yes: " + data.Customer.AppUserID + " has " + entitlementID + " " + until + ", from " + from + "."
	case e != nil:
		verdict = "No: " + entitlementID + " ended on " + expires[:min(10, len(expires))] + " (the last purchase or grant that gave it is below)."
	case len(relevant) == 0 && len(relevantGrants) == 0:
		verdict = "No: this customer has never bought a product that unlocks " + entitlementID + ", and has no grant for it."
	default:
		verdict = "No: nothing they bought currently gives " + entitlementID + " (see below)."
	}
	if unlocks == "" {
		unlocks = "none in the apps you can see"
	}
	lines := []string{verdict, "", "Products that unlock " + entitlementID + ": " + unlocks + "."}
	if len(chains) > 0 {
		var cl []string
		for _, c := range chains {
			cl = append(cl, chainLine(c, data.States, now))
		}
		lines = append(lines, "", "Their purchases of those products:\n"+strings.Join(cl, "\n"))
	}
	if len(relevantGrants) > 0 {
		var gl []string
		for _, g := range relevantGrants {
			gl = append(gl, grantLine(g, now))
		}
		lines = append(lines, "", "Grants of "+entitlementID+":\n"+strings.Join(gl, "\n"))
	}
	if len(unmapped) > 0 {
		lines = append(lines, "", "They also bought "+strings.Join(unmapped, ", ")+", which no entitlement includes. If one of those should unlock "+entitlementID+
			", add it to the entitlement in the config (the dashboard, or PUT /admin/v1/config).")
	}
	if !active && len(chains) == 0 {
		lines = append(lines, "", "Common causes: the purchase was made under a different app user ID (before logIn, or on another account), or the app hasn't sent it yet (Restore Purchases or syncPurchases sends it). search_customers with their email or the receipt's transaction ID finds where a purchase went.")
	}
	if data.hidden > 0 {
		lines = append(lines, "", hiddenNote(data.hidden)+" in apps your access doesn't include, so this answer may be incomplete.")
	}
	if !allApps {
		lines = append(lines, "Grants aren't shown because your access is limited to some apps.")
	}
	var entV, source any
	if e != nil {
		entV = e
		source = "purchase"
		if fromGrant {
			source = "grant"
		}
	}
	purchases := []any{}
	for _, c := range chains {
		purchases = append(purchases, transactionJSON(c.latest))
	}
	grantsV := []any{}
	for _, g := range relevantGrants {
		grantsV = append(grantsV, grantJSON(g))
	}
	return &toolResult{
		text: strings.Join(lines, "\n"),
		structured: jsobj.New("has_entitlement", active, "entitlement", entV, "source", source, "purchases", purchases, "grants", grantsV,
			"unmapped_products", stringsToAny(nonNil(unmapped))),
	}, nil
}

func nonNil(list []string) []string {
	if list == nil {
		return []string{}
	}
	return list
}

func toolGetMetrics(q *adminReq, args *jsobj.Object) (*toolResult, error) {
	chartID, _, err := str(args, "chart", true, 256)
	if err != nil {
		return nil, err
	}
	chart := metrics.ChartByID(chartID)
	if chart == nil {
		var ids []string
		for _, c := range metrics.Charts {
			ids = append(ids, c.ID)
		}
		return nil, &toolError{"chart must be one of: " + strings.Join(ids, ", ") + "."}
	}
	today := metrics.DayOf(q.now)
	dateErr := &toolError{"from and to must be dates (YYYY-MM-DD), from on or before to."}
	to, hasTo, err := str(args, "to", false, 256)
	if err != nil {
		return nil, err
	}
	if !hasTo {
		to = today
	}
	from, hasFrom, err := str(args, "from", false, 256)
	if err != nil {
		return nil, err
	}
	toMs, toOK := metrics.ParseDate(to)
	if !hasFrom {
		if !toOK {
			// Lite fails here (an invalid date has no day before it).
			return nil, dateErr
		}
		from = metrics.DayOf(toMs - 89*metrics.Day)
	}
	fromMs, fromOK := metrics.ParseDate(from)
	if !chartDate.MatchString(from) || !chartDate.MatchString(to) || !fromOK || !toOK || from > to {
		return nil, dateErr
	}
	days := float64(toMs-fromMs)/float64(metrics.Day) + 1
	if days > maxChartDays {
		return nil, &toolError{"A chart can cover at most 3660 days."}
	}
	interval, hasInterval, err := str(args, "interval", false, 256)
	if err != nil {
		return nil, err
	}
	if !hasInterval {
		switch {
		case days > 120:
			interval = "month"
		case days > 31:
			interval = "week"
		default:
			interval = "day"
		}
	}
	if interval != "day" && interval != "week" && interval != "month" {
		return nil, &toolError{"interval must be day, week or month."}
	}
	environment, hasEnv, err := str(args, "environment", false, 256)
	if err != nil {
		return nil, err
	}
	if !hasEnv {
		environment = "production"
	}
	if environment != "production" && environment != "sandbox" {
		return nil, &toolError{"environment must be production or sandbox."}
	}
	app, _, err := str(args, "app", false, 256)
	if err != nil {
		return nil, err
	}
	if app != "" && (q.cfg.Apps[app] == nil || !q.p.canSeeApp(app)) {
		return nil, &toolError{`No app "` + app + `" you can see.`}
	}
	var chosen *config.Project
	if requested, _, err := str(args, "project", false, 50); err != nil {
		return nil, err
	} else if requested != "" {
		if chosen, err = q.projectArg(args); err != nil {
			return nil, err
		}
	}
	var project *metrics.Project
	if chosen != nil {
		project = &metrics.Project{ID: chosen.ID, Apps: append([]string{}, chosen.AppOrder...)}
	}
	store, _, err := str(args, "store", false, 256)
	if err != nil {
		return nil, err
	}
	if store != "" && store != "app_store" && store != "play_store" {
		return nil, &toolError{"store must be app_store or play_store."}
	}
	product, _, err := str(args, "product", false, 256)
	if err != nil {
		return nil, err
	}
	readTo := to
	if readTo > today {
		readTo = today
	}
	result, err := metrics.ReadChart(q.ctx, q.s.Pool, chartID, metrics.Query{
		From: from, To: readTo, Interval: interval, Environment: environment, Store: store, App: app, Product: product,
		Apps: q.p.apps, Project: project,
	}, q.now)
	if err != nil {
		return nil, err
	}
	structured := result.JSON()
	if result.Categories != nil {
		var cl []string
		for _, c := range result.Categories {
			cl = append(cl, "- "+c.Label+": "+num64(c.Value))
		}
		return &toolResult{text: chart.Label + " (" + chart.Description + "):\n" + strings.Join(cl, "\n"), structured: structured}, nil
	}
	if len(result.Points) > 200 {
		return nil, &toolError{"That's " + strconv.Itoa(len(result.Points)) + " " + interval + "s; use a longer interval or a shorter range (at most 200 points)."}
	}
	var keys []string
	for _, p := range result.Points {
		for _, k := range p.Values.Keys() {
			if !contains(keys, k) {
				keys = append(keys, k)
			}
		}
	}
	table := []string{"| " + interval + " | " + strings.Join(keys, " | ") + " |", "|" + strings.Repeat(" --- |", len(keys)+1)}
	for _, p := range result.Points {
		cells := make([]string, len(keys))
		for i, k := range keys {
			v, ok := p.Values.Get(k)
			if !ok || v == nil {
				cells[i] = "—"
			} else {
				cells[i] = jsobj.String(v, true)
			}
		}
		table = append(table, "| "+p.Date+" | "+strings.Join(cells, " | ")+" |")
	}
	unit := ""
	switch chart.Unit {
	case "usd":
		unit = "Money values are USD."
	case "percent":
		unit = "Rates are percentages."
	}
	filters := environment
	if chosen != nil {
		filters += ", project " + chosen.ID
	}
	if app != "" {
		filters += ", app " + app
	}
	if store != "" {
		filters += ", " + storeName(store)
	}
	if product != "" {
		filters += ", product " + product
	}
	text := chart.Label + ", " + from + " to " + result.To + ", by " + interval + " (" + filters + "). " + chart.Description + " " + unit + "\n\n" + strings.Join(table, "\n")
	if len(result.Notes) > 0 {
		text += "\n\n" + strings.Join(result.Notes, " ")
	}
	if result.UpdatedAt != nil && *result.UpdatedAt != 0 {
		text += "\n\nTotals last updated " + when(*result.UpdatedAt) + " (hourly)."
	}
	return &toolResult{text: text, structured: structured}, nil
}

func pctText(v any) string {
	f, ok := v.(float64)
	if !ok {
		return "—"
	}
	sign := ""
	if f >= 0 {
		sign = "+"
	}
	return sign + jsToFixed(f*100, 1) + "%"
}

func chanceText(v any) string {
	f, ok := v.(float64)
	if !ok {
		return "—"
	}
	return num64(fx.JSRound(f*100)) + "%"
}

func toolGetExperiments(q *adminReq, args *jsobj.Object) (*toolResult, error) {
	project, err := q.projectArg(args)
	if err != nil {
		return nil, err
	}
	env, _, err := str(args, "environment", false, 20)
	if err != nil {
		return nil, err
	}
	environment := "production"
	if env == "sandbox" {
		environment = "sandbox"
	}
	rows, err := q.s.Pool.Query(q.ctx, `SELECT `+experimentColumns+` FROM experiment WHERE project_id = $1 ORDER BY created_at DESC, id COLLATE "C" DESC LIMIT 20`, project.ID)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (*experimentRow, error) {
		var x experimentRow
		return &x, r.Scan(x.targets()...)
	})
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return &toolResult{text: "No price experiments in project " + project.ID + ". Create one on the dashboard's Experiments page.", structured: jsobj.New("experiments", []any{})}, nil
	}
	allApps := q.p.apps == nil
	out := []any{}
	var lines []string
	for _, x := range list {
		exp := publicExperiment(x, project)
		var results any
		if allApps {
			if results, err = experimentResults(q.ctx, q.s.Pool, x, environment, false, q.now); err != nil {
				return nil, err
			}
		}
		withResults := exp.Clone()
		withResults.Set("results", results)
		out = append(out, withResults)
		line := x.Name + " (" + x.ID + "): " + x.Status
		if x.StartedAt != nil && *x.StartedAt != 0 {
			line += ", started " + when(*x.StartedAt)
		}
		if x.StoppedAt != nil && *x.StoppedAt != 0 {
			line += ", stopped " + when(*x.StoppedAt)
		}
		var vs []string
		for _, v := range x.variantsOf() {
			id, _ := v.Get("id")
			offering, _ := v.Get("offering_id")
			weight, hasWeight := v.Get("weight")
			vs = append(vs, jsobj.String(id, true)+" = offering "+jsobj.String(offering, true)+" ("+jsobj.String(weight, hasWeight)+"%)")
		}
		lines = append(lines, line+". Variants: "+strings.Join(vs, ", ")+".")
		variantsV, _ := jsobj.Prop(results, "variants")
		variants, _ := variantsV.([]any)
		for _, vv := range variants {
			g := func(k string) string { v, ok := jsobj.Prop(vv, k); return jsobj.String(v, ok) }
			l := "  " + g("id") + ": " + g("customers") + " customers, " + g("trials") + " trials (" + g("trial_conversions") + " converted), " + g("paying") +
				" paying, revenue $" + g("revenue") + " ($" + g("revenue_per_customer") + " per customer), " + g("active_subscriptions") + " active, MRR $" + g("mrr") + ", " + g("churned") + " churned"
			if vc, _ := jsobj.Prop(vv, "vs_control"); vc != nil && vc != false {
				p := func(k string) any { v, _ := jsobj.Prop(vc, k); return v }
				l += "; vs a: conversion " + pctText(p("conversion_lift")) + " (chance higher " + chanceText(p("conversion_chance")) + "), revenue per customer " +
					pctText(p("revenue_lift")) + " (chance higher " + chanceText(p("revenue_chance")) + ")"
				if enough := p("enough_data"); enough == nil || enough == false {
					l += ", too early to call"
				}
			} else {
				l += " (control)"
			}
			lines = append(lines, l)
		}
	}
	if !allApps {
		lines = append(lines, "Results aren't shown because your access is limited to some apps.")
	}
	return &toolResult{text: "Price experiments in project " + project.ID + " (" + environment + " purchases):\n" + strings.Join(lines, "\n"), structured: jsobj.New("experiments", out)}, nil
}

// notificationURL is where a store's server notifications go.
func notificationURL(store config.Store, origin string) string {
	if store == config.AppStore {
		return origin + "/notifications/apple"
	}
	return origin + "/notifications/google"
}

func describeProject(project *config.Project, p *principal, origin string) (string, *jsobj.Object) {
	apps := []any{}
	var appLines []string
	for _, id := range project.AppOrder {
		if !p.canSeeApp(id) {
			continue
		}
		a := project.Apps[id]
		var bundle, pkg any
		if a.BundleID != "" {
			bundle = a.BundleID
		}
		if a.PackageName != "" {
			pkg = a.PackageName
		}
		products := []any{}
		var productTexts []string
		for _, pid := range a.ProductOrder {
			pr := a.Products[pid]
			o := jsobj.New("id", pr.ID, "type", string(pr.Type))
			t := pr.ID + " [" + string(pr.Type)
			if len(pr.BasePlans) > 0 {
				o.Set("base_plans", stringsToAny(pr.BasePlans))
				t += "; base plans " + strings.Join(pr.BasePlans, ", ")
			}
			products = append(products, o)
			productTexts = append(productTexts, t+"]")
		}
		notify := notificationURL(a.Store, origin)
		apps = append(apps, jsobj.New("id", a.ID, "store", string(a.Store), "bundle_id", bundle, "package_name", pkg, "sdk_keys", stringsToAny(a.SDKKeys),
			"notification_url", notify, "products", products))
		ident := "null"
		if a.BundleID != "" {
			ident = a.BundleID
		} else if a.PackageName != "" {
			ident = a.PackageName
		}
		appLines = append(appLines, "- "+a.ID+" ("+storeName(string(a.Store))+", "+ident+"; SDK key "+strings.Join(a.SDKKeys, ", ")+"; store notifications to "+notify+"): "+strings.Join(productTexts, ", "))
	}
	ents := []any{}
	var entLines []string
	for _, e := range project.Entitlements {
		products := jsobj.New()
		for _, app := range e.ProductApps {
			if !p.canSeeApp(app) {
				continue
			}
			var refs []string
			for _, r := range e.Products[app] {
				refs = append(refs, refLabel(r))
			}
			products.Set(app, stringsToAny(nonNil(refs)))
		}
		ents = append(ents, jsobj.New("id", e.ID, "description", e.Description, "products", products))
		var parts []string
		for _, app := range products.Keys() {
			v, _ := products.Get(app)
			var refs []string
			for _, r := range v.([]any) {
				refs = append(refs, r.(string))
			}
			parts = append(parts, app+": "+strings.Join(refs, ", "))
		}
		line := "- " + e.ID
		if e.Description != "" {
			line += " (" + e.Description + ")"
		}
		entLines = append(entLines, line+": "+strings.Join(parts, "; "))
	}
	offerings := []any{}
	var offeringLines []string
	for _, o := range project.Offerings {
		current := project.CurrentOffering != nil && *project.CurrentOffering == o.ID
		packages := []any{}
		var pkgTexts []string
		for _, pk := range o.Packages {
			products := jsobj.New()
			for _, app := range pk.ProductApps {
				if p.canSeeApp(app) {
					products.Set(app, refLabel(pk.Products[app]))
				}
			}
			packages = append(packages, jsobj.New("id", pk.ID, "products", products))
			var parts []string
			for _, app := range products.Keys() {
				v, _ := products.Get(app)
				parts = append(parts, app+":"+v.(string))
			}
			pkgTexts = append(pkgTexts, pk.ID+" = "+strings.Join(parts, ", "))
		}
		offerings = append(offerings, jsobj.New("id", o.ID, "current", current, "description", o.Description, "packages", packages))
		line := "- " + o.ID
		if current {
			line += " (current)"
		}
		offeringLines = append(offeringLines, line+": "+strings.Join(pkgTexts, "; "))
	}
	text := "Apps:\n" + strings.Join(appLines, "\n") + "\n\nEntitlements:\n" + strings.Join(entLines, "\n") + "\n\nOfferings:\n" + strings.Join(offeringLines, "\n")
	return "Project " + project.ID + " (" + project.Name + ")\n\n" + text,
		jsobj.New("id", project.ID, "name", project.Name, "apps", apps, "entitlements", ents, "offerings", offerings)
}

func toolGetConfig(q *adminReq, _ *jsobj.Object) (*toolResult, error) {
	origin := q.s.requestOrigin(q.r)
	stored, err := q.s.storedSDKURL(q.ctx)
	if err != nil {
		return nil, err
	}
	var sdkLine string
	var sdk *jsobj.Object
	if stored != nil {
		sdkLine = "SDK URL (Purchases.proxyURL): " + *stored
		sdk = jsobj.New("sdk_url", *stored, "sdk_url_source", "setting")
	} else {
		// Standard serves the SDK API itself, so the guess is this server's own address (Lite
		// guesses the SDK Worker's workers.dev address, or has none).
		guess := q.s.sdkURLGuess(q.r)
		sdkLine = "SDK URL (Purchases.proxyURL): not set. It's this server's address, probably " + guess + "; set it on the dashboard's Settings page to be sure."
		sdk = jsobj.New("sdk_url", guess, "sdk_url_source", "guess")
	}
	structured := sdk.Clone()
	var texts []string
	projects := []any{}
	for _, project := range visibleProjects(q.cfg, q.p) {
		t, o := describeProject(project, q.p, origin)
		texts = append(texts, t)
		projects = append(projects, o)
	}
	structured.Set("projects", projects)
	// The whole document spans every app, so only operators who can see every app get it.
	if q.p.apps == nil {
		v, err := config.CurrentVersion(q.ctx, q.s.Pool)
		if err != nil {
			return nil, err
		}
		if v != nil {
			structured.Set("version_id", float64(v.ID))
			structured.Set("document", v.Document)
		} else {
			structured.Set("version_id", 0.0)
			structured.Set("document", q.cfg.Document)
		}
	}
	if len(texts) == 0 {
		return &toolResult{text: sdkLine + "\n\nNo projects yet: the config is empty.", structured: structured}, nil
	}
	return &toolResult{text: strings.Join(append([]string{sdkLine}, texts...), "\n\n"), structured: structured}, nil
}

func toolSaveConfig(q *adminReq, args *jsobj.Object) (*toolResult, error) {
	base, hasBase, err := num(args, "base_id", 0, 9007199254740991)
	if err != nil {
		return nil, err
	}
	if !hasBase {
		return nil, &toolError{"base_id is required: the version_id from get_config."}
	}
	noteStr, hasNote, err := str(args, "note", false, 500)
	if err != nil {
		return nil, err
	}
	var note *string
	if hasNote {
		note = &noteStr
	}
	document, _ := args.Get("document")
	next, err := config.Parse(document)
	if err != nil {
		var ce *config.Error
		if errors.As(err, &ce) {
			return &toolResult{text: "Not saved: the config has problems.\n" + bullets(ce.Problems), isError: true}, nil
		}
		return nil, err
	}
	problems, err := config.ChangeProblems(q.ctx, q.s.Pool, q.cfg, next)
	if err != nil {
		return nil, err
	}
	if len(problems) > 0 {
		return &toolResult{text: "Not saved:\n" + bullets(problems), isError: true}, nil
	}
	by := q.p.op.Email
	id, _, err := config.Save(q.ctx, q.s.Pool, next.Document, int64(base), &by, note, q.now)
	if err != nil {
		var ce *config.Error
		switch {
		case errors.As(err, &ce):
			return &toolResult{text: "Not saved: the config has problems.\n" + bullets(ce.Problems), isError: true}, nil
		case errors.Is(err, config.ErrConflict):
			return &toolResult{text: "Not saved: " + err.Error() + " Call get_config again and redo the change.", isError: true}, nil
		}
		return nil, err
	}
	q.s.Config.Invalidate()
	q.s.Experiments.Forget()
	idStr := strconv.FormatInt(id, 10)
	if err := q.audit(q.s.Pool, "config.saved", &idStr, jsobj.New("base_id", base, "note", strOrNull(note))); err != nil {
		return nil, err
	}
	return &toolResult{text: "Saved as version " + idStr + ". The back office uses it now; the SDK within a minute.", structured: jsobj.New("version_id", float64(id))}, nil
}

func bullets(list []string) string {
	out := make([]string, len(list))
	for i, p := range list {
		out[i] = "- " + p
	}
	return strings.Join(out, "\n")
}

func toolListDeliveries(q *adminReq, args *jsobj.Object) (*toolResult, error) {
	status, _, err := str(args, "status", false, 256)
	if err != nil {
		return nil, err
	}
	if status != "" && !contains(webhooks.DeliveryStatuses, status) {
		return nil, &toolError{"status must be pending, delivered or failed."}
	}
	limit, hasLimit, err := num(args, "limit", 1, 100)
	if err != nil {
		return nil, err
	}
	if !hasLimit {
		limit = 25
	}
	query := `SELECT d.event_id, d.endpoint, d.status, d.attempts, d.last_status, d.last_error, d.created_at, e.type, e.app_id, e.environment
		FROM webhook_delivery d JOIN webhook_event e ON e.id = d.event_id`
	args2 := []any{int64(limit)}
	if status != "" {
		query += " WHERE d.status = $2"
		args2 = append(args2, status)
	}
	rows, err := q.s.Pool.Query(q.ctx, query+" ORDER BY d.created_at DESC, d.event_id, d.endpoint LIMIT $1", args2...)
	if err != nil {
		return nil, err
	}
	type delivery struct {
		eventID, endpoint, status, typ, appID, environment string
		attempts, created                                  int64
		lastStatus                                         *int64
		lastError                                          *string
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (delivery, error) {
		var d delivery
		return d, r.Scan(&d.eventID, &d.endpoint, &d.status, &d.attempts, &d.lastStatus, &d.lastError, &d.created, &d.typ, &d.appID, &d.environment)
	})
	if err != nil {
		return nil, err
	}
	out := []any{}
	var lines []string
	for _, d := range list {
		if !q.p.canSeeApp(d.appID) {
			continue
		}
		out = append(out, jsobj.New("event_id", d.eventID, "endpoint", d.endpoint, "status", d.status, "attempts", float64(d.attempts),
			"last_status", numOrNull(d.lastStatus), "last_error", strOrNull(d.lastError), "created_at", float64(d.created),
			"type", d.typ, "app_id", d.appID, "environment", d.environment))
		line := "- " + when(d.created) + " " + d.typ + " (event " + d.eventID + ") → " + d.endpoint + ": " + d.status + ", " +
			strconv.FormatInt(d.attempts, 10) + plural(int(d.attempts), " attempt", " attempts")
		if d.lastStatus != nil && *d.lastStatus != 0 {
			line += ", last HTTP " + strconv.FormatInt(*d.lastStatus, 10)
		}
		if d.lastError != nil && *d.lastError != "" {
			line += ", " + *d.lastError
		}
		lines = append(lines, line)
	}
	if len(out) == 0 {
		text := "No webhook deliveries yet."
		if status != "" {
			text = "No " + status + " deliveries."
		}
		return &toolResult{text: text, structured: jsobj.New("deliveries", []any{})}, nil
	}
	return &toolResult{text: strings.Join(lines, "\n"), structured: jsobj.New("deliveries", out)}, nil
}

func toolReplayWebhook(q *adminReq, args *jsobj.Object) (*toolResult, error) {
	id, _, err := str(args, "event_id", true, 256)
	if err != nil {
		return nil, err
	}
	appID, eventType, found, err := webhooks.EventApp(q.ctx, q.s.Pool, id)
	if err != nil {
		return nil, err
	}
	if !found || !q.p.canSeeApp(appID) {
		return &toolResult{text: "No webhook event " + id + ".", isError: true}, nil
	}
	err = q.tx(func(tx pgx.Tx) error {
		if err := webhooks.Replay(q.ctx, tx, id, q.now); err != nil {
			return err
		}
		return q.audit(tx, "webhook.replayed", &id, nil)
	})
	if err != nil {
		return nil, err
	}
	q.s.deliverIDsLater(q.cfg, []string{id})
	return &toolResult{text: "Replaying " + eventType + " event " + id + ". It's sent now and retried if an endpoint fails.", structured: jsobj.New("replayed", id)}, nil
}

func toolGrantEntitlement(q *adminReq, args *jsobj.Object) (*toolResult, error) {
	appUserID, _, err := str(args, "app_user_id", true, 256)
	if err != nil {
		return nil, err
	}
	duration, hasDuration, err := str(args, "duration", false, 256)
	if err != nil {
		return nil, err
	}
	expiresRaw, hasExpires, err := str(args, "expires_at", false, 256)
	if err != nil {
		return nil, err
	}
	if !hasDuration && !hasExpires {
		return nil, &toolError{"Give a duration (" + strings.Join(grantDurations, ", ") + ") or expires_at."}
	}
	var expiresAt *float64
	if hasExpires {
		at := jsDateParse(expiresRaw)
		if math.IsNaN(at) {
			return nil, &toolError{"expires_at must be an ISO 8601 date or time."}
		}
		expiresAt = &at
	}
	project, err := q.projectArg(args)
	if err != nil {
		return nil, err
	}
	entitlementID, _, err := str(args, "entitlement_id", true, 256)
	if err != nil {
		return nil, err
	}
	noteStr, hasNote, err := str(args, "note", false, 500)
	if err != nil {
		return nil, err
	}
	var note, durationV any
	if hasNote {
		note = noteStr
	}
	if hasDuration {
		durationV = duration
	}
	grant, customerID, err := grantEntitlement(q.ctx, q.s.Pool, project, appUserID, entitlementID, durationV, expiresAt, note, q.actor(), q.now)
	if err != nil {
		var ge *grantError
		if errors.As(err, &ge) {
			return &toolResult{text: ge.msg, isError: true}, nil
		}
		return nil, err
	}
	q.s.refreshLater(q.cfg, customerID)
	ent, _ := grant.Get("entitlement_id")
	dur, _ := grant.Get("duration")
	gid, _ := grant.Get("id")
	until := "for life"
	if exp, _ := grant.Get("expires_at"); exp != nil {
		until = "until " + when(int64(exp.(float64)))
	}
	return &toolResult{
		text: "Granted " + ent.(string) + " to " + appUserID + " " + until + " (grant " + gid.(string) +
			"). The app sees it the next time it fetches CustomerInfo (on launch, or after a purchase or restore).",
		structured: jsobj.New("grant", grant, "product_identifier", customerinfo.PromotionalProductID(ent.(string), dur.(string))),
	}, nil
}

func toolRevokeGrant(q *adminReq, args *jsobj.Object) (*toolResult, error) {
	appUserID, _, err := str(args, "app_user_id", true, 256)
	if err != nil {
		return nil, err
	}
	grantID, _, err := str(args, "grant_id", true, 256)
	if err != nil {
		return nil, err
	}
	project, err := q.projectArg(args)
	if err != nil {
		return nil, err
	}
	customerID, err := revokeGrant(q.ctx, q.s.Pool, project.ID, appUserID, grantID, q.actor(), q.now)
	if err != nil {
		var ge *grantError
		if errors.As(err, &ge) {
			return &toolResult{text: ge.msg, isError: true}, nil
		}
		return nil, err
	}
	q.s.refreshLater(q.cfg, customerID)
	return &toolResult{text: "Revoked grant " + grantID + " for " + appUserID + ". The app sees the change on its next CustomerInfo fetch.", structured: jsobj.New("revoked", grantID)}, nil
}

var checkMarks = map[string]string{"ok": "✓", "warn": "!", "fail": "✗", "info": "·"}

func toolCheckSetup(q *adminReq, _ *jsobj.Object) (*toolResult, error) {
	checks, err := q.runChecks()
	if err != nil {
		return nil, err
	}
	summary := summarizeChecks(checks)
	var lines []string
	list := []any{}
	for _, c := range checks {
		line := checkMarks[c.status] + " " + c.title + ": " + c.message
		if c.fix != "" && c.status != "ok" {
			line += "\n  Fix: " + c.fix
		}
		lines = append(lines, line)
		list = append(list, c.json())
	}
	return &toolResult{text: summary + "\n\n" + strings.Join(lines, "\n"), structured: jsobj.New("summary", summary, "checks", list)}, nil
}

func toolAuditLog(q *adminReq, args *jsobj.Object) (*toolResult, error) {
	limit, hasLimit, err := num(args, "limit", 1, 100)
	if err != nil {
		return nil, err
	}
	if !hasLimit {
		limit = 30
	}
	action, _, err := str(args, "action", false, 64)
	if err != nil {
		return nil, err
	}
	query := "SELECT at, actor, source, action, target, details FROM audit_log"
	args2 := []any{int64(limit)}
	if action != "" {
		query += " WHERE action = $2"
		args2 = append(args2, action)
	}
	rows, err := q.s.Pool.Query(q.ctx, query+" ORDER BY id DESC LIMIT $1", args2...)
	if err != nil {
		return nil, err
	}
	type entry struct {
		at                     int64
		actor, target, details *string
		source, action         string
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (entry, error) {
		var e entry
		return e, r.Scan(&e.at, &e.actor, &e.source, &e.action, &e.target, &e.details)
	})
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return &toolResult{text: "Nothing logged.", structured: jsobj.New("entries", []any{})}, nil
	}
	var lines []string
	entries := []any{}
	for _, e := range list {
		actor := "?"
		if e.actor != nil {
			actor = *e.actor
		}
		line := "- " + when(e.at) + " " + actor + " (" + e.source + ") " + e.action
		if e.target != nil && *e.target != "" {
			line += " " + *e.target
		}
		var details any
		if e.details != nil && *e.details != "" {
			line += " " + *e.details
			details, _ = jsobj.Parse([]byte(*e.details))
		}
		lines = append(lines, line)
		entries = append(entries, jsobj.New("at", float64(e.at), "actor", strOrNull(e.actor), "source", e.source, "action", e.action, "target", strOrNull(e.target), "details", details))
	}
	return &toolResult{text: strings.Join(lines, "\n"), structured: jsobj.New("entries", entries)}, nil
}

// --- JSON-RPC over Streamable HTTP -----------------------------------------------------------------

func rpcError(id any, code float64, message string) *jsobj.Object {
	return jsobj.New("jsonrpc", "2.0", "id", id, "error", jsobj.New("code", code, "message", message))
}

// mcp serves /mcp.
func (s *server) mcp(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodDelete:
		// No server-initiated stream and no sessions to end: the spec's 405 for both.
		w.Header().Set("Allow", "POST")
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	case http.MethodPost:
	default:
		notFoundJSON(w)
		return
	}
	ctx := r.Context()
	now := s.Clock.Now()
	// DNS-rebinding and cross-site protection: a browser page elsewhere can't drive this endpoint.
	if _, sent := r.Header["Origin"]; sent && r.Header.Get("Origin") != s.requestOrigin(r) {
		writeJSON(w, http.StatusForbidden, rpcError(nil, -32000, "Requests from other sites aren't allowed."))
		return
	}
	if version := r.Header.Get("MCP-Protocol-Version"); version != "" && !contains(MCPProtocolVersions, version) {
		writeJSON(w, http.StatusBadRequest, rpcError(nil, -32000, "Unsupported MCP-Protocol-Version "+version+". Supported: "+strings.Join(MCPProtocolVersions, ", ")+"."))
		return
	}

	header := r.Header.Get("Authorization")
	p, err := s.mcpPrincipal(ctx, r, header, now)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	if p == nil {
		challenge := `Bearer resource_metadata="` + s.resourceMetadataURL(r) + `", scope="read"`
		if strings.HasPrefix(header, "Bearer ") {
			challenge += `, error="invalid_token"`
		}
		w.Header().Set("WWW-Authenticate", challenge)
		writeJSON(w, http.StatusUnauthorized, rpcError(nil, -32001, "Sign in (OAuth), or send a personal access token: Authorization: Bearer pat_… (create one under Access tokens in the openpurr dashboard)."))
		return
	}

	raw, _ := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes+1))
	var message *jsobj.Object
	if len(raw) <= maxBodyBytes {
		if v, err := jsobj.Parse(raw); err == nil {
			message, _ = v.(*jsobj.Object)
		}
	}
	if version, _ := jsobj.Prop(message, "jsonrpc"); message == nil || version != "2.0" {
		writeJSON(w, http.StatusBadRequest, rpcError(nil, -32600, "Send one JSON-RPC 2.0 message per request."))
		return
	}
	// Notifications (no id) and responses (no method) need no answer.
	method, hasMethod := message.Get("method")
	id, hasID := message.Get("id")
	if !hasMethod || !hasID || id == nil {
		w.WriteHeader(http.StatusAccepted)
		return
	}
	params, _ := message.Get("params")
	if params == nil {
		params = jsobj.New()
	}
	param := func(k string) (any, bool) { return jsobj.Prop(params, k) }
	switch method {
	case "initialize":
		requested, _ := param("protocolVersion")
		version := MCPProtocolVersions[0]
		if v, ok := requested.(string); ok && contains(MCPProtocolVersions, v) {
			version = v
		}
		writeJSON(w, http.StatusOK, jsobj.New("jsonrpc", "2.0", "id", id, "result", jsobj.New(
			"protocolVersion", version,
			"capabilities", jsobj.New("tools", jsobj.New("listChanged", false)),
			"serverInfo", jsobj.New("name", "openpurr", "title", "openpurr", "version", "1.0.0"),
			"instructions", mcpInstructions,
		)))
	case "ping":
		writeJSON(w, http.StatusOK, jsobj.New("jsonrpc", "2.0", "id", id, "result", jsobj.New()))
	case "tools/list":
		tools := []any{}
		for _, t := range mcpTools {
			if t.allowed(p) {
				tools = append(tools, jsobj.New("name", t.name, "title", t.title, "description", t.description, "inputSchema", t.inputSchema, "annotations", t.annotations))
			}
		}
		writeJSON(w, http.StatusOK, jsobj.New("jsonrpc", "2.0", "id", id, "result", jsobj.New("tools", tools)))
	case "tools/call":
		name, hasName := param("name")
		var tool *mcpTool
		for _, t := range mcpTools {
			if name == t.name {
				tool = t
			}
		}
		if tool == nil {
			writeJSON(w, http.StatusOK, rpcError(id, -32602, "Unknown tool: "+jsobj.String(name, hasName)))
			return
		}
		args, hasArgs := param("arguments")
		if !hasArgs || args == nil {
			args = jsobj.New()
		}
		cfg, err := s.Config.GetFresh(ctx)
		if err != nil {
			s.internalError(w, r, err)
			return
		}
		q := &adminReq{s: s, w: w, r: r, ctx: ctx, cfg: cfg, now: now, p: p, src: "mcp"}
		writeJSON(w, http.StatusOK, jsobj.New("jsonrpc", "2.0", "id", id, "result", s.callTool(q, tool, args)))
	default:
		writeJSON(w, http.StatusOK, rpcError(id, -32601, "Method not found: "+jsobj.String(method, true)))
	}
}

// mcpPrincipal is the caller: a personal access token, or an OAuth access token issued for this
// endpoint.
func (s *server) mcpPrincipal(ctx context.Context, r *http.Request, header string, now int64) (*principal, error) {
	if !strings.HasPrefix(header, "Bearer ") {
		return nil, nil
	}
	token := jsobj.Trim(header[7:])
	if strings.HasPrefix(token, AccessTokenPrefix) {
		return s.tokenPrincipal(ctx, token, now)
	}
	if !strings.HasPrefix(token, OAuthAccessPrefix) {
		return nil, nil
	}
	return s.oauthTokenOwner(ctx, token, s.mcpResource(r), now)
}

func toolFailure(text string) *jsobj.Object {
	return jsobj.New("content", []any{jsobj.New("type", "text", "text", text)}, "isError", true)
}

func (s *server) callTool(q *adminReq, tool *mcpTool, rawArgs any) *jsobj.Object {
	p := q.p
	if !tool.allowed(p) {
		if tool.allApps && p.apps != nil {
			return toolFailure("This needs access to all apps.")
		}
		hint := ""
		if p.via == "token" {
			hint = " (check the token's scopes, and your role)"
		}
		return toolFailure("This needs the " + tool.permission + " permission" + hint + ".")
	}
	args, ok := rawArgs.(*jsobj.Object)
	if !ok {
		return toolFailure("arguments must be an object.")
	}
	// Per-token limit (the spec asks servers to rate limit tool calls).
	if l := s.Limiters.User; l != nil && p.tokenID != nil && !l.Allow(q.ctx, "mcp:"+*p.tokenID) {
		return toolFailure("Too many calls; wait a minute and try again.")
	}
	result, err := tool.run(q, args)
	if err != nil {
		var te *toolError
		if errors.As(err, &te) {
			return toolFailure(te.msg)
		}
		if !errors.Is(err, context.Canceled) {
			s.Log.Error("MCP tool failed", "tool", tool.name, "error", err.Error())
		}
		return toolFailure("Something went wrong running this tool. It's in the server's logs.")
	}
	out := jsobj.New("content", []any{jsobj.New("type", "text", "text", result.text)})
	if result.structured != nil {
		out.Set("structuredContent", result.structured)
	}
	if result.isError {
		out.Set("isError", true)
	}
	return out
}
