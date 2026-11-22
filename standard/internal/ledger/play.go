package ledger

// Ledger reads for Google Play (lite/src/routes/google-notifications.ts and
// lite/src/stores/google-jobs.ts).

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// PlayOrder is a Play transaction by its order ID, and who owns its chain ("" for nobody). With
// unrevokedOnly, an order already marked refunded counts as missing. nil when there's none.
func PlayOrder(ctx context.Context, db DB, orderID string, unrevokedOnly bool) (*Transaction, string, error) {
	cond := ""
	if unrevokedOnly {
		cond = " AND t.revoked_at IS NULL"
	}
	rows, err := db.Query(ctx, `SELECT `+txColumns+`, coalesce(o.customer_id, '') FROM store_transaction t
		 LEFT JOIN purchase_owner o ON o.store = t.store AND o.original_transaction_id = t.original_transaction_id
		 WHERE t.store = 'play_store' AND t.transaction_id = $1`+cond, orderID)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()
	if !rows.Next() {
		return nil, "", rows.Err()
	}
	var t Transaction
	var owner string
	if err := rows.Scan(&t.AppID, &t.Store, &t.Environment, &t.TransactionID, &t.OriginalTransactionID, &t.ProductID,
		&t.BasePlanID, &t.ProductType, &t.PurchasedAt, &t.OriginalPurchasedAt, &t.ExpiresAt, &t.PeriodType,
		&t.OwnershipType, &t.PriceMicros, &t.Currency, &t.Storefront, &t.RevokedAt, &t.RevocationReason, &t.IsUpgraded,
		&t.Verified, &t.SubscriptionGroup, &owner); err != nil {
		return nil, "", err
	}
	return &t, owner, nil
}

// PlayPrevious is the latest earlier transaction of a Play subscription or the one it replaces:
// its period type, product and base plan. found is false when there's none.
func PlayPrevious(ctx context.Context, db DB, token, replaces, transactionID string) (periodType, productID string, basePlanID *string, found bool, err error) {
	err = db.QueryRow(ctx,
		`SELECT period_type, product_id, base_plan_id FROM store_transaction WHERE store = 'play_store'
		 AND original_transaction_id IN ($1, $2) AND transaction_id != $3 ORDER BY purchased_at DESC, id DESC LIMIT 1`,
		token, replaces, transactionID).Scan(&periodType, &productID, &basePlanID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", nil, false, nil
	}
	return periodType, productID, basePlanID, err == nil, err
}
