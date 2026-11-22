package metrics

// Reading charts: lite/src/metrics.ts readChart, readStatus and chartCsv, with the same arithmetic
// (JavaScript numbers, added in the same order), so the JSON and CSV match Lite's byte for byte.

import (
	"context"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/openpurr/openpurr/standard/internal/countries"
	"github.com/openpurr/openpurr/standard/internal/fx"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
)

// Series is one line or bar series of a chart.
type Series struct{ Key, Label string }

// values are a period's stored metrics: m[metric] (for running totals, the value at the end of
// the period) and m["metric@start"] (just before it).
type values map[string]float64

// get is Lite's `m.x ?? 0`.
func (m values) get(k string) float64 { return m[k] }

// Chart is one chart's definition.
type Chart struct {
	ID    string
	Label string
	// usd, count or percent.
	Unit string
	// running: a value at a point in time (the end of each period); flow: a total per period;
	// breakdown: the current state, by category (no time axis).
	Kind    string
	Flow    []string
	Running []string
	Series  []Series
	compute func(m values) *jsobj.Object
	// Customers aren't tied to an app, store, product or country.
	Global      bool
	Description string
}

func round2(n float64) float64 { return fx.JSRound(n*100) / 100 }

// pct is Lite's pct: a share in percent with one decimal, or null.
func pct(part, whole float64) any {
	if whole > 0 {
		return fx.JSRound(part/whole*1000) / 10
	}
	return nil
}

func paying(m values, at string) float64 { return m.get("active_subs"+at) - m.get("active_trials"+at) }

