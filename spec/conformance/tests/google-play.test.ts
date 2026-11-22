// Google Play purchases posted by the Android SDK: verification with the Play Developer API, the
// price paid, acknowledgement, upgrades and the errors the SDK acts on. Ported from
// lite/test/google-play.test.ts.

import { beforeEach, describe, expect, it } from "vitest";
import { admin, call, DAY, fake, jobs, now, playSubscription, reset, settle, withGooglePlay } from "../src";

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const transactionsOf = async (appUserId: string) => (await admin("GET", `/customers/${encodeURIComponent(appUserId)}`)).body.transactions as any[];

function postPlay(body: Record<string, unknown>) {
  return call("/v1/receipts", { platform: "android", body });
}

const subscriptionBody = (user: string, token: string, productId = "pro", basePlanId = "monthly") => ({
  app_user_id: user,
  fetch_token: token,
  product_ids: [productId],
  platform_product_ids: [{ product_id: productId, base_plan_id: basePlanId, offer_id: null }],
});

beforeEach(async () => {
  await reset(withGooglePlay());
});

describe("Google Play subscriptions", () => {
  it("verifies with the Play Developer API, records the price paid and acknowledges", async () => {
    const expiry = now() + 30 * DAY;
    const api = fake.google({
      "GET /purchases/subscriptionsv2/tokens/tok-sub-1": () => ({ body: playSubscription({ expiry, orderId: "GPA.0001-0001-0001-00001" }) }),
      "GET /orders/GPA.0001-0001-0001-00001": () => ({ body: { orderId: "GPA.0001-0001-0001-00001", total: { currencyCode: "EUR", units: "4", nanos: 490000000 } } }),
      "POST /purchases/subscriptions/pro/tokens/tok-sub-1:acknowledge": () => ({ body: {} }),
    });
    const res = await postPlay(subscriptionBody("gp-user", "tok-sub-1"));
    expect(res.status).toBe(200);
    expect(res.body.subscriber.subscriptions.pro).toMatchObject({
      store: "play_store",
      is_sandbox: true,
      product_plan_identifier: "monthly",
      expires_date: iso(expiry),
      store_transaction_id: "GPA.0001-0001-0001-00001",
      price: { amount: 4.49, currency: "EUR" },
      period_type: "normal",
    });
    expect(res.body.subscriber.entitlements.pro).toMatchObject({ product_identifier: "pro", product_plan_identifier: "monthly" });
    expect(res.body.purchased_products).toEqual({ pro: { should_consume: false } });
    await settle();
    expect(api.requests().map((r) => `${r.method} ${r.path}`)).toContain("POST /purchases/subscriptions/pro/tokens/tok-sub-1:acknowledge");
  });

  it("falls back to the plan's recurring price when the Orders API isn't allowed, and 0 for a free trial", async () => {
    const api = fake.google({
      "GET /purchases/subscriptionsv2/tokens/tok-sub-2": () => ({ body: playSubscription({ ack: true, orderId: "GPA.0002-0002-0002-00002" }) }),
      "GET /orders/GPA.0002-0002-0002-00002": () => ({ status: 403, body: { error: { message: "The caller does not have permission" } } }),
      "GET /purchases/subscriptionsv2/tokens/tok-trial": () => ({ body: playSubscription({ ack: true, phase: "freeTrial", orderId: "GPA.0003-0003-0003-00003" }) }),
    });
    const sub = (await postPlay(subscriptionBody("gp-price", "tok-sub-2"))).body.subscriber.subscriptions.pro;
    expect(sub.price).toEqual({ amount: 4.99, currency: "USD" });
    const trial = (await postPlay(subscriptionBody("gp-trial", "tok-trial"))).body.subscriber.subscriptions.pro;
    expect(trial).toMatchObject({ period_type: "trial", price: { amount: 0, currency: "USD" } });
    await settle();
    // Already acknowledged: no acknowledge call.
    expect(api.requests().some((r) => r.method === "POST")).toBe(false);
  });

  it("keeps a failed acknowledgement for the scheduled job to retry", async () => {
    let ackStatus = 503;
    const api = fake.google({
      "GET /purchases/subscriptionsv2/tokens/tok-ackfail": () => ({ body: playSubscription({}) }),
      "POST /purchases/subscriptions/pro/tokens/tok-ackfail:acknowledge": () => ({ status: ackStatus, body: {} }),
    });
    expect((await postPlay(subscriptionBody("gp-ack", "tok-ackfail"))).status).toBe(200);
    const acks = () => api.requests().filter((r) => r.path === "/purchases/subscriptions/pro/tokens/tok-ackfail:acknowledge").length;
    const failed = acks();
    expect(failed).toBeGreaterThanOrEqual(1);

    // Google is back: the scheduled job retries it.
    ackStatus = 200;
    await jobs();
    expect(acks()).toBe(failed + 1);
  });

  it("an upgrade (a new token linked to the old one) replaces the old subscription", async () => {
    fake.google({
      "GET /purchases/subscriptionsv2/tokens/tok-monthly": () => ({ body: playSubscription({ ack: true, basePlanId: "monthly", orderId: "GPA.0004-0004-0004-00004" }) }),
      "GET /purchases/subscriptionsv2/tokens/tok-annual": () => ({
        body: playSubscription({ ack: true, basePlanId: "annual", orderId: "GPA.0005-0005-0005-00005", expiry: now() + 365 * DAY, linkedPurchaseToken: "tok-monthly" }),
      }),
    });
    await postPlay(subscriptionBody("gp-upgrade", "tok-monthly", "pro", "monthly"));
    const body = (await postPlay(subscriptionBody("gp-upgrade", "tok-annual", "pro", "annual"))).body;
    expect(body.subscriber.entitlements.pro.product_plan_identifier).toBe("annual");
    expect(body.subscriber.entitlements.annual_perks).toBeDefined();
    const old = (await transactionsOf("gp-upgrade")).find((t) => t.original_transaction_id === "tok-monthly");
    expect(old).toMatchObject({ is_upgraded: 1 });
  });

  it("answers 4xx for a token Google doesn't know, 5xx when Google is down or the purchase is pending", async () => {
    fake.google({
      "GET /purchases/subscriptionsv2/tokens/tok-down": () => ({ status: 503, body: {} }),
      "GET /purchases/subscriptionsv2/tokens/tok-pending": () => ({ body: playSubscription({ state: "SUBSCRIPTION_STATE_PENDING" }) }),
    });
    const unknown = await postPlay(subscriptionBody("gp-err", "tok-unknown"));
    expect(unknown.status).toBe(400);
    expect(unknown.body).toMatchObject({ code: 7103 });
    expect((await postPlay(subscriptionBody("gp-err", "tok-down"))).status).toBe(503);
    expect((await postPlay(subscriptionBody("gp-err", "tok-pending"))).status).toBe(503);
  });

  it("answers 5xx, keeping the purchase on the device, when the service account secret isn't set", async () => {
    // The server's secrets are fixed, so the config names one that isn't set.
    const config = withGooglePlay();
    config.apps.android.google_play_api.service_account_secret = "GOOGLE_SERVICE_ACCOUNT_UNSET";
    await reset(config);
    const res = await postPlay(subscriptionBody("gp-nokey", "tok-x"));
    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/GOOGLE_SERVICE_ACCOUNT_UNSET/);
  });
});

