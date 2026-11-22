// Package webhooks records outbound webhook events: RevenueCat-shaped events for the endpoints in
// the config, written to webhook_event and webhook_delivery in the same transaction as the ledger
// change that caused them, so an event exists exactly when its change does. A port of the enqueue
// side of lite/src/webhooks.ts; delivery, signing and retries arrive with the job loop.
//
// Body: {"api_version": "1.0", "event": {...}}, with RevenueCat's field names. `price` is in USD,
// converted at the purchase date's exchange rate; it's null for currencies without a rate.
//
// A dedupe key makes each fact produce one event, whichever source reports it first (the SDK's
// receipt or the store's notification).
package webhooks

import (
	"context"
	"slices"

	"github.com/jackc/pgx/v5"

	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/countries"
	"github.com/openpurr/openpurr/standard/internal/fx"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
)

// RetryDelaysMs are the delays after each failed delivery attempt; about 72 hours in total.
var RetryDelaysMs = []int64{5 * 60_000, 10 * 60_000, 45 * 60_000, 120 * 60_000, 180 * 60_000, 360 * 60_000, 720 * 60_000, 1440 * 60_000, 1440 * 60_000}

// Customer is the customer context of an event body.
type Customer struct {
	ID string
	// The "last seen" app user ID.
	AppUserID         string
	OriginalAppUserID string
	Aliases           []string
	// {"<key>": {"value": "...", "updated_at_ms": n}}
	Attributes *jsobj.Object
	// Price experiments the customer is enrolled in (RevenueCat's `experiments`).
	Experiments []any
}

// Input is one event to record.
type Input struct {
	Type string
	// One event per dedupe key, ever.
	DedupeKey   string
	AppID       string
	Environment string
	Store       string
	Customer    *Customer
	Transaction *ledger.Transaction
	// Event-specific fields; nil for none.
	Extra *jsobj.Object
	// Refund events report a negative price.
	NegativePrice bool
	Now           int64
}

// For returns the project's endpoints that want an event type in an environment.
func For(project *config.Project, typ, environment string) []*config.Webhook {
	var out []*config.Webhook
	for _, w := range project.Webhooks {
		if slices.Contains(w.Environments, environment) && (w.Events == nil || w.Events[typ]) {
			out = append(out, w)
		}
	}
	return out
}

