// The RevenueCat-compatible SDK API.
//
// Wire rules from spec/sdk-wire-contract.md:
//   - Never answer 304; always 200 with a full body (iOS can re-queue a 304 forever).
//   - Every error has a JSON body {code, message} with Content-Type application/json, or
//     Android treats it as a connection failure.
//   - On /receipts, a 4xx makes the device finish (iOS) or acknowledge (Android) the purchase.
//     Anything retryable, including our own config mistakes, must be a 5xx so the purchase
//     stays queued on the device.
//   - Remote config gets 204, which both SDKs read as "not modified".
//   - User IDs arrive percent-encoded on Android and raw ($, :) on iOS; Hono decodes both.

import type { Context } from "hono";
import { Hono } from "hono/tiny";
import { type AttributeUpdate, enforceCustomLimit, parseAttributes, readAttributes, writeAttributes } from "../attributes";
import type { AppConfig } from "../config";
import { renderCustomerInfo } from "../customer-info";
import { introEligibility } from "../intro-eligibility";
import type { AppEnv } from "../env";
import {
  addAlias,
  assignOwner,
  ensureCustomer,
  findCustomer,
  isAnonymous,
  loadCustomer,
  mergeCustomers,
  type NewTransaction,
  purchaseOwners,
  upsertSubscriptionState,
  upsertTransaction,
} from "../ledger";
import { AppleJwsError, verifyAppleJws } from "../lib/apple-jws";
import { d1ChainStore } from "../lib/chain-store-d1";
import { cloudflareRateLimiters } from "../lib/rate-limit";
import { AppleMappingError, type AppleTransaction, appleTransactionRow, type SubscriptionStateUpdate } from "../stores/apple";
import { AppleApiError } from "../stores/apple-api";
import { receiptPurchaseEvents } from "../stores/apple-events";
import { SECRET_KEY_PREFIX, touchSecretKey, verifySecretKey } from "../secret-keys";
import { invalidateSnapshot, readCustomerInfo, refreshSnapshot } from "../snapshot";
import { deliverNow, enqueueEvent, loadEventCustomer, webhooksFor } from "../webhooks";
import { InvalidReceiptError, parseAppReceipt, transactionIdFromAppReceipt } from "../stores/apple-receipt";
import { GoogleMappingError } from "../stores/google";
import { GoogleApiError } from "../stores/google-api";
import {
  acknowledge,
  GoogleApiNotConfigured,
  googleClientFor,
  markReplaced,
  PendingPurchase,
  type PlayAck,
  verifyPlayPurchase,
} from "../stores/google-sync";
import { AppleApiNotConfigured, appleClients, syncFromTransactionId, syncStatuses } from "../stores/apple-sync";

type Ctx = Context<AppEnv>;

// Backend error codes the SDKs recognize (iOS BackendErrorCode.swift, Android errors.kt).
const UNKNOWN_ERROR = 0;
const INVALID_RECEIPT = 7103;
const INTERNAL_SERVER_ERROR = 7110;
const INVALID_API_KEY = 7225;
const BAD_REQUEST = 7226;
const INVALID_SUBSCRIBER_ATTRIBUTES = 7263;

/** Unverified (development) subscriptions last this long, since nothing tells us the real expiry. */
const UNVERIFIED_SUBSCRIPTION_MS = 30 * 864e5;

export const sdk = new Hono<AppEnv>();

const error = (c: Ctx, status: 400 | 401 | 403 | 404 | 500 | 503, code: number, message: string) =>
  c.json({ code, message }, status);

// Unauthenticated, iOS DEBUG builds of the SDK only. Failures are ignored by the SDK.
sdk.get("/subscribers/:id/health_report_availability", (c) => c.json({ report_logs: false }));

/**
 * Over a rate limit. /receipts answers 503, never 429: a 4xx there makes Android acknowledge the
 * purchase as handled, so it would never be retried. 503 keeps it queued on the device.
 */
