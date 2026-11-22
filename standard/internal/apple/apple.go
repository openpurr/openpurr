// Package apple is the App Store side of the ledger: turning verified App Store payloads into
// ledger rows and subscription status, the App Store Server API client, syncing from it, and the
// webhook events App Store facts produce. A port of lite/src/stores/apple*.ts.
//
// Payloads are read as parsed JSON with JavaScript semantics (jsobj), the way Lite reads them, so
// the same field quirks (`??`, String(), truthiness) give the same rows.
package apple

import (
	"math"

	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
)

// Apple's subscription status codes, which the ledger uses for both stores. Paused (Google Play
// only) is ours.
const (
	StatusActive       = 1
	StatusExpired      = 2
	StatusBillingRetry = 3
	StatusGracePeriod  = 4
	StatusRevoked      = 5
	StatusPaused       = 6
)

var appleType = map[config.ProductType]string{
	config.Subscription:  "Auto-Renewable Subscription",
	config.NonConsumable: "Non-Consumable",
	config.Consumable:    "Consumable",
}

// MappingError is a transaction that doesn't match the config (bundle, product type, missing IDs).
type MappingError struct{ Msg string }

func (e *MappingError) Error() string { return e.Msg }

// get is `o.k`: the value and whether it's defined.
func get(o any, k string) (any, bool) { return jsobj.Prop(o, k) }

// present is `o.k !== undefined && o.k !== null`.
func present(o any, k string) (any, bool) {
	v, ok := get(o, k)
	return v, ok && v != nil
}

// Str is String(o.k) for a defined field, as used for IDs.
func Str(o any, k string) string {
	v, ok := get(o, k)
	return jsobj.String(v, ok)
}

// optStr is `o.k ?? null` for a text column (a non-string is stored as its text, as D1 does).
func optStr(o any, k string) *string {
	v, ok := present(o, k)
	if !ok {
		return nil
	}
	s := jsobj.String(v, true)
	return &s
}

// Num is a numeric field, when it's a number.
func Num(o any, k string) (float64, bool) {
	v, ok := present(o, k)
	if !ok {
		return 0, false
	}
	f, isNum := v.(float64)
	return f, isNum && !math.IsNaN(f) && !math.IsInf(f, 0)
}

func optMs(o any, k string) *int64 {
	f, ok := Num(o, k)
	if !ok {
		return nil
	}
	ms := int64(f)
	return &ms
}

func optInt(o any, k string) *int {
	f, ok := Num(o, k)
	if !ok {
		return nil
	}
	n := int(f)
	return &n
}

// Truthy is JavaScript truthiness.
func Truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case float64:
		return x != 0 && !math.IsNaN(x)
	case string:
		return x != ""
	}
	return true
}

