package server

// App Store Server Notifications V2: POST /notifications/apple, body {"signedPayload": "<JWS>"}.
// A port of lite/src/routes/notifications.ts.
//
// Every notification carries Apple's latest signed transaction and renewal info for one
// subscription (or one-time purchase), plus a status code. Rather than special-casing each of
// Apple's ~20 notification types, all three signatures are verified and what they say is applied:
//   - the transaction is upserted into the ledger (renewals add rows; refunds, revocations and
//     upgrades update existing ones);
//   - the renewal info becomes the subscription's status (auto-renew, billing retry, grace
//     period), applied only if it's newer than what's stored, since delivery order isn't
//     guaranteed.
//
// Ownership never changes here: a notification can arrive before the app posts the purchase, and
// the SDK's POST /v1/receipts assigns the owner when it does.
//
// Responses: Apple retries anything other than 200. So:
//   - 200 once processed, and for a notification already processed;
//   - 400 for a bad signature or malformed body, which retrying won't fix;
//   - 5xx when the config doesn't know the app or product, so Apple retries after the operator
//     fixes the config.

import (
	"context"
	"io"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/openpurr/openpurr/standard/internal/apple"
	"github.com/openpurr/openpurr/standard/internal/applejws"
	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/customerinfo"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
	"github.com/openpurr/openpurr/standard/internal/webhooks"
)

func notificationReply(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, jsobj.New("message", message))
}

func (s *server) appleNotification(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusNotFound, jsobj.New("code", 0.0, "message", "Not found"))
		return
	}
	if err := s.handleAppleNotification(w, r); err != nil {
		s.internalError(w, r, err)
	}
}

