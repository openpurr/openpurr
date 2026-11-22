package server

// POST /v1/receipts and the purchase writes behind it: lite/src/routes/sdk.ts (the receipt route,
// appleReceipt, storeKit1Receipt, googleReceipt and recordForCustomer).
//
// Status codes follow spec/sdk-wire-contract.md: a 4xx makes the device finish (iOS) or
// acknowledge (Android) the purchase, so it's only for receipts that will never be good; anything
// that might work later (our config, Apple being down, a missing key) is a 5xx, which keeps the
// purchase queued on the device.

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/openpurr/openpurr/standard/internal/apple"
	"github.com/openpurr/openpurr/standard/internal/applejws"
	"github.com/openpurr/openpurr/standard/internal/applereceipt"
	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/customerinfo"
	"github.com/openpurr/openpurr/standard/internal/google"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
	"github.com/openpurr/openpurr/standard/internal/webhooks"
)

const codeInvalidReceipt = 7103

// Unverified (development) subscriptions last this long, since nothing tells us the real expiry.
const unverifiedSubscriptionMs = 30 * 86_400_000

// receiptFailure is an error answer for a receipt.
type receiptFailure struct {
	status  int
	code    int
	message string
}

// receipt is what a store says a posted receipt holds.
type receipt struct {
	transactions []ledger.NewTransaction
	states       []ledger.StateUpdate
	// The transaction the device posted, when there is exactly one.
	postedTransactionID string
	// Google Play: a purchase still to acknowledge, the purchase token this one replaces ("" for
	// none), and the client that verified it.
	ack      *google.Ack
	replaces string
	google   *google.Client
}

func (s *server) postReceipt(q *sdkRequest) error {
	user, _ := q.prop("app_user_id")
	token, _ := q.prop("fetch_token")
	if !truthy(user) || !truthy(token) {
		sdkError(q.w, http.StatusBadRequest, codeBadRequest, "app_user_id and fetch_token are required.")
		return nil
	}
	app := q.app
	var result *receipt
	var failure *receiptFailure
	var err error
	if app.Store == config.AppStore {
		tokenStr, isStr := token.(string)
		if !isStr {
			// Lite calls .split on it and fails with an internal error.
			return errors.New("fetch_token is not a string")
		}
		restore, _ := q.prop("is_restore")
		result, failure, err = s.appleReceipt(q, tokenStr, truthy(restore))
	} else {
		result, failure, err = s.googleReceipt(q, token)
	}
	if err != nil {
		return err
	}
	if failure != nil {
		sdkError(q.w, failure.status, failure.code, failure.message)
		return nil
	}

	// Unsynced attributes ride along with receipts. Invalid ones are skipped: they must never fail
	// a purchase.
	rawAttrs, defined := q.prop("attributes")
	updates, _ := ledger.ParseAttributes(rawAttrs, defined, q.now)
	appUserID := idString(user)
	customerID, err := s.recordForCustomer(q, appUserID, result.transactions, result.states, updates, result.replaces)
	if err != nil {
		return err
	}
	// Google Play: acknowledge after recording, so a failure here never loses the purchase.
	if result.ack != nil {
		client, ack := result.google, *result.ack
		s.Deferred.Go("acknowledge Play purchase", func(ctx context.Context) error {
			_, err := google.Acknowledge(ctx, s.Pool, client, app.ID, ack, s.Clock.Now())
			return err
		})
	}

	// Rebuild the snapshot now and answer with it, so the device gets exactly what reads will serve.
	info, err := s.freshCustomerInfo(q, customerID, appUserID)
	if err != nil {
		return err
	}
	if app.Store == config.PlayStore {
		for _, t := range result.transactions {
			if t.TransactionID == result.postedTransactionID && result.postedTransactionID != "" {
				// Android consumes a purchase only when told to (spec/sdk-wire-contract.md, rule 5).
				info.Set("purchased_products", jsobj.New(t.ProductID, jsobj.New("should_consume", t.ProductType == string(config.Consumable))))
				break
			}
		}
	}
	writeJSON(q.w, http.StatusOK, info)
	return nil
}

func (s *server) chainStore() applejws.ChainStore { return applejws.PostgresStore(s.Pool, s.Clock.Now) }

// verifyJWS checks App Store signed data against the trusted roots at the server's time.
func (s *server) verifyJWS(ctx context.Context, jws string, now int64) (any, error) {
	return s.JWS.Verify(ctx, jws, applejws.Options{Roots: s.AppleRoots, At: now, Store: s.chainStore()})
}

