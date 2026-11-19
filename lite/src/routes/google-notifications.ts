// Google Play Real-time Developer Notifications: POST /notifications/google, delivered by a
// Pub/Sub push subscription with authentication enabled.
//
// Notifications only say that something changed, so each one is followed by a Play Developer API
// call for the current state (Google recommends exactly this). Then, as for Apple: upsert the
// transaction, update the subscription status, emit webhook events, all in one D1 batch with the
// "processed" record (dedupe on Pub/Sub's messageId). Ownership isn't assigned here, except that
// a new purchase token linked to an owned one (upgrade, re-signup) inherits that owner.
//
// Responses: Pub/Sub redelivers anything that isn't a 2xx, for up to 7 days.
//   - 2xx once processed, already processed, or when retrying can't help (malformed message,
//     purchase token Google no longer knows).
//   - 401 for a missing or invalid push token.
//   - 5xx when the config doesn't know the app or product, or Google is unavailable.

import type { Context } from "hono";
import { Hono } from "hono/tiny";
import type { AppConfig } from "../config";
import type { AppEnv } from "../env";
import {
  assignOwner,
  type NewTransaction,
  notificationSeen,
  purchaseOwner,
  recordNotification,
  type TransactionRow,
  upsertSubscriptionState,
  upsertTransaction,
} from "../ledger";
import { GoogleIdTokenError, verifyGoogleIdToken } from "../lib/google-oidc";
import { invalidateOwnerSnapshot, refreshSnapshot } from "../snapshot";
import type { PlannedEvent } from "../stores/apple-events";
import { GoogleMappingError, googleProductRow, googleSubscriptionRow, googleSubscriptionState } from "../stores/google";
import { GoogleApiError } from "../stores/google-api";
import { googleOneTimePurchaseEvent, googleRefundEvent, googleSubscriptionEvents, PLAY_SUB } from "../stores/google-events";
import { acknowledge, GoogleApiNotConfigured, googleClientFor, markReplaced, type PlayAck } from "../stores/google-sync";
import { deliverNow, enqueueEvent, loadEventCustomer, webhooksFor } from "../webhooks";

export const googleNotifications = new Hono<AppEnv>();

type Ctx = Context<AppEnv>;
const reply = (c: Ctx, status: 200 | 400 | 401 | 500 | 503, message: string) => c.json({ message }, status);

interface DeveloperNotification {
  packageName?: string;
  eventTimeMillis?: string;
  subscriptionNotification?: { notificationType: number; purchaseToken: string };
  oneTimeProductNotification?: { notificationType: number; purchaseToken: string; sku: string };
  voidedPurchaseNotification?: { purchaseToken: string; orderId: string; productType?: number };
  testNotification?: object;
}

