package server

// Importing existing purchases, for moving to openpurr from RevenueCat or another backend. A port
// of lite/src/office/import.ts and its route in admin.ts.
//
// An import row says which app user owns which store purchase: an App Store transaction ID, or a
// Google Play purchase token and product. Nothing about the purchase itself is copied from the
// old backend. openpurr asks the store, exactly as it does when the app posts a receipt, so what's
// recorded is the store's current truth: renewals, refunds and expiry included.
//
// One row per request (the CLI, openpurr import, sends a file's rows one by one). What an import
// does differently from POST /v1/receipts:
//   - It never takes a purchase away from someone. A purchase chain that already has an owner keeps
//     that owner; the row reports it.
//   - It sends no webhooks: the purchases aren't new, and the old backend already reported them.
//   - A new customer's first_seen is backdated to their first purchase (or the row's first_seen),
//     so they don't all show up as new customers on the day of the import.
//   - Attributes never overwrite what the app has set: they're written as if set long ago.
// Lite also stops near a Cloudflare free-plan daily limit; Standard has no such limits.

import (
	"context"
	"errors"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/openpurr/openpurr/standard/internal/apple"
	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/customerinfo"
	"github.com/openpurr/openpurr/standard/internal/google"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
)

const (
	importMaxAliases = 5
	importMaxID      = 256
)

// importError is why a row wasn't imported. The status tells the CLI what to do: 400 and 422 mean
// this row (fix it or skip it, and carry on), 409 a config problem, 503 try again shortly.
type importError struct {
	status int
	code   string
	msg    string
}

func (e *importError) Error() string { return e.msg }

func importErr(status int, code, msg string) *importError {
	return &importError{status: status, code: code, msg: msg}
}

// rowStr is Lite's str(): strings trimmed, numbers as text, anything else "".
func rowStr(v any) string {
	switch x := v.(type) {
	case string:
		return jsobj.Trim(x)
	case float64:
		return jsobj.FormatNumber(x)
	}
	return ""
}

func rowField(row any, k string) any {
	v, _ := jsobj.Prop(row, k)
	return v
}

// parseStore reads "app_store", "APP_STORE", "ios", "google" and the like.
func parseStore(v any) config.Store {
	s := strings.NewReplacer(" ", "_", "\t", "_", "\n", "_", "\r", "_", "\f", "_", "\v", "_", "-", "_").Replace(strings.ToLower(rowStr(v)))
	switch s {
	case "app_store", "appstore", "apple", "ios", "mac_app_store":
		return config.AppStore
	case "play_store", "playstore", "google", "google_play", "android":
		return config.PlayStore
	}
	return ""
}

var digitsOnly = regexp.MustCompile(`^\d+$`)

func parseFirstSeen(v any) (*int64, error) {
	if v == nil || v == "" {
		return nil, nil
	}
	var n float64
	if f, ok := v.(float64); ok {
		n = f
	} else if s := rowStr(v); digitsOnly.MatchString(s) {
		n = jsNumber(s)
	} else {
		n = jsDateParse(s)
	}
	if math.IsNaN(n) || math.IsInf(n, 0) || n <= 0 {
		return nil, importErr(400, "bad_row", `first_seen "`+rowStr(v)+`" isn't a date (ISO 8601) or milliseconds since 1970.`)
	}
	// Seconds, not milliseconds (a 10-digit number).
	if n < 1e11 {
		n *= 1000
	}
	at := int64(n)
	return &at, nil
}