// Charts are Lite's CHARTS, in its order.
var Charts = []*Chart{
	{
		ID: "revenue", Label: "Revenue", Unit: "usd", Kind: "flow",
		Flow:   []string{"revenue", "refund_amount", "unconverted"},
		Series: []Series{{"net", "Revenue"}, {"refunds", "Refunded"}},
		compute: func(m values) *jsobj.Object {
			return jsobj.New("net", round2(m.get("revenue")-m.get("refund_amount")), "refunds", round2(m.get("refund_amount")), "gross", round2(m.get("revenue")))
		},
		Description: "Purchases and renewals by purchase date, minus refunds by refund date. In USD at each purchase date's exchange rate.",
	},
	{
		ID: "mrr", Label: "MRR", Unit: "usd", Kind: "running",
		Running:     []string{"mrr"},
		Series:      []Series{{"mrr", "MRR"}},
		compute:     func(m values) *jsobj.Object { return jsobj.New("mrr", round2(m.get("mrr"))) },
		Description: "Monthly recurring revenue: every active paid subscription's price, normalized to a month. Trials don't count.",
	},
	{
		ID: "arr", Label: "ARR", Unit: "usd", Kind: "running",
		Running:     []string{"mrr"},
		Series:      []Series{{"arr", "ARR"}},
		compute:     func(m values) *jsobj.Object { return jsobj.New("arr", round2(m.get("mrr")*12)) },
		Description: "Annual recurring revenue: MRR × 12.",
	},
	{
		ID: "mrr_movement", Label: "MRR movement", Unit: "usd", Kind: "flow",
		Flow:   []string{"mrr_new", "mrr_reactivation", "mrr_expansion", "mrr_contraction", "mrr_churned"},
		Series: []Series{{"new", "New"}, {"reactivation", "Reactivation"}, {"expansion", "Expansion"}, {"contraction", "Contraction"}, {"churned", "Churned"}},
		compute: func(m values) *jsobj.Object {
			n, r, e, c, ch := round2(m.get("mrr_new")), round2(m.get("mrr_reactivation")), round2(m.get("mrr_expansion")),
				round2(m.get("mrr_contraction")), round2(m.get("mrr_churned"))
			return jsobj.New("new", n, "reactivation", r, "expansion", e, "contraction", c, "churned", ch, "net", round2(n+r+e+c+ch))
		},
		Description: "How MRR changed in each period: new and reactivated subscriptions, upgrades and downgrades at renewal, and churn. Renewals at the same price aren't movement; exchange-rate drift on renewals isn't counted.",
	},
	{
		ID: "active_subscriptions", Label: "Active subscriptions", Unit: "count", Kind: "running",
		Running: []string{"active_subs", "active_trials"},
		Series:  []Series{{"paid", "Paying"}, {"trials", "Trials"}},
		compute: func(m values) *jsobj.Object {
			return jsobj.New("paid", paying(m, ""), "trials", m.get("active_trials"))
		},
		Description: "Subscriptions giving access at the end of each period, including trials, intro offers and grace periods.",
	},
	{
		ID: "subscription_movement", Label: "Subscription movement", Unit: "count", Kind: "flow",
		Flow:   []string{"sub_new", "sub_reactivated", "sub_churned", "sub_renewed"},
		Series: []Series{{"new", "New"}, {"reactivated", "Reactivated"}, {"churned", "Churned"}},
		compute: func(m values) *jsobj.Object {
			n, r, c := m.get("sub_new"), m.get("sub_reactivated"), -m.get("sub_churned")
			return jsobj.New("new", n, "reactivated", r, "churned", c, "net", n+r+c, "renewed", m.get("sub_renewed"))
		},
		Description: "Paying subscriptions gained and lost in each period. New includes trials converting; renewals don't change the count and are shown for reference.",
	},
	{
		ID: "paid_subscriptions", Label: "Paid subscriptions", Unit: "count", Kind: "running",
		Running:     []string{"paid_subs"},
		Series:      []Series{{"paid", "Paid subscriptions"}},
		compute:     func(m values) *jsobj.Object { return jsobj.New("paid", m.get("paid_subs")) },
		Description: "Active subscriptions at full price: no trials or intro offers.",
	},
	{
		ID: "churn", Label: "Churn", Unit: "percent", Kind: "flow",
		Flow:    []string{"sub_churned"},
		Running: []string{"active_subs", "active_trials"},
		Series:  []Series{{"rate", "Churn rate"}},
		compute: func(m values) *jsobj.Object {
			return jsobj.New("rate", pct(m.get("sub_churned"), paying(m, "@start")), "churned", m.get("sub_churned"), "paying_at_start", paying(m, "@start"))
		},
		Description: "Paying subscriptions that ended in each period, as a share of those active when it began. A subscription counts as churned when its access ends: after a grace period, not at the first billing failure.",
	},
	{
		ID: "active_trials", Label: "Active trials", Unit: "count", Kind: "running",
		Running:     []string{"active_trials"},
		Series:      []Series{{"trials", "Active trials"}},
		compute:     func(m values) *jsobj.Object { return jsobj.New("trials", m.get("active_trials")) },
		Description: "Free trials in progress at the end of each period.",
	},
	{
		ID: "new_trials", Label: "New trials", Unit: "count", Kind: "flow",
		Flow:        []string{"new_trials"},
		Series:      []Series{{"trials", "New trials"}},
		compute:     func(m values) *jsobj.Object { return jsobj.New("trials", m.get("new_trials")) },
		Description: "Free trials started in each period.",
	},
	{
		ID: "trial_movement", Label: "Trial movement", Unit: "count", Kind: "flow",
		Flow:   []string{"new_trials", "trial_converted", "trial_expired", "trial_cancelled"},
		Series: []Series{{"new", "Started"}, {"converted", "Converted"}, {"expired", "Expired"}},
		compute: func(m values) *jsobj.Object {
			tc, te := m.get("trial_converted"), m.get("trial_expired")
			return jsobj.New("new", m.get("new_trials"), "converted", -tc, "expired", -te, "cancelled", m.get("trial_cancelled"),
				"conversion_rate", pct(tc, tc+te))
		},
		Description: "Trials started, and trials that ended by converting to a paid subscription or expiring. Cancelled counts trials where auto-renew was turned off (most then expire).",
	},
	{
		ID: "new_customers", Label: "New customers", Unit: "count", Kind: "flow",
		Flow:        []string{"new_customers"},
		Series:      []Series{{"customers", "New customers"}},
		compute:     func(m values) *jsobj.Object { return jsobj.New("customers", m.get("new_customers")) },
		Global:      true,
		Description: "Customers first seen in each period, across all of a project's apps.",
	},
	{
		ID: "refunds", Label: "Refunds", Unit: "count", Kind: "flow",
		Flow:   []string{"refunds", "refund_amount"},
		Series: []Series{{"refunds", "Refunds"}},
		compute: func(m values) *jsobj.Object {
			return jsobj.New("refunds", m.get("refunds"), "amount", round2(m.get("refund_amount")))
		},
		Description: "Purchases refunded in each period, by refund date. The amount is in USD.",
	},
	{
		ID: "refund_rate", Label: "Refund rate", Unit: "percent", Kind: "flow",
		Flow:   []string{"refunds", "transactions", "refund_amount", "revenue"},
		Series: []Series{{"rate", "Refund rate"}},
		compute: func(m values) *jsobj.Object {
			return jsobj.New("rate", pct(m.get("refunds"), m.get("transactions")), "amount_rate", pct(m.get("refund_amount"), m.get("revenue")),
				"refunds", m.get("refunds"), "transactions", m.get("transactions"))
		},
		Description: "Refunds in each period as a share of paid transactions in it (and refunded amount as a share of revenue).",
	},
	{
		ID: "non_subscription_purchases", Label: "Non-subscription purchases", Unit: "count", Kind: "flow",
		Flow:   []string{"nonsub_count", "nonsub_revenue"},
		Series: []Series{{"purchases", "Purchases"}},
		compute: func(m values) *jsobj.Object {
			return jsobj.New("purchases", m.get("nonsub_count"), "revenue", round2(m.get("nonsub_revenue")))
		},
		Description: "One-time purchases (consumables and non-consumables) in each period. Revenue is in USD.",
	},
	{
		ID: "subscription_status", Label: "Subscription status", Unit: "count", Kind: "breakdown",
		Series:      []Series{{"count", "Subscriptions"}},
		Description: "Every subscription by where it stands now. Expired counts those that ended in the last " + strconv.Itoa(StatusRecentDays) + " days.",
	},
}

