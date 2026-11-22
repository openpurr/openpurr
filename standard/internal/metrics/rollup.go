// Package metrics is the charts: daily totals in metric_daily, derived from the ledger (which stays
// the source of truth), and the charts read from them. A port of lite/src/metrics.ts.
//
// The rollup runs hourly (the rollup-metrics job) and on demand. It recomputes only from the first
// day something changed: the earliest purchase date among ledger rows updated since the last run,
// or the last run's own day (so subscriptions that simply ran out since then are counted),
// whichever is earlier. The first run, or a full rebuild, covers all history.
//
// Subscriptions become time segments: each transaction gives access from its purchase until the
// earliest of its expiry (or the end of a grace period, for the latest one), its refund or
// revocation, and the next transaction in the same chain (purchases at the same moment are taken
// in the order they were recorded, so only the last of them gives access). A segment adds +1 to
// the running totals on the day it starts and -1 on the day it ends; a chart adds the daily
// changes up from the beginning. MRR does the same with each paid segment's price normalized to a
// month, using the billing period inferred from its length. Movements classify those same starts
// and ends, so they always add up to the running totals (see lite/src/metrics.ts for the rules).
//
// Lite does all of this in one SQL statement per kind of total. Standard reads the ledger rows
// the statement would read and does the same arithmetic in Go, with SQLite's summation and
// rounding (sqlite.go), so every stored value matches Lite's to the last bit; the tests check it
// against Lite's own output (internal/testdata/golden-metrics.json.gz).
//
// Standard also keeps the same totals by country (metric_daily_country, migration 0004), for the
// charts' country filter, which Lite left to Standard.
package metrics

import (
	"context"
	"errors"
	"math"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/openpurr/openpurr/standard/internal/countries"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
)

const (
	Day           = int64(86_400_000)
	graceLookback = 62 * Day // grace periods last at most a few weeks past expiry
	stateKey      = "metrics_rollup"
	changeSlack   = 60_000 // ledger rows written while the previous run was reading
	// StatusRecentDays is how far back the status breakdown counts ended subscriptions.
	StatusRecentDays = 30

	importKey = "import_active"
	// ImportQuietMs: during an import (internal/server/admin_import.go marks it), the rollup waits
	// until this long after the last imported row, then recomputes once.
	ImportQuietMs = 3600_000

	// The transaction-scoped advisory lock that serializes rollups (the hourly job and the refresh
	// endpoint, on any replica).
	lockKey = int64(0x6f70_6d65_7472_6963) // "opmetric"
)

// RunningMetrics are stored as daily changes and added up by the chart.
var RunningMetrics = []string{"active_subs", "active_trials", "paid_subs", "mrr"}

// MovementMetrics come from the same segments; stored as the day's amount.
var MovementMetrics = []string{"sub_new", "sub_renewed", "sub_reactivated", "sub_churned", "trial_converted", "trial_expired",
	"trial_cancelled", "mrr_new", "mrr_reactivation", "mrr_expansion", "mrr_contraction", "mrr_churned"}

// DailyMetrics are stored as the day's amount.
var DailyMetrics = []string{"revenue", "transactions", "refunds", "refund_amount", "new_trials", "nonsub_revenue", "nonsub_count", "unconverted"}

// LedgerMetrics are everything derived from store_transaction (all but new_customers).
var LedgerMetrics = append(append(append([]string{}, RunningMetrics...), MovementMetrics...), DailyMetrics...)

// DB is what the rollup needs: a transaction.
type DB interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

// Querier reads.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// RollupResult is a rollup run's outcome, as Lite reports it.
type RollupResult struct {
	From *string
	Rows int64
	Full bool
	// Skipped because an import is running.
	Deferred bool
	// Standard only: rows written to metric_daily_country (not in Rows, which counts what Lite
	// would write).
	CountryRows int64
}

// JSON is Lite's RollupResult.
func (r *RollupResult) JSON() *jsobj.Object {
	var from any
	if r.From != nil {
		from = *r.From
	}
	o := jsobj.New("from", from, "rows", float64(r.Rows), "full", r.Full)
	if r.Deferred {
		o.Set("deferred", true)
	}
	return o
}

