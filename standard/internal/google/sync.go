package google

// Verifies Google Play purchases with the Play Developer API and acknowledges them
// (lite/src/stores/google-sync.ts).
//
// Acknowledgement: Google refunds purchases that aren't acknowledged within 3 days. The SDK may
// acknowledge on the device too, but the server acknowledges subscriptions and non-consumables as
// a safety net; a failed attempt goes into play_ack_pending for the scheduled job to retry.
// Consumables are left to the device, which consumes them (should_consume), and consuming
// acknowledges.

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/customerinfo"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
)

// NotConfiguredError says what's missing for the Play Developer API.
type NotConfiguredError struct{ Msg string }

func (e *NotConfiguredError) Error() string { return e.Msg }

// PendingError is a purchase that isn't paid yet.
type PendingError struct{ Msg string }

func (e *PendingError) Error() string { return e.Msg }

// Ack is a purchase still to acknowledge.
type Ack struct {
	// "subscription" or "product".
	Kind          string
	ProductID     string
	PurchaseToken string
}

// Purchase is a verified purchase.
type Purchase struct {
	Transactions        []ledger.NewTransaction
	States              []ledger.StateUpdate
	PostedTransactionID string
	// Set when the purchase still needs a server-side acknowledgement.
	Ack *Ack
	// The purchase token this one replaces (upgrade, downgrade or re-signup), "" for none.
	Replaces string
}

// Env is what talking to Google needs from the server.
type Env struct {
	// Secret looks up a secret by name (the service account key).
	Secret func(name string) (string, bool)
	HTTP   *http.Client
	Tokens *Tokens
	Now    func() int64
	Log    *slog.Logger
}

// ClientFor is the Play Developer API client for an app, or a NotConfiguredError saying what's
// missing.
func ClientFor(app *config.App, env Env) (*Client, error) {
	api := app.GooglePlayAPI
	if api == nil {
		return nil, &NotConfiguredError{"App " + app.ID + " has no google_play_api in the config."}
	}
	var email, key any
	if raw, ok := env.Secret(api.ServiceAccountSecret); ok {
		if sa, err := jsobj.Parse([]byte(raw)); err == nil {
			email, _ = jsobj.Prop(sa, "client_email")
			key, _ = jsobj.Prop(sa, "private_key")
		}
	}
	if !truthy(email) || !truthy(key) {
		return nil, &NotConfiguredError{"The secret " + api.ServiceAccountSecret + " doesn't hold a service account JSON key."}
	}
	sa := ServiceAccount{ClientEmail: jsobj.String(email, true), PrivateKeyPEM: jsobj.String(key, true)}
	return NewClient(sa, app.PackageName, env.HTTP, env.Tokens), nil
}

// orderOrNil is the Orders API's record of what was paid, or nil (missing permission, or no order
// yet).
func orderOrNil(ctx context.Context, client *Client, orderID any, log *slog.Logger) any {
	if !truthy(orderID) {
		return nil
	}
	id := jsobj.String(orderID, true)
	order, err := client.Order(ctx, id)
	if err != nil {
		log.Warn(`Couldn't read an order for its price (the service account may lack "View financial data")`, "order", id, "error", err.Error())
		return nil
	}
	return order
}

// VerifyPurchase verifies a purchase the Android SDK posted (verifyPlayPurchase). It fails with an
// *APIError, a *PendingError, a *MappingError or another error (Google unreachable).
func VerifyPurchase(ctx context.Context, client *Client, app *config.App, purchaseToken, productID string, now int64, log *slog.Logger) (*Purchase, error) {
	product := app.Products[productID]
	if product.Type == config.Subscription {
		sub, err := client.Subscription(ctx, purchaseToken)
		if err != nil {
			return nil, err
		}
		if IsPending(sub) {
			return nil, &PendingError{"The subscription purchase is still pending."}
		}
		orderID, _ := jsobj.Prop(lineItemFor(sub, productID), "latestSuccessfulOrderId")
		order := orderOrNil(ctx, client, orderID, log)
		row, err := SubscriptionRow(sub, purchaseToken, app, product, now, order)
		if err != nil {
			return nil, err
		}
		state, err := SubscriptionState(sub, purchaseToken, now)
		if err != nil {
			return nil, err
		}
		p := &Purchase{Transactions: []ledger.NewTransaction{row}, States: []ledger.StateUpdate{state}, PostedTransactionID: row.TransactionID}
		if s, _ := jsobj.Prop(sub, "acknowledgementState"); s == "ACKNOWLEDGEMENT_STATE_PENDING" {
			p.Ack = &Ack{Kind: "subscription", ProductID: productID, PurchaseToken: purchaseToken}
		}
		if v, ok := jsobj.Prop(sub, "linkedPurchaseToken"); ok && v != nil {
			p.Replaces = jsobj.String(v, true)
		}
		return p, nil
	}

	purchase, err := client.Product(ctx, productID, purchaseToken)
	if err != nil {
		return nil, err
	}
	orderID, _ := jsobj.Prop(purchase, "orderId")
	order := orderOrNil(ctx, client, orderID, log)
	row, err := ProductRow(purchase, purchaseToken, app, product, now, order)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, &PendingError{"The purchase is still pending."}
	}
	p := &Purchase{Transactions: []ledger.NewTransaction{*row}, PostedTransactionID: row.TransactionID}
	if s, _ := jsobj.Prop(purchase, "acknowledgementState"); s == 0.0 && product.Type == config.NonConsumable {
		p.Ack = &Ack{Kind: "product", ProductID: productID, PurchaseToken: purchaseToken}
	}
	return p, nil
}

// Acknowledge acknowledges a purchase; on failure, it queues it in play_ack_pending for the
// scheduled job. It reports whether Google took the acknowledgement; the error is only for the
// database.
func Acknowledge(ctx context.Context, db ledger.DB, client *Client, appID string, ack Ack, now int64) (bool, error) {
	var err error
	if ack.Kind == "subscription" {
		err = client.AcknowledgeSubscription(ctx, ack.ProductID, ack.PurchaseToken)
	} else {
		err = client.AcknowledgeProduct(ctx, ack.ProductID, ack.PurchaseToken)
	}
	if err == nil {
		_, err := db.Exec(ctx, "DELETE FROM play_ack_pending WHERE purchase_token = $1", ack.PurchaseToken)
		return err == nil, err
	}
	// String(err), as Lite stores it, cut to 500 characters.
	message := []rune("Error: " + err.Error())
	if len(message) > 500 {
		message = message[:500]
	}
	_, dbErr := db.Exec(ctx,
		`INSERT INTO play_ack_pending (purchase_token, app_id, product_id, kind, attempts, last_error, created_at)
		 VALUES ($1, $2, $3, $4, 1, $5, $6)
		 ON CONFLICT (purchase_token) DO UPDATE SET attempts = play_ack_pending.attempts + 1, last_error = excluded.last_error`,
		ack.PurchaseToken, appID, ack.ProductID, ack.Kind, string(message), now)
	return false, dbErr
}

// MarkReplaced marks the chain a new purchase replaces as upgraded, so it stops granting
// entitlements, and invalidates the snapshot of whoever owns it (who may not be the new
// purchase's owner).
func MarkReplaced(ctx context.Context, db ledger.DB, replacedToken string) error {
	if _, err := db.Exec(ctx, "UPDATE store_transaction SET is_upgraded = 1 WHERE store = 'play_store' AND original_transaction_id = $1", replacedToken); err != nil {
		return err
	}
	return customerinfo.InvalidateOwner(ctx, db, "play_store", replacedToken)
}