// ChartByID finds a chart (nil if there's none by that ID).
func ChartByID(id string) *Chart {
	for _, c := range Charts {
		if c.ID == id {
			return c
		}
	}
	return nil
}

func seriesJSON(list []Series) []any {
	out := make([]any, len(list))
	for i, s := range list {
		out[i] = jsobj.New("key", s.Key, "label", s.Label)
	}
	return out
}

// ChartList is GET /admin/v1/metrics's charts.
func ChartList() []any {
	out := make([]any, len(Charts))
	for i, c := range Charts {
		out[i] = jsobj.New("id", c.ID, "label", c.Label, "description", c.Description, "unit", c.Unit, "kind", c.Kind, "series", seriesJSON(c.Series))
	}
	return out
}

// Query is what a chart covers.
type Query struct {
	// YYYY-MM-DD, as given (Date.parse reads them; V8 accepts day 31 of any month).
	From, To string
	// day, week or month.
	Interval string
	// production or sandbox.
	Environment string
	// Filters ("" for none).
	Store, App, Product string
	// Standard only: ISO 3166-1 alpha-2, from metric_daily_country.
	Country string
	// Apps the operator may see; nil = all.
	Apps []string
	// One project: its ID (for new_customers) and its apps (for everything else).
	Project *Project
}

// Project limits a chart to one project.
type Project struct {
	ID   string
	Apps []string
}

// Point is one period.
type Point struct {
	Date   string
	Values *jsobj.Object
}

// Category is one status of the breakdown.
type Category struct {
	Key, Label string
	Value      float64
}

// ChartResult is a chart as the API serves it.
type ChartResult struct {
	Chart      *Chart
	Interval   string
	From, To   string
	Points     []Point
	Categories []Category // breakdown charts only
	Notes      []string
	UpdatedAt  *int64
}

// JSON is Lite's ChartResult.
func (r *ChartResult) JSON() *jsobj.Object {
	points := make([]any, len(r.Points))
	for i, p := range r.Points {
		points[i] = jsobj.New("date", p.Date, "values", p.Values)
	}
	o := jsobj.New("chart", r.Chart.ID, "label", r.Chart.Label, "description", r.Chart.Description, "unit", r.Chart.Unit,
		"kind", r.Chart.Kind, "interval", r.Interval, "from", r.From, "to", r.To, "series", seriesJSON(r.Chart.Series), "points", points)
	if r.Categories != nil {
		cats := make([]any, len(r.Categories))
		for i, c := range r.Categories {
			cats[i] = jsobj.New("key", c.Key, "label", c.Label, "value", c.Value)
		}
		o.Set("categories", cats)
	}
	notes := make([]any, len(r.Notes))
	for i, n := range r.Notes {
		notes[i] = n
	}
	o.Set("notes", notes)
	var updated any
	if r.UpdatedAt != nil {
		updated = float64(*r.UpdatedAt)
	}
	o.Set("updated_at", updated)
	return o
}

