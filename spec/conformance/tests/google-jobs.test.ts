// Scheduled Google Play work, run through jobs(): retrying failed acknowledgements, and polling the
// voided purchases API for refunds whose notification was missed. Ported from
// lite/test/google-jobs.test.ts.

import { beforeEach, describe, expect, it } from "vitest";
import { advanceClock, call, DAY, fake, jobs, now, playSubscription, reset, withGooglePlay, withWebhooks } from "../src";

const receipt = (user: string, token: string) =>
  call("/v1/receipts", {
    platform: "android",
    body: { app_user_id: user, fetch_token: token, product_ids: ["pro"], platform_product_ids: [{ product_id: "pro", base_plan_id: "monthly" }] },
  });

beforeEach(async () => {
  await reset(withWebhooks(withGooglePlay()));
});

describe("Google Play scheduled jobs", () => {
  it("retry failed acknowledgements, and drop ones too old to matter", async () => {
    let ackStatus = 503;
    const api = fake.google({
      "GET /purchases/subscriptionsv2/tokens/ack-stale": () => ({ body: playSubscription({}) }),
      "GET /purchases/subscriptionsv2/tokens/ack-retry": () => ({ body: playSubscription({}) }),
      "POST /purchases/subscriptions/pro/tokens/ack-stale:acknowledge": () => ({ status: ackStatus, body: {} }),
      "POST /purchases/subscriptions/pro/tokens/ack-retry:acknowledge": () => ({ status: ackStatus, body: {} }),
    });
    const acks = (token: string) => api.requests().filter((r) => r.path === `/purchases/subscriptions/pro/tokens/${token}:acknowledge`).length;

    // ack-stale's acknowledgement fails, and stays failed for over 3 days (Google has refunded it by then).
    expect((await receipt("ack-stale-user", "ack-stale")).status).toBe(200);
    await advanceClock(4 * DAY);
    // ack-retry's fails now, and Google comes back.
    expect((await receipt("ack-retry-user", "ack-retry")).status).toBe(200);
    const stale = acks("ack-stale");
    const retry = acks("ack-retry");
    ackStatus = 200;

    await jobs();
    expect(acks("ack-retry")).toBe(retry + 1);
    expect(acks("ack-stale")).toBe(stale);

    // Both are gone: nothing is retried again.
    await jobs();
    expect(acks("ack-retry")).toBe(retry + 1);
    expect(acks("ack-stale")).toBe(stale);
  });

  it("poll voided purchases: refunds a missed order once, with a webhook event, and checkpoints", async () => {
    const orderId = "GPA.9000-0000-0000-00001";
    let voided: unknown[] = [];
    fake.google({
      "GET /purchases/subscriptionsv2/tokens/vp-1": () => ({ body: playSubscription({ ack: true, orderId, expiry: now() + 30 * DAY }) }),
      "GET /purchases/voidedpurchases": () => ({ body: { voidedPurchases: voided } }),
    });
    await receipt("vp-user", "vp-1");
    const mark = fake.received("backend").length;

    const voidedAt = now() - 1000;
    voided = [{ kind: "androidpublisher#voidedPurchase", purchaseToken: "vp-1", orderId, voidedTimeMillis: String(voidedAt), voidedReason: 1 }];
    await jobs();
    expect(fake.events("backend").slice(mark)).toEqual([expect.objectContaining({ type: "CANCELLATION", cancel_reason: "CUSTOMER_SUPPORT", transaction_id: orderId })]);
    const info = (await call("/v1/subscribers/vp-user", { platform: "android" })).body;
    expect(Date.parse(info.subscriber.entitlements.pro.expires_date)).toBeLessThan(now());

    // A second run doesn't refund it again.
    await jobs();
    expect(fake.received("backend").slice(mark)).toHaveLength(1);
    // It asked only for what was voided since the last run (the checkpoint).
    const polls = fake.requests.filter((r) => r.host === "androidpublisher.googleapis.com" && r.path.endsWith("/purchases/voidedpurchases"));
    expect(polls.length).toBeGreaterThanOrEqual(2);
    expect(Number(polls.at(-1)!.url.searchParams.get("startTime"))).toBeGreaterThanOrEqual(voidedAt);
  });
});
