package server

// Price experiments in the admin API: creating, editing, starting and stopping them, and their
// results per variant. Ports of the experiment routes of lite/src/office/admin.ts and of
// lite/src/office/experiments.ts. What the SDK API needs (assignment, enrollment) is in
// internal/ledger/experiments.go.
//
// Experiments change what customers are offered, so changing them takes config:manage. Results add
// up purchases across every app, so only operators who see every app get them.

import (
	"context"
	"errors"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/openpurr/openpurr/standard/internal/authcrypto"
	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/fx"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
)

const (
	experimentNameMax  = 100
	experimentNotesMax = 2000
)

var variantIDs = []string{"a", "b", "c", "d"}

// experimentRow is an experiment table row.
type experimentRow struct {
	ID        string
	ProjectID string
	Name      string
	Notes     string
	Variants  string
	Status    string
	CreatedAt int64
	CreatedBy *string
	StartedAt *int64
	StoppedAt *int64
	Results   *string
	ResultsAt *int64
}

const experimentColumns = "id, project_id, name, notes, variants, status, created_at, created_by, started_at, stopped_at, results, results_at"

func (x *experimentRow) targets() []any {
	return []any{&x.ID, &x.ProjectID, &x.Name, &x.Notes, &x.Variants, &x.Status, &x.CreatedAt, &x.CreatedBy, &x.StartedAt, &x.StoppedAt, &x.Results, &x.ResultsAt}
}

// variantsOf parses the stored variants: objects {id, offering_id, weight}, in order.
func (x *experimentRow) variantsOf() []*jsobj.Object {
	v, _ := jsobj.Parse([]byte(x.Variants))
	list, _ := v.([]any)
	out := make([]*jsobj.Object, 0, len(list))
	for _, e := range list {
		if o, ok := e.(*jsobj.Object); ok {
			out = append(out, o)
		}
	}
	return out
}

func variantField(v *jsobj.Object, k string) string {
	s, _ := v.Get(k)
	str, _ := s.(string)
	return str
}

func variantWeight(v *jsobj.Object) float64 {
	w, _ := v.Get("weight")
	f, _ := w.(float64)
	return f
}

// publicExperiment is an experiment as the admin API shows it (without results).
func publicExperiment(x *experimentRow, project *config.Project) *jsobj.Object {
	variants := []any{}
	for _, v := range x.variantsOf() {
		c := v.Clone()
		if project != nil {
			c.Set("offering_exists", hasOffering(project, variantField(v, "offering_id")))
		}
		variants = append(variants, c)
	}
	return jsobj.New("id", x.ID, "project_id", x.ProjectID, "name", x.Name, "notes", x.Notes, "status", x.Status,
		"variants", variants, "created_at", float64(x.CreatedAt), "created_by", strOrNull(x.CreatedBy),
		"started_at", numOrNull(x.StartedAt), "stopped_at", numOrNull(x.StoppedAt))
}

// experimentOf is the experiment in the path and its project, or nil after answering 404.
func (q *adminReq) experimentOf() (*experimentRow, *config.Project) {
	var x experimentRow
	err := q.s.Pool.QueryRow(q.ctx, "SELECT "+experimentColumns+" FROM experiment WHERE id = $1", q.params["id"]).Scan(x.targets()...)
	if errors.Is(err, pgx.ErrNoRows) {
		q.notFound("Experiment")
		return nil, nil
	}
	if err != nil {
		q.internal(err)
		return nil, nil
	}
	project := q.cfg.Projects[x.ProjectID]
	if project == nil {
		q.notFound("Experiment") // its project was removed from the config
		return nil, nil
	}
	if chosen, _, _ := chooseProject(q.cfg, q.p, x.ProjectID); chosen == nil {
		q.notFound("Experiment")
		return nil, nil
	}
	return &x, project
}