func resolveApp(project *config.Project, row any, store config.Store) (*config.App, error) {
	if wanted := rowStr(rowField(row, "app")); wanted != "" {
		app := project.Apps[wanted]
		if app == nil {
			return nil, importErr(400, "bad_row", "Project "+project.ID+` has no app "`+wanted+`".`)
		}
		if store != "" && app.Store != store {
			return nil, importErr(400, "bad_row", "App "+wanted+" is a "+string(app.Store)+" app, but the row says "+string(store)+".")
		}
		return app, nil
	}
	var candidates []*config.App
	for _, id := range project.AppOrder {
		if a := project.Apps[id]; store == "" || a.Store == store {
			candidates = append(candidates, a)
		}
	}
	if len(candidates) == 1 {
		return candidates[0], nil
	}
	if len(candidates) == 0 {
		return nil, importErr(409, "no_app", strings.Replace("Project "+project.ID+" has no "+string(store)+" app. Add it to the config first.", "  ", " ", 1))
	}
	ids := make([]string, len(candidates))
	for i, a := range candidates {
		ids[i] = a.ID
	}
	return nil, importErr(400, "ambiguous_app", strings.Replace("Project "+project.ID+" has several "+string(store)+" apps ("+strings.Join(ids, ", ")+"). Add an app column, or pass --app.", "  ", " ", 1))
}

// fetched is what the store reported for a row.
type fetched struct {
	transactions []ledger.NewTransaction
	states       []ledger.StateUpdate
	skipped      []string
	replaces     string
	ack          *google.Ack
	client       *google.Client
}

func (s *server) fromAppStore(ctx context.Context, app *config.App, transactionID string) (*fetched, error) {
	clients, err := apple.ClientsFor(app, s.Secret, s.HTTPClient, s.AppleTokens)
	if err != nil {
		var nc *apple.NotConfiguredError
		if errors.As(err, &nc) {
			return nil, importErr(409, "store_not_configured", nc.Msg+" Importing needs App Store Server API access.")
		}
		return nil, err
	}
	sync, err := apple.SyncFromTransactionID(ctx, clients, app, transactionID)
	if err != nil {
		var ae *apple.APIError
		if errors.As(err, &ae) {
			switch {
			case ae.NotFound():
				return nil, importErr(422, "not_found_at_store", "Apple doesn't know transaction "+transactionID+" for "+app.BundleID+".")
			case ae.Retryable():
				return nil, importErr(503, "store_unavailable", "The App Store Server API is rate limiting or unavailable; try again shortly.")
			}
			return nil, importErr(409, "store_error", "App Store Server API error "+strconv.Itoa(ae.Status)+"; check the In-App Purchase key settings.")
		}
		return nil, err
	}
	return &fetched{transactions: sync.Transactions, states: sync.States, skipped: sync.Skipped}, nil
}

func (s *server) fromPlay(ctx context.Context, app *config.App, token, rawProduct string, now int64) (*fetched, error) {
	// RevenueCat writes Play subscriptions as "product:base_plan".
	productID := strings.Split(rawProduct, ":")[0]
	if productID == "" {
		return nil, importErr(400, "bad_row", "Google Play rows need a product_id.")
	}
	if app.Products[productID] == nil {
		return &fetched{skipped: []string{productID}}, nil
	}
	client, err := google.ClientFor(app, s.googleEnv())
	if err != nil {
		var nc *google.NotConfiguredError
		if errors.As(err, &nc) {
			return nil, importErr(409, "store_not_configured", nc.Msg+" Importing needs Play Developer API access.")
		}
		return nil, err
	}
	p, err := google.VerifyPurchase(ctx, client, app, token, productID, now, s.Log)
	if err != nil {
		var ae *google.APIError
		var pending *google.PendingError
		var mapping *google.MappingError
		switch {
		case errors.As(err, &ae) && ae.NotFound():
			return nil, importErr(422, "not_found_at_store", "Google Play doesn't know this purchase token for "+app.PackageName+".")
		case errors.As(err, &ae) && ae.Retryable():
			return nil, importErr(503, "store_unavailable", "The Play Developer API is rate limiting or unavailable; try again shortly.")
		case errors.As(err, &ae):
			return nil, importErr(409, "store_error", "Play Developer API error "+strconv.Itoa(ae.Status)+"; check the service account's access.")
		case errors.As(err, &pending):
			return nil, importErr(422, "pending", pending.Msg)
		case errors.As(err, &mapping):
			return nil, importErr(409, "config_mismatch", mapping.Msg)
		}
		return nil, err
	}
	return &fetched{transactions: p.Transactions, states: p.States, replaces: p.Replaces, ack: p.Ack, client: client}, nil
}

