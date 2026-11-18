import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { appWithGooglePlay, call, envWithGoogleKey, fakeGoogleApi, playSubscription } from "./helpers";

const DAY = 864e5;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

function postPlay(app: ReturnType<typeof appWithGooglePlay>, body: Record<string, unknown>, envOverride: object = envWithGoogleKey()) {
  return call("/v1/receipts", { platform: "android", app, env: envOverride, body });
}

const subscriptionBody = (user: string, token: string, productId = "pro", basePlanId = "monthly") => ({
  app_user_id: user,
  fetch_token: token,
  product_ids: [productId],
  platform_product_ids: [{ product_id: productId, base_plan_id: basePlanId, offer_id: null }],
});

describe("Google Play subscriptions", () => {
  it("verifies with the Play Developer API, records the price paid and acknowledges", async () => {
    const expiry = Date.now() + 30 * DAY;
    const api = fakeGoogleApi({
      "GET /purchases/subscriptionsv2/tokens/tok-sub-1": () => ({ body: playSubscription({ expiry, orderId: "GPA.0001-0001-0001-00001" }) }),
      "GET /orders/GPA.0001-0001-0001-00001": () => ({ body: { orderId: "GPA.0001-0001-0001-00001", total: { currencyCode: "EUR", units: "4", nanos: 490000000 } } }),
      "POST /purchases/subscriptions/pro/tokens/tok-sub-1:acknowledge": () => ({ body: {} }),
    });
    const res = await postPlay(appWithGooglePlay(api), subscriptionBody("gp-user", "tok-sub-1"));
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.subscriber.subscriptions.pro).toMatchObject({
      store: "play_store",
      is_sandbox: true,
      product_plan_identifier: "monthly",
      expires_date: iso(expiry),
      store_transaction_id: "GPA.0001-0001-0001-00001",
      price: { amount: 4.49, currency: "EUR" },
      period_type: "normal",
    });
    expect(body.subscriber.entitlements.pro).toMatchObject({ product_identifier: "pro", product_plan_identifier: "monthly" });
    expect(body.purchased_products).toEqual({ pro: { should_consume: false } });
    expect(api.requests.map((r) => `${r.method} ${r.path}`)).toContain("POST /purchases/subscriptions/pro/tokens/tok-sub-1:acknowledge");
  });

  it("falls back to the plan's recurring price when the Orders API isn't allowed, and 0 for a free trial", async () => {
    const api = fakeGoogleApi({
      "GET /purchases/subscriptionsv2/tokens/tok-sub-2": () => ({ body: playSubscription({ ack: true, orderId: "GPA.0002-0002-0002-00002" }) }),
      "GET /orders/GPA.0002-0002-0002-00002": () => ({ status: 403, body: { error: { message: "The caller does not have permission" } } }),
      "GET /purchases/subscriptionsv2/tokens/tok-trial": () => ({ body: playSubscription({ ack: true, phase: "freeTrial", orderId: "GPA.0003-0003-0003-00003" }) }),
    });
    const app = appWithGooglePlay(api);
    const sub = (await (await postPlay(app, subscriptionBody("gp-price", "tok-sub-2"))).json<any>()).subscriber.subscriptions.pro;
    expect(sub.price).toEqual({ amount: 4.99, currency: "USD" });
    const trial = (await (await postPlay(app, subscriptionBody("gp-trial", "tok-trial"))).json<any>()).subscriber.subscriptions.pro;
    expect(trial).toMatchObject({ period_type: "trial", price: { amount: 0, currency: "USD" } });
    // Already acknowledged: no acknowledge call.
    expect(api.requests.some((r) => r.method === "POST")).toBe(false);
  });

  it("keeps a failed acknowledgement for the scheduled job to retry", async () => {
    const api = fakeGoogleApi({
      "GET /purchases/subscriptionsv2/tokens/tok-ackfail": () => ({ body: playSubscription({}) }),
      "POST /purchases/subscriptions/pro/tokens/tok-ackfail:acknowledge": () => ({ status: 503, body: {} }),
    });
    expect((await postPlay(appWithGooglePlay(api), subscriptionBody("gp-ack", "tok-ackfail"))).status).toBe(200);
    const row = await env.DB.prepare("SELECT kind, product_id, attempts FROM play_ack_pending WHERE purchase_token = 'tok-ackfail'").first();
    expect(row).toEqual({ kind: "subscription", product_id: "pro", attempts: 1 });
  });

  it("an upgrade (a new token linked to the old one) replaces the old subscription", async () => {
    const api = fakeGoogleApi({
      "GET /purchases/subscriptionsv2/tokens/tok-monthly": () => ({ body: playSubscription({ ack: true, basePlanId: "monthly", orderId: "GPA.0004-0004-0004-00004" }) }),
      "GET /purchases/subscriptionsv2/tokens/tok-annual": () => ({
        body: playSubscription({ ack: true, basePlanId: "annual", orderId: "GPA.0005-0005-0005-00005", expiry: Date.now() + 365 * DAY, linkedPurchaseToken: "tok-monthly" }),
      }),
    });
    const app = appWithGooglePlay(api);
    await postPlay(app, subscriptionBody("gp-upgrade", "tok-monthly", "pro", "monthly"));
    const body = await (await postPlay(app, subscriptionBody("gp-upgrade", "tok-annual", "pro", "annual"))).json<any>();
    expect(body.subscriber.entitlements.pro.product_plan_identifier).toBe("annual");
    expect(body.subscriber.entitlements.annual_perks).toBeDefined();
    const old = await env.DB.prepare("SELECT is_upgraded FROM store_transaction WHERE original_transaction_id = 'tok-monthly'").first();
    expect(old).toEqual({ is_upgraded: 1 });
  });

  it("answers 4xx for a token Google doesn't know, 5xx when Google is down or the purchase is pending", async () => {
    const api = fakeGoogleApi({
      "GET /purchases/subscriptionsv2/tokens/tok-down": () => ({ status: 503, body: {} }),
      "GET /purchases/subscriptionsv2/tokens/tok-pending": () => ({ body: playSubscription({ state: "SUBSCRIPTION_STATE_PENDING" }) }),
    });
    const app = appWithGooglePlay(api);
    const unknown = await postPlay(app, subscriptionBody("gp-err", "tok-unknown"));
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ code: 7103 });
    expect((await postPlay(app, subscriptionBody("gp-err", "tok-down"))).status).toBe(503);
    expect((await postPlay(app, subscriptionBody("gp-err", "tok-pending"))).status).toBe(503);
  });

  it("answers 5xx, keeping the purchase on the device, when the service account secret isn't set", async () => {
    const res = await postPlay(appWithGooglePlay(fakeGoogleApi({})), subscriptionBody("gp-nokey", "tok-x"), env);
    expect(res.status).toBe(503);
    expect((await res.json<any>()).message).toMatch(/GOOGLE_SERVICE_ACCOUNT/);
  });
});

