// M0 stub of the RevenueCat-compatible SDK API. Enough for unmodified SDKs to run
// configure -> offerings -> purchase -> CustomerInfo. It does NOT validate purchases with the
// stores; M1 (Apple) and M2 (Google) replace /receipts with real validation.
//
// Wire rules from spec/sdk-wire-contract.md:
//   - Never answer 304; always 200 with a full body (iOS can re-queue a 304 forever).
//   - Every error has a JSON body {code, message} with Content-Type application/json, or
//     Android treats it as a connection failure.
//   - Remote config gets 204, which both SDKs read as "not modified".
//   - User IDs arrive percent-encoded on Android and raw ($, :) on iOS; Hono decodes both.

import { Hono, type Context } from "hono";
import { buildCustomerInfo, type PurchaseRow } from "../customer-info";
import type { AppEnv } from "../env";
import { base64UrlToBytes } from "../lib/der";
import { spikeConfig, type SpikeConfig } from "../spike-config";

type Platform = "ios" | "android";
type Ctx = Context<AppEnv & { Variables: { platform: Platform } }>;

// Backend error codes the SDKs recognize (iOS BackendErrorCode.swift, Android errors.kt).
const UNKNOWN_ERROR = 0;
const INTERNAL_SERVER_ERROR = 7110;
const BACKEND_INVALID_API_KEY = 7225;
const BAD_REQUEST = 7226;

export const sdk = new Hono<AppEnv & { Variables: { platform: Platform } }>();

const error = (c: Ctx, status: 400 | 401 | 404 | 500, code: number, message: string) =>
  c.json({ code, message }, status);

// Unauthenticated, iOS DEBUG builds of the SDK only. Failures are ignored by the SDK.
sdk.get("/subscribers/:id/health_report_availability", (c) => c.json({ report_logs: false }));

sdk.use("*", async (c, next) => {
  const auth = c.req.header("authorization") ?? "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const allowed = (c.env.SDK_KEYS ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  if (!key || !allowed.includes(key)) return error(c, 401, BACKEND_INVALID_API_KEY, "Invalid API key.");
  if (key.startsWith("appl_")) c.set("platform", "ios");
  else if (key.startsWith("goog_")) c.set("platform", "android");
  else return error(c, 401, BACKEND_INVALID_API_KEY, "SDK keys must start with appl_ or goog_.");
  await next();
});

sdk.get("/subscribers/:id", async (c) => c.json(await customerInfo(c, c.req.param("id"))));

sdk.post("/receipts", async (c) => {
  const body = await c.req.json<ReceiptBody>();
  if (!body.app_user_id || !body.fetch_token) return error(c, 400, BAD_REQUEST, "app_user_id and fetch_token are required.");
  const config = spikeConfig(c.env.SPIKE_CONFIG);
  const platform = c.get("platform");
  const purchase =
    platform === "ios" ? applePurchase(body, c.req.header("x-is-sandbox") === "true") : googlePurchase(body);
  const product = config.products[purchase.product_id];
  // 5xx, not 4xx: on a 4xx iOS finishes the transaction and Android acknowledges it, so a
  // purchase would be lost to a config mistake. A 5xx leaves it queued on the device.
  if (!product) return error(c, 500, INTERNAL_SERVER_ERROR, `Product ${purchase.product_id} is not in the config.`);

  purchase.kind = product.kind;
  if (product.kind === "subscription" && !purchase.expires_at) {
    purchase.expires_at = isoSeconds(new Date(Date.parse(purchase.purchased_at) + (product.durationDays ?? 30) * 864e5));
  }
  if (product.kind === "non_subscription") purchase.expires_at = null;

  await c.env.DB.batch([
    ensureCustomer(c, body.app_user_id),
    c.env.DB.prepare(
      `INSERT INTO spike_purchase (app_user_id, store_transaction_id, product_id, base_plan_id, kind, store, is_sandbox,
         purchased_at, original_purchased_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (store, store_transaction_id) DO UPDATE SET app_user_id = excluded.app_user_id,
         expires_at = excluded.expires_at`,
    ).bind(
      body.app_user_id,
      purchase.store_transaction_id,
      purchase.product_id,
      purchase.base_plan_id,
      purchase.kind,
      purchase.store,
      purchase.is_sandbox,
      purchase.purchased_at,
      purchase.original_purchased_at,
      purchase.expires_at,
    ),
  ]);

  const info = await customerInfo(c, body.app_user_id);
  if (platform === "android") {
    return c.json({ ...info, purchased_products: { [purchase.product_id]: { should_consume: !!product.consumable } } });
  }
  return c.json(info);
});

// logIn. 201 tells the SDK the user was created; 200 that it already existed.
sdk.post("/subscribers/identify", async (c) => {
  const { app_user_id: current, new_app_user_id: next } = await c.req.json<{
    app_user_id?: string;
    new_app_user_id?: string;
  }>();
  if (!current || !next) return error(c, 400, BAD_REQUEST, "app_user_id and new_app_user_id are required.");

  const exists = await c.env.DB.prepare("SELECT 1 FROM spike_customer WHERE app_user_id = ?").bind(next).first();
  const writes = [ensureCustomer(c, next)];
  // An anonymous user's purchases follow them to the identified account.
  if (isAnonymous(current) && current !== next) {
    writes.push(c.env.DB.prepare("UPDATE spike_purchase SET app_user_id = ? WHERE app_user_id = ?").bind(next, current));
  }
  await c.env.DB.batch(writes);
  return c.json(await customerInfo(c, next), exists ? 200 : 201);
});

// Android only: Block Store recovery of an anonymous ID. Body is ignored by the SDK.
sdk.post("/subscribers/:id/alias", (c) => c.json({}));

