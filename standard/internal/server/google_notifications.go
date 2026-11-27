package server

// Google Play Real-time Developer Notifications: POST /notifications/google, delivered by a
// Pub/Sub push subscription with authentication enabled. A port of
// lite/src/routes/google-notifications.ts.
//
// Notifications only say that something changed, so each one is followed by a Play Developer API
// call for the current state (Google recommends exactly this). Then, as for Apple: upsert the
// transaction, update the subscription status, record webhook events, all in one Postgres
// transaction with the "processed" record (dedupe on Pub/Sub's messageId). Ownership isn't
// assigned here, except that a new purchase token linked to an owned one (upgrade, re-signup)
// inherits that owner.
//
// Responses: Pub/Sub redelivers anything that isn't a 2xx, for up to 7 days.
//   - 2xx once processed, already processed, or when retrying can't help (malformed message,
//     purchase token Google no longer knows).
//   - 401 for a missing or invalid push token.
//   - 5xx when the config doesn't know the app or product, or Google is unavailable.

import (
	"context"
	"errors"
	"io"
	"math"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/openpurr/openpurr/standard/internal/apple"
	"github.com/openpurr/openpurr/standard/internal/applejws"
	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/customerinfo"
	"github.com/openpurr/openpurr/standard/internal/google"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
	"github.com/openpurr/openpurr/standard/internal/webhooks"
)

func (s *server) googleNotification(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusNotFound, jsobj.New("code", 0.0, "message", "Not found"))
		return
	}
	if err := s.handleGoogleNotification(w, r); err != nil {
		s.internalError(w, r, err)
	}
}

// googleEnv is what the google package needs from the server.
func (s *server) googleEnv() google.Env {
	return google.Env{Secret: s.Secret, HTTP: s.HTTPClient, Tokens: s.GoogleTokens, Now: s.Clock.Now, Log: s.Log,
		Deliver: func(ctx context.Context, ids []string, now int64) error {
			cfg, err := s.Config.Get(ctx)
			if err != nil {
				return err
			}
			_, err = s.Webhooks.DeliverNow(ctx, cfg, ids, now)
			return err
		}}
}

// defaultAudience is the push endpoint's URL, the audience Pub/Sub uses unless the config names
// another. Pub/Sub only pushes to https endpoints, and TLS usually ends at a proxy in front of
// this server, so the scheme is always https.
func defaultAudience(r *http.Request) string {
	return "https://" + r.Host + "/notifications/google"
}

