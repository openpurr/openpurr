// Maps Google Play Real-time Developer Notifications to RevenueCat webhook events, following
// RevenueCat's documented Google flows:
//   - a billing failure sends BILLING_ISSUE + CANCELLATION (BILLING_ERROR); account hold also
//     expires access (EXPIRATION, BILLING_ERROR). Grace then hold reports the billing issue once.
//   - a scheduled pause is SUBSCRIPTION_PAUSED; the pause taking effect is EXPIRATION with
//     expiration_reason SUBSCRIPTION_PAUSED.
//   - an immediate plan change is PRODUCT_CHANGE plus INITIAL_PURCHASE (a new purchase token).
// Dedupe keys: purchase events per order (shared with POST /v1/receipts), billing issues and
// expirations per order (one subscription period).

import type { TransactionRow } from "../ledger";
import type { PlannedEvent } from "./apple-events";
import type { SubscriptionPurchaseV2 } from "./google-api";

/** Google's SubscriptionNotification types (RTDN reference). */
export const PLAY_SUB = {
  RECOVERED: 1,
  RENEWED: 2,
  CANCELED: 3,
  PURCHASED: 4,
  ON_HOLD: 5,
  IN_GRACE_PERIOD: 6,
  RESTARTED: 7,
  DEFERRED: 9,
  PAUSED: 10,
  PAUSE_SCHEDULE_CHANGED: 11,
  REVOKED: 12,
  EXPIRED: 13,
} as const;

const purchaseKey = (t: TransactionRow) => `purchase:play_store:${t.transaction_id}`;
const periodKey = (kind: string, t: TransactionRow) => `${kind}:play_store:${t.original_transaction_id}:${t.transaction_id}`;

/** Why a subscription was canceled, as RevenueCat's cancel_reason / expiration_reason. */
function cancelReason(sub: SubscriptionPurchaseV2): string | null {
  const c = sub.canceledStateContext;
  if (!c) return null;
  if (c.userInitiatedCancellation) return "UNSUBSCRIBE";
  if (c.systemInitiatedCancellation) return "BILLING_ERROR";
  if (c.developerInitiatedCancellation) return "DEVELOPER_INITIATED";
  if (c.replacementCancellation) return "REPLACED";
  return null;
}

export function googleSubscriptionEvents(
  type: number,
  notificationId: string,
  sub: SubscriptionPurchaseV2,
  tx: TransactionRow,
  opts: { previousPeriodType?: string | null; replacedProductId?: string | null } = {},
): PlannedEvent[] {
  const per = (eventType: PlannedEvent["type"], extra?: Record<string, unknown>): PlannedEvent => ({
    type: eventType,
    dedupeKey: `notification:play_store:${notificationId}:${eventType}`,
    ...(extra ? { extra } : {}),
  });
  const billing = (grace: number | null): PlannedEvent[] => [
    { type: "BILLING_ISSUE", dedupeKey: periodKey("billing-issue", tx), extra: { grace_period_expiration_at_ms: grace } },
    { type: "CANCELLATION", dedupeKey: periodKey("billing-cancel", tx), extra: { cancel_reason: "BILLING_ERROR" } },
  ];
  const expiration = (reason: string): PlannedEvent => ({ type: "EXPIRATION", dedupeKey: periodKey("expiration", tx), extra: { expiration_reason: reason } });

  switch (type) {
    case PLAY_SUB.PURCHASED: {
      const events: PlannedEvent[] = [];
      if (opts.replacedProductId && opts.replacedProductId !== `${tx.product_id}:${tx.base_plan_id}`) {
        events.push(per("PRODUCT_CHANGE", { new_product_id: tx.base_plan_id ? `${tx.product_id}:${tx.base_plan_id}` : tx.product_id }));
      }
      events.push({ type: "INITIAL_PURCHASE", dedupeKey: purchaseKey(tx) });
      return events;
    }
    case PLAY_SUB.RENEWED:
    case PLAY_SUB.RECOVERED:
      return [{ type: "RENEWAL", dedupeKey: purchaseKey(tx), extra: { is_trial_conversion: opts.previousPeriodType === "trial" } }];
    case PLAY_SUB.RESTARTED:
      return [per("UNCANCELLATION")];
    case PLAY_SUB.CANCELED: {
      const reason = cancelReason(sub);
      if (!reason || reason === "REPLACED") return []; // a plan change is reported on the new purchase
      if (reason === "BILLING_ERROR") return billing(null).slice(1);
      return [per("CANCELLATION", { cancel_reason: reason })];
    }
    case PLAY_SUB.IN_GRACE_PERIOD:
      return billing(tx.expires_at);
    case PLAY_SUB.ON_HOLD:
      return [...billing(null), expiration("BILLING_ERROR")];
    case PLAY_SUB.EXPIRED: {
      const reason = cancelReason(sub);
      if (reason === "REPLACED") return [];
      return [expiration(reason ?? "UNKNOWN")];
    }
    case PLAY_SUB.PAUSE_SCHEDULE_CHANGED:
      return [per("SUBSCRIPTION_PAUSED", { auto_resume_at_ms: sub.pausedStateContext?.autoResumeTime ? Date.parse(sub.pausedStateContext.autoResumeTime) : null })];
    case PLAY_SUB.PAUSED:
      return [expiration("SUBSCRIPTION_PAUSED")];
    case PLAY_SUB.DEFERRED:
      return [per("SUBSCRIPTION_EXTENDED")];
    case PLAY_SUB.REVOKED:
      return [{ type: "CANCELLATION", dedupeKey: `refund:play_store:${tx.transaction_id}`, extra: { cancel_reason: "CUSTOMER_SUPPORT" }, negativePrice: true }];
    default:
      return [];
  }
}

/** A refunded or voided order (voidedPurchaseNotification, one-time cancel, or voided-purchases polling). */
export function googleRefundEvent(tx: TransactionRow): PlannedEvent {
  return { type: "CANCELLATION", dedupeKey: `refund:play_store:${tx.transaction_id}`, extra: { cancel_reason: "CUSTOMER_SUPPORT" }, negativePrice: true };
}

export function googleOneTimePurchaseEvent(tx: TransactionRow): PlannedEvent {
  return { type: "NON_RENEWING_PURCHASE", dedupeKey: purchaseKey(tx) };
}