function rateLimited(c: Ctx) {
  c.header("Retry-After", "60");
  if (c.req.path.endsWith("/receipts")) {
    return error(c, 503, INTERNAL_SERVER_ERROR, "Too many requests; the purchase will be retried.");
  }
  return c.json({ code: UNKNOWN_ERROR, message: "Too many requests." }, 429);
}

const bearer = (c: Ctx) => {
  const auth = c.req.header("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
};
const limitersFor = (c: Ctx) => (c.get("deps").rateLimiters ?? cloudflareRateLimiters)(c.env);

// Per client IP, before the key check, so it also slows down anyone guessing keys. Secret-key
// requests are exempt here (a backend often calls from one IP); their failures count below.
sdk.use("*", async (c, next) => {
  if (bearer(c).startsWith(SECRET_KEY_PREFIX)) return next();
  const ip = c.req.header("cf-connecting-ip");
  const limiter = limitersFor(c).ip;
  if (limiter && ip && !(await limiter.allow(ip))) return rateLimited(c);
  await next();
});

// The key identifies the caller and its project. A public SDK key identifies the app (and so the
// store and project). A secret key identifies a server, which may only read its project's customers.
sdk.use("*", async (c, next) => {
  const key = bearer(c);
  if (key.startsWith(SECRET_KEY_PREFIX)) {
    const secret = await verifySecretKey(c.env.DB, key);
    if (!secret) {
      const ip = c.req.header("cf-connecting-ip");
      const limiter = limitersFor(c).ip;
      if (limiter && ip && !(await limiter.allow(ip))) return rateLimited(c);
      return error(c, 401, INVALID_API_KEY, "Invalid API key.");
    }
    if (c.req.method !== "GET" || !/^\/v1\/subscribers\/[^/]+$/.test(c.req.path)) {
      return error(c, 403, INVALID_API_KEY, "Secret keys can only read customers: GET /v1/subscribers/{app_user_id}.");
    }
    const project = c.get("config").projects.get(secret.projectId);
    if (!project) return error(c, 401, INVALID_API_KEY, "This key's project no longer exists.");
    c.set("secretKey", secret);
    c.set("project", project);
    const touch = touchSecretKey(c.env.DB, secret);
    if (touch) c.executionCtx.waitUntil(touch.run());
    return next();
  }
  const config = c.get("config");
  const app = key ? config.keys.get(key) : undefined;
  if (!app) return error(c, 401, INVALID_API_KEY, "Invalid API key.");
  c.set("app", app);
  c.set("project", config.projects.get(app.projectId)!);
  await next();
});

// Per app user ID: one user hammering the server (a runaway retry loop, say) can't use up the
// whole app's budget. The SDK key is shared by every user of an app, so it can't be the key.
sdk.use("*", async (c, next) => {
  const limiter = limitersFor(c).user;
  if (!limiter) return next();
  let userId = /\/subscribers\/([^/]+)/.exec(c.req.path)?.[1];
  if (userId === "identify") userId = undefined;
  if (!userId && c.req.method === "POST") {
    // Hono caches the parsed body, so the route handler can still read it.
    const body = await c.req.json<{ app_user_id?: unknown }>().catch(() => null);
    if (typeof body?.app_user_id === "string") userId = body.app_user_id;
  }
  const caller = c.get("secretKey")?.id ?? c.get("app").id;
  if (userId && !(await limiter.allow(`${caller}:${safeDecode(userId)}`))) return rateLimited(c);
  await next();
});

// One D1 query when the customer's snapshot is current (src/snapshot.ts). Never a 304: the SDK
// may have nothing cached to fall back on (spec/sdk-wire-contract.md).
sdk.get("/subscribers/:id", async (c) => {
  const secret = c.get("secretKey");
  if (secret) return serverCustomerInfo(c, c.req.param("id"));
  const { body, etag } = await readCustomerInfo(c.env.DB, c.get("project"), c.req.param("id"), {
    requestStore: c.get("app").store,
  });
  if (etag) c.header("ETag", etag);
  return c.json(body);
});

/**
 * Server-to-server read (secret key): the same CustomerInfo plus subscriber_attributes, which
 * RevenueCat also returns only to secret keys. Supports If-None-Match. Attribute changes don't
 * rebuild snapshots, so this ETag covers both the CustomerInfo and the attributes.
 */
async function serverCustomerInfo(c: Ctx, appUserId: string) {
  const secret = c.get("secretKey")!;
  if (!secret.scopes.has("customers:read")) return error(c, 403, INVALID_API_KEY, "This key lacks the customers:read scope.");
  const db = c.env.DB;
  const { body, customerId } = await readCustomerInfo(db, c.get("project"), appUserId);
  const attributes = customerId ? await readAttributes(db, customerId) : {};
  const subscriber = { ...body.subscriber, subscriber_attributes: attributes };
  const { last_seen: _lastSeen, ...stable } = subscriber;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(stable))));
  const etag = `"${Array.from(digest.subarray(0, 12), (b) => b.toString(16).padStart(2, "0")).join("")}"`;
  c.header("ETag", etag);
  const ifNoneMatch = c.req.header("if-none-match");
  if (ifNoneMatch && ifNoneMatch.split(",").some((t) => t.trim() === etag)) return c.body(null, 304);
  return c.json({ ...body, subscriber });
}