// CSV is Lite's chartCsv: one row per period (or category), one column per value.
func (r *ChartResult) CSV() string {
	var b strings.Builder
	if r.Categories != nil {
		b.WriteString("status,label,count\n")
		for i, c := range r.Categories {
			if i > 0 {
				b.WriteByte('\n')
			}
			b.WriteString(c.Key + `,"` + c.Label + `",` + jsobj.FormatNumber(c.Value))
		}
		b.WriteByte('\n')
		return b.String()
	}
	var keys []string
	seen := map[string]bool{}
	for _, p := range r.Points {
		for _, k := range p.Values.Keys() {
			if !seen[k] {
				seen[k] = true
				keys = append(keys, k)
			}
		}
	}
	b.WriteString(strings.Join(append([]string{"date"}, keys...), ","))
	for _, p := range r.Points {
		b.WriteByte('\n')
		b.WriteString(p.Date)
		for _, k := range keys {
			b.WriteByte(',')
			if v, ok := p.Values.Get(k); ok && v != nil {
				b.WriteString(jsobj.String(v, true))
			}
		}
	}
	b.WriteByte('\n')
	return b.String()
}

// ParseDate is V8's Date.parse for "YYYY-MM-DD" (UTC midnight; day 31 of any month rolls over),
// or false.
func ParseDate(s string) (int64, bool) {
	if len(s) != 10 || s[4] != '-' || s[7] != '-' {
		return 0, false
	}
	y, err1 := strconv.Atoi(s[:4])
	m, err2 := strconv.Atoi(s[5:7])
	d, err3 := strconv.Atoi(s[8:])
	if err1 != nil || err2 != nil || err3 != nil || s[0] == '+' || s[0] == '-' || s[5] == '+' || s[5] == '-' || s[8] == '+' || s[8] == '-' {
		return 0, false
	}
	if m < 1 || m > 12 || d < 1 || d > 31 {
		return 0, false
	}
	return time.Date(y, time.Month(m), d, 0, 0, 0, 0, time.UTC).UnixMilli(), true
}

// PeriodStart is the first day of the period containing date (weeks start on Monday).
func PeriodStart(date, interval string) string {
	switch interval {
	case "day":
		return date
	case "month":
		return date[:7] + "-01"
	}
	t, _ := ParseDate(date)
	wd := time.UnixMilli(t).UTC().Weekday()
	return DayOf(t - int64((int(wd)+6)%7)*Day)
}

// where is the WHERE clauses for the dimensions: environment, the apps the operator may see, and
// the filters. Arguments start at $first.
type where struct {
	clauses []string
	args    []any
}

func (w *where) add(clause string, arg any) {
	w.args = append(w.args, arg)
	w.clauses = append(w.clauses, strings.ReplaceAll(clause, "$?", "$"+strconv.Itoa(len(w.args))))
}

func (w *where) sql() string { return strings.Join(w.clauses, " AND ") }

type columns struct{ app, store, product, environment string }

func dimensions(q *Query, w *where, cols columns, countryTable bool) {
	w.add(cols.environment+" = $?", q.Environment)
	if q.Apps != nil {
		// SQLite's "IN ()" matches nothing.
		w.add(cols.app+" = ANY($?)", append([]string{}, q.Apps...))
	}
	// A project without apps matches nothing ('' is never an app ID of a ledger row).
	if q.Project != nil {
		apps := q.Project.Apps
		if len(apps) == 0 {
			apps = []string{""}
		}
		w.add(cols.app+" = ANY($?)", apps)
	}
	if q.App != "" {
		w.add(cols.app+" = $?", q.App)
	}
	if q.Store != "" {
		w.add(cols.store+" = $?", q.Store)
	}
	if q.Product != "" {
		w.add(cols.product+" = $?", q.Product)
	}
	if countryTable {
		w.add("country = $?", q.Country)
	}
}