func (s *server) handleGoogleNotification(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	all, err := s.Config.Get(ctx)
	if err != nil {
		return err
	}
	var playApps []*config.App
	for _, id := range sortedAppIDs(all) {
		if a := all.Apps[id]; a.Store == config.PlayStore && a.GooglePlayAPI != nil && a.GooglePlayAPI.PubsubPushAccount != "" {
			playApps = append(playApps, a)
		}
	}
	if len(playApps) == 0 {
		notificationReply(w, http.StatusUnauthorized, "No Google Play app has google_play_api.pubsub_push_account configured.")
		return nil
	}

	// 1. Authenticate the push before reading anything else.
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		notificationReply(w, http.StatusUnauthorized, "Missing Pub/Sub push token.")
		return nil
	}
	audienceOf := func(app *config.App) string {
		if a := app.GooglePlayAPI.PubsubAudience; a != nil {
			return *a
		}
		return defaultAudience(r)
	}
	var audiences []string
	for _, a := range playApps {
		if aud := audienceOf(a); !contains(audiences, aud) {
			audiences = append(audiences, aud)
		}
	}
	claims, err := s.GoogleKeys.Verify(ctx, auth[len("Bearer "):], audiences)
	if err != nil {
		if google.IsIDTokenError(err) {
			notificationReply(w, http.StatusUnauthorized, "Invalid Pub/Sub push token: "+err.Error())
			return nil
		}
		return err
	}

	// 2. Unwrap the Pub/Sub message.
	data, _ := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes+1))
	var body any
	if len(data) <= maxBodyBytes {
		body, _ = jsobj.Parse(data)
	}
	message, _ := jsobj.Prop(body, "message")
	messageIDV, _ := jsobj.Prop(message, "messageId")
	dataV, hasData := jsobj.Prop(message, "data")
	encoded := ""
	if hasData && dataV != nil {
		encoded = jsobj.String(dataV, true)
	}
	var n any
	decoded, err := applejws.Atob(encoded)
	if err == nil {
		n, err = jsobj.Parse(decoded)
	}
	pkgV, _ := jsobj.Prop(n, "packageName")
	pkg, hasPkg := pkgV.(string)
	// Not JSON, or JSON that isn't a notification for some package (null, a number, no
	// packageName): redelivery can't fix that, so acknowledge it and Pub/Sub stops retrying.
	if err != nil || !hasPkg {
		s.Log.Error("Ignoring malformed Pub/Sub message", "messageId", jsobj.String(messageIDV, messageIDV != nil))
		notificationReply(w, http.StatusOK, "Ignored: malformed message.")
		return nil
	}
	if !truthy(messageIDV) {
		notificationReply(w, http.StatusOK, "Ignored: no messageId.")
		return nil
	}
	messageID := jsobj.String(messageIDV, true)

	var app *config.App
	for _, a := range playApps {
		if pkg == a.PackageName {
			app = a
			break
		}
	}
	if app == nil {
		s.Log.Error("Google notification for a package no configured app has", "package", pkg)
		notificationReply(w, http.StatusInternalServerError, "No app in the config has package "+pkg+" with Pub/Sub push configured.")
		return nil
	}
	project := all.Projects[app.ProjectID]
	// The token must come from this app's push account, for this app's audience.
	email, _ := jsobj.Prop(claims, "email")
	aud, _ := jsobj.Prop(claims, "aud")
	if email != app.GooglePlayAPI.PubsubPushAccount || aud != audienceOf(app) {
		notificationReply(w, http.StatusUnauthorized, "The push token isn't from this app's Pub/Sub push account.")
		return nil
	}

	seen, err := ledger.NotificationSeen(ctx, s.Pool, "play_store", messageID)
	if err != nil {
		return err
	}
	if seen {
		notificationReply(w, http.StatusOK, "Already processed.")
		return nil
	}
	now := s.Clock.Now()
	eventTime := float64(now)
	if v, ok := jsobj.Prop(n, "eventTimeMillis"); ok && v != nil {
		eventTime = google.Number(v)
	}
	if math.IsNaN(eventTime) || math.IsInf(eventTime, 0) {
		// Lite can't store a notification without a time either.
		return errors.New("notification eventTimeMillis isn't a number")
	}
	at := int64(eventTime)
	subN, _ := jsobj.Prop(n, "subscriptionNotification")
	oneTimeN, _ := jsobj.Prop(n, "oneTimeProductNotification")
	voidedN, _ := jsobj.Prop(n, "voidedPurchaseNotification")
	testN, _ := jsobj.Prop(n, "testNotification")
	kind := "OTHER"
	switch {
	case truthy(subN):
		t, ok := jsobj.Prop(subN, "notificationType")
		kind = "SUBSCRIPTION_" + jsobj.String(t, ok)
	case truthy(oneTimeN):
		t, ok := jsobj.Prop(oneTimeN, "notificationType")
		kind = "ONE_TIME_" + jsobj.String(t, ok)
	case truthy(voidedN):
		kind = "VOIDED_PURCHASE"
	case truthy(testN):
		kind = "TEST"
	}
	record := func(token *string) ledger.Notification {
		return ledger.Notification{
			Store:                 "play_store",
			NotificationID:        messageID,
			NotificationType:      kind,
			Environment:           "production",
			AppID:                 &app.ID,
			OriginalTransactionID: token,
			SignedAt:              at,
			Payload:               encoded,
		}
	}

	if truthy(testN) || kind == "OTHER" {
		if err := ledger.RecordNotification(ctx, s.Pool, record(nil), now); err != nil {
			return err
		}
		notificationReply(w, http.StatusOK, "OK")
		return nil
	}

	client, err := google.ClientFor(app, s.googleEnv())
	if err != nil {
		var nc *google.NotConfiguredError
		if errors.As(err, &nc) {
			notificationReply(w, http.StatusServiceUnavailable, err.Error())
			return nil
		}
		return err
	}

	// 3. Ask Google for the current state and plan the writes.
	p, failure, err := s.planGoogleNotification(ctx, client, app, messageID, subN, oneTimeN, voidedN, at, now)
	if err != nil {
		var apiErr *google.APIError
		var mapping *google.MappingError
		switch {
		case errors.As(err, &apiErr) && apiErr.NotFound():
			if err := ledger.RecordNotification(ctx, s.Pool, record(nil), now); err != nil {
				return err
			}
			notificationReply(w, http.StatusOK, "Ignored: Google no longer knows this purchase.")
			return nil
		case errors.As(err, &apiErr):
			status := http.StatusInternalServerError
			if apiErr.Retryable() {
				status = http.StatusServiceUnavailable
			}
			notificationReply(w, status, err.Error())
			return nil
		case errors.As(err, &mapping):
			notificationReply(w, http.StatusInternalServerError, err.Error())
			return nil
		}
		return err
	}
	if failure != "" {
		notificationReply(w, http.StatusInternalServerError, failure)
		return nil
	}

	// 4. Ownership: a new purchase token linked to an owned one (plan change, re-signup) inherits
	// that owner, so the customer keeps access without waiting for the app.
	owner, err := ledger.PurchaseOwner(ctx, s.Pool, "play_store", p.token)
	if err != nil {
		return err
	}
	inherit := false
	if owner == nil && p.replaces != "" && p.row != nil {
		if owner, err = ledger.PurchaseOwner(ctx, s.Pool, "play_store", p.replaces); err != nil {
			return err
		}
		inherit = owner != nil
	}

	// 5. Events: the event list, and webhooks where configured (only with an owner: there's no app
	// user to report otherwise).
	var events []*webhooks.Prepared
	if owner != nil && p.row != nil {
		if len(p.planned) > 0 {
			customer, err := webhooks.LoadCustomer(ctx, s.Pool, []string{owner.ID}, owner.ID, "")
			if err != nil {
				return err
			}
			for _, e := range p.planned {
				prepared, err := webhooks.Prepare(ctx, s.Pool, project, webhooks.Input{
					Type: e.Type, DedupeKey: e.DedupeKey, AppID: app.ID, Environment: p.row.Environment, Store: "play_store",
					Customer: customer, Transaction: &p.row.Transaction, Extra: e.Extra, NegativePrice: e.NegativePrice, Now: now,
				})
				if err != nil {
					return err
				}
				if prepared != nil {
					events = append(events, prepared)
				}
			}
		}
	}

	token := p.token
	err = pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if p.upsert != nil {
			if err := ledger.UpsertTransaction(ctx, tx, *p.upsert, now); err != nil {
				return err
			}
		}
		if p.state != nil {
			if err := ledger.UpsertSubscriptionState(ctx, tx, *p.state, now); err != nil {
				return err
			}
		}
		if p.replaces != "" {
			if err := google.MarkReplaced(ctx, tx, p.replaces); err != nil {
				return err
			}
		}
		if p.voidedOrder != "" {
			if _, err := tx.Exec(ctx,
				`UPDATE store_transaction SET revoked_at = coalesce(revoked_at, $1), revocation_reason = 'voided', updated_at = $2
				 WHERE store = 'play_store' AND transaction_id = $3`, at, now, p.voidedOrder); err != nil {
				return err
			}
		}
		if inherit {
			if err := ledger.AssignOwner(ctx, tx, "play_store", p.row.OriginalTransactionID, p.row.AppID, owner.ID, now); err != nil {
				return err
			}
		}
		if err := customerinfo.InvalidateOwner(ctx, tx, "play_store", token); err != nil {
			return err
		}
		for _, e := range events {
			if err := e.Write(ctx, tx); err != nil {
				return err
			}
		}
		return ledger.RecordNotification(ctx, tx, record(&token), now)
	})
	if err != nil {
		return err
	}
	s.deliverLater(all, events)

	if owner != nil {
		ownerID := owner.ID
		s.Deferred.Go("refresh snapshot", func(ctx context.Context) error {
			_, err := customerinfo.Refresh(ctx, s.Pool, all, ownerID, s.Clock.Now())
			return err
		})
	}
	// Safety net: acknowledge purchases the app hasn't (Google refunds them after 3 days).
	if p.ack != nil {
		ack := *p.ack
		s.Deferred.Go("acknowledge Play purchase", func(ctx context.Context) error {
			_, err := google.Acknowledge(ctx, s.Pool, client, app.ID, ack, s.Clock.Now())
			return err
		})
	}
	notificationReply(w, http.StatusOK, "OK")
	return nil
}

