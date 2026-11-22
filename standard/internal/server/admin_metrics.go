package server

// Charts: GET /admin/v1/metrics, /metrics/:chart (JSON or CSV) and POST /metrics/refresh, as in
// lite/src/office/admin.ts. The rollup and the charts themselves are internal/metrics.
//
// Standard adds a country filter (?country=US, ISO 3166-1 alpha-2), read from the per-country
// totals Lite doesn't keep, and GET /metrics lists the countries with data.

import (
	"net/http"
	"regexp"
	"strings"

	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/metrics"
)

var (
	chartDate    = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	chartCountry = regexp.MustCompile(`^[A-Z]{2}$`)
)

const (
	maxChartDays     = 3660
	refreshEveryMs   = 60_000
	chartDefaultDays = 89
)

func adminMetrics(q *adminReq) {
	updatedAt, firstDate, err := metrics.Info(q.ctx, q.s.Pool)
	if err != nil {
		q.internal(err)
		return
	}
	countries, err := metrics.Countries(q.ctx, q.s.Pool)
	if err != nil {
		q.internal(err)
		return
	}
	q.json(http.StatusOK, jsobj.New("charts", metrics.ChartList(), "updated_at", updatedAt, "first_date", firstDate,
		// Standard only: the country filter's choices.
		"edition", Edition, "countries", stringsToAny(countries)))
}

func adminChart(q *adminReq) {
	today := metrics.DayOf(q.now)
	to := today
	if q.hasQuery("to") {
		to = q.query("to")
	}
	toMs, toOK := metrics.ParseDate(to)
	var from string
	if q.hasQuery("from") {
		from = q.query("from")
	} else if toOK {
		from = metrics.DayOf(toMs - chartDefaultDays*metrics.Day)
	}
	fromMs, fromOK := metrics.ParseDate(from)
	if !chartDate.MatchString(from) || !chartDate.MatchString(to) || !fromOK || !toOK || from > to {
		q.bad("from and to must be dates (YYYY-MM-DD), with from on or before to.")
		return
	}
	if float64(toMs-fromMs)/float64(metrics.Day) > maxChartDays {
		q.bad("A chart can cover at most 3660 days.")
		return
	}
	interval := "day"
	if q.hasQuery("interval") {
		interval = q.query("interval")
	}
	if interval != "day" && interval != "week" && interval != "month" {
		q.bad("interval must be day, week or month.")
		return
	}
	environment := "production"
	if q.hasQuery("environment") {
		environment = q.query("environment")
	}
	if environment != "production" && environment != "sandbox" {
		q.bad("environment must be production or sandbox.")
		return
	}
	store := q.query("store")
	if store != "" && store != "app_store" && store != "play_store" {
		q.bad("store must be app_store or play_store.")
		return
	}
	country := strings.ToUpper(q.query("country"))
	if country != "" && !chartCountry.MatchString(country) {
		q.bad("country must be a two-letter country code (ISO 3166-1 alpha-2), such as US.")
		return
	}
	app := q.query("app")
	product := q.query("product")
	if product != "" {
		known := false
		for _, a := range allApps(q.cfg) {
			if q.p.canSeeApp(a.ID) && (app == "" || a.ID == app) && contains(chartProducts(a), product) {
				known = true
				break
			}
		}
		if !known {
			q.notFound("Product")
			return
		}
	}
	if app != "" && (q.cfg.Apps[app] == nil || !q.p.canSeeApp(app)) {
		q.notFound("App")
		return
	}
	// Charts cover every project unless ?project= picks one.
	var project *metrics.Project
	if q.query("project") != "" {
		chosen := q.project("")
		if chosen == nil {
			return
		}
		project = &metrics.Project{ID: chosen.ID, Apps: append([]string{}, chosen.AppOrder...)}
	}
	if to > today {
		to = today
	}
	result, err := metrics.ReadChart(q.ctx, q.s.Pool, q.params["chart"], metrics.Query{
		From: from, To: to, Interval: interval, Environment: environment, Store: store, App: app, Product: product, Country: country,
		Apps: q.p.apps, Project: project,
	}, q.now)
	if err != nil {
		q.internal(err)
		return
	}
	if result == nil {
		q.notFound("Chart")
		return
	}
	if q.query("format") == "csv" {
		h := q.w.Header()
		h.Set("Content-Type", "text/csv; charset=utf-8")
		h.Set("Content-Disposition", `attachment; filename="openpurr-`+result.Chart.ID+"-"+result.From+"-to-"+result.To+`.csv"`)
		q.w.WriteHeader(http.StatusOK)
		_, _ = q.w.Write([]byte(result.CSV()))
		return
	}
	q.json(http.StatusOK, result.JSON())
}

// adminRefreshMetrics runs the hourly rollup now. A full rebuild recomputes all history: owners
// only, as on Lite.
func adminRefreshMetrics(q *adminReq) {
	raw, _ := q.prop("full")
	full := truthy(raw)
	if full && !q.p.can(permSettingsManage) {
		q.forbidden("Only owners can rebuild all chart history.")
		return
	}
	last, err := metrics.LastRollupAt(q.ctx, q.s.Pool)
	if err != nil {
		q.internal(err)
		return
	}
	if !full && last != nil && q.now-*last < refreshEveryMs {
		q.json(http.StatusOK, jsobj.New("refreshed", false, "updated_at", float64(*last)))
		return
	}
	result, err := metrics.Rollup(q.ctx, q.s.Pool, q.now, full)
	if err != nil {
		q.internal(err)
		return
	}
	run := result.JSON()
	if full {
		from, _ := run.Get("from")
		if err := q.audit(q.s.Pool, "metrics.rebuilt", nil, jsobj.New("from", from, "rows", float64(result.Rows))); err != nil {
			q.internal(err)
			return
		}
	}
	if last, err = metrics.LastRollupAt(q.ctx, q.s.Pool); err != nil {
		q.internal(err)
		return
	}
	var updated any
	if last != nil {
		updated = float64(*last)
	}
	out := jsobj.New("refreshed", true)
	for _, k := range run.Keys() {
		v, _ := run.Get(k)
		out.Set(k, v)
	}
	out.Set("updated_at", updated)
	q.json(http.StatusOK, out)
}
