// Package migration moves a deployment between editions: the export API's queries (served at
// /admin/v1/export, as Lite does), and `openpurr migrate import`, which loads an export bundle
// (spec/export-bundle.md) into this database and rebuilds what's derived from it.
package migration

import (
	"context"
	"fmt"
	"sync"

	"github.com/openpurr/openpurr/standard/internal/ledger"
)

// Format and Version identify the bundle format (spec/export-bundle.md).
const (
	Format  = "openpurr-export"
	Version = 1
)

// Table is one table of a bundle, as spec/export-tables.json describes it (a test checks they
// match).
type Table struct {
	Name string
	// The primary key: the page order and the cursor.
	Key []string
	// Which rows a delta takes: a SQL condition with :since and :since_day, "all", or "" when
	// deltas leave the table out.
	Delta string
	// Rows outside this condition are never exported.
	Where string
	// The column naming the customer a row belongs to, for tables re-sent per changed customer.
	CustomerColumn string
	// Columns sent as null unless the export asks for them.
	Optional []string
}

// Tables in import order (parents before children).
var Tables = []Table{
	{Name: "config_version", Key: []string{"id"}, Delta: "created_at >= :since"},
	{Name: "setting", Key: []string{"key"}, Delta: "all"},
	{Name: "operator", Key: []string{"id"}, Delta: "all"},
	{Name: "recovery_code", Key: []string{"operator_id", "code_hash"}, Delta: "all"},
	{Name: "session", Key: []string{"token_hash"}, Delta: "all"},
	{Name: "access_token", Key: []string{"id"}, Delta: "all"},
	{Name: "api_key", Key: []string{"id"}, Delta: "all"},
	{Name: "oauth_client", Key: []string{"id"}, Delta: "all"},
	{Name: "oauth_grant", Key: []string{"id"}, Delta: "all"},
	{Name: "audit_log", Key: []string{"id"}, Delta: "at >= :since"},
	{Name: "customer", Key: []string{"id"}, Delta: "all"},
	{Name: "customer_alias", Key: []string{"project_id", "app_user_id"}, Delta: "created_at >= :since", CustomerColumn: "customer_id"},
	{Name: "subscriber_attribute", Key: []string{"customer_id", "key"}, Delta: "received_at >= :since", CustomerColumn: "customer_id"},
	{Name: "store_transaction", Key: []string{"id"}, Delta: "updated_at >= :since"},
	{Name: "purchase_owner", Key: []string{"store", "original_transaction_id"}, Delta: "updated_at >= :since", CustomerColumn: "customer_id"},
	{Name: "subscription_state", Key: []string{"store", "original_transaction_id"}, Delta: "updated_at >= :since"},
	{Name: "store_notification", Key: []string{"store", "notification_id"}, Delta: "received_at >= :since", Optional: []string{"payload"}},
	{Name: "promotional_grant", Key: []string{"id"}, Delta: "created_at >= :since OR revoked_at >= :since", CustomerColumn: "customer_id"},
	{Name: "webhook_event", Key: []string{"id"}, Delta: "created_at >= :since"},
	{Name: "webhook_delivery", Key: []string{"event_id", "endpoint"}, Delta: "created_at >= :since - 345600000 OR status = 'pending' OR delivered_at >= :since"},
	{Name: "play_ack_pending", Key: []string{"purchase_token"}, Delta: "all"},
	{Name: "fx_rate", Key: []string{"currency", "date"}, Delta: "date >= :since_day"},
	{Name: "job_state", Key: []string{"key"}},
	{Name: "experiment", Key: []string{"id"}, Delta: "all"},
	{Name: "experiment_enrollment", Key: []string{"experiment_id", "app_user_id"}, Delta: "enrolled_at >= :since"},
	{Name: "metric_daily", Key: []string{"metric", "environment", "project_id", "app_id", "store", "product_id", "date"}, Where: "metric = 'new_customers'"},
}

// TableNamed returns the table of that name, or nil.
func TableNamed(name string) *Table {
	for i := range Tables {
		if Tables[i].Name == name {
			return &Tables[i]
		}
	}
	return nil
}

// Column is a column of this database's table.
type Column struct {
	Name string
	Type string // information_schema's data_type: bigint, integer, double precision, text
}

var (
	columnsMu    sync.Mutex
	columnsCache = map[string][]Column{}
)

// Columns returns a table's columns in this database, in order. Cached per search path, since
// tests give each test its own schema.
func Columns(ctx context.Context, db ledger.DB, table string) ([]Column, error) {
	var schema string
	if err := db.QueryRow(ctx, "SELECT current_schema()").Scan(&schema); err != nil {
		return nil, err
	}
	cacheKey := schema + "." + table
	columnsMu.Lock()
	cols, ok := columnsCache[cacheKey]
	columnsMu.Unlock()
	if ok {
		return cols, nil
	}
	rows, err := db.Query(ctx,
		`SELECT column_name, data_type FROM information_schema.columns
		 WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position`, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var c Column
		if err := rows.Scan(&c.Name, &c.Type); err != nil {
			return nil, err
		}
		cols = append(cols, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(cols) == 0 {
		return nil, fmt.Errorf("table %s doesn't exist", table)
	}
	columnsMu.Lock()
	columnsCache[cacheKey] = cols
	columnsMu.Unlock()
	return cols, nil
}

func quote(name string) string { return `"` + name + `"` }
