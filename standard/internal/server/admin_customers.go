package server

// Customers and promotional grants in the admin API: the customer list and search (a port of
// lite/src/office/customers.ts), one customer's details, and granting or revoking an entitlement
// without a purchase (lite/src/office/grants.ts).

import (
	"context"
	"errors"
	"math"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/customerinfo"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
)

// customerPageMax is the customer list's page size (Lite's, which D1's bound-parameter limit set).
const customerPageMax = 50

type badInput struct{ msg string }

func (e *badInput) Error() string { return e.msg }

type customerRow struct {
	id        string
	appUserID string
	firstSeen int64
}

// searchCustomers lists a project's customers: the newest first, or a search by app user ID
// prefix (any alias), exact email or store transaction ID. apps limits it to customers with
// purchases in those apps (nil: everyone).
func searchCustomers(ctx context.Context, db ledger.DB, projectID string, apps []string, q string, purchasesOnly bool, limitRaw *float64, before string, now int64) (*jsobj.Object, error) {
	q = jsobj.Trim(q)
	if jsobj.UTF16Len(q) > 256 {
		return nil, &badInput{"q is too long."}
	}
	limit := customerPageMax
	if limitRaw != nil {
		n := math.Floor(*limitRaw)
		if math.IsNaN(n) || n == 0 {
			n = customerPageMax
		}
		limit = int(math.Min(math.Max(n, 1), customerPageMax))
	}
	empty := jsobj.New("customers", []any{}, "next_before", nil)
	if apps != nil && len(apps) == 0 {
		return empty, nil
	}

	// Operators limited to some apps see only customers with purchases in those apps. Customers
	// without purchases aren't tied to an app, so only all-apps operators see them.
	owned := "true"
	if apps != nil {
		owned = "EXISTS (SELECT 1 FROM purchase_owner o WHERE o.customer_id = c.id AND o.app_id = ANY($APPS::text[]))"
	} else if purchasesOnly {
		owned = "EXISTS (SELECT 1 FROM purchase_owner o WHERE o.customer_id = c.id)"
	}

	var rows []customerRow
	var nextBefore any
	collect := func(r pgx.Rows, err error) error {
		if err != nil {
			return err
		}
		list, err := pgx.CollectRows(r, func(row pgx.CollectableRow) (customerRow, error) {
			var c customerRow
			return c, row.Scan(&c.id, &c.appUserID, &c.firstSeen)
		})
		rows = list
		return err
	}
	if q != "" {
		// An app user ID prefix (any alias), an exact email, or an exact store transaction ID.
		var ids []string
		seen := map[string]bool{}
		add := func(r pgx.Rows, err error) error {
			if err != nil {
				return err
			}
			list, err := pgx.CollectRows(r, pgx.RowTo[string])
			if err != nil {
				return err
			}
			for _, id := range list {
				if !seen[id] {
					seen[id] = true
					ids = append(ids, id)
				}
			}
			return nil
		}
		if err := add(db.Query(ctx,
			`SELECT customer_id FROM customer_alias WHERE project_id = $1 AND starts_with(app_user_id, $2)
			 ORDER BY app_user_id COLLATE "C" LIMIT $3`, projectID, q, limit)); err != nil {
			return nil, err
		}
		if err := add(db.Query(ctx,
			`SELECT o.customer_id FROM store_transaction t JOIN purchase_owner o ON o.store = t.store AND o.original_transaction_id = t.original_transaction_id
			 WHERE t.store IN ('app_store', 'play_store') AND t.transaction_id = $1 LIMIT 1`, q)); err != nil {
			return nil, err
		}
		if err := add(db.Query(ctx,
			"SELECT customer_id FROM purchase_owner WHERE store IN ('app_store', 'play_store') AND original_transaction_id = $1 LIMIT 1", q)); err != nil {
			return nil, err
		}
		if strings.Contains(q, "@") {
			if err := add(db.Query(ctx,
				"SELECT customer_id FROM subscriber_attribute WHERE key = '$email' AND lower(value) = lower($1) LIMIT $2", q, limit)); err != nil {
				return nil, err
			}
		}
		if len(ids) > limit {
			ids = ids[:limit]
		}
		if len(ids) == 0 {
			return empty, nil
		}
		query := `SELECT c.id, c.app_user_id, c.first_seen FROM customer c
		 WHERE c.id = ANY($1::text[]) AND c.project_id = $2 AND ` + strings.ReplaceAll(owned, "$APPS", "$3") + `
		 ORDER BY c.first_seen DESC, c.id COLLATE "C" DESC`
		args := []any{ids, projectID}
		if apps != nil {
			args = append(args, apps)
		}
		if err := collect(db.Query(ctx, query, args...)); err != nil {
			return nil, err
		}
	} else {
		// Newest first. The cursor is "first_seen:id" of the last row on the previous page.
		args := []any{projectID, limit}
		cursor := "true"
		if before != "" {
			i := strings.IndexByte(before, ':')
			at := math.NaN()
			if i >= 1 {
				at = jsNumber(before[:i])
			}
			if i < 1 || math.IsNaN(at) || math.IsInf(at, 0) {
				return nil, &badInput{"before must be the next_before value from the previous page."}
			}
			cursor = `(c.first_seen < $3 OR (c.first_seen = $3 AND c.id COLLATE "C" < $4))`
			args = append(args, at, before[i+1:])
		}
		appsParam := "$" + strconv.Itoa(len(args)+1)
		if apps != nil {
			args = append(args, apps)
		}
		query := `SELECT c.id, c.app_user_id, c.first_seen FROM customer c
		 WHERE c.project_id = $1 AND ` + cursor + ` AND ` + strings.ReplaceAll(owned, "$APPS", appsParam) + `
		 ORDER BY c.first_seen DESC, c.id COLLATE "C" DESC LIMIT $2`
		if err := collect(db.Query(ctx, query, args...)); err != nil {
			return nil, err
		}
		if len(rows) == limit {
			last := rows[len(rows)-1]
			nextBefore = strconv.FormatInt(last.firstSeen, 10) + ":" + last.id
		}
	}
	if len(rows) == 0 {
		return empty, nil
	}

	// One summary per customer: purchases (in the operator's apps), the latest one, and whether
	// anything is still active (an unexpired, unrefunded subscription or a non-consumable).
	ids := make([]string, len(rows))
	for i, r := range rows {
		ids[i] = r.id
	}
	appFilter, appFilter2 := "", ""
	args := []any{now, ids}
	if apps != nil {
		args = append(args, apps)
		appFilter = " AND o.app_id = ANY($3::text[])"
		appFilter2 = " AND o2.app_id = ANY($3::text[])"
	}
	type summary struct {
		purchases   int64
		last        *int64
		active      bool
		stores      string
		lastProduct *string
	}
	byID := map[string]summary{}
	sumRows, err := db.Query(ctx,
		`SELECT o.customer_id, count(*), max(t.purchased_at),
		   bool_or(t.revoked_at IS NULL AND t.product_type <> 'consumable' AND (t.expires_at IS NULL OR t.expires_at > $1)),
		   string_agg(DISTINCT t.store, ',' ORDER BY t.store),
		   (SELECT t2.product_id FROM purchase_owner o2 JOIN store_transaction t2 ON t2.store = o2.store AND t2.original_transaction_id = o2.original_transaction_id
		    WHERE o2.customer_id = o.customer_id`+appFilter2+` ORDER BY t2.purchased_at DESC LIMIT 1)
		 FROM purchase_owner o JOIN store_transaction t ON t.store = o.store AND t.original_transaction_id = o.original_transaction_id
		 WHERE o.customer_id = ANY($2::text[])`+appFilter+`
		 GROUP BY o.customer_id`, args...)
	if err != nil {
		return nil, err
	}
	for sumRows.Next() {
		var id string
		var s summary
		if err := sumRows.Scan(&id, &s.purchases, &s.last, &s.active, &s.stores, &s.lastProduct); err != nil {
			sumRows.Close()
			return nil, err
		}
		byID[id] = s
	}
	sumRows.Close()
	if err := sumRows.Err(); err != nil {
		return nil, err
	}
	emails := map[string]string{}
	emailRows, err := db.Query(ctx, "SELECT customer_id, value FROM subscriber_attribute WHERE key = '$email' AND value IS NOT NULL AND customer_id = ANY($1::text[])", ids)
	if err != nil {
		return nil, err
	}
	for emailRows.Next() {
		var id, v string
		if err := emailRows.Scan(&id, &v); err != nil {
			emailRows.Close()
			return nil, err
		}
		emails[id] = v
	}
	emailRows.Close()
	if err := emailRows.Err(); err != nil {
		return nil, err
	}

	list := make([]any, 0, len(rows))
	for _, r := range rows {
		s, has := byID[r.id]
		var email any
		if e, ok := emails[r.id]; ok {
			email = e
		}
		stores := []any{}
		if has && s.stores != "" {
			stores = stringsToAny(strings.Split(s.stores, ","))
		}
		list = append(list, jsobj.New(
			"id", r.id,
			"app_user_id", r.appUserID,
			"email", email,
			"first_seen", float64(r.firstSeen),
			"purchases", float64(s.purchases),
			"last_purchase_at", numOrNull(s.last),
			"last_product", strOrNull(s.lastProduct),
			"active", has && s.active,
			"stores", stores,
		))
	}
	return jsobj.New("customers", list, "next_before", nextBefore), nil
}

