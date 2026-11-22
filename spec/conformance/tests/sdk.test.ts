// Drives the SDK API the way the SDKs do (headers and bodies per spec/sdk-wire-contract.md) and
// checks every response against the keys each platform requires. Ported from lite/test/sdk.test.ts.

import { beforeEach, describe, expect, it } from "vitest";
import { admin, advanceClock, ANON, call, DAY, expectValidCustomerInfo, fixtures, now, postAppleTransaction, reset, signJws, signTransaction } from "../src";

const customers = async () => (await admin("GET", "/customers")).body.customers as { app_user_id: string }[];
const transactionsOf = async (appUserId: string) => (await admin("GET", `/customers/${encodeURIComponent(appUserId)}`)).body.transactions as any[];

beforeEach(async () => {
  await reset();
});

describe("auth", () => {
  it("rejects unknown keys with a JSON 7225 error", async () => {
    const res = await call(`/v1/subscribers/${encodeURIComponent(ANON)}`, { key: "appl_wrong_key_0000000" });
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.body).toMatchObject({ code: 7225 });
  });

  it("serves the DEBUG health check without a key", async () => {
    const res = await call("/v1/subscribers/x/health_report_availability", { key: "" });
    expect(res.body).toEqual({ report_logs: false });
  });
});

describe("startup calls", () => {
  it("returns an empty CustomerInfo for a new anonymous user, without writing", async () => {
    // iOS sends $ and : raw; Android percent-encodes them. Both must resolve to the same user.
    for (const path of [`/v1/subscribers/${ANON}`, `/v1/subscribers/${encodeURIComponent(ANON)}`]) {
      const res = await call(path);
      expect(res.status).toBe(200);
      expectValidCustomerInfo(res.body);
      expect(res.body.subscriber.original_app_user_id).toBe(ANON);
      expect(res.body.subscriber.management_url).toBeNull();
    }
    expect(await customers()).toEqual([]);
  });

  it("never answers 304, even when an ETag is sent", async () => {
    const res = await call("/v1/subscribers/u1", { headers: { "x-revenuecat-etag": "abc" } });
    expect(res.status).toBe(200);
  });

  it("serves each app its own packages from the config", async () => {
    const ios = (await call("/v1/subscribers/u1/offerings")).body;
    expect(ios.current_offering_id).toBe("default");
    expect(ios.offerings[0]).toMatchObject({ identifier: "default", description: "Standard", metadata: { headline: "Go Pro" } });
    expect(ios.offerings[0].packages[0]).toEqual({ identifier: "$rc_monthly", platform_product_identifier: "pro_monthly" });

    const android = (await call("/v1/subscribers/u1/offerings", { platform: "android" })).body;
    expect(android.offerings[0].packages[0]).toEqual({
      identifier: "$rc_monthly",
      platform_product_identifier: "pro",
      platform_product_plan_identifier: "monthly",
    });
  });

  it("serves the product entitlement mapping per app, expanding Play base plans", async () => {
    const ios = (await call("/v1/product_entitlement_mapping")).body.product_entitlement_mapping;
    expect(ios.pro_annual).toEqual({ product_identifier: "pro_annual", base_plan_id: null, entitlements: ["pro", "annual_perks"] });
    expect(ios.coins_100).toBeUndefined();

    const android = (await call("/v1/product_entitlement_mapping", { platform: "android" })).body.product_entitlement_mapping;
    expect(android["pro:monthly"]).toEqual({ product_identifier: "pro", base_plan_id: "monthly", entitlements: ["pro"] });
    expect(android["pro:annual"].entitlements).toEqual(["pro", "annual_perks"]);
  });

  it("answers remote config with 204", async () => {
    const res = await call("/v1/config/app", { body: { app_user_id: "u1", fetch_context: "app_start" } });
    expect(res.status).toBe(204);
  });

  it("accepts attributes and events with 200", async () => {
    expect((await call("/v1/subscribers/u1/attributes", { body: { attributes: {} } })).status).toBe(200);
    expect((await call("/v1/events", { body: { events: [] } })).status).toBe(200);
  });
});