func parseAliases(v any, appUserID string) ([]string, error) {
	var list []string
	if arr, ok := v.([]any); ok {
		for _, e := range arr {
			list = append(list, rowStr(e))
		}
	} else {
		for _, part := range strings.FieldsFunc(rowStr(v), func(r rune) bool { return r == '|' || r == ';' || r == ',' }) {
			list = append(list, jsobj.Trim(part))
		}
	}
	var aliases []string
	seen := map[string]bool{}
	for _, a := range list {
		if a != "" && a != appUserID && !seen[a] {
			seen[a] = true
			aliases = append(aliases, a)
		}
	}
	for _, a := range aliases {
		if jsobj.UTF16Len(a) > importMaxID {
			return nil, importErr(400, "bad_row", "An alias is too long.")
		}
	}
	if len(aliases) > importMaxAliases {
		return nil, importErr(400, "bad_row", "At most "+strconv.Itoa(importMaxAliases)+" aliases per row.")
	}
	return aliases, nil
}

func parseRowAttributes(v any) (*ledger.Updates, error) {
	if v == nil || v == "" {
		return &ledger.Updates{}, nil
	}
	obj, ok := v.(*jsobj.Object)
	if !ok {
		return nil, importErr(400, "bad_row", "attributes must be an object of strings.")
	}
	// Written as if set at the start of time: anything the app has set, or sets later, wins.
	raw := jsobj.New()
	for _, k := range obj.Keys() {
		val, _ := obj.Get(k)
		if s := rowStr(val); s != "" {
			raw.Set(k, jsobj.New("value", s, "updated_at_ms", 1.0))
		}
	}
	updates, errs := ledger.ParseAttributes(raw, true, 1)
	if len(errs) > 0 {
		return nil, importErr(400, "bad_row", strings.TrimSpace("Invalid attribute "+errs[0].KeyName+": "+errs[0].Message))
	}
	return updates, nil
}

// importResult is what a row did (or would do, on a dry run).
type importResult struct {
	appUserID      string
	appID          *string
	dryRun         bool
	created        bool
	transactions   int
	transactionIDs []string
	keptOwner      []*jsobj.Object
	skipped        []string
	aliasesAdded   []string
	aliasesSkipped []string
	attributes     int
}

func (r *importResult) json() *jsobj.Object {
	kept := []any{}
	for _, k := range r.keptOwner {
		kept = append(kept, k)
	}
	list := func(s []string) []any {
		if s == nil {
			return []any{}
		}
		return stringsToAny(s)
	}
	return jsobj.New("app_user_id", r.appUserID, "app_id", strOrNull(r.appID), "dry_run", r.dryRun, "created", r.created,
		"transactions", float64(r.transactions), "transaction_ids", list(r.transactionIDs), "kept_owner", kept,
		"skipped_products", list(r.skipped), "aliases_added", list(r.aliasesAdded), "aliases_skipped", list(r.aliasesSkipped),
		"attributes", float64(r.attributes))
}