// googlePlan is what a notification changes.
type googlePlan struct {
	token string
	// The transaction as the events see it (nil: none).
	row *ledger.NewTransaction
	// The row to upsert, the status to apply and the voided order to mark refunded, if any.
	upsert      *ledger.NewTransaction
	state       *ledger.StateUpdate
	voidedOrder string
	planned     []apple.PlannedEvent
	ack         *google.Ack
	replaces    string
}

// planGoogleNotification asks Google for the current state and plans the writes. A failure is a
// 500 message (the config doesn't know the product); errors are Google's or the database's.
func (s *server) planGoogleNotification(ctx context.Context, client *google.Client, app *config.App, messageID string, subN, oneTimeN, voidedN any, at, now int64) (*googlePlan, string, error) {
	p := &googlePlan{}
	switch {
	case truthy(subN):
		typ, _ := jsobj.Prop(subN, "notificationType")
		tokenV, hasToken := jsobj.Prop(subN, "purchaseToken")
		p.token = jsobj.String(tokenV, hasToken)
		sub, err := client.Subscription(ctx, p.token)
		if err != nil {
			return nil, "", err
		}
		var item any
		if v, _ := jsobj.Prop(sub, "lineItems"); v != nil {
			if list, ok := v.([]any); ok && len(list) > 0 {
				item = list[0]
			}
		}
		productV, hasProduct := jsobj.Prop(item, "productId")
		var product *config.Product
		if id, ok := productV.(string); ok && item != nil {
			product = app.Products[id]
		}
		if item == nil || product == nil {
			return nil, "Product " + jsobj.String(productV, hasProduct) + " is not in the config.", nil
		}
		row, err := google.SubscriptionRow(sub, p.token, app, product, at, nil)
		if err != nil {
			return nil, "", err
		}
		row.Source = "notification"
		if typ == float64(google.SubRevoked) {
			reason := "revoked"
			row.RevokedAt, row.RevocationReason = &at, &reason
		}
		state, err := google.SubscriptionState(sub, p.token, at)
		if err != nil {
			return nil, "", err
		}
		p.row, p.upsert, p.state = &row, &row, &state
		if v, ok := jsobj.Prop(sub, "linkedPurchaseToken"); ok && v != nil {
			p.replaces = jsobj.String(v, true)
		}
		if ackState, _ := jsobj.Prop(sub, "acknowledgementState"); typ == float64(google.SubPurchased) && ackState == "ACKNOWLEDGEMENT_STATE_PENDING" {
			p.ack = &google.Ack{Kind: "subscription", ProductID: product.ID, PurchaseToken: p.token}
		}
		other := p.token
		if p.replaces != "" {
			other = p.replaces
		}
		periodType, productID, basePlan, found, err := ledger.PlayPrevious(ctx, s.Pool, p.token, other, row.TransactionID)
		if err != nil {
			return nil, "", err
		}
		opts := google.EventOptions{PreviousPeriodType: periodType}
		if p.replaces != "" && found {
			plan := "null"
			if basePlan != nil {
				plan = *basePlan
			}
			opts.ReplacedProductID = productID + ":" + plan
		}
		p.planned = google.SubscriptionEvents(typ, messageID, sub, &row.Transaction, opts)

	case truthy(oneTimeN):
		typ, _ := jsobj.Prop(oneTimeN, "notificationType")
		tokenV, hasToken := jsobj.Prop(oneTimeN, "purchaseToken")
		p.token = jsobj.String(tokenV, hasToken)
		skuV, hasSku := jsobj.Prop(oneTimeN, "sku")
		sku, isStr := skuV.(string)
		product := app.Products[sku]
		if !isStr || product == nil {
			return nil, "Product " + jsobj.String(skuV, hasSku) + " is not in the config.", nil
		}
		purchase, err := client.Product(ctx, sku, p.token)
		if err != nil {
			return nil, "", err
		}
		row, err := google.ProductRow(purchase, p.token, app, product, at, nil)
		if err != nil {
			return nil, "", err
		}
		if row != nil {
			row.Source = "notification"
			p.row, p.upsert = row, row
			if ackState, _ := jsobj.Prop(purchase, "acknowledgementState"); typ == 1.0 && ackState == 0.0 && product.Type == config.NonConsumable {
				p.ack = &google.Ack{Kind: "product", ProductID: sku, PurchaseToken: p.token}
			}
			switch {
			case row.RevokedAt != nil:
				p.planned = []apple.PlannedEvent{google.RefundEvent(&row.Transaction)}
			case typ == 1.0:
				p.planned = []apple.PlannedEvent{google.OneTimePurchaseEvent(&row.Transaction)}
			}
		}

	default:
		// Voided purchase: the notification identifies the order; mark it refunded.
		tokenV, hasToken := jsobj.Prop(voidedN, "purchaseToken")
		p.token = jsobj.String(tokenV, hasToken)
		orderV, hasOrder := jsobj.Prop(voidedN, "orderId")
		orderID := jsobj.String(orderV, hasOrder)
		existing, _, err := ledger.PlayOrder(ctx, s.Pool, orderID, false)
		if err != nil {
			return nil, "", err
		}
		if existing != nil {
			row := ledger.NewTransaction{Transaction: *existing, Source: "notification"}
			if row.RevokedAt == nil {
				row.RevokedAt = &at
			}
			reason := "voided"
			row.RevocationReason = &reason
			p.row, p.voidedOrder = &row, orderID
			p.planned = []apple.PlannedEvent{google.RefundEvent(&row.Transaction)}
		}
	}
	return p, "", nil
}
