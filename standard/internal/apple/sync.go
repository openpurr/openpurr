package apple

// Brings App Store data in through the App Store Server API: resolving StoreKit 1 receipts, and
// refreshing subscription status (for example on restore, when the device's view may be stale).
// Turns Apple's answers into ledger rows and status updates (lite/src/stores/apple-sync.ts).

import (
	"context"
	"net/http"
	"sort"
	"strings"

	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/ledger"
)

// MaxTransactionsPerSync caps the transactions written per request. Lite's cap comes from D1's
// queries per invocation; it's kept so both editions store the same rows.
const MaxTransactionsPerSync = 15

// SyncResult is what Apple's answer adds to the ledger.
type SyncResult struct {
	Transactions []ledger.NewTransaction
	States       []ledger.StateUpdate
	// Products in Apple's answer that the config doesn't list (ignored).
	Skipped []string
	// The environment that answered (SyncFromTransactionID only).
	Environment string
}

// NotConfiguredError says what's missing for App Store Server API access.
type NotConfiguredError struct{ Msg string }

func (e *NotConfiguredError) Error() string { return e.Msg }

// ClientsFor returns API clients for both environments of an app, or a *NotConfiguredError saying
// what's missing. secret looks up the key by the name the config gives.
func ClientsFor(app *config.App, secret func(string) (string, bool), httpClient *http.Client, tokens *Tokens) (Clients, error) {
	api := app.AppStoreServerAPI
	if api == nil {
		return Clients{}, &NotConfiguredError{"App " + app.ID + " has no app_store_server_api in the config."}
	}
	pem, ok := secret(api.PrivateKeySecret)
	if !ok || !strings.Contains(pem, "PRIVATE KEY") {
		return Clients{}, &NotConfiguredError{"The secret " + api.PrivateKeySecret + " (App Store In-App Purchase key) isn't set."}
	}
	creds := Credentials{IssuerID: api.IssuerID, KeyID: api.KeyID, BundleID: app.BundleID, PrivateKeyPEM: pem}
	return Clients{
		Production: NewClient(creds, "production", httpClient, tokens),
		Sandbox:    NewClient(creds, "sandbox", httpClient, tokens),
	}, nil
}

// SyncFromTransactionID returns the customer's purchases, from any transaction ID (as found in a
// StoreKit 1 receipt).
func SyncFromTransactionID(ctx context.Context, clients Clients, app *config.App, transactionID string) (*SyncResult, error) {
	// One page (the 20 newest) is enough for CustomerInfo: it holds the latest transaction of every
	// active subscription for all but the most prolific buyers.
	history, environment, err := InEitherEnvironment(clients, func(c *Client) ([]any, error) {
		txs, _, err := c.TransactionHistory(ctx, transactionID, 1)
		return txs, err
	})
	if err != nil {
		return nil, err
	}
	statuses, err := clients.For(environment).SubscriptionStatuses(ctx, transactionID)
	if err != nil {
		return nil, err
	}
	var txs []any
	for _, s := range statuses {
		txs = append(txs, s.Transaction)
	}
	res, err := toLedger(app, append(txs, history...), statuses)
	if err != nil {
		return nil, err
	}
	res.Environment = environment
	return res, nil
}

// SyncStatuses returns the current status of every subscription the customer has in the app.
func SyncStatuses(ctx context.Context, client *Client, app *config.App, transactionID string) (*SyncResult, error) {
	statuses, err := client.SubscriptionStatuses(ctx, transactionID)
	if err != nil {
		return nil, err
	}
	var txs []any
	for _, s := range statuses {
		txs = append(txs, s.Transaction)
	}
	return toLedger(app, txs, statuses)
}

func toLedger(app *config.App, transactions []any, statuses []SubscriptionStatus) (*SyncResult, error) {
	var skipped []string
	skippedSet := map[string]bool{}
	skip := func(id string) {
		if !skippedSet[id] {
			skippedSet[id] = true
			skipped = append(skipped, id)
		}
	}
	// By transaction ID, in first-seen order; a later duplicate replaces the value (a JS Map).
	var order []string
	rows := map[string]ledger.NewTransaction{}
	for _, tx := range transactions {
		if b, _ := get(tx, "bundleId"); b != app.BundleID {
			continue
		}
		productID, _ := get(tx, "productId")
		id, _ := productID.(string)
		product := app.Products[id]
		if _, isStr := productID.(string); !isStr || product == nil {
			skip(Str(tx, "productId"))
			continue
		}
		row, err := TransactionRow(tx, app, product)
		if err != nil {
			skip(id) // type mismatch with the config
			continue
		}
		row.Source = "store_api"
		if _, seen := rows[row.TransactionID]; !seen {
			order = append(order, row.TransactionID)
		}
		rows[row.TransactionID] = row
	}

	// Keep what CustomerInfo needs: each subscription chain's furthest-reaching transaction (plus
	// any refunded or upgraded ones, which change access), and every one-time purchase.
	var chainOrder []string
	latestPerChain := map[string]ledger.NewTransaction{}
	var keep []ledger.NewTransaction
	expiry := func(t ledger.NewTransaction) int64 {
		if t.ExpiresAt == nil {
			return 0
		}
		return *t.ExpiresAt
	}
	for _, id := range order {
		row := rows[id]
		switch {
		case row.ProductType != string(config.Subscription):
			keep = append(keep, row)
		case row.RevokedAt != nil || row.IsUpgraded != 0:
			keep = append(keep, row)
		default:
			best, ok := latestPerChain[row.OriginalTransactionID]
			if !ok {
				chainOrder = append(chainOrder, row.OriginalTransactionID)
			}
			if !ok || expiry(row) > expiry(best) {
				latestPerChain[row.OriginalTransactionID] = row
			}
		}
	}
	for _, chain := range chainOrder {
		keep = append(keep, latestPerChain[chain])
	}
	sort.SliceStable(keep, func(i, j int) bool { return keep[i].PurchasedAt > keep[j].PurchasedAt }) // newest first, if we have to cap
	if len(keep) > MaxTransactionsPerSync {
		keep = keep[:MaxTransactionsPerSync]
	}

	res := &SyncResult{Transactions: keep, Skipped: skipped}
	for _, s := range statuses {
		status := s.Status
		state, err := SubscriptionState(s.Renewal, &status)
		if err != nil {
			return nil, err
		}
		res.States = append(res.States, state)
	}
	return res, nil
}