// importRow imports one row: asks the store, then records the purchases for the row's app user.
// With dryRun, asks the store and reports what would happen, writing nothing. audit (nil on a dry
// run) is written in the same transaction.
func (s *server) importRow(ctx context.Context, project *config.Project, row any, dryRun bool, now int64, audit func(tx pgx.Tx) error) (*importResult, error) {
	appUserID := rowStr(rowField(row, "app_user_id"))
	if appUserID == "" {
		return nil, importErr(400, "bad_row", "app_user_id is required.")
	}
	if jsobj.UTF16Len(appUserID) > importMaxID {
		return nil, importErr(400, "bad_row", "app_user_id is too long.")
	}
	transactionID := rowStr(rowField(row, "transaction_id"))
	token := rowStr(rowField(row, "purchase_token"))
	if transactionID != "" && token != "" {
		return nil, importErr(400, "bad_row", "Give a transaction_id (App Store) or a purchase_token (Google Play), not both.")
	}
	rawStore := rowStr(rowField(row, "store"))
	var store config.Store
	switch {
	case rawStore != "":
		store = parseStore(rawStore)
		if store == "" {
			return nil, importErr(400, "bad_row", `Unknown store "`+rawStore+`". Use app_store or play_store.`)
		}
	case token != "":
		store = config.PlayStore
	case transactionID != "":
		store = config.AppStore
	}
	if store == config.AppStore && token != "" {
		return nil, importErr(400, "bad_row", "App Store rows take a transaction_id, not a purchase_token.")
	}
	if store == config.PlayStore && transactionID != "" {
		return nil, importErr(400, "bad_row", "Google Play rows need the purchase_token. An order ID (GPA.…) can't be looked up; RevenueCat Support's migration export has the tokens.")
	}
	aliases, err := parseAliases(rowField(row, "aliases"), appUserID)
	if err != nil {
		return nil, err
	}
	attributes, err := parseRowAttributes(rowField(row, "attributes"))
	if err != nil {
		return nil, err
	}
	firstSeenGiven, err := parseFirstSeen(rowField(row, "first_seen"))
	if err != nil {
		return nil, err
	}
	result := &importResult{appUserID: appUserID, dryRun: dryRun}

	// No purchase: only aliases and attributes, for a customer openpurr already has (import the
	// purchases first). Creating customers who never bought would only add rows to clean up later.
	existing, err := ledger.FindCustomer(ctx, s.Pool, project.ID, appUserID)
	if err != nil {
		return nil, err
	}
	if transactionID == "" && token == "" {
		if len(aliases) == 0 && attributes.Len() == 0 {
			return nil, importErr(400, "bad_row", "The row has no transaction_id, purchase_token, aliases or attributes: nothing to import.")
		}
		if existing == nil {
			return nil, importErr(422, "no_customer", `No customer "`+appUserID+`" yet. Rows without a purchase only add aliases and attributes to customers openpurr already has.`)
		}
		if dryRun {
			result.attributes = attributes.Len()
			return result, nil
		}
		return result, s.writeImport(ctx, project, existing.ID, result, &fetched{}, nil, aliases, attributes, now, audit, nil)
	}

	app, err := resolveApp(project, row, store)
	if err != nil {
		return nil, err
	}
	result.appID = &app.ID
	var f *fetched
	if app.Store == config.AppStore {
		f, err = s.fromAppStore(ctx, app, transactionID)
	} else {
		f, err = s.fromPlay(ctx, app, token, rowStr(rowField(row, "product_id")), now)
	}
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	for _, p := range f.skipped {
		if !seen[p] {
			seen[p] = true
			result.skipped = append(result.skipped, p)
		}
	}
	if len(f.transactions) == 0 {
		if len(result.skipped) > 0 {
			return nil, importErr(422, "unknown_products", "The store reported only products the config doesn't list: "+strings.Join(result.skipped, ", ")+". Add them to app "+app.ID+" and import this row again.")
		}
		return nil, importErr(422, "nothing_to_import", "The store reported no purchases for this row.")
	}

	var chains []string
	chainSeen := map[string]bool{}
	for _, t := range f.transactions {
		if !chainSeen[t.OriginalTransactionID] {
			chainSeen[t.OriginalTransactionID] = true
			chains = append(chains, t.OriginalTransactionID)
		}
	}
	owners, err := ledger.PurchaseOwners(ctx, s.Pool, string(app.Store), chains)
	if err != nil {
		return nil, err
	}
	var customerID string
	if existing != nil {
		customerID = existing.ID
	}
	ownerOf := map[string]string{}
	for _, o := range owners {
		ownerOf[o.OriginalTransactionID] = o.Owner.ID
		if o.Owner.ID != customerID {
			result.keptOwner = append(result.keptOwner, jsobj.New("original_transaction_id", o.OriginalTransactionID, "app_user_id", o.Owner.AppUserID))
		}
	}
	result.transactions = len(f.transactions)
	idSeen := map[string]bool{}
	for _, t := range f.transactions {
		for _, id := range []string{t.TransactionID, t.OriginalTransactionID} {
			if !idSeen[id] {
				idSeen[id] = true
				result.transactionIDs = append(result.transactionIDs, id)
			}
		}
	}

	if dryRun {
		// Aliases and attributes would apply to the customer, new or not.
		result.created = existing == nil
		result.attributes = attributes.Len()
		result.aliasesAdded = aliases
		return result, nil
	}

	var countNew *int64
	if customerID == "" {
		firstPurchase := int64(math.MaxInt64)
		for _, t := range f.transactions {
			firstPurchase = min(firstPurchase, t.OriginalPurchasedAt)
		}
		firstSeen := min(firstPurchase, now)
		if firstSeenGiven != nil {
			firstSeen = min(firstSeen, *firstSeenGiven)
		}
		c, err := ledger.EnsureCustomer(ctx, s.Pool, project.ID, appUserID, firstSeen)
		if err != nil {
			return nil, err
		}
		customerID = c.ID
		result.created = true
		// The charts count each day's new customers once, at the hourly rollup, and never again.
		// Someone backdated to before the last rollup's day would never be counted, so count them now.
		rolledUpAt, err := s.lastRollupAt(ctx)
		if err != nil {
			return nil, err
		}
		if rolledUpAt != nil && firstSeen < (*rolledUpAt/dayMs)*dayMs {
			countNew = &firstSeen
		}
	}
	if f.ack != nil {
		if _, err := google.Acknowledge(ctx, s.Pool, f.client, app.ID, *f.ack, now); err != nil {
			return nil, err
		}
	}
	var assign []string
	for _, c := range chains {
		if owner, owned := ownerOf[c]; !owned || owner == customerID {
			assign = append(assign, c)
		}
	}
	var extra func(tx pgx.Tx) error
	if countNew != nil {
		at := *countNew
		extra = func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx,
				`INSERT INTO metric_daily (metric, environment, project_id, app_id, store, product_id, date, value)
				 VALUES ('new_customers', '', $1, '', '', '', to_char(to_timestamp($2 / 1000.0) AT TIME ZONE 'UTC', 'YYYY-MM-DD'), 1)
				 ON CONFLICT (metric, environment, project_id, app_id, store, product_id, date) DO UPDATE SET value = metric_daily.value + 1`,
				project.ID, at)
			return err
		}
	}
	return result, s.writeImport(ctx, project, customerID, result, f, assign, aliases, attributes, now, audit, extra)
}

