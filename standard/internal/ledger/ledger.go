// Package ledger is data access for the purchase ledger (store_transaction, purchase_owner,
// customer, customer_alias, subscription_state, promotional_grant). A port of lite/src/ledger.ts.
//
// Source of truth: store_transaction, plus who owns each purchase (purchase_owner) and which app
// user IDs belong to which customer (customer_alias). CustomerInfo, entitlements and metrics are
// derived from these and can always be rebuilt. This file has the read side and the customer
// writes (logIn, aliases, merges); writes.go has the purchase writes.
package ledger

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// DB is what the ledger needs from a pool or a transaction.
type DB interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// TxDB can also start a transaction.
type TxDB interface {
	DB
	Begin(ctx context.Context) (pgx.Tx, error)
}

type Customer struct {
	ID string
	// Customers belong to one project; app user IDs are unique within it.
	ProjectID string
	// original_app_user_id: the first ID we saw.
	AppUserID string
	FirstSeen int64
}

type Transaction struct {
	AppID                 string
	Store                 string
	Environment           string
	TransactionID         string
	OriginalTransactionID string
	ProductID             string
	BasePlanID            *string
	ProductType           string
	PurchasedAt           int64
	OriginalPurchasedAt   int64
	ExpiresAt             *int64
	PeriodType            string
	OwnershipType         string
	PriceMicros           *int64
	Currency              *string
	Storefront            *string
	RevokedAt             *int64
	RevocationReason      *string
	IsUpgraded            int
	Verified              int
	// App Store subscription group (for intro-offer eligibility).
	SubscriptionGroup *string
}

type SubscriptionState struct {
	Store                  string
	OriginalTransactionID  string
	Status                 *int
	AutoRenew              *int
	AutoRenewProductID     *string
	UnsubscribeDetectedAt  *int64
	BillingIssueDetectedAt *int64
	GracePeriodExpiresAt   *int64
	AutoResumeAt           *int64
}

// Grant is an entitlement given by an operator (promotional_grant).
type Grant struct {
	ID            string
	EntitlementID string
	Duration      string
	StartsAt      int64
	ExpiresAt     *int64
	Note          *string
	GrantedBy     *string
	Source        string
	CreatedAt     int64
	RevokedAt     *int64
	RevokedBy     *string
}

// Loaded is a customer with everything CustomerInfo is built from.
type Loaded struct {
	Customer *Customer
	// The customer's ledger version (LoadCustomerByID only), read before the ledger.
	LedgerVersion int64
	Transactions  []Transaction
	States        []SubscriptionState
	Grants        []Grant
}

const anonymousPrefix = "$RCAnonymousID:"

// IsAnonymous reports whether an app user ID is one the SDK made up.
func IsAnonymous(appUserID string) bool { return strings.HasPrefix(appUserID, anonymousPrefix) }

const txColumns = `t.app_id, t.store, t.environment, t.transaction_id, t.original_transaction_id, t.product_id,
  t.base_plan_id, t.product_type, t.purchased_at, t.original_purchased_at, t.expires_at, t.period_type,
  t.ownership_type, t.price_micros, t.currency, t.storefront, t.revoked_at, t.revocation_reason, t.is_upgraded,
  t.verified, t.subscription_group`

const stateColumns = `s.store, s.original_transaction_id, s.status, s.auto_renew, s.auto_renew_product_id,
  s.unsubscribe_detected_at, s.billing_issue_detected_at, s.grace_period_expires_at, s.auto_resume_at`

const grantColumns = "g.id, g.entitlement_id, g.duration, g.starts_at, g.expires_at, g.note, g.granted_by, g.source, g.created_at, g.revoked_at, g.revoked_by"

