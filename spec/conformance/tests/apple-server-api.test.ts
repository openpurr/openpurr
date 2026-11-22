// The App Store Server API as the server uses it over HTTP: StoreKit 1 receipts posted to
// /v1/receipts are resolved with Apple (transaction history and subscription statuses), restores
// refresh subscription status, and Apple sees a bearer token it accepts. Also how a StoreKit 1
// receipt is read (DER and Xcode BER, empty and malformed receipts). Ported from
// lite/test/apple-server-api.test.ts and lite/test/apple-receipt.test.ts.

import { beforeEach, describe, expect, it } from "vitest";
import {
  admin,
  API_ISSUER_ID,
  API_KEY_ID,
  BUNDLE_ID,
  buildAppReceipt,
  call,
  DAY,
  decodeJws,
  fake,
  fixtures,
  itEdition,
  now,
  reset,
  signJws,
  signTransaction,
  withAppleApi,
} from "../src";

const APPLE_STATUS = { ACTIVE: 1, GRACE_PERIOD: 4 } as const;
const SANDBOX = "api.storekit-sandbox.apple.com";
const PRODUCTION = "api.storekit.apple.com";

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const appleRequests = () => fake.requests.filter((r) => r.host === SANDBOX || r.host === PRODUCTION);
const transactionsOf = async (appUserId: string) => (await admin("GET", `/customers/${encodeURIComponent(appUserId)}`)).body.transactions as any[];
const postReceipt = (appUserId: string, fetchToken: string, extra: Record<string, unknown> = {}) =>
  call("/v1/receipts", { body: { app_user_id: appUserId, fetch_token: fetchToken, ...extra } });

/**
 * Apple's answers for a sandbox customer with an annual subscription (chain 3000000000), a lifetime
 * purchase, an older renewal and a product the config doesn't list. Production doesn't know these
 * purchases (404 by default), so the server falls back to sandbox.
 */
async function appleHistory(user: { expires: number; status: number; grace?: number }) {
  const sub = await signTransaction({ transactionId: "3000000001", originalTransactionId: "3000000000", productId: "pro_annual", expiresDate: user.expires });
  const lifetime = await signTransaction({ transactionId: "3000000002", productId: "lifetime", type: "Non-Consumable", expiresDate: undefined });
  const oldRenewal = await signTransaction({ transactionId: "2999999999", originalTransactionId: "3000000000", productId: "pro_annual", expiresDate: user.expires - 365 * DAY });
  const unknown = await signTransaction({ transactionId: "3000000003", productId: "discontinued_product" });
  const renewal = await signJws({
    originalTransactionId: "3000000000",
    productId: "pro_annual",
    autoRenewStatus: 1,
    signedDate: now(),
    ...(user.grace ? { gracePeriodExpiresDate: user.grace } : {}),
  });
  const statuses = () => ({
    body: { data: [{ subscriptionGroupIdentifier: "g", lastTransactions: [{ originalTransactionId: "3000000000", status: user.status, signedTransactionInfo: sub.jws, signedRenewalInfo: renewal }] }] },
  });
  return fake.apple({
    "sandbox GET /inApps/v2/history/3000000001": () => ({
      body: { signedTransactions: [sub.jws, lifetime.jws, oldRenewal.jws, unknown.jws], hasMore: false, revision: "r" },
    }),
    "sandbox GET /inApps/v1/subscriptions/3000000001": statuses,
    "sandbox GET /inApps/v1/subscriptions/3000000005": statuses,
  });
}

const receipt = buildAppReceipt({ inApp: [{ productId: "pro_annual", transactionId: "3000000001" }] });

beforeEach(async () => {
  await reset(withAppleApi());
});

