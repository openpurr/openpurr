// Google Play: turns Play Developer API answers into ledger rows and subscription status.
//
// Identity: the purchase token identifies a subscription chain (original_transaction_id); each
// order (the first purchase and every renewal, "GPA.1234-...", renewals suffixed "..1", "..2")
// is a transaction (transaction_id). An upgrade, downgrade or re-signup creates a NEW purchase
// token whose linkedPurchaseToken points at the old one.

import type { AppConfig, ProductConfig } from "../config";
import type { NewTransaction } from "../ledger";
import { APPLE_STATUS, type SubscriptionStateUpdate } from "./apple";
import { moneyMicros, type Order, type ProductPurchase, type SubscriptionPurchaseV2 } from "./google-api";

export class GoogleMappingError extends Error {}

const ms = (iso?: string) => (iso ? Date.parse(iso) : null);

/** Google subscription state to the ledger's status codes (Apple's, plus PAUSED). */
const STATUS: Record<string, number | null> = {
  SUBSCRIPTION_STATE_ACTIVE: APPLE_STATUS.ACTIVE,
  // Canceled = auto-renew off; access continues until expiry.
  SUBSCRIPTION_STATE_CANCELED: APPLE_STATUS.ACTIVE,
  SUBSCRIPTION_STATE_IN_GRACE_PERIOD: APPLE_STATUS.GRACE_PERIOD,
  SUBSCRIPTION_STATE_ON_HOLD: APPLE_STATUS.BILLING_RETRY,
  SUBSCRIPTION_STATE_PAUSED: APPLE_STATUS.PAUSED,
  SUBSCRIPTION_STATE_EXPIRED: APPLE_STATUS.EXPIRED,
  SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED: APPLE_STATUS.EXPIRED,
  SUBSCRIPTION_STATE_PENDING: null,
};

/** True for states that never granted access: the purchase is still pending. */
export function isPending(sub: SubscriptionPurchaseV2) {
  return sub.subscriptionState === "SUBSCRIPTION_STATE_PENDING" || sub.subscriptionState === "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED";
}

/**
 * The ledger row for a subscription's current order. `order` (from the Orders API) supplies the
 * price actually paid when available; otherwise the plan's recurring price is used for a normal
 * period, 0 for a free trial, and null for an introductory price.
 */
export function googleSubscriptionRow(
  sub: SubscriptionPurchaseV2,
  purchaseToken: string,
  app: AppConfig,
  product: ProductConfig,
  opts: { now?: number; order?: Order | null } = {},
): NewTransaction {
  const item = sub.lineItems?.find((li) => li.productId === product.id);
  if (!item) throw new GoogleMappingError(`Google's answer has no line item for ${product.id}`);
  if (product.type !== "subscription") throw new GoogleMappingError(`${product.id} is a subscription in Google Play, but the config says ${product.type}`);
  const start = ms(sub.startTime) ?? opts.now ?? Date.now();
  const orderId = item.latestSuccessfulOrderId;
  // Renewal orders end in "..N"; their period started recently, not at startTime.
  const isRenewal = !!orderId && /\.\.\d+$/.test(orderId);
  const phase = item.offerPhase ?? {};
  const periodType = phase.freeTrial ? "trial" : phase.introductoryPrice ? "intro" : "normal";

  const paid = moneyMicros(opts.order?.lineItems?.find((l) => l.productId === product.id)?.total ?? opts.order?.total);
  const recurring = moneyMicros(item.autoRenewingPlan?.recurringPrice);
  const price = paid ?? (periodType === "trial" && recurring ? { micros: 0, currency: recurring.currency } : periodType === "normal" ? recurring : null);

  return {
    app_id: app.id,
    store: "play_store",
    environment: sub.testPurchase ? "sandbox" : "production",
    transaction_id: orderId ?? `${purchaseToken}:${item.expiryTime ?? start}`,
    original_transaction_id: purchaseToken,
    product_id: product.id,
    base_plan_id: item.offerDetails?.basePlanId ?? null,
    product_type: "subscription",
    purchased_at: isRenewal ? (opts.now ?? Date.now()) : start,
    original_purchased_at: start,
    expires_at: ms(item.expiryTime),
    period_type: periodType,
    ownership_type: "PURCHASED",
    price_micros: price?.micros ?? null,
    currency: price?.currency ?? null,
    storefront: sub.regionCode ?? null,
    revoked_at: null,
    revocation_reason: null,
    is_upgraded: 0,
    verified: 1,
    source: "sdk",
    subscription_group: null,
  };
}

/** Subscription status from Google's answer. `signedAt` orders updates (the event time). */
export function googleSubscriptionState(sub: SubscriptionPurchaseV2, purchaseToken: string, signedAt: number): SubscriptionStateUpdate {
  const status = STATUS[sub.subscriptionState ?? ""] ?? null;
  const item = sub.lineItems?.[0];
  const autoRenew = item?.autoRenewingPlan ? (item.autoRenewingPlan.autoRenewEnabled ? 1 : 0) : null;
  return {
    store: "play_store",
    original_transaction_id: purchaseToken,
    status,
    auto_renew: autoRenew,
    auto_renew_product_id: null,
    expiration_intent: null,
    billing_issue: status === APPLE_STATUS.GRACE_PERIOD || status === APPLE_STATUS.BILLING_RETRY,
    // In grace, Google extends expiryTime to the end of the grace period.
    grace_period_expires_at: status === APPLE_STATUS.GRACE_PERIOD ? ms(item?.expiryTime) : null,
    auto_resume_at: status === APPLE_STATUS.PAUSED ? ms(sub.pausedStateContext?.autoResumeTime) : null,
    signed_at: signedAt,
  };
}

/** The ledger row for a one-time product. Null while the purchase is pending. */
export function googleProductRow(
  p: ProductPurchase,
  purchaseToken: string,
  app: AppConfig,
  product: ProductConfig,
  opts: { order?: Order | null; now?: number } = {},
): NewTransaction | null {
  if (product.type === "subscription") throw new GoogleMappingError(`${product.id} is a one-time product in Google Play, but the config says subscription`);
  if (p.purchaseState === 2) return null; // pending: not paid yet
  const purchasedAt = Number(p.purchaseTimeMillis ?? opts.now ?? Date.now());
  const price = moneyMicros(opts.order?.lineItems?.find((l) => l.productId === product.id)?.total ?? opts.order?.total);
  return {
    app_id: app.id,
    store: "play_store",
    environment: p.purchaseType === 0 ? "sandbox" : "production",
    transaction_id: p.orderId ?? purchaseToken,
    original_transaction_id: purchaseToken,
    product_id: product.id,
    base_plan_id: null,
    product_type: product.type,
    purchased_at: purchasedAt,
    original_purchased_at: purchasedAt,
    expires_at: null,
    period_type: "normal",
    ownership_type: "PURCHASED",
    price_micros: price?.micros ?? null,
    currency: price?.currency ?? null,
    storefront: p.regionCode ?? null,
    // purchaseState 1 = canceled (refunded or revoked).
    revoked_at: p.purchaseState === 1 ? (opts.now ?? Date.now()) : null,
    revocation_reason: p.purchaseState === 1 ? "canceled" : null,
    is_upgraded: 0,
    verified: 1,
    source: "sdk",
    subscription_group: null,
  };
}
