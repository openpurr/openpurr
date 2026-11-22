package metrics_test

// How long a full rebuild takes on a large ledger. Opt in: OPENPURR_PERF_TRANSACTIONS=100000.

import (
	"context"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/openpurr/openpurr/standard/internal/metrics"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

func TestFullRebuildOnALargeLedger(t *testing.T) {
	want, _ := strconv.Atoi(os.Getenv("OPENPURR_PERF_TRANSACTIONS"))
	if want == 0 {
		t.Skip("OPENPURR_PERF_TRANSACTIONS is not set")
	}
	pool := tu.Pool(t)
	ctx := context.Background()
	now := at("2026-11-20")
	start := now - 3*365*metrics.Day
	// Chains of 1 to 8 monthly purchases (4.5 on average), some starting with a trial, across two
	// stores, five currencies, nine storefronts and three products, 3 years back; 3% refunded,
	// some in a grace period or with auto-renew off.
	chains := want * 2 / 9
	exec(t, pool, `INSERT INTO fx_rate (date, currency, per_usd, source)
		SELECT to_char(d, 'YYYY-MM-DD'), cur, 1 + (extract(doy FROM d)::int % 7) / 100.0, 'perf'
		FROM generate_series(to_timestamp($1 / 1000.0), to_timestamp($2 / 1000.0), interval '1 day') d,
		     unnest(ARRAY['EUR', 'GBP', 'JPY', 'BRL']) cur`, start-30*metrics.Day, now)
	began := time.Now()
	exec(t, pool, `INSERT INTO store_transaction (app_id, store, environment, transaction_id, original_transaction_id, product_id, base_plan_id,
		product_type, purchased_at, original_purchased_at, expires_at, period_type, price_micros, currency, storefront, revoked_at, verified,
		source, received_at, updated_at)
		SELECT CASE WHEN c % 2 = 0 THEN 'ios' ELSE 'android' END,
		  CASE WHEN c % 2 = 0 THEN 'app_store' ELSE 'play_store' END,
		  CASE WHEN c % 15 = 0 THEN 'sandbox' ELSE 'production' END,
		  c || '-' || r, 'chain-' || c,
		  CASE WHEN c % 2 = 0 THEN (ARRAY['monthly', 'monthly_plus', 'annual'])[1 + c % 3] ELSE 'pro' END,
		  CASE WHEN c % 2 = 0 THEN NULL ELSE (ARRAY['monthly', 'plus', 'annual'])[1 + c % 3] END,
		  'subscription', p, $1 + (c % 1000) * 86400000::bigint, p + CASE WHEN r = 0 AND c % 3 = 0 THEN 7 ELSE 30 END * 86400000::bigint,
		  CASE WHEN r = 0 AND c % 3 = 0 THEN 'trial' ELSE 'normal' END,
		  CASE WHEN r = 0 AND c % 3 = 0 THEN 0 ELSE 9990000 + (c % 4) * 1000000 END,
		  (ARRAY['USD', 'EUR', 'GBP', 'JPY', 'BRL'])[1 + c % 5],
		  CASE WHEN c % 2 = 0 THEN (ARRAY['USA', 'DEU', 'FRA', 'GBR', 'JPN', 'BRA', 'CAN', 'AUS', 'IND'])[1 + c % 9]
		       ELSE (ARRAY['US', 'DE', 'FR', 'GB', 'JP', 'BR', 'CA', 'AU', 'IN'])[1 + c % 9] END,
		  CASE WHEN (c + r) % 33 = 0 THEN p + 3 * 86400000::bigint END, 1, 'sdk', p, p
		FROM generate_series(1, $2::int) c, generate_series(0, 7) r,
		  LATERAL (SELECT $1::bigint + (c % 1000) * 86400000::bigint + r * 30 * 86400000::bigint + (c % 86400) * 1000 AS p) x
		WHERE r <= c % 8 AND p < $3`, start, chains, now)
	exec(t, pool, `INSERT INTO subscription_state (store, original_transaction_id, status, auto_renew, unsubscribe_detected_at, grace_period_expires_at, signed_at, updated_at)
		SELECT store, original_transaction_id, CASE WHEN c % 4 = 0 THEN 4 ELSE 2 END, 0, max(purchased_at) + 86400000,
		  CASE WHEN c % 4 = 0 THEN max(expires_at) + 6 * 86400000::bigint END, max(purchased_at), max(purchased_at)
		FROM store_transaction, LATERAL (SELECT substr(original_transaction_id, 7)::int AS c) x
		WHERE c % 5 = 0 GROUP BY store, original_transaction_id, c`)
	exec(t, pool, "ANALYZE")
	var n int
	_ = pool.QueryRow(ctx, "SELECT count(*) FROM store_transaction").Scan(&n)
	t.Logf("ledger: %d transactions in %d chains, written in %v", n, chains, time.Since(began).Round(time.Millisecond))

	for _, run := range []struct {
		name string
		now  int64
		full bool
	}{{"first (full)", now, false}, {"full rebuild", now + 3600_000, true}, {"incremental, nothing changed", now + 2*3600_000, false}} {
		began = time.Now()
		res, err := metrics.Rollup(ctx, pool, run.now, run.full)
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("%s: %v, %d rows, %d country rows", run.name, time.Since(began).Round(time.Millisecond), res.Rows, res.CountryRows)
	}
	for _, country := range []string{"", "DE"} {
		began = time.Now()
		for _, c := range metrics.Charts {
			if _, err := metrics.ReadChart(ctx, pool, c.ID, metrics.Query{From: metrics.DayOf(start), To: metrics.DayOf(now), Interval: "month",
				Environment: "production", Country: country}, now); err != nil {
				t.Fatal(err)
			}
		}
		t.Logf("reading all %d charts over 3 years (country %q): %v", len(metrics.Charts), country, time.Since(began).Round(time.Millisecond))
	}
}
