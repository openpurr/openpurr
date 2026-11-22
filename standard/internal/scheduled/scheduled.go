// Package scheduled holds the periodic housekeeping tasks of lite/src/scheduled.ts: storage
// cleanup and the CustomerInfo snapshot backfill. The server registers them, with webhook retries,
// exchange rates and Google Play's jobs, on the job loop (internal/jobs) at Lite's cadence.
//
// Each task does a bounded amount of work per run; a backlog clears over several runs.
//
// Hourly:
//   - drop raw notification payloads after 30 days (the summary row stays);
//   - delete spike request captures after 14 days;
//   - delete customers who never purchased (or got a grant), were first seen over 90 days ago and
//     haven't logged in or synced attributes since. Nothing is lost that matters: they own no
//     purchases, and the SDK recreates them (and re-syncs attributes) when needed;
//   - forget verified Apple certificate chains that have expired;
//   - drop expired OAuth sign-in requests, old revoked or expired grants and unused clients.
//
// Every 5 minutes: build CustomerInfo snapshots for customers without a current one.
package scheduled

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/customerinfo"
	"github.com/openpurr/openpurr/standard/internal/ledger"
)

const day = int64(86_400_000)

// Retention periods, in days (Lite's RETENTION).
const (
	NotificationPayloadDays = 30
	CaptureDays             = 14
	InactiveCustomerDays    = 90
)

// Rows each task touches per run, at most.
const (
	payloadBatch  = 500
	captureBatch  = 1000
	customerBatch = 200
	oauthBatch    = 500
)

// SnapshotsPerRun is how many snapshots one backfill run builds. Lite builds 8, within the free
// plan's D1 query budget; Standard has no such budget.
const SnapshotsPerRun = 200

// PruneNotificationPayloads drops raw notification payloads older than 30 days.
func PruneNotificationPayloads(ctx context.Context, db ledger.DB, now int64) (int64, error) {
	tag, err := db.Exec(ctx,
		`UPDATE store_notification SET payload = NULL WHERE (store, notification_id) IN (
		   SELECT store, notification_id FROM store_notification WHERE payload IS NOT NULL AND received_at < $1 LIMIT $2)`,
		now-NotificationPayloadDays*day, payloadBatch)
	return tag.RowsAffected(), err
}

// isoMillis is JavaScript's Date.prototype.toISOString.
func isoMillis(ms int64) string {
	return time.UnixMilli(ms).UTC().Format("2006-01-02T15:04:05.000Z")
}

// PruneCaptures deletes spike request captures older than 14 days.
func PruneCaptures(ctx context.Context, db ledger.DB, now int64) (int64, error) {
	tag, err := db.Exec(ctx,
		`DELETE FROM capture WHERE id IN (SELECT id FROM capture WHERE ts < $1 ORDER BY id LIMIT $2)`,
		isoMillis(now-CaptureDays*day), captureBatch)
	return tag.RowsAffected(), err
}

