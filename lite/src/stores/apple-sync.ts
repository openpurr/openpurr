// Brings App Store data in through the App Store Server API: resolving StoreKit 1 receipts,
// and refreshing subscription status (for example on restore, when the device's view may be
// stale). Turns Apple's answers into ledger rows and status updates.

import type { AppConfig } from "../config";
import type { Deps, Env } from "../env";
import type { NewTransaction } from "../ledger";
import { type AppleTransaction, appleSubscriptionState, appleTransactionRow, type SubscriptionStateUpdate } from "./apple";
import { type AppleApiClient, type AppleEnvironment, appleApiClient, inEitherEnvironment } from "./apple-api";

/**
 * At most this many transactions are written per request. Every statement in a D1 batch counts
 * toward the free plan's 50 queries per invocation.
 */
export const MAX_TRANSACTIONS_PER_SYNC = 15;

export interface SyncResult {
  transactions: NewTransaction[];
  states: SubscriptionStateUpdate[];
  /** Products in Apple's answer that the config doesn't list (ignored). */
  skipped: string[];
}

export class AppleApiNotConfigured extends Error {}

/** API clients for both environments, or AppleApiNotConfigured with a message saying what's missing. */
export function appleClients(app: AppConfig, env: Env, deps: Deps) {
  const api = app.appStoreServerApi;
  if (!api) throw new AppleApiNotConfigured(`App ${app.id} has no app_store_server_api in the config.`);
  const pem = (env as unknown as Record<string, unknown>)[api.privateKeySecret];
  if (typeof pem !== "string" || !pem.includes("PRIVATE KEY")) {
    throw new AppleApiNotConfigured(`The Worker secret ${api.privateKeySecret} (App Store In-App Purchase key) isn't set.`);
  }
  const creds = { issuerId: api.issuerId, keyId: api.keyId, bundleId: app.bundleId!, privateKeyPem: pem };
  return {
    production: appleApiClient(creds, "production", deps.fetch),
    sandbox: appleApiClient(creds, "sandbox", deps.fetch),
  };
}

/** The customer's purchases, from any transaction ID (as found in a StoreKit 1 receipt). */
export async function syncFromTransactionId(
  clients: { production: AppleApiClient; sandbox: AppleApiClient },
  app: AppConfig,
  transactionId: string,
): Promise<SyncResult & { environment: AppleEnvironment }> {
  // One page (the 20 newest) is enough for CustomerInfo: it holds the latest transaction of
  // every active subscription for all but the most prolific buyers.
  const { result: history, environment } = await inEitherEnvironment(clients, (client) => client.transactionHistory(transactionId, 1));
  const statuses = await clients[environment].subscriptionStatuses(transactionId);
  return { ...toLedger(app, [...statuses.map((s) => s.transaction), ...history.transactions], statuses), environment };
}

/** Current status of every subscription the customer has in the app. */
export async function syncStatuses(client: AppleApiClient, app: AppConfig, transactionId: string): Promise<SyncResult> {
  const statuses = await client.subscriptionStatuses(transactionId);
  return toLedger(app, statuses.map((s) => s.transaction), statuses);
}

function toLedger(
  app: AppConfig,
  transactions: AppleTransaction[],
  statuses: { status: number; renewal: Parameters<typeof appleSubscriptionState>[0] }[],
): SyncResult {
  const skipped = new Set<string>();
  const rows = new Map<string, NewTransaction>();
  for (const tx of transactions) {
    if (tx.bundleId !== app.bundleId) continue;
    const product = app.products.get(tx.productId);
    if (!product) {
      skipped.add(tx.productId);
      continue;
    }
    try {
      rows.set(String(tx.transactionId), { ...appleTransactionRow(tx, app, product), source: "store_api" });
    } catch {
      skipped.add(tx.productId); // type mismatch with the config
    }
  }

  // Keep what CustomerInfo needs: each subscription chain's furthest-reaching transaction
  // (plus any refunded or upgraded ones, which change access), and every one-time purchase.
  const latestPerChain = new Map<string, NewTransaction>();
  const keep: NewTransaction[] = [];
  for (const row of rows.values()) {
    if (row.product_type !== "subscription") keep.push(row);
    else if (row.revoked_at !== null || row.is_upgraded) keep.push(row);
    else {
      const best = latestPerChain.get(row.original_transaction_id);
      if (!best || (row.expires_at ?? 0) > (best.expires_at ?? 0)) latestPerChain.set(row.original_transaction_id, row);
    }
  }
  keep.push(...latestPerChain.values());
  keep.sort((a, b) => b.purchased_at - a.purchased_at); // newest first, if we have to cap

  return {
    transactions: keep.slice(0, MAX_TRANSACTIONS_PER_SYNC),
    states: statuses.map((s) => appleSubscriptionState(s.renewal, s.status)),
    skipped: [...skipped],
  };
}
