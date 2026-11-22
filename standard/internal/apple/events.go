package apple

// Maps App Store facts to RevenueCat webhook events, following RevenueCat's documented event flows
// (lite/src/stores/apple-events.ts). Dedupe keys make each fact produce one event, whichever source
// reports it first: purchase events are keyed by transaction (shared with POST /v1/receipts), and
// expirations by subscription period.

import (
	"regexp"
	"strconv"

	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
)

// PlannedEvent is an event to enqueue.
type PlannedEvent struct {
	Type      string
	DedupeKey string
	// Event-specific fields (cancel_reason, expiration_reason...); nil for none.
	Extra         *jsobj.Object
	NegativePrice bool
}

// PurchaseKey is the one purchase event per transaction, shared by receipts and notifications.
func PurchaseKey(t *ledger.Transaction) string { return "purchase:" + t.Store + ":" + t.TransactionID }

func expirationKey(t *ledger.Transaction) string {
	period := t.TransactionID
	if t.ExpiresAt != nil {
		period = strconv.FormatInt(*t.ExpiresAt, 10)
	}
	return "expiration:" + t.Store + ":" + t.OriginalTransactionID + ":" + period
}

var expirationReason = map[string]string{
	"VOLUNTARY":            "UNSUBSCRIBE",
	"BILLING_RETRY":        "BILLING_ERROR",
	"PRICE_INCREASE":       "PRICE_INCREASE",
	"PRODUCT_NOT_FOR_SALE": "UNKNOWN",
}

// Notification is the part of a responseBodyV2DecodedPayload the events depend on.
type Notification struct {
	Type    string
	Subtype string
	UUID    string
}

// NotificationEvents plans the events for a notification about transaction tx (nil: none).
// previousPeriodType is the chain's previous transaction's period type, for renewals.
func NotificationEvents(n Notification, tx *ledger.Transaction, renewal any, previousPeriodType string) []PlannedEvent {
	if tx == nil {
		return nil
	}
	per := func(typ string, extra *jsobj.Object) PlannedEvent {
		return PlannedEvent{Type: typ, DedupeKey: "notification:app_store:" + n.UUID + ":" + typ, Extra: extra}
	}
	renewalExtra := func() *jsobj.Object {
		if n.Type != "DID_RENEW" && n.Subtype != "RESUBSCRIBE" {
			return nil
		}
		return jsobj.New("is_trial_conversion", previousPeriodType == "trial")
	}
	expiration := func(reason string) PlannedEvent {
		return PlannedEvent{Type: "EXPIRATION", DedupeKey: expirationKey(tx), Extra: jsobj.New("expiration_reason", reason)}
	}

	switch n.Type {
	case "SUBSCRIBED":
		// A resubscription continues the same chain, which RevenueCat reports as a renewal.
		typ := "INITIAL_PURCHASE"
		if n.Subtype == "RESUBSCRIBE" {
			typ = "RENEWAL"
		}
		return []PlannedEvent{{Type: typ, DedupeKey: PurchaseKey(tx), Extra: renewalExtra()}}
	case "DID_RENEW":
		return []PlannedEvent{{Type: "RENEWAL", DedupeKey: PurchaseKey(tx), Extra: renewalExtra()}}
	case "ONE_TIME_CHARGE":
		return []PlannedEvent{{Type: "NON_RENEWING_PURCHASE", DedupeKey: PurchaseKey(tx)}}
	case "DID_CHANGE_RENEWAL_STATUS":
		switch n.Subtype {
		case "AUTO_RENEW_DISABLED":
			return []PlannedEvent{per("CANCELLATION", jsobj.New("cancel_reason", "UNSUBSCRIBE"))}
		case "AUTO_RENEW_ENABLED":
			return []PlannedEvent{per("UNCANCELLATION", nil)}
		}
		return nil
	case "DID_FAIL_TO_RENEW":
		// RevenueCat sends these together, in this order. Without a grace period, access ends now.
		var grace any
		if v, ok := present(renewal, "gracePeriodExpiresDate"); ok {
			grace = v
		}
		events := []PlannedEvent{
			per("BILLING_ISSUE", jsobj.New("grace_period_expiration_at_ms", grace)),
			per("CANCELLATION", jsobj.New("cancel_reason", "BILLING_ERROR")),
		}
		if n.Subtype != "GRACE_PERIOD" {
			events = append(events, expiration("BILLING_ERROR"))
		}
		return events
	case "GRACE_PERIOD_EXPIRED":
		return []PlannedEvent{expiration("BILLING_ERROR")}
	case "EXPIRED":
		reason, ok := expirationReason[n.Subtype]
		if !ok {
			reason = "UNKNOWN"
		}
		return []PlannedEvent{expiration(reason)}
	case "DID_CHANGE_RENEWAL_PREF":
		if n.Subtype == "UPGRADE" || n.Subtype == "DOWNGRADE" {
			var next any
			if v, ok := present(renewal, "autoRenewProductId"); ok {
				next = v
			}
			return []PlannedEvent{per("PRODUCT_CHANGE", jsobj.New("new_product_id", next))}
		}
		return nil
	case "REFUND":
		return []PlannedEvent{{Type: "CANCELLATION", DedupeKey: "refund:app_store:" + tx.TransactionID, Extra: jsobj.New("cancel_reason", "CUSTOMER_SUPPORT"), NegativePrice: true}}
	case "REVOKE":
		// Family Sharing access ended.
		return []PlannedEvent{{Type: "CANCELLATION", DedupeKey: "revoke:app_store:" + tx.TransactionID, Extra: jsobj.New("cancel_reason", "UNKNOWN")}}
	case "REFUND_REVERSED":
		return []PlannedEvent{per("REFUND_REVERSED", nil)}
	case "RENEWAL_EXTENDED":
		return []PlannedEvent{per("SUBSCRIPTION_EXTENDED", nil)}
	case "PRICE_INCREASE":
		switch n.Subtype {
		case "PENDING":
			return []PlannedEvent{per("PRICE_INCREASE_CONSENT_REQUIRED", nil)}
		case "ACCEPTED":
			return []PlannedEvent{per("PRICE_INCREASE_CONSENT_APPROVED", nil)}
		}
	}
	return nil
}

// RecentPurchaseMs: only purchases this recent produce events from POST /v1/receipts.
const RecentPurchaseMs = 72 * 3600_000

var playRenewalSuffix = regexp.MustCompile(`\.\.\d+$`)

// ReceiptPurchaseEvents plans the purchase event for a transaction written by POST /v1/receipts.
// Only recent purchases count: restoring an old purchase (or importing history) shouldn't announce
// it as new. "Recent" is generous because a purchase can sit queued on an offline device before
// it's posted.
func ReceiptPurchaseEvents(t *ledger.Transaction, now int64) []PlannedEvent {
	if t.RevokedAt != nil || t.PurchasedAt < now-RecentPurchaseMs {
		return nil
	}
	if t.ProductType != "subscription" {
		return []PlannedEvent{{Type: "NON_RENEWING_PURCHASE", DedupeKey: PurchaseKey(t)}}
	}
	// A subscription's first period: on Apple the transaction is its own original; on Google the
	// order ID has no renewal suffix ("GPA.1234-5678-9012-34567", renewals end "..0", "..1"...).
	first := t.TransactionID == t.OriginalTransactionID
	if t.Store == "play_store" {
		first = !playRenewalSuffix.MatchString(t.TransactionID)
	}
	typ := "RENEWAL"
	if first {
		typ = "INITIAL_PURCHASE"
	}
	return []PlannedEvent{{Type: typ, DedupeKey: PurchaseKey(t)}}
}