sdk.post("/receipts", async (c) => {
  const body = await c.req.json<ReceiptBody>().catch(() => null);
  if (!body?.app_user_id || !body.fetch_token) {
    return error(c, 400, BAD_REQUEST, "app_user_id and fetch_token are required.");
  }
  const app = c.get("app");
  const result = app.store === "app_store" ? await appleReceipt(c, body, app) : await googleReceipt(c, body, app);
  if ("status" in result) return error(c, result.status, result.code, result.message);

  // Unsynced attributes ride along with receipts. Invalid ones are skipped: they must never
  // fail a purchase.
  const { updates } = parseAttributes(body.attributes);
  const extra = result.replaces ? [markReplaced(c.env.DB, result.replaces)] : [];
  const customerId = await recordForCustomer(c, body.app_user_id, result.transactions, result.states, updates, extra);
  // Google Play: acknowledge after recording, so a failure here never loses the purchase.
  if (result.ack) {
    const { ack } = result;
    c.executionCtx.waitUntil(acknowledge(c.env.DB, googleClientFor(app, c.env, c.get("deps")), app.id, ack));
  }

  // Rebuild the snapshot now and answer with it, so the device gets exactly what reads will serve.
  const info = await freshCustomerInfo(c, customerId, body.app_user_id);
  const posted = result.transactions.find((t) => t.transaction_id === result.postedTransactionId);
  if (app.store === "play_store" && posted) {
    // Android consumes a purchase only when told to (spec/sdk-wire-contract.md, rule 5).
    return c.json({ ...info, purchased_products: { [posted.product_id]: { should_consume: posted.product_type === "consumable" } } });
  }
  return c.json(info);
});

/**
 * Writes transactions and status for the customer who posted them, applying RevenueCat's
 * default restore behavior ("transfer to new App User ID") per purchase chain: a chain owned
 * by an anonymous user merges that user in; a chain owned by a named user transfers.
 */
