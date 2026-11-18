// Shared test setup: a config, an app built on the test Apple root, and a way to sign
// App Store-style transactions with the test certificate chain.

import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { buildApp } from "../src/app";
import { TEST_APPLE_API_KEY_PEM, TEST_LEAF_KEY_PEM, TEST_ROOT_CERT_B64, TEST_X5C } from "../src/bench/fixtures.generated";
import { parseConfig } from "../src/config";
import type { AppleNotification, AppleRenewalInfo, AppleTransaction } from "../src/stores/apple";
import { base64ToBytes, bytesToBase64Url, pemToDer } from "../src/lib/der";

export const IOS_KEY = "appl_test_ios_0123456789";
export const ANDROID_KEY = "goog_test_android_0123456789";
export const BUNDLE_ID = "com.example.openpurr";

export const rawTestConfig = {
  version: 1,
  apps: {
    ios: {
      store: "app_store",
      bundle_id: BUNDLE_ID,
      sdk_keys: [IOS_KEY],
      products: {
        pro_monthly: { type: "subscription" },
        pro_annual: { type: "subscription", subscription_group: "21000000" },
        lifetime: { type: "non_consumable" },
        coins_100: { type: "consumable" },
      },
    },
    android: {
      store: "play_store",
      package_name: "com.example.openpurr",
      sdk_keys: [ANDROID_KEY],
      allow_unverified_purchases: true,
      products: {
        pro: { type: "subscription", base_plans: ["monthly", "annual"] },
        lifetime: { type: "non_consumable" },
        coins_100: { type: "consumable" },
      },
    },
  },
  entitlements: {
    pro: { description: "Pro", products: { ios: ["pro_monthly", "pro_annual", "lifetime"], android: ["pro", "lifetime"] } },
    annual_perks: { products: { ios: ["pro_annual"], android: ["pro:annual"] } },
  },
  offerings: [
    {
      id: "default",
      current: true,
      description: "Standard",
      metadata: { headline: "Go Pro" },
      packages: [
        { id: "$rc_monthly", ios: "pro_monthly", android: "pro:monthly" },
        { id: "$rc_annual", ios: "pro_annual", android: "pro:annual" },
        { id: "$rc_lifetime", ios: "lifetime", android: "lifetime" },
      ],
    },
  ],
};

export const testConfig = parseConfig(rawTestConfig);
const appleRoots = [base64ToBytes(TEST_ROOT_CERT_B64)];
// No rate limits by default, so tests are deterministic; rate-limit.test.ts injects its own.
export const testApp = buildApp({ config: testConfig, appleRoots, rateLimiters: () => ({}) });

// --- App Store Server API ------------------------------------------------------------------

export const API_ISSUER_ID = "57246542-96fe-1a63-e053-0824d011072a";
export const API_KEY_ID = "TESTKEY123";

/** A fake App Store Server API. Routes are "<environment> <METHOD> <path>", without the query. */
export function fakeAppleApi(routes: Record<string, (url: URL) => { status?: number; body: unknown }>) {
  const requests: { url: URL; method: string; authorization: string | null }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    requests.push({ url, method, authorization: new Headers(init?.headers).get("authorization") });
    const environment = url.hostname === "api.storekit.apple.com" ? "production" : url.hostname === "api.storekit-sandbox.apple.com" ? "sandbox" : "unknown";
    const route = routes[`${environment} ${method} ${url.pathname}`];
    if (!route) return Response.json({ errorCode: 4040010, errorMessage: "Transaction id not found." }, { status: 404 });
    const { status = 200, body } = route(url);
    return Response.json(body, { status });
  }) as typeof fetch;
  return { fetch: fetchImpl, requests };
}

/** An app whose iOS app has App Store Server API access, talking to `api`. */
export function appWithAppleApi(api: { fetch: typeof fetch }) {
  const raw = structuredClone(rawTestConfig) as any;
  raw.apps.ios.app_store_server_api = { issuer_id: API_ISSUER_ID, key_id: API_KEY_ID };
  return buildApp({ config: parseConfig(raw), appleRoots, fetch: api.fetch, rateLimiters: () => ({}) });
}

