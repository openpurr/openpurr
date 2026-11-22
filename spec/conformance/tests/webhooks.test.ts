// Outbound webhooks: RevenueCat-shaped events, the Authorization header and signature, one event
// per fact, the events Apple's notifications produce, transfers, retries with backoff, replay
// through the admin API, and webhook config validation. Ported from lite/test/webhooks.test.ts.

import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  admin,
  call,
  DAY,
  fake,
  itEdition,
  jobs,
  now,
  onEdition,
  postNotification,
  reset,
  setClock,
  settle,
  signNotification,
  signTransaction,
  testConfig,
  WEBHOOK_AUTH,
  WEBHOOK_SIGNING_KEY,
  withWebhooks,
  type AppleTransaction,
} from "../src";

const APPLE_STATUS = { ACTIVE: 1, EXPIRED: 2, BILLING_RETRY: 3, GRACE_PERIOD: 4, REVOKED: 5 } as const;

const receipt = (body: Record<string, unknown>) => call("/v1/receipts", { body });
const notify = async (signedPayload: string) => {
  const res = await postNotification(signedPayload);
  await settle();
  return res;
};
const hmacHex = (key: string, message: string) => createHmac("sha256", key).update(message).digest("hex");
const deliveries = async () => (await admin("GET", "/webhooks/deliveries")).body.deliveries as any[];
const types = () => fake.events().map((e) => e.type);

beforeEach(async () => {
  await reset(withWebhooks());
});

describe("delivery", () => {
  it("sends a RevenueCat-shaped INITIAL_PURCHASE, with Authorization and a verifiable signature", async () => {
    const { jws, payload } = await signTransaction({ productId: "pro_annual", expiresDate: now() + 365 * DAY });
    await receipt({ app_user_id: "wh-buyer", fetch_token: jws, attributes: { $email: { value: "b@example.com", updated_at_ms: 1 } } });
    await settle();

    expect(fake.received()).toHaveLength(1);
    const [req] = fake.received();
    expect(req!.url).toBe(fake.webhookUrl("backend"));
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
      country_code: "US", // from Apple's "USA" storefront
      currency: "USD",
      price: 9.99,
      price_in_purchased_currency: 9.99,
      subscriber_attributes: { $email: { value: "b@example.com", updated_at_ms: 1 } },
    });
    expect(req!.body.event.id).toMatch(/^[0-9a-f-]{36}$/);

    // The signature: t=<unix>,v1=HMAC-SHA256("<t>.<raw body>").
    const header = req!.headers.get("x-revenuecat-webhook-signature")!;
    const t = /t=(\d+)/.exec(header)![1]!;
    expect(header).toBe(`t=${t},v1=${hmacHex(WEBHOOK_SIGNING_KEY, `${t}.${req!.raw}`)}`);
    expect(Math.abs(Number(t) * 1000 - now())).toBeLessThan(60_000);
  });

  it("sends nothing when no webhook is configured", async () => {
    await reset(testConfig());
    const { jws } = await signTransaction();
    await receipt({ app_user_id: "wh-none", fetch_token: jws });
    await settle();
    expect(fake.received()).toHaveLength(0);
    expect(await deliveries()).toEqual([]);
    const customer = (await admin("GET", "/customers/wh-none")).body;
    expect(customer.webhook_events).toEqual([]);
  });

  it("filters by environment and event type", async () => {
    await reset(withWebhooks(testConfig(), { environments: ["production"] }));
    await receipt({ app_user_id: "wh-filter", fetch_token: (await signTransaction()).jws }); // a sandbox purchase
    await settle();
    expect(fake.received()).toHaveLength(0);

    await reset(withWebhooks(testConfig(), { events: ["RENEWAL"] }));
    await receipt({ app_user_id: "wh-filter-2", fetch_token: (await signTransaction()).jws }); // INITIAL_PURCHASE
    await settle();
    expect(fake.received()).toHaveLength(0);
  });
});