describe("App Store Server API client", () => {
  it("calls Apple's hosts with a bearer token Apple accepts", async () => {
    await appleHistory({ expires: now() + 200 * DAY, status: APPLE_STATUS.ACTIVE });
    expect((await postReceipt("api-token", receipt)).status).toBe(200);

    const req = appleRequests().find((r) => r.host === SANDBOX)!;
    expect(req.url.origin).toBe("https://api.storekit-sandbox.apple.com");
    const token = req.headers.get("authorization")!.replace(/^Bearer /, "");
    const [header, , signature] = token.split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString("utf8"))).toEqual({ alg: "ES256", kid: API_KEY_ID, typ: "JWT" });
    const claims = decodeJws(token);
    expect(claims).toMatchObject({ iss: API_ISSUER_ID, aud: "appstoreconnect-v1", bid: BUNDLE_ID });
    // Apple accepts tokens valid for at most an hour.
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(3600);

    // Signed with the In-App Purchase key (APPLE_IAP_KEY).
    const key = await crypto.subtle.importKey("jwk", { ...fixtures.appleApiPublicJwk, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const signed = new TextEncoder().encode(token.slice(0, token.lastIndexOf(".")));
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, Buffer.from(signature!, "base64url"), signed)).toBe(true);
  });

  itEdition("lite", "reuses the bearer token across calls", async () => {
    await appleHistory({ expires: now() + 200 * DAY, status: APPLE_STATUS.ACTIVE });
    await postReceipt("api-reuse", receipt);
    const tokens = new Set(appleRequests().map((r) => r.headers.get("authorization")));
    expect(appleRequests().length).toBeGreaterThan(1);
    expect(tokens.size).toBe(1);
  });

  it("asks for transaction history newest first", async () => {
    await appleHistory({ expires: now() + 200 * DAY, status: APPLE_STATUS.ACTIVE });
    await postReceipt("api-sort", receipt);
    const history = appleRequests().filter((r) => r.path.startsWith("/inApps/v2/history/"));
    expect(history.length).toBeGreaterThan(0);
    for (const r of history) expect(r.url.searchParams.get("sort")).toBe("DESCENDING");
  });

  it("falls back to sandbox when production doesn't know the transaction", async () => {
    await appleHistory({ expires: now() + 200 * DAY, status: APPLE_STATUS.ACTIVE });
    expect((await postReceipt("api-fallback", receipt)).status).toBe(200);
    const history = appleRequests().filter((r) => r.path === "/inApps/v2/history/3000000001");
    expect(history.map((r) => r.host)).toEqual([PRODUCTION, SANDBOX]);
    // Statuses are then asked of the environment that knew the transaction.
    expect(appleRequests().filter((r) => r.path.startsWith("/inApps/v1/subscriptions/")).map((r) => r.host)).toEqual([SANDBOX]);
    const txs = await transactionsOf("api-fallback");
    expect(txs.every((t) => t.environment === "sandbox")).toBe(true);
  });

  it("reports Apple's error codes, and which errors are worth retrying", async () => {
    // Rate limits and Apple outages keep the purchase queued (503); a credentials problem is ours (500).
    fake.apple({ "production GET /inApps/v2/history/3000000001": () => ({ status: 429, body: { errorCode: 4290000, errorMessage: "Rate limit exceeded." } }) });
    expect((await postReceipt("api-429", receipt)).status).toBe(503);

    fake.apple({ "production GET /inApps/v2/history/3000000001": () => ({ status: 500, body: {} }) });
    expect((await postReceipt("api-500", receipt)).status).toBe(503);

    fake.apple({ "production GET /inApps/v2/history/3000000001": () => ({ status: 401, body: {} }) });
    expect((await postReceipt("api-401", receipt)).status).toBe(500);
  });
});

describe("StoreKit 1 receipts through the App Store Server API", () => {
  it("resolves the receipt with Apple and grants what Apple reports", async () => {
    const expires = now() + 200 * DAY;
    await appleHistory({ expires, status: APPLE_STATUS.ACTIVE });
    const res = await postReceipt("sk1-user", receipt);
    expect(res.status).toBe(200);
    const sub = res.body.subscriber;
    expect(sub.entitlements.pro).toMatchObject({ product_identifier: "lifetime", expires_date: null });
    expect(sub.entitlements.annual_perks).toMatchObject({ product_identifier: "pro_annual", expires_date: iso(expires) });
    expect(sub.subscriptions.pro_annual.store_transaction_id).toBe("3000000001");
    expect(sub.subscriptions.discontinued_product).toBeUndefined();
  });

  itEdition("lite", "stores only what CustomerInfo needs from Apple's answer", async () => {
    await appleHistory({ expires: now() + 200 * DAY, status: APPLE_STATUS.ACTIVE });
    await postReceipt("sk1-stored", receipt);
    // The old renewal and the unknown product are not stored.
    const ids = (await transactionsOf("sk1-stored")).map((t) => t.transaction_id).sort();
    expect(ids).toEqual(["3000000001", "3000000002"]);
  });

  it("records the subscription status Apple reports (here, a grace period)", async () => {
    const expires = now() - DAY;
    const grace = now() + 10 * DAY;
    await appleHistory({ expires, status: APPLE_STATUS.GRACE_PERIOD, grace });
    const res = await postReceipt("sk1-grace", receipt);
    const sub = res.body.subscriber;
    expect(sub.subscriptions.pro_annual).toMatchObject({ expires_date: iso(grace), grace_period_expires_date: iso(grace) });
    expect(sub.subscriptions.pro_annual.billing_issues_detected_at).not.toBeNull();
  });

  it("returns an empty CustomerInfo for a receipt with no purchases, without calling Apple", async () => {
    for (const xcode of [false, true]) {
      const res = await postReceipt(`sk1-empty-${xcode}`, buildAppReceipt({ xcode }));
      expect(res.status).toBe(200);
      expect(res.body.subscriber.entitlements).toEqual({});
    }
    expect(appleRequests()).toHaveLength(0);
  });

  it("keeps the purchase queued (5xx) when the key is missing or Apple is rate limiting", async () => {
    // The config names a secret the server doesn't hold.
    const raw = withAppleApi();
    raw.apps.ios.app_store_server_api.private_key_secret = "MISSING_IAP_KEY";
    await reset(raw);
    const noKey = await postReceipt("sk1-nokey", receipt);
    expect(noKey.status).toBe(503);
    expect(appleRequests()).toHaveLength(0);

    await reset(withAppleApi());
    fake.apple({ "production GET /inApps/v2/history/3000000001": () => ({ status: 429, body: { errorCode: 4290000 } }) });
    expect((await postReceipt("sk1-429", receipt)).status).toBe(503);
  });

  it("rejects a malformed receipt, or one Apple doesn't recognize, with a 4xx", async () => {
    const malformed = await postReceipt("sk1-bad", btoa("garbage"));
    expect(malformed.status).toBe(400);
    // Apple doesn't know the transaction in either environment (404 by default).
    const unknown = await postReceipt("sk1-unknown", receipt);
    expect(unknown.status).toBe(400);
    expect(unknown.body).toMatchObject({ code: 7103 });
  });
});