describe("Google Play one-time products", () => {
  it("acknowledges a non-consumable; leaves a consumable to the device, which consumes it", async () => {
    const product = (orderId: string) => ({ orderId, purchaseTimeMillis: String(Date.now() - 1000), purchaseState: 0, acknowledgementState: 0, purchaseType: 0, regionCode: "DE" });
    const api = fakeGoogleApi({
      "GET /purchases/products/lifetime/tokens/tok-life": () => ({ body: product("GPA.0006-0006-0006-00006") }),
      "POST /purchases/products/lifetime/tokens/tok-life:acknowledge": () => ({ body: {} }),
      "GET /purchases/products/coins_100/tokens/tok-coins": () => ({ body: product("GPA.0007-0007-0007-00007") }),
    });
    const app = appWithGooglePlay(api);
    const life = await (await postPlay(app, { app_user_id: "gp-otp", fetch_token: "tok-life", product_ids: ["lifetime"] })).json<any>();
    expect(life.subscriber.entitlements.pro).toMatchObject({ product_identifier: "lifetime", expires_date: null });
    expect(life.subscriber.non_subscriptions.lifetime[0]).toMatchObject({ store: "play_store", is_sandbox: true, store_transaction_id: "GPA.0006-0006-0006-00006" });
    expect(life.purchased_products).toEqual({ lifetime: { should_consume: false } });

    const coins = await (await postPlay(app, { app_user_id: "gp-otp", fetch_token: "tok-coins", product_ids: ["coins_100"] })).json<any>();
    expect(coins.purchased_products).toEqual({ coins_100: { should_consume: true } });
    const posts = api.requests.filter((r) => r.method === "POST").map((r) => r.path);
    expect(posts).toEqual(["/purchases/products/lifetime/tokens/tok-life:acknowledge"]);
  });

  it("doesn't grant a refunded (canceled) one-time purchase", async () => {
    const api = fakeGoogleApi({
      "GET /purchases/products/lifetime/tokens/tok-refunded": () => ({
        body: { orderId: "GPA.0008-0008-0008-00008", purchaseTimeMillis: String(Date.now() - DAY), purchaseState: 1, acknowledgementState: 1 },
      }),
    });
    const body = await (await postPlay(appWithGooglePlay(api), { app_user_id: "gp-refunded", fetch_token: "tok-refunded", product_ids: ["lifetime"] })).json<any>();
    expect(body.subscriber.entitlements).toEqual({});
  });
});