async function recordForCustomer(
  c: Ctx,
  appUserId: string,
  transactions: NewTransaction[],
  states: SubscriptionStateUpdate[],
  attributes: Map<string, AttributeUpdate> = new Map(),
  extraWrites: D1PreparedStatement[] = [],
) {
  const db = c.env.DB;
  const project = c.get("project");
  const customer = await ensureCustomer(db, project.id, appUserId);
  if (attributes.size) await enforceCustomLimit(db, customer.id, attributes);
  const chains = new Map(transactions.map((t) => [t.original_transaction_id, t]));
  const store = transactions[0]?.store;
  const owners = store ? await purchaseOwners(db, store, [...chains.keys()]) : new Map();

  const writes: D1PreparedStatement[] = [];
  const merged = new Set<string>();
  for (const owner of owners.values()) {
    // A purchase chain belongs to one app, so its owner is always in this project; never merge across projects.
    if (owner.id !== customer.id && owner.anonymousOnly && owner.projectId === customer.projectId && !merged.has(owner.id)) {
      merged.add(owner.id);
      writes.push(...mergeCustomers(db, owner.id, customer.id));
    }
  }
  for (const t of transactions) writes.push(upsertTransaction(db, t));
  for (const t of chains.values()) writes.push(assignOwner(db, t, customer.id));
  for (const s of states) writes.push(upsertSubscriptionState(db, s));
  if (attributes.size) writes.push(writeAttributes(db, customer.id, attributes));
  writes.push(...extraWrites);
  // Snapshots of everyone whose CustomerInfo changes: this customer, and anyone losing a purchase.
  const affected = new Set([customer.id, ...[...owners.values()].map((o) => o.id)]);
  for (const id of affected) if (!merged.has(id)) writes.push(invalidateSnapshot(db, id));

  // Webhook events, in the same batch: purchase events for recent transactions, and TRANSFER
  // when a named user loses a purchase to this customer.
  const eventIds: string[] = [];
  const config = project;
  const app = c.get("app");
  if (config.webhooks.length && transactions.length) {
    const now = Date.now();
    const planned = transactions.flatMap((t) => receiptPurchaseEvents(t, now).map((e) => ({ e, t })));
    const losers = [...new Map([...owners.values()].filter((o) => o.id !== customer.id && !o.anonymousOnly).map((o) => [o.id, o])).values()];
    const env = transactions[0]!.environment;
    const wantsTransfer = losers.length > 0 && webhooksFor(config, "TRANSFER", env).length > 0;
    const wanted = planned.filter(({ e, t }) => webhooksFor(config, e.type, t.environment).length);
    if (wanted.length || wantsTransfer) {
      // Customer details as they'll be once this batch lands (anonymous owners merged in).
      const eventCustomer = await loadEventCustomer(db, [customer.id, ...merged], customer.id, appUserId);
      // Attributes sent with this receipt are written in the same batch, so apply them here too.
      for (const [key, u] of attributes) {
        const current = eventCustomer.attributes[key];
        if (current && current.updated_at_ms >= u.updatedAt) continue;
        if (u.value === null) delete eventCustomer.attributes[key];
        else eventCustomer.attributes[key] = { value: u.value, updated_at_ms: u.updatedAt };
      }
      for (const { e, t } of wanted) {
        const { id, statements } = await enqueueEvent(db, config, { ...e, appId: app.id, environment: t.environment, store: t.store, customer: eventCustomer, transaction: t, now });
        eventIds.push(id);
        writes.push(...statements);
      }
      for (const loser of wantsTransfer ? losers : []) {
        const from = await loadEventCustomer(db, [loser.id], loser.id);
        const { id, statements } = await enqueueEvent(db, config, {
          type: "TRANSFER",
          dedupeKey: `transfer:${store}:${loser.id}:${customer.id}:${now}`,
          appId: app.id,
          environment: env,
          store: store!,
          customer: eventCustomer,
          extra: { transferred_from: from.aliases, transferred_to: eventCustomer.aliases },
          now,
        });
        eventIds.push(id);
        writes.push(...statements);
      }
    }
  }

  if (writes.length) await db.batch(writes);
  if (eventIds.length) c.executionCtx.waitUntil(deliverNow(c.env, c.get("config"), c.get("deps").fetch ?? fetch, eventIds));
  // Customers who lost a purchase get fresh snapshots in the background.
  const others = [...affected].filter((id) => id !== customer.id && !merged.has(id));
  if (others.length) c.executionCtx.waitUntil(Promise.all(others.map((id) => refreshSnapshot(db, c.get("config"), id))));
  return customer.id;
}

