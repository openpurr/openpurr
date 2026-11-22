import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { clearGoogleKeys } from "../src/lib/google-oidc";
import {
  appWithGooglePlay,
  call,
  envWithGoogleKey,
  fakeGoogleApi,
  playSubscription,
  postGoogleNotification,
  pubsubSigner,
  PUSH_ACCOUNT,
  webhookReceiver,
} from "./helpers";

const DAY = 864e5;

/** A fake Google whose subscription and product answers tests can change between notifications. */
function google() {
  const subs = new Map<string, unknown>();
  const products = new Map<string, unknown>();
  const api = fakeGoogleApi({});
  const base = api.fetch;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const m = /\/purchases\/subscriptionsv2\/tokens\/([^/]+)$/.exec(decodeURIComponent(url.pathname));
    if (m && subs.has(m[1]!)) return Response.json(subs.get(m[1]!));
    const p = /\/purchases\/products\/([^/]+)\/tokens\/([^/:]+)$/.exec(decodeURIComponent(url.pathname));
    if (p && products.has(p[2]!)) return Response.json(products.get(p[2]!));
    if (/:acknowledge$/.test(url.pathname)) {
      api.requests.push({ method: "POST", path: decodeURIComponent(url.pathname).replace(/.*\/applications\/[^/]+/, "") });
      return Response.json({});
    }
    return base(input, init);
  }) as typeof fetch;
  const receiver = webhookReceiver();
  const app = appWithGooglePlay({ fetch: fetchImpl }, receiver);
  return {
    subs,
    products,
    api,
    receiver,
    app,
    notify: (n: Record<string, unknown>, opts?: Parameters<typeof postGoogleNotification>[2]) => postGoogleNotification(app, n, opts),
    sub: (token: string, type: number) => postGoogleNotification(app, { subscriptionNotification: { version: "1.0", notificationType: type, purchaseToken: token } }),
    receipt: (user: string, token: string, productId = "pro", basePlanId = "monthly") =>
      call("/v1/receipts", {
        platform: "android",
        app,
        env: envWithGoogleKey(),
        body: { app_user_id: user, fetch_token: token, product_ids: [productId], platform_product_ids: [{ product_id: productId, base_plan_id: basePlanId }] },
      }),
    info: async (user: string) => (await (await call(`/v1/subscribers/${user}`, { platform: "android", app })).json<any>()).subscriber,
    types: () => receiver.events().map((e) => e.type),
  };
}

beforeEach(() => clearGoogleKeys());

describe("push authentication", () => {
  it("accepts only a valid Pub/Sub token from the configured push account and audience", async () => {
    const g = google();
    const signer = pubsubSigner();
    const test = { testNotification: { version: "1.0" } };
    expect((await g.notify(test)).status).toBe(200);
    expect((await g.notify(test, { token: null })).status).toBe(401);
    expect((await g.notify(test, { token: await signer.token({ aud: "https://elsewhere.example/hook" }) })).status).toBe(401);
    expect((await g.notify(test, { token: await signer.token({ email: "someone@else.iam.gserviceaccount.com" }) })).status).toBe(401);
    expect((await g.notify(test, { token: await signer.token({ exp: Math.floor(Date.now() / 1000) - 3600 }) })).status).toBe(401);
    expect((await g.notify(test, { token: await signer.token({ iss: "https://evil.example" }) })).status).toBe(401);
    expect((await g.notify(test, { token: await signer.token({}, { kid: "unknown-kid" }) })).status).toBe(401);
    const good = await signer.token();
    const [h, p] = good.split(".");
    expect((await g.notify(test, { token: `${h}.${p}.AAAA` })).status).toBe(401);
    expect((await g.notify(test, { token: `${h}.${p}.%%%` })).status).toBe(401);
    // A header that decodes to null (JSON, but not an object).
    expect((await g.notify(test, { token: `${btoa("null")}.${p}.AAAA` })).status).toBe(401);
    expect(PUSH_ACCOUNT).toMatch(/@/);
  });

  it("acknowledges malformed messages (so Pub/Sub stops retrying) and answers 5xx for an unknown package", async () => {
    const g = google();
    expect((await g.notify({}, { rawData: "%%%not base64%%%" })).status).toBe(200);
    // JSON, but not a notification: null, not an object, or no package name.
    for (const data of ["null", "42", '"text"', "[]", '{"testNotification":{}}']) {
      const res = await g.notify({}, { rawData: btoa(data) });
      expect([data, res.status, await res.json()]).toEqual([data, 200, { message: "Ignored: malformed message." }]);
    }
    expect((await g.notify({ packageName: "com.unknown.app", testNotification: {} })).status).toBe(500);
  });
});

