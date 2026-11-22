package migration_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/openpurr/openpurr/standard/internal/clock"
	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
	"github.com/openpurr/openpurr/standard/internal/migration"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

// The Go list is spec/export-tables.json's, which Lite reads directly.
func TestTablesMatchSpec(t *testing.T) {
	raw, err := os.ReadFile("../../../spec/export-tables.json")
	if err != nil {
		t.Fatal(err)
	}
	var spec struct {
		Version int `json:"version"`
		Tables  []struct {
			Name           string   `json:"name"`
			Key            []string `json:"key"`
			Delta          *string  `json:"delta"`
			Where          string   `json:"where"`
			CustomerColumn string   `json:"customer_column"`
			Optional       []string `json:"optional"`
		} `json:"tables"`
	}
	if err := json.Unmarshal(raw, &spec); err != nil {
		t.Fatal(err)
	}
	if spec.Version != migration.Version {
		t.Errorf("spec version %d, Go %d", spec.Version, migration.Version)
	}
	if len(spec.Tables) != len(migration.Tables) {
		t.Fatalf("spec has %d tables, Go %d", len(spec.Tables), len(migration.Tables))
	}
	for i, s := range spec.Tables {
		g := migration.Tables[i]
		delta := ""
		if s.Delta != nil {
			delta = *s.Delta
		}
		if s.Name != g.Name || !reflect.DeepEqual(s.Key, g.Key) || delta != g.Delta || s.Where != g.Where ||
			s.CustomerColumn != g.CustomerColumn || !reflect.DeepEqual(s.Optional, g.Optional) {
			t.Errorf("table %d: spec %+v, Go %+v", i, s, g)
		}
	}
}

// writeBundle writes a bundle the way `openpurr export` does (cli/src/export.js), straight from a
// database: every table page by page, or for a delta the rows changed since `since` plus every
// row of the customers whose ledger version differs from `base` (and which customers are gone).
func writeBundle(t *testing.T, pool *pgxpool.Pool, kind string, since *int64, previous string, base map[string]float64) (string, map[string]float64) {
	t.Helper()
	ctx := context.Background()
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "tables"), 0o755); err != nil {
		t.Fatal(err)
	}
	id := ledger.NewUUID()
	var tables []any
	write := func(name, file string, rows []*jsobj.Object) map[string]any {
		var b strings.Builder
		for _, r := range rows {
			b.WriteString(jsobj.Stringify(r))
			b.WriteByte('\n')
		}
		if err := os.WriteFile(filepath.Join(dir, file), []byte(b.String()), 0o644); err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256([]byte(b.String()))
		e := map[string]any{"file": file, "rows": len(rows), "sha256": hex.EncodeToString(sum[:])}
		if name != "" {
			e["name"] = name
		}
		return e
	}
	all := func(req migration.PageRequest) []*jsobj.Object {
		var out []*jsobj.Object
		req.Limit = 2 // several pages even for small tables
		for {
			rows, next, err := migration.Page(ctx, pool, req)
			if err != nil {
				t.Fatal(err)
			}
			out = append(out, rows...)
			if next == nil {
				return out
			}
			req.After = next
			for i, v := range req.After {
				if f, ok := v.(float64); ok {
					req.After[i] = int64(f)
				}
			}
		}
	}
	versions := map[string]float64{}
	var changed []string
	var deleted []*jsobj.Object
	for i := range migration.Tables {
		tb := &migration.Tables[i]
		if kind == "delta" && tb.Delta == "" {
			continue
		}
		rows := all(migration.PageRequest{Table: tb, Since: since})
		if tb.Name == "customer" {
			var keep []*jsobj.Object
			for _, r := range rows {
				id, _ := r.Get("id")
				v, _ := r.Get("ledger_version")
				versions[id.(string)] = v.(float64)
				if old, ok := base[id.(string)]; kind == "full" || !ok || old != v.(float64) {
					keep = append(keep, r)
					changed = append(changed, id.(string))
				}
			}
			rows = keep
			if kind == "delta" {
				for id := range base {
					if _, ok := versions[id]; !ok {
						deleted = append(deleted, jsobj.New("id", id))
					}
				}
			}
		}
		if kind == "delta" && tb.CustomerColumn != "" && len(changed) > 0 {
			seen := map[string]bool{}
			key := func(r *jsobj.Object) string {
				var parts []string
				for _, k := range tb.Key {
					v, _ := r.Get(k)
					parts = append(parts, jsobj.Stringify(v))
				}
				return strings.Join(parts, "\x00")
			}
			for _, r := range rows {
				seen[key(r)] = true
			}
			for _, r := range all(migration.PageRequest{Table: tb, Customers: changed}) {
				if !seen[key(r)] {
					rows = append(rows, r)
				}
			}
		}
		tables = append(tables, write(tb.Name, "tables/"+tb.Name+".ndjson", rows))
	}
	m := map[string]any{
		"format": "openpurr-export", "version": 1, "id": id, "kind": kind, "created_at": "2027-01-15T08:00:00Z",
		"source":        map[string]any{"url": "http://source.test", "edition": "standard", "schema": "0004"},
		"started_at_ms": tu.T0, "options": map[string]any{"optional_columns": false}, "tables": tables,
	}
	if kind == "delta" {
		m["since_ms"] = *since
		m["previous_id"] = previous
		m["deleted_customers"] = write("", "deleted-customers.ndjson", deleted)
	}
	raw, _ := json.Marshal(m)
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	return dir, versions
}

