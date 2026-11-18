// Verifies Google Play purchases with the Play Developer API and acknowledges them.
//
// Acknowledgement: Google refunds purchases that aren't acknowledged within 3 days. The SDK may
// acknowledge on the device too, but the server acknowledges subscriptions and non-consumables
// as a safety net; a failed attempt goes into play_ack_pending for the scheduled job to retry.
// Consumables are left to the device, which consumes them (should_consume), and consuming
// acknowledges.

import type { AppConfig } from "../config";
import type { Deps, Env } from "../env";
import type { NewTransaction } from "../ledger";
import type { SubscriptionStateUpdate } from "./apple";
import { type GooglePlayClient, googlePlayClient, type GoogleServiceAccountKey, type Order } from "./google-api";
import { googleProductRow, googleSubscriptionRow, googleSubscriptionState, isPending } from "./google";

export class GoogleApiNotConfigured extends Error {}
export class PendingPurchase extends Error {}

export interface PlayAck {
  kind: "subscription" | "product";
  productId: string;
  purchaseToken: string;
}

export interface PlayPurchase {
  transactions: NewTransaction[];
  states: SubscriptionStateUpdate[];
  postedTransactionId: string;
  /** Set when the purchase still needs a server-side acknowledgement. */
  ack: PlayAck | null;
  /** The purchase token this one replaces (upgrade, downgrade or re-signup), if any. */
  replaces: string | null;
}

/** The Play Developer API client for an app, or GoogleApiNotConfigured saying what's missing. */
export function googleClientFor(app: AppConfig, env: Env, deps: Deps): GooglePlayClient {
  const api = app.googlePlayApi;
  if (!api) throw new GoogleApiNotConfigured(`App ${app.id} has no google_play_api in the config.`);
  const raw = (env as unknown as Record<string, unknown>)[api.serviceAccountSecret];
  let sa: GoogleServiceAccountKey | undefined;
  try {
    sa = typeof raw === "string" ? (JSON.parse(raw) as GoogleServiceAccountKey) : undefined;
  } catch {
    // Reported below.
  }
  if (!sa?.client_email || !sa.private_key) {
    throw new GoogleApiNotConfigured(`The Worker secret ${api.serviceAccountSecret} doesn't hold a service account JSON key.`);
  }
  return googlePlayClient(sa, app.packageName!, deps.fetch);
}

/** The Orders API's record of what was paid, or null (missing permission, or no order yet). */
async function orderOrNull(client: GooglePlayClient, orderId: string | undefined): Promise<Order | null> {
  if (!orderId) return null;
  try {
    return await client.order(orderId);
  } catch (err) {
    console.warn(`Couldn't read order ${orderId} for its price (the service account may lack "View financial data"):`, err);
    return null;
  }
}

/** Verifies a purchase the Android SDK posted. Throws GoogleApiError, PendingPurchase or GoogleMappingError. */
export async function verifyPlayPurchase(
  client: GooglePlayClient,
  app: AppConfig,
  purchaseToken: string,
  productId: string,
  opts: { now?: number } = {},
): Promise<PlayPurchase> {
  const product = app.products.get(productId)!;
  const now = opts.now ?? Date.now();

  if (product.type === "subscription") {
    const sub = await client.subscription(purchaseToken);
    if (isPending(sub)) throw new PendingPurchase("The subscription purchase is still pending.");
    const item = sub.lineItems?.find((li) => li.productId === productId);
    const order = await orderOrNull(client, item?.latestSuccessfulOrderId);
    const row = googleSubscriptionRow(sub, purchaseToken, app, product, { now, order });
    return {
      transactions: [row],
      states: [googleSubscriptionState(sub, purchaseToken, now)],
      postedTransactionId: row.transaction_id,
      ack: sub.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING" ? { kind: "subscription", productId, purchaseToken } : null,
      replaces: sub.linkedPurchaseToken ?? null,
    };
  }

  const p = await client.product(productId, purchaseToken);
  const order = await orderOrNull(client, p.orderId);
  const row = googleProductRow(p, purchaseToken, app, product, { order, now });
  if (!row) throw new PendingPurchase("The purchase is still pending.");
  return {
    transactions: [row],
    states: [],
    postedTransactionId: row.transaction_id,
    ack: p.acknowledgementState === 0 && product.type === "non_consumable" ? { kind: "product", productId, purchaseToken } : null,
    replaces: null,
  };
}

/** Acknowledges a purchase; on failure, queues it for the scheduled job. Never throws. */
export async function acknowledge(db: D1Database, client: GooglePlayClient, appId: string, ack: PlayAck) {
  try {
    if (ack.kind === "subscription") await client.acknowledgeSubscription(ack.productId, ack.purchaseToken);
    else await client.acknowledgeProduct(ack.productId, ack.purchaseToken);
    await db.prepare("DELETE FROM play_ack_pending WHERE purchase_token = ?").bind(ack.purchaseToken).run();
    return true;
  } catch (err) {
    await db
      .prepare(
        `INSERT INTO play_ack_pending (purchase_token, app_id, product_id, kind, attempts, last_error, created_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT (purchase_token) DO UPDATE SET attempts = attempts + 1, last_error = excluded.last_error`,
      )
      .bind(ack.purchaseToken, appId, ack.productId, ack.kind, String(err).slice(0, 500), Date.now())
      .run();
    return false;
  }
}

/** Marks the chain a new purchase replaces as upgraded, so it stops granting entitlements. */
export function markReplaced(db: D1Database, replacedToken: string) {
  return db
    .prepare("UPDATE store_transaction SET is_upgraded = 1 WHERE store = 'play_store' AND original_transaction_id = ?")
    .bind(replacedToken);
}