// logIn. 201 tells the SDK the user was created; 200 that it already existed.
sdk.post("/subscribers/identify", async (c) => {
  const body = await c.req.json<{ app_user_id?: string; new_app_user_id?: string }>().catch(() => null);
  const current = body?.app_user_id;
  const next = body?.new_app_user_id;
  if (!current || !next) return error(c, 400, BAD_REQUEST, "app_user_id and new_app_user_id are required.");

  const db = c.env.DB;
  const projectId = c.get("project").id;
  const [from, to] = await Promise.all([findCustomer(db, projectId, current), findCustomer(db, projectId, next)]);
  let created = false;
  let customerId: string;
  if (to) {
    // Logging in to an existing account: an anonymous user's purchases come along.
    if (from && from.id !== to.id && isAnonymous(current)) await db.batch(mergeCustomers(db, from.id, to.id));
    customerId = to.id;
  } else if (from && isAnonymous(current)) {
    // A new ID for an anonymous user who already exists: alias it, keeping their purchases.
    await addAlias(db, projectId, next, from.id).run();
    customerId = from.id;
    created = true;
  } else {
    customerId = (await ensureCustomer(db, projectId, next)).id;
    created = true;
  }
  return c.json(await freshCustomerInfo(c, customerId, next), created ? 201 : 200);
});

// Android only: Block Store recovery of an anonymous ID. Body is ignored by the SDK.
sdk.post("/subscribers/:id/alias", (c) => c.json({}));

sdk.get("/subscribers/:id/offerings", (c) => {
  const config = c.get("project");
  const app = c.get("app");
  return c.json({
    current_offering_id: config.currentOffering,
    offerings: config.offerings.map((o) => ({
      identifier: o.id,
      description: o.description,
      metadata: o.metadata,
      packages: o.packages.flatMap((p) => {
        const ref = p.products.get(app.id);
        if (!ref) return [];
        return [
          {
            identifier: p.id,
            platform_product_identifier: ref.productId,
            ...(ref.basePlanId ? { platform_product_plan_identifier: ref.basePlanId } : {}),
          },
        ];
      }),
    })),
    placements: null,
    targeting: null,
  });
});

// Lets the SDK compute entitlements offline when the server is down.
sdk.get("/product_entitlement_mapping", (c) => {
  const config = c.get("project");
  const app = c.get("app");
  const mapping: Record<string, { product_identifier: string; base_plan_id: string | null; entitlements: string[] }> = {};
  const add = (productId: string, basePlanId: string | null, entitlement: string) => {
    const key = basePlanId ? `${productId}:${basePlanId}` : productId;
    const entry = (mapping[key] ??= { product_identifier: productId, base_plan_id: basePlanId, entitlements: [] });
    if (!entry.entitlements.includes(entitlement)) entry.entitlements.push(entitlement);
  };
  for (const e of config.entitlements) {
    for (const ref of e.products.get(app.id) ?? []) {
      const product = app.products.get(ref.productId)!;
      // "pro" on a Play subscription means every base plan; list them when the config names them.
      const plans = ref.basePlanId ? [ref.basePlanId] : product.basePlans.length ? product.basePlans : [null];
      for (const plan of plans) add(ref.productId, plan, e.id);
    }
  }
  return c.json({ product_entitlement_mapping: mapping });
});