describe("App Store purchases", () => {
  it("verifies a StoreKit 2 transaction, records it and grants the entitlement", async () => {
    const { res, payload } = await postAppleTransaction(ANON, { productId: "pro_monthly" });
    expect(res.status).toBe(200);
    expectValidCustomerInfo(res.body);
    expect(res.body.subscriber.entitlements.pro).toMatchObject({
      product_identifier: "pro_monthly",
      expires_date: new Date(payload.expiresDate!).toISOString().replace(/\.\d{3}Z$/, "Z"),
    });
    expect(res.body.subscriber.subscriptions.pro_monthly).toMatchObject({
      store: "app_store",
      is_sandbox: true,
      period_type: "normal",
      store_transaction_id: payload.transactionId,
      price: { amount: 9.99, currency: "USD" },
    });
    expect(res.body.subscriber.management_url).toBe("https://apps.apple.com/account/subscriptions");

    const [tx] = await transactionsOf(ANON);
    expect(tx).toMatchObject({ transaction_id: payload.transactionId, verified: 1, environment: "sandbox" });
  });

  it("is idempotent: posting the same transaction twice stores it once", async () => {
    const { jws, payload } = await signTransaction({ productId: "lifetime", type: "Non-Consumable", expiresDate: undefined });
    for (let i = 0; i < 2; i++) {
      const res = await call("/v1/receipts", { body: { app_user_id: "u-idem", fetch_token: jws } });
      expect(res.status).toBe(200);
    }
    const txs = await transactionsOf("u-idem");
    expect(txs.filter((t) => t.transaction_id === payload.transactionId)).toHaveLength(1);
  });

  it("echoes a consumable's store_transaction_id so StoreKit can finish it", async () => {
    const { res, payload } = await postAppleTransaction("u-coins", { productId: "coins_100", type: "Consumable", expiresDate: undefined });
    expectValidCustomerInfo(res.body);
    expect(res.body.subscriber.non_subscriptions.coins_100[0].store_transaction_id).toBe(payload.transactionId);
    expect(res.body.subscriber.entitlements).toEqual({});
  });

  it("maps free and paid offers to trial and intro", async () => {
    await postAppleTransaction("u-offers", { productId: "pro_monthly", offerType: 1, offerDiscountType: "FREE_TRIAL" });
    const { res } = await postAppleTransaction("u-offers", { productId: "pro_annual", offerType: 3, offerDiscountType: "PAY_UP_FRONT" });
    const subs = res.body.subscriber.subscriptions;
    expect(subs.pro_monthly.period_type).toBe("trial");
    expect(subs.pro_annual.period_type).toBe("intro");
  });

  it("rejects a forged transaction with a 4xx (nothing to retry)", async () => {
    const { jws } = await signTransaction();
    const [h, , s] = jws.split(".");
    const forged = Buffer.from(JSON.stringify({ productId: "lifetime" })).toString("base64url");
    const res = await call("/v1/receipts", { body: { app_user_id: "u-forge", fetch_token: `${h}.${forged}.${s}` } });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 7103 });
    // Rejected before anything is written: no customer.
    expect(await customers()).toEqual([]);
  });

  it("rejects a transaction signed under an untrusted root", async () => {
    const { payload } = await signTransaction();
    const jws = await signJws(payload, { x5c: fixtures.appleStrayX5c });
    const res = await call("/v1/receipts", { body: { app_user_id: "u-stray", fetch_token: jws } });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 7103 });
  });

  it("keeps the purchase queued (5xx) when the product or bundle doesn't match the config", async () => {
    const unknown = await postAppleTransaction("u-cfg", { productId: "not_configured" });
    expect(unknown.res.status).toBe(500);
    const otherBundle = await postAppleTransaction("u-cfg", { bundleId: "com.someone.else" });
    expect(otherBundle.res.status).toBe(500);
    expect(otherBundle.res.body).toMatchObject({ code: 7110 });
  });

  it("keeps StoreKit 1 receipts queued (5xx) until the App Store Server API is wired in", async () => {
    const res = await call("/v1/receipts", { body: { app_user_id: "u-sk1", fetch_token: "MIIT-base64-receipt" } });
    expect(res.status).toBe(503);
  });
});

