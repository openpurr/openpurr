package google

// Scheduled Google Play work, hourly (lite/src/stores/google-jobs.ts):
//   - retry acknowledgements that failed (Google refunds purchases unacknowledged after 3 days);
//   - poll the voided purchases API, a backstop for refunds and chargebacks whose notification was
//     missed. Bounded per run; a per-app checkpoint in job_state means a backlog clears over
//     several runs.
// Each app is handled on its own: one whose key is missing or whose API calls fail is logged and
// skipped, and the other apps' work goes ahead.

import (
	"context"
	"math"
	"sort"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/customerinfo"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
	"github.com/openpurr/openpurr/standard/internal/webhooks"
)

const day = 86_400_000

// Work per run, at most.
const (
	AcksPerRun   = 10
	VoidedPerRun = 20
)

// RetryAcknowledgements retries failed acknowledgements, oldest first, and drops those too old to
// matter. It returns how many Google took.
func RetryAcknowledgements(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config, env Env, now int64) (int, error) {
	// Too late to matter: Google has refunded these already.
	tag, err := pool.Exec(ctx, "DELETE FROM play_ack_pending WHERE created_at < $1", now-3*day)
	if err != nil {
		return 0, err
	}
	if n := tag.RowsAffected(); n > 0 {
		env.Log.Error("Dropped Play acknowledgements older than 3 days (Google refunds those).", "count", n)
	}
	rows, err := pool.Query(ctx,
		`SELECT purchase_token, app_id, product_id, kind FROM play_ack_pending ORDER BY created_at, purchase_token LIMIT `+strconv.Itoa(AcksPerRun))
	if err != nil {
		return 0, err
	}
	type pending struct{ token, appID, productID, kind string }
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (pending, error) {
		var p pending
		return p, r.Scan(&p.token, &p.appID, &p.productID, &p.kind)
	})
	if err != nil {
		return 0, err
	}
	done := 0
	for _, p := range list {
		app := cfg.Apps[p.appID]
		if app == nil || app.GooglePlayAPI == nil {
			continue
		}
		client, err := ClientFor(app, env)
		if err != nil {
			// Kept for a later run, once the key is fixed.
			env.Log.Error("Can't retry Play acknowledgements", "app", app.ID, "error", err.Error())
			if _, err := pool.Exec(ctx, "UPDATE play_ack_pending SET last_error = $1 WHERE purchase_token = $2", lastError(err), p.token); err != nil {
				return done, err
			}
			continue
		}
		ok, err := Acknowledge(ctx, pool, client, app.ID, Ack{Kind: p.kind, ProductID: p.productID, PurchaseToken: p.token}, env.Now())
		if err != nil {
			return done, err
		}
		if ok {
			done++
		}
	}
	return done, nil
}

// PollVoided marks orders the voided purchases API reports as refunded, with their webhook events,
// for every Play app with API access, and returns how many it marked. Apps are taken in config
// order.
func PollVoided(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config, appIDs []string, env Env, now int64) (int, error) {
	processed := 0
	for _, id := range appIDs {
		app := cfg.Apps[id]
		if app == nil || app.Store != config.PlayStore || app.GooglePlayAPI == nil {
			continue
		}
		n, err := pollApp(ctx, pool, cfg, app, env, now)
		if err != nil {
			// The checkpoint stays where it was, so the next run tries this app again.
			env.Log.Error("Polling voided purchases failed", "app", app.ID, "error", err.Error())
		}
		processed += n
	}
	return processed, nil
}

