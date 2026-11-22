package google

// Maps Google Play Real-time Developer Notifications to RevenueCat webhook events
// (lite/src/stores/google-events.ts), following RevenueCat's documented Google flows:
//   - a billing failure sends BILLING_ISSUE + CANCELLATION (BILLING_ERROR); account hold also
//     expires access (EXPIRATION, BILLING_ERROR). Grace then hold reports the billing issue once.
//   - a scheduled pause is SUBSCRIPTION_PAUSED; the pause taking effect is EXPIRATION with
//     expiration_reason SUBSCRIPTION_PAUSED.
//   - an immediate plan change is PRODUCT_CHANGE plus INITIAL_PURCHASE (a new purchase token).
// Dedupe keys: purchase events per order (shared with POST /v1/receipts), billing issues and
// expirations per order (one subscription period).

import (
	"github.com/openpurr/openpurr/standard/internal/apple"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
)

// Google's SubscriptionNotification types (RTDN reference).
const (
	SubRecovered            = 1
	SubRenewed              = 2
	SubCanceled             = 3
	SubPurchased            = 4
	SubOnHold               = 5
	SubInGracePeriod        = 6
	SubRestarted            = 7
	SubDeferred             = 9
	SubPaused               = 10
	SubPauseScheduleChanged = 11
	SubRevoked              = 12
	SubExpired              = 13
)

func periodKey(kind string, t *ledger.Transaction) string {
	return kind + ":play_store:" + t.OriginalTransactionID + ":" + t.TransactionID
}

// cancelReason is why a subscription was canceled, as RevenueCat's cancel_reason /
// expiration_reason ("" for none).
func cancelReason(sub any) string {
	c, _ := jsobj.Prop(sub, "canceledStateContext")
	if !truthy(c) {
		return ""
	}
	for _, r := range [][2]string{
		{"userInitiatedCancellation", "UNSUBSCRIBE"},
		{"systemInitiatedCancellation", "BILLING_ERROR"},
		{"developerInitiatedCancellation", "DEVELOPER_INITIATED"},
		{"replacementCancellation", "REPLACED"},
	} {
		if v, _ := jsobj.Prop(c, r[0]); truthy(v) {
			return r[1]
		}
	}
	return ""
}

// EventOptions are what SubscriptionEvents needs from the ledger.
type EventOptions struct {
	// The chain's previous transaction's period type ("" for none), for renewals.
	PreviousPeriodType string
	// "product:base_plan" of the subscription a new purchase token replaces ("" for none).
	ReplacedProductID string
}

// SubscriptionEvents plans the events for a subscription notification of type typ about tx
// (googleSubscriptionEvents). typ is the notification's notificationType as sent.
func SubscriptionEvents(typ any, notificationID string, sub any, tx *ledger.Transaction, opts EventOptions) []apple.PlannedEvent {
	per := func(eventType string, extra *jsobj.Object) apple.PlannedEvent {
		return apple.PlannedEvent{Type: eventType, DedupeKey: "notification:play_store:" + notificationID + ":" + eventType, Extra: extra}
	}
	billing := func(grace any) []apple.PlannedEvent {
		return []apple.PlannedEvent{
			{Type: "BILLING_ISSUE", DedupeKey: periodKey("billing-issue", tx), Extra: jsobj.New("grace_period_expiration_at_ms", grace)},
			{Type: "CANCELLATION", DedupeKey: periodKey("billing-cancel", tx), Extra: jsobj.New("cancel_reason", "BILLING_ERROR")},
		}
	}
	expiration := func(reason string) apple.PlannedEvent {
		return apple.PlannedEvent{Type: "EXPIRATION", DedupeKey: periodKey("expiration", tx), Extra: jsobj.New("expiration_reason", reason)}
	}
	n, isNum := typ.(float64)
	if !isNum {
		return nil
	}
	plan := "null"
	if tx.BasePlanID != nil {
		plan = *tx.BasePlanID
	}
	switch n {
	case SubPurchased:
		var events []apple.PlannedEvent
		if opts.ReplacedProductID != "" && opts.ReplacedProductID != tx.ProductID+":"+plan {
			newProduct := tx.ProductID
			if tx.BasePlanID != nil && *tx.BasePlanID != "" {
				newProduct = tx.ProductID + ":" + *tx.BasePlanID
			}
			events = append(events, per("PRODUCT_CHANGE", jsobj.New("new_product_id", newProduct)))
		}
		return append(events, apple.PlannedEvent{Type: "INITIAL_PURCHASE", DedupeKey: apple.PurchaseKey(tx)})
	case SubRenewed, SubRecovered:
		return []apple.PlannedEvent{{Type: "RENEWAL", DedupeKey: apple.PurchaseKey(tx), Extra: jsobj.New("is_trial_conversion", opts.PreviousPeriodType == "trial")}}
	case SubRestarted:
		return []apple.PlannedEvent{per("UNCANCELLATION", nil)}
	case SubCanceled:
		switch reason := cancelReason(sub); reason {
		case "", "REPLACED":
			return nil // a plan change is reported on the new purchase
		case "BILLING_ERROR":
			return billing(nil)[1:]
		default:
			return []apple.PlannedEvent{per("CANCELLATION", jsobj.New("cancel_reason", reason))}
		}
	case SubInGracePeriod:
		var grace any
		if tx.ExpiresAt != nil {
			grace = float64(*tx.ExpiresAt)
		}
		return billing(grace)
	case SubOnHold:
		return append(billing(nil), expiration("BILLING_ERROR"))
	case SubExpired:
		reason := cancelReason(sub)
		if reason == "REPLACED" {
			return nil
		}
		if reason == "" {
			reason = "UNKNOWN"
		}
		return []apple.PlannedEvent{expiration(reason)}
	case SubPauseScheduleChanged:
		var resume any
		if v, _ := path(sub, "pausedStateContext", "autoResumeTime"); truthy(v) {
			if at, err := ms(v); err == nil && at != nil {
				resume = float64(*at)
			} else {
				resume = nil
			}
		}
		return []apple.PlannedEvent{per("SUBSCRIPTION_PAUSED", jsobj.New("auto_resume_at_ms", resume))}
	case SubPaused:
		return []apple.PlannedEvent{expiration("SUBSCRIPTION_PAUSED")}
	case SubDeferred:
		return []apple.PlannedEvent{per("SUBSCRIPTION_EXTENDED", nil)}
	case SubRevoked:
		return []apple.PlannedEvent{RefundEvent(tx)}
	}
	return nil
}

// RefundEvent is the event for a refunded or voided order (a voidedPurchaseNotification, a
// one-time purchase canceled, voided-purchases polling or a revoked subscription).
func RefundEvent(tx *ledger.Transaction) apple.PlannedEvent {
	return apple.PlannedEvent{
		Type:          "CANCELLATION",
		DedupeKey:     "refund:play_store:" + tx.TransactionID,
		Extra:         jsobj.New("cancel_reason", "CUSTOMER_SUPPORT"),
		NegativePrice: true,
	}
}

// OneTimePurchaseEvent is the event for a one-time purchase.
func OneTimePurchaseEvent(tx *ledger.Transaction) apple.PlannedEvent {
	return apple.PlannedEvent{Type: "NON_RENEWING_PURCHASE", DedupeKey: apple.PurchaseKey(tx)}
}