func adminCustomers(q *adminReq) {
	project := q.project("")
	if project == nil {
		return
	}
	var limit *float64
	if q.query("limit") != "" {
		n := jsNumber(q.query("limit"))
		limit = &n
	}
	res, err := searchCustomers(q.ctx, q.s.Pool, project.ID, q.p.apps, q.query("q"), q.query("purchases") == "1", limit, q.query("before"), q.now)
	if err != nil {
		var bad *badInput
		if errors.As(err, &bad) {
			q.bad(bad.msg)
			return
		}
		q.internal(err)
		return
	}
	q.json(http.StatusOK, res)
}

// --- one customer ----------------------------------------------------------------------------------

func transactionJSON(t *ledger.Transaction) *jsobj.Object {
	return jsobj.New(
		"app_id", t.AppID, "store", t.Store, "environment", t.Environment, "transaction_id", t.TransactionID,
		"original_transaction_id", t.OriginalTransactionID, "product_id", t.ProductID, "base_plan_id", strOrNull(t.BasePlanID),
		"product_type", t.ProductType, "purchased_at", float64(t.PurchasedAt), "original_purchased_at", float64(t.OriginalPurchasedAt),
		"expires_at", numOrNull(t.ExpiresAt), "period_type", t.PeriodType, "ownership_type", t.OwnershipType,
		"price_micros", numOrNull(t.PriceMicros), "currency", strOrNull(t.Currency), "storefront", strOrNull(t.Storefront),
		"revoked_at", numOrNull(t.RevokedAt), "revocation_reason", strOrNull(t.RevocationReason), "is_upgraded", float64(t.IsUpgraded),
		"verified", float64(t.Verified), "subscription_group", strOrNull(t.SubscriptionGroup),
	)
}