// state is job_state's metrics_rollup value: {at, first} (and rebuild, set by a migration).
type state struct {
	at      int64
	first   *string
	rebuild bool
}

func readState(ctx context.Context, q Querier) (*state, error) {
	var raw string
	err := q.QueryRow(ctx, "SELECT value FROM job_state WHERE key = $1", stateKey).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	v, err := jsobj.Parse([]byte(raw))
	if err != nil {
		return nil, err
	}
	st := &state{}
	if at, ok := jsobj.Prop(v, "at"); ok {
		if f, isNum := at.(float64); isNum {
			st.at = int64(f)
		}
	}
	if first, ok := jsobj.Prop(v, "first"); ok {
		if s, isStr := first.(string); isStr {
			st.first = &s
		}
	}
	if rb, ok := jsobj.Prop(v, "rebuild"); ok {
		st.rebuild = truthy(rb)
	}
	return st, nil
}

func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case float64:
		return x != 0 && !math.IsNaN(x)
	case string:
		return x != ""
	}
	return true
}

// LastRollupAt is when the chart totals were last updated, or nil.
func LastRollupAt(ctx context.Context, q Querier) (*int64, error) {
	st, err := readState(ctx, q)
	if err != nil || st == nil {
		return nil, err
	}
	return &st.at, nil
}

// Info is when the chart totals were last updated and the first day with a purchase (for "all
// time" ranges): GET /admin/v1/metrics's updated_at and first_date.
func Info(ctx context.Context, q Querier) (updatedAt any, firstDate any, err error) {
	st, err := readState(ctx, q)
	if err != nil || st == nil {
		return nil, nil, err
	}
	if st.first != nil {
		firstDate = *st.first
	}
	return float64(st.at), firstDate, nil
}

// DayOf is the UTC date of an epoch-ms time (SQLite's date(ms / 1000, 'unixepoch')).
func DayOf(ms int64) string {
	return time.Unix(ms/1000, 0).UTC().Format("2006-01-02")
}

// startOfDay is Math.floor(ms / DAY) * DAY.
func startOfDay(ms int64) int64 {
	d := ms / Day
	if ms%Day < 0 {
		d--
	}
	return d * Day
}

// Rollup updates metric_daily (and metric_daily_country) from the ledger. full recomputes all
// history, except new_customers, which is counted once (the cleanup job deletes old non-buyers).
func Rollup(ctx context.Context, db DB, now int64, full bool) (*RollupResult, error) {
	var result *RollupResult
	err := pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", lockKey); err != nil {
			return err
		}
		// A full rebuild sorts every subscription purchase.
		if _, err := tx.Exec(ctx, "SET LOCAL work_mem = '64MB'"); err != nil {
			return err
		}
		var err error
		result, err = rollup(ctx, tx, now, full)
		return err
	})
	return result, err
}

