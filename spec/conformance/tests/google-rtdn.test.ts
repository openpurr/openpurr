// Google Play Real-time Developer Notifications pushed by Pub/Sub: push authentication, and how each
// subscription, one-time and voided-purchase notification changes access and which webhook events
// it sends. Ported from lite/test/google-rtdn.test.ts.

import { beforeEach, describe, expect, it } from "vitest";
import { admin, call, DAY, fake, now, playSubscription, postGoogleNotification, pubsubToken, PUSH_ACCOUNT, reset, settle, withGooglePlay, withWebhooks } from "../src";

/** A Play API whose subscription and product answers tests change between notifications, and a webhook receiver. */
function google() {
  const store = fake.googleStore();
  return {
    ...store,
    notify: postGoogleNotification,
    sub: (token: string, type: number) => postGoogleNotification({ subscriptionNotification: { version: "1.0", notificationType: type, purchaseToken: token } }),
    receipt: (user: string, token: string, productId = "pro", basePlanId = "monthly") =>
      call("/v1/receipts", {
        platform: "android",
        body: { app_user_id: user, fetch_token: token, product_ids: [productId], platform_product_ids: [{ product_id: productId, base_plan_id: basePlanId }] },
      }),
    info: async (user: string) => (await call(`/v1/subscribers/${user}`, { platform: "android" })).body.subscriber,
    /** Webhook events received so far (after letting deferred deliveries finish). */
    events: async () => {
      await settle();
      return fake.events("backend");
    },
    types: async () => (await settle(), fake.events("backend").map((e) => e.type)),
  };
}

beforeEach(async () => {
  await reset(withWebhooks(withGooglePlay()));
});

describe("push authentication", () => {
  it("accepts only a valid Pub/Sub token from the configured push account and audience", async () => {
    const g = google();
    const test = { testNotification: { version: "1.0" } };
    expect((await g.notify(test)).status).toBe(200);
    expect((await g.notify(test, { token: null })).status).toBe(401);
    expect((await g.notify(test, { token: await pubsubToken({ aud: "https://elsewhere.example/hook" }) })).status).toBe(401);
    expect((await g.notify(test, { token: await pubsubToken({ email: "someone@else.iam.gserviceaccount.com" }) })).status).toBe(401);
    expect((await g.notify(test, { token: await pubsubToken({ exp: Math.floor(now() / 1000) - 3600 }) })).status).toBe(401);
    expect((await g.notify(test, { token: await pubsubToken({ iss: "https://evil.example" }) })).status).toBe(401);
    expect((await g.notify(test, { token: await pubsubToken({}, { kid: "unknown-kid" }) })).status).toBe(401);
    const good = await pubsubToken();
    const [h, p] = good.split(".");
    expect((await g.notify(test, { token: `${h}.${p}.AAAA` })).status).toBe(401);
    expect(PUSH_ACCOUNT).toMatch(/@/);
  });

  it("acknowledges malformed messages (so Pub/Sub stops retrying) and answers 5xx for an unknown package", async () => {
    const g = google();
    expect((await g.notify({}, { rawData: "%%%not base64%%%" })).status).toBe(200);
    expect((await g.notify({ packageName: "com.unknown.app", testNotification: {} })).status).toBe(500);
  });
});