// Body is the event body (eventBody). priceUSD is nil when unknown.
func Body(project *config.Project, in Input, id string, priceUSD *float64) *jsobj.Object {
	t := in.Transaction
	sign := 1.0
	if in.NegativePrice {
		sign = -1
	}
	environment := "SANDBOX"
	if in.Environment == "production" {
		environment = "PRODUCTION"
	}
	store := "PLAY_STORE"
	if in.Store == "app_store" {
		store = "APP_STORE"
	}
	aliases := make([]any, len(in.Customer.Aliases))
	for i, a := range in.Customer.Aliases {
		aliases[i] = a
	}
	event := jsobj.New(
		"id", id,
		"type", in.Type,
		"event_timestamp_ms", float64(in.Now),
		"app_id", in.AppID,
		"app_user_id", in.Customer.AppUserID,
		"original_app_user_id", in.Customer.OriginalAppUserID,
		"aliases", aliases,
		"environment", environment,
		"store", store,
	)
	if t != nil {
		var amount any
		if t.PriceMicros != nil {
			amount = sign * float64(*t.PriceMicros) / 1e6
		}
		productID := t.ProductID
		if t.BasePlanID != nil && *t.BasePlanID != "" {
			productID += ":" + *t.BasePlanID
		}
		var expiration any
		if t.ProductType == string(config.Subscription) && t.ExpiresAt != nil {
			expiration = float64(*t.ExpiresAt)
		}
		var entitlementIDs any
		if ids := project.EntitlementsFor(t.AppID, t.ProductID, t.BasePlanID); len(ids) > 0 {
			list := make([]any, len(ids))
			for i, e := range ids {
				list[i] = e
			}
			entitlementIDs = list
		}
		// Apple's storefront is ISO 3166-1 alpha-3; Google's regionCode is already alpha-2, which
		// is what RevenueCat sends.
		var country any
		if t.Store == "app_store" {
			if t.Storefront != nil {
				if c := countries.Alpha2FromAlpha3(*t.Storefront); c != "" {
					country = c
				}
			}
		} else if t.Storefront != nil {
			country = *t.Storefront
		}
		var currency any
		if t.Currency != nil {
			currency = *t.Currency
		}
		var price any
		switch {
		case priceUSD != nil:
			price = *priceUSD
		case t.Currency != nil && *t.Currency == "USD":
			price = amount
		}
		event.Set("product_id", productID)
		event.Set("period_type", upper(t.PeriodType))
		event.Set("purchased_at_ms", float64(t.PurchasedAt))
		event.Set("expiration_at_ms", expiration)
		event.Set("entitlement_id", nil)
		event.Set("entitlement_ids", entitlementIDs)
		event.Set("presented_offering_id", nil)
		event.Set("transaction_id", t.TransactionID)
		event.Set("original_transaction_id", t.OriginalTransactionID)
		event.Set("is_family_share", t.OwnershipType == "FAMILY_SHARED")
		event.Set("country_code", country)
		event.Set("currency", currency)
		event.Set("price", price)
		event.Set("price_in_purchased_currency", amount)
		event.Set("tax_percentage", nil)
		event.Set("commission_percentage", nil)
		event.Set("takehome_percentage", nil)
		event.Set("offer_code", nil)
	}
	attrs := in.Customer.Attributes
	if attrs == nil {
		attrs = jsobj.New()
	}
	event.Set("subscriber_attributes", attrs)
	if len(in.Customer.Experiments) > 0 {
		event.Set("experiments", in.Customer.Experiments)
	}
	if in.Extra != nil {
		for _, k := range in.Extra.Keys() {
			v, _ := in.Extra.Get(k)
			event.Set(k, v)
		}
	}
	return jsobj.New("api_version", "1.0", "event", event)
}

func upper(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'a' && c <= 'z' {
			b[i] = c - 32
		}
	}
	return string(b)
}

// Prepared is an event ready to write: its ID, body and the endpoints that want it.
type Prepared struct {
	ID        string
	in        Input
	body      string
	endpoints []string
}

// Prepare builds an event's body (looking up its USD price) from the database as it is now. It
// returns nil when no endpoint wants the event. Lite builds event bodies before the batch that
// writes the change; Prepare is that step, and Write runs inside the transaction.
func Prepare(ctx context.Context, db ledger.DB, project *config.Project, in Input) (*Prepared, error) {
	endpoints := For(project, in.Type, in.Environment)
	if len(endpoints) == 0 {
		return nil, nil
	}
	id := ledger.NewUUID()
	var priceUSD *float64
	if t := in.Transaction; t != nil && t.PriceMicros != nil {
		sign := 1.0
		if in.NegativePrice {
			sign = -1
		}
		currency := ""
		if t.Currency != nil {
			currency = *t.Currency
		}
		var err error
		if priceUSD, err = fx.ToUSD(ctx, db, sign*float64(*t.PriceMicros)/1e6, currency, t.PurchasedAt); err != nil {
			return nil, err
		}
	}
	names := make([]string, len(endpoints))
	for i, e := range endpoints {
		names[i] = e.ID
	}
	return &Prepared{ID: id, in: in, body: jsobj.Stringify(Body(project, in, id, priceUSD)), endpoints: names}, nil
}

