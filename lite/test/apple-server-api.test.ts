import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { TEST_APPLE_API_KEY_PEM } from "../src/bench/fixtures.generated";
import { base64UrlToBytes } from "../src/lib/der";
import { APPLE_STATUS } from "../src/stores/apple";
import { AppleApiError, appleApiClient, inEitherEnvironment } from "../src/stores/apple-api";
import {
  API_ISSUER_ID,
  API_KEY_ID,
  appWithAppleApi,
  BUNDLE_ID,
  call,
  DAY,
  envWithAppleKey,
  fakeAppleApi,
  signJws,
  signTransaction,
} from "./helpers";
import { buildAppReceipt } from "./receipt-builder";

const creds = { issuerId: API_ISSUER_ID, keyId: API_KEY_ID, bundleId: BUNDLE_ID, privateKeyPem: TEST_APPLE_API_KEY_PEM };
const decode = (jws: string) => JSON.parse(new TextDecoder().decode(base64UrlToBytes(jws.split(".")[1]!)));
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

describe("App Store Server API client", () => {
  it("calls Apple's hosts with a bearer token Apple accepts", async () => {
    const api = fakeAppleApi({ "sandbox POST /inApps/v1/notifications/test": () => ({ body: { testNotificationToken: "tok-1" } }) });
    const client = appleApiClient(creds, "sandbox", api.fetch);
    expect(await client.requestTestNotification()).toBe("tok-1");

    const [req] = api.requests;
    expect(req!.url.origin).toBe("https://api.storekit-sandbox.apple.com");
    const token = req!.authorization!.replace("Bearer ", "");
    const header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(token.split(".")[0]!)));
    expect(header).toEqual({ alg: "ES256", kid: API_KEY_ID, typ: "JWT" });
    expect(decode(token)).toMatchObject({ iss: API_ISSUER_ID, aud: "appstoreconnect-v1", bid: BUNDLE_ID });
  });

  it("reuses the bearer token across calls", async () => {
    const api = fakeAppleApi({ "production POST /inApps/v1/notifications/test": () => ({ body: { testNotificationToken: "t" } }) });
    const client = appleApiClient(creds, "production", api.fetch);
    await client.requestTestNotification();
    await client.requestTestNotification();
    expect(api.requests[0]!.authorization).toBe(api.requests[1]!.authorization);
  });

  it("pages through transaction history newest first, up to the page limit", async () => {
    const pages: Record<string, { signedTransactions: string[]; hasMore: boolean; revision: string }> = {};
    const txs = await Promise.all([1, 2, 3].map(async (i) => (await signTransaction({ transactionId: `tx${i}` })).jws));
    pages[""] = { signedTransactions: [txs[0]!], hasMore: true, revision: "r1" };
    pages.r1 = { signedTransactions: [txs[1]!], hasMore: true, revision: "r2" };
    pages.r2 = { signedTransactions: [txs[2]!], hasMore: false, revision: "r3" };
    const api = fakeAppleApi({
      "production GET /inApps/v2/history/tx1": (url) => ({ body: pages[url.searchParams.get("revision") ?? ""] }),
    });
    const client = appleApiClient(creds, "production", api.fetch);

    const all = await client.transactionHistory("tx1", 5);
    expect(all.complete).toBe(true);
    expect(all.transactions.map((t) => t.transactionId)).toEqual(["tx1", "tx2", "tx3"]);
    expect(api.requests[0]!.url.searchParams.get("sort")).toBe("DESCENDING");

    const capped = await client.transactionHistory("tx1", 2);
    expect(capped).toMatchObject({ complete: false });
    expect(capped.transactions).toHaveLength(2);
  });

  it("falls back to sandbox when production doesn't know the transaction", async () => {
    const api = fakeAppleApi({ "sandbox GET /inApps/v2/history/42": () => ({ body: { signedTransactions: [], hasMore: false } }) });
    const clients = { production: appleApiClient(creds, "production", api.fetch), sandbox: appleApiClient(creds, "sandbox", api.fetch) };
    const { environment } = await inEitherEnvironment(clients, (c) => c.transactionHistory("42"));
    expect(environment).toBe("sandbox");
  });

  it("reports Apple's error codes, and which errors are worth retrying", async () => {
    const api = fakeAppleApi({
      "production GET /inApps/v1/subscriptions/1": () => ({ status: 429, body: { errorCode: 4290000, errorMessage: "Rate limit exceeded." } }),
      "production GET /inApps/v1/subscriptions/2": () => ({ status: 401, body: {} }),
    });
    const client = appleApiClient(creds, "production", api.fetch);
    const limited = await client.subscriptionStatuses("1").catch((e) => e);
    expect(limited).toBeInstanceOf(AppleApiError);
    expect(limited).toMatchObject({ status: 429, errorCode: 4290000, retryable: true });
    expect(await client.subscriptionStatuses("2").catch((e) => e)).toMatchObject({ status: 401, retryable: false, notFound: false });
  });
});