// ReadChart reads a chart, or nil if there's no chart by that ID.
func ReadChart(ctx context.Context, db Querier, id string, q Query, now int64) (*ChartResult, error) {
	def := ChartByID(id)
	if def == nil {
		return nil, nil
	}
	updatedAt, err := LastRollupAt(ctx, db)
	if err != nil {
		return nil, err
	}
	res := &ChartResult{Chart: def, Interval: q.Interval, From: q.From, To: q.To, Points: []Point{}, Notes: []string{}, UpdatedAt: updatedAt}

	if def.Kind == "breakdown" {
		res.Categories, err = readStatus(ctx, db, &q, now)
		return res, err
	}

	if def.Global && (q.Apps != nil || q.App != "" || q.Store != "" || q.Product != "" || q.Country != "") {
		if q.Apps != nil {
			res.Notes = append(res.Notes, "Customers aren't tied to an app, so this chart is only for operators with access to all apps.")
			return res, nil
		}
		if q.Country != "" {
			res.Notes = append(res.Notes, "New customers aren't tied to an app, store, product or country, so this chart ignores those filters.")
		} else {
			res.Notes = append(res.Notes, "New customers aren't tied to an app, store or product, so this chart ignores those filters.")
		}
	}

	// $1 and $2 are each read's metrics and the last day.
	table := "metric_daily"
	w := &where{args: []any{nil, q.To}}
	if def.Global {
		w.clauses = append(w.clauses, "environment = ''")
		if q.Project != nil {
			w.add("project_id = $?", q.Project.ID)
		}
	} else {
		if q.Country != "" {
			table = "metric_daily_country"
		}
		dimensions(&q, w, columns{"app_id", "store", "product_id", "environment"}, q.Country != "")
	}

	// Per-period totals need only the range; running totals need every earlier change. Rows are
	// summed per metric and day as SQLite's sum() does, in (metric, date) order as SQLite returns them.
	type dayRow struct {
		metric, date string
		value        float64
	}
	var rows []dayRow
	read := func(metrics []string, fromDate string) error {
		args := append([]any{}, w.args...)
		args[0] = metrics
		sql := `SELECT metric, date, value FROM ` + table + ` WHERE metric = ANY($1) AND date <= $2 AND ` + w.sql()
		if fromDate != "" {
			args = append(args, fromDate)
			sql += " AND date >= $" + strconv.Itoa(len(args))
		}
		sql += " ORDER BY metric, date"
		r, err := db.Query(ctx, sql, args...)
		if err != nil {
			return err
		}
		var metric, date string
		var v float64
		var cur *dayRow
		var sum kbnSum
		_, err = pgx.ForEachRow(r, []any{&metric, &date, &v}, func() error {
			if cur == nil || cur.metric != metric || cur.date != date {
				if cur != nil {
					cur.value = sum.value()
					rows = append(rows, *cur)
				}
				cur, sum = &dayRow{metric: metric, date: date}, kbnSum{}
			}
			sum.add(v)
			return nil
		})
		if err != nil {
			return err
		}
		if cur != nil {
			cur.value = sum.value()
			rows = append(rows, *cur)
		}
		return nil
	}
	if len(def.Flow) > 0 {
		if err := read(def.Flow, q.From); err != nil {
			return nil, err
		}
	}
	if len(def.Running) > 0 {
		if err := read(def.Running, ""); err != nil {
			return nil, err
		}
	}

	byDay := map[string]values{}
	var dayOrder []string
	total := values{}
	for _, r := range rows {
		if r.date < q.From {
			total[r.metric] += r.value // running totals before the range
			continue
		}
		day := byDay[r.date]
		if day == nil {
			day = values{}
			byDay[r.date] = day
			dayOrder = append(dayOrder, r.date)
		}
		day[r.metric] += r.value
	}

	type period struct {
		key string
		m   values
	}
	var periods []*period
	index := map[string]*period{}
	from, _ := ParseDate(q.From)
	to, _ := ParseDate(q.To)
	for t := from; t <= to; t += Day {
		date := DayOf(t)
		day := byDay[date]
		key := PeriodStart(date, q.Interval)
		acc := index[key]
		if acc == nil {
			acc = &period{key: key, m: values{}}
			for _, m := range def.Running {
				acc.m[m+"@start"] = total[m]
			}
			index[key] = acc
			periods = append(periods, acc)
		}
		for _, m := range def.Flow {
			acc.m[m] += day[m]
		}
		for _, m := range def.Running {
			total[m] += day[m]
			acc.m[m] = total[m] // the last day of the period wins
		}
	}

	unconverted := 0.0
	for _, d := range dayOrder {
		unconverted += byDay[d]["unconverted"]
	}
	if unconverted != 0 {
		s := " is"
		if unconverted != 1 {
			s = "s are"
		}
		res.Notes = append(res.Notes, jsobj.FormatNumber(unconverted)+" purchase"+s+" in currencies without an exchange rate and aren't in the USD totals.")
	}
	for _, p := range periods {
		res.Points = append(res.Points, Point{Date: p.key, Values: def.compute(p.m)})
	}
	return res, nil
}