describe("refunds", () => {
  it("ends a refunded subscription's access at the refund time", async () => {
    const purchaseDate = now() - 5 * DAY;
    const { jws, payload } = await signTransaction({ productId: "pro_monthly", purchaseDate });
    await call("/v1/receipts", { body: { app_user_id: "u-refund", fetch_token: jws } });

    const revoked = purchaseDate + 2 * DAY;
    const { jws: refunded } = await signTransaction({ ...payload, revocationDate: revoked, revocationReason: 0 });
    const body = (await call("/v1/receipts", { body: { app_user_id: "u-refund", fetch_token: refunded } })).body;
    const iso = new Date(revoked).toISOString().replace(/\.\d{3}Z$/, "Z");
    expect(body.subscriber.subscriptions.pro_monthly).toMatchObject({ refunded_at: iso, expires_date: iso });
    expect(body.subscriber.entitlements.pro.expires_date).toBe(iso);
    expect(body.subscriber.management_url).toBeNull();
  });

  it("drops a refunded one-time purchase entirely", async () => {
    const { payload } = await postAppleTransaction("u-refund2", { productId: "lifetime", type: "Non-Consumable", expiresDate: undefined });
    const { jws } = await signTransaction({ ...payload, revocationDate: now() });
    const body = (await call("/v1/receipts", { body: { app_user_id: "u-refund2", fetch_token: jws } })).body;
    expect(body.subscriber.non_subscriptions).toEqual({});
    expect(body.subscriber.entitlements).toEqual({});
  });
});

describe("entitlement selection", () => {
  it("lifetime beats any subscription; the furthest expiry wins otherwise", async () => {
    await postAppleTransaction("u-pick", { productId: "pro_monthly", expiresDate: now() + 10 * DAY });
    let body = (await postAppleTransaction("u-pick", { productId: "pro_annual", expiresDate: now() + 300 * DAY })).res.body;
    expect(body.subscriber.entitlements.pro.product_identifier).toBe("pro_annual");
    expect(body.subscriber.entitlements.annual_perks.product_identifier).toBe("pro_annual");

    body = (await postAppleTransaction("u-pick", { productId: "lifetime", type: "Non-Consumable", expiresDate: undefined })).res.body;
    expect(body.subscriber.entitlements.pro).toMatchObject({ product_identifier: "lifetime", expires_date: null });
  });

  it("keeps expired entitlements, with their past expiry", async () => {
    const purchaseDate = now() - 60 * DAY;
    const body = (await postAppleTransaction("u-expired", { productId: "pro_monthly", purchaseDate, expiresDate: purchaseDate + 30 * DAY })).res.body;
    expect(Date.parse(body.subscriber.entitlements.pro.expires_date)).toBeLessThan(now());
    expect(body.subscriber.management_url).toBeNull();
  });
});

describe("Google Play (unverified, development only)", () => {
  it("keys subscriptions by product with the base plan; marks consumables should_consume", async () => {
    const sub = (
      await call("/v1/receipts", {
        platform: "android",
        body: {
          app_user_id: "u-play",
          fetch_token: "play-token-1",
          product_ids: ["pro"],
          platform_product_ids: [{ product_id: "pro", base_plan_id: "annual", offer_id: null }],
        },
      })
    ).body;
    expectValidCustomerInfo(sub);
    expect(sub.subscriber.subscriptions.pro.product_plan_identifier).toBe("annual");
    expect(sub.subscriber.entitlements.pro.product_plan_identifier).toBe("annual");
    expect(sub.subscriber.entitlements.annual_perks).toBeDefined();
    expect(sub.subscriber.management_url).toBe("https://play.google.com/store/account/subscriptions?sku=pro&package=com.example.openpurr");
    expect(sub.purchased_products).toEqual({ pro: { should_consume: false } });

    const coins = (
      await call("/v1/receipts", { platform: "android", body: { app_user_id: "u-play", fetch_token: "play-token-2", product_ids: ["coins_100"] } })
    ).body;
    expect(coins.purchased_products).toEqual({ coins_100: { should_consume: true } });
  });
});

