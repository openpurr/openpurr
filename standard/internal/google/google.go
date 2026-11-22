package google

// Turns Play Developer API answers into ledger rows and subscription status
// (lite/src/stores/google.ts).
//
// Identity: the purchase token identifies a subscription chain (original_transaction_id); each
// order (the first purchase and every renewal, "GPA.1234-...", renewals suffixed "..1", "..2") is
// a transaction (transaction_id). An upgrade, downgrade or re-signup creates a NEW purchase token
// whose linkedPurchaseToken points at the old one.

import (
	"regexp"
	"time"

	"github.com/openpurr/openpurr/standard/internal/apple"
	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
)

// MappingError is an answer that doesn't match the config (product type, missing line item) or
// can't be stored.
type MappingError struct{ Msg string }

func (e *MappingError) Error() string { return e.Msg }

// ms is `iso ? Date.parse(iso) : null`. Google sends RFC 3339 times; anything else is a
// MappingError (Lite would store NaN).
func ms(v any) (*int64, error) {
	if !truthy(v) {
		return nil, nil
	}
	s, ok := v.(string)
	if ok {
		if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
			m := t.UnixMilli()
			return &m, nil
		}
	}
	return nil, &MappingError{"Google returned a time that isn't RFC 3339: " + jsobj.String(v, true)}
}

// status maps Google's subscription state to the ledger's status codes (Apple's, plus paused).
var status = map[string]*int{
	"SUBSCRIPTION_STATE_ACTIVE": intPtr(apple.StatusActive),
	// Canceled = auto-renew off; access continues until expiry.
	"SUBSCRIPTION_STATE_CANCELED":                  intPtr(apple.StatusActive),
	"SUBSCRIPTION_STATE_IN_GRACE_PERIOD":           intPtr(apple.StatusGracePeriod),
	"SUBSCRIPTION_STATE_ON_HOLD":                   intPtr(apple.StatusBillingRetry),
	"SUBSCRIPTION_STATE_PAUSED":                    intPtr(apple.StatusPaused),
	"SUBSCRIPTION_STATE_EXPIRED":                   intPtr(apple.StatusExpired),
	"SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED": intPtr(apple.StatusExpired),
	"SUBSCRIPTION_STATE_PENDING":                   nil,
}

func intPtr(n int) *int { return &n }

// IsPending is true for states that never granted access: the purchase is still pending.
func IsPending(sub any) bool {
	s, _ := jsobj.Prop(sub, "subscriptionState")
	return s == "SUBSCRIPTION_STATE_PENDING" || s == "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED"
}

// lineItems is `sub.lineItems` as a list.
func lineItems(sub any) []any {
	v, _ := jsobj.Prop(sub, "lineItems")
	list, _ := v.([]any)
	return list
}

// lineItemFor is `sub.lineItems?.find((li) => li.productId === productID)`.
func lineItemFor(sub any, productID string) any {
	for _, li := range lineItems(sub) {
		if p, _ := jsobj.Prop(li, "productId"); p == productID {
			return li
		}
	}
	return nil
}

// path reads o.a?.b?.c (undefined: false).
func path(o any, keys ...string) (any, bool) {
	v, ok := o, true
	for _, k := range keys {
		v, ok = jsobj.Prop(v, k)
	}
	return v, ok
}

// optString is `v ?? null` for a text column.
func optString(v any, defined bool) *string {
	if !defined || v == nil {
		return nil
	}
	s := jsobj.String(v, true)
	return &s
}

// paidPrice is the price an order says was paid for a product (its line item, else the total).
func paidPrice(order any, productID string) *Money {
	var lineTotal any
	lines, _ := jsobj.Prop(order, "lineItems")
	list, _ := lines.([]any)
	for _, l := range list {
		if p, _ := jsobj.Prop(l, "productId"); p == productID {
			lineTotal, _ = jsobj.Prop(l, "total")
			break
		}
	}
	if lineTotal == nil {
		lineTotal, _ = jsobj.Prop(order, "total")
	}
	return MoneyMicros(lineTotal)
}

var renewalOrder = regexp.MustCompile(`\.\.\d+$`)

