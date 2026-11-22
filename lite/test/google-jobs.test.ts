import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config";
import { runScheduled } from "../src/scheduled";
import { appWithGooglePlay, call, envWithGoogleKey, fakeGoogleApi, googlePlayDeps, playSubscription, rawTestConfig, webhookReceiver } from "./helpers";

const DAY = 864e5;
const HOURLY = Date.parse("2026-12-01T10:00:00Z");

describe("Google Play scheduled jobs", () => {
  it("retry failed acknowledgements, and drop ones too old to matter", async () => {
    const now = HOURLY;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO play_ack_pending (purchase_token, app_id, product_id, kind, attempts, created_at) VALUES ('ack-retry', 'android', 'pro', 'subscription', 1, ?)").bind(now - DAY),
      env.DB.prepare("INSERT INTO play_ack_pending (purchase_token, app_id, product_id, kind, attempts, created_at) VALUES ('ack-stale', 'android', 'pro', 'subscription', 5, ?)").bind(now - 4 * DAY),
    ]);
    const api = fakeGoogleApi({ "POST /purchases/subscriptions/pro/tokens/ack-retry:acknowledge": () => ({ body: {} }) });
    const results = await runScheduled(envWithGoogleKey(), now, { deps: googlePlayDeps(api) });
    expect(results.find((r) => r.task === "retry-play-acknowledgements")?.rows).toBe(1);
    const left = await env.DB.prepare("SELECT purchase_token FROM play_ack_pending WHERE purchase_token IN ('ack-retry', 'ack-stale')").all();
    expect(left.results).toEqual([]);
  });

  it("poll voided purchases: refunds a missed order once, with a webhook event, and checkpoints", async () => {
    const orderId = "GPA.9000-0000-0000-00001";
    let voided: unknown[] = [];
    const api = fakeGoogleApi({
      "GET /purchases/subscriptionsv2/tokens/vp-1": () => ({ body: playSubscription({ ack: true, orderId, expiry: Date.now() + 30 * DAY }) }),
      "GET /purchases/voidedpurchases": () => ({ body: { voidedPurchases: voided } }),
    });
    const receiver = webhookReceiver();
    const deps = googlePlayDeps(api, receiver);
    const app = appWithGooglePlay(api, receiver);
    await call("/v1/receipts", {
      platform: "android",
      app,
      env: envWithGoogleKey(),
      body: { app_user_id: "vp-user", fetch_token: "vp-1", product_ids: ["pro"], platform_product_ids: [{ product_id: "pro", base_plan_id: "monthly" }] },
    });
    receiver.received.length = 0;

    const now = Date.now();
    voided = [{ kind: "androidpublisher#voidedPurchase", purchaseToken: "vp-1", orderId, voidedTimeMillis: String(now - 1000), voidedReason: 1 }];
    // Run at the top of an hour so the hourly tasks are due.
    const topOfHour = Math.floor(now / 3600_000) * 3600_000;
    const run = () => runScheduled(envWithGoogleKey(), Math.max(topOfHour, now), { deps, all: true });
    expect((await run()).find((r) => r.task === "poll-play-voided-purchases")?.rows).toBe(1);
    expect(receiver.events()).toEqual([expect.objectContaining({ type: "CANCELLATION", cancel_reason: "CUSTOMER_SUPPORT", transaction_id: orderId })]);
    const info = await (await call("/v1/subscribers/vp-user", { platform: "android", app })).json<any>();
    expect(Date.parse(info.subscriber.entitlements.pro.expires_date)).toBeLessThan(Date.now());

    // A second run doesn't refund it again.
    expect((await run()).find((r) => r.task === "poll-play-voided-purchases")?.rows).toBe(0);
    expect(receiver.received).toHaveLength(1);
    const checkpoint = await env.DB.prepare("SELECT value FROM job_state WHERE key = 'play_voided_checkpoint:android'").first();
    expect(checkpoint).not.toBeNull();
  });

  it("one app without a usable key doesn't stop the others", async () => {
    const now = HOURLY;
    // A second Play app, first in the config, whose service account secret isn't set.
    const deps = googlePlayDeps(
      fakeGoogleApi({
        "POST /purchases/subscriptions/pro/tokens/ack-ok:acknowledge": () => ({ body: {} }),
        "GET /purchases/voidedpurchases": () => ({ body: {} }),
      }),
    );
    const raw = structuredClone(rawTestConfig) as any;
    const android = { ...raw.apps.android, google_play_api: { service_account_secret: "GOOGLE_SERVICE_ACCOUNT" } };
    delete android.allow_unverified_purchases;
    raw.apps = {
      broken: { ...android, package_name: "com.example.broken", sdk_keys: ["goog_broken_0123456789"], google_play_api: { service_account_secret: "NOT_SET" } },
      ...raw.apps,
      android,
    };
    raw.entitlements.pro.products.broken = ["pro"];
    deps.config = parseConfig(raw);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO play_ack_pending (purchase_token, app_id, product_id, kind, attempts, created_at) VALUES ('ack-broken', 'broken', 'pro', 'subscription', 1, ?)").bind(now - 2 * DAY),
      env.DB.prepare("INSERT INTO play_ack_pending (purchase_token, app_id, product_id, kind, attempts, created_at) VALUES ('ack-ok', 'android', 'pro', 'subscription', 1, ?)").bind(now - DAY),
    ]);
    const results = await runScheduled(envWithGoogleKey(), now, { deps });
    expect(results.find((r) => r.task === "retry-play-acknowledgements")?.rows).toBe(1);
    expect(results.find((r) => r.task === "poll-play-voided-purchases")?.rows).toBe(0);
    const checkpoints = await env.DB.prepare("SELECT key FROM job_state WHERE key LIKE 'play_voided_checkpoint:%' ORDER BY key").all();
    expect(checkpoints.results).toEqual([{ key: "play_voided_checkpoint:android" }]);
    const left = await env.DB.prepare("SELECT purchase_token, last_error FROM play_ack_pending WHERE purchase_token IN ('ack-broken', 'ack-ok')").all();
    expect(left.results).toEqual([{ purchase_token: "ack-broken", last_error: expect.stringMatching(/NOT_SET/) }]);
  });
});