// parseVariants validates variants from a request: 2 to 4 offerings from the project, weights
// adding up to 100. It returns the stored form, or a message.
func parseVariants(project *config.Project, raw any) (string, string) {
	list, ok := raw.([]any)
	if !ok || len(list) < 2 || len(list) > len(variantIDs) {
		return "", "variants must list 2 to " + strconv.Itoa(len(variantIDs)) + " offerings; the first is the control."
	}
	offerings := []string{}
	for _, o := range project.Offerings {
		offerings = append(offerings, o.ID)
	}
	out := []any{}
	used := map[string]bool{}
	total := 0.0
	for i, v := range list {
		offering, _ := jsobj.Prop(v, "offering_id")
		weight, _ := jsobj.Prop(v, "weight")
		oid, isStr := offering.(string)
		if !isStr || !contains(offerings, oid) {
			names := strings.Join(offerings, ", ")
			if names == "" {
				names = "(none yet)"
			}
			return "", "variants[" + strconv.Itoa(i) + "].offering_id must be one of the project's offerings: " + names + "."
		}
		if used[oid] {
			return "", "Offering " + oid + " is in two variants; each variant needs its own offering."
		}
		w, isNum := weight.(float64)
		if !isNum || w != math.Trunc(w) || w < 1 || w > 99 {
			return "", "variants[" + strconv.Itoa(i) + "].weight must be a whole percent from 1 to 99."
		}
		used[oid] = true
		total += w
		out = append(out, jsobj.New("id", variantIDs[i], "offering_id", oid, "weight", w))
	}
	if total != 100 {
		return "", "The weights add up to " + jsobj.FormatNumber(total) + "; they must add up to 100."
	}
	return jsobj.Stringify(out), ""
}

// parseText reads a name or notes field: absent or null is "" (or an error when required).
func parseText(raw any, present bool, field string, max int, required bool) (string, string) {
	if !present || raw == nil {
		if required {
			return "", field + " is required."
		}
		return "", ""
	}
	s, ok := raw.(string)
	if !ok {
		return "", field + " must be a string."
	}
	text := jsobj.Trim(s)
	if required && text == "" {
		return "", field + " is required."
	}
	if jsobj.UTF16Len(text) > max {
		return "", field + " is at most " + strconv.Itoa(max) + " characters."
	}
	return text, ""
}

func adminExperiments(q *adminReq) {
	project := q.project("")
	if project == nil {
		return
	}
	rows, err := q.s.Pool.Query(q.ctx,
		`SELECT `+experimentColumns+`, (SELECT count(*) FROM experiment_enrollment e WHERE e.experiment_id = x.id)
		 FROM experiment x WHERE x.project_id = $1 ORDER BY x.created_at DESC, x.id COLLATE "C" DESC`, project.ID)
	if err != nil {
		q.internal(err)
		return
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (any, error) {
		var x experimentRow
		var enrolled int64
		if err := r.Scan(append(x.targets(), &enrolled)...); err != nil {
			return nil, err
		}
		o := publicExperiment(&x, project)
		o.Set("enrolled", float64(enrolled))
		return o, nil
	})
	if err != nil {
		q.internal(err)
		return
	}
	if list == nil {
		list = []any{}
	}
	q.json(http.StatusOK, jsobj.New("experiments", list))
}

func adminCreateExperiment(q *adminReq) {
	requested, _ := q.propString("project")
	project := q.project(requested)
	if project == nil {
		return
	}
	nameRaw, namePresent := q.prop("name")
	name, problem := parseText(nameRaw, namePresent, "name", experimentNameMax, true)
	if problem != "" {
		q.bad(problem)
		return
	}
	notesRaw, notesPresent := q.prop("notes")
	notes, problem := parseText(notesRaw, notesPresent, "notes", experimentNotesMax, false)
	if problem != "" {
		q.bad(problem)
		return
	}
	variantsRaw, _ := q.prop("variants")
	variants, problem := parseVariants(project, variantsRaw)
	if problem != "" {
		q.bad(problem)
		return
	}
	by := q.p.op.Email
	x := &experimentRow{ID: "exp_" + authcrypto.RandomToken()[:16], ProjectID: project.ID, Name: name, Notes: notes,
		Variants: variants, Status: "draft", CreatedAt: q.now, CreatedBy: &by}
	parsedVariants, _ := jsobj.Parse([]byte(variants))
	err := q.tx(func(tx pgx.Tx) error {
		if _, err := tx.Exec(q.ctx,
			"INSERT INTO experiment (id, project_id, name, notes, variants, status, created_at, created_by) VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7)",
			x.ID, x.ProjectID, x.Name, x.Notes, x.Variants, x.CreatedAt, by); err != nil {
			return err
		}
		return q.audit(tx, "experiment.create", &x.ID, jsobj.New("project", project.ID, "name", name, "variants", parsedVariants))
	})
	if err != nil {
		q.internal(err)
		return
	}
	q.json(http.StatusCreated, jsobj.New("experiment", publicExperiment(x, project)))
}