// lastRollupAt is when the chart totals were last updated (the S6 rollup), or nil.
func (s *server) lastRollupAt(ctx context.Context) (*int64, error) {
	var value string
	err := s.Pool.QueryRow(ctx, "SELECT value FROM job_state WHERE key = 'metrics_rollup'").Scan(&value)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	v, _ := jsobj.Parse([]byte(value))
	at, ok := jsobj.Prop(v, "at")
	if f, isNum := at.(float64); ok && isNum {
		n := int64(f)
		return &n, nil
	}
	return nil, nil
}

func (s *server) writeImport(ctx context.Context, project *config.Project, customerID string, result *importResult, f *fetched, assign, aliases []string,
	attributes *ledger.Updates, now int64, audit, extra func(tx pgx.Tx) error) error {
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		for _, t := range f.transactions {
			if err := ledger.UpsertTransaction(ctx, tx, t, now); err != nil {
				return err
			}
		}
		lastOfChain := map[string]ledger.NewTransaction{}
		for _, t := range f.transactions {
			lastOfChain[t.OriginalTransactionID] = t
		}
		for _, chain := range assign {
			t := lastOfChain[chain]
			if err := ledger.AssignOwner(ctx, tx, t.Store, t.OriginalTransactionID, t.AppID, customerID, now); err != nil {
				return err
			}
		}
		for _, st := range f.states {
			if err := ledger.UpsertSubscriptionState(ctx, tx, st, now); err != nil {
				return err
			}
		}
		if f.replaces != "" {
			if err := google.MarkReplaced(ctx, tx, f.replaces); err != nil {
				return err
			}
		}
		result.aliasesAdded, result.aliasesSkipped = nil, nil
		for _, alias := range aliases {
			holder, err := ledger.FindCustomer(ctx, tx, project.ID, alias)
			if err != nil {
				return err
			}
			switch {
			case holder == nil:
				if err := ledger.AddAlias(ctx, tx, project.ID, alias, customerID, now); err != nil {
					return err
				}
				result.aliasesAdded = append(result.aliasesAdded, alias)
			case holder.ID != customerID:
				result.aliasesSkipped = append(result.aliasesSkipped, alias)
			}
		}
		if attributes.Len() > 0 {
			if _, err := ledger.EnforceCustomLimit(ctx, tx, customerID, attributes); err != nil {
				return err
			}
			if err := ledger.WriteAttributes(ctx, tx, customerID, attributes, now); err != nil {
				return err
			}
			result.attributes = attributes.Len()
		}
		if err := customerinfo.Invalidate(ctx, tx, customerID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO job_state (key, value, updated_at) VALUES ('import_active', $1, $2)
			 ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
			jsobj.Stringify(jsobj.New("at", float64(now))), now); err != nil {
			return err
		}
		if extra != nil {
			if err := extra(tx); err != nil {
				return err
			}
		}
		if audit != nil {
			return audit(tx)
		}
		return nil
	})
}