func rollup(ctx context.Context, tx pgx.Tx, now int64, fullAsked bool) (*RollupResult, error) {
	// The last run's time stays put, so the run after the import picks up everything it changed.
	if !fullAsked {
		var at int64
		err := tx.QueryRow(ctx, "SELECT updated_at FROM job_state WHERE key = $1", importKey).Scan(&at)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		if err == nil && now-at < ImportQuietMs {
			return &RollupResult{Deferred: true}, nil
		}
	}
	st, err := readState(ctx, tx)
	if err != nil {
		return nil, err
	}
	full := fullAsked || st == nil || st.rebuild
	var from *int64
	if full {
		if err := tx.QueryRow(ctx, "SELECT min(purchased_at) FROM store_transaction").Scan(&from); err != nil {
			return nil, err
		}
	} else {
		since := st.at - changeSlack
		var txAt, subAt *int64
		if err := tx.QueryRow(ctx, "SELECT min(purchased_at) FROM store_transaction WHERE updated_at >= $1", since).Scan(&txAt); err != nil {
			return nil, err
		}
		// A subscription's renewal state (a grace period, auto-renew) changes with its latest purchase.
		if err := tx.QueryRow(ctx,
			`SELECT min(latest) FROM (
			   SELECT max(t.purchased_at) AS latest FROM subscription_state s
			   JOIN store_transaction t ON t.store = s.store AND t.original_transaction_id = s.original_transaction_id
			   WHERE s.updated_at >= $1 GROUP BY s.store, s.original_transaction_id) x`, since).Scan(&subAt); err != nil {
			return nil, err
		}
		m := st.at
		for _, p := range []*int64{txAt, subAt} {
			if p != nil && *p < m {
				m = *p
			}
		}
		from = &m
	}

	tomorrow := startOfDay(now) + Day
	res := &RollupResult{Full: full}
	var known *string
	if from != nil {
		fromDay := startOfDay(*from)
		fromDate := DayOf(fromDay)
		known = &fromDate
		rates, err := loadRates(ctx, tx)
		if err != nil {
			return nil, err
		}
		totals := newTotals()
		if err := segmentTotals(ctx, tx, rates, fromDay, tomorrow, totals); err != nil {
			return nil, err
		}
		if err := dailyTotals(ctx, tx, rates, fromDay, tomorrow, totals); err != nil {
			return nil, err
		}
		res.Rows, res.CountryRows, err = totals.write(ctx, tx, fromDate)
		if err != nil {
			return nil, err
		}
	}
	res.From = known

	var first *string
	if full {
		first = known
	} else {
		var days []string
		for _, d := range []*string{st.first, known} {
			if d != nil && *d != "" {
				days = append(days, *d)
			}
		}
		sort.Strings(days)
		if len(days) > 0 {
			first = &days[0]
		}
	}

	// New customers: counted from the last run's day on (all of history the first time), and never
	// recounted after that, because the cleanup job deletes old non-buyers.
	customersFrom := int64(0)
	if st != nil {
		customersFrom = startOfDay(st.at)
	}
	tag, err := tx.Exec(ctx,
		`INSERT INTO metric_daily (metric, environment, project_id, app_id, store, product_id, date, value)
		 SELECT 'new_customers', '', project_id, '', '', '', `+sqlDay("first_seen")+` AS d, count(*) FROM customer
		 WHERE first_seen >= $1 AND first_seen < $2 GROUP BY project_id, d
		 ON CONFLICT (metric, environment, project_id, app_id, store, product_id, date) DO UPDATE SET value = excluded.value`,
		customersFrom, tomorrow)
	if err != nil {
		return nil, err
	}
	res.Rows += tag.RowsAffected()

	var firstJSON any
	if first != nil {
		firstJSON = *first
	}
	value := jsobj.Stringify(jsobj.New("at", float64(now), "first", firstJSON))
	if _, err := tx.Exec(ctx,
		`INSERT INTO job_state (key, value, updated_at) VALUES ($1, $2, $3)
		 ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, stateKey, value, now); err != nil {
		return nil, err
	}
	return res, nil
}

// sqlDay is SQLite's date(col / 1000, 'unixepoch') for an epoch-ms bigint column.
func sqlDay(col string) string {
	return `to_char(to_timestamp((` + col + ` / 1000)::float8) AT TIME ZONE 'UTC', 'YYYY-MM-DD')`
}

// --- Exchange rates --------------------------------------------------------------------------------

type rate struct {
	date   string
	perUSD float64
}

// rates are fx_rate by currency, in date order.
type rates map[string][]rate

func loadRates(ctx context.Context, q Querier) (rates, error) {
	rows, err := q.Query(ctx, "SELECT currency, date, per_usd FROM fx_rate ORDER BY currency, date")
	if err != nil {
		return nil, err
	}
	out := rates{}
	var cur, date string
	var per float64
	_, err = pgx.ForEachRow(rows, []any{&cur, &date, &per}, func() error {
		out[cur] = append(out[cur], rate{date, per})
		return nil
	})
	return out, err
}

// usd is lite/src/fx.ts usdSql: the price in USD at the rate for the purchase date, the closest
// earlier one, or else the closest later one; nil without a price, a currency or a rate.
func (r rates) usd(priceMicros *int64, currency *string, purchasedAt int64) *float64 {
	if priceMicros == nil || currency == nil {
		return nil
	}
	amount := float64(*priceMicros) / 1e6
	if *currency == "USD" {
		return &amount
	}
	list := r[*currency]
	if len(list) == 0 {
		return nil
	}
	day := DayOf(purchasedAt)
	// The first rate after the day; the one before it is the closest earlier one.
	i := sort.Search(len(list), func(i int) bool { return list[i].date > day })
	per := list[0].perUSD
	if i > 0 {
		per = list[i-1].perUSD
	} else {
		per = list[i].perUSD
	}
	if per == 0 {
		return nil // SQLite: division by zero is NULL
	}
	v := amount / per
	return &v
}

// --- Totals ------------------------------------------------------------------------------------------

// dims are a total's dimensions: environment, app, store, product, and (for the Standard-only
// table) country.
type dims struct {
	environment, app, store, product, country, date string
}

// acc is one day's totals for one set of dimensions.
type acc struct {
	// Integer sums.
	activeSubs, activeTrials, paidSubs                         int64
	subNew, subRenewed, subReactivated, subChurned             int64
	trialConverted, trialExpired, trialCancelled               int64
	transactions, newTrials, nonsubCount, unconverted, refunds int64
	mrr, mrrNew, mrrReactivation, mrrExpansion, mrrContraction kbnSum
	mrrChurned, revenue, nonsubRevenue, refundAmount           kbnSum
}

type totals struct {
	all       map[dims]*acc
	byCountry map[dims]*acc
}

func newTotals() *totals {
	return &totals{all: map[dims]*acc{}, byCountry: map[dims]*acc{}}
}

// both is the accumulators to add an event to: the total without country, and the country's.
func (t *totals) both(d dims) [2]*acc {
	country := d.country
	d.country = ""
	a := t.all[d]
	if a == nil {
		a = &acc{}
		t.all[d] = a
	}
	d.country = country
	c := t.byCountry[d]
	if c == nil {
		c = &acc{}
		t.byCountry[d] = c
	}
	return [2]*acc{a, c}
}

// values are a day's stored metrics: Lite's filter, v IS NOT NULL AND v != 0, with sums rounded as
// Lite rounds them.
func (a *acc) values(emit func(metric string, v float64)) {
	ints := []struct {
		m string
		v int64
	}{
		{"active_subs", a.activeSubs}, {"active_trials", a.activeTrials}, {"paid_subs", a.paidSubs},
		{"sub_new", a.subNew}, {"sub_renewed", a.subRenewed}, {"sub_reactivated", a.subReactivated}, {"sub_churned", a.subChurned},
		{"trial_converted", a.trialConverted}, {"trial_expired", a.trialExpired}, {"trial_cancelled", a.trialCancelled},
		{"transactions", a.transactions}, {"new_trials", a.newTrials}, {"nonsub_count", a.nonsubCount},
		{"unconverted", a.unconverted}, {"refunds", a.refunds},
	}
	for _, x := range ints {
		if x.v != 0 {
			emit(x.m, float64(x.v))
		}
	}
	reals := []struct {
		m      string
		v      *kbnSum
		places int
	}{
		{"mrr", &a.mrr, 4}, {"mrr_new", &a.mrrNew, 4}, {"mrr_reactivation", &a.mrrReactivation, 4},
		{"mrr_expansion", &a.mrrExpansion, 4}, {"mrr_contraction", &a.mrrContraction, 4}, {"mrr_churned", &a.mrrChurned, 4},
		{"revenue", &a.revenue, 2}, {"nonsub_revenue", &a.nonsubRevenue, 2}, {"refund_amount", &a.refundAmount, 2},
	}
	for _, x := range reals {
		if !x.v.any {
			continue
		}
		if v := sqliteRound(x.v.value(), x.places); v != 0 {
			emit(x.m, v)
		}
	}
}

// write replaces the stored totals from fromDate on with these, and returns how many rows that is
// in metric_daily (what Lite counts as written) and in metric_daily_country.
//
// Lite deletes them all and inserts the new ones. Re-inserting a key deleted in the same
// transaction is slow in Postgres (each unique check visits the dead row), and a rollup mostly
// finds the totals it already stored, so this reads what's stored and deletes, updates and
// inserts only what differs. The result is the same.
func (t *totals) write(ctx context.Context, tx pgx.Tx, fromDate string) (int64, int64, error) {
	all := map[rowKey]float64{}
	for d, a := range t.all {
		a.values(func(m string, v float64) {
			all[rowKey{m, d.environment, d.app, d.store, d.product, "", d.date}] = v
		})
	}
	byCountry := map[rowKey]float64{}
	for d, a := range t.byCountry {
		a.values(func(m string, v float64) {
			byCountry[rowKey{m, d.environment, d.app, d.store, d.product, d.country, d.date}] = v
		})
	}
	if err := replaceRows(ctx, tx, "metric_daily", "project_id", fromDate, all); err != nil {
		return 0, 0, err
	}
	if err := replaceRows(ctx, tx, "metric_daily_country", "country", fromDate, byCountry); err != nil {
		return 0, 0, err
	}
	return int64(len(all)), int64(len(byCountry)), nil
}

// rowKey is a stored total's key. extra is metric_daily's project_id (” for ledger metrics) or
// metric_daily_country's country.
type rowKey struct{ metric, environment, app, store, product, extra, date string }

// replaceRows makes table's ledger metrics from fromDate on exactly rows.
func replaceRows(ctx context.Context, tx pgx.Tx, table, extra, fromDate string, rows map[rowKey]float64) error {
	cols := "metric, environment, app_id, store, product_id, " + extra + ", date"
	stored, err := tx.Query(ctx, "SELECT "+cols+", value FROM "+table+" WHERE metric = ANY($1) AND date >= $2", LedgerMetrics, fromDate)
	if err != nil {
		return err
	}
	var k rowKey
	var v float64
	var gone, changed [][]any
	seen := map[rowKey]bool{}
	_, err = pgx.ForEachRow(stored, []any{&k.metric, &k.environment, &k.app, &k.store, &k.product, &k.extra, &k.date, &v}, func() error {
		nv, ok := rows[k]
		switch {
		case !ok:
			gone = append(gone, keyRow(k))
		case nv != v || math.Signbit(nv) != math.Signbit(v):
			changed = append(changed, append(keyRow(k), nv))
		}
		seen[k] = true
		return nil
	})
	if err != nil {
		return err
	}
	var added [][]any
	for k, v := range rows {
		if !seen[k] {
			added = append(added, append(keyRow(k), v))
		}
	}
	same := "m.metric = d.metric AND m.environment = d.environment AND m.app_id = d.app_id AND m.store = d.store AND m.product_id = d.product_id AND m." +
		extra + " = d." + extra + " AND m.date = d.date"
	if len(gone) > 0 {
		if _, err := tx.Exec(ctx, "DELETE FROM "+table+" m USING unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[]) AS d("+
			cols+") WHERE "+same, columnsOf(gone, 7)...); err != nil {
			return err
		}
	}
	if len(changed) > 0 {
		if _, err := tx.Exec(ctx, "UPDATE "+table+" m SET value = d.value FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::float8[]) AS d("+
			cols+", value) WHERE "+same, columnsOf(changed, 8)...); err != nil {
			return err
		}
	}
	if len(added) > 0 {
		// In key order, which B-tree inserts take fastest.
		slices.SortFunc(added, func(a, b []any) int {
			for i := range 7 {
				if c := strings.Compare(a[i].(string), b[i].(string)); c != 0 {
					return c
				}
			}
			return 0
		})
		names := strings.Split(cols, ", ")
		if _, err := tx.CopyFrom(ctx, pgx.Identifier{table}, append(names, "value"), pgx.CopyFromRows(added)); err != nil {
			return err
		}
	}
	return nil
}

func keyRow(k rowKey) []any {
	return []any{k.metric, k.environment, k.app, k.store, k.product, k.extra, k.date}
}

// columnsOf turns rows into one array per column, for unnest.
func columnsOf(rows [][]any, n int) []any {
	out := make([]any, n)
	for c := range n {
		if c == 7 {
			col := make([]float64, len(rows))
			for i, r := range rows {
				col[i] = r[c].(float64)
			}
			out[c] = col
			continue
		}
		col := make([]string, len(rows))
		for i, r := range rows {
			col[i] = r[c].(string)
		}
		out[c] = col
	}
	return out
}

// CountryOf is a purchase's country: Apple's storefront is ISO 3166-1 alpha-3, Google's
// regionCode is already alpha-2 (as webhook events' country_code); empty when unknown.
func CountryOf(store string, storefront *string) string {
	if storefront == nil {
		return ""
	}
	if store == "app_store" {
		return countries.Alpha2FromAlpha3(*storefront)
	}
	s := strings.ToUpper(*storefront)
	if len(s) != 2 {
		return ""
	}
	return s
}

// product is the product as charts show it: Google Play base plans are separate ("pro:monthly").
func product(productID string, basePlan *string) string {
	if basePlan == nil {
		return productID
	}
	return productID + ":" + *basePlan
}

// --- Subscription segments -----------------------------------------------------------------------------

type chainTx struct {
	app, environment, productID, productType, periodType string
	basePlan, currency, storefront                       *string
	purchasedAt                                          int64
	expiresAt, revokedAt, priceMicros                    *int64
	usd                                                  *float64
}

// tri is SQL's three-valued logic for the one comparison that can be NULL.
type tri int8

const (
	triFalse tri = iota
	triTrue
	triNull
)

// periodDays is the days in a billing period, from a segment's length (NULL: yearly, as SQLite's
// CASE falls through).
func periodDays(ms *int64) float64 {
	if ms == nil {
		return 365.25
	}
	switch m := *ms; {
	case m < 10*Day:
		return 7
	case m < 45*Day:
		return 30.4375
	case m < 100*Day:
		return 91.3125
	case m < 200*Day:
		return 182.625
	}
	return 365.25
}

func sub(a, b *int64) *int64 {
	if a == nil || b == nil {
		return nil
	}
	d := *a - *b
	return &d
}

const far = int64(9e15) // Lite's coalesce(x, 9e15)

func orFar(p *int64) int64 {
	if p == nil {
		return far
	}
	return *p
}

func eqStr(a, b *string) bool { // a IS b
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func eqInt(a, b *int64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// segmentTotals adds the running totals and movements of every subscription segment that starts,
// ends or is cancelled in [fromDay, tomorrow).
func segmentTotals(ctx context.Context, tx pgx.Tx, r rates, fromDay, tomorrow int64, t *totals) error {
	lookback := fromDay - graceLookback
	// Every transaction of the chains with a subscription purchase that can still start or end
	// something (Lite's next_at and prev_id look at the whole chain).
	rows, err := tx.Query(ctx,
		`WITH chains AS MATERIALIZED (
		   SELECT c.store, c.original_transaction_id, s.grace_period_expires_at, s.unsubscribe_detected_at
		   FROM (SELECT DISTINCT store, original_transaction_id FROM store_transaction
		         WHERE product_type = 'subscription' AND expires_at >= $1) c
		   LEFT JOIN subscription_state s ON s.store = c.store AND s.original_transaction_id = c.original_transaction_id)
		 SELECT c.store, c.original_transaction_id, t.app_id, t.environment, t.product_id, t.base_plan_id, t.product_type, t.period_type,
		   t.purchased_at, t.expires_at, t.revoked_at, t.price_micros, t.currency, t.storefront,
		   c.grace_period_expires_at, c.unsubscribe_detected_at
		 FROM chains c
		 JOIN store_transaction t ON t.store = c.store AND t.original_transaction_id = c.original_transaction_id
		 ORDER BY c.store COLLATE "C", c.original_transaction_id COLLATE "C", t.purchased_at, t.id`, lookback)
	if err != nil {
		return err
	}
	var (
		store, chain, prevStore, prevChain string
		grace, unsub, curGrace, curUnsub   *int64
		x                                  chainTx
		list                               []chainTx
	)
	flush := func() {
		if len(list) > 0 {
			chainSegments(prevStore, list, curGrace, curUnsub, lookback, fromDay, tomorrow, t)
		}
		list = list[:0]
	}
	_, err = pgx.ForEachRow(rows, []any{&store, &chain, &x.app, &x.environment, &x.productID, &x.basePlan, &x.productType, &x.periodType,
		&x.purchasedAt, &x.expiresAt, &x.revokedAt, &x.priceMicros, &x.currency, &x.storefront, &grace, &unsub}, func() error {
		if store != prevStore || chain != prevChain {
			flush()
			prevStore, prevChain, curGrace, curUnsub = store, chain, grace, unsub
		}
		y := x
		y.usd = r.usd(y.priceMicros, y.currency, y.purchasedAt)
		list = append(list, y)
		return nil
	})
	if err != nil {
		return err
	}
	flush()
	return nil
}

// chainSegments is Lite's base, seg, ev, cls and day CTEs for one chain (in purchase order).
func chainSegments(store string, chain []chainTx, grace, unsub *int64, lookback, fromDay, tomorrow int64, t *totals) {
	for i := range chain {
		b := &chain[i]
		if b.productType != "subscription" || b.expiresAt == nil || *b.expiresAt < lookback {
			continue
		}
		start, expires := b.purchasedAt, *b.expiresAt
		// The chain is in purchase order, and purchases at the same moment in the order they were
		// recorded: the next purchase is the one after this, and the previous one the last purchase
		// before this one's moment (of a tie, only the last gives access: the next starts at once).
		var nextAt *int64
		if i+1 < len(chain) {
			nextAt = &chain[i+1].purchasedAt
		}
		var p *chainTx
		if lo := sort.Search(len(chain), func(j int) bool { return chain[j].purchasedAt >= start }); lo > 0 {
			p = &chain[lo-1]
		}

		end := expires
		if nextAt == nil && grace != nil && *grace > expires {
			end = *grace
		}
		stop := min(end, orFar(b.revokedAt), orFar(nextAt))
		continued := nextAt != nil && *nextAt <= min(expires, orFar(b.revokedAt))
		periodMs := expires - start
		prod := product(b.productID, b.basePlan)
		bDays := periodDays(&periodMs)
		nonTrial := b.periodType != "trial"
		var mrr float64
		if nonTrial && b.usd != nil && *b.usd > 0 {
			mrr = *b.usd * 30.4375 / bDays
		}
		country := CountryOf(store, b.storefront)

		hasPrev := p != nil
		continues := triFalse
		var prevType string
		sameTerms := false
		var prevMrr float64
		if hasPrev {
			prevType = p.periodType
			if p.expiresAt == nil {
				continues = triNull // min(NULL, ...) is NULL
			} else if min(*p.expiresAt, orFar(p.revokedAt)) >= start {
				continues = triTrue
			}
			pMs := sub(p.expiresAt, &p.purchasedAt)
			sameTerms = eqInt(p.priceMicros, b.priceMicros) && eqStr(p.currency, b.currency) &&
				product(p.productID, p.basePlan) == prod && periodDays(pMs) == bDays
			if p.periodType != "trial" {
				usd := 0.0
				if p.usd != nil {
					usd = *p.usd
				}
				prevMrr = usd * 30.4375 / periodDays(pMs)
			}
		}

		event := func(kind string, at int64, dir int64) {
			as := t.both(dims{b.environment, b.app, store, prod, country, DayOf(at)})
			isStart := kind == "start"
			isNew := isStart && nonTrial && (!hasPrev || (continues == triTrue && prevType == "trial"))
			isRenewal := isStart && nonTrial && continues == triTrue && prevType != "trial"
			isReactivation := isStart && nonTrial && hasPrev && continues == triFalse
			isChurn := kind == "end" && nonTrial && !continued
			for _, a := range as {
				a.activeSubs += dir
				if b.periodType == "trial" {
					a.activeTrials += dir
				}
				if b.periodType == "normal" {
					a.paidSubs += dir
				}
				if mrr != 0 && dir != 0 {
					a.mrr.add(float64(dir) * mrr)
				}
				if isNew {
					a.subNew++
					if mrr != 0 {
						a.mrrNew.add(mrr)
					}
				}
				if isRenewal {
					a.subRenewed++
					if !sameTerms && mrr > prevMrr {
						a.mrrExpansion.add(mrr - prevMrr)
					}
					if !sameTerms && mrr < prevMrr {
						a.mrrContraction.add(mrr - prevMrr)
					}
				}
				if isReactivation {
					a.subReactivated++
					if mrr != 0 {
						a.mrrReactivation.add(mrr)
					}
				}
				if isChurn {
					a.subChurned++
					if mrr != 0 {
						a.mrrChurned.add(-mrr)
					}
				}
				if kind == "end" && !nonTrial {
					if continued {
						a.trialConverted++
					} else {
						a.trialExpired++
					}
				}
				if kind == "cancel" {
					a.trialCancelled++
				}
			}
		}
		if stop > start {
			if start >= fromDay && start < tomorrow {
				event("start", start, 1)
			}
			if stop >= fromDay && stop < tomorrow {
				event("end", stop, -1)
			}
		}
		// Auto-renew turned off during a free trial.
		if !nonTrial && unsub != nil && *unsub >= start && *unsub < expires && *unsub >= fromDay && *unsub < tomorrow {
			event("cancel", *unsub, 0)
		}
	}
}

// dailyTotals adds the per-day amounts: purchases by purchase day, refunds by refund day.
func dailyTotals(ctx context.Context, tx pgx.Tx, r rates, fromDay, tomorrow int64, t *totals) error {
	rows, err := tx.Query(ctx,
		`SELECT app_id, store, environment, product_id, base_plan_id, product_type, period_type, price_micros, currency, storefront,
		   purchased_at, revoked_at, is_upgraded
		 FROM store_transaction
		 WHERE (purchased_at >= $1 AND purchased_at < $2) OR (revoked_at >= $1 AND revoked_at < $2)
		 ORDER BY id`, fromDay, tomorrow)
	if err != nil {
		return err
	}
	var (
		app, store, env, productID, productType, periodType string
		basePlan, currency, storefront                      *string
		purchasedAt                                         int64
		revokedAt, priceMicros                              *int64
		upgraded                                            int64
	)
	_, err = pgx.ForEachRow(rows, []any{&app, &store, &env, &productID, &basePlan, &productType, &periodType, &priceMicros, &currency,
		&storefront, &purchasedAt, &revokedAt, &upgraded}, func() error {
		usd := r.usd(priceMicros, currency, purchasedAt)
		prod := product(productID, basePlan)
		country := CountryOf(store, storefront)
		paid := priceMicros != nil && *priceMicros > 0
		if purchasedAt >= fromDay && purchasedAt < tomorrow {
			for _, a := range t.both(dims{env, app, store, prod, country, DayOf(purchasedAt)}) {
				if paid {
					a.transactions++
					if usd != nil {
						a.revenue.add(*usd)
					} else {
						a.unconverted++
					}
				}
				if periodType == "trial" {
					a.newTrials++
				}
				if productType != "subscription" {
					a.nonsubCount++
					if paid && usd != nil {
						a.nonsubRevenue.add(*usd)
					}
				}
			}
		}
		if revokedAt != nil && *revokedAt >= fromDay && *revokedAt < tomorrow && upgraded == 0 && paid {
			for _, a := range t.both(dims{env, app, store, prod, country, DayOf(*revokedAt)}) {
				a.refunds++
				if usd != nil {
					a.refundAmount.add(*usd)
				}
			}
		}
		return nil
	})
	return err
}
