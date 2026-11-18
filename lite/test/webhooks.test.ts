import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "../src/config";
import { runScheduled } from "../src/scheduled";
import { APPLE_STATUS } from "../src/stores/apple";
import { RETRY_DELAYS_MS, signatureHeader } from "../src/webhooks";
import {
  appWithWebhooks,
  call,
  DAY,
  envWithWebhookSecrets,
  postNotification,
  rawTestConfig,
  signNotification,
  signTransaction,
  WEBHOOK_AUTH,
  WEBHOOK_SIGNING_KEY,
  WEBHOOK_URL,
  webhookReceiver,
} from "./helpers";

function setup(webhook: Record<string, unknown> = {}, status?: () => number) {
  const receiver = webhookReceiver(status);
  const { app, deps } = appWithWebhooks(receiver, webhook);
  const env = envWithWebhookSecrets();
  return {
    receiver,
    deps,
    env,
    receipt: (body: Record<string, unknown>) => call("/v1/receipts", { app, env, body }),
    notify: (signedPayload: string) => postNotification(signedPayload, { app, env }),
  };
}

async function hmacHex(key: string, message: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

describe("delivery", () => {
  it("sends a RevenueCat-shaped INITIAL_PURCHASE, with Authorization and a verifiable signature", async () => {
    const w = setup();
    const { jws, payload } = await signTransaction({ productId: "pro_annual", expiresDate: Date.now() + 365 * DAY });
    await w.receipt({ app_user_id: "wh-buyer", fetch_token: jws, attributes: { $email: { value: "b@example.com", updated_at_ms: 1 } } });

    expect(w.receiver.received).toHaveLength(1);
    const [req] = w.receiver.received;
    expect(req!.url).toBe(WEBHOOK_URL);
    expect(req!.headers.get("authorization")).toBe(WEBHOOK_AUTH);
    expect(req!.body.api_version).toBe("1.0");
    expect(req!.body.event).toMatchObject({
      type: "INITIAL_PURCHASE",
      app_id: "ios",
      app_user_id: "wh-buyer",
      original_app_user_id: "wh-buyer",
      aliases: ["wh-buyer"],
      product_id: "pro_annual",
      period_type: "NORMAL",
      purchased_at_ms: payload.purchaseDate,
      expiration_at_ms: payload.expiresDate,
      entitlement_id: null,
      entitlement_ids: ["pro", "annual_perks"],
      environment: "SANDBOX",
      store: "APP_STORE",
      transaction_id: payload.transactionId,
      original_transaction_id: payload.originalTransactionId,
      is_family_share: false,
      currency: "USD",
      price: 9.99,
      price_in_purchased_currency: 9.99,
      subscriber_attributes: { $email: { value: "b@example.com", updated_at_ms: 1 } },
    });
    expect(req!.body.event.id).toMatch(/^[0-9a-f-]{36}$/);

    // The signature: t=<unix>,v1=HMAC-SHA256("<t>.<raw body>").
    const header = req!.headers.get("x-revenuecat-webhook-signature")!;
    const t = /t=(\d+)/.exec(header)![1]!;
    expect(header).toBe(`t=${t},v1=${await hmacHex(WEBHOOK_SIGNING_KEY, `${t}.${req!.raw}`)}`);
  });

  it("signs with both keys during a rotation", async () => {
    const header = await signatureHeader(["old-key", "new-key"], "{}", 1_700_000_000_000);
    expect(header).toBe(
      `t=1700000000,v1=${await hmacHex("old-key", "1700000000.{}")},v1=${await hmacHex("new-key", "1700000000.{}")}`,
    );
  });

  it("sends nothing when no webhook is configured", async () => {
    const { jws } = await signTransaction();
    await call("/v1/receipts", { body: { app_user_id: "wh-none", fetch_token: jws } });
    const { n } = (await env.DB.prepare("SELECT count(*) AS n FROM webhook_event WHERE body LIKE '%wh-none%'").first<{ n: number }>())!;
    expect(n).toBe(0);
  });

  it("filters by environment and event type", async () => {
    const w = setup({ environments: ["production"] });
    await w.receipt({ app_user_id: "wh-filter", fetch_token: (await signTransaction()).jws }); // a sandbox purchase
    expect(w.receiver.received).toHaveLength(0);

    const w2 = setup({ events: ["RENEWAL"] });
    await w2.receipt({ app_user_id: "wh-filter-2", fetch_token: (await signTransaction()).jws }); // INITIAL_PURCHASE
    expect(w2.receiver.received).toHaveLength(0);
  });
});

describe("one event per fact", () => {
  it("a purchase reported by both the receipt and Apple's notification produces one event", async () => {
    const w = setup();
    const { jws, payload } = await signTransaction({ productId: "pro_monthly" });
    await w.receipt({ app_user_id: "wh-dedupe", fetch_token: jws });
    await w.notify((await signNotification({ type: "SUBSCRIBED", subtype: "INITIAL_BUY", transaction: payload, status: 1 })).signedPayload);
    expect(w.receiver.events().map((e) => e.type)).toEqual(["INITIAL_PURCHASE"]);
  });

  it("a notification that arrives before the receipt waits for an owner, then the receipt reports it", async () => {
    const w = setup();
    const { jws, payload } = await signTransaction({ productId: "pro_monthly" });
    await w.notify((await signNotification({ type: "SUBSCRIBED", subtype: "INITIAL_BUY", transaction: payload, status: 1 })).signedPayload);
    expect(w.receiver.received).toHaveLength(0);
    await w.receipt({ app_user_id: "wh-late-owner", fetch_token: jws });
    expect(w.receiver.events()).toEqual([expect.objectContaining({ type: "INITIAL_PURCHASE", app_user_id: "wh-late-owner" })]);
  });

  it("restoring an old purchase doesn't announce it as new", async () => {
    const w = setup();
    const { jws } = await signTransaction({ purchaseDate: Date.now() - 4 * DAY, expiresDate: Date.now() + 20 * DAY });
    await w.receipt({ app_user_id: "wh-old", fetch_token: jws, is_restore: true });
    expect(w.receiver.received).toHaveLength(0);
  });
});

describe("Apple notification events", () => {
  async function subscribedUser(w: ReturnType<typeof setup>, user: string, overrides: Parameters<typeof signTransaction>[0] = {}) {
    const { jws, payload } = await signTransaction({ productId: "pro_monthly", ...overrides });
    await w.receipt({ app_user_id: user, fetch_token: jws });
    w.receiver.received.length = 0;
    return payload;
  }

  it("DID_RENEW: RENEWAL, flagged as a trial conversion after a trial", async () => {
    const w = setup();
    const trial = await subscribedUser(w, "wh-renew", { offerType: 1, offerDiscountType: "FREE_TRIAL", expiresDate: Date.now() + DAY });
    const renewal = (await signTransaction({ originalTransactionId: trial.originalTransactionId, purchaseDate: Date.now(), expiresDate: Date.now() + 30 * DAY })).payload;
    await w.notify((await signNotification({ type: "DID_RENEW", transaction: renewal, status: 1 })).signedPayload);
    expect(w.receiver.events()).toEqual([
      expect.objectContaining({ type: "RENEWAL", is_trial_conversion: true, transaction_id: renewal.transactionId, app_user_id: "wh-renew" }),
    ]);
  });

  it("auto-renew off and on: CANCELLATION (UNSUBSCRIBE), then UNCANCELLATION", async () => {
    const w = setup();
    const tx = await subscribedUser(w, "wh-cancel");
    await w.notify((await signNotification({ type: "DID_CHANGE_RENEWAL_STATUS", subtype: "AUTO_RENEW_DISABLED", transaction: tx, renewal: { autoRenewStatus: 0 }, status: 1 })).signedPayload);
    await w.notify((await signNotification({ type: "DID_CHANGE_RENEWAL_STATUS", subtype: "AUTO_RENEW_ENABLED", transaction: tx, status: 1 })).signedPayload);
    expect(w.receiver.events().map((e) => [e.type, e.cancel_reason])).toEqual([
      ["CANCELLATION", "UNSUBSCRIBE"],
      ["UNCANCELLATION", undefined],
    ]);
  });

  it("billing failure with grace: BILLING_ISSUE + CANCELLATION now, EXPIRATION when grace ends", async () => {
    const w = setup();
    const tx = await subscribedUser(w, "wh-grace", { expiresDate: Date.now() - DAY });
    const graceEnd = Date.now() + 10 * DAY;
    await w.notify(
      (await signNotification({ type: "DID_FAIL_TO_RENEW", subtype: "GRACE_PERIOD", transaction: tx, renewal: { gracePeriodExpiresDate: graceEnd }, status: APPLE_STATUS.GRACE_PERIOD })).signedPayload,
    );
    await w.notify((await signNotification({ type: "GRACE_PERIOD_EXPIRED", transaction: tx, status: APPLE_STATUS.BILLING_RETRY })).signedPayload);
    expect(w.receiver.events().map((e) => [e.type, e.cancel_reason ?? e.expiration_reason ?? null, e.grace_period_expiration_at_ms ?? null])).toEqual([
      ["BILLING_ISSUE", null, graceEnd],
      ["CANCELLATION", "BILLING_ERROR", null],
      ["EXPIRATION", "BILLING_ERROR", null],
    ]);
  });

  it("billing failure without grace expires now, and Apple's later EXPIRED doesn't repeat it", async () => {
    const w = setup();
    const tx = await subscribedUser(w, "wh-retry", { expiresDate: Date.now() - DAY });
    await w.notify((await signNotification({ type: "DID_FAIL_TO_RENEW", transaction: tx, status: APPLE_STATUS.BILLING_RETRY })).signedPayload);
    await w.notify((await signNotification({ type: "EXPIRED", subtype: "BILLING_RETRY", transaction: tx, status: APPLE_STATUS.EXPIRED })).signedPayload);
    expect(w.receiver.events().map((e) => e.type)).toEqual(["BILLING_ISSUE", "CANCELLATION", "EXPIRATION"]);
  });

  it("REFUND: CANCELLATION with CUSTOMER_SUPPORT and a negative price", async () => {
    const w = setup();
    const tx = await subscribedUser(w, "wh-refund");
    const refunded = (await signTransaction({ ...tx, revocationDate: Date.now(), revocationReason: 0 })).payload;
    await w.notify((await signNotification({ type: "REFUND", transaction: refunded, status: APPLE_STATUS.REVOKED })).signedPayload);
    expect(w.receiver.events()).toEqual([
      expect.objectContaining({ type: "CANCELLATION", cancel_reason: "CUSTOMER_SUPPORT", price: -9.99, price_in_purchased_currency: -9.99 }),
    ]);
  });

  it("an upgrade: PRODUCT_CHANGE naming the new product", async () => {
    const w = setup();
    const tx = await subscribedUser(w, "wh-upgrade");
    await w.notify(
      (await signNotification({ type: "DID_CHANGE_RENEWAL_PREF", subtype: "UPGRADE", transaction: tx, renewal: { autoRenewProductId: "pro_annual" } })).signedPayload,
    );
    expect(w.receiver.events()).toEqual([expect.objectContaining({ type: "PRODUCT_CHANGE", new_product_id: "pro_annual", product_id: "pro_monthly" })]);
  });
});

describe("transfers", () => {
  it("TRANSFER when a named user's purchase is restored by someone else", async () => {
    const w = setup();
    const { jws } = await signTransaction({ productId: "pro_annual", expiresDate: Date.now() + 300 * DAY });
    await w.receipt({ app_user_id: "wh-alice", fetch_token: jws });
    w.receiver.received.length = 0;
    await w.receipt({ app_user_id: "wh-bob", fetch_token: jws, is_restore: true });
    expect(w.receiver.events()).toEqual([
      expect.objectContaining({ type: "TRANSFER", app_user_id: "wh-bob", transferred_from: ["wh-alice"], transferred_to: ["wh-bob"] }),
    ]);
  });
});

describe("retries", () => {
  it("retries failed deliveries from the scheduled job until they succeed", async () => {
    let status = 500;
    const w = setup({}, () => status);
    await w.receipt({ app_user_id: "wh-retry-delivery", fetch_token: (await signTransaction()).jws });
    const row = async () =>
      (await env.DB.prepare(
        `SELECT d.status, d.attempts, d.last_status, d.next_attempt_at FROM webhook_delivery d JOIN webhook_event e ON e.id = d.event_id
         WHERE e.body LIKE '%wh-retry-delivery%'`,
      ).first<any>())!;
    const first = await row();
    expect(first).toMatchObject({ status: "pending", attempts: 1, last_status: 500 });

    // Not due yet: nothing happens.
    await runScheduled(w.env, first.next_attempt_at - 1000, { deps: w.deps });
    expect((await row()).attempts).toBe(1);

    status = 200;
    await runScheduled(w.env, first.next_attempt_at, { deps: w.deps });
    expect(await row()).toMatchObject({ status: "delivered", attempts: 2, last_status: 200, next_attempt_at: null });
    expect(w.receiver.received).toHaveLength(2);
  });

  it("gives up after about 72 hours of failures", async () => {
    const w = setup({}, () => 503);
    await w.receipt({ app_user_id: "wh-give-up", fetch_token: (await signTransaction()).jws });
    let now = Date.now();
    for (const delay of RETRY_DELAYS_MS) {
      now += delay;
      await runScheduled(w.env, now, { deps: w.deps });
    }
    const row = (await env.DB.prepare(
      `SELECT d.status, d.attempts FROM webhook_delivery d JOIN webhook_event e ON e.id = d.event_id WHERE e.body LIKE '%wh-give-up%'`,
    ).first<any>())!;
    expect(row).toEqual({ status: "failed", attempts: RETRY_DELAYS_MS.length + 1 });
    expect(RETRY_DELAYS_MS.reduce((a, b) => a + b, 0) / 3600_000).toBeCloseTo(72, 0);
  });

  it("doesn't send at all when a configured secret is missing, and says why", async () => {
    const receiver = webhookReceiver();
    const { app } = appWithWebhooks(receiver);
    await call("/v1/receipts", { app, body: { app_user_id: "wh-no-secret", fetch_token: (await signTransaction()).jws } });
    expect(receiver.received).toHaveLength(0);
    const row = (await env.DB.prepare(
      `SELECT d.last_error FROM webhook_delivery d JOIN webhook_event e ON e.id = d.event_id WHERE e.body LIKE '%wh-no-secret%'`,
    ).first<any>())!;
    expect(row.last_error).toMatch(/WEBHOOK_AUTH isn't set/);
  });
});

describe("webhook config", () => {
  const problems = (webhooks: unknown) => {
    try {
      parseConfig({ ...structuredClone(rawTestConfig), webhooks });
      return [];
    } catch (err) {
      return err instanceof ConfigError ? err.problems : [String(err)];
    }
  };
  it("requires https, known event types and secret names (never secret values)", () => {
    expect(problems([{ id: "a", url: "http://example.com/hook" }]).join()).toMatch(/must use https/);
    expect(problems([{ id: "a", url: "http://localhost:8787/hook" }])).toEqual([]);
    expect(problems([{ id: "a", url: WEBHOOK_URL, events: ["RENEWALS"] }]).join()).toMatch(/unknown event type RENEWALS/);
    expect(problems([{ id: "a", url: WEBHOOK_URL, signing_secret: "whsec_abc123" }]).join()).toMatch(/Worker secret name/);
    expect(problems([{ id: "a", url: WEBHOOK_URL }, { id: "a", url: WEBHOOK_URL }]).join()).toMatch(/duplicate webhook a/);
  });
});
