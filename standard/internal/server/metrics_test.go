package server_test

// The charts API (the chart parts of lite/test/admin-api.test.ts), charts during and after an
// import (lite/test/import.test.ts), the hourly rollup job, and the Standard-only country filter.
// The rollup and the charts themselves are tested against Lite's output in internal/metrics.

import (
	"context"
	"slices"
	"strings"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/metrics"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

func chartIDs(t *testing.T, res *tu.Response) []string {
	var out []string
	for _, c := range res.Get(t, "charts").([]any) {
		out = append(out, prop(c, "id").(string))
	}
	return out
}

func TestChartsAPI(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	owner := env.OwnerToken()
	viewer := env.CreateOperator(owner, "viewer", nil)
	as := tu.Auth{Session: viewer.Session}

	t.Run("lists charts and serves one as JSON or CSV, with validated parameters", func(t *testing.T) {
		list := expectStatus(t, env.Admin("GET", "/metrics", as, nil), 200)
		if ids := chartIDs(t, list); len(ids) != 16 || !slices.Contains(ids, "revenue") || !slices.Contains(ids, "new_customers") {
			t.Errorf("%v", ids)
		}
		if jsobj.Stringify(list.Get(t, "charts")) != jsobj.Stringify(metrics.ChartList()) || list.Get(t, "updated_at") != nil || list.Get(t, "first_date") != nil ||
			list.Get(t, "edition") != "standard" || jsobj.Stringify(list.Get(t, "countries")) != "[]" {
			t.Errorf("%s", list.Body)
		}

		mrr := expectStatus(t, env.Admin("GET", "/metrics/mrr?from=2026-01-01&to=2026-01-31&interval=week", as, nil), 200)
		if mrr.Get(t, "chart") != "mrr" || mrr.Get(t, "unit") != "usd" || mrr.Get(t, "kind") != "running" || mrr.Get(t, "interval") != "week" {
			t.Errorf("%s", mrr.Body)
		}
		if p := mrr.Get(t, "points").([]any)[0]; jsobj.Stringify(p) != `{"date":"2025-12-29","values":{"mrr":0}}` {
			t.Errorf("%s", jsobj.Stringify(p))
		}

		csv := expectStatus(t, env.Admin("GET", "/metrics/revenue?from=2026-01-01&to=2026-01-03&format=csv", as, nil), 200)
		if csv.Header.Get("Content-Type") != "text/csv; charset=utf-8" ||
			csv.Header.Get("Content-Disposition") != `attachment; filename="openpurr-revenue-2026-01-01-to-2026-01-03.csv"` ||
			string(csv.Body) != "date,net,refunds,gross\n2026-01-01,0,0,0\n2026-01-02,0,0,0\n2026-01-03,0,0,0\n" {
			t.Errorf("%v %q", csv.Header, csv.Body)
		}

		for _, bad := range []string{"from=2026-02-01&to=2026-01-01", "from=yesterday", "interval=hour", "environment=staging", "store=amazon",
			"from=2000-01-01&to=2026-01-01", "to=", "to=bad", "interval=", "from=2026-02-32", "country=USA", "country=1"} {
			expectStatus(t, env.Admin("GET", "/metrics/revenue?"+bad, as, nil), 400)
		}
		expectStatus(t, env.Admin("GET", "/metrics/ltv", as, nil), 404)
		expectStatus(t, env.Admin("GET", "/metrics/constructor", as, nil), 404)
		expectStatus(t, env.Admin("GET", "/metrics/revenue?app=not-an-app", as, nil), 404)
		expectStatus(t, env.Admin("GET", "/metrics/revenue?project=nope", as, nil), 404)
		// Ranges end today (the server's clock), and default to the 90 days before "to".
		res := expectStatus(t, env.Admin("GET", "/metrics/revenue?to=2030-01-01&from=2027-01-01", as, nil), 200)
		if res.Get(t, "to") != metrics.DayOf(env.Clock.Now()) {
			t.Errorf("%s", res.Get(t, "to"))
		}
		res = expectStatus(t, env.Admin("GET", "/metrics/revenue?to=2026-03-31", as, nil), 200)
		if res.Get(t, "from") != "2026-01-01" || len(res.Get(t, "points").([]any)) != 90 {
			t.Errorf("%s %d", res.Get(t, "from"), len(res.Get(t, "points").([]any)))
		}
		// V8 reads day 31 of any month (Feb 31 is Mar 3).
		res = expectStatus(t, env.Admin("GET", "/metrics/revenue?from=2026-02-31&to=2026-03-04", as, nil), 200)
		if res.Get(t, "from") != "2026-02-31" || jsobj.Stringify(prop(res.Get(t, "points").([]any)[0], "date")) != `"2026-03-03"` {
			t.Errorf("%s", res.Body)
		}
	})

	t.Run("lists products per app (Google base plans separately) and filters charts by them", func(t *testing.T) {
		apps := expectStatus(t, env.Admin("GET", "/apps", as, nil), 200).Get(t, "apps").([]any)
		for _, a := range apps {
			products := jsobj.Stringify(prop(a, "products"))
			if prop(a, "id") == "android" && (!strings.Contains(products, `"pro:monthly"`) || !strings.Contains(products, `"pro:annual"`)) {
				t.Errorf("%s", products)
			}
		}
		expectStatus(t, env.Admin("GET", "/metrics/mrr?product=pro:monthly", as, nil), 200)
		expectStatus(t, env.Admin("GET", "/metrics/mrr?app=ios&product=pro:monthly", as, nil), 404) // not an iOS product
		expectStatus(t, env.Admin("GET", "/metrics/mrr?product=nope", as, nil), 404)
		status := expectStatus(t, env.Admin("GET", "/metrics/subscription_status", as, nil), 200)
		if status.Get(t, "kind") != "breakdown" || len(status.Get(t, "categories").([]any)) != 7 || prop(status.Get(t, "categories").([]any)[0], "key") != "active" {
			t.Errorf("%s", status.Body)
		}
	})

	t.Run("limits app-restricted operators to their apps' products and charts", func(t *testing.T) {
		limited := env.CreateOperator(owner, "viewer", []string{"ios"})
		la := tu.Auth{Session: limited.Session}
		expectStatus(t, env.Admin("GET", "/metrics/mrr?product=pro:monthly", la, nil), 404)
		expectStatus(t, env.Admin("GET", "/metrics/mrr?app=android", la, nil), 404)
		res := expectStatus(t, env.Admin("GET", "/metrics/new_customers", la, nil), 200)
		if jsobj.Stringify(res.Get(t, "points")) != "[]" || !strings.Contains(jsobj.Stringify(res.Get(t, "notes")), "only for operators with access to all apps") {
			t.Errorf("%s", res.Body)
		}
	})

	t.Run("refreshes at most once a minute; only owners rebuild all history", func(t *testing.T) {
		first := expectStatus(t, env.Admin("POST", "/metrics/refresh", as, jsobj.New()), 200)
		if first.Get(t, "refreshed") != true || first.Get(t, "full") != true || first.Get(t, "updated_at") != float64(env.Clock.Now()) {
			t.Errorf("%s", first.Body) // the first run is a full one
		}
		if again := expectStatus(t, env.Admin("POST", "/metrics/refresh", as, jsobj.New()), 200); string(again.Body) != `{"refreshed":false,"updated_at":`+jsobj.FormatNumber(float64(env.Clock.Now()))+`}` {
			t.Errorf("%s", again.Body)
		}
		expectStatus(t, env.Admin("POST", "/metrics/refresh", as, jsobj.New("full", true)), 403)
		expectStatus(t, env.Admin("POST", "/metrics/refresh", tu.Auth{Token: env.CreateToken(t, env.CreateOperator(owner, "owner", nil).Session, "read")}, jsobj.New("full", true)), 403)
		full := expectStatus(t, env.Admin("POST", "/metrics/refresh", tu.Auth{Token: owner}, jsobj.New("full", "yes")), 200)
		if !strings.HasPrefix(string(full.Body), `{"refreshed":true,"from":null,"rows":0,"full":true,"updated_at":`) {
			t.Errorf("%s", full.Body)
		}
		var details string
		env.QueryRow("SELECT details FROM audit_log WHERE action = 'metrics.rebuilt'", nil, &details)
		if details != `{"from":null,"rows":0}` {
			t.Errorf("%s", details)
		}
		env.Clock.Store(env.Clock.Now() + 61_000)
		if res := expectStatus(t, env.Admin("POST", "/metrics/refresh", as, nil), 200); res.Get(t, "refreshed") != true || res.Get(t, "full") != false {
			t.Errorf("%s", res.Body)
		}
	})
}

func TestChartsFromTheLedger(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	owner := tu.Auth{Token: env.OwnerToken()}
	now := env.Clock.Now()
	// Two monthly subscriptions bought yesterday through the SDK API's ledger writes: one in
	// Germany on iOS, one on Android in the US (Google's storefront is already alpha-2).
	env.Purchase("default", "de-user", tu.Tx{AppID: "ios", Store: "app_store", Environment: "production", ProductID: "pro_monthly",
		PurchasedAt: now - tu.Day, ExpiresAt: tu.Ms(now + 29*tu.Day), PriceMicros: tu.Ms(9_990_000), Storefront: tu.Str("DEU")})
	env.Purchase("default", "us-user", tu.Tx{AppID: "android", Store: "play_store", Environment: "production", ProductID: "pro",
		BasePlanID: tu.Str("monthly"), PurchasedAt: now - tu.Day, ExpiresAt: tu.Ms(now + 29*tu.Day), PriceMicros: tu.Ms(4_990_000), Storefront: tu.Str("US")})

	t.Run("the hourly job rolls up, last", func(t *testing.T) {
		runJobs(env)
		jobs := env.Deps.Jobs.Jobs()
		if jobs[len(jobs)-1].Name != "rollup-metrics" {
			t.Errorf("%s", jobs[len(jobs)-1].Name)
		}
		list := expectStatus(t, env.Admin("GET", "/metrics", owner, nil), 200)
		if list.Get(t, "updated_at") != float64(now) || list.Get(t, "first_date") != metrics.DayOf(now-tu.Day) || jsobj.Stringify(list.Get(t, "countries")) != `["DE","US"]` {
			t.Errorf("%s", list.Body)
		}
	})

	mrr := func(query string) any {
		t.Helper()
		res := expectStatus(t, env.Admin("GET", "/metrics/mrr?interval=month&"+query, owner, nil), 200)
		points := res.Get(t, "points").([]any)
		return prop(points[len(points)-1], "values", "mrr")
	}

	t.Run("filters by country, combined with the other filters", func(t *testing.T) {
		if mrr("") != 14.98 || mrr("country=DE") != 9.99 || mrr("country=us") != 4.99 || mrr("country=FR") != 0.0 ||
			mrr("country=US&store=app_store") != 0.0 || mrr("country=US&product=pro:monthly") != 4.99 {
			t.Errorf("%v %v %v %v", mrr(""), mrr("country=DE"), mrr("country=us"), mrr("country=FR"))
		}
		status := expectStatus(t, env.Admin("GET", "/metrics/subscription_status?country=DE", owner, nil), 200)
		if prop(status.Get(t, "categories").([]any)[0], "value") != 1.0 {
			t.Errorf("%s", status.Body)
		}
		status = expectStatus(t, env.Admin("GET", "/metrics/subscription_status?country=US", owner, nil), 200)
		if prop(status.Get(t, "categories").([]any)[0], "value") != 1.0 {
			t.Errorf("%s", status.Body)
		}
		csv := expectStatus(t, env.Admin("GET", "/metrics/active_subscriptions?country=DE&format=csv&from="+metrics.DayOf(now), owner, nil), 200)
		if string(csv.Body) != "date,paid,trials\n"+metrics.DayOf(now)+",1,0\n" {
			t.Errorf("%q", csv.Body)
		}
		customers := expectStatus(t, env.Admin("GET", "/metrics/new_customers?country=DE", owner, nil), 200)
		if !strings.Contains(jsobj.Stringify(customers.Get(t, "notes")), "store, product or country") {
			t.Errorf("%s", customers.Body)
		}
	})

	t.Run("a full rebuild leaves the same charts", func(t *testing.T) {
		before := mrr("country=DE")
		if _, err := metrics.Rollup(context.Background(), env.Pool, env.Clock.Now(), true); err != nil {
			t.Fatal(err)
		}
		if mrr("country=DE") != before {
			t.Error("changed")
		}
	})
}

func TestChartsAndImports(t *testing.T) {
	ctx := context.Background()
	importHistory := func(env *tu.Env, fake *tu.FakeApple, tid string, purchased, expires int64) {
		sub := tu.SignJWS(tu.Transaction(env.Clock.Now(), tu.Fields{"transactionId": tid, "originalTransactionId": tid, "productId": "pro_annual",
			"purchaseDate": float64(purchased), "originalPurchaseDate": float64(purchased), "expiresDate": float64(expires)}))
		fake.Set(map[string]tu.AppleRoute{
			"sandbox GET /inApps/v2/history/" + tid:       ok(jsobj.New("signedTransactions", []any{sub}, "hasMore", false, "revision", "r")),
			"sandbox GET /inApps/v1/subscriptions/" + tid: ok(jsobj.New("data", []any{})),
		})
	}

	t.Run("counts backdated customers in the new-customers chart once the rollup has passed their day", func(t *testing.T) {
		env, fake := appleAPIEnv(t)
		token := env.OwnerToken()
		firstPurchase := mustDay(t, "2025-03-14") + 10*3600_000
		expectStatus(t, env.Admin("POST", "/metrics/refresh", tu.Auth{Token: token}, jsobj.New()), 200) // the charts are up to date as of now
		importHistory(env, fake, "4000000005", firstPurchase, firstPurchase+365*tu.Day)
		expectStatus(t, importRow(env, token, jsobj.New("app_user_id", "rc-chart", "transaction_id", "4000000005")), 200)
		chart := expectStatus(t, env.Admin("GET", "/metrics/new_customers?from=2025-03-14&to=2025-03-14", tu.Auth{Token: token}, nil), 200)
		if v := prop(chart.Get(t, "points").([]any)[0], "values", "customers"); v != 1.0 {
			t.Errorf("%v", v)
		}
	})

	t.Run("waits until an hour after the last imported row, then catches up in one run", func(t *testing.T) {
		env, fake := appleAPIEnv(t)
		now := env.Clock.Now()
		start := now - 3*tu.Day
		if _, err := metrics.Rollup(ctx, env.Pool, start, false); err != nil {
			t.Fatal(err)
		}
		importHistory(env, fake, "4000000009", now-265*tu.Day, now+100*tu.Day)
		expectStatus(t, importRow(env, env.OwnerToken(), jsobj.New("app_user_id", "rc-charts", "transaction_id", "4000000009")), 200)
		during, err := metrics.Rollup(ctx, env.Pool, now+10*60_000, false)
		if err != nil || jsobj.Stringify(during.JSON()) != `{"from":null,"rows":0,"full":false,"deferred":true}` {
			t.Fatalf("%v %v", during, err)
		}
		if last, _ := metrics.LastRollupAt(ctx, env.Pool); last == nil || *last != start {
			t.Errorf("%v", last)
		}
		after, err := metrics.Rollup(ctx, env.Pool, now+metrics.ImportQuietMs+60_000, false)
		if err != nil || after.Deferred || *after.From > metrics.DayOf(now-260*tu.Day) {
			t.Errorf("%+v %v", after, err)
		}
		// An owner's full rebuild doesn't wait.
		env.Exec("UPDATE job_state SET updated_at = $1 WHERE key = 'import_active'", now+metrics.ImportQuietMs+60_000)
		if full, err := metrics.Rollup(ctx, env.Pool, now+metrics.ImportQuietMs+120_000, true); err != nil || full.Deferred || !full.Full {
			t.Errorf("%+v %v", full, err)
		}
	})
}

func mustDay(t *testing.T, date string) int64 {
	ms, ok := metrics.ParseDate(date)
	if !ok {
		t.Fatal(date)
	}
	return ms
}