describe("Google Play one-time products", () => {
  it("acknowledges a non-consumable; leaves a consumable to the device, which consumes it", async () => {
    const product = (orderId: string) => ({ orderId, purchaseTimeMillis: String(now() - 1000), purchaseState: 0, acknowledgementState: 0, purchaseType: 0, regionCode: "DE" });
    const api = fake.google({
      "GET /purchases/products/lifetime/tokens/tok-life": () => ({ body: product("GPA.0006-0006-0006-00006") }),
      "POST /purchases/products/lifetime/tokens/tok-life:acknowledge": () => ({ body: {} }),
      "GET /purchases/products/coins_100/tokens/tok-coins": () => ({ body: product("GPA.0007-0007-0007-00007") }),
    });
    const life = (await postPlay({ app_user_id: "gp-otp", fetch_token: "tok-life", product_ids: ["lifetime"] })).body;
    expect(life.subscriber.entitlements.pro).toMatchObject({ product_identifier: "lifetime", expires_date: null });
    expect(life.subscriber.non_subscriptions.lifetime[0]).toMatchObject({ store: "play_store", is_sandbox: true, store_transaction_id: "GPA.0006-0006-0006-00006" });
    expect(life.purchased_products).toEqual({ lifetime: { should_consume: false } });

    const coins = (await postPlay({ app_user_id: "gp-otp", fetch_token: "tok-coins", product_ids: ["coins_100"] })).body;
    expect(coins.purchased_products).toEqual({ coins_100: { should_consume: true } });
    await settle();
    const posts = api.requests().filter((r) => r.method === "POST").map((r) => r.path);
    expect(posts).toEqual(["/purchases/products/lifetime/tokens/tok-life:acknowledge"]);
  });

  it("doesn't grant a refunded (canceled) one-time purchase", async () => {
    fake.google({
      "GET /purchases/products/lifetime/tokens/tok-refunded": () => ({
        body: { orderId: "GPA.0008-0008-0008-00008", purchaseTimeMillis: String(now() - DAY), purchaseState: 1, acknowledgementState: 1 },
      }),
    });
    const body = (await postPlay({ app_user_id: "gp-refunded", fetch_token: "tok-refunded", product_ids: ["lifetime"] })).body;
    expect(body.subscriber.entitlements).toEqual({});
  });
});