func (s *server) appleReceipt(q *sdkRequest, token string, restore bool) (*receipt, *receiptFailure, error) {
	// StoreKit 2 sends one signed transaction (a JWS). StoreKit 1 sends the whole app receipt.
	if len(strings.Split(token, ".")) != 3 {
		return s.storeKit1Receipt(q, token)
	}
	ctx := q.r.Context()
	app := q.app
	tx, err := s.verifyJWS(ctx, token, q.now)
	if err != nil {
		// A bad signature won't get better on retry: 4xx lets StoreKit finish the transaction.
		if applejws.IsError(err) {
			return nil, &receiptFailure{http.StatusBadRequest, codeInvalidReceipt, "Invalid transaction: " + err.Error()}, nil
		}
		return nil, nil, err
	}

	product := productOf(app, tx)
	if product == nil {
		// 5xx, not 4xx: a missing product is a config mistake, and the purchase must not be lost.
		return nil, &receiptFailure{http.StatusInternalServerError, codeInternalServerError, "Product " + apple.Str(tx, "productId") + " is not in the config."}, nil
	}
	row, err := apple.TransactionRow(tx, app, product)
	if err != nil {
		// Bundle or type mismatch: most likely the config, so keep the purchase queued.
		return nil, &receiptFailure{http.StatusInternalServerError, codeInternalServerError, err.Error()}, nil
	}
	result := &receipt{transactions: []ledger.NewTransaction{row}, postedTransactionID: row.TransactionID}

	// On restore, the device's view may be stale (a refund or lapse it hasn't seen), so ask Apple
	// for the current status of every subscription. Best effort: the verified transaction already
	// stands on its own.
	if restore && app.AppStoreServerAPI != nil {
		err := func() error {
			clients, err := apple.ClientsFor(app, s.Secret, s.HTTPClient, s.AppleTokens)
			if err != nil {
				return err
			}
			sync, err := apple.SyncStatuses(ctx, clients.For(row.Environment), app, row.TransactionID)
			if err != nil {
				return err
			}
			for _, t := range sync.Transactions {
				if t.TransactionID != row.TransactionID {
					result.transactions = append(result.transactions, t)
				}
			}
			result.states = append(result.states, sync.States...)
			return nil
		}()
		if err != nil {
			s.Log.Error("Restore status refresh failed", "error", err.Error())
		}
	}
	return result, nil, nil
}

// productOf is the configured product a payload names (`app.products.get(tx.productId)`).
func productOf(app *config.App, payload any) *config.Product {
	v, _ := jsobj.Prop(payload, "productId")
	id, ok := v.(string)
	if !ok {
		return nil
	}
	return app.Products[id]
}

// storeKit1Receipt: the app receipt isn't trusted. One transaction ID is pulled out of it and the
// App Store Server API is asked for the customer's purchases; Apple's answer is what's recorded.
func (s *server) storeKit1Receipt(q *sdkRequest, receiptBase64 string) (*receipt, *receiptFailure, error) {
	app := q.app
	clients, err := apple.ClientsFor(app, s.Secret, s.HTTPClient, s.AppleTokens)
	if err != nil {
		// 5xx keeps the purchase on the device until the operator adds the API key.
		return nil, &receiptFailure{http.StatusServiceUnavailable, codeInternalServerError, "StoreKit 1 receipt: " + err.Error()}, nil
	}
	parsed, err := applereceipt.Parse(receiptBase64)
	if err != nil {
		return nil, &receiptFailure{http.StatusBadRequest, codeInvalidReceipt, "Invalid receipt: " + err.Error()}, nil
	}
	// A receipt with no in-app purchases: nothing to record.
	if parsed.TransactionID == "" {
		return &receipt{}, nil, nil
	}

	sync, err := apple.SyncFromTransactionID(q.r.Context(), clients, app, parsed.TransactionID)
	if err != nil {
		var apiErr *apple.APIError
		if errors.As(err, &apiErr) {
			switch {
			case apiErr.NotFound():
				// Unknown in both environments: the receipt doesn't describe a real purchase.
				return nil, &receiptFailure{http.StatusBadRequest, codeInvalidReceipt, "Apple doesn't recognize this receipt's transactions."}, nil
			case apiErr.Retryable():
				// Rate limits and Apple outages: keep the purchase queued and retry later.
				return nil, &receiptFailure{http.StatusServiceUnavailable, codeInternalServerError, "The App Store is unavailable; try again later."}, nil
			}
			// 401 and similar: a credentials problem on our side, so keep the purchase queued.
			s.Log.Error("App Store Server API error", "error", err.Error())
			return nil, &receiptFailure{http.StatusInternalServerError, codeInternalServerError, "App Store Server API error " + itoa(apiErr.Status) + "; check the API key settings."}, nil
		}
		return nil, nil, err
	}
	if len(sync.Skipped) > 0 {
		s.Log.Warn("Apple returned products not in the config", "app", app.ID, "products", strings.Join(sync.Skipped, ", "))
	}
	return &receipt{transactions: sync.Transactions, states: sync.States}, nil, nil
}

