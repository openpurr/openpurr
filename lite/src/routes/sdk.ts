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

import { type Context, Hono } from "hono";
import type { AppConfig } from "../config";
import { buildCustomerInfo } from "../customer-info";
import type { AppEnv } from "../env";
import {
  addAlias,
  ensureCustomer,
  findCustomer,
  isAnonymous,
  loadCustomer,
  mergeCustomers,
  type NewTransaction,
  purchaseOwner,
  recordTransaction,
} from "../ledger";
import { AppleJwsError, verifyAppleJws } from "../lib/apple-jws";
import { d1ChainStore } from "../lib/chain-store-d1";
import { AppleMappingError, type AppleTransaction, appleTransactionRow } from "../stores/apple";

type Ctx = Context<AppEnv>;

// Backend error codes the SDKs recognize (iOS BackendErrorCode.swift, Android errors.kt).
const UNKNOWN_ERROR = 0;
const INVALID_RECEIPT = 7103;
const INTERNAL_SERVER_ERROR = 7110;
const INVALID_API_KEY = 7225;
const BAD_REQUEST = 7226;

/** Unverified (development) subscriptions last this long, since nothing tells us the real expiry. */
const UNVERIFIED_SUBSCRIPTION_MS = 30 * 864e5;

export const sdk = new Hono<AppEnv>();

const error = (c: Ctx, status: 400 | 401 | 404 | 500 | 503, code: number, message: string) =>
  c.json({ code, message }, status);

// Unauthenticated, iOS DEBUG builds of the SDK only. Failures are ignored by the SDK.
sdk.get("/subscribers/:id/health_report_availability", (c) => c.json({ report_logs: false }));

// The public SDK key identifies the app (and so the store) for every request.
sdk.use("*", async (c, next) => {
  const auth = c.req.header("authorization") ?? "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const app = key ? c.get("deps").config.keys.get(key) : undefined;
  if (!app) return error(c, 401, INVALID_API_KEY, "Invalid API key.");
  c.set("app", app);
  await next();
});

sdk.get("/subscribers/:id", async (c) => c.json(await customerInfo(c, c.req.param("id"))));

sdk.post("/receipts", async (c) => {
  const body = await c.req.json<ReceiptBody>().catch(() => null);
  if (!body?.app_user_id || !body.fetch_token) {
    return error(c, 400, BAD_REQUEST, "app_user_id and fetch_token are required.");
  }
  const app = c.get("app");
  const result = app.store === "app_store" ? await appleReceipt(c, body, app) : googleReceipt(body, app);
  if ("status" in result) return error(c, result.status, result.code, result.message);
  const tx = result;

  const db = c.env.DB;
  const customer = await ensureCustomer(db, body.app_user_id);
  const owner = await purchaseOwner(db, tx.store, tx.original_transaction_id);
  const writes = recordTransaction(db, tx, customer.id);
  // The purchase already belongs to someone else. RevenueCat's default ("transfer to new App
  // User ID"): an anonymous owner is merged into this customer; a named owner loses it.
  if (owner && owner.id !== customer.id && owner.anonymousOnly) writes.unshift(...mergeCustomers(db, owner.id, customer.id));
  await db.batch(writes);

  const info = await customerInfo(c, body.app_user_id);
  if (app.store === "play_store") {
    // Android consumes a purchase only when told to (spec/sdk-wire-contract.md, rule 5).
    return c.json({ ...info, purchased_products: { [tx.product_id]: { should_consume: tx.product_type === "consumable" } } });
  }
  return c.json(info);
});

