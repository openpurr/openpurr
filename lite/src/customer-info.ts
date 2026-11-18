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
//   - During a store grace period, access continues to the end of grace. Because the SDKs only
//     read expires_date, both the subscription's and the entitlement's expires_date move to
//     the grace end, and grace_period_expires_date is set alongside.
//   - An upgraded transaction (Apple isUpgraded) no longer grants entitlements; the upgrade's
//     own transaction does.

import { type Config, entitlementsFor } from "./config";
import type { Customer, SubscriptionStateRow, TransactionRow } from "./ledger";
import { APPLE_STATUS } from "./stores/apple";

interface Entitlement {
  expires_date: string | null;
  grace_period_expires_date: string | null;
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

type StateLookup = (t: TransactionRow) => SubscriptionStateRow | undefined;

/** The grace period end that currently extends this transaction, if any. */
function graceEnd(t: TransactionRow, state: SubscriptionStateRow | undefined): number | null {
  if (t.product_type !== "subscription" || t.revoked_at !== null || t.expires_at === null || !state) return null;
  const end = state.grace_period_expires_at;
  // Apple reports the grace end separately (after expires_date); Google extends expiryTime itself
  // to the end of grace, so there the two are equal.
  return state.status === APPLE_STATUS.GRACE_PERIOD && end !== null && end >= t.expires_at ? end : null;
}

/** When access from this transaction ends: its expiry, extended by grace, cut short by a refund. Null = never. */
function effectiveEnd(t: TransactionRow, state: SubscriptionStateRow | undefined): number | null {
  if (t.revoked_at !== null) return t.expires_at === null ? t.revoked_at : Math.min(t.expires_at, t.revoked_at);
  if (t.product_type !== "subscription") return null;
  return graceEnd(t, state) ?? t.expires_at;
}

/** True if a ends later than b (null = never ends). Ties go to the later purchase. */
function outlasts(a: TransactionRow, b: TransactionRow, stateOf: StateLookup): boolean {
  const ea = effectiveEnd(a, stateOf(a));
  const eb = effectiveEnd(b, stateOf(b));
  if (ea !== eb) return eb !== null && (ea === null || ea > eb);
  return a.purchased_at > b.purchased_at;
}

/**
 * The time-independent part of CustomerInfo: what's stored in customer_snapshot. Fields that
 * depend on the request time or the requesting app (request_date, last_seen, management_url)
 * are added by renderCustomerInfo.
 */
export interface Snapshot {
  subscriber: {
    original_app_user_id: string;
    original_application_version: null;
    original_purchase_date: null;
    first_seen: string;
    subscriptions: Record<string, unknown>;
    non_subscriptions: Record<string, unknown[]>;
    other_purchases: Record<string, never>;
    entitlements: Record<string, Entitlement>;
    subscriber_attributes: Record<string, never>;
  };
  /** Subscriptions that could make management_url non-null: store, app, product and when access ends. */
  management: { store: "app_store" | "play_store"; app_id: string; product_id: string; end: number }[];
}

export function computeSnapshot(args: {
  appUserId: string;
  customer: Customer | null;
  transactions: TransactionRow[];
  /** Store-reported subscription status (auto-renew, billing issues, grace periods). */
  states?: SubscriptionStateRow[];
  config: Config;
  now?: number;
}): Snapshot {
  const { config } = args;
  const stateMap = new Map((args.states ?? []).map((s) => [`${s.store}:${s.original_transaction_id}`, s]));
  const stateOf: StateLookup = (t) => stateMap.get(`${t.store}:${t.original_transaction_id}`);

  // Pick the transaction each subscriptions entry and each entitlement describes.
  const subscriptionTx = new Map<string, TransactionRow>();
  const entitlementTx = new Map<string, TransactionRow>();
  const nonSubscriptionTxs = new Map<string, TransactionRow[]>();

  for (const t of args.transactions) {
    if (t.product_type === "subscription") {
      const current = subscriptionTx.get(t.product_id);
      if (!current || outlasts(t, current, stateOf)) subscriptionTx.set(t.product_id, t);
    } else {
      if (t.revoked_at !== null) continue; // refunded one-time purchases grant nothing
      const list = nonSubscriptionTxs.get(t.product_id) ?? [];
      list.push(t);
      nonSubscriptionTxs.set(t.product_id, list);
    }
    if (t.product_type !== "subscription" && t.revoked_at !== null) continue;
    if (t.is_upgraded) continue; // replaced by the upgrade's own transaction
    for (const id of entitlementsFor(config, t.app_id, t.product_id, t.base_plan_id)) {
      const current = entitlementTx.get(id);
      if (!current || outlasts(t, current, stateOf)) entitlementTx.set(id, t);
    }
  }

  const subscriptions: Record<string, unknown> = {};
  for (const [productId, t] of subscriptionTx) {
    const state = stateOf(t);
    subscriptions[productId] = {
      purchase_date: iso(t.purchased_at),
      original_purchase_date: iso(t.original_purchased_at),
      expires_date: iso(effectiveEnd(t, state)),
      store: t.store,
      is_sandbox: t.environment === "sandbox",
      period_type: t.period_type,
      ownership_type: t.ownership_type,
      store_transaction_id: t.transaction_id,
      unsubscribe_detected_at: iso(state?.unsubscribe_detected_at ?? null),
      billing_issues_detected_at: iso(state?.billing_issue_detected_at ?? null),
      grace_period_expires_date: iso(graceEnd(t, state)),
      refunded_at: iso(t.revoked_at),
      auto_resume_date: iso(state?.auto_resume_at ?? null),
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
      expires_date: iso(effectiveEnd(t, stateOf(t))),
      grace_period_expires_date: iso(graceEnd(t, stateOf(t))),
      product_identifier: t.product_id,
      purchase_date: iso(t.purchased_at),
      ...(t.base_plan_id ? { product_plan_identifier: t.base_plan_id } : {}),
    };
  }

  return {
    subscriber: {
      original_app_user_id: args.customer?.appUserId ?? args.appUserId,
      original_application_version: null,
      original_purchase_date: null,
      first_seen: iso(args.customer?.firstSeen ?? args.now ?? Date.now()),
      subscriptions,
      non_subscriptions: nonSubscriptions,
      other_purchases: {},
      entitlements,
      subscriber_attributes: {},
    },
    management: [...subscriptionTx.values()]
      .filter((t) => t.revoked_at === null)
      .map((t) => ({ store: t.store, app_id: t.app_id, product_id: t.product_id, end: effectiveEnd(t, stateOf(t)) ?? 0 })),
  };
}

/** The CustomerInfo body for one request: the snapshot plus request time and management_url. */
export function renderCustomerInfo(
  snapshot: Snapshot,
  config: Config,
  opts: { now?: number; requestStore?: "app_store" | "play_store" } = {},
) {
  const now = opts.now ?? Date.now();
  const { subscriber } = snapshot;
  return {
    request_date: iso(now),
    request_date_ms: now,
    subscriber: {
      original_app_user_id: subscriber.original_app_user_id,
      original_application_version: subscriber.original_application_version,
      original_purchase_date: subscriber.original_purchase_date,
      first_seen: subscriber.first_seen,
      last_seen: iso(now),
      management_url: managementUrl(config, snapshot.management, now, opts.requestStore),
      subscriptions: subscriber.subscriptions,
      non_subscriptions: subscriber.non_subscriptions,
      other_purchases: subscriber.other_purchases,
      entitlements: subscriber.entitlements,
      subscriber_attributes: subscriber.subscriber_attributes,
    },
  };
}

/** Computes and renders in one step (no snapshot involved). */
export function buildCustomerInfo(args: Parameters<typeof computeSnapshot>[0] & { requestStore?: "app_store" | "play_store" }) {
  return renderCustomerInfo(computeSnapshot(args), args.config, { now: args.now, requestStore: args.requestStore });
}

/**
 * The store page where the user manages the active subscription. Prefers the requesting
 * platform's store when it has one; otherwise the subscription that ends last. Null if none.
 */
function managementUrl(config: Config, subs: Snapshot["management"], now: number, requestStore?: string): string | null {
  const active = subs.filter((m) => m.end > now);
  if (!active.length) return null;
  const pick = active.find((m) => m.store === requestStore) ?? active.reduce((a, b) => (b.end > a.end ? b : a));
  if (pick.store === "app_store") return APPLE_MANAGEMENT_URL;
  const pkg = config.apps.get(pick.app_id)?.packageName;
  const q = new URLSearchParams({ sku: pick.product_id, ...(pkg ? { package: pkg } : {}) });
  return `https://play.google.com/store/account/subscriptions?${q}`;
}
