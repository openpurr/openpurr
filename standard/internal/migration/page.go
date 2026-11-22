package migration

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/customerinfo"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
)

// Limits of one export request, as in Lite.
const (
	MaxPage = 5000
	MaxIDs  = 100
)

// PageRequest is one page of GET /admin/v1/export/tables/{table}.
type PageRequest struct {
	Table *Table
	Limit int
	// The previous page's next: the key of its last row.
	After []any
	// A delta: rows the table's delta filter takes since this time (epoch ms).
	Since *int64
	// Every row of these customers (tables with a customer column).
	Customers []string
	// Include the optional columns.
	Optional bool
}

// ErrBadRequest is a request the caller got wrong; its message says how.
type ErrBadRequest struct{ Message string }

func (e *ErrBadRequest) Error() string { return e.Message }

// sinceParam finds a delta filter's parameters.
var sinceParam = regexp.MustCompile(`:since_day|:since`)

// dayOf is the UTC date of an epoch-ms time.
func dayOf(ms int64) string { return time.UnixMilli(ms).UTC().Format("2006-01-02") }

// Page reads one page of a table in key order. next is nil on the last page.
func Page(ctx context.Context, db ledger.DB, req PageRequest) (rows []*jsobj.Object, next []any, err error) {
	t := req.Table
	cols, err := Columns(ctx, db, t.Name)
	if err != nil {
		return nil, nil, err
	}
	var args []any
	p := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}
	var conds []string
	if t.Where != "" {
		conds = append(conds, "("+t.Where+")")
	}
	switch {
	case req.Customers != nil:
		if t.CustomerColumn == "" {
			return nil, nil, &ErrBadRequest{t.Name + " has no customer column."}
		}
		if len(req.Customers) == 0 || len(req.Customers) > MaxIDs {
			return nil, nil, &ErrBadRequest{fmt.Sprintf("customers takes 1 to %d IDs.", MaxIDs)}
		}
		conds = append(conds, quote(t.CustomerColumn)+" = ANY("+p(req.Customers)+"::text[])")
	case req.Since != nil:
		if t.Delta == "" {
			return nil, nil, nil
		}
		if t.Delta != "all" {
			since := *req.Since
			cond := sinceParam.ReplaceAllStringFunc(t.Delta, func(m string) string {
				if m == ":since" {
					return p(since) + "::bigint"
				}
				return p(dayOf(since))
			})
			conds = append(conds, "("+cond+")")
		}
	}
	if req.After != nil {
		if len(req.After) != len(t.Key) {
			return nil, nil, &ErrBadRequest{"after must be the previous page's next."}
		}
		left := make([]string, len(t.Key))
		right := make([]string, len(t.Key))
		for i, k := range t.Key {
			left[i] = quote(k)
			right[i] = p(req.After[i])
		}
		if len(t.Key) == 1 {
			conds = append(conds, left[0]+" > "+right[0])
		} else {
			conds = append(conds, "("+strings.Join(left, ", ")+") > ("+strings.Join(right, ", ")+")")
		}
	}

	optional := map[string]bool{}
	if !req.Optional {
		for _, c := range t.Optional {
			optional[c] = true
		}
	}
	sel := make([]string, len(cols))
	for i, c := range cols {
		if optional[c.Name] {
			sel[i] = "NULL AS " + quote(c.Name)
		} else {
			sel[i] = quote(c.Name)
		}
	}
	keys := make([]string, len(t.Key))
	for i, k := range t.Key {
		keys[i] = quote(k)
	}
	sql := "SELECT " + strings.Join(sel, ", ") + " FROM " + quote(t.Name)
	if len(conds) > 0 {
		sql += " WHERE " + strings.Join(conds, " AND ")
	}
	sql += " ORDER BY " + strings.Join(keys, ", ") + " LIMIT " + p(req.Limit)

	pgRows, err := db.Query(ctx, sql, args...)
	if err != nil {
		return nil, nil, err
	}
	defer pgRows.Close()
	names := make([]string, len(pgRows.FieldDescriptions()))
	for i, f := range pgRows.FieldDescriptions() {
		names[i] = f.Name
	}
	for pgRows.Next() {
		values, err := pgRows.Values()
		if err != nil {
			return nil, nil, err
		}
		o := jsobj.New()
		for i, v := range values {
			o.Set(names[i], jsValue(v))
		}
		rows = append(rows, o)
	}
	if err := pgRows.Err(); err != nil {
		return nil, nil, err
	}
	if len(rows) == req.Limit {
		last := rows[len(rows)-1]
		for _, k := range t.Key {
			v, _ := last.Get(k)
			next = append(next, v)
		}
	}
	return rows, next, nil
}