// logIn. 201 tells the SDK the user was created; 200 that it already existed.
sdk.post("/subscribers/identify", async (c) => {
  const body = await c.req.json<{ app_user_id?: string; new_app_user_id?: string }>().catch(() => null);
  const current = body?.app_user_id;
  const next = body?.new_app_user_id;
  if (!current || !next) return error(c, 400, BAD_REQUEST, "app_user_id and new_app_user_id are required.");

  const db = c.env.DB;
  const [from, to] = await Promise.all([findCustomer(db, current), findCustomer(db, next)]);
  let created = false;
  if (to) {
    // Logging in to an existing account: an anonymous user's purchases come along.
    if (from && from.id !== to.id && isAnonymous(current)) await db.batch(mergeCustomers(db, from.id, to.id));
  } else if (from && isAnonymous(current)) {
    // A new ID for an anonymous user who already exists: alias it, keeping their purchases.
    await addAlias(db, next, from.id).run();
    created = true;
  } else {
    await ensureCustomer(db, next);
    created = true;
  }
  return c.json(await customerInfo(c, next), created ? 201 : 200);
});

// Android only: Block Store recovery of an anonymous ID. Body is ignored by the SDK.
sdk.post("/subscribers/:id/alias", (c) => c.json({}));

sdk.get("/subscribers/:id/offerings", (c) => {
  const { config } = c.get("deps");
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
  const { config } = c.get("deps");
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

// Response bodies are ignored; 2xx marks attributes as synced. Stored in a later milestone.
sdk.post("/subscribers/:id/attributes", (c) => c.json({}));

// iOS, StoreKit 1 path only. "Unknown" until intro eligibility is computed from history.
sdk.post("/subscribers/:id/intro_eligibility", async (c) => {
  const body = await c.req.json<{ product_identifiers?: string[] }>().catch(() => null);
  const product_identifiers = Array.isArray(body?.product_identifiers) ? body.product_identifiers : [];
  return c.json(Object.fromEntries(product_identifiers.map((id) => [id, null])));
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
  // iOS
  product_id?: string;
  transaction_id?: string;
  // Android
  product_ids?: string[];
  platform_product_ids?: { product_id: string; base_plan_id?: string | null }[];
}

type Failure = { status: 400 | 500 | 503; code: number; message: string };

async function appleReceipt(c: Ctx, body: ReceiptBody, app: AppConfig): Promise<NewTransaction | Failure> {
  const token = body.fetch_token!;
  // StoreKit 2 sends the signed transaction (a JWS). StoreKit 1 sends the app receipt, which
  // needs the App Store Server API to resolve; until that lands, keep it queued on the device.
  if (token.split(".").length !== 3) {
    return { status: 503, code: INTERNAL_SERVER_ERROR, message: "StoreKit 1 receipts aren't supported yet." };
  }

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
  try {
    return appleTransactionRow(tx, app, product);
  } catch (err) {
    // Bundle or type mismatch: most likely the config, so keep the purchase queued.
    if (err instanceof AppleMappingError) return { status: 500, code: INTERNAL_SERVER_ERROR, message: err.message };
    throw err;
  }
}

function googleReceipt(body: ReceiptBody, app: AppConfig): NewTransaction | Failure {
  if (!app.allowUnverifiedPurchases) {
    // Google Play validation lands in M2. Until then, 5xx keeps the purchase on the device.
    return { status: 503, code: INTERNAL_SERVER_ERROR, message: "Google Play purchase validation isn't available yet." };
  }
  const ref = body.platform_product_ids?.[0];
  const productId = ref?.product_id ?? body.product_ids?.[0] ?? "";
  const product = app.products.get(productId);
  if (!product) return { status: 500, code: INTERNAL_SERVER_ERROR, message: `Product ${productId} is not in the config.` };
  const now = Date.now();
  // Development only (allow_unverified_purchases): nothing here is checked with Google.
  return {
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
  };
}

/** Read-only: never writes, per the free-plan rule. Unknown users get a fresh, empty body. */
async function customerInfo(c: Ctx, appUserId: string) {
  const { customer, transactions } = await loadCustomer(c.env.DB, appUserId);
  return buildCustomerInfo({
    appUserId,
    customer,
    transactions,
    config: c.get("deps").config,
    requestStore: c.get("app").store,
  });
}