// --- StoreKit 1 receipts and restores, end to end --------------------------------------------

async function appleHistory(user: { expires: number; status: number; grace?: number }) {
  const sub = await signTransaction({ transactionId: "3000000001", originalTransactionId: "3000000000", productId: "pro_annual", expiresDate: user.expires });
  const lifetime = await signTransaction({ transactionId: "3000000002", productId: "lifetime", type: "Non-Consumable", expiresDate: undefined });
  const oldRenewal = await signTransaction({ transactionId: "2999999999", originalTransactionId: "3000000000", productId: "pro_annual", expiresDate: user.expires - 365 * DAY });
  const unknown = await signTransaction({ transactionId: "3000000003", productId: "discontinued_product" });
  const renewal = await signJws({
    originalTransactionId: "3000000000",
    productId: "pro_annual",
    autoRenewStatus: 1,
    signedDate: Date.now(),
    ...(user.grace ? { gracePeriodExpiresDate: user.grace } : {}),
  });
  return fakeAppleApi({
    // Production doesn't know these sandbox purchases (404 by default), so the client falls back.
    "sandbox GET /inApps/v2/history/3000000001": () => ({
      body: { signedTransactions: [sub.jws, lifetime.jws, oldRenewal.jws, unknown.jws], hasMore: false, revision: "r" },
    }),
    "sandbox GET /inApps/v1/subscriptions/3000000001": () => ({
      body: { data: [{ subscriptionGroupIdentifier: "g", lastTransactions: [{ originalTransactionId: "3000000000", status: user.status, signedTransactionInfo: sub.jws, signedRenewalInfo: renewal }] }] },
    }),
    "sandbox GET /inApps/v1/subscriptions/3000000005": () => ({
      body: { data: [{ subscriptionGroupIdentifier: "g", lastTransactions: [{ originalTransactionId: "3000000000", status: user.status, signedTransactionInfo: sub.jws, signedRenewalInfo: renewal }] }] },
    }),
  });
}