// Write records the event and one pending delivery per endpoint. If the dedupe key was already
// used, nothing is written.
func (p *Prepared) Write(ctx context.Context, tx ledger.DB) error {
	in := p.in
	if _, err := tx.Exec(ctx,
		`INSERT INTO webhook_event (id, dedupe_key, type, app_id, customer_id, environment, body, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (dedupe_key) DO NOTHING`,
		p.ID, in.DedupeKey, in.Type, in.AppID, in.Customer.ID, in.Environment, p.body, in.Now); err != nil {
		return err
	}
	// Inserted only if the event above was. The retry job doesn't pick a delivery up until the
	// first, immediate attempt has had time to run.
	_, err := tx.Exec(ctx,
		`INSERT INTO webhook_delivery (event_id, endpoint, status, next_attempt_at, created_at)
		 SELECT $1, e.endpoint, 'pending', $2, $3 FROM unnest($4::text[]) WITH ORDINALITY AS e(endpoint, n)
		 WHERE EXISTS (SELECT 1 FROM webhook_event WHERE id = $1) ORDER BY e.n`,
		p.ID, in.Now+RetryDelaysMs[0], in.Now, p.endpoints)
	return err
}

// LoadCustomer is the customer context for event bodies (loadEventCustomer): aliases (newest last)
// and attributes of customerIDs, as the customer `into`. lastAppUserID, when not "", is the app
// user ID that made the request.
func LoadCustomer(ctx context.Context, db ledger.DB, customerIDs []string, into, lastAppUserID string) (*Customer, error) {
	rows, err := db.Query(ctx,
		`SELECT app_user_id FROM customer_alias WHERE customer_id = ANY($1::text[]) ORDER BY created_at, app_user_id COLLATE "C"`,
		customerIDs)
	if err != nil {
		return nil, err
	}
	aliases, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}

	// Newest value per key wins, as when customers merge.
	attributes := jsobj.New()
	rows, err = db.Query(ctx,
		`SELECT key, value, updated_at FROM subscriber_attribute WHERE customer_id = ANY($1::text[]) AND value IS NOT NULL
		 ORDER BY updated_at, key COLLATE "C"`, customerIDs)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var key, value string
		var updated int64
		if err := rows.Scan(&key, &value, &updated); err != nil {
			rows.Close()
			return nil, err
		}
		attributes.Set(key, jsobj.New("value", value, "updated_at_ms", float64(updated)))
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	var original string
	err = db.QueryRow(ctx, "SELECT app_user_id FROM customer WHERE id = $1", into).Scan(&original)
	if err != nil && err != pgx.ErrNoRows {
		return nil, err
	}
	if err == pgx.ErrNoRows && len(aliases) > 0 {
		original = aliases[0]
	}

	rows, err = db.Query(ctx,
		`SELECT experiment_id, variant, enrolled_at FROM (
		   SELECT DISTINCT ON (e.experiment_id) e.experiment_id, e.variant, e.enrolled_at
		   FROM experiment_enrollment e JOIN experiment x ON x.id = e.experiment_id
		   WHERE e.app_user_id IN (SELECT app_user_id FROM customer_alias WHERE customer_id = ANY($1::text[]))
		     AND x.project_id = (SELECT project_id FROM customer WHERE id = $2)
		   ORDER BY e.experiment_id, e.enrolled_at) s
		 ORDER BY enrolled_at, experiment_id COLLATE "C"`, customerIDs, into)
	if err != nil {
		return nil, err
	}
	var experiments []any
	for rows.Next() {
		var expID, variant string
		var enrolled int64
		if err := rows.Scan(&expID, &variant, &enrolled); err != nil {
			rows.Close()
			return nil, err
		}
		experiments = append(experiments, jsobj.New("experiment_id", expID, "experiment_variant", variant, "enrolled_at_ms", float64(enrolled)))
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	appUserID := lastAppUserID
	if appUserID == "" {
		if len(aliases) > 0 {
			appUserID = aliases[len(aliases)-1]
		} else {
			appUserID = original
		}
	}
	return &Customer{
		ID:                into,
		AppUserID:         appUserID,
		OriginalAppUserID: original,
		Aliases:           aliases,
		Attributes:        attributes,
		Experiments:       experiments,
	}, nil
}