describe("subscription notifications", () => {
  it("records a purchase that arrives before the app posts it; the app's receipt then reports it once", async () => {
    const g = google();
    g.subs.set("rt-1", playSubscription({ orderId: "GPA.1000-0000-0000-00001" }));
    expect((await g.sub("rt-1", 4)).status).toBe(200);
    expect(g.types()).toEqual([]); // nobody owns it yet
    // The server acknowledged it as a safety net.
    expect(g.api.requests.some((r) => r.path === "/purchases/subscriptions/pro/tokens/rt-1:acknowledge")).toBe(true);

    await g.receipt("rt-user", "rt-1");
    expect(g.types()).toEqual(["INITIAL_PURCHASE"]);
    expect((await g.info("rt-user")).entitlements.pro).toBeDefined();
  });

  it("ignores a redelivered message", async () => {
    const g = google();
    g.subs.set("rt-dup", playSubscription({ ack: true }));
    await g.receipt("rt-dup-user", "rt-dup");
    const first = await g.notify({ subscriptionNotification: { notificationType: 3, purchaseToken: "rt-dup" } }, { messageId: "fixed-1" });
    const again = await g.notify({ subscriptionNotification: { notificationType: 3, purchaseToken: "rt-dup" } }, { messageId: "fixed-1" });
    expect(first.status).toBe(200);
    expect(await again.json()).toEqual({ message: "Already processed." });
  });

  it("RENEWED extends access with the new order", async () => {
    const g = google();
    g.subs.set("rt-renew", playSubscription({ ack: true, orderId: "GPA.2000-0000-0000-00001", expiry: Date.now() + DAY }));
    await g.receipt("rt-renew-user", "rt-renew");
    const newExpiry = Date.now() + 31 * DAY;
    g.subs.set("rt-renew", playSubscription({ ack: true, orderId: "GPA.2000-0000-0000-00001..0", expiry: newExpiry }));
    await g.sub("rt-renew", 2);
    expect(g.types()).toEqual(["INITIAL_PURCHASE", "RENEWAL"]);
    expect(Date.parse((await g.info("rt-renew-user")).entitlements.pro.expires_date)).toBe(Math.floor(newExpiry / 1000) * 1000);
  });

  it("grace period then account hold: one billing issue, then access ends", async () => {
    const g = google();
    g.subs.set("rt-bill", playSubscription({ ack: true, orderId: "GPA.3000-0000-0000-00001" }));
    await g.receipt("rt-bill-user", "rt-bill");
    g.receiver.received.length = 0;

    const graceEnd = Date.now() + 3 * DAY;
    g.subs.set("rt-bill", playSubscription({ ack: true, orderId: "GPA.3000-0000-0000-00001", state: "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", expiry: graceEnd }));
    await g.sub("rt-bill", 6);
    let sub = (await g.info("rt-bill-user")).subscriptions.pro;
    expect(sub.billing_issues_detected_at).not.toBeNull();
    expect(sub.grace_period_expires_date).not.toBeNull();

    g.subs.set("rt-bill", playSubscription({ ack: true, orderId: "GPA.3000-0000-0000-00001", state: "SUBSCRIPTION_STATE_ON_HOLD", expiry: Date.now() - 1000 }));
    await g.sub("rt-bill", 5);
    expect(g.types()).toEqual(["BILLING_ISSUE", "CANCELLATION", "EXPIRATION"]);
    sub = (await g.info("rt-bill-user")).subscriptions.pro;
    expect(Date.parse(sub.expires_date)).toBeLessThan(Date.now());
  });

  it("a user cancellation: CANCELLATION (UNSUBSCRIBE) and unsubscribe_detected_at", async () => {
    const g = google();
    g.subs.set("rt-cancel", playSubscription({ ack: true }));
    await g.receipt("rt-cancel-user", "rt-cancel");
    g.subs.set("rt-cancel", { ...playSubscription({ ack: true, state: "SUBSCRIPTION_STATE_CANCELED", autoRenew: false }), canceledStateContext: { userInitiatedCancellation: {} } });
    await g.sub("rt-cancel", 3);
    expect(g.receiver.events().at(-1)).toMatchObject({ type: "CANCELLATION", cancel_reason: "UNSUBSCRIBE" });
    expect((await g.info("rt-cancel-user")).subscriptions.pro.unsubscribe_detected_at).not.toBeNull();
  });

  it("pauses: SUBSCRIPTION_PAUSED when scheduled, EXPIRATION when it starts, with auto_resume_date", async () => {
    const g = google();
    g.subs.set("rt-pause", playSubscription({ ack: true }));
    await g.receipt("rt-pause-user", "rt-pause");
    const resume = Date.now() + 30 * DAY;
    g.subs.set("rt-pause", playSubscription({ ack: true, autoResume: resume }));
    await g.sub("rt-pause", 11);
    g.subs.set("rt-pause", playSubscription({ ack: true, state: "SUBSCRIPTION_STATE_PAUSED", expiry: Date.now() - 1000, autoResume: resume }));
    await g.sub("rt-pause", 10);
    const events = g.receiver.events().slice(1);
    expect(events.map((e) => [e.type, e.expiration_reason ?? null])).toEqual([
      ["SUBSCRIPTION_PAUSED", null],
      ["EXPIRATION", "SUBSCRIPTION_PAUSED"],
    ]);
    expect(events[0].auto_resume_at_ms).toBe(resume);
    expect((await g.info("rt-pause-user")).subscriptions.pro.auto_resume_date).not.toBeNull();
  });

  it("a revocation (refund) ends access and reports a negative price", async () => {
    const g = google();
    g.subs.set("rt-revoke", playSubscription({ ack: true, orderId: "GPA.4000-0000-0000-00001" }));
    await g.receipt("rt-revoke-user", "rt-revoke");
    g.subs.set("rt-revoke", playSubscription({ ack: true, orderId: "GPA.4000-0000-0000-00001", state: "SUBSCRIPTION_STATE_EXPIRED" }));
    await g.sub("rt-revoke", 12);
    expect(g.receiver.events().at(-1)).toMatchObject({ type: "CANCELLATION", cancel_reason: "CUSTOMER_SUPPORT", price_in_purchased_currency: -4.99 });
    expect(Date.parse((await g.info("rt-revoke-user")).entitlements.pro.expires_date)).toBeLessThanOrEqual(Date.now());
  });

  it("a plan change by notification: the new token inherits the owner; PRODUCT_CHANGE + INITIAL_PURCHASE", async () => {
    const g = google();
    g.subs.set("rt-old", playSubscription({ ack: true, basePlanId: "monthly", orderId: "GPA.5000-0000-0000-00001" }));
    await g.receipt("rt-change-user", "rt-old");
    g.receiver.received.length = 0;
    g.subs.set("rt-new", playSubscription({ ack: true, basePlanId: "annual", orderId: "GPA.5000-0000-0000-00002", linkedPurchaseToken: "rt-old", expiry: Date.now() + 365 * DAY }));
    await g.sub("rt-new", 4);
    expect(g.receiver.events().map((e) => [e.type, e.new_product_id ?? null])).toEqual([
      ["PRODUCT_CHANGE", "pro:annual"],
      ["INITIAL_PURCHASE", null],
    ]);
    expect((await g.info("rt-change-user")).entitlements.pro.product_plan_identifier).toBe("annual");
  });

  it("a notification that links a token to another customer's invalidates that customer's snapshot", async () => {
    const g = google();
    g.subs.set("rt-a", playSubscription({ ack: true, orderId: "GPA.5100-0000-0000-00001" }));
    g.subs.set("rt-b", playSubscription({ ack: true, orderId: "GPA.5100-0000-0000-00002" }));
    await g.receipt("rt-first", "rt-a");
    await g.receipt("rt-second", "rt-b");
    expect((await g.info("rt-first")).entitlements.pro).toBeDefined();
    // Google now reports rt-b as replacing rt-a.
    g.subs.set("rt-b", playSubscription({ ack: true, orderId: "GPA.5100-0000-0000-00002", linkedPurchaseToken: "rt-a" }));
    expect((await g.sub("rt-b", 2)).status).toBe(200);
    expect((await g.info("rt-first")).entitlements.pro).toBeUndefined();
  });

  it("ignores a token Google no longer knows", async () => {
    const g = google();
    const res = await g.sub("rt-gone", 2);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "Ignored: Google no longer knows this purchase." });
  });
});