func scanTransaction(r pgx.CollectableRow) (Transaction, error) {
	var t Transaction
	err := r.Scan(&t.AppID, &t.Store, &t.Environment, &t.TransactionID, &t.OriginalTransactionID, &t.ProductID,
		&t.BasePlanID, &t.ProductType, &t.PurchasedAt, &t.OriginalPurchasedAt, &t.ExpiresAt, &t.PeriodType,
		&t.OwnershipType, &t.PriceMicros, &t.Currency, &t.Storefront, &t.RevokedAt, &t.RevocationReason, &t.IsUpgraded,
		&t.Verified, &t.SubscriptionGroup)
	return t, err
}

func scanState(r pgx.CollectableRow) (SubscriptionState, error) {
	var s SubscriptionState
	err := r.Scan(&s.Store, &s.OriginalTransactionID, &s.Status, &s.AutoRenew, &s.AutoRenewProductID,
		&s.UnsubscribeDetectedAt, &s.BillingIssueDetectedAt, &s.GracePeriodExpiresAt, &s.AutoResumeAt)
	return s, err
}

func scanGrant(r pgx.CollectableRow) (Grant, error) {
	var g Grant
	err := r.Scan(&g.ID, &g.EntitlementID, &g.Duration, &g.StartsAt, &g.ExpiresAt, &g.Note, &g.GrantedBy, &g.Source,
		&g.CreatedAt, &g.RevokedAt, &g.RevokedBy)
	return g, err
}

func scanCustomer(row pgx.Row) (*Customer, error) {
	var c Customer
	if err := row.Scan(&c.ID, &c.ProjectID, &c.AppUserID, &c.FirstSeen); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &c, nil
}

// LoadCustomer returns the customer an app user ID belongs to, every transaction they own, the
// store-reported status of their subscriptions, and their promotional grants. Transactions come
// in the order they were recorded.
func LoadCustomer(ctx context.Context, db DB, projectID, appUserID string) (*Loaded, error) {
	c, err := FindCustomer(ctx, db, projectID, appUserID)
	if err != nil {
		return nil, err
	}
	if c == nil {
		// Nobody owns anything without a customer row.
		return &Loaded{}, nil
	}
	return loadByID(ctx, db, c)
}

// LoadCustomerByID is LoadCustomer by internal customer ID (for rebuilding snapshots). The
// customer is nil if there's no such customer.
//
// The ledger version is read first: the ledger rows that follow are at least that new, so a
// snapshot built from them is current if the version hasn't changed by the time it's saved.
func LoadCustomerByID(ctx context.Context, db DB, customerID string) (*Loaded, error) {
	var c Customer
	var version int64
	err := db.QueryRow(ctx, "SELECT id, project_id, app_user_id, first_seen, ledger_version FROM customer WHERE id = $1", customerID).
		Scan(&c.ID, &c.ProjectID, &c.AppUserID, &c.FirstSeen, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		return &Loaded{}, nil
	}
	if err != nil {
		return nil, err
	}
	loaded, err := loadByID(ctx, db, &c)
	if err != nil {
		return nil, err
	}
	loaded.LedgerVersion = version
	return loaded, nil
}

func loadByID(ctx context.Context, db DB, c *Customer) (*Loaded, error) {
	rows, err := db.Query(ctx, `SELECT `+txColumns+` FROM purchase_owner o
		JOIN store_transaction t ON t.store = o.store AND t.original_transaction_id = o.original_transaction_id
		WHERE o.customer_id = $1 ORDER BY t.id`, c.ID)
	if err != nil {
		return nil, err
	}
	txs, err := pgx.CollectRows(rows, scanTransaction)
	if err != nil {
		return nil, err
	}
	rows, err = db.Query(ctx, `SELECT `+stateColumns+` FROM purchase_owner o
		JOIN subscription_state s ON s.store = o.store AND s.original_transaction_id = o.original_transaction_id
		WHERE o.customer_id = $1`, c.ID)
	if err != nil {
		return nil, err
	}
	states, err := pgx.CollectRows(rows, scanState)
	if err != nil {
		return nil, err
	}
	rows, err = db.Query(ctx, `SELECT `+grantColumns+` FROM promotional_grant g WHERE g.customer_id = $1 ORDER BY g.created_at, g.id`, c.ID)
	if err != nil {
		return nil, err
	}
	grants, err := pgx.CollectRows(rows, scanGrant)
	if err != nil {
		return nil, err
	}
	return &Loaded{Customer: c, Transactions: txs, States: states, Grants: grants}, nil
}