// pollApp handles one app's voided purchases and returns how many orders it marked refunded.
func pollApp(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config, app *config.App, env Env, now int64) (int, error) {
	processed := 0
	project := cfg.Projects[app.ProjectID]
	key := "play_voided_checkpoint:" + app.ID
	checkpoint := 0.0
	var value string
	err := pool.QueryRow(ctx, "SELECT value FROM job_state WHERE key = $1", key).Scan(&value)
	switch {
	case err == nil:
		checkpoint = toNumber(value, true)
	case err != pgx.ErrNoRows:
		return 0, err
	}
	// The API looks back at most 30 days.
	since := math.Max(checkpoint, float64(now-30*day))
	client, err := ClientFor(app, env)
	if err != nil {
		return 0, err
	}
	res, err := client.Voided(ctx, since)
	if err != nil {
		return 0, err
	}
	listV, _ := jsobj.Prop(res, "voidedPurchases")
	all, _ := listV.([]any)
	type voided struct {
		orderID string
		at      float64
	}
	batch := make([]voided, len(all))
	for i, v := range all {
		at := float64(now)
		if t, ok := jsobj.Prop(v, "voidedTimeMillis"); ok && t != nil {
			at = toNumber(t, true)
		}
		order, hasOrder := jsobj.Prop(v, "orderId")
		batch[i] = voided{orderID: jsobj.String(order, hasOrder), at: at}
	}
	sort.SliceStable(batch, func(i, j int) bool { return batch[i].at < batch[j].at })
	if len(batch) > VoidedPerRun {
		batch = batch[:VoidedPerRun]
	}

	// Read everything first, then write in one transaction (Lite's D1 batch).
	type refund struct {
		orderID string
		at      int64
		event   *webhooks.Prepared
	}
	var refunds []refund
	var owners []string
	for _, v := range batch {
		tx, owner, err := ledger.PlayOrder(ctx, pool, v.orderID, true)
		if err != nil {
			return 0, err
		}
		if tx == nil {
			continue // unknown order, or already marked refunded (for example by its notification)
		}
		r := refund{orderID: v.orderID, at: int64(v.at)}
		if owner != "" {
			if !containsString(owners, owner) {
				owners = append(owners, owner)
			}
			refunded := *tx
			refunded.RevokedAt = &r.at
			e := RefundEvent(&refunded)
			if len(webhooks.For(project, e.Type, tx.Environment)) > 0 {
				customer, err := webhooks.LoadCustomer(ctx, pool, []string{owner}, owner, "")
				if err != nil {
					return 0, err
				}
				r.event, err = webhooks.Prepare(ctx, pool, project, webhooks.Input{
					Type: e.Type, DedupeKey: e.DedupeKey, AppID: app.ID, Environment: tx.Environment, Store: "play_store",
					Customer: customer, Transaction: &refunded, Extra: e.Extra, NegativePrice: e.NegativePrice, Now: now,
				})
				if err != nil {
					return 0, err
				}
			}
		}
		refunds = append(refunds, r)
		processed++
	}
	// Advance past what this run handled; the rest waits for the next run.
	reached := float64(now)
	if len(batch) != len(all) {
		reached = since
		if len(batch) > 0 {
			reached = batch[len(batch)-1].at
		}
	}
	err = pgx.BeginFunc(ctx, pool, func(dbtx pgx.Tx) error {
		for _, r := range refunds {
			if _, err := dbtx.Exec(ctx,
				"UPDATE store_transaction SET revoked_at = $1, revocation_reason = 'voided', updated_at = $2 WHERE store = 'play_store' AND transaction_id = $3",
				r.at, now, r.orderID); err != nil {
				return err
			}
			if r.event != nil {
				if err := r.event.Write(ctx, dbtx); err != nil {
					return err
				}
			}
		}
		for _, id := range owners {
			if err := customerinfo.Invalidate(ctx, dbtx, id); err != nil {
				return err
			}
		}
		_, err := dbtx.Exec(ctx,
			`INSERT INTO job_state (key, value, updated_at) VALUES ($1, $2, $3)
			 ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
			key, jsobj.FormatNumber(reached), now)
		return err
	})
	if err != nil {
		return 0, err
	}
	for _, id := range owners {
		if _, err := customerinfo.Refresh(ctx, pool, cfg, id, env.Now()); err != nil {
			return 0, err
		}
	}
	return processed, nil
}

func containsString(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}
