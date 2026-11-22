package ledger

// The purchase writes of lite/src/ledger.ts: transactions, owners, store-reported subscription
// status and processed store notifications. Lite collects these statements into one D1 batch per
// request; here they run inside the caller's Postgres transaction, with the same outcome.

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// NewTransaction is a transaction to record, and where it came from: "sdk", "notification" or
// "store_api".
type NewTransaction struct {
	Transaction
	Source string
}

// StateUpdate is store-reported subscription status (lite/src/stores/apple.ts
// SubscriptionStateUpdate), for both stores.
type StateUpdate struct {
	Store                 string
	OriginalTransactionID string
	Status                *int
	AutoRenew             *int
	AutoRenewProductID    *string
	ExpirationIntent      *int
	// Whether a billing problem is current; the ledger keeps the first time it was seen.
	BillingIssue         bool
	GracePeriodExpiresAt *int64
	// Google Play pause: when it resumes.
	AutoResumeAt *int64
	SignedAt     int64
}

// Owner is the customer that owns a purchase chain.
type Owner struct {
	Customer
	// No alias of the customer is a named (non-anonymous) app user ID.
	AnonymousOnly bool
}

// The SQLite LIKE Lite uses is case-insensitive, hence ILIKE.
const namedAliases = `(SELECT count(*) FROM customer_alias a WHERE a.customer_id = c.id AND a.app_user_id NOT ILIKE '$RCAnonymousID:%')`

// PurchaseOwner returns the customer that currently owns a purchase chain, or nil.
func PurchaseOwner(ctx context.Context, db DB, store, originalTransactionID string) (*Owner, error) {
	var o Owner
	var named int
	err := db.QueryRow(ctx,
		`SELECT c.id, c.project_id, c.app_user_id, c.first_seen, `+namedAliases+`
		 FROM purchase_owner o JOIN customer c ON c.id = o.customer_id
		 WHERE o.store = $1 AND o.original_transaction_id = $2`, store, originalTransactionID).
		Scan(&o.ID, &o.ProjectID, &o.AppUserID, &o.FirstSeen, &named)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	o.AnonymousOnly = named == 0
	return &o, nil
}

// OwnerEntry is one chain's owner, from PurchaseOwners.
type OwnerEntry struct {
	OriginalTransactionID string
	Owner                 Owner
}

// PurchaseOwners returns the owners of several purchase chains at once, in chain ID order (the
// order SQLite's primary key index gives Lite). Chains nobody owns are absent.
func PurchaseOwners(ctx context.Context, db DB, store string, originalTransactionIDs []string) ([]OwnerEntry, error) {
	if len(originalTransactionIDs) == 0 {
		return nil, nil
	}
	rows, err := db.Query(ctx,
		`SELECT o.original_transaction_id, c.id, c.project_id, c.app_user_id, c.first_seen, `+namedAliases+`
		 FROM purchase_owner o JOIN customer c ON c.id = o.customer_id
		 WHERE o.store = $1 AND o.original_transaction_id = ANY($2::text[])
		 ORDER BY o.original_transaction_id COLLATE "C"`, store, originalTransactionIDs)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (OwnerEntry, error) {
		var e OwnerEntry
		var named int
		err := r.Scan(&e.OriginalTransactionID, &e.Owner.ID, &e.Owner.ProjectID, &e.Owner.AppUserID, &e.Owner.FirstSeen, &named)
		e.Owner.AnonymousOnly = named == 0
		return e, err
	})
}

// UpsertTransaction writes a transaction without touching ownership. The store's latest facts win
// (expiry, refund, upgrade); identity columns never change. Store notifications use it alone: a
// notification can arrive before the app has posted the purchase, and then nobody owns it yet.
func UpsertTransaction(ctx context.Context, db DB, tx NewTransaction, now int64) error {
	_, err := db.Exec(ctx,
		`INSERT INTO store_transaction (app_id, store, environment, transaction_id, original_transaction_id, product_id,
		   base_plan_id, product_type, purchased_at, original_purchased_at, expires_at, period_type, ownership_type,
		   price_micros, currency, storefront, revoked_at, revocation_reason, is_upgraded, verified, source,
		   received_at, updated_at, subscription_group)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $22, $23)
		 ON CONFLICT (store, transaction_id) DO UPDATE SET
		   expires_at = excluded.expires_at,
		   revoked_at = excluded.revoked_at,
		   revocation_reason = excluded.revocation_reason,
		   is_upgraded = excluded.is_upgraded,
		   ownership_type = excluded.ownership_type,
		   verified = greatest(store_transaction.verified, excluded.verified),
		   subscription_group = coalesce(excluded.subscription_group, store_transaction.subscription_group),
		   updated_at = excluded.updated_at`,
		tx.AppID, tx.Store, tx.Environment, tx.TransactionID, tx.OriginalTransactionID, tx.ProductID,
		tx.BasePlanID, tx.ProductType, tx.PurchasedAt, tx.OriginalPurchasedAt, tx.ExpiresAt, tx.PeriodType, tx.OwnershipType,
		tx.PriceMicros, tx.Currency, tx.Storefront, tx.RevokedAt, tx.RevocationReason, tx.IsUpgraded, tx.Verified, tx.Source,
		now, tx.SubscriptionGroup)
	return err
}

