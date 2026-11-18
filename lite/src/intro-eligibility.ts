// Introductory-offer eligibility for the iOS SDK's StoreKit 1 path
// (POST /v1/subscribers/{id}/intro_eligibility). StoreKit 2 apps compute this on the device.
//
// Apple's rule: a customer can't get an introductory offer in a subscription group if they've
// ever subscribed to any product in that group. The answer per product is true, false, or null
// (unknown), which the SDK maps to eligible, ineligible and unknown.
//
// It's a display hint: Apple enforces the real rule at purchase time. So the unverified product
// IDs in the receipt the SDK sends are used, but only ever to answer "not eligible".

import type { AppConfig } from "./config";
import type { TransactionRow } from "./ledger";

/** Subscription group per product: from the config, else learned from the ledger. One query. */
async function groupsFor(db: D1Database, app: AppConfig, productIds: string[]) {
  const groups = new Map<string, string>();
  const unknown: string[] = [];
  for (const id of productIds) {
    const configured = app.products.get(id)?.subscriptionGroup;
    if (configured) groups.set(id, configured);
    else unknown.push(id);
  }
  if (unknown.length) {
    const { results } = await db
      .prepare(
        `SELECT product_id, max(subscription_group) AS subscription_group FROM store_transaction
         WHERE store = 'app_store' AND product_id IN (SELECT value FROM json_each(?)) AND subscription_group IS NOT NULL
         GROUP BY product_id`,
      )
      .bind(JSON.stringify(unknown))
      .all<{ product_id: string; subscription_group: string }>();
    for (const r of results) groups.set(r.product_id, r.subscription_group);
  }
  return groups;
}

export async function introEligibility(args: {
  db: D1Database;
  app: AppConfig;
  requested: string[];
  /** The customer's App Store transactions from the ledger. */
  history: TransactionRow[];
  /** Product IDs listed in the device's receipt (unverified). */
  receiptProductIds: string[];
}): Promise<Record<string, boolean | null>> {
  const { app, requested } = args;
  const result: Record<string, boolean | null> = Object.fromEntries(requested.map((id) => [id, null]));
  if (app.store !== "app_store") return result;

  const subscriptions = requested.filter((id) => app.products.get(id)?.type === "subscription");
  if (!subscriptions.length) return result;

  const owned = new Set([...args.receiptProductIds, ...args.history.filter((t) => t.product_type === "subscription").map((t) => t.product_id)]);
  const groups = await groupsFor(args.db, app, [...new Set([...subscriptions, ...owned])]);
  const usedGroups = new Set<string>();
  for (const t of args.history) if (t.product_type === "subscription" && t.subscription_group) usedGroups.add(t.subscription_group);
  for (const id of owned) {
    const g = groups.get(id);
    if (g) usedGroups.add(g);
  }

  for (const id of subscriptions) {
    const group = groups.get(id);
    if (group) result[id] = !usedGroups.has(group);
  }
  return result;
}