describe("StoreKit 1 receipts through the App Store Server API", () => {
  const receipt = buildAppReceipt({ inApp: [{ productId: "pro_annual", transactionId: "3000000001" }] });

  it("resolves the receipt with Apple and grants what Apple reports", async () => {
    const expires = Date.now() + 200 * DAY;
    const api = await appleHistory({ expires, status: APPLE_STATUS.ACTIVE });
    const res = await call("/v1/receipts", { app: appWithAppleApi(api), env: envWithAppleKey(), body: { app_user_id: "sk1-user", fetch_token: receipt } });
    expect(res.status).toBe(200);
    const sub = (await res.json<any>()).subscriber;
    expect(sub.entitlements.pro).toMatchObject({ product_identifier: "lifetime", expires_date: null });
    expect(sub.entitlements.annual_perks).toMatchObject({ product_identifier: "pro_annual", expires_date: iso(expires) });
    expect(sub.subscriptions.pro_annual.store_transaction_id).toBe("3000000001");
    expect(sub.subscriptions.discontinued_product).toBeUndefined();

    // Only what CustomerInfo needs is stored: the old renewal and the unknown product are not.
    const { results } = await env.DB.prepare("SELECT transaction_id, source FROM store_transaction WHERE transaction_id LIKE '3%' OR transaction_id = '2999999999' ORDER BY transaction_id").all();
    expect(results).toEqual([
      { transaction_id: "3000000001", source: "store_api" },
      { transaction_id: "3000000002", source: "store_api" },
    ]);
  });

  it("records the subscription status Apple reports (here, a grace period)", async () => {
    const expires = Date.now() - DAY;
    const grace = Date.now() + 10 * DAY;
    const api = await appleHistory({ expires, status: APPLE_STATUS.GRACE_PERIOD, grace });
    const res = await call("/v1/receipts", { app: appWithAppleApi(api), env: envWithAppleKey(), body: { app_user_id: "sk1-grace", fetch_token: receipt } });
    const sub = (await res.json<any>()).subscriber;
    expect(sub.subscriptions.pro_annual).toMatchObject({ expires_date: iso(grace), grace_period_expires_date: iso(grace) });
    expect(sub.subscriptions.pro_annual.billing_issues_detected_at).not.toBeNull();
  });

  it("returns an empty CustomerInfo for a receipt with no purchases, without calling Apple", async () => {
    const api = fakeAppleApi({});
    const res = await call("/v1/receipts", {
      app: appWithAppleApi(api),
      env: envWithAppleKey(),
      body: { app_user_id: "sk1-empty", fetch_token: buildAppReceipt({ xcode: true }) },
    });
    expect(res.status).toBe(200);
    expect((await res.json<any>()).subscriber.entitlements).toEqual({});
    expect(api.requests).toHaveLength(0);
  });

  it("keeps the purchase queued (5xx) when the key is missing or Apple is rate limiting", async () => {
    const api = fakeAppleApi({
      "production GET /inApps/v2/history/3000000001": () => ({ status: 429, body: { errorCode: 4290000 } }),
    });
    const noKey = await call("/v1/receipts", { app: appWithAppleApi(api), body: { app_user_id: "sk1-nokey", fetch_token: receipt } });
    expect(noKey.status).toBe(503);
    expect((await noKey.json<any>()).message).toMatch(/APPLE_IAP_KEY/);

    const limited = await call("/v1/receipts", { app: appWithAppleApi(api), env: envWithAppleKey(), body: { app_user_id: "sk1-429", fetch_token: receipt } });
    expect(limited.status).toBe(503);
  });

  it("rejects a malformed receipt, or one Apple doesn't recognize, with a 4xx", async () => {
    const api = fakeAppleApi({});
    const malformed = await call("/v1/receipts", { app: appWithAppleApi(api), env: envWithAppleKey(), body: { app_user_id: "sk1-bad", fetch_token: btoa("garbage") } });
    expect(malformed.status).toBe(400);
    const unknown = await call("/v1/receipts", { app: appWithAppleApi(api), env: envWithAppleKey(), body: { app_user_id: "sk1-unknown", fetch_token: receipt } });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ code: 7103 });
  });
});

describe("restores", () => {
  it("refresh subscription status from Apple when the app has API access", async () => {
    const grace = Date.now() + 5 * DAY;
    const api = await appleHistory({ expires: Date.now() - DAY, status: APPLE_STATUS.GRACE_PERIOD, grace });
    const { jws } = await signTransaction({ transactionId: "3000000005", originalTransactionId: "3000000000", productId: "pro_annual", expiresDate: Date.now() - DAY });
    const res = await call("/v1/receipts", {
      app: appWithAppleApi(api),
      env: envWithAppleKey(),
      body: { app_user_id: "restore-user", fetch_token: jws, is_restore: true },
    });
    expect(res.status).toBe(200);
    const sub = (await res.json<any>()).subscriber;
    expect(sub.entitlements.pro.grace_period_expires_date).toBe(iso(grace));
  });

  it("still succeed when Apple's API is down: the signed transaction stands on its own", async () => {
    const api = fakeAppleApi({});
    const { jws } = await signTransaction({ productId: "pro_monthly" });
    const res = await call("/v1/receipts", {
      app: appWithAppleApi(api),
      env: envWithAppleKey(),
      body: { app_user_id: "restore-down", fetch_token: jws, is_restore: true },
    });
    expect(res.status).toBe(200);
    expect((await res.json<any>()).subscriber.entitlements.pro.product_identifier).toBe("pro_monthly");
  });
});