func intOrNull(p *int) any {
	if p == nil {
		return nil
	}
	return float64(*p)
}

func stateJSON(s *ledger.SubscriptionState) *jsobj.Object {
	return jsobj.New(
		"store", s.Store, "original_transaction_id", s.OriginalTransactionID, "status", intOrNull(s.Status),
		"auto_renew", intOrNull(s.AutoRenew), "auto_renew_product_id", strOrNull(s.AutoRenewProductID),
		"unsubscribe_detected_at", numOrNull(s.UnsubscribeDetectedAt), "billing_issue_detected_at", numOrNull(s.BillingIssueDetectedAt),
		"grace_period_expires_at", numOrNull(s.GracePeriodExpiresAt), "auto_resume_at", numOrNull(s.AutoResumeAt),
	)
}

func grantJSON(g *ledger.Grant) *jsobj.Object {
	return jsobj.New(
		"id", g.ID, "entitlement_id", g.EntitlementID, "duration", g.Duration, "starts_at", float64(g.StartsAt),
		"expires_at", numOrNull(g.ExpiresAt), "note", strOrNull(g.Note), "granted_by", strOrNull(g.GrantedBy), "source", g.Source,
		"created_at", float64(g.CreatedAt), "revoked_at", numOrNull(g.RevokedAt), "revoked_by", strOrNull(g.RevokedBy),
	)
}