// adminImport imports one row per request. Importing writes every app's purchases, so it needs
// access to all apps.
func adminImport(q *adminReq) {
	if q.p.apps != nil {
		q.forbidden("Importing needs access to all apps.")
		return
	}
	row, _ := q.prop("row")
	if _, isObj := row.(*jsobj.Object); !isObj {
		if _, isArr := row.([]any); !isArr {
			q.bad(`Expected {"row": {...}}.`)
			return
		}
	}
	requested, _ := q.propString("project")
	project := q.project(requested)
	if project == nil {
		return
	}
	dryRun := false
	if v, _ := q.prop("dry_run"); v == true {
		dryRun = true
	}
	var target *string
	if s, ok := rowField(row, "app_user_id").(string); ok {
		target = &s
	}
	var audit func(tx pgx.Tx) error
	if !dryRun {
		store, hasStore := jsobj.Prop(row, "store")
		app, hasApp := jsobj.Prop(row, "app")
		if !hasStore {
			store = nil
		}
		if !hasApp {
			app = nil
		}
		audit = func(tx pgx.Tx) error {
			return q.audit(tx, "customers.import", target, jsobj.New("project", project.ID, "store", store, "app", app))
		}
	}
	result, err := q.s.importRow(q.ctx, project, row, dryRun, q.now, audit)
	if err != nil {
		var ie *importError
		if errors.As(err, &ie) {
			if ie.status == http.StatusTooManyRequests {
				q.w.Header().Set("Retry-After", "3600")
			} else if ie.status == http.StatusServiceUnavailable {
				q.w.Header().Set("Retry-After", "30")
			}
			q.fail(ie.status, ie.code, ie.msg)
			return
		}
		q.internal(err)
		return
	}
	q.json(http.StatusOK, result.json())
}