describe("one event per fact", () => {
  it("a purchase reported by both the receipt and Apple's notification produces one event", async () => {
    const { jws, payload } = await signTransaction({ productId: "pro_monthly" });
    await receipt({ app_user_id: "wh-dedupe", fetch_token: jws });
    await notify((await signNotification({ type: "SUBSCRIBED", subtype: "INITIAL_BUY", transaction: payload, status: 1 })).signedPayload);
    expect(types()).toEqual(["INITIAL_PURCHASE"]);
  });

  it("a notification that arrives before the receipt waits for an owner, then the receipt reports it", async () => {
    const { jws, payload } = await signTransaction({ productId: "pro_monthly" });
    await notify((await signNotification({ type: "SUBSCRIBED", subtype: "INITIAL_BUY", transaction: payload, status: 1 })).signedPayload);
    expect(fake.received()).toHaveLength(0);
    await receipt({ app_user_id: "wh-late-owner", fetch_token: jws });
    await settle();
    expect(fake.events()).toEqual([expect.objectContaining({ type: "INITIAL_PURCHASE", app_user_id: "wh-late-owner" })]);
  });

  it("restoring an old purchase doesn't announce it as new", async () => {
    const { jws } = await signTransaction({ purchaseDate: now() - 4 * DAY, expiresDate: now() + 20 * DAY });
    await receipt({ app_user_id: "wh-old", fetch_token: jws, is_restore: true });
    await settle();
    expect(fake.received()).toHaveLength(0);
  });
});

describe("Apple notification events", () => {
  async function subscribedUser(user: string, overrides: Partial<AppleTransaction> = {}) {
    const { jws, payload } = await signTransaction({ productId: "pro_monthly", ...overrides });
    await receipt({ app_user_id: user, fetch_token: jws });
    await settle();
    fake.deliveries.length = 0;
    return payload;
  }

  it("DID_RENEW: RENEWAL, flagged as a trial conversion after a trial", async () => {
    const trial = await subscribedUser("wh-renew", { offerType: 1, offerDiscountType: "FREE_TRIAL", expiresDate: now() + DAY });
    const renewal = (await signTransaction({ originalTransactionId: trial.originalTransactionId, purchaseDate: now(), expiresDate: now() + 30 * DAY })).payload;
    await notify((await signNotification({ type: "DID_RENEW", transaction: renewal, status: 1 })).signedPayload);
    expect(fake.events()).toEqual([
      expect.objectContaining({ type: "RENEWAL", is_trial_conversion: true, transaction_id: renewal.transactionId, app_user_id: "wh-renew" }),
    ]);
  });

  it("auto-renew off and on: CANCELLATION (UNSUBSCRIBE), then UNCANCELLATION", async () => {
    const tx = await subscribedUser("wh-cancel");
    await notify((await signNotification({ type: "DID_CHANGE_RENEWAL_STATUS", subtype: "AUTO_RENEW_DISABLED", transaction: tx, renewal: { autoRenewStatus: 0 }, status: 1 })).signedPayload);
    await notify((await signNotification({ type: "DID_CHANGE_RENEWAL_STATUS", subtype: "AUTO_RENEW_ENABLED", transaction: tx, status: 1 })).signedPayload);
    expect(fake.events().map((e) => [e.type, e.cancel_reason])).toEqual([
      ["CANCELLATION", "UNSUBSCRIBE"],
      ["UNCANCELLATION", undefined],
    ]);
  });

  it("billing failure with grace: BILLING_ISSUE + CANCELLATION now, EXPIRATION when grace ends", async () => {
    const tx = await subscribedUser("wh-grace", { expiresDate: now() - DAY });
    const graceEnd = now() + 10 * DAY;
    await notify(
      (await signNotification({ type: "DID_FAIL_TO_RENEW", subtype: "GRACE_PERIOD", transaction: tx, renewal: { gracePeriodExpiresDate: graceEnd }, status: APPLE_STATUS.GRACE_PERIOD })).signedPayload,
    );
    await notify((await signNotification({ type: "GRACE_PERIOD_EXPIRED", transaction: tx, status: APPLE_STATUS.BILLING_RETRY })).signedPayload);
    expect(fake.events().map((e) => [e.type, e.cancel_reason ?? e.expiration_reason ?? null, e.grace_period_expiration_at_ms ?? null])).toEqual([
      ["BILLING_ISSUE", null, graceEnd],
      ["CANCELLATION", "BILLING_ERROR", null],
      ["EXPIRATION", "BILLING_ERROR", null],
    ]);
  });

  it("billing failure without grace expires now, and Apple's later EXPIRED doesn't repeat it", async () => {
    const tx = await subscribedUser("wh-retry", { expiresDate: now() - DAY });
    await notify((await signNotification({ type: "DID_FAIL_TO_RENEW", transaction: tx, status: APPLE_STATUS.BILLING_RETRY })).signedPayload);
    await notify((await signNotification({ type: "EXPIRED", subtype: "BILLING_RETRY", transaction: tx, status: APPLE_STATUS.EXPIRED })).signedPayload);
    expect(types()).toEqual(["BILLING_ISSUE", "CANCELLATION", "EXPIRATION"]);
  });

  it("REFUND: CANCELLATION with CUSTOMER_SUPPORT and a negative price", async () => {
    const tx = await subscribedUser("wh-refund");
    const refunded = (await signTransaction({ ...tx, revocationDate: now(), revocationReason: 0 })).payload;
    await notify((await signNotification({ type: "REFUND", transaction: refunded, status: APPLE_STATUS.REVOKED })).signedPayload);
    expect(fake.events()).toEqual([
      expect.objectContaining({ type: "CANCELLATION", cancel_reason: "CUSTOMER_SUPPORT", price: -9.99, price_in_purchased_currency: -9.99 }),
    ]);
  });

  it("an upgrade: PRODUCT_CHANGE naming the new product", async () => {
    const tx = await subscribedUser("wh-upgrade");
    await notify(
      (await signNotification({ type: "DID_CHANGE_RENEWAL_PREF", subtype: "UPGRADE", transaction: tx, renewal: { autoRenewProductId: "pro_annual" } })).signedPayload,
    );
    expect(fake.events()).toEqual([expect.objectContaining({ type: "PRODUCT_CHANGE", new_product_id: "pro_annual", product_id: "pro_monthly" })]);
  });
});