func adminCustomer(q *adminReq) {
	p := q.p
	project := q.project("")
	if project == nil {
		return
	}
	ctx, db := q.ctx, q.s.Pool
	appUserID := q.params["app_user_id"]
	customer, err := ledger.FindCustomer(ctx, db, project.ID, appUserID)
	if err != nil {
		q.internal(err)
		return
	}
	if customer == nil {
		q.notFound("Customer")
		return
	}
	info, err := customerinfo.ReadCustomerInfo(ctx, db, project, appUserID, customerinfo.RenderOptions{Now: q.now})
	if err != nil {
		q.internal(err)
		return
	}
	loaded, err := ledger.LoadCustomer(ctx, db, project.ID, appUserID)
	if err != nil {
		q.internal(err)
		return
	}
	attributes, err := ledger.ReadAttributes(ctx, db, customer.ID)
	if err != nil {
		q.internal(err)
		return
	}
	aliases, err := queryObjects(ctx, db, `SELECT app_user_id, created_at FROM customer_alias WHERE customer_id = $1 ORDER BY created_at, app_user_id COLLATE "C"`,
		[]any{customer.ID}, func(r pgx.CollectableRow) (*jsobj.Object, error) {
			var id string
			var at int64
			err := r.Scan(&id, &at)
			return jsobj.New("app_user_id", id, "created_at", float64(at)), err
		})
	if err != nil {
		q.internal(err)
		return
	}
	events, err := queryObjects(ctx, db, `SELECT id, type, app_id, environment, created_at FROM webhook_event WHERE customer_id = $1
		 ORDER BY created_at DESC, id COLLATE "C" DESC LIMIT 50`, []any{customer.ID}, func(r pgx.CollectableRow) (*jsobj.Object, error) {
		var id, typ, app, env string
		var at int64
		err := r.Scan(&id, &typ, &app, &env, &at)
		return jsobj.New("id", id, "type", typ, "app_id", app, "environment", env, "created_at", float64(at)), err
	})
	if err != nil {
		q.internal(err)
		return
	}
	experiments, err := customerExperiments(ctx, db, customer.ID)
	if err != nil {
		q.internal(err)
		return
	}

	var visible []ledger.Transaction
	for _, t := range loaded.Transactions {
		if p.canSeeApp(t.AppID) {
			visible = append(visible, t)
		}
	}
	sort.SliceStable(visible, func(i, j int) bool { return visible[i].PurchasedAt > visible[j].PurchasedAt })
	txs := []any{}
	for i := range visible {
		txs = append(txs, transactionJSON(&visible[i]))
	}
	states := []any{}
	for i := range loaded.States {
		s := &loaded.States[i]
		for _, t := range visible {
			if t.Store == s.Store && t.OriginalTransactionID == s.OriginalTransactionID {
				states = append(states, stateJSON(s))
				break
			}
		}
	}
	visibleEvents := []any{}
	for _, e := range events {
		app, _ := e.Get("app_id")
		if p.canSeeApp(app.(string)) {
			visibleEvents = append(visibleEvents, e)
		}
	}
	ents := []any{}
	for _, e := range project.Entitlements {
		ents = append(ents, e.ID)
	}
	out := jsobj.New(
		"customer", jsobj.New("id", customer.ID, "project_id", customer.ProjectID, "original_app_user_id", customer.AppUserID, "first_seen", float64(customer.FirstSeen)),
		"aliases", objectsToAny(aliases),
	)
	// CustomerInfo and grants span every app, so only all-apps operators see them.
	if p.apps == nil {
		out.Set("customer_info", info.Body)
	}
	out.Set("attributes", attributes)
	out.Set("transactions", txs)
	out.Set("subscription_states", states)
	out.Set("webhook_events", visibleEvents)
	if p.apps == nil {
		grants := []any{}
		for i := range loaded.Grants {
			grants = append(grants, grantJSON(&loaded.Grants[i]))
		}
		out.Set("grants", grants)
	}
	out.Set("entitlement_ids", ents)
	out.Set("experiments", experiments)
	q.json(http.StatusOK, out)
}

func queryObjects(ctx context.Context, db ledger.DB, sql string, args []any, scan func(pgx.CollectableRow) (*jsobj.Object, error)) ([]*jsobj.Object, error) {
	rows, err := db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scan)
}

func objectsToAny(list []*jsobj.Object) []any {
	out := make([]any, len(list))
	for i, o := range list {
		out[i] = o
	}
	return out
}