// googleReceipt verifies a Google Play purchase with the Play Developer API, or, for apps that
// allow it in development, records it unverified.
func (s *server) googleReceipt(q *sdkRequest, token any) (*receipt, *receiptFailure, error) {
	app := q.app
	ref, _ := q.prop("platform_product_ids")
	var first any
	if list, ok := ref.([]any); ok && len(list) > 0 {
		first = list[0]
	}
	productID := ""
	if v, ok := jsobj.Prop(first, "product_id"); ok && v != nil {
		productID = jsobj.String(v, true)
	} else if ids, _ := q.prop("product_ids"); ids != nil {
		if list, ok := ids.([]any); ok && len(list) > 0 && list[0] != nil {
			productID = jsobj.String(list[0], true)
		}
	}
	product := app.Products[productID]
	if product == nil {
		// 5xx, not 4xx: a missing product is a config mistake, and the purchase must not be lost.
		return nil, &receiptFailure{http.StatusInternalServerError, codeInternalServerError, "Product " + productID + " is not in the config."}, nil
	}
	tokenStr := jsobj.String(token, true)

	if app.GooglePlayAPI != nil {
		client, err := google.ClientFor(app, s.googleEnv())
		if err != nil {
			return nil, &receiptFailure{http.StatusServiceUnavailable, codeInternalServerError, err.Error()}, nil
		}
		p, err := google.VerifyPurchase(q.r.Context(), client, app, tokenStr, productID, q.now, s.Log)
		if err != nil {
			var apiErr *google.APIError
			var pending *google.PendingError
			var mapping *google.MappingError
			switch {
			case errors.As(err, &apiErr) && apiErr.NotFound():
				// Google doesn't know the token: not a real purchase of this app, so let the device drop it.
				return nil, &receiptFailure{http.StatusBadRequest, codeInvalidReceipt, "Google Play doesn't recognize this purchase."}, nil
			case errors.As(err, &apiErr) && apiErr.Retryable():
				return nil, &receiptFailure{http.StatusServiceUnavailable, codeInternalServerError, "Google Play is unavailable; try again later."}, nil
			case errors.As(err, &apiErr):
				s.Log.Error("Google Play Developer API error", "error", err.Error())
				return nil, &receiptFailure{http.StatusInternalServerError, codeInternalServerError, "Google Play Developer API error " + itoa(apiErr.Status) + "; check the service account's access."}, nil
			case errors.As(err, &pending):
				// Pending purchases aren't paid yet; keep them on the device.
				return nil, &receiptFailure{http.StatusServiceUnavailable, codeInternalServerError, err.Error()}, nil
			case errors.As(err, &mapping):
				return nil, &receiptFailure{http.StatusInternalServerError, codeInternalServerError, err.Error()}, nil
			}
			return nil, nil, err
		}
		return &receipt{transactions: p.Transactions, states: p.States, postedTransactionID: p.PostedTransactionID,
			ack: p.Ack, replaces: p.Replaces, google: client}, nil, nil
	}

	if !app.AllowUnverifiedPurchases {
		// 5xx keeps the purchase on the device until the operator configures google_play_api.
		return nil, &receiptFailure{http.StatusServiceUnavailable, codeInternalServerError, "App " + app.ID + " has no google_play_api in the config, so Play purchases can't be verified."}, nil
	}
	now := q.now
	// Development only (allow_unverified_purchases): nothing here is checked with Google.
	row := ledger.NewTransaction{Source: "sdk"}
	t := &row.Transaction
	t.AppID = app.ID
	t.Store = string(config.PlayStore)
	t.Environment = "sandbox"
	t.TransactionID = tokenStr
	t.OriginalTransactionID = tokenStr
	t.ProductID = productID
	if v, ok := jsobj.Prop(first, "base_plan_id"); ok && v != nil {
		plan := jsobj.String(v, true)
		t.BasePlanID = &plan
	}
	t.ProductType = string(product.Type)
	t.PurchasedAt = now
	t.OriginalPurchasedAt = now
	if product.Type == config.Subscription {
		exp := now + unverifiedSubscriptionMs
		t.ExpiresAt = &exp
	}
	t.PeriodType = "normal"
	t.OwnershipType = "PURCHASED"
	return &receipt{transactions: []ledger.NewTransaction{row}, postedTransactionID: row.TransactionID}, nil, nil
}