describe("customers and transfers", () => {
  it("logIn: 201 for a new user, 200 after; anonymous purchases come along", async () => {
    await postAppleTransaction(ANON, { productId: "lifetime", type: "Non-Consumable", expiresDate: undefined });
    const first = await call("/v1/subscribers/identify", { body: { app_user_id: ANON, new_app_user_id: "user@example" } });
    expect(first.status).toBe(201);
    expectValidCustomerInfo(first.body);
    expect(first.body.subscriber.entitlements.pro.product_identifier).toBe("lifetime");
    // The anonymous ID was aliased, so it's still the original.
    expect(first.body.subscriber.original_app_user_id).toBe(ANON);

    const again = await call("/v1/subscribers/identify", { body: { app_user_id: ANON, new_app_user_id: "user@example" } });
    expect(again.status).toBe(200);
    // Both IDs see the same purchases.
    const viaAnon = (await call(`/v1/subscribers/${encodeURIComponent(ANON)}`)).body;
    expect(viaAnon.subscriber.entitlements.pro.product_identifier).toBe("lifetime");
  });

  it("logIn to an existing account merges the anonymous user's purchases into it", async () => {
    await postAppleTransaction("existing@example", { productId: "pro_monthly" });
    const anon = "$RCAnonymousID:ffffffffffffffffffffffffffffffff";
    await postAppleTransaction(anon, { productId: "lifetime", type: "Non-Consumable", expiresDate: undefined });

    const res = await call("/v1/subscribers/identify", { body: { app_user_id: anon, new_app_user_id: "existing@example" } });
    expect(res.status).toBe(200);
    expect(res.body.subscriber.original_app_user_id).toBe("existing@example");
    expect(Object.keys(res.body.subscriber.subscriptions)).toEqual(["pro_monthly"]);
    expect(Object.keys(res.body.subscriber.non_subscriptions)).toEqual(["lifetime"]);
  });

  it("restoring a named user's purchase transfers it (RevenueCat's default)", async () => {
    const { jws } = await signTransaction({ productId: "pro_annual", expiresDate: now() + 300 * DAY });
    await call("/v1/receipts", { body: { app_user_id: "alice", fetch_token: jws } });
    await call("/v1/receipts", { body: { app_user_id: "bob", fetch_token: jws, is_restore: true } });

    const alice = (await call("/v1/subscribers/alice")).body;
    const bob = (await call("/v1/subscribers/bob")).body;
    expect(alice.subscriber.entitlements).toEqual({});
    expect(bob.subscriber.entitlements.pro.product_identifier).toBe("pro_annual");
  });

  it("restoring an anonymous user's purchase merges that anonymous user in", async () => {
    const anon = "$RCAnonymousID:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    const { jws } = await signTransaction({ productId: "pro_monthly" });
    await call("/v1/receipts", { body: { app_user_id: anon, fetch_token: jws } });
    await call("/v1/receipts", { body: { app_user_id: "carol", fetch_token: jws, is_restore: true } });

    const viaAnon = (await call(`/v1/subscribers/${encodeURIComponent(anon)}`)).body;
    expect(viaAnon.subscriber.original_app_user_id).toBe("carol");
    expect(viaAnon.subscriber.entitlements.pro).toBeDefined();
  });
});

describe("clock", () => {
  it("expires a subscription when the server's clock passes its expiry", async () => {
    const { res } = await postAppleTransaction("u-clock", { productId: "pro_monthly", purchaseDate: now() - DAY, expiresDate: now() + DAY });
    expect(Date.parse(res.body.subscriber.entitlements.pro.expires_date)).toBeGreaterThan(now());
    await advanceClock(2 * DAY);
    const later = (await call("/v1/subscribers/u-clock")).body;
    expect(Date.parse(later.request_date)).toBeGreaterThan(Date.parse(later.subscriber.entitlements.pro.expires_date));
    expect(later.subscriber.management_url).toBeNull();
  });
});
