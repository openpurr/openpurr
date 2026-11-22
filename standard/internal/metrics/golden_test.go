package metrics_test

// Standard's rollup and charts against Lite's own output (internal/testdata/golden-metrics.ts):
// every metric_daily row after each step of each ledger, the rollup state and run results, and
// each chart's JSON and CSV, byte for byte.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/metrics"
	"github.com/openpurr/openpurr/standard/internal/testdata"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

type goldenTx struct {
	AppID                 string  `json:"app_id"`
	Store                 string  `json:"store"`
	Environment           string  `json:"environment"`
	TransactionID         string  `json:"transaction_id"`
	OriginalTransactionID string  `json:"original_transaction_id"`
	ProductID             string  `json:"product_id"`
	BasePlanID            *string `json:"base_plan_id"`
	ProductType           string  `json:"product_type"`
	PurchasedAt           int64   `json:"purchased_at"`
	OriginalPurchasedAt   int64   `json:"original_purchased_at"`
	ExpiresAt             *int64  `json:"expires_at"`
	PeriodType            string  `json:"period_type"`
	PriceMicros           *int64  `json:"price_micros"`
	Currency              *string `json:"currency"`
	Storefront            *string `json:"storefront"`
	RevokedAt             *int64  `json:"revoked_at"`
	IsUpgraded            int     `json:"is_upgraded"`
	UpdatedAt             int64   `json:"updated_at"`
}

type goldenState struct {
	Store                 string `json:"store"`
	OriginalTransactionID string `json:"original_transaction_id"`
	Status                *int   `json:"status"`
	AutoRenew             *int   `json:"auto_renew"`
	UnsubscribeDetectedAt *int64 `json:"unsubscribe_detected_at"`
	GracePeriodExpiresAt  *int64 `json:"grace_period_expires_at"`
	AutoResumeAt          *int64 `json:"auto_resume_at"`
	UpdatedAt             int64  `json:"updated_at"`
}

type goldenRevoke struct {
	Store         string `json:"store"`
	TransactionID string `json:"transaction_id"`
	RevokedAt     int64  `json:"revoked_at"`
	IsUpgraded    *int   `json:"is_upgraded"`
	UpdatedAt     int64  `json:"updated_at"`
}

type goldenStep struct {
	Customers    [][3]any       `json:"customers"`
	Transactions []goldenTx     `json:"transactions"`
	Revokes      []goldenRevoke `json:"revokes"`
	States       []goldenState  `json:"states"`
	ImportAt     *int64         `json:"import_at"`
	Rollup       struct {
		Now  int64 `json:"now"`
		Full bool  `json:"full"`
	} `json:"rollup"`
	Result         string   `json:"result"`
	State          string   `json:"state"`
	StateUpdatedAt int64    `json:"stateUpdatedAt"`
	RowCount       int      `json:"rowCount"`
	RowsSha256     string   `json:"rowsSha256"`
	Rows           []string `json:"rows"`
}

type goldenChart struct {
	Chart string `json:"chart"`
	Query struct {
		From        string   `json:"from"`
		To          string   `json:"to"`
		Interval    string   `json:"interval"`
		Environment string   `json:"environment"`
		Store       string   `json:"store"`
		App         string   `json:"app"`
		Product     string   `json:"product"`
		Apps        []string `json:"apps"`
		Project     *struct {
			ID   string   `json:"id"`
			Apps []string `json:"apps"`
		} `json:"project"`
	} `json:"query"`
	Now  int64   `json:"now"`
	JSON string  `json:"json"`
	CSV  *string `json:"csv"`
}

type goldenCase struct {
	Name         string        `json:"name"`
	Transactions int           `json:"transactions"`
	FX           [][3]any      `json:"fx"`
	Steps        []goldenStep  `json:"steps"`
	Charts       []goldenChart `json:"charts"`
}

type golden struct {
	Charts string       `json:"charts"`
	Cases  []goldenCase `json:"cases"`
}

func loadGolden(t *testing.T) *golden {
	var g golden
	if err := json.Unmarshal(testdata.GoldenMetrics(), &g); err != nil {
		t.Fatal(err)
	}
	return &g
}