func adminExperiment(q *adminReq) {
	x, project := q.experimentOf()
	if x == nil {
		return
	}
	q.json(http.StatusOK, jsobj.New("experiment", publicExperiment(x, project)))
}

// adminUpdateExperiment: name and notes can change at any time; variants only before it starts.
func adminUpdateExperiment(q *adminReq) {
	x, project := q.experimentOf()
	if x == nil {
		return
	}
	next := *x
	if raw, present := q.prop("name"); present {
		name, problem := parseText(raw, true, "name", experimentNameMax, true)
		if problem != "" {
			q.bad(problem)
			return
		}
		next.Name = name
	}
	if raw, present := q.prop("notes"); present {
		if raw == nil {
			raw = ""
		}
		notes, problem := parseText(raw, true, "notes", experimentNotesMax, false)
		if problem != "" {
			q.bad(problem)
			return
		}
		next.Notes = notes
	}
	variantsRaw, variantsSet := q.prop("variants")
	if variantsSet {
		if x.Status != "draft" {
			q.fail(http.StatusConflict, "conflict", "Variants can't change once an experiment has started: customers are already split. Stop it and create a new one.")
			return
		}
		variants, problem := parseVariants(project, variantsRaw)
		if problem != "" {
			q.bad(problem)
			return
		}
		next.Variants = variants
	}
	details := jsobj.New("name", next.Name)
	if variantsSet {
		parsed, _ := jsobj.Parse([]byte(next.Variants))
		details.Set("variants", parsed)
	}
	err := q.tx(func(tx pgx.Tx) error {
		if _, err := tx.Exec(q.ctx, "UPDATE experiment SET name = $1, notes = $2, variants = $3 WHERE id = $4", next.Name, next.Notes, next.Variants, x.ID); err != nil {
			return err
		}
		return q.audit(tx, "experiment.update", &x.ID, details)
	})
	if err != nil {
		q.internal(err)
		return
	}
	q.json(http.StatusOK, jsobj.New("experiment", publicExperiment(&next, project)))
}

func adminStartExperiment(q *adminReq) {
	x, project := q.experimentOf()
	if x == nil {
		return
	}
	if x.Status != "draft" {
		q.fail(http.StatusConflict, "conflict", "This experiment is "+x.Status+"; only a draft can start.")
		return
	}
	var missing []string
	for _, v := range x.variantsOf() {
		if oid := variantField(v, "offering_id"); !hasOffering(project, oid) {
			missing = append(missing, oid)
		}
	}
	if len(missing) > 0 {
		q.bad("These offerings are no longer in the config: " + strings.Join(missing, ", ") + ". Edit the variants first.")
		return
	}
	var otherName string
	err := q.s.Pool.QueryRow(q.ctx, "SELECT name FROM experiment WHERE project_id = $1 AND status = 'running' LIMIT 1", project.ID).Scan(&otherName)
	if err == nil {
		q.fail(http.StatusConflict, "conflict", `"`+otherName+`" is already running in this project; stop it first. One experiment runs at a time, so each customer is in at most one.`)
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		q.internal(err)
		return
	}
	err = q.tx(func(tx pgx.Tx) error {
		if _, err := tx.Exec(q.ctx, "UPDATE experiment SET status = 'running', started_at = $1 WHERE id = $2 AND status = 'draft'", q.now, x.ID); err != nil {
			return err
		}
		return q.audit(tx, "experiment.start", &x.ID, jsobj.New("project", project.ID))
	})
	if isUniqueViolation(err) {
		// The unique index: another experiment started at the same moment.
		q.fail(http.StatusConflict, "conflict", "Another experiment is already running in this project; stop it first.")
		return
	}
	if err != nil {
		q.internal(err)
		return
	}
	q.s.Experiments.Forget()
	x.Status, x.StartedAt = "running", &q.now
	q.json(http.StatusOK, jsobj.New("experiment", publicExperiment(x, project)))
}

