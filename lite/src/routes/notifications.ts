// App Store Server Notifications V2: POST /notifications/apple, body {"signedPayload": "<JWS>"}.
//
// Every notification carries Apple's latest signed transaction and renewal info for one
// subscription (or one-time purchase), plus a status code. Rather than special-casing each of
// Apple's ~20 notification types, we verify all three signatures and apply what they say:
//   - the transaction is upserted into the ledger (renewals add rows; refunds, revocations and
//     upgrades update existing ones);
//   - the renewal info becomes the subscription's status (auto-renew, billing retry, grace
//     period), applied only if it's newer than what's stored, since delivery order isn't
//     guaranteed.
// Ownership never changes here: a notification can arrive before the app posts the purchase,
// and the SDK's POST /receipts assigns the owner when it does.
//
// Responses: Apple retries anything other than 200 (production: after about 1, 12, 24, 48 and
// 72 hours). So:
//   - 200 once processed, and for a notification we've already processed;
//   - 400 for a bad signature or malformed body, which retrying won't fix;
//   - 5xx when our config doesn't know the app or product, so Apple retries after the
//     operator fixes the config.

import { type Context, Hono } from "hono";
import type { AppConfig } from "../config";
import type { AppEnv } from "../env";
import {
  type NewTransaction,
  notificationSeen,
  purchaseOwner,
  recordNotification,
  upsertSubscriptionState,
  upsertTransaction,
} from "../ledger";
import { AppleJwsError, verifyAppleJws } from "../lib/apple-jws";
import { d1ChainStore } from "../lib/chain-store-d1";
import {
  type AppleNotification,
  type AppleRenewalInfo,
  type AppleTransaction,
  AppleMappingError,
  appleSubscriptionState,
  appleTransactionRow,
} from "../stores/apple";
import { appleNotificationEvents } from "../stores/apple-events";
import { deliverNow, enqueueEvent, loadEventCustomer, webhooksFor } from "../webhooks";

export const notifications = new Hono<AppEnv>();

type Ctx = Context<AppEnv>;
const reply = (c: Ctx, status: 200 | 400 | 500, message: string) => c.json({ message }, status);

notifications.post("/apple", async (c) => {
  const body = await c.req.json<{ signedPayload?: unknown }>().catch(() => null);
  if (typeof body?.signedPayload !== "string") return reply(c, 400, "Expected {\"signedPayload\": \"...\"}.");
  const signedPayload = body.signedPayload;

  const { appleRoots } = c.get("deps");
  const verify = <T>(jws: string) => verifyAppleJws<T>(jws, { trustedRoots: appleRoots, store: d1ChainStore(c.env.DB) });

  let notification: AppleNotification;
  try {
    notification = await verify<AppleNotification>(signedPayload);
  } catch (err) {
    if (err instanceof AppleJwsError) return reply(c, 400, `Invalid notification: ${err.message}`);
    throw err;
  }
  if (!notification.notificationUUID || !notification.notificationType) {
    return reply(c, 400, "Notification is missing notificationUUID or notificationType.");
  }

  const db = c.env.DB;
  if (await notificationSeen(db, "app_store", notification.notificationUUID)) return reply(c, 200, "Already processed.");

  const data = notification.data ?? {};
  const environment = data.environment === "Production" ? "production" : "sandbox";
  const app = data.bundleId ? appForBundle(c, data.bundleId) : undefined;
  if (data.bundleId && !app) {
    console.error(`Apple notification for bundle ${data.bundleId}, which no app in the config has`);
    return reply(c, 500, `No app in the config has bundle ID ${data.bundleId}.`);
  }

  let tx: AppleTransaction | undefined;
  let renewal: AppleRenewalInfo | undefined;
  try {
    if (data.signedTransactionInfo) tx = await verify<AppleTransaction>(data.signedTransactionInfo);
    if (data.signedRenewalInfo) renewal = await verify<AppleRenewalInfo>(data.signedRenewalInfo);
  } catch (err) {
    if (err instanceof AppleJwsError) return reply(c, 400, `Invalid signed data in notification: ${err.message}`);
    throw err;
  }

  const writes: D1PreparedStatement[] = [];
  let row: NewTransaction | undefined;
  if (tx && app) {
    const product = app.products.get(tx.productId);
    if (!product) {
      console.error(`Apple notification for product ${tx.productId}, which app ${app.id} doesn't list`);
      return reply(c, 500, `Product ${tx.productId} is not in the config.`);
    }
    try {
      row = { ...appleTransactionRow(tx, app, product), source: "notification" };
      writes.push(upsertTransaction(db, row));
    } catch (err) {
      if (err instanceof AppleMappingError) return reply(c, 500, err.message);
      throw err;
    }
  }

  // Webhook events, in the same batch as the ledger change. A purchase nobody owns yet has no
  // app user to report; the SDK's POST /v1/receipts produces its purchase event when it arrives.
  const eventIds: string[] = [];
  const { config } = c.get("deps");
  if (row && app && config.webhooks.length) {
    const owner = await purchaseOwner(db, "app_store", row.original_transaction_id);
    const previous =
      notification.notificationType === "DID_RENEW" || notification.subtype === "RESUBSCRIBE"
        ? await db
            .prepare(
              `SELECT period_type FROM store_transaction WHERE store = 'app_store' AND original_transaction_id = ?
               AND transaction_id != ? ORDER BY purchased_at DESC LIMIT 1`,
            )
            .bind(row.original_transaction_id, row.transaction_id)
            .first<{ period_type: string }>()
        : null;
    const planned = appleNotificationEvents(notification, row, renewal, { previousPeriodType: previous?.period_type });
    const wanted = planned.filter((e) => webhooksFor(config, e.type, row!.environment).length);
    if (owner && wanted.length) {
      const customer = await loadEventCustomer(db, [owner.id], owner.id);
      for (const e of wanted) {
        const { id, statements } = enqueueEvent(db, config, {
          ...e,
          appId: app.id,
          environment: row.environment,
          store: "app_store",
          customer,
          transaction: row,
        });
        eventIds.push(id);
        writes.push(...statements);
      }
    }
  }
  if (renewal) writes.push(upsertSubscriptionState(db, appleSubscriptionState(renewal, data.status)));
  writes.push(
    recordNotification(db, {
      store: "app_store",
      notification_id: notification.notificationUUID,
      notification_type: notification.notificationType,
      subtype: notification.subtype ?? null,
      environment,
      app_id: app?.id ?? null,
      original_transaction_id: tx ? String(tx.originalTransactionId) : (renewal?.originalTransactionId ?? null),
      signed_at: notification.signedDate,
      payload: signedPayload,
    }),
  );
  // One D1 batch is one transaction: the ledger update, its webhook events and the "processed"
  // record land together.
  await db.batch(writes);
  if (eventIds.length) c.executionCtx.waitUntil(deliverNow(c.env, config, c.get("deps").fetch ?? fetch, eventIds));
  return reply(c, 200, "OK");
});

function appForBundle(c: Ctx, bundleId: string): AppConfig | undefined {
  for (const app of c.get("deps").config.apps.values()) {
    if (app.store === "app_store" && app.bundleId === bundleId) return app;
  }
  return undefined;
}
