package customerinfo

// Precomputed CustomerInfo (customer_snapshot), so GET /v1/subscribers/{id} is one query.
//
// Consistency rule: every write that changes what a customer's CustomerInfo shows deletes their
// snapshot in the same transaction (Invalidate), and the snapshot is rebuilt afterwards (Refresh).
// If the rebuild fails or hasn't happened yet, there's simply no snapshot and reads compute from
// the ledger without writing. So the worst case is a little extra work, never stale data. A
// snapshot built from an older config is treated as missing: each project has its own config
// version, so a change to one project only rebuilds that project's snapshots.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
)

// ETagOf is a quoted 24-hex-digit SHA-256 prefix of a body, as Lite makes them.
func ETagOf(body string) string {
	sum := sha256.Sum256([]byte(body))
	return `"` + hex.EncodeToString(sum[:12]) + `"`
}

// Invalidate deletes a customer's snapshot; run it in the same transaction as the change.
func Invalidate(ctx context.Context, db ledger.DB, customerID string) error {
	_, err := db.Exec(ctx, "DELETE FROM customer_snapshot WHERE customer_id = $1", customerID)
	return err
}

// InvalidateOwner deletes the snapshot of whoever owns a purchase chain.
func InvalidateOwner(ctx context.Context, db ledger.DB, store, originalTransactionID string) error {
	_, err := db.Exec(ctx,
		`DELETE FROM customer_snapshot WHERE customer_id =
		   (SELECT customer_id FROM purchase_owner WHERE store = $1 AND original_transaction_id = $2)`,
		store, originalTransactionID)
	return err
}

// Refreshed is a rebuilt snapshot.
type Refreshed struct {
	Snapshot *jsobj.Object
	ETag     string
	Project  *config.Project
}

// Refresh rebuilds and stores a customer's snapshot, with their project's config. It returns nil
// if the customer (or their project) is gone.
func Refresh(ctx context.Context, db ledger.DB, all *config.Config, customerID string, now int64) (*Refreshed, error) {
	loaded, err := ledger.LoadCustomerByID(ctx, db, customerID)
	if err != nil {
		return nil, err
	}
	if loaded.Customer == nil {
		return nil, nil
	}
	project := all.Projects[loaded.Customer.ProjectID]
	if project == nil {
		return nil, nil
	}
	snapshot := ComputeSnapshot(loaded.Customer.AppUserID, loaded, project, now)
	body := jsobj.Stringify(snapshot)
	etag := ETagOf(body)
	_, err = db.Exec(ctx,
		`INSERT INTO customer_snapshot (customer_id, body, etag, config_version, updated_at) VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (customer_id) DO UPDATE SET body = excluded.body, etag = excluded.etag,
		   config_version = excluded.config_version, updated_at = excluded.updated_at`,
		customerID, body, etag, project.Version, now)
	if err != nil {
		return nil, err
	}
	return &Refreshed{Snapshot: snapshot, ETag: etag, Project: project}, nil
}

// Source says where a read came from.
type Source string

const (
	FromSnapshot Source = "snapshot"
	FromEmpty    Source = "empty"
	FromComputed Source = "computed"
)

// Read is the result of ReadCustomerInfo.
type Read struct {
	Body *jsobj.Object
	// The snapshot's ETag; "" unless served from a snapshot.
	ETag       string
	CustomerID string
	Source     Source
}

// ReadCustomerInfo returns CustomerInfo for an app user ID of a project. One query when the
// snapshot is current; otherwise computed from the ledger, never written.
func ReadCustomerInfo(ctx context.Context, db ledger.DB, project *config.Project, appUserID string, opts RenderOptions) (*Read, error) {
	var id, origID string
	var firstSeen int64
	var body, etag, version *string
	err := db.QueryRow(ctx,
		`SELECT c.id, c.app_user_id, c.first_seen, s.body, s.etag, s.config_version
		 FROM customer_alias a JOIN customer c ON c.id = a.customer_id
		 LEFT JOIN customer_snapshot s ON s.customer_id = c.id
		 WHERE a.project_id = $1 AND a.app_user_id = $2`, project.ID, appUserID).
		Scan(&id, &origID, &firstSeen, &body, &etag, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		// Unknown user: an empty CustomerInfo, nothing to load.
		snapshot := ComputeSnapshot(appUserID, &ledger.Loaded{}, project, opts.Now)
		return &Read{Body: Render(snapshot, project, opts), Source: FromEmpty}, nil
	}
	if err != nil {
		return nil, err
	}
	if body != nil && version != nil && *version == project.Version {
		parsed, err := jsobj.Parse([]byte(*body))
		if err == nil && jsobj.IsObject(parsed) {
			return &Read{Body: Render(parsed.(*jsobj.Object), project, opts), ETag: *etag, CustomerID: id, Source: FromSnapshot}, nil
		}
	}
	loaded, err := ledger.LoadCustomer(ctx, db, project.ID, appUserID)
	if err != nil {
		return nil, err
	}
	snapshot := ComputeSnapshot(appUserID, loaded, project, opts.Now)
	return &Read{Body: Render(snapshot, project, opts), CustomerID: id, Source: FromComputed}, nil
}