// customerExperiments are a customer's experiments for the dashboard: RevenueCat's `experiments`
// entries plus the name (lite/src/experiments.ts customerExperimentsQuery).
func customerExperiments(ctx context.Context, db ledger.DB, customerID string) ([]any, error) {
	list, err := queryObjects(ctx, db,
		`SELECT experiment_id, variant, enrolled_at, name FROM (
		   SELECT DISTINCT ON (e.experiment_id) e.experiment_id, e.variant, e.enrolled_at, x.name
		   FROM experiment_enrollment e JOIN experiment x ON x.id = e.experiment_id
		   WHERE e.app_user_id IN (SELECT app_user_id FROM customer_alias WHERE customer_id = $1)
		     AND x.project_id = (SELECT project_id FROM customer WHERE id = $1)
		   ORDER BY e.experiment_id, e.enrolled_at) s
		 ORDER BY enrolled_at, experiment_id COLLATE "C"`, []any{customerID},
		func(r pgx.CollectableRow) (*jsobj.Object, error) {
			var id, variant, name string
			var at int64
			err := r.Scan(&id, &variant, &at, &name)
			return jsobj.New("experiment_id", id, "experiment_variant", variant, "enrolled_at_ms", float64(at), "experiment_name", name), err
		})
	if err != nil {
		return nil, err
	}
	return objectsToAny(list), nil
}

// --- promotional grants ----------------------------------------------------------------------------
//
// A grant is part of the ledger (promotional_grant): CustomerInfo shows it the way RevenueCat
// does. Granting or revoking bumps the customer's ledger version in the same transaction, and the
// snapshot is rebuilt afterwards, so the SDK sees the change on its next fetch. Every change is in
// the audit log.

// grantDurations are RevenueCat's. Months and years are calendar months and years.
var grantDurations = []string{"daily", "three_day", "weekly", "monthly", "two_month", "three_month", "six_month", "yearly", "lifetime"}

const (
	dayMs         = 86_400_000
	maxCustomMs   = 10 * 365 * dayMs
	maxGrantNote  = 500
	grantNoteHint = "The note can be at most 500 characters."
)

func addMonths(ms int64, months int) int64 {
	return time.UnixMilli(ms).UTC().AddDate(0, months, 0).UnixMilli()
}

// grantEnd is when a grant of duration starting at start ends; nil for lifetime.
func grantEnd(duration string, start int64) *int64 {
	var end int64
	switch duration {
	case "daily":
		end = start + dayMs
	case "three_day":
		end = start + 3*dayMs
	case "weekly":
		end = start + 7*dayMs
	case "monthly":
		end = addMonths(start, 1)
	case "two_month":
		end = addMonths(start, 2)
	case "three_month":
		end = addMonths(start, 3)
	case "six_month":
		end = addMonths(start, 6)
	case "yearly":
		end = addMonths(start, 12)
	default:
		return nil
	}
	return &end
}

// grantActor is who grants: an operator through the dashboard or the API.
type grantActor struct {
	email      string
	operatorID string
	source     string
	tokenID    *string
	ip         *string
}

func (q *adminReq) actor() grantActor {
	return grantActor{email: q.p.op.Email, operatorID: q.p.op.ID, source: q.p.source(), tokenID: q.p.tokenID, ip: q.ip()}
}

func (a grantActor) audit(action, target string, details *jsobj.Object) auditEntry {
	id, email := a.operatorID, a.email
	return auditEntry{operatorID: &id, actor: &email, tokenID: a.tokenID, source: a.source, action: action, target: &target, details: details, ip: a.ip}
}

// grantError is a refused grant: 400 or 404.
type grantError struct {
	status int
	msg    string
}

func (e *grantError) Error() string { return e.msg }

