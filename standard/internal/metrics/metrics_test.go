package metrics_test

// Charts reconcile with a hand-checked ledger, and the hourly incremental rollup agrees with a
// full rebuild. Mirrors lite/test/metrics.test.ts (the same ledger is in the golden file too,
// where every stored row is compared with Lite's), plus the Standard-only country totals.

import (
	"context"
	"fmt"
	"math"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/metrics"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

func at(date string, hour ...int) int64 {
	h := 12
	if len(hour) > 0 {
		h = hour[0]
	}
	t, err := time.Parse("2006-01-02 15", fmt.Sprintf("%s %02d", date, h))
	if err != nil {
		panic(err)
	}
	return t.UnixMilli()
}

type ledgerTx struct {
	chain, bought, expires string
	price                  float64
	noPrice                bool
	currency, period, typ  string
	revoked                string
	updatedAt              int64
	store, app, env, prod  string
	storefront             string
}

type ledger struct {
	t    *testing.T
	pool *pgxpool.Pool
	seq  int
}

func (l *ledger) tx(x ledgerTx) {
	l.t.Helper()
	l.seq++
	or := func(v, def string) string {
		if v == "" {
			return def
		}
		return v
	}
	var expires, revoked, price, storefront any
	if x.expires != "" {
		expires = at(x.expires)
	}
	if x.revoked != "" {
		revoked = at(x.revoked)
	}
	if !x.noPrice {
		price = int64(math.Round(x.price * 1e6))
	}
	if x.storefront != "" {
		storefront = x.storefront
	}
	updated := x.updatedAt
	if updated == 0 {
		updated = at("2026-03-01")
	}
	exec(l.t, l.pool, `INSERT INTO store_transaction (app_id, store, environment, transaction_id, original_transaction_id, product_id, product_type,
		purchased_at, original_purchased_at, expires_at, period_type, price_micros, currency, storefront, revoked_at, verified, source, received_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11, $12, $13, $14, 1, 'sdk', $15, $15)`,
		or(x.app, "ios"), or(x.store, "app_store"), or(x.env, "production"), fmt.Sprintf("tx-%d", l.seq), x.chain, or(x.prod, "p"),
		or(x.typ, "subscription"), at(x.bought), expires, or(x.period, "normal"), price, or(x.currency, "USD"), storefront, revoked, updated)
}

func handLedger(t *testing.T) (*pgxpool.Pool, *ledger) {
	pool := tu.Pool(t)
	l := &ledger{t: t, pool: pool}
	exec(t, pool, "INSERT INTO fx_rate (date, currency, per_usd, source) VALUES ('2025-12-31', 'EUR', 0.9, 'test')")
	exec(t, pool, "INSERT INTO customer (id, app_user_id, first_seen) VALUES ('m1', 'm1', $1), ('m2', 'm2', $2), ('m3', 'm3', $3)",
		at("2026-01-01"), at("2026-01-05"), at("2026-01-10"))
	// A: a 7-day trial, then monthly at $10, renewed twice; still active. Bought in Germany.
	l.tx(ledgerTx{chain: "A", bought: "2026-01-01", expires: "2026-01-08", price: 0, period: "trial", storefront: "DEU"})
	l.tx(ledgerTx{chain: "A", bought: "2026-01-08", expires: "2026-02-08", price: 10, storefront: "DEU"})
	l.tx(ledgerTx{chain: "A", bought: "2026-02-08", expires: "2026-03-08", price: 10, storefront: "DEU"})
	l.tx(ledgerTx{chain: "A", bought: "2026-03-08", expires: "2026-04-08", price: 10, storefront: "DEU"})
	// B: yearly at €90 (= $100 at 0.9 EUR per USD), refunded on Feb 1. In the US.
	l.tx(ledgerTx{chain: "B", bought: "2026-01-10", expires: "2027-01-10", price: 90, currency: "EUR", revoked: "2026-02-01", storefront: "USA"})
	// C: monthly at $10, not renewed; the billing grace period runs to Feb 12. In the US.
	l.tx(ledgerTx{chain: "C", bought: "2026-01-05", expires: "2026-02-05", price: 10, storefront: "usa"})
	exec(t, pool, `INSERT INTO subscription_state (store, original_transaction_id, status, auto_renew, grace_period_expires_at, signed_at, updated_at)
		VALUES ('app_store', 'C', 2, 0, $1, $1, $2)`, at("2026-02-12"), at("2026-03-01"))
	// D: a lifetime unlock at $20. E: a purchase in a currency with no exchange rate.
	l.tx(ledgerTx{chain: "D", bought: "2026-01-20", price: 20, typ: "non_consumable"})
	l.tx(ledgerTx{chain: "E", bought: "2026-01-25", price: 5, currency: "SAR", typ: "consumable"})
	if _, err := metrics.Rollup(context.Background(), pool, now, false); err != nil {
		t.Fatal(err)
	}
	return pool, l
}

var now = at("2026-03-15")

func q(over func(*metrics.Query)) metrics.Query {
	query := metrics.Query{From: "2026-01-01", To: "2026-03-15", Interval: "day", Environment: "production"}
	if over != nil {
		over(&query)
	}
	return query
}

func read(t *testing.T, pool *pgxpool.Pool, chart string, query metrics.Query) *metrics.ChartResult {
	t.Helper()
	r, err := metrics.ReadChart(context.Background(), pool, chart, query, at("2026-04-20"))
	if err != nil || r == nil {
		t.Fatalf("%s: %v", chart, err)
	}
	return r
}

func value(t *testing.T, pool *pgxpool.Pool, chart, date, key string, over func(*metrics.Query)) any {
	t.Helper()
	for _, p := range read(t, pool, chart, q(over)).Points {
		if p.Date == date {
			v, _ := p.Values.Get(key)
			return v
		}
	}
	return "missing"
}

func expectValue(t *testing.T, pool *pgxpool.Pool, chart, date, key string, want float64, over func(*metrics.Query)) {
	t.Helper()
	if got := value(t, pool, chart, date, key, over); got != want {
		t.Errorf("%s %s %s: got %v, want %v", chart, date, key, got, want)
	}
}

func byPeriod(r *metrics.ChartResult) map[string]string {
	out := map[string]string{}
	for _, p := range r.Points {
		out[p.Date] = jsobj.Stringify(p.Values)
	}
	return out
}

func TestHandCheckedLedger(t *testing.T) {
	pool, l := handLedger(t)
	ctx := context.Background()

	t.Run("active subscriptions, trials and paid subscriptions at the end of each day", func(t *testing.T) {
		expectValue(t, pool, "active_subscriptions", "2026-01-03", "trials", 1, nil) // A's trial
		expectValue(t, pool, "active_subscriptions", "2026-01-07", "paid", 1, nil)   // C
		expectValue(t, pool, "active_subscriptions", "2026-01-31", "paid", 3, nil)   // A, B, C
		expectValue(t, pool, "active_subscriptions", "2026-01-31", "trials", 0, nil)
		expectValue(t, pool, "active_subscriptions", "2026-02-01", "paid", 2, nil) // B refunded
		expectValue(t, pool, "active_subscriptions", "2026-02-11", "paid", 2, nil) // C in its grace period
		expectValue(t, pool, "active_subscriptions", "2026-02-12", "paid", 1, nil) // C's grace period over
		expectValue(t, pool, "active_subscriptions", "2026-03-15", "paid", 1, nil) // A, renewals don't double-count
		expectValue(t, pool, "paid_subscriptions", "2026-01-31", "paid", 3, nil)
		expectValue(t, pool, "active_trials", "2026-01-08", "trials", 0, nil)
	})

	t.Run("MRR normalizes yearly prices to a month, in USD", func(t *testing.T) {
		expectValue(t, pool, "mrr", "2026-01-31", "mrr", 28.33, nil) // 10 + 100/12 + 10
		expectValue(t, pool, "mrr", "2026-02-01", "mrr", 20, nil)
		expectValue(t, pool, "mrr", "2026-03-15", "mrr", 10, nil)
		expectValue(t, pool, "arr", "2026-03-15", "arr", 120, nil)
	})

	month := func(q *metrics.Query) { q.Interval = "month" }
	t.Run("revenue by month: purchases by purchase date, refunds by refund date", func(t *testing.T) {
		r := read(t, pool, "revenue", q(month))
		got := byPeriod(r)
		if got["2026-01-01"] != `{"net":140,"refunds":0,"gross":140}` || got["2026-02-01"] != `{"net":-90,"refunds":100,"gross":10}` ||
			got["2026-03-01"] != `{"net":10,"refunds":0,"gross":10}` {
			t.Errorf("%v", got)
		}
		if !slices.Equal(r.Notes, []string{"1 purchase is in currencies without an exchange rate and aren't in the USD totals."}) {
			t.Errorf("%v", r.Notes)
		}
	})

	t.Run("new trials, refunds, one-time purchases and new customers", func(t *testing.T) {
		for chart, want := range map[string][2]string{
			"new_trials":                 {"2026-01-01", `{"trials":1}`},
			"refunds":                    {"2026-02-01", `{"refunds":1,"amount":100}`},
			"non_subscription_purchases": {"2026-01-01", `{"purchases":2,"revenue":20}`},
			"new_customers":              {"2026-01-01", `{"customers":3}`},
		} {
			if got := byPeriod(read(t, pool, chart, q(month)))[want[0]]; got != want[1] {
				t.Errorf("%s: %s", chart, got)
			}
		}
	})

	t.Run("weeks start on Monday; a running total takes the period's last day", func(t *testing.T) {
		if metrics.PeriodStart("2026-01-04", "week") != "2025-12-29" || metrics.PeriodStart("2026-01-05", "week") != "2026-01-05" {
			t.Error("week start")
		}
		expectValue(t, pool, "active_subscriptions", "2026-01-26", "paid", 2, func(q *metrics.Query) { q.Interval = "week" }) // Sunday Feb 1: A and C
	})

	t.Run("filters by store and app, and limits app-restricted operators", func(t *testing.T) {
		expectValue(t, pool, "active_subscriptions", "2026-01-31", "paid", 0, func(q *metrics.Query) { q.Store = "play_store" })
		expectValue(t, pool, "active_subscriptions", "2026-01-31", "paid", 0, func(q *metrics.Query) { q.Apps = []string{"android"} })
		limited := read(t, pool, "new_customers", q(func(q *metrics.Query) { q.Apps = []string{"ios"} }))
		if len(limited.Points) != 0 {
			t.Errorf("%v", limited.Points)
		}
	})

	t.Run("filters by country (Standard): storefronts in either case, totals that add up", func(t *testing.T) {
		de := func(q *metrics.Query) { q.Country = "DE" }
		us := func(q *metrics.Query) { q.Country = "US" }
		expectValue(t, pool, "active_subscriptions", "2026-01-31", "paid", 1, de) // A
		expectValue(t, pool, "active_subscriptions", "2026-01-31", "paid", 2, us) // B and C
		expectValue(t, pool, "mrr", "2026-01-31", "mrr", 10, de)
		expectValue(t, pool, "mrr", "2026-01-31", "mrr", 18.33, us)
		expectValue(t, pool, "active_subscriptions", "2026-01-31", "paid", 0, func(q *metrics.Query) { q.Country = "FR" })
		if got := byPeriod(read(t, pool, "revenue", q(func(q *metrics.Query) { q.Interval = "month"; q.Country = "US" })))["2026-02-01"]; got != `{"net":-100,"refunds":100,"gross":0}` {
			t.Errorf("%s", got)
		}
		// D and E have no storefront: in neither country, and in the unfiltered totals.
		expectValue(t, pool, "non_subscription_purchases", "2026-01-01", "purchases", 0, func(q *metrics.Query) { q.Interval = "month"; q.Country = "US" })
		r := read(t, pool, "new_customers", q(func(q *metrics.Query) { q.Interval = "month"; q.Country = "US" }))
		if byPeriod(r)["2026-01-01"] != `{"customers":3}` || len(r.Notes) != 1 || r.Notes[0] != "New customers aren't tied to an app, store, product or country, so this chart ignores those filters." {
			t.Errorf("%v %v", byPeriod(r), r.Notes)
		}
		list, err := metrics.Countries(ctx, pool)
		if err != nil || !slices.Equal(list, []string{"DE", "US"}) {
			t.Errorf("%v %v", list, err)
		}
	})

	t.Run("the incremental rollup picks up new purchases and late refunds, matches a full rebuild, and writes little", func(t *testing.T) {
		later := now + 2*3600_000
		// A new subscription today, and A's February renewal refunded today.
		l.tx(ledgerTx{chain: "F", bought: "2026-03-15", expires: "2026-04-15", price: 10, updatedAt: later - 1000, storefront: "FRA"})
		exec(t, pool, "UPDATE store_transaction SET revoked_at = $1, updated_at = $1 WHERE original_transaction_id = 'A' AND purchased_at = $2", later-2000, at("2026-02-08"))

		run, err := metrics.Rollup(ctx, pool, later, false)
		if err != nil || run.Full || run.From == nil || *run.From != "2026-02-08" || run.Rows >= 150 {
			t.Fatalf("%+v %v", run, err)
		}
		snapshot := func() string {
			out := ""
			for _, c := range metrics.Charts {
				for _, country := range []string{"", "DE", "US", "FR"} {
					out += jsobj.Stringify(read(t, pool, c.ID, q(func(q *metrics.Query) { q.Country = country })).JSON().Clone()) + "\n"
				}
			}
			return out
		}
		incremental := snapshot()
		expectValue(t, pool, "active_subscriptions", "2026-03-15", "paid", 2, nil) // A and F
		expectValue(t, pool, "refunds", "2026-03-15", "refunds", 1, nil)
		expectValue(t, pool, "refunds", "2026-03-15", "refunds", 1, func(q *metrics.Query) { q.Country = "DE" })
		if _, err := metrics.Rollup(ctx, pool, later, true); err != nil {
			t.Fatal(err)
		}
		if got := snapshot(); got != incremental {
			t.Error("a full rebuild differs from the incremental run")
		}
	})

	t.Run("counts subscriptions that ran out since the last run, with no ledger change", func(t *testing.T) {
		// F expires on Apr 15; a run that day removes it without anything in the ledger changing.
		for _, c := range []struct {
			at   int64
			from string
		}{{at("2026-04-01"), ""}, {at("2026-04-14", 23), "2026-04-01"}, {at("2026-04-16", 1), "2026-04-14"}} {
			run, err := metrics.Rollup(ctx, pool, c.at, false)
			if err != nil || (c.from != "" && *run.From != c.from) {
				t.Fatalf("%+v %v", run, err)
			}
		}
		r := read(t, pool, "active_subscriptions", q(func(q *metrics.Query) { q.From, q.To = "2026-04-14", "2026-04-16" }))
		var paid []any
		for _, p := range r.Points {
			v, _ := p.Values.Get("paid")
			paid = append(paid, v)
		}
		if jsobj.Stringify(paid) != "[1,0,0]" { // F until Apr 15; A ran out on Apr 8
			t.Errorf("%v", paid)
		}
	})

	t.Run("never stores days after today", func(t *testing.T) {
		var n int
		if err := pool.QueryRow(ctx, "SELECT (SELECT count(*) FROM metric_daily WHERE date > '2026-04-16') + (SELECT count(*) FROM metric_daily_country WHERE date > '2026-04-16')").Scan(&n); err != nil || n != 0 {
			t.Errorf("%d %v", n, err)
		}
	})

	monthTo := func(q *metrics.Query) { q.Interval = "month"; q.To = "2026-03-31" }
	t.Run("phase 2: movements, churn and refund rates", func(t *testing.T) {
		for chart, want := range map[string]map[string]string{
			"subscription_movement": {
				"2026-01-01": `{"new":3,"reactivated":0,"churned":0,"net":3,"renewed":0}`,   // A converts, B and C start
				"2026-02-01": `{"new":0,"reactivated":0,"churned":-2,"net":-2,"renewed":1}`, // B refunded, C's grace ends; A renews
			},
			"mrr_movement": {
				"2026-01-01": `{"new":28.33,"reactivation":0,"expansion":0,"contraction":0,"churned":0,"net":28.33}`,
				"2026-02-01": `{"new":0,"reactivation":0,"expansion":0,"contraction":0,"churned":-18.33,"net":-18.33}`,
			},
			"trial_movement": {"2026-01-01": `{"new":1,"converted":-1,"expired":0,"cancelled":0,"conversion_rate":100}`},
			"churn": {
				"2026-02-01": `{"rate":66.7,"churned":2,"paying_at_start":3}`,
				"2026-01-01": `{"rate":null,"churned":0,"paying_at_start":0}`, // nobody paying when January began
			},
			"refund_rate": {
				"2026-02-01": `{"rate":100,"amount_rate":1000,"refunds":1,"transactions":1}`, // B refunded; A's renewal the only purchase
				"2026-01-01": `{"rate":0,"amount_rate":0,"refunds":0,"transactions":5}`,      // A, B, C, D and E (SAR)
			},
		} {
			got := byPeriod(read(t, pool, chart, q(monthTo)))
			for period, w := range want {
				if got[period] != w {
					t.Errorf("%s %s: %s", chart, period, got[period])
				}
			}
		}
	})

	t.Run("phase 2: reactivation, expansion, contraction, trials and status (a sandbox ledger)", func(t *testing.T) {
		sb := func(x ledgerTx) ledgerTx { x.env = "sandbox"; return x }
		// G: monthly, lapses for February, comes back in March (same chain): churn, then reactivation.
		l.tx(sb(ledgerTx{chain: "G", bought: "2026-01-01", expires: "2026-02-01", price: 10}))
		l.tx(sb(ledgerTx{chain: "G", bought: "2026-03-01", expires: "2026-04-01", price: 10}))
		// H: monthly at $10, renews at $12 (expansion +2), then switches to yearly at $60 (= $5/month: contraction -7).
		l.tx(sb(ledgerTx{chain: "H", bought: "2026-01-01", expires: "2026-02-01", price: 10, prod: "monthly"}))
		l.tx(sb(ledgerTx{chain: "H", bought: "2026-02-01", expires: "2026-03-01", price: 12, prod: "monthly"}))
		l.tx(sb(ledgerTx{chain: "H", bought: "2026-03-01", expires: "2027-03-01", price: 60, prod: "yearly"}))
		// I: a trial, auto-renew turned off on day 2, then it expires.
		l.tx(sb(ledgerTx{chain: "I", bought: "2026-01-10", expires: "2026-01-17", price: 0, period: "trial"}))
		// For the status breakdown on Mar 15: J ended Mar 10, K won't renew, L is in a grace period.
		l.tx(sb(ledgerTx{chain: "J", bought: "2026-02-10", expires: "2026-03-10", price: 10}))
		l.tx(sb(ledgerTx{chain: "K", bought: "2026-03-05", expires: "2026-04-05", price: 10}))
		l.tx(sb(ledgerTx{chain: "L", bought: "2026-02-12", expires: "2026-03-12", price: 10}))
		exec(t, pool, "INSERT INTO subscription_state (store, original_transaction_id, status, auto_renew, unsubscribe_detected_at, signed_at, updated_at) VALUES ('app_store', 'I', 2, 0, $1, 0, 0)", at("2026-01-12"))
		exec(t, pool, "INSERT INTO subscription_state (store, original_transaction_id, status, auto_renew, signed_at, updated_at) VALUES ('app_store', 'K', 1, 0, 0, 0)")
		exec(t, pool, "INSERT INTO subscription_state (store, original_transaction_id, status, auto_renew, grace_period_expires_at, signed_at, updated_at) VALUES ('app_store', 'L', 4, 1, $1, 0, 0)", at("2026-03-20"))
		if _, err := metrics.Rollup(ctx, pool, at("2026-04-20"), true); err != nil {
			t.Fatal(err)
		}
		sandbox := func(more func(*metrics.Query)) metrics.Query {
			return q(func(q *metrics.Query) {
				q.Environment, q.Interval, q.To = "sandbox", "month", "2026-03-31"
				if more != nil {
					more(q)
				}
			})
		}
		months := func(chart string, more func(*metrics.Query)) map[string]string {
			return byPeriod(read(t, pool, chart, sandbox(more)))
		}

		mrr := months("mrr_movement", nil)
		if mrr["2026-02-01"] != `{"new":20,"reactivation":0,"expansion":2,"contraction":0,"churned":-10,"net":12}` || // J and L start; H's price rise; G lapses
			mrr["2026-03-01"] != `{"new":10,"reactivation":10,"expansion":0,"contraction":-7,"churned":-20,"net":-7}` { // K starts; G is back; H goes yearly; J and L end
			t.Errorf("%v", mrr)
		}
		if got := months("subscription_movement", nil)["2026-03-01"]; got != `{"new":1,"reactivated":1,"churned":-2,"net":0,"renewed":1}` {
			t.Errorf("%s", got)
		}
		if got := months("trial_movement", nil)["2026-01-01"]; got != `{"new":1,"converted":0,"expired":-1,"cancelled":1,"conversion_rate":0}` {
			t.Errorf("%s", got)
		}

		// Movements add up to the change in the running totals, every month.
		read := func(chart string) []*jsobj.Object {
			var out []*jsobj.Object
			for _, p := range read(t, pool, chart, sandbox(nil)).Points {
				out = append(out, p.Values)
			}
			return out
		}
		num := func(o *jsobj.Object, k string) float64 { v, _ := o.Get(k); return v.(float64) }
		mrrs, mrrMoves, subs, subMoves, trials, trialMoves := read("mrr"), read("mrr_movement"), read("active_subscriptions"),
			read("subscription_movement"), read("active_trials"), read("trial_movement")
		var before [3]float64
		for i := range mrrs {
			cur := [3]float64{num(mrrs[i], "mrr"), num(subs[i], "paid"), num(trials[i], "trials")}
			if math.Abs(num(mrrMoves[i], "net")-(cur[0]-before[0])) > 0.005 || num(subMoves[i], "net") != cur[1]-before[1] ||
				num(trialMoves[i], "new")+num(trialMoves[i], "converted")+num(trialMoves[i], "expired") != cur[2]-before[2] {
				t.Errorf("month %d doesn't add up", i)
			}
			before = cur
		}

		if got := months("mrr", func(q *metrics.Query) { q.Product = "yearly" })["2026-03-01"]; got != `{"mrr":5}` {
			t.Errorf("%s", got)
		}
		if got := months("mrr", func(q *metrics.Query) { q.Product = "monthly" })["2026-03-01"]; got != `{"mrr":0}` {
			t.Errorf("%s", got)
		}

		status, err := metrics.ReadChart(ctx, pool, "subscription_status", sandbox(nil), at("2026-03-15"))
		if err != nil {
			t.Fatal(err)
		}
		// G and H active and renewing; K won't renew; L in its grace period; J expired 5 days ago.
		// I's trial ended in January, more than 30 days ago, so it isn't listed.
		got := map[string]float64{}
		for _, c := range status.Categories {
			got[c.Key] = c.Value
		}
		if fmt.Sprint(got) != fmt.Sprint(map[string]float64{"active": 2, "cancelled": 1, "trial": 0, "grace": 1, "billing_retry": 0, "paused": 0, "expired": 1}) {
			t.Errorf("%v", got)
		}
		if !slices.Equal(status.Points, []metrics.Point{}) || status.CSV()[:19] != "status,label,count\n" {
			t.Errorf("%v %q", status.Points, status.CSV())
		}
	})

	// Ties and missing expiries, in an app of their own.
	edge := func(more func(*metrics.Query)) metrics.Query {
		return q(func(q *metrics.Query) {
			q.App, q.To = "edge", "2026-03-31"
			if more != nil {
				more(q)
			}
		})
	}
	edgeMonths := func(chart string, more func(*metrics.Query)) map[string]string {
		return byPeriod(read(t, pool, chart, edge(func(q *metrics.Query) {
			q.Interval = "month"
			if more != nil {
				more(q)
			}
		})))
	}
	edgeDay := func(chart, date, key string, more func(*metrics.Query)) any {
		for _, p := range read(t, pool, chart, edge(more)).Points {
			if p.Date == date {
				v, _ := p.Values.Get(key)
				return v
			}
		}
		return "missing"
	}
	edgeStatus := func(more func(*metrics.Query)) string {
		r, err := metrics.ReadChart(ctx, pool, "subscription_status", edge(more), at("2026-03-15"))
		if err != nil {
			t.Fatal(err)
		}
		got := map[string]float64{}
		for _, c := range r.Categories {
			got[c.Key] = c.Value
		}
		return fmt.Sprint(got)
	}
	status := func(active, expired float64) string {
		return fmt.Sprint(map[string]float64{"active": active, "cancelled": 0, "trial": 0, "grace": 0, "billing_retry": 0, "paused": 0, "expired": expired})
	}
	// Days where the movements don't add up to the change in the running totals.
	mismatches := func() []string {
		values := func(chart string) []metrics.Point { return read(t, pool, chart, edge(nil)).Points }
		num := func(p metrics.Point, k string) float64 { v, _ := p.Values.Get(k); return v.(float64) }
		mrrs, mrrMoves, subs, subMoves := values("mrr"), values("mrr_movement"), values("active_subscriptions"), values("subscription_movement")
		var out []string
		var before [2]float64
		for i := range mrrs {
			cur := [2]float64{num(mrrs[i], "mrr"), num(subs[i], "paid")}
			if math.Abs(num(mrrMoves[i], "net")-(cur[0]-before[0])) > 0.005 || num(subMoves[i], "net") != cur[1]-before[1] {
				out = append(out, mrrs[i].Date)
			}
			before = cur
		}
		return out
	}
	edgeTx := func(x ledgerTx) {
		x.app = "edge"
		if x.updatedAt == 0 {
			x.updatedAt = at("2026-04-20", 13)
		}
		l.tx(x)
	}

	t.Run("two purchases at the same moment in a chain count once: the later recorded one", func(t *testing.T) {
		// T: bought twice at the same moment ($10, then $20), then renewed at $20.
		edgeTx(ledgerTx{chain: "T", bought: "2026-01-05", expires: "2026-02-05", price: 10})
		edgeTx(ledgerTx{chain: "T", bought: "2026-01-05", expires: "2026-02-05", price: 20})
		edgeTx(ledgerTx{chain: "T", bought: "2026-02-05", expires: "2026-03-05", price: 20})
		// U: the latest purchase recorded twice; still active on Mar 15.
		edgeTx(ledgerTx{chain: "U", bought: "2026-03-10", expires: "2026-04-10", price: 10})
		edgeTx(ledgerTx{chain: "U", bought: "2026-03-10", expires: "2026-04-10", price: 10})
		run, err := metrics.Rollup(ctx, pool, at("2026-04-20", 14), false)
		if err != nil || run.Full || run.From == nil || *run.From != "2026-01-05" {
			t.Fatalf("%+v %v", run, err)
		}

		if got := edgeDay("active_subscriptions", "2026-01-10", "paid", nil); got != 1.0 {
			t.Errorf("paid on Jan 10: %v", got)
		}
		if got := edgeDay("mrr", "2026-01-10", "mrr", nil); got != 20.0 {
			t.Errorf("MRR on Jan 10: %v", got)
		}
		if got := edgeDay("active_subscriptions", "2026-03-15", "paid", nil); got != 1.0 { // U
			t.Errorf("paid on Mar 15: %v", got)
		}
		m := edgeMonths("subscription_movement", nil)
		if m["2026-01-01"] != `{"new":1,"reactivated":0,"churned":0,"net":1,"renewed":0}` ||
			m["2026-02-01"] != `{"new":0,"reactivated":0,"churned":0,"net":0,"renewed":1}` ||
			m["2026-03-01"] != `{"new":1,"reactivated":0,"churned":-1,"net":0,"renewed":0}` { // U starts, T ends
			t.Errorf("%v", m)
		}
		// The renewal keeps the $20 terms.
		if got := edgeMonths("mrr_movement", nil)["2026-02-01"]; got != `{"new":0,"reactivation":0,"expansion":0,"contraction":0,"churned":0,"net":0}` {
			t.Errorf("%s", got)
		}
		if got := mismatches(); len(got) != 0 {
			t.Errorf("movements don't add up on %v", got)
		}
		if got := edgeStatus(nil); got != status(1, 1) {
			t.Errorf("%s", got)
		}
	})

	t.Run("a purchase with no expiry gives no access, and the purchases around it are classified past it", func(t *testing.T) {
		noexp := func(x ledgerTx) {
			x.prod, x.updatedAt = "noexp", at("2026-04-20", 14)+60_000
			edgeTx(x)
		}
		// N: a purchase with no expiry, then a subscription: new.
		noexp(ledgerTx{chain: "N", bought: "2026-01-05", price: 5})
		noexp(ledgerTx{chain: "N", bought: "2026-01-20", expires: "2026-02-20", price: 10})
		// M: one with no expiry in the middle of a subscription: it neither ends M1 nor separates M3 from it.
		noexp(ledgerTx{chain: "M", bought: "2026-01-05", expires: "2026-02-05", price: 10})
		noexp(ledgerTx{chain: "M", bought: "2026-01-25", price: 10})
		noexp(ledgerTx{chain: "M", bought: "2026-02-05", expires: "2026-03-05", price: 10})
		// V: one with no expiry after the latest purchase, which is still active on Mar 15.
		noexp(ledgerTx{chain: "V", bought: "2026-03-10", expires: "2026-04-10", price: 10})
		noexp(ledgerTx{chain: "V", bought: "2026-03-12", price: 10})
		if _, err := metrics.Rollup(ctx, pool, at("2026-04-20", 14)+1800_000, false); err != nil {
			t.Fatal(err)
		}

		only := func(q *metrics.Query) { q.Product = "noexp" }
		if got := edgeDay("active_subscriptions", "2026-01-28", "paid", only); got != 2.0 { // N2 and M1
			t.Errorf("paid on Jan 28: %v", got)
		}
		m := edgeMonths("subscription_movement", only)
		if m["2026-01-01"] != `{"new":2,"reactivated":0,"churned":0,"net":2,"renewed":0}` || // N2, M1
			m["2026-02-01"] != `{"new":0,"reactivated":0,"churned":-1,"net":-1,"renewed":1}` || // N2 ends; M3 renews M1
			m["2026-03-01"] != `{"new":1,"reactivated":0,"churned":-1,"net":0,"renewed":0}` { // V1 starts, M3 ends
			t.Errorf("%v", m)
		}
		if got := mismatches(); len(got) != 0 {
			t.Errorf("movements don't add up on %v", got)
		}
		if got := edgeStatus(only); got != status(1, 2) { // V1; N2 and M3
			t.Errorf("%s", got)
		}
	})

	t.Run("the incremental runs match a full rebuild", func(t *testing.T) {
		snapshot := func() string {
			out := ""
			for _, c := range metrics.Charts {
				for _, country := range []string{"", "US"} {
					r, err := metrics.ReadChart(ctx, pool, c.ID, edge(func(q *metrics.Query) { q.Country = country }), at("2026-03-15"))
					if err != nil {
						t.Fatal(err)
					}
					o := r.JSON().Clone()
					o.Delete("updated_at") // when each run was
					out += jsobj.Stringify(o) + "\n"
				}
			}
			return out
		}
		incremental := snapshot()
		if _, err := metrics.Rollup(ctx, pool, at("2026-04-20", 15), true); err != nil {
			t.Fatal(err)
		}
		if got := snapshot(); got != incremental {
			t.Error("a full rebuild differs from the incremental runs")
		}
	})
}

func TestParseDateIsV8s(t *testing.T) {
	for in, want := range map[string]int64{
		"2026-02-29": at("2026-03-01", 0), "2026-02-31": at("2026-03-03", 0), "2026-04-31": at("2026-05-01", 0), "0000-01-01": -62167219200000,
	} {
		if got, ok := metrics.ParseDate(in); !ok || got != want {
			t.Errorf("%s: %d %v", in, got, ok)
		}
	}
	for _, in := range []string{"2026-02-32", "2026-00-10", "2026-01-00", "2026-1-01", "+026-01-01", "2026-13-01", ""} {
		if _, ok := metrics.ParseDate(in); ok {
			t.Errorf("%s parsed", in)
		}
	}
}