// PruneInactiveCustomers deletes customers who own no purchase and no grant, were first seen
// over 90 days ago, and haven't gained an app user ID or synced an attribute since. The candidates
// are locked (skipping any a request holds), so a write racing the cleanup either waits for it or
// is skipped by it.
func PruneInactiveCustomers(ctx context.Context, db ledger.TxDB, now int64) (int64, error) {
	cutoff := now - InactiveCustomerDays*day
	var n int64
	err := pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT c.id FROM customer c
			 WHERE c.first_seen < $1
			   AND NOT EXISTS (SELECT 1 FROM purchase_owner o WHERE o.customer_id = c.id)
			   AND NOT EXISTS (SELECT 1 FROM promotional_grant g WHERE g.customer_id = c.id)
			   AND NOT EXISTS (SELECT 1 FROM customer_alias a WHERE a.customer_id = c.id AND a.created_at >= $1)
			   AND NOT EXISTS (SELECT 1 FROM subscriber_attribute s WHERE s.customer_id = c.id AND s.received_at >= $1)
			 LIMIT $2 FOR UPDATE OF c SKIP LOCKED`, cutoff, customerBatch)
		if err != nil {
			return err
		}
		ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil || len(ids) == 0 {
			return err
		}
		for _, table := range []string{"customer_snapshot", "subscriber_attribute", "customer_alias"} {
			if _, err := tx.Exec(ctx, "DELETE FROM "+table+" WHERE customer_id = ANY($1::text[])", ids); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, "DELETE FROM customer WHERE id = ANY($1::text[])", ids); err != nil {
			return err
		}
		n = int64(len(ids))
		return nil
	})
	return n, err
}

// PruneExpiredChains forgets verified Apple certificate chains that have expired.
func PruneExpiredChains(ctx context.Context, db ledger.DB, now int64) (int64, error) {
	tag, err := db.Exec(ctx, "DELETE FROM apple_verified_chain WHERE not_after < $1", now)
	return tag.RowsAffected(), err
}

// PruneOAuth drops OAuth sign-in requests expired over a day ago, grants revoked or past their
// refresh expiry over 30 days ago, and clients over a day old with no grant or request
// (lite/src/office/oauth.ts pruneOAuth).
func PruneOAuth(ctx context.Context, db ledger.TxDB, now int64) (int64, error) {
	var n int64
	err := pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		statements := []struct {
			sql  string
			args []any
		}{
			{`DELETE FROM oauth_request WHERE id IN (SELECT id FROM oauth_request WHERE expires_at < $1 LIMIT $2)`, []any{now - day, oauthBatch}},
			{`DELETE FROM oauth_grant WHERE id IN (SELECT id FROM oauth_grant
			   WHERE (revoked_at IS NOT NULL AND revoked_at < $1) OR refresh_expires_at < $1 LIMIT $2)`, []any{now - 30*day, oauthBatch}},
			{`DELETE FROM oauth_client WHERE id IN (SELECT c.id FROM oauth_client c WHERE c.created_at < $1
			   AND NOT EXISTS (SELECT 1 FROM oauth_grant g WHERE g.client_id = c.id)
			   AND NOT EXISTS (SELECT 1 FROM oauth_request r WHERE r.client_id = c.id) LIMIT $2)`, []any{now - day, oauthBatch}},
		}
		for _, s := range statements {
			tag, err := tx.Exec(ctx, s.sql, s.args...)
			if err != nil {
				return err
			}
			n += tag.RowsAffected()
		}
		return nil
	})
	return n, err
}

// BackfillSnapshots builds CustomerInfo snapshots for customers without a current one: none yet,
// one built from an older config of their project, or one outdated by a write whose rebuild
// didn't happen (the ledger_version rule of internal/customerinfo). Customers of projects no
// longer in the config are left alone. It returns how many it rebuilt.
func BackfillSnapshots(ctx context.Context, db ledger.DB, cfg *config.Config, now int64) (int64, error) {
	var projects, versions []string
	for _, id := range cfg.ProjectOrder {
		if p := cfg.Projects[id]; p != nil {
			projects = append(projects, id)
			versions = append(versions, p.Version)
		}
	}
	rows, err := db.Query(ctx,
		`SELECT c.id FROM customer c
		 JOIN unnest($1::text[], $2::text[]) AS v(project_id, version) ON v.project_id = c.project_id
		 LEFT JOIN customer_snapshot s ON s.customer_id = c.id
		 WHERE s.customer_id IS NULL OR s.config_version <> v.version OR s.ledger_version <> c.ledger_version
		 LIMIT $3`, projects, versions, SnapshotsPerRun)
	if err != nil {
		return 0, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return 0, err
	}
	for _, id := range ids {
		if _, err := customerinfo.Refresh(ctx, db, cfg, id, now); err != nil {
			return 0, err
		}
	}
	return int64(len(ids)), nil
}