// The SDK marks attributes synced on 2xx or any 4xx except 404, and retries on 5xx or 404.
// Valid attributes are stored even when others in the same request are invalid; the invalid
// ones are reported with 400 / 7263, which also stops the SDK retrying them.
sdk.post("/subscribers/:id/attributes", async (c) => {
  const body = await c.req.json<{ attributes?: unknown }>().catch(() => null);
  if (!body) return error(c, 400, BAD_REQUEST, "Expected a JSON body with attributes.");
  const { updates, errors } = parseAttributes(body.attributes);
  if (updates.size) {
    const db = c.env.DB;
    const customer = await ensureCustomer(db, c.get("project").id, c.req.param("id"));
    errors.push(...(await enforceCustomLimit(db, customer.id, updates)));
    if (updates.size) await writeAttributes(db, customer.id, updates).run();
  }
  if (errors.length) {
    return c.json({ code: INVALID_SUBSCRIBER_ATTRIBUTES, message: "Some subscriber attributes are invalid.", attribute_errors: errors }, 400);
  }
  return c.json({});
});

// iOS, StoreKit 1 path only: true, false or null (unknown) per product. Read-only.
sdk.post("/subscribers/:id/intro_eligibility", async (c) => {
  const body = await c.req.json<{ product_identifiers?: unknown; fetch_token?: unknown }>().catch(() => null);
  const requested = Array.isArray(body?.product_identifiers)
    ? body.product_identifiers.filter((id): id is string => typeof id === "string").slice(0, 100)
    : [];
  let receiptProductIds: string[] = [];
  if (typeof body?.fetch_token === "string" && body.fetch_token) {
    try {
      receiptProductIds = parseAppReceipt(body.fetch_token).productIds;
    } catch {
      // A malformed receipt just means we know less; the answer may be null.
    }
  }
  const { transactions } = await loadCustomer(c.env.DB, c.get("project").id, c.req.param("id"));
  return c.json(
    await introEligibility({
      db: c.env.DB,
      app: c.get("app"),
      requested,
      history: transactions.filter((t) => t.store === "app_store"),
      receiptProductIds,
    }),
  );
});

// Remote config: 204 = not modified. Without config, diagnostics stay off (the default).
sdk.post("/config/:domain", (c) => c.body(null, 204));

// Fire-and-forget. 2xx clears the SDK's queue; 404/5xx would make it retry forever.
sdk.post("/events", (c) => c.json({}));
sdk.post("/diagnostics", (c) => c.json({}));

sdk.all("*", (c) => error(c, 404, UNKNOWN_ERROR, `Not implemented: ${c.req.method} ${new URL(c.req.url).pathname}`));

// ---------------------------------------------------------------------------------------

interface ReceiptBody {
  app_user_id?: string;
  fetch_token?: string;
  is_restore?: boolean;
  attributes?: unknown;
  // iOS
  product_id?: string;
  transaction_id?: string;
  // Android
  product_ids?: string[];
  platform_product_ids?: { product_id: string; base_plan_id?: string | null }[];
}

type Failure = { status: 400 | 500 | 503; code: number; message: string };
interface Receipt {
  transactions: NewTransaction[];
  states: SubscriptionStateUpdate[];
  /** The transaction the device posted, when there is exactly one. */
  postedTransactionId?: string;
  /** Google Play: a purchase still to acknowledge, and the purchase token this one replaces. */
  ack?: PlayAck | null;
  replaces?: string | null;
}

