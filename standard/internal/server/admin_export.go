package server

// The export API, /admin/v1/export: Lite's lite/src/office/export.ts, so `openpurr export` and
// `openpurr migrate verify` work against either edition (moving back to Lite, backups). The
// queries are in internal/migration.

import (
	"errors"
	"net/http"
	"strings"

	"github.com/openpurr/openpurr/standard/internal/db"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/migration"
)

// exportAllowed answers 403 unless the caller is an owner who sees every app.
func exportAllowed(q *adminReq) bool {
	if q.p.op.Role != "owner" || !q.p.can(permSettingsManage) || q.p.apps != nil {
		q.forbidden("Only owners who see every app can export (with a token: the admin scope).")
		return false
	}
	return true
}

// GET (and POST, which records the start of an export in the audit log) /admin/v1/export.
func adminExportInfo(q *adminReq) {
	if !exportAllowed(q) {
		return
	}
	if q.r.Method == http.MethodPost {
		since, _ := q.prop("since")
		if _, ok := since.(float64); !ok {
			since = nil
		}
		if err := q.audit(q.s.Pool, "data.exported", nil, jsobj.New("since", since)); err != nil {
			q.internal(err)
			return
		}
	}
	var schema *string
	if err := q.s.Pool.QueryRow(q.ctx, "SELECT max(version) FROM "+db.MigrationsTable).Scan(&schema); err != nil {
		q.internal(err)
		return
	}
	var schemaValue any
	if schema != nil {
		schemaValue = *schema
	}
	// What the CLI needs to page each table and to make deltas.
	tables := make([]any, len(migration.Tables))
	for i, t := range migration.Tables {
		key := make([]any, len(t.Key))
		for j, k := range t.Key {
			key[j] = k
		}
		var customerColumn any
		if t.CustomerColumn != "" {
			customerColumn = t.CustomerColumn
		}
		tables[i] = jsobj.New("name", t.Name, "key", key, "delta", t.Delta != "", "customer_column", customerColumn)
	}
	q.json(http.StatusOK, jsobj.New(
		"format", migration.Format, "version", float64(migration.Version), "edition", Edition,
		"schema", schemaValue, "now", float64(q.now), "tables", tables))
}

// GET /admin/v1/export/tables/{table}.
func adminExportTable(q *adminReq) {
	if !exportAllowed(q) {
		return
	}
	t := migration.TableNamed(q.params["table"])
	if t == nil {
		q.fail(http.StatusNotFound, "not_found", "No such export table.")
		return
	}
	req := migration.PageRequest{Table: t, Limit: 500, Optional: q.query("optional") == "1"}
	if q.hasQuery("limit") {
		n := jsNumber(q.query("limit"))
		switch {
		case n != n || n < 1:
			req.Limit = 500
		case n > migration.MaxPage:
			req.Limit = migration.MaxPage
		default:
			req.Limit = int(n)
		}
	}
	if q.hasQuery("customers") {
		req.Customers = []string{}
		for _, id := range strings.Split(q.query("customers"), ",") {
			if id != "" {
				req.Customers = append(req.Customers, id)
			}
		}
	} else if q.hasQuery("since") {
		n := jsNumber(q.query("since"))
		if n != n || n < 0 {
			q.bad("since must be epoch milliseconds.")
			return
		}
		since := int64(n)
		req.Since = &since
	}
	if after := q.query("after"); after != "" {
		list, err := migration.ParseAfter(after)
		if err != nil {
			q.bad(err.Error())
			return
		}
		req.After = list
	}
	rows, next, err := migration.Page(q.ctx, q.s.Pool, req)
	var bad *migration.ErrBadRequest
	if errors.As(err, &bad) {
		q.bad(bad.Message)
		return
	}
	if err != nil {
		q.internal(err)
		return
	}
	list := make([]any, len(rows))
	for i, r := range rows {
		list[i] = r
	}
	var nextValue any
	if next != nil {
		nextValue = next
	}
	q.json(http.StatusOK, jsobj.New("rows", list, "next", nextValue))
}

// GET /admin/v1/export/customer-info?ids=a,b&at=ms.
func adminExportCustomerInfo(q *adminReq) {
	if !exportAllowed(q) {
		return
	}
	var ids []string
	for _, id := range strings.Split(q.query("ids"), ",") {
		if id != "" {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 || len(ids) > migration.MaxIDs {
		q.bad("ids takes 1 to 100 customer IDs.")
		return
	}
	at := q.now
	if q.hasQuery("at") {
		n := jsNumber(q.query("at"))
		if n != n {
			q.bad("at must be epoch milliseconds.")
			return
		}
		at = int64(n)
	}
	infos, err := migration.CustomerInfos(q.ctx, q.s.Pool, q.cfg, ids, at)
	if err != nil {
		q.internal(err)
		return
	}
	list := make([]any, len(infos))
	for i, c := range infos {
		var body any
		if c.Body != nil {
			body = c.Body
		}
		list[i] = jsobj.New("id", c.ID, "project_id", c.ProjectID, "app_user_id", c.AppUserID, "customer_info", body)
	}
	q.json(http.StatusOK, jsobj.New("at", float64(at), "customers", list))
}