// TransactionRow turns a verified JWSTransactionDecodedPayload into a ledger row
// (appleTransactionRow).
func TransactionRow(tx any, app *config.App, product *config.Product) (ledger.NewTransaction, error) {
	bundle, hasBundle := get(tx, "bundleId")
	if bundle != app.BundleID {
		return ledger.NewTransaction{}, &MappingError{"transaction is for bundle " + jsobj.String(bundle, hasBundle) + ", but app " + app.ID + " is " + app.BundleID}
	}
	if t, _ := get(tx, "type"); t != appleType[product.Type] {
		return ledger.NewTransaction{}, &MappingError{`Apple says ` + Str(tx, "productId") + ` is "` + Str(tx, "type") + `", but the config says ` + string(product.Type)}
	}
	for _, field := range []string{"transactionId", "originalTransactionId", "purchaseDate"} {
		if _, ok := present(tx, field); !ok {
			return ledger.NewTransaction{}, &MappingError{"transaction has no " + field}
		}
	}
	purchased, ok := Num(tx, "purchaseDate")
	if !ok {
		return ledger.NewTransaction{}, &MappingError{"transaction has no purchaseDate"}
	}

	row := ledger.NewTransaction{Source: "sdk"}
	t := &row.Transaction
	t.AppID = app.ID
	t.Store = string(config.AppStore)
	t.Environment = "sandbox"
	if env, _ := get(tx, "environment"); env == "Production" {
		t.Environment = "production"
	}
	t.TransactionID = Str(tx, "transactionId")
	t.OriginalTransactionID = Str(tx, "originalTransactionId")
	t.ProductID = Str(tx, "productId")
	t.ProductType = string(product.Type)
	t.PurchasedAt = int64(purchased)
	t.OriginalPurchasedAt = t.PurchasedAt
	if orig := optMs(tx, "originalPurchaseDate"); orig != nil {
		t.OriginalPurchasedAt = *orig
	}
	if product.Type == config.Subscription {
		t.ExpiresAt = optMs(tx, "expiresDate")
	}
	t.PeriodType = periodType(tx)
	t.OwnershipType = "PURCHASED"
	if o, _ := get(tx, "inAppOwnershipType"); o == "FAMILY_SHARED" {
		t.OwnershipType = "FAMILY_SHARED"
	}
	if p, isNum := get(tx, "price"); isNum {
		if f, ok := p.(float64); ok {
			micros := int64(math.Round(f * 1000))
			t.PriceMicros = &micros
		}
	}
	t.Currency = optStr(tx, "currency")
	t.Storefront = optStr(tx, "storefront")
	t.RevokedAt = optMs(tx, "revocationDate")
	if r, ok := present(tx, "revocationReason"); ok { // absent or JSON null: NULL
		s := jsobj.String(r, true)
		t.RevocationReason = &s
	}
	if v, _ := get(tx, "isUpgraded"); Truthy(v) {
		t.IsUpgraded = 1
	}
	t.Verified = 1
	t.SubscriptionGroup = optStr(tx, "subscriptionGroupIdentifier")
	return row, nil
}

// periodType: RevenueCat's CustomerInfo only has normal, trial and intro. Free offers of any kind
// (introductory, promotional, offer code, win-back) map to trial and paid ones to intro.
func periodType(tx any) string {
	if v, _ := get(tx, "offerType"); !Truthy(v) {
		return "normal"
	}
	if d, _ := get(tx, "offerDiscountType"); d == "FREE_TRIAL" {
		return "trial"
	}
	return "intro"
}

// SubscriptionState turns renewal info into subscription status (appleSubscriptionState). status
// comes from the notification when it has one; otherwise it's inferred from the renewal info's
// billing-retry and grace-period fields. It fails only when the renewal info has no signedDate,
// which Lite can't store either.
func SubscriptionState(renewal any, status *int) (ledger.StateUpdate, error) {
	signed, ok := Num(renewal, "signedDate")
	if !ok {
		return ledger.StateUpdate{}, &MappingError{"renewal info has no signedDate"}
	}
	grace, hasGrace := Num(renewal, "gracePeriodExpiresDate")
	inGrace := hasGrace && grace > signed
	resolved := status
	if resolved == nil {
		retry, _ := get(renewal, "isInBillingRetryPeriod")
		switch {
		case inGrace:
			resolved = intPtr(StatusGracePeriod)
		case Truthy(retry):
			resolved = intPtr(StatusBillingRetry)
		}
	}
	out := ledger.StateUpdate{
		Store:                 string(config.AppStore),
		OriginalTransactionID: Str(renewal, "originalTransactionId"),
		Status:                resolved,
		AutoRenewProductID:    optStr(renewal, "autoRenewProductId"),
		ExpirationIntent:      optInt(renewal, "expirationIntent"),
		SignedAt:              int64(signed),
	}
	out.BillingIssue = resolved != nil && (*resolved == StatusBillingRetry || *resolved == StatusGracePeriod)
	if v, defined := get(renewal, "autoRenewStatus"); defined {
		on := 0
		if v == 1.0 {
			on = 1
		}
		out.AutoRenew = &on
	}
	if resolved != nil && *resolved == StatusGracePeriod {
		out.GracePeriodExpiresAt = optMs(renewal, "gracePeriodExpiresDate")
	}
	return out, nil
}

func intPtr(n int) *int { return &n }