async function appleReceipt(c: Ctx, body: ReceiptBody, app: AppConfig): Promise<Receipt | Failure> {
  const token = body.fetch_token!;
  // StoreKit 2 sends one signed transaction (a JWS). StoreKit 1 sends the whole app receipt.
  if (token.split(".").length !== 3) return storeKit1Receipt(c, token, app);

  let tx: AppleTransaction;
  try {
    tx = await verifyAppleJws<AppleTransaction>(token, {
      trustedRoots: c.get("deps").appleRoots,
      store: d1ChainStore(c.env.DB),
    });
  } catch (err) {
    // A bad signature won't get better on retry: 4xx lets StoreKit finish the transaction.
    if (err instanceof AppleJwsError) return { status: 400, code: INVALID_RECEIPT, message: `Invalid transaction: ${err.message}` };
    throw err;
  }

  const product = app.products.get(tx.productId);
  if (!product) {
    // 5xx, not 4xx: a missing product is a config mistake, and the purchase must not be lost.
    return { status: 500, code: INTERNAL_SERVER_ERROR, message: `Product ${tx.productId} is not in the config.` };
  }
  let row: NewTransaction;
  try {
    row = appleTransactionRow(tx, app, product);
  } catch (err) {
    // Bundle or type mismatch: most likely the config, so keep the purchase queued.
    if (err instanceof AppleMappingError) return { status: 500, code: INTERNAL_SERVER_ERROR, message: err.message };
    throw err;
  }
  const receipt: Receipt = { transactions: [row], states: [], postedTransactionId: row.transaction_id };

  // On restore, the device's view may be stale (a refund or lapse it hasn't seen), so ask Apple
  // for the current status of every subscription. Best effort: the verified transaction
  // already stands on its own.
  if (body.is_restore && app.appStoreServerApi) {
    try {
      const sync = await syncStatuses(appleClients(app, c.env, c.get("deps"))[row.environment], app, row.transaction_id);
      const seen = new Set([row.transaction_id]);
      receipt.transactions.push(...sync.transactions.filter((t) => !seen.has(t.transaction_id)));
      receipt.states.push(...sync.states);
    } catch (err) {
      console.error("Restore status refresh failed:", err);
    }
  }
  return receipt;
}

/**
 * StoreKit 1: the app receipt isn't trusted. We pull one transaction ID out of it and ask the
 * App Store Server API for the customer's purchases; Apple's answer is what we record.
 */
async function storeKit1Receipt(c: Ctx, receiptBase64: string, app: AppConfig): Promise<Receipt | Failure> {
  let clients;
  try {
    clients = appleClients(app, c.env, c.get("deps"));
  } catch (err) {
    // 5xx keeps the purchase on the device until the operator adds the API key.
    if (err instanceof AppleApiNotConfigured) return { status: 503, code: INTERNAL_SERVER_ERROR, message: `StoreKit 1 receipt: ${err.message}` };
    throw err;
  }

  let transactionId: string | null;
  try {
    transactionId = transactionIdFromAppReceipt(receiptBase64);
  } catch (err) {
    if (err instanceof InvalidReceiptError) return { status: 400, code: INVALID_RECEIPT, message: `Invalid receipt: ${err.message}` };
    throw err;
  }
  // A receipt with no in-app purchases: nothing to record.
  if (!transactionId) return { transactions: [], states: [] };

  try {
    const sync = await syncFromTransactionId(clients, app, transactionId);
    if (sync.skipped.length) console.warn(`App ${app.id}: Apple returned products not in the config: ${sync.skipped.join(", ")}`);
    return { transactions: sync.transactions, states: sync.states };
  } catch (err) {
    if (err instanceof AppleApiError) {
      // Unknown in both environments: the receipt doesn't describe a real purchase.
      if (err.notFound) return { status: 400, code: INVALID_RECEIPT, message: "Apple doesn't recognize this receipt's transactions." };
      // Rate limits and Apple outages: keep the purchase queued and retry later.
      if (err.retryable) return { status: 503, code: INTERNAL_SERVER_ERROR, message: "The App Store is unavailable; try again later." };
      // 401 and similar: a credentials problem on our side, so keep the purchase queued.
      console.error(err);
      return { status: 500, code: INTERNAL_SERVER_ERROR, message: `App Store Server API error ${err.status}; check the API key settings.` };
    }
    throw err;
  }
}