func (s *server) handleAppleNotification(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	data, _ := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes+1))
	var body any
	if len(data) <= maxBodyBytes {
		body, _ = jsobj.Parse(data)
	}
	signedV, _ := jsobj.Prop(body, "signedPayload")
	signedPayload, ok := signedV.(string)
	if !ok {
		notificationReply(w, http.StatusBadRequest, `Expected {"signedPayload": "..."}.`)
		return nil
	}
	all, err := s.Config.Get(ctx)
	if err != nil {
		return err
	}
	now := s.Clock.Now()

	notification, err := s.verifyJWS(ctx, signedPayload, now)
	if err != nil {
		if applejws.IsError(err) {
			notificationReply(w, http.StatusBadRequest, "Invalid notification: "+err.Error())
			return nil
		}
		return err
	}
	uuidV, _ := jsobj.Prop(notification, "notificationUUID")
	typeV, _ := jsobj.Prop(notification, "notificationType")
	if !truthy(uuidV) || !truthy(typeV) {
		notificationReply(w, http.StatusBadRequest, "Notification is missing notificationUUID or notificationType.")
		return nil
	}
	uuid := jsobj.String(uuidV, true)
	ntype := jsobj.String(typeV, true)

	seen, err := ledger.NotificationSeen(ctx, s.Pool, "app_store", uuid)
	if err != nil {
		return err
	}
	if seen {
		notificationReply(w, http.StatusOK, "Already processed.")
		return nil
	}

	dataV, ok := jsobj.Prop(notification, "data")
	if !ok || dataV == nil {
		dataV = jsobj.New()
	}
	environment := "sandbox"
	if e, _ := jsobj.Prop(dataV, "environment"); e == "Production" {
		environment = "production"
	}
	var app *config.App
	bundleV, _ := jsobj.Prop(dataV, "bundleId")
	if truthy(bundleV) {
		app = appForBundle(all, bundleV)
		if app == nil {
			bundle := jsobj.String(bundleV, true)
			s.Log.Error("Apple notification for a bundle no app in the config has", "bundle", bundle)
			notificationReply(w, http.StatusInternalServerError, "No app in the config has bundle ID "+bundle+".")
			return nil
		}
	}

	var tx, renewal any
	if v, _ := jsobj.Prop(dataV, "signedTransactionInfo"); truthy(v) {
		jws, isStr := v.(string)
		if !isStr {
			return errNotAString("signedTransactionInfo")
		}
		if tx, err = s.verifyJWS(ctx, jws, now); err != nil {
			return s.invalidSignedData(w, err)
		}
	}
	if v, _ := jsobj.Prop(dataV, "signedRenewalInfo"); truthy(v) {
		jws, isStr := v.(string)
		if !isStr {
			return errNotAString("signedRenewalInfo")
		}
		if renewal, err = s.verifyJWS(ctx, jws, now); err != nil {
			return s.invalidSignedData(w, err)
		}
	}

	var row *ledger.NewTransaction
	if tx != nil && app != nil {
		product := productOf(app, tx)
		if product == nil {
			productID := apple.Str(tx, "productId")
			s.Log.Error("Apple notification for a product the app doesn't list", "app", app.ID, "product", productID)
			notificationReply(w, http.StatusInternalServerError, "Product "+productID+" is not in the config.")
			return nil
		}
		mapped, err := apple.TransactionRow(tx, app, product)
		if err != nil {
			notificationReply(w, http.StatusInternalServerError, err.Error())
			return nil
		}
		mapped.Source = "notification"
		row = &mapped
	}

	var state *ledger.StateUpdate
	if renewal != nil {
		var status *int
		if f, ok := apple.Num(dataV, "status"); ok {
			n := int(f)
			status = &n
		}
		st, err := apple.SubscriptionState(renewal, status)
		if err != nil {
			return err
		}
		state = &st
	}

	// Webhook events, written with the ledger change. A purchase nobody owns yet has no app user to
	// report; the SDK's POST /v1/receipts produces its purchase event when it arrives.
	var events []*webhooks.Prepared
	var project *config.Project
	if app != nil {
		project = all.Projects[app.ProjectID]
	}
	if row != nil && project != nil && len(project.Webhooks) > 0 {
		owner, err := ledger.PurchaseOwner(ctx, s.Pool, "app_store", row.OriginalTransactionID)
		if err != nil {
			return err
		}
		subtypeV, _ := jsobj.Prop(notification, "subtype")
		subtype, _ := subtypeV.(string)
		previous := ""
		if ntype == "DID_RENEW" || subtype == "RESUBSCRIBE" {
			if previous, err = ledger.PreviousPeriodType(ctx, s.Pool, row.OriginalTransactionID, row.TransactionID); err != nil {
				return err
			}
		}
		planned := apple.NotificationEvents(apple.Notification{Type: ntype, Subtype: subtype, UUID: uuid}, &row.Transaction, renewal, previous)
		var wanted []apple.PlannedEvent
		for _, e := range planned {
			if len(webhooks.For(project, e.Type, row.Environment)) > 0 {
				wanted = append(wanted, e)
			}
		}
		if owner != nil && len(wanted) > 0 {
			customer, err := webhooks.LoadCustomer(ctx, s.Pool, []string{owner.ID}, owner.ID, "")
			if err != nil {
				return err
			}
			for _, e := range wanted {
				p, err := webhooks.Prepare(ctx, s.Pool, project, webhooks.Input{
					Type: e.Type, DedupeKey: e.DedupeKey, AppID: app.ID, Environment: row.Environment, Store: "app_store",
					Customer: customer, Transaction: &row.Transaction, Extra: e.Extra, NegativePrice: e.NegativePrice, Now: now,
				})
				if err != nil {
					return err
				}
				if p != nil {
					events = append(events, p)
				}
			}
		}
	}

	chain := ""
	switch {
	case row != nil:
		chain = row.OriginalTransactionID
	case renewal != nil:
		// `row?.original_transaction_id ?? renewal?.originalTransactionId`, used when truthy.
		if v, _ := jsobj.Prop(renewal, "originalTransactionId"); truthy(v) {
			chain = jsobj.String(v, true)
		}
	}
	record := ledger.Notification{
		Store:            "app_store",
		NotificationID:   uuid,
		NotificationType: ntype,
		Environment:      environment,
		Payload:          signedPayload,
	}
	if v, ok := jsobj.Prop(notification, "subtype"); ok && v != nil {
		sub := jsobj.String(v, true)
		record.Subtype = &sub
	}
	if app != nil {
		record.AppID = &app.ID
	}
	switch {
	case tx != nil:
		id := apple.Str(tx, "originalTransactionId")
		record.OriginalTransactionID = &id
	case renewal != nil:
		if v, ok := jsobj.Prop(renewal, "originalTransactionId"); ok && v != nil {
			id := jsobj.String(v, true)
			record.OriginalTransactionID = &id
		}
	}
	signedAt, ok := apple.Num(notification, "signedDate")
	if !ok {
		// Lite can't store a notification without its signed date either.
		return errNotAString("signedDate")
	}
	record.SignedAt = int64(signedAt)

	// One transaction: the ledger update, its webhook events and the "processed" record land
	// together.
	err = pgx.BeginFunc(ctx, s.Pool, func(dbtx pgx.Tx) error {
		if row != nil {
			if err := ledger.UpsertTransaction(ctx, dbtx, *row, now); err != nil {
				return err
			}
		}
		for _, e := range events {
			if err := e.Write(ctx, dbtx); err != nil {
				return err
			}
		}
		if state != nil {
			if err := ledger.UpsertSubscriptionState(ctx, dbtx, *state, now); err != nil {
				return err
			}
		}
		// Whoever owns this purchase now has different CustomerInfo: drop their snapshot.
		if chain != "" {
			if err := customerinfo.InvalidateOwner(ctx, dbtx, "app_store", chain); err != nil {
				return err
			}
		}
		return ledger.RecordNotification(ctx, dbtx, record, now)
	})
	if err != nil {
		return err
	}
	// Rebuild the owner's snapshot in the background; until then, reads compute it.
	if chain != "" {
		s.Deferred.Go("refresh snapshot", func(ctx context.Context) error {
			owner, err := ledger.PurchaseOwner(ctx, s.Pool, "app_store", chain)
			if err != nil || owner == nil {
				return err
			}
			_, err = customerinfo.Refresh(ctx, s.Pool, all, owner.ID, s.Clock.Now())
			return err
		})
	}
	notificationReply(w, http.StatusOK, "OK")
	return nil
}

func (s *server) invalidSignedData(w http.ResponseWriter, err error) error {
	if applejws.IsError(err) {
		notificationReply(w, http.StatusBadRequest, "Invalid signed data in notification: "+err.Error())
		return nil
	}
	return err
}

func errNotAString(field string) error { return &fieldError{field} }

type fieldError struct{ field string }

func (e *fieldError) Error() string { return "notification field " + e.field + " is unusable" }

// appForBundle is the App Store app with a bundle ID, in any project.
func appForBundle(all *config.Config, bundle any) *config.App {
	for _, id := range sortedAppIDs(all) {
		app := all.Apps[id]
		if app.Store == config.AppStore && app.BundleID == bundle {
			return app
		}
	}
	return nil
}

// sortedAppIDs lists apps in config order (projects in document order, then their apps).
func sortedAppIDs(all *config.Config) []string {
	var ids []string
	for _, pid := range all.ProjectOrder {
		if p := all.Projects[pid]; p != nil {
			ids = append(ids, p.AppOrder...)
		}
	}
	return ids
}
