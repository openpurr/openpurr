package migration

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/openpurr/openpurr/standard/internal/clock"
	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/customerinfo"
	"github.com/openpurr/openpurr/standard/internal/metrics"
)

// stateKey is the job_state row that records which bundles this database has imported.
const stateKey = "migration_import"

// Options for Import.
type Options struct {
	// Full import: erase a database that already has customers, purchases, operators or keys.
	Replace bool
	// Delta: apply it even if it doesn't follow the last bundle imported.
	Force bool
	// Skip rebuilding CustomerInfo snapshots (reads then compute from the ledger until the
	// server's backfill job has built them).
	SkipSnapshots bool
	// Snapshot rebuilds at once (default 8).
	Concurrency int
	// Progress lines; nil for none.
	Progress io.Writer
	Now      func() int64
}

// Result says what an import did.
type Result struct {
	Kind              string
	Rows              map[string]int64
	ChangedCustomers  int
	DeletedCustomers  int
	KeptCustomers     []string // deleted on the source but still holding purchases or grants here
	Snapshots         int
	MetricRows        int64
	LoadTime, Rebuild time.Duration
}

func (o *Options) progress(format string, args ...any) {
	if o.Progress != nil {
		fmt.Fprintf(o.Progress, format+"\n", args...)
	}
}

type importState struct {
	Bundles []string `json:"bundles"`
	Last    string   `json:"last"`
	Source  string   `json:"source"`
}

func readState(ctx context.Context, q pgx.Tx) (*importState, error) {
	var raw string
	err := q.QueryRow(ctx, "SELECT value FROM job_state WHERE key = $1", stateKey).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var st importState
	if err := json.Unmarshal([]byte(raw), &st); err != nil {
		return nil, fmt.Errorf("job_state %s: %w", stateKey, err)
	}
	return &st, nil
}