// grantEntitlement gives a customer an entitlement for duration, or until expiresAt (a custom end).
func grantEntitlement(ctx context.Context, db ledger.TxDB, project *config.Project, appUserID, entitlementID string, duration any, expiresAt *float64, note any, actor grantActor, now int64) (*jsobj.Object, string, error) {
	var entitlement *config.Entitlement
	ids := []string{}
	for _, e := range project.Entitlements {
		ids = append(ids, e.ID)
		if e.ID == entitlementID {
			entitlement = e
		}
	}
	if entitlement == nil {
		list := strings.Join(ids, ", ")
		if list == "" {
			list = "none configured"
		}
		return nil, "", &grantError{400, `No entitlement "` + entitlementID + `". Entitlements: ` + list + "."}
	}
	var dur string
	var end *int64
	if expiresAt != nil {
		if math.IsNaN(*expiresAt) || math.IsInf(*expiresAt, 0) || *expiresAt <= float64(now) {
			return nil, "", &grantError{400, "The end date must be in the future."}
		}
		if *expiresAt-float64(now) > maxCustomMs {
			return nil, "", &grantError{400, "A custom grant can last at most 10 years; use lifetime instead."}
		}
		dur = "custom"
		at := int64(*expiresAt)
		end = &at
	} else {
		d, _ := duration.(string)
		if !contains(grantDurations, d) {
			return nil, "", &grantError{400, "duration must be one of: " + strings.Join(grantDurations, ", ") + " (or give an end date)."}
		}
		dur = d
		end = grantEnd(d, now)
	}
	var trimmed *string
	if note != nil {
		text, ok := note.(string)
		if !ok {
			return nil, "", &grantError{400, "note must be text."}
		}
		if t := jsobj.Trim(text); t != "" {
			trimmed = &t
		}
	}
	if trimmed != nil && jsobj.UTF16Len(*trimmed) > maxGrantNote {
		return nil, "", &grantError{400, grantNoteHint}
	}
	customer, err := ledger.FindCustomer(ctx, db, project.ID, appUserID)
	if err != nil {
		return nil, "", err
	}
	if customer == nil {
		return nil, "", &grantError{404, `No customer with app user ID "` + appUserID + `". They need to have opened the app (or be logged in) first.`}
	}
	grant := &ledger.Grant{ID: ledger.NewUUID(), EntitlementID: entitlement.ID, Duration: dur, StartsAt: now, ExpiresAt: end,
		Note: trimmed, GrantedBy: &actor.email, Source: actor.source, CreatedAt: now}
	err = pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx,
			`INSERT INTO promotional_grant (id, customer_id, entitlement_id, duration, starts_at, expires_at, note, granted_by, source, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
			grant.ID, customer.ID, grant.EntitlementID, dur, now, end, trimmed, actor.email, actor.source, now); err != nil {
			return err
		}
		if err := customerinfo.Invalidate(ctx, tx, customer.ID); err != nil {
			return err
		}
		return writeAudit(ctx, tx, now, actor.audit("grant.created", appUserID,
			jsobj.New("grant_id", grant.ID, "entitlement", entitlement.ID, "duration", dur, "expires_at", numOrNull(end), "note", strOrNull(trimmed))))
	})
	if err != nil {
		return nil, "", err
	}
	return grantJSON(grant), customer.ID, nil
}

// revokeGrant ends a grant now. The row stays, marked revoked.
func revokeGrant(ctx context.Context, db ledger.TxDB, projectID, appUserID, grantID string, actor grantActor, now int64) (string, error) {
	var id, customerID, entitlementID string
	var revokedAt *int64
	err := db.QueryRow(ctx,
		`SELECT g.id, g.customer_id, g.entitlement_id, g.revoked_at FROM promotional_grant g
		 JOIN customer_alias a ON a.customer_id = g.customer_id WHERE a.project_id = $1 AND a.app_user_id = $2 AND g.id = $3`,
		projectID, appUserID, grantID).Scan(&id, &customerID, &entitlementID, &revokedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", &grantError{404, "No grant " + grantID + ` for customer "` + appUserID + `".`}
	}
	if err != nil {
		return "", err
	}
	if revokedAt != nil {
		return "", &grantError{400, "That grant was already revoked."}
	}
	already := false
	err = pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, "UPDATE promotional_grant SET revoked_at = $1, revoked_by = $2 WHERE id = $3 AND revoked_at IS NULL", now, actor.email, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			already = true
			return nil
		}
		if err := customerinfo.Invalidate(ctx, tx, customerID); err != nil {
			return err
		}
		return writeAudit(ctx, tx, now, actor.audit("grant.revoked", appUserID, jsobj.New("grant_id", id, "entitlement", entitlementID)))
	})
	if err != nil {
		return "", err
	}
	if already {
		return "", &grantError{400, "That grant was already revoked."}
	}
	return customerID, nil
}

// grantAnswer answers a refused grant or an error; false when there was none.
func (s *server) grantAnswer(q *adminReq, err error) bool {
	var ge *grantError
	if errors.As(err, &ge) {
		code := "bad_request"
		if ge.status == http.StatusNotFound {
			code = "not_found"
		}
		q.fail(ge.status, code, ge.msg)
		return true
	}
	if err != nil {
		q.internal(err)
		return true
	}
	return false
}

// allAppsOnly: entitlements cover every app of a project, so granting needs access to all apps.
func allAppsOnly(q *adminReq) bool {
	if q.p.apps != nil {
		q.forbidden("Granting entitlements needs access to all apps.")
		return false
	}
	return true
}

func adminGrant(q *adminReq) {
	if !allAppsOnly(q) {
		return
	}
	var expiresAt *float64
	if raw, present := q.prop("expires_at"); present {
		var at float64
		if n, ok := raw.(float64); ok {
			at = n
		} else {
			at = jsDateParse(jsobj.String(raw, true))
		}
		if math.IsNaN(at) || math.IsInf(at, 0) {
			q.bad("expires_at must be a date (ISO 8601) or milliseconds since 1970.")
			return
		}
		expiresAt = &at
	}
	project := q.project("")
	if project == nil {
		return
	}
	entRaw, entOK := q.prop("entitlement_id")
	entitlement := ""
	if entOK && entRaw != nil {
		entitlement = jsobj.String(entRaw, true)
	}
	duration, _ := q.prop("duration")
	note, _ := q.prop("note") // nil when missing or null
	grant, customerID, err := grantEntitlement(q.ctx, q.s.Pool, project, q.params["app_user_id"], entitlement, duration, expiresAt, note, q.actor(), q.now)
	if q.s.grantAnswer(q, err) {
		return
	}
	q.s.refreshLater(q.cfg, customerID)
	q.json(http.StatusCreated, jsobj.New("grant", grant))
}

func adminRevokeGrant(q *adminReq) {
	if !allAppsOnly(q) {
		return
	}
	project := q.project("")
	if project == nil {
		return
	}
	customerID, err := revokeGrant(q.ctx, q.s.Pool, project.ID, q.params["app_user_id"], q.params["grant_id"], q.actor(), q.now)
	if q.s.grantAnswer(q, err) {
		return
	}
	q.s.refreshLater(q.cfg, customerID)
	q.json(http.StatusOK, jsobj.New("revoked", q.params["grant_id"]))
}

// --- JavaScript's Date.parse ------------------------------------------------------------------------

var isoDate = regexp.MustCompile(`^([+-]\d{6}|\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})?)?$`)

// jsDateParse is Date.parse for the ECMAScript date time string format (2026-01-31,
// 2026-01-31T12:00:00.000Z, with an offset, ...). A date and time without an offset is read as UTC
// (Workers' time zone). NaN for anything else: V8's fallback formats ("Jan 31 2026") aren't
// supported.
func jsDateParse(s string) float64 {
	m := isoDate.FindStringSubmatch(s)
	if m == nil {
		return math.NaN()
	}
	num := func(v string, def int) int {
		if v == "" {
			return def
		}
		n, _ := strconv.Atoi(v)
		return n
	}
	year, _ := strconv.Atoi(m[1])
	if m[1] == "-000000" {
		return math.NaN()
	}
	month, day := num(m[2], 1), num(m[3], 1)
	hour, minute, sec := num(m[4], 0), num(m[5], 0), num(m[6], 0)
	ms := 0
	if m[7] != "" {
		frac := (m[7] + "00")[:3]
		ms, _ = strconv.Atoi(frac)
	}
	if month < 1 || month > 12 || day < 1 || day > 31 || hour > 24 || minute > 59 || sec > 59 || (hour == 24 && (minute != 0 || sec != 0 || ms != 0)) {
		return math.NaN()
	}
	t := time.Date(year, time.Month(month), day, hour, minute, sec, ms*1_000_000, time.UTC)
	if t.Day() != day {
		return math.NaN() // February 30th
	}
	if zone := m[8]; zone != "" && zone != "Z" {
		h, _ := strconv.Atoi(zone[1:3])
		mi, _ := strconv.Atoi(zone[4:6])
		if h > 23 || mi > 59 {
			return math.NaN()
		}
		off := time.Duration(h)*time.Hour + time.Duration(mi)*time.Minute
		if zone[0] == '+' {
			t = t.Add(-off)
		} else {
			t = t.Add(off)
		}
	}
	return float64(t.UnixMilli())
}
