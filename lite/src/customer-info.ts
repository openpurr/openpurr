// Builds the CustomerInfo body from ledger rows. Field requirements come from the SDK sources;
// see the CustomerInfo section of spec/sdk-wire-contract.md. Notable cross-platform constraints:
//   - iOS requires request_date and subscriber.original_app_user_id.
//   - Android requires subscriptions and non_subscriptions objects, purchase_date on each
//     entitlement, and original_purchase_date/store/is_sandbox on the purchase it points to.
//   - Android drops an entitlement whose product_identifier isn't a key in subscriptions or
//     non_subscriptions.
//   - iOS requires is_sandbox on every non_subscriptions entry, and finishes a consumable only
//     when its store_transaction_id appears there.
//   - Both SDKs decide whether an entitlement is active from its expires_date alone, compared
//     with request_date. grace_period_expires_date is never read.
//
// Value rules:
//   - An entitlement describes the purchase that grants it with the furthest-out expiry.
//     Lifetime (null expiry) beats any subscription. Ties go to the latest purchase.
//   - A subscriptions entry (keyed by product ID; Google base plans share one entry) describes
//     the purchase with the furthest-out expiry.
//   - A refund or revocation ends access at the revocation time: expires_date becomes that
//     time and refunded_at is set. Refunded one-time purchases are left out entirely, so they
//     can't grant an entitlement.

import { type Config, entitlementsFor } from "./config";
import type { Customer, TransactionRow } from "./ledger";

interface Entitlement {
  expires_date: string | null;
  grace_period_expires_date: null;
  product_identifier: string;
  purchase_date: string;
  product_plan_identifier?: string;
}

const APPLE_MANAGEMENT_URL = "https://apps.apple.com/account/subscriptions";

export function iso(ms: number): string;
export function iso(ms: number | null): string | null;
export function iso(ms: number | null) {
  return ms === null ? null : new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** When access from this transaction ends: its expiry, cut short by a refund. Null = never. */
function effectiveEnd(t: TransactionRow): number | null {
  if (t.revoked_at !== null) return t.expires_at === null ? t.revoked_at : Math.min(t.expires_at, t.revoked_at);
  return t.product_type === "subscription" ? t.expires_at : null;
}

/** True if a ends later than b (null = never ends). Ties go to the later purchase. */
function outlasts(a: TransactionRow, b: TransactionRow): boolean {
  const ea = effectiveEnd(a);
  const eb = effectiveEnd(b);
  if (ea !== eb) return eb !== null && (ea === null || ea > eb);
  return a.purchased_at > b.purchased_at;
}

export function buildCustomerInfo(args: {
  appUserId: string;
  customer: Customer | null;
  transactions: TransactionRow[];
  config: Config;
  /** The store of the requesting app, for management_url. */
  requestStore?: "app_store" | "play_store";
  now?: number;
}) {
  const now = args.now ?? Date.now();
  const { config } = args;

  // Pick the transaction each subscriptions entry and each entitlement describes.
  const subscriptionTx = new Map<string, TransactionRow>();
  const entitlementTx = new Map<string, TransactionRow>();
  const nonSubscriptionTxs = new Map<string, TransactionRow[]>();

  for (const t of args.transactions) {
    if (t.product_type === "subscription") {
      const current = subscriptionTx.get(t.product_id);
      if (!current || outlasts(t, current)) subscriptionTx.set(t.product_id, t);
    } else {
      if (t.revoked_at !== null) continue; // refunded one-time purchases grant nothing
      const list = nonSubscriptionTxs.get(t.product_id) ?? [];
      list.push(t);
      nonSubscriptionTxs.set(t.product_id, list);
    }
    if (t.product_type !== "subscription" && t.revoked_at !== null) continue;
    for (const id of entitlementsFor(config, t.app_id, t.product_id, t.base_plan_id)) {
      const current = entitlementTx.get(id);
      if (!current || outlasts(t, current)) entitlementTx.set(id, t);
    }
  }

  const subscriptions: Record<string, unknown> = {};
  for (const [productId, t] of subscriptionTx) {
    subscriptions[productId] = {
      purchase_date: iso(t.purchased_at),
      original_purchase_date: iso(t.original_purchased_at),
      expires_date: iso(effectiveEnd(t)),
      store: t.store,
      is_sandbox: t.environment === "sandbox",
      period_type: t.period_type,
      ownership_type: t.ownership_type,
      store_transaction_id: t.transaction_id,
      unsubscribe_detected_at: null,
      billing_issues_detected_at: null,
      grace_period_expires_date: null,
      refunded_at: iso(t.revoked_at),
      auto_resume_date: null,
      ...(t.price_micros !== null && t.currency ? { price: { amount: t.price_micros / 1e6, currency: t.currency } } : {}),
      ...(t.base_plan_id ? { product_plan_identifier: t.base_plan_id } : {}),
    };
  }

  const nonSubscriptions: Record<string, unknown[]> = {};
  for (const [productId, list] of nonSubscriptionTxs) {
    nonSubscriptions[productId] = list
      .sort((a, b) => a.purchased_at - b.purchased_at)
      .map((t) => ({
        id: t.transaction_id,
        store_transaction_id: t.transaction_id,
        purchase_date: iso(t.purchased_at),
        original_purchase_date: iso(t.original_purchased_at),
        store: t.store,
        is_sandbox: t.environment === "sandbox",
        ...(t.price_micros !== null && t.currency ? { price: { amount: t.price_micros / 1e6, currency: t.currency } } : {}),
      }));
  }

  const entitlements: Record<string, Entitlement> = {};
  for (const [id, t] of entitlementTx) {
    entitlements[id] = {
      expires_date: iso(effectiveEnd(t)),
      grace_period_expires_date: null,
      product_identifier: t.product_id,
      purchase_date: iso(t.purchased_at),
      ...(t.base_plan_id ? { product_plan_identifier: t.base_plan_id } : {}),
    };
  }

  return {
    request_date: iso(now),
    request_date_ms: now,
    subscriber: {
      original_app_user_id: args.customer?.appUserId ?? args.appUserId,
      original_application_version: null,
      original_purchase_date: null,
      first_seen: iso(args.customer?.firstSeen ?? now),
      last_seen: iso(now),
      management_url: managementUrl(config, [...subscriptionTx.values()], now, args.requestStore),
      subscriptions,
      non_subscriptions: nonSubscriptions,
      other_purchases: {},
      entitlements,
      subscriber_attributes: {},
    },
  };
}

/**
 * The store page where the user manages the active subscription. Prefers the requesting
 * platform's store when it has one; otherwise the subscription that ends last. Null if none.
 */
function managementUrl(config: Config, subs: TransactionRow[], now: number, requestStore?: string): string | null {
  const active = subs.filter((t) => t.revoked_at === null && (t.expires_at ?? 0) > now);
  if (!active.length) return null;
  const pick =
    active.find((t) => t.store === requestStore) ??
    active.reduce((a, b) => ((b.expires_at ?? 0) > (a.expires_at ?? 0) ? b : a));
  if (pick.store === "app_store") return APPLE_MANAGEMENT_URL;
  const pkg = config.apps.get(pick.app_id)?.packageName;
  const q = new URLSearchParams({ sku: pick.product_id, ...(pkg ? { package: pkg } : {}) });
  return `https://play.google.com/store/account/subscriptions?${q}`;
}