func writeState(ctx context.Context, tx pgx.Tx, st *importState, now int64) error {
	raw, _ := json.Marshal(st)
	_, err := tx.Exec(ctx,
		`INSERT INTO job_state (key, value, updated_at) VALUES ($1, $2, $3)
		 ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, stateKey, string(raw), now)
	return err
}

// Import loads a bundle, then rebuilds what's derived from it: the chart totals and the
// CustomerInfo snapshots. The load is one transaction: it either all happens or none of it, so a
// failed import can be run again. A bundle is imported once.
func Import(ctx context.Context, pool *pgxpool.Pool, b *Bundle, opts Options) (*Result, error) {
	if opts.Now == nil {
		opts.Now = func() int64 { return time.Now().UnixMilli() }
	}
	if opts.Concurrency <= 0 {
		opts.Concurrency = 8
	}
	res := &Result{Kind: b.Manifest.Kind, Rows: map[string]int64{}}
	start := time.Now()
	var affected []string // customers whose snapshots to rebuild; nil = everyone
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		// One import at a time (the key is "migrate" in ASCII).
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(0x6d696772617465)"); err != nil {
			return err
		}
		st, err := readState(ctx, tx)
		if err != nil {
			return err
		}
		if st != nil {
			for _, id := range st.Bundles {
				if id == b.Manifest.ID {
					return fmt.Errorf("this bundle (%s) was already imported", id)
				}
			}
		}
		if b.Manifest.Kind == "full" {
			if err := loadFull(ctx, tx, b, &opts, res); err != nil {
				return err
			}
			st = &importState{Source: b.Manifest.Source.URL}
		} else {
			if st == nil {
				return errors.New("import a full bundle first: this database has none")
			}
			if !opts.Force && (b.Manifest.PreviousID == nil || *b.Manifest.PreviousID != st.Last) {
				return fmt.Errorf("this delta follows bundle %s, but the last one imported here is %s (pass --force to apply it anyway)", deref(b.Manifest.PreviousID), st.Last)
			}
			affected, err = loadDelta(ctx, tx, b, &opts, res)
			if err != nil {
				return err
			}
		}
		st.Bundles = append(st.Bundles, b.Manifest.ID)
		st.Last = b.Manifest.ID
		return writeState(ctx, tx, st, opts.Now())
	})
	if err != nil {
		return nil, err
	}
	res.LoadTime = time.Since(start)

	start = time.Now()
	opts.progress("Rebuilding the chart totals from the ledger...")
	rolled, err := metrics.Rollup(ctx, pool, opts.Now(), true)
	if err != nil {
		return nil, fmt.Errorf("rebuilding the chart totals: %w", err)
	}
	res.MetricRows = rolled.Rows
	if !opts.SkipSnapshots {
		n, err := RebuildSnapshots(ctx, pool, affected, &opts)
		if err != nil {
			return nil, err
		}
		res.Snapshots = n
	}
	res.Rebuild = time.Since(start)
	return res, nil
}

func deref(s *string) string {
	if s == nil {
		return "(none)"
	}
	return *s
}

// Tables a full import empties first: the bundle's, and what's derived from them or short-lived.
var derivedTables = []string{"customer_snapshot", "metric_daily_country", "login_link", "oauth_request", "capture"}

// Tables whose identity sequence continues after the imported IDs.
var identityTables = []string{"config_version", "audit_log", "store_transaction", "capture"}

func loadFull(ctx context.Context, tx pgx.Tx, b *Bundle, opts *Options, res *Result) error {
	if !opts.Replace {
		var customers, purchases, operators, keys int64
		if err := tx.QueryRow(ctx,
			`SELECT (SELECT count(*) FROM customer), (SELECT count(*) FROM store_transaction),
			        (SELECT count(*) FROM operator), (SELECT count(*) FROM api_key)`).Scan(&customers, &purchases, &operators, &keys); err != nil {
			return err
		}
		if customers+purchases+operators+keys > 0 {
			return fmt.Errorf("this database already has data (%d customers, %d transactions, %d operators, %d secret keys). "+
				"Import into a new database, or pass --replace to erase it first", customers, purchases, operators, keys)
		}
	}
	names := make([]string, 0, len(Tables)+len(derivedTables))
	for _, t := range Tables {
		names = append(names, quote(t.Name))
	}
	for _, t := range derivedTables {
		names = append(names, quote(t))
	}
	if _, err := tx.Exec(ctx, "TRUNCATE "+strings.Join(names, ", ")+" RESTART IDENTITY CASCADE"); err != nil {
		return err
	}
	for i := range Tables {
		t := &Tables[i]
		e := b.Entry(t.Name)
		if e == nil {
			continue
		}
		n, err := copyTable(ctx, tx, b, t, e)
		if err != nil {
			return fmt.Errorf("importing %s: %w", t.Name, err)
		}
		res.Rows[t.Name] = n
		opts.progress("  %-22s %d rows", t.Name, n)
	}
	for _, t := range identityTables {
		if _, err := tx.Exec(ctx, fmt.Sprintf(
			`SELECT setval(pg_get_serial_sequence('%[1]s', 'id'), coalesce((SELECT max(id) FROM %[1]s), 1), (SELECT max(id) FROM %[1]s) IS NOT NULL)`, t)); err != nil {
			return err
		}
	}
	// The chart totals are rebuilt from the ledger; new_customers, which can't be (the cleanup job
	// deletes old non-buyers), came with the bundle and is counted on from the source's last run.
	_, err := tx.Exec(ctx, `UPDATE job_state SET value = jsonb_set(value::jsonb, '{rebuild}', 'true')::text WHERE key = 'metrics_rollup'`)
	return err
}

// convert turns a bundle value into one for a column of this type.
func convert(v any, col Column) (any, error) {
	if v == nil {
		return nil, nil
	}
	switch col.Type {
	case "bigint", "integer", "smallint":
		switch x := v.(type) {
		case json.Number:
			if n, err := x.Int64(); err == nil {
				return n, nil
			}
			f, err := x.Float64()
			if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
				return nil, fmt.Errorf("%s: %q isn't a number", col.Name, x)
			}
			return int64(f), nil // D1 keeps fractions in integer columns; Postgres truncates them
		case string:
			if n, err := strconv.ParseInt(x, 10, 64); err == nil {
				return n, nil
			}
			return nil, fmt.Errorf("%s: %q isn't a whole number", col.Name, x)
		case bool:
			if x {
				return int64(1), nil
			}
			return int64(0), nil
		}
	case "double precision", "real", "numeric":
		switch x := v.(type) {
		case json.Number:
			return x.Float64()
		case string:
			return strconv.ParseFloat(x, 64)
		}
	case "text":
		switch x := v.(type) {
		case string:
			return x, nil
		case json.Number:
			return x.String(), nil // as D1 stores a number in a text column
		case bool:
			if x {
				return "1", nil
			}
			return "0", nil
		}
	}
	return nil, fmt.Errorf("%s: can't store %T in a %s column", col.Name, v, col.Type)
}

// rowValues lines a row up with the columns, refusing columns this database doesn't have.
func rowValues(row map[string]any, cols []Column, known map[string]bool) ([]any, error) {
	for k := range row {
		if !known[k] {
			return nil, fmt.Errorf("column %s doesn't exist here (a newer openpurr?)", k)
		}
	}
	values := make([]any, len(cols))
	for i, c := range cols {
		v, err := convert(row[c.Name], c)
		if err != nil {
			return nil, err
		}
		values[i] = v
	}
	return values, nil
}

// importColumns are a table's columns that a bundle's first row has (an older bundle may lack
// newer columns, which then get their defaults).
func importColumns(ctx context.Context, tx pgx.Tx, table string, first map[string]any) ([]Column, map[string]bool, error) {
	all, err := Columns(ctx, tx, table)
	if err != nil {
		return nil, nil, err
	}
	known := map[string]bool{}
	var cols []Column
	for _, c := range all {
		known[c.Name] = true
		if _, ok := first[c.Name]; ok {
			cols = append(cols, c)
		}
	}
	return cols, known, nil
}

type copySource struct {
	rows   *Rows
	first  map[string]any
	cols   []Column
	known  map[string]bool
	values []any
	err    error
	done   bool
	count  int64
}

func (s *copySource) Next() bool {
	var row map[string]any
	if s.first != nil {
		row, s.first = s.first, nil
	} else {
		row, s.err = s.rows.Next()
		if s.err != nil || row == nil {
			s.done = s.err == nil
			return false
		}
	}
	s.values, s.err = rowValues(row, s.cols, s.known)
	if s.err != nil {
		s.err = fmt.Errorf("line %d: %w", s.rows.Line(), s.err)
		return false
	}
	s.count++
	return true
}

func (s *copySource) Values() ([]any, error) { return s.values, nil }
func (s *copySource) Err() error             { return s.err }

func copyTable(ctx context.Context, tx pgx.Tx, b *Bundle, t *Table, e *FileEntry) (int64, error) {
	rows, err := b.Open(e)
	if err != nil {
		return 0, err
	}
	first, err := rows.Next()
	if err != nil || first == nil {
		if err == nil {
			err = rows.Close(true)
		} else {
			rows.Close(false)
		}
		return 0, err
	}
	cols, known, err := importColumns(ctx, tx, t.Name, first)
	if err != nil {
		rows.Close(false)
		return 0, err
	}
	names := make([]string, len(cols))
	for i, c := range cols {
		names[i] = c.Name
	}
	src := &copySource{rows: rows, first: first, cols: cols, known: known}
	if _, err := tx.CopyFrom(ctx, pgx.Identifier{t.Name}, names, src); err != nil {
		rows.Close(false)
		if src.err != nil {
			return 0, src.err
		}
		return 0, err
	}
	if src.err != nil {
		rows.Close(false)
		return 0, src.err
	}
	return src.count, rows.Close(true)
}

// --- deltas --------------------------------------------------------------------------------------

// conflict is how a delta row meets a row that's already here. The source's newer facts win
// (a later updated_at, more delivery attempts, a revocation); rows the target changed since are
// kept where a column says which is newer. See spec/export-bundle.md.
var conflict = map[string]string{
	"setting": `ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
		WHERE excluded.updated_at > setting.updated_at`,
	"operator": `ON CONFLICT (id) DO UPDATE SET email = excluded.email, name = excluded.name, role = excluded.role,
		app_ids = excluded.app_ids, password_hash = excluded.password_hash, totp_secret = excluded.totp_secret,
		totp_enabled = excluded.totp_enabled, totp_last_step = greatest(operator.totp_last_step, excluded.totp_last_step),
		locale = excluded.locale, disabled_at = coalesce(operator.disabled_at, excluded.disabled_at),
		last_login_at = greatest(operator.last_login_at, excluded.last_login_at)`,
	"access_token": `ON CONFLICT (id) DO UPDATE SET revoked_at = coalesce(access_token.revoked_at, excluded.revoked_at),
		expires_at = least(access_token.expires_at, excluded.expires_at), last_used_at = greatest(access_token.last_used_at, excluded.last_used_at)`,
	"api_key": `ON CONFLICT (id) DO UPDATE SET revoked_at = coalesce(api_key.revoked_at, excluded.revoked_at),
		expires_at = least(api_key.expires_at, excluded.expires_at), last_used_at = greatest(api_key.last_used_at, excluded.last_used_at)`,
	"oauth_grant": `ON CONFLICT (id) DO UPDATE SET access_hash = excluded.access_hash, access_expires_at = excluded.access_expires_at,
		refresh_hash = excluded.refresh_hash, refresh_expires_at = excluded.refresh_expires_at, last_used_at = excluded.last_used_at,
		revoked_at = coalesce(oauth_grant.revoked_at, excluded.revoked_at)
		WHERE coalesce(excluded.last_used_at, 0) > coalesce(oauth_grant.last_used_at, 0) OR (excluded.revoked_at IS NOT NULL AND oauth_grant.revoked_at IS NULL)`,
	"customer_alias": `ON CONFLICT (project_id, app_user_id) DO UPDATE SET customer_id = excluded.customer_id`,
	"subscriber_attribute": `ON CONFLICT (customer_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at,
		received_at = excluded.received_at WHERE excluded.updated_at > subscriber_attribute.updated_at`,
	"store_transaction": `ON CONFLICT (store, transaction_id) DO UPDATE SET %s WHERE excluded.updated_at > store_transaction.updated_at`,
	"purchase_owner": `ON CONFLICT (store, original_transaction_id) DO UPDATE SET customer_id = excluded.customer_id,
		app_id = excluded.app_id, updated_at = excluded.updated_at WHERE excluded.updated_at >= purchase_owner.updated_at`,
	"subscription_state": `ON CONFLICT (store, original_transaction_id) DO UPDATE SET %s WHERE excluded.updated_at > subscription_state.updated_at`,
	"promotional_grant": `ON CONFLICT (id) DO UPDATE SET customer_id = excluded.customer_id,
		revoked_at = coalesce(promotional_grant.revoked_at, excluded.revoked_at), revoked_by = coalesce(promotional_grant.revoked_by, excluded.revoked_by)`,
	"webhook_delivery": `ON CONFLICT (event_id, endpoint) DO UPDATE SET status = excluded.status, attempts = excluded.attempts,
		next_attempt_at = excluded.next_attempt_at, last_status = excluded.last_status, last_error = excluded.last_error,
		delivered_at = excluded.delivered_at
		WHERE excluded.attempts > webhook_delivery.attempts OR (excluded.status = 'delivered' AND webhook_delivery.status <> 'delivered')`,
}

// Tables whose IDs the target hands out itself: a delta's rows get new ones, and a row the same as
// one already here is skipped.
var renumbered = map[string]string{
	"config_version": "created_at, document",
	"audit_log":      "at, action, operator_id, target, details, source",
}

func deltaSQL(table string, cols []Column) string {
	names := make([]string, 0, len(cols))
	for _, c := range cols {
		if (table == "store_transaction" || renumbered[table] != "") && c.Name == "id" {
			continue
		}
		names = append(names, quote(c.Name))
	}
	params := make([]string, len(names))
	for i := range names {
		params[i] = "$" + strconv.Itoa(i+1)
	}
	if same, ok := renumbered[table]; ok {
		var match []string
		for _, c := range strings.Split(same, ", ") {
			for i, n := range names {
				if n == quote(c) {
					match = append(match, fmt.Sprintf("t.%s IS NOT DISTINCT FROM $%d", n, i+1))
				}
			}
		}
		casts := make([]string, len(names))
		for i, n := range names {
			for _, c := range cols {
				if quote(c.Name) == n {
					casts[i] = params[i] + "::" + c.Type
				}
			}
		}
		return fmt.Sprintf("INSERT INTO %s (%s) SELECT %s WHERE NOT EXISTS (SELECT 1 FROM %s t WHERE %s)",
			quote(table), strings.Join(names, ", "), strings.Join(casts, ", "), quote(table), strings.Join(match, " AND "))
	}
	clause, ok := conflict[table]
	if !ok {
		clause = "ON CONFLICT DO NOTHING"
	} else if strings.Contains(clause, "%s") {
		var set []string
		for _, n := range names {
			set = append(set, n+" = excluded."+n)
		}
		clause = fmt.Sprintf(clause, strings.Join(set, ", "))
	}
	return fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s) %s", quote(table), strings.Join(names, ", "), strings.Join(params, ", "), clause)
}

func loadDelta(ctx context.Context, tx pgx.Tx, b *Bundle, opts *Options, res *Result) ([]string, error) {
	changed := map[string]bool{}
	if e := b.Entry("customer"); e != nil {
		if err := b.Each(e, func(row map[string]any) error {
			if id, ok := row["id"].(string); ok {
				changed[id] = true
			}
			return nil
		}); err != nil {
			return nil, err
		}
	}
	res.ChangedCustomers = len(changed)
	var chains [][2]string // purchase chains whose transactions or state changed
	for i := range Tables {
		t := &Tables[i]
		e := b.Entry(t.Name)
		if e == nil {
			continue
		}
		if t.Delta == "" {
			return nil, fmt.Errorf("a delta can't hold %s", t.Name)
		}
		all, err := Columns(ctx, tx, t.Name)
		if err != nil {
			return nil, err
		}
		known := map[string]bool{}
		for _, c := range all {
			known[c.Name] = true
		}
		var cols []Column
		var sql string
		batch := &pgx.Batch{}
		flush := func() error {
			if batch.Len() == 0 {
				return nil
			}
			err := tx.SendBatch(ctx, batch).Close()
			batch = &pgx.Batch{}
			return err
		}
		var n int64
		err = b.Each(e, func(row map[string]any) error {
			if cols == nil {
				for _, c := range all {
					if _, ok := row[c.Name]; ok {
						cols = append(cols, c)
					}
				}
				sql = deltaSQL(t.Name, cols)
			}
			values, err := rowValues(row, cols, known)
			if err != nil {
				return err
			}
			if t.Name == "store_transaction" || renumbered[t.Name] != "" {
				for i, c := range cols {
					if c.Name == "id" {
						values = append(values[:i:i], values[i+1:]...)
						break
					}
				}
			}
			if t.Name == "store_transaction" || t.Name == "subscription_state" {
				s, _ := row["store"].(string)
				o, _ := row["original_transaction_id"].(string)
				chains = append(chains, [2]string{s, o})
			}
			batch.Queue(sql, values...)
			n++
			if batch.Len() >= 500 {
				return flush()
			}
			return nil
		})
		if err == nil {
			err = flush()
		}
		if err != nil {
			return nil, fmt.Errorf("importing %s: %w", t.Name, err)
		}
		res.Rows[t.Name] = n
		opts.progress("  %-22s %d rows", t.Name, n)
	}

	// Customers the source deleted (merged into another, or cleaned up as inactive): deleted here
	// too, unless something still points at them.
	if e := b.Manifest.DeletedCustomers; e != nil {
		err := b.Each(e, func(row map[string]any) error {
			id, _ := row["id"].(string)
			var held bool
			if err := tx.QueryRow(ctx,
				`SELECT EXISTS (SELECT 1 FROM purchase_owner WHERE customer_id = $1) OR EXISTS (SELECT 1 FROM promotional_grant WHERE customer_id = $1)`,
				id).Scan(&held); err != nil {
				return err
			}
			if held {
				res.KeptCustomers = append(res.KeptCustomers, id)
				return nil
			}
			for _, sql := range []string{
				"DELETE FROM customer_snapshot WHERE customer_id = $1",
				"DELETE FROM subscriber_attribute WHERE customer_id = $1",
				"DELETE FROM customer_alias WHERE customer_id = $1",
			} {
				if _, err := tx.Exec(ctx, sql, id); err != nil {
					return err
				}
			}
			tag, err := tx.Exec(ctx, "DELETE FROM customer WHERE id = $1", id)
			if err != nil {
				return err
			}
			res.DeletedCustomers += int(tag.RowsAffected())
			delete(changed, id)
			return nil
		})
		if err != nil {
			return nil, err
		}
	}

	// Whose CustomerInfo may have changed: the changed customers and the owners of changed chains.
	for _, c := range chains {
		var owner string
		err := tx.QueryRow(ctx, "SELECT customer_id FROM purchase_owner WHERE store = $1 AND original_transaction_id = $2", c[0], c[1]).Scan(&owner)
		if err == nil {
			changed[owner] = true
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	}
	affected := make([]string, 0, len(changed))
	for id := range changed {
		affected = append(affected, id)
	}
	sort.Strings(affected)
	if _, err := tx.Exec(ctx, "UPDATE customer SET ledger_version = ledger_version + 1 WHERE id = ANY($1::text[])", affected); err != nil {
		return nil, err
	}
	// Chart totals: rebuilt in full, with new customers recounted from the delta's first day.
	if _, err := tx.Exec(ctx,
		`UPDATE job_state SET value = jsonb_set(jsonb_set(value::jsonb, '{rebuild}', 'true'), '{at}',
		   to_jsonb(least((value::jsonb->>'at')::bigint, $1::bigint)))::text WHERE key = 'metrics_rollup'`, *b.Manifest.SinceMs); err != nil {
		return nil, err
	}
	return affected, nil
}

// --- rebuilding ------------------------------------------------------------------------------------

// RebuildSnapshots builds the CustomerInfo snapshot of these customers (nil: every customer) with
// the current config. It returns how many it built.
func RebuildSnapshots(ctx context.Context, pool *pgxpool.Pool, ids []string, opts *Options) (int, error) {
	if opts.Now == nil {
		opts.Now = func() int64 { return time.Now().UnixMilli() }
	}
	if opts.Concurrency <= 0 {
		opts.Concurrency = 8
	}
	cfg, err := config.NewLoader(pool, clock.System{}, 0, nil, slog.New(slog.NewTextHandler(io.Discard, nil))).Get(ctx)
	if err != nil {
		return 0, fmt.Errorf("loading the config: %w", err)
	}
	if ids == nil {
		rows, err := pool.Query(ctx, "SELECT id FROM customer ORDER BY id")
		if err != nil {
			return 0, err
		}
		ids, err = pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return 0, err
		}
	}
	opts.progress("Building CustomerInfo snapshots for %d customers...", len(ids))
	work := make(chan string)
	var (
		mu    sync.Mutex
		built int
		first error
		wg    sync.WaitGroup
	)
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	for w := 0; w < opts.Concurrency; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for id := range work {
				r, err := customerinfo.Refresh(ctx, pool, cfg, id, opts.Now())
				mu.Lock()
				if err != nil && first == nil {
					first = fmt.Errorf("building the snapshot of customer %s: %w", id, err)
					cancel()
				} else if r != nil {
					built++
					if built%10000 == 0 {
						opts.progress("  %d of %d", built, len(ids))
					}
				}
				mu.Unlock()
			}
		}()
	}
	for _, id := range ids {
		select {
		case work <- id:
		case <-ctx.Done():
		}
	}
	close(work)
	wg.Wait()
	return built, first
}