func open(t *testing.T, dir string) *migration.Bundle {
	t.Helper()
	b, err := migration.OpenBundle(dir)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// infos is every customer's CustomerInfo at a fixed time, as `openpurr migrate verify` reads it.
func infos(t *testing.T, pool *pgxpool.Pool) map[string]string {
	t.Helper()
	ctx := context.Background()
	cfg, err := config.NewLoader(pool, clock.System{}, 0, nil, tu.Quiet).Get(ctx)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := pool.Query(ctx, "SELECT id FROM customer")
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for rows.Next() {
		var id string
		_ = rows.Scan(&id)
		ids = append(ids, id)
	}
	rows.Close()
	sort.Strings(ids)
	out := map[string]string{}
	list, err := migration.CustomerInfos(ctx, pool, cfg, ids, tu.T0+tu.Day)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range list {
		out[c.ProjectID+"/"+c.AppUserID] = jsobj.Stringify(c.Body)
	}
	return out
}

func count(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) int64 {
	t.Helper()
	var n int64
	if err := pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func seed(t *testing.T, env *tu.Env) {
	t.Helper()
	env.PostAppleTransaction("alice", nil)
	env.PostAppleTransaction("bob", tu.Fields{"productId": "lifetime", "type": "Non-Consumable"})
	env.PostAppleTransaction(tu.Anon, tu.Fields{"productId": "pro_annual"})
	env.Call("/v1/subscribers/alice/attributes", tu.CallOptions{Body: jsobj.New("attributes", jsobj.New("$email", jsobj.New("value", "alice@example.com", "updated_at_ms", float64(tu.T0))))})
	env.OwnerToken()
}

func TestFullImport(t *testing.T) {
	ctx := context.Background()
	src := tu.Start(t, tu.Options{})
	seed(t, src)
	dir, _ := writeBundle(t, src.Pool, "full", nil, "", nil)

	dst := tu.Pool(t)
	res, err := migration.Import(ctx, dst, open(t, dir), migration.Options{Now: func() int64 { return tu.T0 }})
	if err != nil {
		t.Fatal(err)
	}
	if res.Rows["customer"] != 3 || res.Snapshots != 3 {
		t.Errorf("rows %v, snapshots %d", res.Rows, res.Snapshots)
	}
	if got, want := infos(t, dst), infos(t, src.Pool); !reflect.DeepEqual(got, want) {
		t.Errorf("CustomerInfo differs:\n got %v\nwant %v", got, want)
	}
	for _, table := range []string{"operator", "access_token", "subscriber_attribute", "store_transaction", "config_version", "webhook_event"} {
		if a, b := count(t, src.Pool, "SELECT count(*) FROM "+table), count(t, dst, "SELECT count(*) FROM "+table); a != b {
			t.Errorf("%s: %d rows on the source, %d imported", table, a, b)
		}
	}
	if count(t, dst, "SELECT count(*) FROM customer_snapshot") != 3 {
		t.Error("snapshots weren't rebuilt")
	}
	if count(t, dst, "SELECT count(*) FROM metric_daily WHERE metric <> 'new_customers'") == 0 {
		t.Error("chart totals weren't rebuilt")
	}
	// New rows continue after the imported IDs.
	maxID := count(t, dst, "SELECT max(id) FROM store_transaction")
	var next int64
	if err := dst.QueryRow(ctx, "SELECT nextval(pg_get_serial_sequence('store_transaction', 'id'))").Scan(&next); err != nil {
		t.Fatal(err)
	}
	if next != maxID+1 {
		t.Errorf("next transaction ID %d, want %d", next, maxID+1)
	}

	// Once only, and never over data.
	if _, err := migration.Import(ctx, dst, open(t, dir), migration.Options{}); err == nil || !strings.Contains(err.Error(), "already imported") {
		t.Errorf("second import: %v", err)
	}
	other, _ := writeBundle(t, src.Pool, "full", nil, "", nil)
	if _, err := migration.Import(ctx, dst, open(t, other), migration.Options{}); err == nil || !strings.Contains(err.Error(), "already has data") {
		t.Errorf("import over data: %v", err)
	}
	if _, err := migration.Import(ctx, dst, open(t, other), migration.Options{Replace: true, SkipSnapshots: true}); err != nil {
		t.Errorf("--replace: %v", err)
	}
	if n := count(t, dst, "SELECT count(*) FROM customer"); n != 3 {
		t.Errorf("after --replace: %d customers", n)
	}
}

func TestImportRefusesDamagedBundles(t *testing.T) {
	ctx := context.Background()
	src := tu.Start(t, tu.Options{})
	seed(t, src)
	dir, _ := writeBundle(t, src.Pool, "full", nil, "", nil)
	f := filepath.Join(dir, "tables", "customer.ndjson")
	raw, _ := os.ReadFile(f)
	_ = os.WriteFile(f, []byte(strings.Replace(string(raw), `"first_seen":`, `"first_seen": `, 1)), 0o644)
	dst := tu.Pool(t)
	if _, err := migration.Import(ctx, dst, open(t, dir), migration.Options{}); err == nil || !strings.Contains(err.Error(), "SHA-256") {
		t.Fatalf("got %v", err)
	}
	if count(t, dst, "SELECT count(*) FROM customer") != 0 {
		t.Error("a failed import left rows behind")
	}

	dir, _ = writeBundle(t, src.Pool, "full", nil, "", nil)
	f = filepath.Join(dir, "tables", "setting.ndjson")
	_ = os.WriteFile(f, []byte(`{"key":"x","value":"y","updated_at":1,"color":"blue"}`+"\n"), 0o644)
	m, _ := os.ReadFile(filepath.Join(dir, "manifest.json"))
	var manifest map[string]any
	_ = json.Unmarshal(m, &manifest)
	for _, e := range manifest["tables"].([]any) {
		if e.(map[string]any)["name"] == "setting" {
			e.(map[string]any)["rows"] = 1
			e.(map[string]any)["sha256"] = ""
		}
	}
	m, _ = json.Marshal(manifest)
	_ = os.WriteFile(filepath.Join(dir, "manifest.json"), m, 0o644)
	if _, err := migration.Import(ctx, dst, open(t, dir), migration.Options{}); err == nil || !strings.Contains(err.Error(), "column color doesn't exist") {
		t.Fatalf("got %v", err)
	}
}

func TestDeltaImport(t *testing.T) {
	ctx := context.Background()
	src := tu.Start(t, tu.Options{})
	seed(t, src)
	full, versions := writeBundle(t, src.Pool, "full", nil, "", nil)
	dst := tu.Pool(t)
	if _, err := migration.Import(ctx, dst, open(t, full), migration.Options{}); err != nil {
		t.Fatal(err)
	}
	fullID := open(t, full).Manifest.ID

	// Changes on the source after the export: a renewal for alice, a new customer, the anonymous
	// customer logging in as bob (a merge, which deletes the anonymous customer), an attribute.
	src.Clock.Store(tu.T0 + 60_000)
	src.PostAppleTransaction("alice", tu.Fields{"productId": "pro_annual"})
	src.PostAppleTransaction("carol", nil)
	if r := src.Call("/v1/subscribers/identify", tu.CallOptions{Body: jsobj.New("app_user_id", tu.Anon, "new_app_user_id", "bob")}); r.Status != 200 && r.Status != 201 {
		t.Fatalf("identify: %d %s", r.Status, r.Body)
	}
	src.Call("/v1/subscribers/bob/attributes", tu.CallOptions{Body: jsobj.New("attributes", jsobj.New("$displayName", jsobj.New("value", "Bob", "updated_at_ms", float64(tu.T0+60_000))))})

	since := tu.T0 + 30_000
	delta, _ := writeBundle(t, src.Pool, "delta", &since, fullID, versions)
	res, err := migration.Import(ctx, dst, open(t, delta), migration.Options{})
	if err != nil {
		t.Fatal(err)
	}
	// alice (renewal), carol (new) and bob (merged into); the anonymous customer is gone.
	if res.ChangedCustomers != 3 || res.DeletedCustomers != 1 {
		t.Errorf("changed %d, deleted %d customers", res.ChangedCustomers, res.DeletedCustomers)
	}
	if got, want := infos(t, dst), infos(t, src.Pool); !reflect.DeepEqual(got, want) {
		t.Errorf("CustomerInfo differs after the delta:\n got %v\nwant %v", got, want)
	}
	if a, b := count(t, src.Pool, "SELECT count(*) FROM customer"), count(t, dst, "SELECT count(*) FROM customer"); a != b {
		t.Errorf("customers: source %d, target %d", a, b)
	}
	if a, b := count(t, src.Pool, "SELECT count(*) FROM subscriber_attribute"), count(t, dst, "SELECT count(*) FROM subscriber_attribute"); a != b {
		t.Errorf("attributes: source %d, target %d", a, b)
	}

	// A delta applies once, and only after the bundle it follows.
	if _, err := migration.Import(ctx, dst, open(t, delta), migration.Options{}); err == nil || !strings.Contains(err.Error(), "already imported") {
		t.Errorf("second delta: %v", err)
	}
	stray, _ := writeBundle(t, src.Pool, "delta", &since, "some-other-bundle", versions)
	if _, err := migration.Import(ctx, dst, open(t, stray), migration.Options{}); err == nil || !strings.Contains(err.Error(), "--force") {
		t.Errorf("out-of-order delta: %v", err)
	}
	// Forced, it changes nothing: the target already has these rows.
	if _, err := migration.Import(ctx, dst, open(t, stray), migration.Options{Force: true}); err != nil {
		t.Errorf("forced delta: %v", err)
	}
	if got, want := infos(t, dst), infos(t, src.Pool); !reflect.DeepEqual(got, want) {
		t.Errorf("CustomerInfo differs after a repeated delta")
	}
}