// FindCustomer returns the customer an app user ID of a project belongs to, or nil.
func FindCustomer(ctx context.Context, db DB, projectID, appUserID string) (*Customer, error) {
	return scanCustomer(db.QueryRow(ctx,
		`SELECT c.id, c.project_id, c.app_user_id, c.first_seen FROM customer_alias a JOIN customer c ON c.id = a.customer_id
		 WHERE a.project_id = $1 AND a.app_user_id = $2`, projectID, appUserID))
}

// EnsureCustomer finds or creates the customer for an app user ID. Write path only.
func EnsureCustomer(ctx context.Context, db TxDB, projectID, appUserID string, now int64) (*Customer, error) {
	existing, err := FindCustomer(ctx, db, projectID, appUserID)
	if err != nil || existing != nil {
		return existing, err
	}
	id := NewUUID()
	err = pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "INSERT INTO customer (id, project_id, app_user_id, first_seen) VALUES ($1, $2, $3, $4)", id, projectID, appUserID, now); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx,
			"INSERT INTO customer_alias (project_id, app_user_id, customer_id, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
			projectID, appUserID, id, now)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			// A concurrent request created the alias first: drop our customer row and use theirs.
			return errAliasTaken
		}
		return nil
	})
	if err != nil && !errors.Is(err, errAliasTaken) {
		return nil, err
	}
	return FindCustomer(ctx, db, projectID, appUserID)
}

var errAliasTaken = errors.New("alias taken")

// AddAlias adds another app user ID to an existing customer (of the same project).
func AddAlias(ctx context.Context, db DB, projectID, appUserID, customerID string, now int64) error {
	_, err := db.Exec(ctx,
		"INSERT INTO customer_alias (project_id, app_user_id, customer_id, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
		projectID, appUserID, customerID, now)
	return err
}

// MergeCustomers folds one customer into another: every alias and every owned purchase moves to
// `into`. Used when an anonymous user logs in to an existing account, or restores a purchase that
// an anonymous user owns. Run it inside a transaction.
func MergeCustomers(ctx context.Context, tx DB, from, into string) error {
	stmts := []struct {
		sql  string
		args []any
	}{
		{"UPDATE customer_alias SET customer_id = $1 WHERE customer_id = $2", []any{into, from}},
		{"UPDATE purchase_owner SET customer_id = $1 WHERE customer_id = $2", []any{into, from}},
		{"UPDATE promotional_grant SET customer_id = $1 WHERE customer_id = $2", []any{into, from}},
		// Attributes merge too; for a key both have, the more recently set value wins.
		{`INSERT INTO subscriber_attribute (customer_id, key, value, updated_at, received_at)
		  SELECT $1, key, value, updated_at, received_at FROM subscriber_attribute WHERE customer_id = $2
		  ON CONFLICT (customer_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at,
		    received_at = excluded.received_at
		  WHERE excluded.updated_at > subscriber_attribute.updated_at`, []any{into, from}},
		{"DELETE FROM subscriber_attribute WHERE customer_id = $1", []any{from}},
		{"DELETE FROM customer_snapshot WHERE customer_id = $1", []any{from}},
		{"UPDATE customer SET ledger_version = ledger_version + 1 WHERE id = $1", []any{into}},
		{"DELETE FROM customer WHERE id = $1", []any{from}},
	}
	for _, s := range stmts {
		if _, err := tx.Exec(ctx, s.sql, s.args...); err != nil {
			return err
		}
	}
	return nil
}

// NewUUID is crypto.randomUUID(): a random (version 4) UUID.
func NewUUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
