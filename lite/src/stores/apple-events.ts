// Maps App Store Server Notifications to RevenueCat webhook events, following RevenueCat's
// documented event flows. Dedupe keys make each fact produce one event, whichever source reports
// it first: purchase events are keyed by transaction (shared with POST /v1/receipts), and
// expirations by subscription period.

import type { WebhookEventType } from "../config";
import type { TransactionRow } from "../ledger";
import type { AppleNotification, AppleRenewalInfo } from "./apple";

export interface PlannedEvent {
  type: WebhookEventType;
  dedupeKey: string;
  extra?: Record<string, unknown>;
  negativePrice?: boolean;
}

/** The one purchase event per transaction, shared by receipts and notifications. */
export const purchaseKey = (t: Pick<TransactionRow, "store" | "transaction_id">) => `purchase:${t.store}:${t.transaction_id}`;
const expirationKey = (t: TransactionRow) => `expiration:${t.store}:${t.original_transaction_id}:${t.expires_at ?? t.transaction_id}`;

const EXPIRATION_REASON: Record<string, string> = {
  VOLUNTARY: "UNSUBSCRIBE",
  BILLING_RETRY: "BILLING_ERROR",
  PRICE_INCREASE: "PRICE_INCREASE",
  PRODUCT_NOT_FOR_SALE: "UNKNOWN",
};

export function appleNotificationEvents(
  n: AppleNotification,
  tx: TransactionRow | undefined,
  renewal: AppleRenewalInfo | undefined,
  opts: { previousPeriodType?: string | null } = {},
): PlannedEvent[] {
  if (!tx) return [];
  const per = (type: WebhookEventType, extra?: Record<string, unknown>): PlannedEvent => ({
    type,
    dedupeKey: `notification:app_store:${n.notificationUUID}:${type}`,
    ...(extra ? { extra } : {}),
  });

  switch (n.notificationType) {
    case "SUBSCRIBED":
      // A resubscription continues the same chain, which RevenueCat reports as a renewal.
      return [{ type: n.subtype === "RESUBSCRIBE" ? "RENEWAL" : "INITIAL_PURCHASE", dedupeKey: purchaseKey(tx), ...renewalExtra(n, opts) }];
    case "DID_RENEW":
      return [{ type: "RENEWAL", dedupeKey: purchaseKey(tx), ...renewalExtra(n, opts) }];
    case "ONE_TIME_CHARGE":
      return [{ type: "NON_RENEWING_PURCHASE", dedupeKey: purchaseKey(tx) }];
    case "DID_CHANGE_RENEWAL_STATUS":
      if (n.subtype === "AUTO_RENEW_DISABLED") return [per("CANCELLATION", { cancel_reason: "UNSUBSCRIBE" })];
      if (n.subtype === "AUTO_RENEW_ENABLED") return [per("UNCANCELLATION")];
      return [];
    case "DID_FAIL_TO_RENEW": {
      // RevenueCat sends these together, in this order. Without a grace period, access ends now.
      const events = [
        per("BILLING_ISSUE", { grace_period_expiration_at_ms: renewal?.gracePeriodExpiresDate ?? null }),
        per("CANCELLATION", { cancel_reason: "BILLING_ERROR" }),
      ];
      if (n.subtype !== "GRACE_PERIOD") {
        events.push({ type: "EXPIRATION", dedupeKey: expirationKey(tx), extra: { expiration_reason: "BILLING_ERROR" } });
      }
      return events;
    }
    case "GRACE_PERIOD_EXPIRED":
      return [{ type: "EXPIRATION", dedupeKey: expirationKey(tx), extra: { expiration_reason: "BILLING_ERROR" } }];
    case "EXPIRED":
      return [
        { type: "EXPIRATION", dedupeKey: expirationKey(tx), extra: { expiration_reason: EXPIRATION_REASON[n.subtype ?? ""] ?? "UNKNOWN" } },
      ];
    case "DID_CHANGE_RENEWAL_PREF":
      if (n.subtype === "UPGRADE" || n.subtype === "DOWNGRADE") {
        return [per("PRODUCT_CHANGE", { new_product_id: renewal?.autoRenewProductId ?? null })];
      }
      return [];
    case "REFUND":
      return [{ type: "CANCELLATION", dedupeKey: `refund:app_store:${tx.transaction_id}`, extra: { cancel_reason: "CUSTOMER_SUPPORT" }, negativePrice: true }];
    case "REVOKE":
      // Family Sharing access ended.
      return [{ type: "CANCELLATION", dedupeKey: `revoke:app_store:${tx.transaction_id}`, extra: { cancel_reason: "UNKNOWN" } }];
    case "REFUND_REVERSED":
      return [per("REFUND_REVERSED")];
    case "RENEWAL_EXTENDED":
      return [per("SUBSCRIPTION_EXTENDED")];
    case "PRICE_INCREASE":
      if (n.subtype === "PENDING") return [per("PRICE_INCREASE_CONSENT_REQUIRED")];
      if (n.subtype === "ACCEPTED") return [per("PRICE_INCREASE_CONSENT_APPROVED")];
      return [];
    default:
      return [];
  }
}

function renewalExtra(n: AppleNotification, opts: { previousPeriodType?: string | null }) {
  if (n.notificationType !== "DID_RENEW" && n.subtype !== "RESUBSCRIBE") return {};
  return { extra: { is_trial_conversion: opts.previousPeriodType === "trial" } };
}

/**
 * Purchase events for transactions written by POST /v1/receipts. Only recent purchases count:
 * restoring an old purchase (or importing history) shouldn't announce it as new. "Recent" is
 * generous because a purchase can sit queued on an offline device before it's posted.
 */
export function receiptPurchaseEvents(t: TransactionRow, now: number, recentMs = 72 * 3600_000): PlannedEvent[] {
  if (t.revoked_at !== null || t.purchased_at < now - recentMs) return [];
  if (t.product_type !== "subscription") return [{ type: "NON_RENEWING_PURCHASE", dedupeKey: purchaseKey(t) }];
  const first = t.transaction_id === t.original_transaction_id;
  return [{ type: first ? "INITIAL_PURCHASE" : "RENEWAL", dedupeKey: purchaseKey(t) }];
}
