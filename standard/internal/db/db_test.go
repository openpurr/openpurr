package db_test

import (
	"sync"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/db"
	"github.com/openpurr/openpurr/standard/internal/testutil"
)

func TestMigrationsApplyOnceEvenConcurrently(t *testing.T) {
	pool := testutil.Pool(t) // already migrated once
	ctx := t.Context()
	var wg sync.WaitGroup
	errs := make([]error, 4)
	for i := range errs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs[i] = db.Migrate(ctx, pool, nil)
		}()
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	var n int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM "+db.MigrationsTable).Scan(&n); err != nil || n != 5 {
		t.Fatal(n, err)
	}
}

func TestSchemaHasLitesTables(t *testing.T) {
	pool := testutil.Pool(t)
	tables, err := db.DataTables(t.Context(), pool)
	if err != nil {
		t.Fatal(err)
	}
	// Every table Lite has after its 21 migrations, and Standard's per-country chart totals.
	want := []string{"access_token", "api_key", "apple_verified_chain", "audit_log", "capture", "config_version", "customer",
		"customer_alias", "customer_snapshot", "experiment", "experiment_enrollment", "fx_rate", "job_state", "login_link",
		"metric_daily", "metric_daily_country", "oauth_client", "oauth_grant", "oauth_request", "operator", "play_ack_pending", "promotional_grant",
		"purchase_owner", "recovery_code", "session", "setting", "store_notification", "store_transaction",
		"subscriber_attribute", "subscription_state", "webhook_delivery", "webhook_event"}
	if len(tables) != len(want) {
		t.Fatalf("tables %v", tables)
	}
	for i := range want {
		if tables[i] != want[i] {
			t.Fatalf("tables %v", tables)
		}
	}
}

func TestTruncateKeepsMigrations(t *testing.T) {
	pool := testutil.Pool(t)
	ctx := t.Context()
	if _, err := pool.Exec(ctx, "INSERT INTO customer (id, app_user_id, first_seen) VALUES ('c', 'u', 1)"); err != nil {
		t.Fatal(err)
	}
	if err := db.Truncate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	var customers, migrations int
	_ = pool.QueryRow(ctx, "SELECT count(*) FROM customer").Scan(&customers)
	_ = pool.QueryRow(ctx, "SELECT count(*) FROM "+db.MigrationsTable).Scan(&migrations)
	if customers != 0 || migrations != 5 {
		t.Fatal(customers, migrations)
	}
}