/** An app whose rate limiters allow `limit` requests per key, counting in `counts`. */
export function appWithRateLimits(limit: { ip?: number; user?: number }) {
  const counts = new Map<string, number>();
  const limiter = (kind: string, max?: number) =>
    max === undefined
      ? undefined
      : {
          async allow(key: string) {
            const k = `${kind}:${key}`;
            counts.set(k, (counts.get(k) ?? 0) + 1);
            return counts.get(k)! <= max;
          },
        };
  const app = buildApp({
    config: testConfig,
    appleRoots,
    rateLimiters: () => ({ ip: limiter("ip", limit.ip), user: limiter("user", limit.user) }),
  });
  return { app, counts };
}

/** The Worker env with the In-App Purchase key secret set. */
export const envWithAppleKey = () => ({ ...env, APPLE_IAP_KEY: TEST_APPLE_API_KEY_PEM });

export const ANON = "$RCAnonymousID:0123456789abcdef0123456789abcdef";

/** Calls the test app the way the SDKs do (headers per spec/sdk-wire-contract.md). */
export async function call(
  path: string,
  opts: {
    key?: string;
    body?: unknown;
    platform?: "ios" | "android";
    headers?: Record<string, string>;
    app?: { fetch: typeof testApp.fetch };
    env?: object;
  } = {},
) {
  const platform = opts.platform ?? "ios";
  const key = opts.key ?? (platform === "ios" ? IOS_KEY : ANDROID_KEY);
  const ctx = createExecutionContext();
  const res = await (opts.app ?? testApp).fetch(
    new Request(`https://openpurr.test${path}`, {
      method: opts.body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "x-platform": platform === "ios" ? "iOS" : "android",
        "x-version": platform === "ios" ? "5.103.1" : "11.4.0",
        "x-revenuecat-etag": "",
        ...(platform === "ios" ? { "x-is-sandbox": "true" } : {}),
        ...opts.headers,
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
    opts.env ?? env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

let leafKey: Promise<CryptoKey> | undefined;
const DAY = 864e5;
let nextId = 2000000000000000;

/** Signs any payload as an App Store JWS with the test chain. */
export async function signJws(payload: object) {
  leafKey ??= crypto.subtle.importKey("pkcs8", pemToDer(TEST_LEAF_KEY_PEM), { name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
  ]);
  const enc = (o: object) => bytesToBase64Url(new TextEncoder().encode(JSON.stringify(o)));
  const input = `${enc({ alg: "ES256", x5c: TEST_X5C })}.${enc(payload)}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await leafKey, new TextEncoder().encode(input));
  return `${input}.${bytesToBase64Url(new Uint8Array(sig))}`;
}

/** A signed transaction, like the one StoreKit 2 posts as fetch_token. */
export async function signTransaction(overrides: Partial<AppleTransaction> = {}) {
  const id = String(nextId++);
  const purchaseDate = overrides.purchaseDate ?? Date.now() - DAY;
  const payload: AppleTransaction = {
    transactionId: id,
    originalTransactionId: id,
    bundleId: BUNDLE_ID,
    productId: "pro_monthly",
    purchaseDate,
    originalPurchaseDate: purchaseDate,
    expiresDate: purchaseDate + 30 * DAY,
    type: "Auto-Renewable Subscription",
    inAppOwnershipType: "PURCHASED",
    environment: "Sandbox",
    price: 9990,
    currency: "USD",
    storefront: "USA",
    ...overrides,
  };
  return { jws: await signJws(payload), payload };
}

/**
 * An App Store Server Notification V2, signed in three layers like Apple's: the outer
 * payload, and the transaction and renewal info inside it.
 */
export async function signNotification(n: {
  type: string;
  subtype?: string;
  transaction?: AppleTransaction;
  renewal?: Partial<AppleRenewalInfo>;
  status?: number;
  bundleId?: string;
  uuid?: string;
  signedDate?: number;
}) {
  const signedDate = n.signedDate ?? Date.now();
  const tx = n.transaction;
  const renewal: AppleRenewalInfo | undefined =
    n.renewal || tx
      ? {
          originalTransactionId: tx?.originalTransactionId ?? "",
          productId: tx?.productId ?? "",
          autoRenewProductId: tx?.productId,
          autoRenewStatus: 1,
          signedDate,
          ...n.renewal,
        }
      : undefined;
  const payload: AppleNotification = {
    notificationType: n.type,
    ...(n.subtype ? { subtype: n.subtype } : {}),
    notificationUUID: n.uuid ?? crypto.randomUUID(),
    version: "2.0",
    signedDate,
    data: {
      appAppleId: 1234567890,
      bundleId: n.bundleId ?? BUNDLE_ID,
      environment: "Sandbox",
      ...(tx ? { signedTransactionInfo: await signJws(tx) } : {}),
      ...(renewal ? { signedRenewalInfo: await signJws(renewal) } : {}),
      ...(n.status !== undefined ? { status: n.status } : {}),
    },
  };
  return { signedPayload: await signJws(payload), payload };
}

/** Delivers a notification the way Apple does (no SDK key). */
export async function postNotification(signedPayload: string, opts: { app?: { fetch: typeof testApp.fetch }; env?: object } = {}) {
  const ctx = createExecutionContext();
  const res = await (opts.app ?? testApp).fetch(
    new Request("https://openpurr.test/notifications/apple", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signedPayload }),
    }),
    opts.env ?? env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

/** Posts a StoreKit 2 transaction the way the iOS SDK does. */
export async function postAppleTransaction(appUserId: string, overrides: Partial<AppleTransaction> = {}) {
  const { jws, payload } = await signTransaction(overrides);
  const res = await call("/v1/receipts", {
    body: {
      app_user_id: appUserId,
      fetch_token: jws,
      product_id: payload.productId,
      transaction_id: payload.transactionId,
      is_restore: false,
      initiation_source: "purchase",
    },
  });
  return { res, payload };
}

export { DAY };

// --- Webhooks ----------------------------------------------------------------------------------

export const WEBHOOK_URL = "https://hooks.example.com/revenuecat";
export const WEBHOOK_AUTH = "Bearer hook-secret-123";
export const WEBHOOK_SIGNING_KEY = "whsec_test_signing_key";

/** A webhook receiver that records deliveries and answers with `status()` (default 200). */
export function webhookReceiver(status: () => number = () => 200) {
  const received: { url: string; headers: Headers; body: any; raw: string }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = String(init?.body ?? "");
    received.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(raw), raw });
    return new Response("ok", { status: status() });
  }) as typeof fetch;
  return { fetch: fetchImpl, received, events: () => received.map((r) => r.body.event) };
}

/** An app with one webhook endpoint (raw config overrides allowed), delivering to `receiver`. */
export function appWithWebhooks(receiver: { fetch: typeof fetch }, webhook: Record<string, unknown> = {}) {
  const raw = structuredClone(rawTestConfig) as any;
  raw.webhooks = [
    { id: "backend", url: WEBHOOK_URL, authorization_secret: "WEBHOOK_AUTH", signing_secret: "WEBHOOK_SECRET", ...webhook },
  ];
  const config = parseConfig(raw);
  // No network for exchange rates in tests; fx.test.ts covers them with its own provider.
  const noRates = { name: "none", latest: async () => [], history: async () => [] };
  const deps = { config, appleRoots, fetch: receiver.fetch, rateLimiters: () => ({}), fx: noRates };
  return { app: buildApp(deps), deps };
}

export const envWithWebhookSecrets = (signing = WEBHOOK_SIGNING_KEY) => ({ ...env, WEBHOOK_AUTH, WEBHOOK_SECRET: signing });