googleNotifications.post("/", async (c) => {
  const all = c.get("config");
  const playApps = [...all.apps.values()].filter((a) => a.store === "play_store" && a.googlePlayApi?.pubsubPushAccount);
  if (!playApps.length) return reply(c, 401, "No Google Play app has google_play_api.pubsub_push_account configured.");

  // 1. Authenticate the push before reading anything else.
  const auth = c.req.header("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return reply(c, 401, "Missing Pub/Sub push token.");
  const defaultAudience = new URL("/notifications/google", c.req.url).href;
  const audienceOf = (app: AppConfig) => app.googlePlayApi?.pubsubAudience ?? defaultAudience;
  let claims;
  try {
    claims = await verifyGoogleIdToken(auth.slice(7), [...new Set(playApps.map(audienceOf))], { fetch: c.get("deps").fetch });
  } catch (err) {
    if (err instanceof GoogleIdTokenError) return reply(c, 401, `Invalid Pub/Sub push token: ${err.message}`);
    throw err;
  }

  // 2. Unwrap the Pub/Sub message.
  const body = await c.req.json<{ message?: { data?: string; messageId?: string } }>().catch(() => null);
  const messageId = body?.message?.messageId;
  let n: DeveloperNotification;
  try {
    n = JSON.parse(atob(body?.message?.data ?? ""));
  } catch {
    // Redelivery can't fix a malformed message; acknowledge it so Pub/Sub stops retrying.
    console.error("Ignoring malformed Pub/Sub message", messageId);
    return reply(c, 200, "Ignored: malformed message.");
  }
  if (!messageId) return reply(c, 200, "Ignored: no messageId.");

  const app = playApps.find((a) => a.packageName === n.packageName);
  if (!app) {
    console.error(`Google notification for package ${n.packageName}, which no configured app has`);
    return reply(c, 500, `No app in the config has package ${n.packageName} with Pub/Sub push configured.`);
  }
  const config = all.projects.get(app.projectId)!;
  // The token must come from this app's push account, for this app's audience.
  if (claims.email !== app.googlePlayApi!.pubsubPushAccount || claims.aud !== audienceOf(app)) {
    return reply(c, 401, "The push token isn't from this app's Pub/Sub push account.");
  }

  const db = c.env.DB;
  if (await notificationSeen(db, "play_store", messageId)) return reply(c, 200, "Already processed.");
  const eventTime = Number(n.eventTimeMillis ?? Date.now());
  const kind = n.subscriptionNotification
    ? `SUBSCRIPTION_${n.subscriptionNotification.notificationType}`
    : n.oneTimeProductNotification
      ? `ONE_TIME_${n.oneTimeProductNotification.notificationType}`
      : n.voidedPurchaseNotification
        ? "VOIDED_PURCHASE"
        : n.testNotification
          ? "TEST"
          : "OTHER";
  const log = (token: string | null) =>
    recordNotification(db, {
      store: "play_store",
      notification_id: messageId,
      notification_type: kind,
      subtype: null,
      environment: "production",
      app_id: app.id,
      original_transaction_id: token,
      signed_at: eventTime,
      payload: body?.message?.data ?? "",
    });

  if (n.testNotification || kind === "OTHER") {
    await log(null).run();
    return reply(c, 200, "OK");
  }

  let client;
  try {
    client = googleClientFor(app, c.env, c.get("deps"));
  } catch (err) {
    if (err instanceof GoogleApiNotConfigured) return reply(c, 503, err.message);
    throw err;
  }

  // 3. Ask Google for the current state and plan the writes.
  const writes: D1PreparedStatement[] = [];
  let token = "";
  let row: NewTransaction | null = null;
  let planned: PlannedEvent[] = [];
  let ack: PlayAck | null = null;
  let replaces: string | null = null;
  try {
    if (n.subscriptionNotification) {
      const { notificationType: type } = n.subscriptionNotification;
      token = n.subscriptionNotification.purchaseToken;
      const sub = await client.subscription(token);
      const item = sub.lineItems?.[0];
      const product = item ? app.products.get(item.productId) : undefined;
      if (!item || !product) return reply(c, 500, `Product ${item?.productId} is not in the config.`);
      row = { ...googleSubscriptionRow(sub, token, app, product, { now: eventTime }), source: "notification" };
      if (type === PLAY_SUB.REVOKED) row = { ...row, revoked_at: eventTime, revocation_reason: "revoked" };
      writes.push(upsertTransaction(db, row), upsertSubscriptionState(db, googleSubscriptionState(sub, token, eventTime)));
      replaces = sub.linkedPurchaseToken ?? null;
      if (replaces) writes.push(markReplaced(db, replaces));
      if (type === PLAY_SUB.PURCHASED && sub.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING") {
        ack = { kind: "subscription", productId: product.id, purchaseToken: token };
      }
      const previous = await db
        .prepare(
          `SELECT period_type, product_id, base_plan_id FROM store_transaction WHERE store = 'play_store'
           AND original_transaction_id IN (?, ?) AND transaction_id != ? ORDER BY purchased_at DESC LIMIT 1`,
        )
        .bind(token, replaces ?? token, row.transaction_id)
        .first<{ period_type: string; product_id: string; base_plan_id: string | null }>();
      planned = googleSubscriptionEvents(type, messageId, sub, row as TransactionRow, {
        previousPeriodType: previous?.period_type,
        replacedProductId: replaces && previous ? `${previous.product_id}:${previous.base_plan_id}` : null,
      });
    } else if (n.oneTimeProductNotification) {
      const { notificationType: type, sku } = n.oneTimeProductNotification;
      token = n.oneTimeProductNotification.purchaseToken;
      const product = app.products.get(sku);
      if (!product) return reply(c, 500, `Product ${sku} is not in the config.`);
      const p = await client.product(sku, token);
      row = googleProductRow(p, token, app, product, { now: eventTime });
      if (row) {
        row = { ...row, source: "notification" };
        writes.push(upsertTransaction(db, row));
        if (type === 1 && p.acknowledgementState === 0 && product.type === "non_consumable") ack = { kind: "product", productId: sku, purchaseToken: token };
        planned = row.revoked_at !== null ? [googleRefundEvent(row as TransactionRow)] : type === 1 ? [googleOneTimePurchaseEvent(row as TransactionRow)] : [];
      }
    } else {
      // Voided purchase: the notification identifies the order; mark it refunded.
      const v = n.voidedPurchaseNotification!;
      token = v.purchaseToken;
      const existing = await db
        .prepare("SELECT * FROM store_transaction WHERE store = 'play_store' AND transaction_id = ?")
        .bind(v.orderId)
        .first<TransactionRow>();
      if (existing) {
        row = { ...existing, revoked_at: existing.revoked_at ?? eventTime, revocation_reason: "voided", source: "notification" } as NewTransaction;
        writes.push(
          db.prepare("UPDATE store_transaction SET revoked_at = coalesce(revoked_at, ?), revocation_reason = 'voided', updated_at = ? WHERE store = 'play_store' AND transaction_id = ?")
            .bind(eventTime, Date.now(), v.orderId),
        );
        planned = [googleRefundEvent(row as TransactionRow)];
      }
    }
  } catch (err) {
    if (err instanceof GoogleApiError && err.notFound) {
      await log(null).run();
      return reply(c, 200, "Ignored: Google no longer knows this purchase.");
    }
    if (err instanceof GoogleApiError) return reply(c, err.retryable ? 503 : 500, err.message);
    if (err instanceof GoogleMappingError) return reply(c, 500, err.message);
    throw err;
  }

  // 4. Ownership: a new purchase token linked to an owned one (plan change, re-signup) inherits
  // that owner, so the customer keeps access without waiting for the app.
  let owner = await purchaseOwner(db, "play_store", token);
  if (!owner && replaces && row) {
    const previousOwner = await purchaseOwner(db, "play_store", replaces);
    if (previousOwner) {
      writes.push(assignOwner(db, row, previousOwner.id));
      owner = previousOwner;
    }
  }
  writes.push(invalidateOwnerSnapshot(db, "play_store", token));

  // 5. Webhook events (only with an owner: there's no app user to report otherwise).
  const eventIds: string[] = [];
  const wanted = row ? planned.filter((e) => webhooksFor(config, e.type, row!.environment).length) : [];
  if (owner && row && wanted.length) {
    const customer = await loadEventCustomer(db, [owner.id], owner.id);
    for (const e of wanted) {
      const { id, statements } = await enqueueEvent(db, config, {
        ...e,
        appId: app.id,
        environment: row.environment,
        store: "play_store",
        customer,
        transaction: row as TransactionRow,
      });
      eventIds.push(id);
      writes.push(...statements);
    }
  }

  writes.push(log(token));
  await db.batch(writes);

  const deps = c.get("deps");
  if (eventIds.length) c.executionCtx.waitUntil(deliverNow(c.env, all, deps.fetch ?? fetch, eventIds));
  if (owner) c.executionCtx.waitUntil(refreshSnapshot(db, all, owner.id));
  // Safety net: acknowledge purchases the app hasn't (Google refunds them after 3 days).
  if (ack) c.executionCtx.waitUntil(acknowledge(db, client, app.id, ack));
  return reply(c, 200, "OK");
});