describe("transfers", () => {
  it("TRANSFER when a named user's purchase is restored by someone else", async () => {
    const { jws } = await signTransaction({ productId: "pro_annual", expiresDate: now() + 300 * DAY });
    await receipt({ app_user_id: "wh-alice", fetch_token: jws });
    await settle();
    fake.deliveries.length = 0;
    await receipt({ app_user_id: "wh-bob", fetch_token: jws, is_restore: true });
    await settle();
    expect(fake.events()).toEqual([
      expect.objectContaining({ type: "TRANSFER", app_user_id: "wh-bob", transferred_from: ["wh-alice"], transferred_to: ["wh-bob"] }),
    ]);
  });
});

describe("retries", () => {
  it("retries failed deliveries from the scheduled job until they succeed", async () => {
    let status = 500;
    fake.webhookStatus(() => status);
    await receipt({ app_user_id: "wh-retry-delivery", fetch_token: (await signTransaction()).jws });
    await settle();
    const [first] = await deliveries();
    expect(first).toMatchObject({ endpoint: "backend", type: "INITIAL_PURCHASE", status: "pending", attempts: 1, last_status: 500 });
    expect(first.next_attempt_at).toBeGreaterThan(now());

    // Not due yet: nothing happens.
    await setClock(first.next_attempt_at - 1000);
    await jobs();
    expect((await deliveries())[0].attempts).toBe(1);

    status = 200;
    await setClock(first.next_attempt_at);
    await jobs();
    expect((await deliveries())[0]).toMatchObject({ status: "delivered", attempts: 2, last_status: 200, next_attempt_at: null });
    expect(fake.received()).toHaveLength(2);
    // Each attempt is signed afresh, and both carry the same event.
    const [a, b] = fake.received();
    expect(b!.body.event.id).toBe(a!.body.event.id);
    const t = /t=(\d+)/.exec(b!.headers.get("x-revenuecat-webhook-signature")!)![1]!;
    expect(b!.headers.get("x-revenuecat-webhook-signature")).toBe(`t=${t},v1=${hmacHex(WEBHOOK_SIGNING_KEY, `${t}.${b!.raw}`)}`);
  });

  itEdition("lite", "gives up after about 72 hours of failures", async () => {
    const RETRY_DELAYS_MS = [5, 10, 45, 120, 180, 360, 720, 1440, 1440].map((m) => m * 60_000);
    fake.webhookStatus(() => 503);
    await receipt({ app_user_id: "wh-give-up", fetch_token: (await signTransaction()).jws });
    await settle();
    // Each retry waits for the next delay after the previous attempt.
    let last = now();
    for (const delay of RETRY_DELAYS_MS) {
      const [d] = await deliveries();
      expect(d.next_attempt_at - last).toBeGreaterThan(delay - 60_000);
      expect(d.next_attempt_at - last).toBeLessThan(delay + 60_000);
      last = await setClock(d.next_attempt_at);
      await jobs();
    }
    expect(await deliveries()).toEqual([expect.objectContaining({ status: "failed", attempts: RETRY_DELAYS_MS.length + 1, next_attempt_at: null })]);
    expect(fake.received()).toHaveLength(RETRY_DELAYS_MS.length + 1);
    expect(RETRY_DELAYS_MS.reduce((a, b) => a + b, 0) / 3600_000).toBeCloseTo(72, 0);
  });

  it("doesn't send at all when a configured secret is missing, and says why", async () => {
    await reset(withWebhooks(testConfig(), { authorization_secret: "UNSET_WEBHOOK_AUTH" }));
    await receipt({ app_user_id: "wh-no-secret", fetch_token: (await signTransaction()).jws });
    await settle();
    expect(fake.received()).toHaveLength(0);
    const [delivery] = await deliveries();
    expect(delivery.status).not.toBe("delivered");
    expect(delivery.last_error).toMatch(/UNSET_WEBHOOK_AUTH/);
  });
});