// jsValue is a column value as Lite's JSON has it: numbers as float64.
func jsValue(v any) any {
	switch x := v.(type) {
	case int64:
		return float64(x)
	case int32:
		return float64(x)
	case int16:
		return float64(x)
	}
	return v
}

// ParseAfter reads a page cursor (a JSON array of key values); whole numbers become int64, so
// they compare with bigint keys.
func ParseAfter(raw string) ([]any, error) {
	v, err := jsobj.Parse([]byte(raw))
	if err != nil {
		return nil, &ErrBadRequest{"after must be the previous page's next."}
	}
	list, ok := v.([]any)
	if !ok {
		return nil, &ErrBadRequest{"after must be the previous page's next."}
	}
	for i, x := range list {
		if f, ok := x.(float64); ok && f == float64(int64(f)) {
			list[i] = int64(f)
		}
	}
	return list, nil
}

// CustomerInfo is one customer's CustomerInfo, by customer ID, for `openpurr migrate verify`.
type CustomerInfo struct {
	ID, ProjectID, AppUserID string
	// nil when the customer's project isn't in the config.
	Body *jsobj.Object
}

// CustomerInfos renders each customer's CustomerInfo at `at`, as the SDK would get it: from the
// snapshot when it's current, else computed from the ledger (never written). Unknown IDs are
// left out; the rest come in ID order.
func CustomerInfos(ctx context.Context, db ledger.DB, cfg *config.Config, ids []string, at int64) ([]CustomerInfo, error) {
	rows, err := db.Query(ctx,
		`SELECT c.id, c.project_id, c.app_user_id, s.body, s.config_version
		 FROM customer c LEFT JOIN customer_snapshot s ON s.customer_id = c.id AND s.ledger_version = c.ledger_version
		 WHERE c.id = ANY($1::text[]) ORDER BY c.id`, ids)
	if err != nil {
		return nil, err
	}
	type found struct {
		id, project, appUserID string
		body, version          *string
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (found, error) {
		var f found
		err := r.Scan(&f.id, &f.project, &f.appUserID, &f.body, &f.version)
		return f, err
	})
	if err != nil {
		return nil, err
	}
	out := make([]CustomerInfo, 0, len(list))
	for _, f := range list {
		info := CustomerInfo{ID: f.id, ProjectID: f.project, AppUserID: f.appUserID}
		project := cfg.Projects[f.project]
		if project == nil {
			out = append(out, info)
			continue
		}
		var snapshot *jsobj.Object
		if f.body != nil && f.version != nil && *f.version == project.Version {
			if parsed, err := jsobj.Parse([]byte(*f.body)); err == nil && jsobj.IsObject(parsed) {
				snapshot = parsed.(*jsobj.Object)
			}
		}
		if snapshot == nil {
			loaded, err := ledger.LoadCustomerByID(ctx, db, f.id)
			if err != nil {
				return nil, err
			}
			if loaded.Customer == nil {
				continue // deleted in the meantime
			}
			snapshot = customerinfo.ComputeSnapshot(f.appUserID, loaded, project, at)
		}
		info.Body = customerinfo.Render(snapshot, project, customerinfo.RenderOptions{Now: at})
		out = append(out, info)
	}
	return out, nil
}
