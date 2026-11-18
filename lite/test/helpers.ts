// Shared test setup: a config, an app built on the test Apple root, and a way to sign
// App Store-style transactions with the test certificate chain.

import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { buildApp } from "../src/app";
import { TEST_LEAF_KEY_PEM, TEST_ROOT_CERT_B64, TEST_X5C } from "../src/bench/fixtures.generated";
import { parseConfig } from "../src/config";
import type { AppleTransaction } from "../src/stores/apple";
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
        pro_annual: { type: "subscription" },
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
export const testApp = buildApp({ config: testConfig, appleRoots: [base64ToBytes(TEST_ROOT_CERT_B64)] });

export const ANON = "$RCAnonymousID:0123456789abcdef0123456789abcdef";

/** Calls the test app the way the SDKs do (headers per spec/sdk-wire-contract.md). */
export async function call(
  path: string,
  opts: { key?: string; body?: unknown; platform?: "ios" | "android"; headers?: Record<string, string> } = {},
) {
  const platform = opts.platform ?? "ios";
  const key = opts.key ?? (platform === "ios" ? IOS_KEY : ANDROID_KEY);
  const ctx = createExecutionContext();
  const res = await testApp.fetch(
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
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

let leafKey: Promise<CryptoKey> | undefined;
const DAY = 864e5;
let nextId = 2000000000000000;

/** A signed transaction, like the one StoreKit 2 posts as fetch_token. */
export async function signTransaction(overrides: Partial<AppleTransaction> = {}) {
  leafKey ??= crypto.subtle.importKey("pkcs8", pemToDer(TEST_LEAF_KEY_PEM), { name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
  ]);
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
  const enc = (o: object) => bytesToBase64Url(new TextEncoder().encode(JSON.stringify(o)));
  const input = `${enc({ alg: "ES256", x5c: TEST_X5C })}.${enc(payload)}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await leafKey, new TextEncoder().encode(input));
  return { jws: `${input}.${bytesToBase64Url(new Uint8Array(sig))}`, payload };
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