func adminStopExperiment(q *adminReq) {
	x, project := q.experimentOf()
	if x == nil {
		return
	}
	if x.Status != "running" {
		q.fail(http.StatusConflict, "conflict", "This experiment is "+x.Status+"; only a running one can stop.")
		return
	}
	err := q.tx(func(tx pgx.Tx) error {
		// Results are recomputed with the end date.
		if _, err := tx.Exec(q.ctx, "UPDATE experiment SET status = 'stopped', stopped_at = $1, results = NULL, results_at = NULL WHERE id = $2", q.now, x.ID); err != nil {
			return err
		}
		return q.audit(tx, "experiment.stop", &x.ID, jsobj.New("project", project.ID))
	})
	if err != nil {
		q.internal(err)
		return
	}
	q.s.Experiments.Forget()
	x.Status, x.StoppedAt = "stopped", &q.now
	q.json(http.StatusOK, jsobj.New("experiment", publicExperiment(x, project)))
}

func adminDeleteExperiment(q *adminReq) {
	x, _ := q.experimentOf()
	if x == nil {
		return
	}
	if x.Status == "running" {
		q.fail(http.StatusConflict, "conflict", "Stop the experiment before deleting it.")
		return
	}
	err := q.tx(func(tx pgx.Tx) error {
		if _, err := tx.Exec(q.ctx, "DELETE FROM experiment_enrollment WHERE experiment_id = $1", x.ID); err != nil {
			return err
		}
		if _, err := tx.Exec(q.ctx, "DELETE FROM experiment WHERE id = $1", x.ID); err != nil {
			return err
		}
		return q.audit(tx, "experiment.delete", &x.ID, jsobj.New("name", x.Name))
	})
	if err != nil {
		q.internal(err)
		return
	}
	q.json(http.StatusOK, jsobj.New("deleted", true))
}

func adminExperimentResults(q *adminReq) {
	x, _ := q.experimentOf()
	if x == nil {
		return
	}
	if q.p.apps != nil {
		q.forbidden("Experiment results add up purchases in every app, so they're for operators who can see every app.")
		return
	}
	environment := "production"
	if q.query("environment") == "sandbox" {
		environment = "sandbox"
	}
	results, err := experimentResults(q.ctx, q.s.Pool, x, environment, q.query("refresh") == "1", q.now)
	if err != nil {
		q.internal(err)
		return
	}
	q.json(http.StatusOK, jsobj.New("results", results))
}

// --- results -----------------------------------------------------------------------------------------

// Below these, a "chance to beat the control" is mostly noise, and the dashboard says it's too early.
const (
	minCustomersPerVariant  = 100
	minPayingPerComparison  = 20
	resultsFreshMs          = 5 * 60_000
	resultsRefreshMinMs     = 60_000
	experimentResultsColumn = "results"
)

// normalCDF is the standard normal CDF (Abramowitz and Stegun 7.1.26, error below 1.5e-7).
func normalCDF(z float64) float64 {
	x := math.Abs(z) / math.Sqrt2
	t := 1 / (1 + 0.3275911*x)
	erf := 1 - ((((1.061405429*t-1.453152027)*t+1.421413741)*t-0.284496736)*t+0.254829592)*t*math.Exp(-x*x)
	if z >= 0 {
		return (1 + erf) / 2
	}
	return (1 - erf) / 2
}

// chanceConversionHigher is P(variant's conversion rate > control's): Beta(1 + paying, 1 + others)
// posteriors, compared with a normal approximation of their difference.
func chanceConversionHigher(cn, cx, vn, vx float64) any {
	if cn == 0 || vn == 0 {
		return nil
	}
	beta := func(n, x float64) (float64, float64) {
		a, b := 1+x, 1+n-x
		return a / (a + b), (a * b) / ((a + b) * (a + b) * (a + b + 1))
	}
	cm, cv := beta(cn, cx)
	vm, vv := beta(vn, vx)
	return normalCDF((vm - cm) / math.Sqrt(cv+vv))
}