// Statuses are the breakdown's categories, in a fixed order. The dashboard translates the labels
// by their English text, so the number stays a literal.
var Statuses = []Series{
	{"active", "Active, renewing"},
	{"cancelled", "Active, won't renew"},
	{"trial", "In a free trial"},
	{"grace", "Grace period"},
	{"billing_retry", "Billing retry"},
	{"paused", "Paused"},
	{"expired", "Expired (last 30 days)"},
}

// storefronts are the storefront values of a country: Google's alpha-2 code, Apple's alpha-3
// codes (in any case).
func storefronts(alpha2 string) (apple []string) {
	for _, a3 := range countries.Alpha3Codes() {
		if countries.Alpha2FromAlpha3(a3) == alpha2 {
			apple = append(apple, a3)
		}
	}
	return apple
}

// readStatus is where every subscription stands now: its latest purchase, and the store's renewal
// state. Live from the ledger, through the expiry index: proportional to current subscribers.
func readStatus(ctx context.Context, db Querier, q *Query, now int64) ([]Category, error) {
	w := &where{args: []any{now, now - StatusRecentDays*Day}}
	dimensions(q, w, columns{"t.app_id", "t.store", "t.product_id || coalesce(':' || t.base_plan_id, '')", "t.environment"}, false)
	if q.Country != "" {
		w.args = append(w.args, storefronts(q.Country), q.Country)
		n := len(w.args)
		w.clauses = append(w.clauses, "CASE WHEN t.store = 'app_store' THEN upper(t.storefront) = ANY($"+strconv.Itoa(n-1)+
			") ELSE upper(t.storefront) = $"+strconv.Itoa(n)+" END")
	}
	rows, err := db.Query(ctx,
		`SELECT CASE
		   WHEN t.revoked_at IS NOT NULL AND t.revoked_at <= $1 THEN 'expired'
		   WHEN t.expires_at > $1 AND t.period_type = 'trial' THEN 'trial'
		   WHEN t.expires_at > $1 AND s.auto_renew = 0 THEN 'cancelled'
		   WHEN t.expires_at > $1 THEN 'active'
		   WHEN s.grace_period_expires_at > $1 THEN 'grace'
		   WHEN s.status = 3 THEN 'billing_retry'
		   WHEN s.auto_resume_at IS NOT NULL THEN 'paused'
		   ELSE 'expired' END AS category, count(*)
		 FROM store_transaction t
		 LEFT JOIN subscription_state s ON s.store = t.store AND s.original_transaction_id = t.original_transaction_id
		 WHERE t.product_type = 'subscription' AND t.expires_at >= $2
		   AND NOT EXISTS (SELECT 1 FROM store_transaction n
		                   WHERE n.store = t.store AND n.original_transaction_id = t.original_transaction_id
		                     AND (n.purchased_at > t.purchased_at OR (n.purchased_at = t.purchased_at AND n.id > t.id)))
		   AND `+w.sql()+`
		 GROUP BY category`, w.args...)
	if err != nil {
		return nil, err
	}
	counts := map[string]int64{}
	var cat string
	var n int64
	if _, err := pgx.ForEachRow(rows, []any{&cat, &n}, func() error {
		counts[cat] = n
		return nil
	}); err != nil {
		return nil, err
	}
	out := make([]Category, len(Statuses))
	for i, s := range Statuses {
		out[i] = Category{Key: s.Key, Label: s.Label, Value: float64(counts[s.Key])}
	}
	return out, nil
}

// Countries lists the countries with chart data (for the country filter's choices), in order.
func Countries(ctx context.Context, db Querier) ([]string, error) {
	rows, err := db.Query(ctx,
		`WITH RECURSIVE c AS (
		   (SELECT country FROM metric_daily_country ORDER BY country LIMIT 1)
		   UNION ALL
		   SELECT (SELECT m.country FROM metric_daily_country m WHERE m.country > c.country ORDER BY m.country LIMIT 1)
		   FROM c WHERE c.country IS NOT NULL)
		 SELECT country FROM c WHERE country IS NOT NULL AND country <> ''`)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	sort.Strings(list)
	return list, nil
}