describe("one-time and voided purchases", () => {
  it("a one-time purchase: NON_RENEWING_PURCHASE; a voided order: refund", async () => {
    const g = google();
    g.products.set("ot-1", { orderId: "GPA.6000-0000-0000-00001", purchaseTimeMillis: String(Date.now()), purchaseState: 0, acknowledgementState: 1, purchaseType: 0 });
    await call("/v1/receipts", { platform: "android", app: g.app, env: envWithGoogleKey(), body: { app_user_id: "ot-user", fetch_token: "ot-1", product_ids: ["lifetime"] } });
    await g.notify({ oneTimeProductNotification: { version: "1.0", notificationType: 1, purchaseToken: "ot-1", sku: "lifetime" } });
    expect(g.types()).toEqual(["NON_RENEWING_PURCHASE"]); // one event, whichever reported it first

    await g.notify({ voidedPurchaseNotification: { purchaseToken: "ot-1", orderId: "GPA.6000-0000-0000-00001", productType: 2, refundType: 1 } });
    expect(g.receiver.events().at(-1)).toMatchObject({ type: "CANCELLATION", cancel_reason: "CUSTOMER_SUPPORT" });
    expect((await g.info("ot-user")).entitlements).toEqual({});
    const row = await env.DB.prepare("SELECT revocation_reason FROM store_transaction WHERE transaction_id = 'GPA.6000-0000-0000-00001'").first();
    expect(row).toEqual({ revocation_reason: "voided" });
  });
});