describe("subscription notifications", () => {
  it("records a purchase that arrives before the app posts it; the app's receipt then reports it once", async () => {
    const g = google();
    g.subs.set("rt-1", playSubscription({ orderId: "GPA.1000-0000-0000-00001" }));
    expect((await g.sub("rt-1", 4)).status).toBe(200);
    expect(await g.types()).toEqual([]); // nobody owns it yet
    // The server acknowledged it as a safety net.
    expect(g.requests().some((r) => r.method === "POST" && r.path === "/purchases/subscriptions/pro/tokens/rt-1:acknowledge")).toBe(true);

    await g.receipt("rt-user", "rt-1");
    expect(await g.types()).toEqual(["INITIAL_PURCHASE"]);
    expect((await g.info("rt-user")).entitlements.pro).toBeDefined();
  });

  it("ignores a redelivered message", async () => {
    const g = google();
    g.subs.set("rt-dup", playSubscription({ ack: true }));
    await g.receipt("rt-dup-user", "rt-dup");
    const first = await g.notify({ subscriptionNotification: { notificationType: 3, purchaseToken: "rt-dup" } }, { messageId: "fixed-1" });
    const again = await g.notify({ subscriptionNotification: { notificationType: 3, purchaseToken: "rt-dup" } }, { messageId: "fixed-1" });
    expect(first.status).toBe(200);
    expect(again.body).toEqual({ message: "Already processed." });
  });

  it("RENEWED extends access with the new order", async () => {
    const g = google();
    g.subs.set("rt-renew", playSubscription({ ack: true, orderId: "GPA.2000-0000-0000-00001", expiry: now() + DAY }));
    await g.receipt("rt-renew-user", "rt-renew");
    const newExpiry = now() + 31 * DAY;
    g.subs.set("rt-renew", playSubscription({ ack: true, orderId: "GPA.2000-0000-0000-00001..0", expiry: newExpiry }));
    await g.sub("rt-renew", 2);
    expect(await g.types()).toEqual(["INITIAL_PURCHASE", "RENEWAL"]);
    expect(Date.parse((await g.info("rt-renew-user")).entitlements.pro.expires_date)).toBe(Math.floor(newExpiry / 1000) * 1000);
  });

  it("grace period then account hold: one billing issue, then access ends", async () => {
    const g = google();
    g.subs.set("rt-bill", playSubscription({ ack: true, orderId: "GPA.3000-0000-0000-00001" }));
    await g.receipt("rt-bill-user", "rt-bill");
    const mark = (await g.events()).length;

    const graceEnd = now() + 3 * DAY;
    g.subs.set("rt-bill", playSubscription({ ack: true, orderId: "GPA.3000-0000-0000-00001", state: "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", expiry: graceEnd }));
    await g.sub("rt-bill", 6);
    let sub = (await g.info("rt-bill-user")).subscriptions.pro;
    expect(sub.billing_issues_detected_at).not.toBeNull();
    expect(sub.grace_period_expires_date).not.toBeNull();

    g.subs.set("rt-bill", playSubscription({ ack: true, orderId: "GPA.3000-0000-0000-00001", state: "SUBSCRIPTION_STATE_ON_HOLD", expiry: now() - 1000 }));
    await g.sub("rt-bill", 5);
    expect((await g.events()).slice(mark).map((e) => e.type)).toEqual(["BILLING_ISSUE", "CANCELLATION", "EXPIRATION"]);
    sub = (await g.info("rt-bill-user")).subscriptions.pro;
    expect(Date.parse(sub.expires_date)).toBeLessThan(now());
  });

  it("a user cancellation: CANCELLATION (UNSUBSCRIBE) and unsubscribe_detected_at", async () => {
    const g = google();
    g.subs.set("rt-cancel", playSubscription({ ack: true }));
    await g.receipt("rt-cancel-user", "rt-cancel");
    g.subs.set("rt-cancel", { ...playSubscription({ ack: true, state: "SUBSCRIPTION_STATE_CANCELED", autoRenew: false }), canceledStateContext: { userInitiatedCancellation: {} } });
    await g.sub("rt-cancel", 3);
    expect((await g.events()).at(-1)).toMatchObject({ type: "CANCELLATION", cancel_reason: "UNSUBSCRIBE" });
    expect((await g.info("rt-cancel-user")).subscriptions.pro.unsubscribe_detected_at).not.toBeNull();
  });

  it("pauses: SUBSCRIPTION_PAUSED when scheduled, EXPIRATION when it starts, with auto_resume_date", async () => {
    const g = google();
    g.subs.set("rt-pause", playSubscription({ ack: true }));
    await g.receipt("rt-pause-user", "rt-pause");
    const resume = now() + 30 * DAY;
    g.subs.set("rt-pause", playSubscription({ ack: true, autoResume: resume }));
    await g.sub("rt-pause", 11);
    g.subs.set("rt-pause", playSubscription({ ack: true, state: "SUBSCRIPTION_STATE_PAUSED", expiry: now() - 1000, autoResume: resume }));
    await g.sub("rt-pause", 10);
    const events = (await g.events()).slice(1);
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
    expect((await g.events()).at(-1)).toMatchObject({ type: "CANCELLATION", cancel_reason: "CUSTOMER_SUPPORT", price_in_purchased_currency: -4.99 });
    expect(Date.parse((await g.info("rt-revoke-user")).entitlements.pro.expires_date)).toBeLessThanOrEqual(now());
  });

  it("a plan change by notification: the new token inherits the owner; PRODUCT_CHANGE + INITIAL_PURCHASE", async () => {
    const g = google();
    g.subs.set("rt-old", playSubscription({ ack: true, basePlanId: "monthly", orderId: "GPA.5000-0000-0000-00001" }));
    await g.receipt("rt-change-user", "rt-old");
    const mark = (await g.events()).length;
    g.subs.set("rt-new", playSubscription({ ack: true, basePlanId: "annual", orderId: "GPA.5000-0000-0000-00002", linkedPurchaseToken: "rt-old", expiry: now() + 365 * DAY }));
    await g.sub("rt-new", 4);
    expect((await g.events()).slice(mark).map((e) => [e.type, e.new_product_id ?? null])).toEqual([
      ["PRODUCT_CHANGE", "pro:annual"],
      ["INITIAL_PURCHASE", null],
    ]);
    expect((await g.info("rt-change-user")).entitlements.pro.product_plan_identifier).toBe("annual");
  });

  it("ignores a token Google no longer knows", async () => {
    const g = google();
    const res = await g.sub("rt-gone", 2);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "Ignored: Google no longer knows this purchase." });
  });
});

describe("one-time and voided purchases", () => {
  it("a one-time purchase: NON_RENEWING_PURCHASE; a voided order: refund", async () => {
    const g = google();
    g.products.set("ot-1", { orderId: "GPA.6000-0000-0000-00001", purchaseTimeMillis: String(now()), purchaseState: 0, acknowledgementState: 1, purchaseType: 0 });
    await call("/v1/receipts", { platform: "android", body: { app_user_id: "ot-user", fetch_token: "ot-1", product_ids: ["lifetime"] } });
    await g.notify({ oneTimeProductNotification: { version: "1.0", notificationType: 1, purchaseToken: "ot-1", sku: "lifetime" } });
    expect(await g.types()).toEqual(["NON_RENEWING_PURCHASE"]); // one event, whichever reported it first

    await g.notify({ voidedPurchaseNotification: { purchaseToken: "ot-1", orderId: "GPA.6000-0000-0000-00001", productType: 2, refundType: 1 } });
    expect((await g.events()).at(-1)).toMatchObject({ type: "CANCELLATION", cancel_reason: "CUSTOMER_SUPPORT" });
    expect((await g.info("ot-user")).entitlements).toEqual({});
    const { transactions } = (await admin("GET", "/customers/ot-user")).body;
    expect(transactions.find((t: any) => t.transaction_id === "GPA.6000-0000-0000-00001")).toMatchObject({ revocation_reason: "voided" });
  });
});