describe("replay", () => {
  it("sends the same event again through the admin API", async () => {
    await receipt({ app_user_id: "wh-replay", fetch_token: (await signTransaction()).jws });
    await settle();
    const [original] = fake.received();
    const [event] = (await admin("GET", "/customers/wh-replay")).body.webhook_events;
    expect(event).toMatchObject({ id: original!.body.event.id, type: "INITIAL_PURCHASE" });

    const res = await admin("POST", `/webhooks/events/${event.id}/replay`);
    expect(res.status).toBe(200);
    await settle();
    expect(fake.received()).toHaveLength(2);
    expect(fake.received()[1]!.body).toEqual(original!.body);
    expect((await deliveries())[0]).toMatchObject({ status: "delivered" });

    expect((await admin("POST", "/webhooks/events/no-such-event/replay")).status).toBe(404);
  });
});

describe("webhook config", () => {
  const validate = async (webhooks: unknown) =>
    (await admin("POST", "/config/validate", {}, { body: { document: { ...testConfig(), webhooks } } })).body as { valid: boolean; problems: string[] };
  const url = fake.webhookUrl("backend");

  it("requires https, known event types and secret names (never secret values)", async () => {
    const cases: [unknown, RegExp | null][] = [
      [[{ id: "a", url: "http://example.com/hook" }], /must use https/],
      [[{ id: "a", url: "http://localhost:8787/hook" }], null],
      [[{ id: "a", url, events: ["RENEWALS"] }], /unknown event type RENEWALS/],
      [[{ id: "a", url, signing_secret: "whsec_abc123" }], /Worker secret name/],
      [[{ id: "a", url }, { id: "a", url }], /duplicate webhook a/],
    ];
    for (const [webhooks, problem] of cases) {
      const res = await validate(webhooks);
      expect(res.valid, JSON.stringify(webhooks)).toBe(problem === null);
      // The wording of problems is Lite's.
      if (problem && onEdition("lite")) expect(res.problems.join()).toMatch(problem);
    }
  });
});