async function googleReceipt(c: Ctx, body: ReceiptBody, app: AppConfig): Promise<Receipt | Failure> {
  const ref = body.platform_product_ids?.[0];
  const productId = ref?.product_id ?? body.product_ids?.[0] ?? "";
  const product = app.products.get(productId);
  // 5xx, not 4xx: a missing product is a config mistake, and the purchase must not be lost.
  if (!product) return { status: 500, code: INTERNAL_SERVER_ERROR, message: `Product ${productId} is not in the config.` };

  if (app.googlePlayApi) {
    let client;
    try {
      client = googleClientFor(app, c.env, c.get("deps"));
    } catch (err) {
      if (err instanceof GoogleApiNotConfigured) return { status: 503, code: INTERNAL_SERVER_ERROR, message: err.message };
      throw err;
    }
    try {
      const p = await verifyPlayPurchase(client, app, body.fetch_token!, productId);
      return { transactions: p.transactions, states: p.states, postedTransactionId: p.postedTransactionId, ack: p.ack, replaces: p.replaces };
    } catch (err) {
      // Google doesn't know the token: not a real purchase of this app, so let the device drop it.
      if (err instanceof GoogleApiError && err.notFound) return { status: 400, code: INVALID_RECEIPT, message: "Google Play doesn't recognize this purchase." };
      if (err instanceof GoogleApiError && err.retryable) return { status: 503, code: INTERNAL_SERVER_ERROR, message: "Google Play is unavailable; try again later." };
      if (err instanceof GoogleApiError) {
        console.error(err);
        return { status: 500, code: INTERNAL_SERVER_ERROR, message: `Google Play Developer API error ${err.status}; check the service account's access.` };
      }
      // Pending purchases aren't paid yet; keep them on the device.
      if (err instanceof PendingPurchase) return { status: 503, code: INTERNAL_SERVER_ERROR, message: err.message };
      if (err instanceof GoogleMappingError) return { status: 500, code: INTERNAL_SERVER_ERROR, message: err.message };
      throw err;
    }
  }

  if (!app.allowUnverifiedPurchases) {
    // 5xx keeps the purchase on the device until the operator configures google_play_api.
    return { status: 503, code: INTERNAL_SERVER_ERROR, message: `App ${app.id} has no google_play_api in the config, so Play purchases can't be verified.` };
  }
  const now = Date.now();
  // Development only (allow_unverified_purchases): nothing here is checked with Google.
  const row: NewTransaction = {
    app_id: app.id,
    store: "play_store",
    environment: "sandbox",
    transaction_id: body.fetch_token!,
    original_transaction_id: body.fetch_token!,
    product_id: productId,
    base_plan_id: ref?.base_plan_id ?? null,
    product_type: product.type,
    purchased_at: now,
    original_purchased_at: now,
    expires_at: product.type === "subscription" ? now + UNVERIFIED_SUBSCRIPTION_MS : null,
    period_type: "normal",
    ownership_type: "PURCHASED",
    price_micros: null,
    currency: null,
    storefront: null,
    revoked_at: null,
    revocation_reason: null,
    is_upgraded: 0,
    verified: 0,
    source: "sdk",
    subscription_group: null,
  };
  return { transactions: [row], states: [], postedTransactionId: row.transaction_id };
}

/**
 * After a write: rebuilds the customer's snapshot and renders it. Falls back to a computed read
 * if the rebuild fails (the snapshot is then simply missing until the next write or backfill).
 */
async function freshCustomerInfo(c: Ctx, customerId: string, appUserId: string) {
  const config = c.get("project");
  const requestStore = c.get("app").store;
  try {
    const fresh = await refreshSnapshot(c.env.DB, c.get("config"), customerId);
    if (fresh) {
      c.header("ETag", fresh.etag);
      return renderCustomerInfo(fresh.snapshot, fresh.project, { requestStore });
    }
  } catch (err) {
    console.error("Snapshot rebuild failed; serving a computed CustomerInfo.", err);
  }
  return (await readCustomerInfo(c.env.DB, config, appUserId, { requestStore })).body;
}

/** iOS sends user IDs raw, Android percent-encoded; normalize so both count as one user. */
function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