sdk.get("/subscribers/:id/offerings", (c) => {
  const config = spikeConfig(c.env.SPIKE_CONFIG);
  const platform = c.get("platform");
  return c.json({
    current_offering_id: config.currentOffering,
    offerings: config.offerings.map((o) => ({
      identifier: o.identifier,
      description: o.description,
      metadata: {},
      packages: o[platform].map((p) => ({
        identifier: p.identifier,
        platform_product_identifier: p.productId,
        ...(platform === "android" && p.basePlanId ? { platform_product_plan_identifier: p.basePlanId } : {}),
      })),
    })),
    placements: null,
    targeting: null,
  });
});

sdk.get("/product_entitlement_mapping", (c) => {
  const config = spikeConfig(c.env.SPIKE_CONFIG);
  const mapping: Record<string, unknown> = {};
  for (const [id, p] of Object.entries(config.products)) {
    mapping[id] = { product_identifier: id, base_plan_id: null, entitlements: p.entitlements };
  }
  return c.json({ product_entitlement_mapping: mapping });
});

// Response bodies are ignored; 2xx marks attributes as synced.
sdk.post("/subscribers/:id/attributes", (c) => c.json({}));

// iOS, StoreKit 1 path only. Spike answers "unknown" for everything.
sdk.post("/subscribers/:id/intro_eligibility", async (c) => {
  const { product_identifiers = [] } = await c.req.json<{ product_identifiers?: string[] }>();
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

type NewPurchase = Omit<PurchaseRow, "kind"> & { kind: PurchaseRow["kind"] };

function applePurchase(body: ReceiptBody, sandboxHeader: boolean): NewPurchase {
  const now = isoSeconds(new Date());
  // StoreKit 2 sends the signed transaction as fetch_token. The spike reads it WITHOUT
  // verifying; M1 verifies it with lib/apple-jws.ts against Apple Root CA G3.
  const tx = decodeJwsPayloadUnverified(body.fetch_token!);
  if (tx) {
    return {
      store_transaction_id: String(tx.transactionId ?? body.transaction_id ?? crypto.randomUUID()),
      product_id: String(tx.productId ?? body.product_id),
      base_plan_id: null,
      kind: "subscription",
      store: "app_store",
      is_sandbox: tx.environment === "Production" ? 0 : 1,
      purchased_at: tx.purchaseDate ? isoSeconds(new Date(Number(tx.purchaseDate))) : now,
      original_purchased_at: tx.originalPurchaseDate ? isoSeconds(new Date(Number(tx.originalPurchaseDate))) : now,
      expires_at: tx.expiresDate ? isoSeconds(new Date(Number(tx.expiresDate))) : null,
    };
  }
  // StoreKit 1 receipt (base64 PKCS#7): trust the product fields in the body.
  return {
    store_transaction_id: body.transaction_id ?? crypto.randomUUID(),
    product_id: body.product_id ?? "",
    base_plan_id: null,
    kind: "subscription",
    store: "app_store",
    is_sandbox: sandboxHeader ? 1 : 0,
    purchased_at: now,
    original_purchased_at: now,
    expires_at: null,
  };
}

function googlePurchase(body: ReceiptBody): NewPurchase {
  const now = isoSeconds(new Date());
  const platformId = body.platform_product_ids?.[0];
  return {
    // The purchase token is unique per purchase; M2 swaps in the order ID from the Play API.
    store_transaction_id: body.fetch_token!,
    product_id: platformId?.product_id ?? body.product_ids?.[0] ?? "",
    base_plan_id: platformId?.base_plan_id ?? null,
    kind: "subscription",
    store: "play_store",
    // Android doesn't say; the spike assumes license testers.
    is_sandbox: 1,
    purchased_at: now,
    original_purchased_at: now,
    expires_at: null,
  };
}

function decodeJwsPayloadUnverified(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0]!.startsWith("eyJ")) return null;
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1]!)));
  } catch {
    return null;
  }
}

function ensureCustomer(c: Ctx, appUserId: string) {
  return c.env.DB.prepare(
    `INSERT INTO spike_customer (app_user_id, original_app_user_id, first_seen) VALUES (?, ?, ?)
     ON CONFLICT (app_user_id) DO NOTHING`,
  ).bind(appUserId, appUserId, isoSeconds(new Date()));
}

/** Read-only: never writes, per the free-plan rule. Unknown users get a fresh, empty body. */
async function customerInfo(c: Ctx, appUserId: string) {
  const config: SpikeConfig = spikeConfig(c.env.SPIKE_CONFIG);
  const [customer, purchases] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT original_app_user_id, first_seen FROM spike_customer WHERE app_user_id = ?").bind(appUserId),
    c.env.DB.prepare(
      `SELECT store_transaction_id, product_id, base_plan_id, kind, store, is_sandbox, purchased_at,
              original_purchased_at, expires_at
       FROM spike_purchase WHERE app_user_id = ?`,
    ).bind(appUserId),
  ]);
  const row = customer?.results[0] as { original_app_user_id: string; first_seen: string } | undefined;
  return buildCustomerInfo({
    appUserId,
    originalAppUserId: row?.original_app_user_id ?? appUserId,
    firstSeen: row?.first_seen ?? isoSeconds(new Date()),
    purchases: (purchases?.results ?? []) as unknown as PurchaseRow[],
    config,
  });
}

function isAnonymous(id: string) {
  return id.startsWith("$RCAnonymousID:");
}

/** Android needs RFC 3339 with a zone; iOS accepts with or without fractions. Use whole seconds. */
function isoSeconds(d: Date) {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}