describe("reading StoreKit 1 receipts", () => {
  const inApp = [{ productId: "pro_monthly", transactionId: "2000000444", originalTransactionId: "2000000111" }];
  const askedFor = () => appleRequests().filter((r) => r.path.startsWith("/inApps/v2/history/")).map((r) => r.path.split("/").pop());

  it("reads a transaction ID from an App Store (DER) receipt", async () => {
    await postReceipt("rcpt-der", buildAppReceipt({ inApp }));
    expect(askedFor()[0]).toBe("2000000444");
  });

  it("reads Xcode receipts with indefinite lengths and the extra OCTET STRING", async () => {
    await postReceipt("rcpt-xcode", buildAppReceipt({ inApp, xcode: true }));
    expect(askedFor()[0]).toBe("2000000444");
  });

  it("rejects malformed receipts", async () => {
    const good = Buffer.from(buildAppReceipt({ inApp }), "base64");
    const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
    for (const bad of ["not base64!!", btoa("hello"), b64(good.subarray(0, 40)), b64(good.subarray(0, good.length - 3))]) {
      const res = await postReceipt("rcpt-bad", bad);
      expect(res.status, bad).toBe(400);
      expect(res.body, bad).toMatchObject({ code: 7103 });
    }
    expect(appleRequests()).toHaveLength(0);
  });

  it("rejects receipts nested past the depth limit", async () => {
    let nested = "\x04\x00";
    for (let i = 0; i < 40; i++) nested = `\x30\x80${nested}\x00\x00`;
    const res = await postReceipt("rcpt-deep", Buffer.from(nested, "latin1").toString("base64"));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 7103 });
  });
});

describe("restores", () => {
  it("refresh subscription status from Apple when the app has API access", async () => {
    const grace = now() + 5 * DAY;
    await appleHistory({ expires: now() - DAY, status: APPLE_STATUS.GRACE_PERIOD, grace });
    const { jws } = await signTransaction({ transactionId: "3000000005", originalTransactionId: "3000000000", productId: "pro_annual", expiresDate: now() - DAY });
    const res = await postReceipt("restore-user", jws, { is_restore: true });
    expect(res.status).toBe(200);
    expect(res.body.subscriber.entitlements.pro.grace_period_expires_date).toBe(iso(grace));
  });

  it("still succeed when Apple's API is down: the signed transaction stands on its own", async () => {
    for (const host of [PRODUCTION, SANDBOX]) fake.onMatch(host, "GET", /^\/inApps\//, () => ({ status: 503, body: {} }));
    const { jws } = await signTransaction({ productId: "pro_monthly" });
    const res = await postReceipt("restore-down", jws, { is_restore: true });
    expect(res.status).toBe(200);
    expect(res.body.subscriber.entitlements.pro.product_identifier).toBe("pro_monthly");
    expect(appleRequests().length).toBeGreaterThan(0);
  });
});