// chanceMeanHigher is P(variant's mean revenue per customer > control's): a normal approximation
// of the difference of means.
func chanceMeanHigher(cn, csum, csq, vn, vsum, vsq float64) any {
	if cn < 2 || vn < 2 {
		return nil
	}
	stats := func(n, sum, sq float64) (float64, float64) {
		mean := sum / n
		return mean, math.Max(0, (sq-n*mean*mean)/(n-1)) / n
	}
	cm, cse := stats(cn, csum, csq)
	vm, vse := stats(vn, vsum, vsq)
	se := math.Sqrt(cse + vse)
	if se == 0 {
		switch {
		case cm == vm:
			return 0.5
		case vm > cm:
			return 1.0
		}
		return 0.0
	}
	return normalCDF((vm - cm) / se)
}

func lift(control, variant float64) any {
	if control == 0 {
		return nil
	}
	return variant/control - 1
}

func round2(n float64) float64 { return fx.JSRound(n*100) / 100 }

// periodDays is the days in a billing period, from a purchase's length (as the charts infer it).
func periodDays(ms int64) float64 {
	days := float64(ms) / 86_400_000
	switch {
	case days < 10:
		return 7
	case days < 45:
		return 30.4375
	case days < 100:
		return 91.3125
	case days < 200:
		return 182.625
	}
	return 365.25
}

// usdSQL converts t's price to USD at the rate for its purchase date, the nearest earlier one, or
// else the nearest later one (lite/src/fx.ts usdSql), in double precision as SQLite computes it.
func usdSQL(t string) string {
	day := `to_char(to_timestamp(` + t + `.purchased_at / 1000.0) AT TIME ZONE 'UTC', 'YYYY-MM-DD')`
	return `CASE
    WHEN ` + t + `.price_micros IS NULL OR ` + t + `.currency IS NULL THEN NULL
    WHEN ` + t + `.currency = 'USD' THEN ` + t + `.price_micros::float8 / 1e6::float8
    ELSE ` + t + `.price_micros::float8 / 1e6::float8 / coalesce(
      (SELECT f.per_usd FROM fx_rate f WHERE f.currency = ` + t + `.currency AND f.date <= ` + day + ` ORDER BY f.date DESC LIMIT 1),
      (SELECT f.per_usd FROM fx_rate f WHERE f.currency = ` + t + `.currency AND f.date > ` + day + ` ORDER BY f.date LIMIT 1))
  END`
}

// enrolledCTE is each enrolled person once, with their earliest enrollment. Customers are
// "c:<id>", unknown app user IDs "u:<id>".
const enrolledCTE = `
  enrolled_all AS (
    SELECT coalesce('c:' || a.customer_id, 'u:' || e.app_user_id) AS who, a.customer_id, e.variant, e.enrolled_at
    FROM experiment_enrollment e LEFT JOIN customer_alias a ON a.project_id = $2 AND a.app_user_id = e.app_user_id
    WHERE e.experiment_id = $1),
  enrolled AS (
    SELECT who, customer_id, variant, enrolled_at FROM (
      SELECT *, row_number() OVER (PARTITION BY who ORDER BY enrolled_at, variant) AS rn FROM enrolled_all) r WHERE rn = 1)`

type resultTx struct {
	who, variant, store, chain, product, productType, periodType string
	purchasedAt                                                  int64
	expiresAt, priceMicros, revokedAt                            *int64
	usd                                                          *float64
}

type person struct {
	variant      string
	trial        bool
	paidAt       *int64
	firstProduct string
	revenue      float64
	hadSub       bool
	chains       map[string]*resultTx
	chainOrder   []string
}

type dayValues struct{ customers, paying, revenue float64 }

