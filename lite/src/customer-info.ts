// Builds the CustomerInfo body both SDKs accept. Field requirements come from the SDK
// sources; see the CustomerInfo section of spec/sdk-wire-contract.md. Notable cross-platform constraints:
//   - iOS requires request_date and subscriber.original_app_user_id.
//   - Android requires subscriptions and non_subscriptions objects, purchase_date on each
//     entitlement, and original_purchase_date/store/is_sandbox on the purchase it points to.
//   - Android drops an entitlement whose product_identifier isn't a key in subscriptions or
//     non_subscriptions.
//   - iOS requires is_sandbox on every non_subscriptions entry, and finishes a consumable only
//     when its store_transaction_id appears there.

import type { SpikeConfig } from "./spike-config";

export interface PurchaseRow {
  store_transaction_id: string;
  product_id: string;
  base_plan_id: string | null;
  kind: "subscription" | "non_subscription";
  store: string;
  is_sandbox: number;
  purchased_at: string;
  original_purchased_at: string;
  expires_at: string | null;
}

interface Entitlement {
  product_identifier: string;
  purchase_date: string;
  expires_date: string | null;
  product_plan_identifier?: string;
}

export function buildCustomerInfo(args: {
  appUserId: string;
  originalAppUserId: string;
  firstSeen: string;
  purchases: PurchaseRow[];
  config: SpikeConfig;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const subscriptions: Record<string, unknown> = {};
  const nonSubscriptions: Record<string, unknown[]> = {};
  const entitlements: Record<string, Entitlement> = {};

  // Oldest first, so the latest purchase of each subscription product wins.
  const purchases = [...args.purchases].sort((a, b) => a.purchased_at.localeCompare(b.purchased_at));

  for (const p of purchases) {
    const isSandbox = p.is_sandbox === 1;
    if (p.kind === "subscription") {
      subscriptions[p.product_id] = {
        purchase_date: p.purchased_at,
        original_purchase_date: p.original_purchased_at,
        expires_date: p.expires_at,
        store: p.store,
        is_sandbox: isSandbox,
        period_type: "normal",
        ownership_type: "PURCHASED",
        unsubscribe_detected_at: null,
        billing_issues_detected_at: null,
        store_transaction_id: p.store_transaction_id,
        ...(p.base_plan_id ? { product_plan_identifier: p.base_plan_id } : {}),
      };
    } else {
      (nonSubscriptions[p.product_id] ??= []).push({
        id: p.store_transaction_id,
        store_transaction_id: p.store_transaction_id,
        purchase_date: p.purchased_at,
        original_purchase_date: p.original_purchased_at,
        store: p.store,
        is_sandbox: isSandbox,
      });
    }

    for (const id of args.config.products[p.product_id]?.entitlements ?? []) {
      const candidate: Entitlement = {
        product_identifier: p.product_id,
        purchase_date: p.purchased_at,
        expires_date: p.expires_at,
        ...(p.base_plan_id ? { product_plan_identifier: p.base_plan_id } : {}),
      };
      const current = entitlements[id];
      if (!current || outlasts(candidate, current)) entitlements[id] = candidate;
    }
  }

  const iso = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  return {
    request_date: iso,
    request_date_ms: now.getTime(),
    subscriber: {
      original_app_user_id: args.originalAppUserId,
      original_application_version: null,
      original_purchase_date: null,
      first_seen: args.firstSeen,
      last_seen: iso,
      management_url: null,
      subscriptions,
      non_subscriptions: nonSubscriptions,
      other_purchases: {},
      entitlements,
      subscriber_attributes: {},
    },
  };
}

/** Lifetime beats any expiry; otherwise the later expiry wins. */
function outlasts(a: Entitlement, b: Entitlement): boolean {
  if (b.expires_date === null) return false;
  if (a.expires_date === null) return true;
  return a.expires_date > b.expires_date;
}