// SubscriptionRow is the ledger row for a subscription's current order (googleSubscriptionRow).
// order (from the Orders API, or nil) supplies the price actually paid when available; otherwise
// the plan's recurring price is used for a normal period, 0 for a free trial, and null for an
// introductory price.
func SubscriptionRow(sub any, purchaseToken string, app *config.App, product *config.Product, now int64, order any) (ledger.NewTransaction, error) {
	item := lineItemFor(sub, product.ID)
	if item == nil {
		return ledger.NewTransaction{}, &MappingError{"Google's answer has no line item for " + product.ID}
	}
	if product.Type != config.Subscription {
		return ledger.NewTransaction{}, &MappingError{product.ID + " is a subscription in Google Play, but the config says " + string(product.Type)}
	}
	startTime, _ := jsobj.Prop(sub, "startTime")
	startMs, err := ms(startTime)
	if err != nil {
		return ledger.NewTransaction{}, err
	}
	start := now
	if startMs != nil {
		start = *startMs
	}
	orderV, hasOrder := jsobj.Prop(item, "latestSuccessfulOrderId")
	// Renewal orders end in "..N"; their period started recently, not at startTime.
	isRenewal := truthy(orderV) && renewalOrder.MatchString(jsobj.String(orderV, true))
	periodType := "normal"
	if v, _ := path(item, "offerPhase", "freeTrial"); truthy(v) {
		periodType = "trial"
	} else if v, _ := path(item, "offerPhase", "introductoryPrice"); truthy(v) {
		periodType = "intro"
	}

	price := paidPrice(order, product.ID)
	if price == nil {
		recurringV, _ := path(item, "autoRenewingPlan", "recurringPrice")
		recurring := MoneyMicros(recurringV)
		switch {
		case periodType == "trial" && recurring != nil:
			price = &Money{Micros: 0, Currency: recurring.Currency}
		case periodType == "normal":
			price = recurring
		}
	}
	expiryV, hasExpiry := jsobj.Prop(item, "expiryTime")
	expires, err := ms(expiryV)
	if err != nil {
		return ledger.NewTransaction{}, err
	}

	row := ledger.NewTransaction{Source: "sdk"}
	t := &row.Transaction
	t.AppID = app.ID
	t.Store = string(config.PlayStore)
	t.Environment = "production"
	if v, _ := jsobj.Prop(sub, "testPurchase"); truthy(v) {
		t.Environment = "sandbox"
	}
	if hasOrder && orderV != nil {
		t.TransactionID = jsobj.String(orderV, true)
	} else {
		// `${purchaseToken}:${item.expiryTime ?? start}`
		suffix := jsobj.FormatNumber(float64(start))
		if hasExpiry && expiryV != nil {
			suffix = jsobj.String(expiryV, true)
		}
		t.TransactionID = purchaseToken + ":" + suffix
	}
	t.OriginalTransactionID = purchaseToken
	t.ProductID = product.ID
	t.BasePlanID = optString(path(item, "offerDetails", "basePlanId"))
	t.ProductType = string(config.Subscription)
	t.PurchasedAt = start
	if isRenewal {
		t.PurchasedAt = now
	}
	t.OriginalPurchasedAt = start
	t.ExpiresAt = expires
	t.PeriodType = periodType
	t.OwnershipType = "PURCHASED"
	if price != nil {
		micros, currency := price.Micros, price.Currency
		t.PriceMicros, t.Currency = &micros, &currency
	}
	t.Storefront = optString(jsobj.Prop(sub, "regionCode"))
	t.Verified = 1
	return row, nil
}

// SubscriptionState is a subscription's status from Google's answer (googleSubscriptionState).
// signedAt orders updates (the event time).
func SubscriptionState(sub any, purchaseToken string, signedAt int64) (ledger.StateUpdate, error) {
	var st *int
	if s, ok := jsobj.Prop(sub, "subscriptionState"); ok && s != nil {
		if name, isStr := s.(string); isStr {
			st = status[name]
		}
	}
	var item any
	if items := lineItems(sub); len(items) > 0 {
		item = items[0]
	}
	out := ledger.StateUpdate{
		Store:                 string(config.PlayStore),
		OriginalTransactionID: purchaseToken,
		Status:                st,
		BillingIssue:          st != nil && (*st == apple.StatusGracePeriod || *st == apple.StatusBillingRetry),
		SignedAt:              signedAt,
	}
	if plan, _ := jsobj.Prop(item, "autoRenewingPlan"); truthy(plan) {
		on := 0
		if v, _ := jsobj.Prop(plan, "autoRenewEnabled"); truthy(v) {
			on = 1
		}
		out.AutoRenew = &on
	}
	var err error
	if st != nil && *st == apple.StatusGracePeriod {
		// In grace, Google extends expiryTime to the end of the grace period.
		v, _ := jsobj.Prop(item, "expiryTime")
		if out.GracePeriodExpiresAt, err = ms(v); err != nil {
			return out, err
		}
	}
	if st != nil && *st == apple.StatusPaused {
		v, _ := path(sub, "pausedStateContext", "autoResumeTime")
		if out.AutoResumeAt, err = ms(v); err != nil {
			return out, err
		}
	}
	return out, nil
}

// ProductRow is the ledger row for a one-time product (googleProductRow); nil while the purchase
// is pending.
func ProductRow(p any, purchaseToken string, app *config.App, product *config.Product, now int64, order any) (*ledger.NewTransaction, error) {
	if product.Type == config.Subscription {
		return nil, &MappingError{product.ID + " is a one-time product in Google Play, but the config says subscription"}
	}
	state, _ := jsobj.Prop(p, "purchaseState")
	if state == 2.0 {
		return nil, nil // pending: not paid yet
	}
	purchased := float64(now)
	if v, ok := jsobj.Prop(p, "purchaseTimeMillis"); ok && v != nil {
		purchased = toNumber(v, true)
	}
	if purchased != purchased {
		return nil, &MappingError{"Google returned a purchase time that isn't a number"}
	}
	row := ledger.NewTransaction{Source: "sdk"}
	t := &row.Transaction
	t.AppID = app.ID
	t.Store = string(config.PlayStore)
	t.Environment = "production"
	if v, _ := jsobj.Prop(p, "purchaseType"); v == 0.0 {
		t.Environment = "sandbox"
	}
	t.TransactionID = purchaseToken
	if v, ok := jsobj.Prop(p, "orderId"); ok && v != nil {
		t.TransactionID = jsobj.String(v, true)
	}
	t.OriginalTransactionID = purchaseToken
	t.ProductID = product.ID
	t.ProductType = string(product.Type)
	t.PurchasedAt = int64(purchased)
	t.OriginalPurchasedAt = t.PurchasedAt
	t.PeriodType = "normal"
	t.OwnershipType = "PURCHASED"
	if price := paidPrice(order, product.ID); price != nil {
		micros, currency := price.Micros, price.Currency
		t.PriceMicros, t.Currency = &micros, &currency
	}
	t.Storefront = optString(jsobj.Prop(p, "regionCode"))
	// purchaseState 1 = canceled (refunded or revoked).
	if state == 1.0 {
		at, reason := now, "canceled"
		t.RevokedAt, t.RevocationReason = &at, &reason
	}
	t.Verified = 1
	return &row, nil
}