func computeResults(ctx context.Context, db ledger.DB, x *experimentRow, environment string, now int64) (*jsobj.Object, error) {
	variants := x.variantsOf()
	ids := make([]string, len(variants))
	for i, v := range variants {
		ids[i] = variantField(v, "id")
	}
	until := now
	if x.StoppedAt != nil {
		until = *x.StoppedAt
	}
	daily := map[string]map[string]*dayValues{}
	dayOf := func(date string) map[string]*dayValues {
		d := daily[date]
		if d == nil {
			d = map[string]*dayValues{}
			for _, id := range ids {
				d[id] = &dayValues{}
			}
			daily[date] = d
		}
		return d
	}
	enrolledBy := map[string]float64{}
	for _, id := range ids {
		enrolledBy[id] = 0
	}
	rows, err := db.Query(ctx, `WITH `+enrolledCTE+`
		SELECT variant, to_char(to_timestamp(enrolled_at / 1000.0) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*) FROM enrolled GROUP BY variant, day`,
		x.ID, x.ProjectID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var variant, date string
		var n int64
		if err := rows.Scan(&variant, &date, &n); err != nil {
			rows.Close()
			return nil, err
		}
		if _, ok := enrolledBy[variant]; !ok {
			continue
		}
		enrolledBy[variant] += float64(n)
		dayOf(date)[variant].customers += float64(n)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	rows, err = db.Query(ctx, `WITH `+enrolledCTE+`
		SELECT en.who, en.variant, t.store, t.original_transaction_id, t.product_id || coalesce(':' || t.base_plan_id, ''),
		       t.product_type, t.purchased_at, t.expires_at, t.period_type, t.price_micros, t.revoked_at, `+usdSQL("t")+`
		FROM enrolled en
		JOIN purchase_owner o ON o.customer_id = en.customer_id
		JOIN store_transaction t ON t.store = o.store AND t.original_transaction_id = o.original_transaction_id
		WHERE t.environment = $3 AND t.original_purchased_at >= en.enrolled_at AND t.original_purchased_at < $4
		ORDER BY t.purchased_at, t.store, t.transaction_id COLLATE "C"`,
		x.ID, x.ProjectID, environment, until)
	if err != nil {
		return nil, err
	}
	txs, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (*resultTx, error) {
		var t resultTx
		return &t, r.Scan(&t.who, &t.variant, &t.store, &t.chain, &t.product, &t.productType, &t.purchasedAt, &t.expiresAt,
			&t.periodType, &t.priceMicros, &t.revokedAt, &t.usd)
	})
	if err != nil {
		return nil, err
	}

	// Per customer: what they did, from their transactions (oldest first).
	people := map[string]*person{}
	var order []string
	unconverted := 0.0
	isoDay := func(ms int64) string { return time.UnixMilli(ms).UTC().Format("2006-01-02") }
	for _, t := range txs {
		p := people[t.who]
		if p == nil {
			p = &person{variant: t.variant, chains: map[string]*resultTx{}}
			people[t.who] = p
			order = append(order, t.who)
		}
		if t.periodType == "trial" {
			p.trial = true
		}
		paid := t.priceMicros != nil && *t.priceMicros > 0 && t.periodType != "trial"
		if paid && t.revokedAt == nil {
			if t.usd == nil {
				unconverted++
			} else {
				p.revenue += *t.usd
				dayOf(isoDay(t.purchasedAt))[t.variant].revenue += *t.usd
			}
			if p.paidAt == nil {
				at := t.purchasedAt
				p.paidAt = &at
				p.firstProduct = t.product
				if t.productType == "subscription" {
					p.hadSub = true
				}
				dayOf(isoDay(t.purchasedAt))[t.variant].paying++
			}
			if t.productType == "subscription" {
				p.hadSub = true
			}
		}
		if t.productType == "subscription" {
			key := t.store + ":" + t.chain
			if _, seen := p.chains[key]; !seen {
				p.chainOrder = append(p.chainOrder, key)
			}
			p.chains[key] = t
		}
	}

	type agg struct {
		trials, conversions, paying, revenue, sumSq, active, mrr, churned float64
		products                                                          *jsobj.Object
	}
	aggs := map[string]*agg{}
	for _, id := range ids {
		aggs[id] = &agg{products: jsobj.New()}
	}
	for _, who := range order {
		p := people[who]
		a := aggs[p.variant]
		if a == nil {
			continue
		}
		if p.trial {
			a.trials++
		}
		if p.paidAt != nil {
			a.paying++
			if p.trial {
				a.conversions++
			}
			if p.firstProduct != "" {
				n, _ := a.products.Get(p.firstProduct)
				f, _ := n.(float64)
				a.products.Set(p.firstProduct, f+1)
			}
		}
		a.revenue += p.revenue
		a.sumSq += p.revenue * p.revenue
		active := false
		for _, key := range p.chainOrder {
			t := p.chains[key]
			if t.revokedAt != nil || t.expiresAt == nil || *t.expiresAt <= now {
				continue
			}
			active = true
			a.active++
			if t.periodType != "trial" && t.usd != nil && *t.usd != 0 {
				a.mrr += (*t.usd * 30.4375) / periodDays(*t.expiresAt-t.purchasedAt)
			}
		}
		if p.paidAt != nil && p.hadSub && !active {
			a.churned++
		}
	}

	control := ids[0]
	ca, cn := aggs[control], enrolledBy[control]
	results := []any{}
	for i, v := range variants {
		id := ids[i]
		a, n := aggs[id], enrolledBy[id]
		perCustomer := 0.0
		if n != 0 {
			perCustomer = round2(a.revenue / n)
		}
		var vs any
		if id != control {
			var convLift, revLift any
			if cn != 0 && n != 0 {
				convLift = lift(ca.paying/cn, a.paying/n)
				revLift = lift(ca.revenue/cn, a.revenue/n)
			}
			vs = jsobj.New(
				"conversion_lift", convLift,
				"revenue_lift", revLift,
				"conversion_chance", chanceConversionHigher(cn, ca.paying, n, a.paying),
				"revenue_chance", chanceMeanHigher(cn, ca.revenue, ca.sumSq, n, a.revenue, a.sumSq),
				"enough_data", math.Min(cn, n) >= minCustomersPerVariant && ca.paying+a.paying >= minPayingPerComparison,
			)
		}
		weight, _ := v.Get("weight")
		results = append(results, jsobj.New(
			"id", id, "offering_id", variantField(v, "offering_id"), "weight", weight,
			"customers", n, "trials", a.trials, "trial_conversions", a.conversions, "paying", a.paying,
			"revenue", round2(a.revenue), "revenue_per_customer", perCustomer, "active_subscriptions", a.active,
			"mrr", round2(a.mrr), "churned", a.churned, "products", a.products, "vs_control", vs,
		))
	}

	dates := make([]string, 0, len(daily))
	for d := range daily {
		dates = append(dates, d)
	}
	sort.Strings(dates)
	days := []any{}
	for _, d := range dates {
		values := jsobj.New()
		for _, id := range ids {
			v := daily[d][id]
			values.Set(id, jsobj.New("customers", v.customers, "paying", v.paying, "revenue", round2(v.revenue)))
		}
		days = append(days, jsobj.New("date", d, "values", values))
	}
	return jsobj.New("experiment_id", x.ID, "environment", environment, "computed_at", float64(now), "unconverted", unconverted,
		"variants", results, "daily", days), nil
}

// experimentResults reads the ledger as little as possible: production results are kept for a few
// minutes (for good once the experiment has stopped); refresh recomputes them, at most once a
// minute. Sandbox results are always computed. Nil for a draft.
func experimentResults(ctx context.Context, db ledger.DB, x *experimentRow, environment string, refresh bool, now int64) (any, error) {
	if x.Status == "draft" {
		return nil, nil
	}
	if environment == "production" && x.Results != nil && x.ResultsAt != nil {
		age := now - *x.ResultsAt
		if !(refresh && age >= resultsRefreshMinMs) && (age < resultsFreshMs || x.Status == "stopped") {
			if v, err := jsobj.Parse([]byte(*x.Results)); err == nil {
				return v, nil
			}
		}
	}
	results, err := computeResults(ctx, db, x, environment, now)
	if err != nil {
		return nil, err
	}
	if environment == "production" {
		if _, err := db.Exec(ctx, "UPDATE experiment SET "+experimentResultsColumn+" = $1, results_at = $2 WHERE id = $3", jsobj.Stringify(results), now, x.ID); err != nil {
			return nil, err
		}
	}
	return results, nil
}