func exec(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

func applyStep(t *testing.T, pool *pgxpool.Pool, s *goldenStep) {
	for _, c := range s.Customers {
		exec(t, pool, "INSERT INTO customer (id, app_user_id, first_seen, project_id) VALUES ($1, $1, $2, $3)", c[0], int64(c[2].(float64)), c[1])
	}
	for _, x := range s.Transactions {
		exec(t, pool, `INSERT INTO store_transaction (app_id, store, environment, transaction_id, original_transaction_id, product_id, base_plan_id,
			product_type, purchased_at, original_purchased_at, expires_at, period_type, price_micros, currency, storefront, revoked_at, is_upgraded,
			verified, source, received_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 1, 'sdk', $18, $18)`,
			x.AppID, x.Store, x.Environment, x.TransactionID, x.OriginalTransactionID, x.ProductID, x.BasePlanID, x.ProductType, x.PurchasedAt,
			x.OriginalPurchasedAt, x.ExpiresAt, x.PeriodType, x.PriceMicros, x.Currency, x.Storefront, x.RevokedAt, x.IsUpgraded, x.UpdatedAt)
	}
	for _, r := range s.Revokes {
		exec(t, pool, `UPDATE store_transaction SET revoked_at = $1, is_upgraded = coalesce($2, is_upgraded), updated_at = $3
			WHERE store = $4 AND transaction_id = $5`, r.RevokedAt, r.IsUpgraded, r.UpdatedAt, r.Store, r.TransactionID)
	}
	for _, st := range s.States {
		exec(t, pool, `INSERT INTO subscription_state (store, original_transaction_id, status, auto_renew, unsubscribe_detected_at,
			grace_period_expires_at, auto_resume_at, signed_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
			ON CONFLICT (store, original_transaction_id) DO UPDATE SET status = excluded.status, auto_renew = excluded.auto_renew,
			  unsubscribe_detected_at = excluded.unsubscribe_detected_at, grace_period_expires_at = excluded.grace_period_expires_at,
			  auto_resume_at = excluded.auto_resume_at, signed_at = excluded.signed_at, updated_at = excluded.updated_at`,
			st.Store, st.OriginalTransactionID, st.Status, st.AutoRenew, st.UnsubscribeDetectedAt, st.GracePeriodExpiresAt, st.AutoResumeAt, st.UpdatedAt)
	}
	if s.ImportAt != nil {
		exec(t, pool, `INSERT INTO job_state (key, value, updated_at) VALUES ('import_active', $1, $2)
			ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
			jsobj.Stringify(jsobj.New("at", float64(*s.ImportAt))), *s.ImportAt)
	}
}

func dumpRows(t *testing.T, pool *pgxpool.Pool) []string {
	rows, err := pool.Query(context.Background(),
		`SELECT metric, environment, project_id, app_id, store, product_id, date, value FROM metric_daily
		 ORDER BY metric COLLATE "C", environment COLLATE "C", project_id COLLATE "C", app_id COLLATE "C", store COLLATE "C", product_id COLLATE "C", date`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var f [7]string
		var v float64
		if err := rows.Scan(&f[0], &f[1], &f[2], &f[3], &f[4], &f[5], &f[6], &v); err != nil {
			t.Fatal(err)
		}
		out = append(out, strings.Join(append(f[:], jsobj.FormatNumber(v)), "|"))
	}
	return out
}

func TestGoldenChartList(t *testing.T) {
	g := loadGolden(t)
	if got := jsobj.Stringify(metrics.ChartList()); got != g.Charts {
		t.Errorf("chart list:\n got %s\nwant %s", got, g.Charts)
	}
}

func TestGoldenRollupsAndCharts(t *testing.T) {
	g := loadGolden(t)
	for _, c := range g.Cases {
		t.Run(c.Name, func(t *testing.T) {
			t.Parallel()
			pool := tu.Pool(t)
			ctx := context.Background()
			for _, r := range c.FX {
				exec(t, pool, "INSERT INTO fx_rate (date, currency, per_usd, source) VALUES ($1, $2, $3, 'test')", r[0], r[1], r[2])
			}
			for i := range c.Steps {
				s := &c.Steps[i]
				applyStep(t, pool, s)
				res, err := metrics.Rollup(ctx, pool, s.Rollup.Now, s.Rollup.Full)
				if err != nil {
					t.Fatalf("step %d: %v", i, err)
				}
				if got := jsobj.Stringify(res.JSON()); got != s.Result {
					t.Errorf("step %d result: got %s, want %s", i, got, s.Result)
				}
				var state string
				var updated int64
				if err := pool.QueryRow(ctx, "SELECT value, updated_at FROM job_state WHERE key = 'metrics_rollup'").Scan(&state, &updated); err != nil {
					t.Fatal(err)
				}
				if state != s.State || updated != s.StateUpdatedAt {
					t.Errorf("step %d state: got %s at %d, want %s at %d", i, state, updated, s.State, s.StateUpdatedAt)
				}
				rows := dumpRows(t, pool)
				sum := sha256.Sum256([]byte(strings.Join(rows, "\n")))
				if len(rows) != s.RowCount || hex.EncodeToString(sum[:]) != s.RowsSha256 {
					t.Errorf("step %d: %d metric_daily rows (want %d), digest differs: %v", i, len(rows), s.RowCount, hex.EncodeToString(sum[:]) != s.RowsSha256)
				}
				if s.Rows != nil {
					diffRows(t, rows, s.Rows)
				}
			}
			for _, ch := range c.Charts {
				q := metrics.Query{From: ch.Query.From, To: ch.Query.To, Interval: ch.Query.Interval, Environment: ch.Query.Environment,
					Store: ch.Query.Store, App: ch.Query.App, Product: ch.Query.Product, Apps: ch.Query.Apps}
				if ch.Query.Project != nil {
					q.Project = &metrics.Project{ID: ch.Query.Project.ID, Apps: ch.Query.Project.Apps}
				}
				name := fmt.Sprintf("%s %+v", ch.Chart, ch.Query)
				res, err := metrics.ReadChart(ctx, pool, ch.Chart, q, ch.Now)
				if err != nil {
					t.Fatalf("%s: %v", name, err)
				}
				if got := jsobj.Stringify(res.JSON()); got != ch.JSON {
					t.Errorf("%s:\n got %s\nwant %s", name, got, ch.JSON)
				}
				if ch.CSV != nil && res.CSV() != *ch.CSV {
					t.Errorf("%s CSV:\n got %q\nwant %q", name, res.CSV(), *ch.CSV)
				}
			}
		})
	}
}

// diffRows reports the first rows that differ.
func diffRows(t *testing.T, got, want []string) {
	t.Helper()
	g, w := map[string]bool{}, map[string]bool{}
	for _, r := range got {
		g[r] = true
	}
	for _, r := range want {
		w[r] = true
	}
	n := 0
	for _, r := range want {
		if !g[r] && n < 20 {
			t.Errorf("missing row %s", r)
			n++
		}
	}
	for _, r := range got {
		if !w[r] && n < 40 {
			t.Errorf("extra row   %s", r)
			n++
		}
	}
}