// recordForCustomer writes transactions and status for the customer who posted them, applying
// RevenueCat's default restore behavior ("transfer to new App User ID") per purchase chain: a chain
// owned by an anonymous user merges that user in; a chain owned by a named user transfers.
//
// replaces is the Play purchase token a new one replaces ("" for none): its chain is marked
// upgraded in the same transaction.
func (s *server) recordForCustomer(q *sdkRequest, appUserID string, transactions []ledger.NewTransaction, states []ledger.StateUpdate, attributes *ledger.Updates, replaces string) (string, error) {
	ctx := q.r.Context()
	project := q.project
	now := q.now
	customer, err := ledger.EnsureCustomer(ctx, s.Pool, project.ID, appUserID, now)
	if err != nil {
		return "", err
	}
	if attributes.Len() > 0 {
		if _, err := ledger.EnforceCustomLimit(ctx, s.Pool, customer.ID, attributes); err != nil {
			return "", err
		}
	}

	// Each chain once, with its last transaction (a JS Map).
	var chainOrder []string
	chains := map[string]ledger.NewTransaction{}
	for _, t := range transactions {
		if _, ok := chains[t.OriginalTransactionID]; !ok {
			chainOrder = append(chainOrder, t.OriginalTransactionID)
		}
		chains[t.OriginalTransactionID] = t
	}
	store := ""
	if len(transactions) > 0 {
		store = transactions[0].Store
	}
	var owners []ledger.OwnerEntry
	if store != "" {
		if owners, err = ledger.PurchaseOwners(ctx, s.Pool, store, chainOrder); err != nil {
			return "", err
		}
	}

	var merged []string
	isMerged := func(id string) bool {
		for _, m := range merged {
			if m == id {
				return true
			}
		}
		return false
	}
	for _, e := range owners {
		o := e.Owner
		// A purchase chain belongs to one app, so its owner is always in this project; never merge
		// across projects.
		if o.ID != customer.ID && o.AnonymousOnly && o.ProjectID == customer.ProjectID && !isMerged(o.ID) {
			merged = append(merged, o.ID)
		}
	}
	// Snapshots of everyone whose CustomerInfo changes: this customer, and anyone losing a purchase.
	affected := []string{customer.ID}
	for _, e := range owners {
		if !contains(affected, e.Owner.ID) {
			affected = append(affected, e.Owner.ID)
		}
	}

	// Webhook events, built from the data as it is before the writes (as Lite builds them before
	// its batch): purchase events for recent transactions, and TRANSFER when a named user loses a
	// purchase to this customer.
	var events []*webhooks.Prepared
	if len(project.Webhooks) > 0 && len(transactions) > 0 {
		type planned struct {
			e apple.PlannedEvent
			t *ledger.Transaction
		}
		var wanted []planned
		for i := range transactions {
			t := &transactions[i].Transaction
			for _, e := range apple.ReceiptPurchaseEvents(t, now) {
				if len(webhooks.For(project, e.Type, t.Environment)) > 0 {
					wanted = append(wanted, planned{e, t})
				}
			}
		}
		var losers []ledger.Owner
		for _, e := range owners {
			if e.Owner.ID != customer.ID && !e.Owner.AnonymousOnly && !containsOwner(losers, e.Owner.ID) {
				losers = append(losers, e.Owner)
			}
		}
		env := transactions[0].Environment
		wantsTransfer := len(losers) > 0 && len(webhooks.For(project, "TRANSFER", env)) > 0
		if len(wanted) > 0 || wantsTransfer {
			// Customer details as they'll be once the writes land (anonymous owners merged in).
			eventCustomer, err := webhooks.LoadCustomer(ctx, s.Pool, append([]string{customer.ID}, merged...), customer.ID, appUserID)
			if err != nil {
				return "", err
			}
			// Attributes sent with this receipt are written too, so apply them here.
			for _, u := range attributes.List() {
				if cur, ok := eventCustomer.Attributes.Get(u.Key); ok {
					at, _ := jsobj.Prop(cur, "updated_at_ms")
					if f, _ := at.(float64); f >= float64(u.UpdatedAt) {
						continue
					}
				}
				if u.Value == nil {
					eventCustomer.Attributes.Delete(u.Key)
				} else {
					eventCustomer.Attributes.Set(u.Key, jsobj.New("value", *u.Value, "updated_at_ms", float64(u.UpdatedAt)))
				}
			}
			for _, w := range wanted {
				p, err := webhooks.Prepare(ctx, s.Pool, project, webhooks.Input{
					Type: w.e.Type, DedupeKey: w.e.DedupeKey, AppID: q.app.ID, Environment: w.t.Environment, Store: w.t.Store,
					Customer: eventCustomer, Transaction: w.t, Extra: w.e.Extra, NegativePrice: w.e.NegativePrice, Now: now,
				})
				if err != nil {
					return "", err
				}
				if p != nil {
					events = append(events, p)
				}
			}
			if wantsTransfer {
				for _, loser := range losers {
					from, err := webhooks.LoadCustomer(ctx, s.Pool, []string{loser.ID}, loser.ID, "")
					if err != nil {
						return "", err
					}
					p, err := webhooks.Prepare(ctx, s.Pool, project, webhooks.Input{
						Type:        "TRANSFER",
						DedupeKey:   "transfer:" + store + ":" + loser.ID + ":" + customer.ID + ":" + itoa64(now),
						AppID:       q.app.ID,
						Environment: env,
						Store:       store,
						Customer:    eventCustomer,
						Extra:       jsobj.New("transferred_from", stringsToAny(from.Aliases), "transferred_to", stringsToAny(eventCustomer.Aliases)),
						Now:         now,
					})
					if err != nil {
						return "", err
					}
					if p != nil {
						events = append(events, p)
					}
				}
			}
		}
	}

	err = pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		for _, id := range merged {
			if err := ledger.MergeCustomers(ctx, tx, id, customer.ID); err != nil {
				return err
			}
		}
		for _, t := range transactions {
			if err := ledger.UpsertTransaction(ctx, tx, t, now); err != nil {
				return err
			}
		}
		for _, id := range chainOrder {
			t := chains[id]
			if err := ledger.AssignOwner(ctx, tx, t.Store, t.OriginalTransactionID, t.AppID, customer.ID, now); err != nil {
				return err
			}
		}
		for _, st := range states {
			if err := ledger.UpsertSubscriptionState(ctx, tx, st, now); err != nil {
				return err
			}
		}
		if attributes.Len() > 0 {
			if err := ledger.WriteAttributes(ctx, tx, customer.ID, attributes, now); err != nil {
				return err
			}
		}
		if replaces != "" {
			if err := google.MarkReplaced(ctx, tx, replaces); err != nil {
				return err
			}
		}
		for _, id := range affected {
			if !isMerged(id) {
				if err := customerinfo.Invalidate(ctx, tx, id); err != nil {
					return err
				}
			}
		}
		for _, e := range events {
			if err := e.Write(ctx, tx); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	s.deliverLater(q.config, events)

	// Customers who lost a purchase get fresh snapshots in the background.
	cfg := q.config
	for _, id := range affected {
		if id != customer.ID && !isMerged(id) {
			s.refreshLater(cfg, id)
		}
	}
	return customer.ID, nil
}

// refreshLater rebuilds a customer's snapshot after the response.
func (s *server) refreshLater(cfg *config.Config, customerID string) {
	s.Deferred.Go("refresh snapshot", func(ctx context.Context) error {
		_, err := customerinfo.Refresh(ctx, s.Pool, cfg, customerID, s.Clock.Now())
		return err
	})
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func containsOwner(list []ledger.Owner, id string) bool {
	for _, o := range list {
		if o.ID == id {
			return true
		}
	}
	return false
}

func itoa(n int) string { return itoa64(int64(n)) }

func itoa64(n int64) string { return jsobj.FormatNumber(float64(n)) }