// AssignOwner assigns a purchase chain to a customer (a transfer, if someone else owned it).
func AssignOwner(ctx context.Context, db DB, store, originalTransactionID, appID, customerID string, now int64) error {
	_, err := db.Exec(ctx,
		`INSERT INTO purchase_owner (store, original_transaction_id, customer_id, app_id, updated_at)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (store, original_transaction_id) DO UPDATE SET customer_id = excluded.customer_id,
		   updated_at = excluded.updated_at`,
		store, originalTransactionID, customerID, appID, now)
	return err
}

// UpsertSubscriptionState applies store-reported subscription status, but only if it was signed at
// or after what's stored (notifications can arrive out of order). The first time a billing problem
// or auto-renew-off is seen is kept until it clears.
func UpsertSubscriptionState(ctx context.Context, db DB, s StateUpdate, now int64) error {
	_, err := db.Exec(ctx,
		`INSERT INTO subscription_state (store, original_transaction_id, status, auto_renew, auto_renew_product_id,
		   expiration_intent, unsubscribe_detected_at, billing_issue_detected_at, grace_period_expires_at, signed_at,
		   updated_at, auto_resume_at)
		 VALUES ($1, $2, $3::integer, $4::integer, $5, $6::integer, CASE WHEN $4::integer = 0 THEN $9::bigint END,
		   CASE WHEN $7::boolean THEN $9::bigint END, $8::bigint, $9::bigint, $10, $11::bigint)
		 ON CONFLICT (store, original_transaction_id) DO UPDATE SET
		   status = excluded.status,
		   auto_renew = coalesce(excluded.auto_renew, subscription_state.auto_renew),
		   auto_renew_product_id = excluded.auto_renew_product_id,
		   expiration_intent = excluded.expiration_intent,
		   unsubscribe_detected_at = CASE
		     WHEN coalesce(excluded.auto_renew, subscription_state.auto_renew) = 0
		       THEN coalesce(subscription_state.unsubscribe_detected_at, excluded.signed_at)
		     END,
		   billing_issue_detected_at = CASE
		     WHEN $7::boolean THEN coalesce(subscription_state.billing_issue_detected_at, excluded.signed_at)
		     END,
		   grace_period_expires_at = excluded.grace_period_expires_at,
		   auto_resume_at = excluded.auto_resume_at,
		   signed_at = excluded.signed_at,
		   updated_at = excluded.updated_at
		 WHERE excluded.signed_at >= subscription_state.signed_at`,
		s.Store, s.OriginalTransactionID, s.Status, s.AutoRenew, s.AutoRenewProductID, s.ExpirationIntent,
		s.BillingIssue, s.GracePeriodExpiresAt, s.SignedAt, now, s.AutoResumeAt)
	return err
}

// Notification is a processed store notification (store_notification).
type Notification struct {
	Store                 string
	NotificationID        string
	NotificationType      string
	Subtype               *string
	Environment           string
	AppID                 *string
	OriginalTransactionID *string
	SignedAt              int64
	Payload               string
}

// NotificationSeen reports whether a store notification was already processed.
func NotificationSeen(ctx context.Context, db DB, store, id string) (bool, error) {
	var one int
	err := db.QueryRow(ctx, "SELECT 1 FROM store_notification WHERE store = $1 AND notification_id = $2", store, id).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// RecordNotification logs a processed notification. ON CONFLICT DO NOTHING makes a concurrent
// retry harmless.
func RecordNotification(ctx context.Context, db DB, n Notification, now int64) error {
	_, err := db.Exec(ctx,
		`INSERT INTO store_notification (store, notification_id, notification_type, subtype, environment, app_id,
		   original_transaction_id, signed_at, received_at, payload)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING`,
		n.Store, n.NotificationID, n.NotificationType, n.Subtype, n.Environment, n.AppID,
		n.OriginalTransactionID, n.SignedAt, now, n.Payload)
	return err
}

// PreviousPeriodType is the period type of the latest earlier transaction in an App Store chain
// (for a renewal's is_trial_conversion), or "" if there's none.
func PreviousPeriodType(ctx context.Context, db DB, originalTransactionID, transactionID string) (string, error) {
	var p string
	err := db.QueryRow(ctx,
		`SELECT period_type FROM store_transaction WHERE store = 'app_store' AND original_transaction_id = $1
		 AND transaction_id != $2 ORDER BY purchased_at DESC, id DESC LIMIT 1`, originalTransactionID, transactionID).Scan(&p)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return p, err
}
