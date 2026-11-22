// App Store Server Notifications V2 scenarios: each one is delivered the way Apple does, then
// checked through GET /v1/subscribers, which is what the SDK sees.

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { APPLE_STATUS } from "../src/stores/apple";
import { call, DAY, postAppleTransaction, postNotification, signJws, signNotification, signTransaction } from "./helpers";

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const customerInfo = async (id: string) => (await (await call(`/v1/subscribers/${id}`)).json<any>()).subscriber;

/** A purchase the app has posted, so the customer owns the chain. */
async function subscribed(user: string, overrides: Parameters<typeof postAppleTransaction>[1] = {}) {
  const { payload } = await postAppleTransaction(user, { productId: "pro_monthly", ...overrides });
  return payload;
}

describe("delivery", () => {
  it("accepts a valid notification and records it once", async () => {
    const tx = await subscribed("n-dup");
    const { signedPayload, payload } = await signNotification({ type: "DID_RENEW", transaction: tx, status: 1 });
    expect((await postNotification(signedPayload)).status).toBe(200);
    const again = await postNotification(signedPayload);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ message: "Already processed." });
    const rows = await env.DB.prepare("SELECT notification_type, app_id FROM store_notification WHERE notification_id = ?")
      .bind(payload.notificationUUID)
      .all();
    expect(rows.results).toEqual([{ notification_type: "DID_RENEW", app_id: "ios" }]);
  });

  it("rejects a bad signature with 400", async () => {
    const { signedPayload } = await signNotification({ type: "TEST" });
    const [h, p] = signedPayload.split(".");
    expect((await postNotification(`${h}.${p}.AAAA`)).status).toBe(400);
    expect((await postNotification("not-a-jws")).status).toBe(400);
    // Not base64url at all: still an invalid signature, not a server error Apple would retry.
    expect((await postNotification(`${h}.${p}.%%%`)).status).toBe(400);
    expect((await postNotification(`%%%.${p}.AAAA`)).status).toBe(400);
  });

  it("rejects a forged transaction inside a validly signed notification", async () => {
    const outer = {
      notificationType: "DID_RENEW",
      notificationUUID: crypto.randomUUID(),
      signedDate: Date.now(),
      data: { bundleId: "com.example.openpurr", environment: "Sandbox", signedTransactionInfo: "eyJhbGciOiJub25lIn0.e30.x", status: 1 },
    };
    expect((await postNotification(await signJws(outer))).status).toBe(400);
  });

  it("answers 5xx for an unknown bundle or product, so Apple retries after a config fix", async () => {
    const tx = (await signTransaction({ productId: "not_configured" })).payload;
    const unknownProduct = await signNotification({ type: "SUBSCRIBED", subtype: "INITIAL_BUY", transaction: tx });
    expect((await postNotification(unknownProduct.signedPayload)).status).toBe(500);
    const unknownBundle = await signNotification({ type: "TEST", bundleId: "com.someone.else" });
    expect((await postNotification(unknownBundle.signedPayload)).status).toBe(500);
    // Not marked as processed, so Apple's retry will be handled.
    const seen = await env.DB.prepare("SELECT 1 FROM store_notification WHERE notification_id = ?")
      .bind(unknownProduct.payload.notificationUUID)
      .first();
    expect(seen).toBeNull();
  });

  it("accepts Apple's TEST notification", async () => {
    const { signedPayload } = await signNotification({ type: "TEST" });
    expect((await postNotification(signedPayload)).status).toBe(200);
  });
});

describe("ownership", () => {
  it("records a purchase that arrives by notification first, and assigns it when the app posts it", async () => {
    const { jws, payload: tx } = await signTransaction({ productId: "pro_annual", expiresDate: Date.now() + 300 * DAY });
    const { signedPayload } = await signNotification({ type: "SUBSCRIBED", subtype: "INITIAL_BUY", transaction: tx, status: 1 });
    expect((await postNotification(signedPayload)).status).toBe(200);
    expect((await customerInfo("n-first")).entitlements).toEqual({});

    await call("/v1/receipts", { body: { app_user_id: "n-first", fetch_token: jws } });
    expect((await customerInfo("n-first")).entitlements.pro.product_identifier).toBe("pro_annual");
  });
});

describe("renewals and status", () => {
  it("DID_RENEW extends the entitlement with the new transaction", async () => {
    const first = await subscribed("n-renew", { expiresDate: Date.now() + DAY });
    const renewal = (
      await signTransaction({
        productId: "pro_monthly",
        originalTransactionId: first.originalTransactionId,
        purchaseDate: first.expiresDate!,
        expiresDate: first.expiresDate! + 30 * DAY,
      })
    ).payload;
    const { signedPayload } = await signNotification({ type: "DID_RENEW", transaction: renewal, status: 1 });
    await postNotification(signedPayload);
    const info = await customerInfo("n-renew");
    expect(info.entitlements.pro.expires_date).toBe(iso(renewal.expiresDate!));
    expect(info.subscriptions.pro_monthly.store_transaction_id).toBe(renewal.transactionId);
  });

  it("auto-renew off sets unsubscribe_detected_at; turning it back on clears it", async () => {
    const tx = await subscribed("n-autorenew");
    const off = Date.now() - 1000;
    await postNotification(
      (await signNotification({ type: "DID_CHANGE_RENEWAL_STATUS", subtype: "AUTO_RENEW_DISABLED", transaction: tx, renewal: { autoRenewStatus: 0 }, signedDate: off, status: 1 })).signedPayload,
    );
    let sub = (await customerInfo("n-autorenew")).subscriptions.pro_monthly;
    expect(sub.unsubscribe_detected_at).toBe(iso(off));
    expect(Date.parse(sub.expires_date)).toBeGreaterThan(Date.now()); // still active until expiry

    await postNotification(
      (await signNotification({ type: "DID_CHANGE_RENEWAL_STATUS", subtype: "AUTO_RENEW_ENABLED", transaction: tx, renewal: { autoRenewStatus: 1 }, status: 1 })).signedPayload,
    );
    sub = (await customerInfo("n-autorenew")).subscriptions.pro_monthly;
    expect(sub.unsubscribe_detected_at).toBeNull();
  });

  it("a grace period keeps access: expires_date moves to the grace end", async () => {
    const expired = Date.now() - 2 * DAY;
    const tx = await subscribed("n-grace", { purchaseDate: expired - 30 * DAY, expiresDate: expired });
    expect(Date.parse((await customerInfo("n-grace")).entitlements.pro.expires_date)).toBeLessThan(Date.now());

    const graceEnd = Date.now() + 14 * DAY;
    const failedAt = expired + 1000;
    await postNotification(
      (
        await signNotification({
          type: "DID_FAIL_TO_RENEW",
          subtype: "GRACE_PERIOD",
          transaction: tx,
          renewal: { gracePeriodExpiresDate: graceEnd, isInBillingRetryPeriod: true },
          status: APPLE_STATUS.GRACE_PERIOD,
          signedDate: failedAt,
        })
      ).signedPayload,
    );
    const info = await customerInfo("n-grace");
    // The SDKs only read expires_date, so both move to the grace end.
    expect(info.entitlements.pro).toMatchObject({ expires_date: iso(graceEnd), grace_period_expires_date: iso(graceEnd) });
    expect(info.subscriptions.pro_monthly).toMatchObject({
      expires_date: iso(graceEnd),
      grace_period_expires_date: iso(graceEnd),
      billing_issues_detected_at: iso(failedAt),
    });
    expect(info.management_url).not.toBeNull();
  });

  it("billing recovery clears the billing issue and grace period", async () => {
    const expired = Date.now() - DAY;
    const tx = await subscribed("n-recover", { purchaseDate: expired - 30 * DAY, expiresDate: expired });
    await postNotification(
      (
        await signNotification({
          type: "DID_FAIL_TO_RENEW",
          subtype: "GRACE_PERIOD",
          transaction: tx,
          renewal: { gracePeriodExpiresDate: Date.now() + 10 * DAY },
          status: APPLE_STATUS.GRACE_PERIOD,
          signedDate: Date.now() - 1000,
        })
      ).signedPayload,
    );
    const renewed = (
      await signTransaction({ originalTransactionId: tx.originalTransactionId, purchaseDate: Date.now(), expiresDate: Date.now() + 30 * DAY })
    ).payload;
    await postNotification(
      (await signNotification({ type: "DID_RENEW", subtype: "BILLING_RECOVERY", transaction: renewed, status: APPLE_STATUS.ACTIVE })).signedPayload,
    );
    const info = await customerInfo("n-recover");
    expect(info.subscriptions.pro_monthly).toMatchObject({
      expires_date: iso(renewed.expiresDate!),
      billing_issues_detected_at: null,
      grace_period_expires_date: null,
    });
  });

  it("billing retry without grace: billing issue flagged, access ends at expiry", async () => {
    const expired = Date.now() - DAY;
    const tx = await subscribed("n-retry", { purchaseDate: expired - 30 * DAY, expiresDate: expired });
    await postNotification(
      (
        await signNotification({
          type: "DID_FAIL_TO_RENEW",
          transaction: tx,
          renewal: { isInBillingRetryPeriod: true },
          status: APPLE_STATUS.BILLING_RETRY,
        })
      ).signedPayload,
    );
    const info = await customerInfo("n-retry");
    expect(info.subscriptions.pro_monthly.billing_issues_detected_at).not.toBeNull();
    expect(info.entitlements.pro.expires_date).toBe(iso(expired));
    expect(info.management_url).toBeNull();
  });

  it("ignores status that's older than what's stored (out-of-order delivery)", async () => {
    const tx = await subscribed("n-order");
    const newer = await signNotification({ type: "DID_CHANGE_RENEWAL_STATUS", transaction: tx, renewal: { autoRenewStatus: 1 }, signedDate: Date.now() });
    const older = await signNotification({
      type: "DID_CHANGE_RENEWAL_STATUS",
      transaction: tx,
      renewal: { autoRenewStatus: 0 },
      signedDate: Date.now() - 60_000,
    });
    await postNotification(newer.signedPayload);
    await postNotification(older.signedPayload);
    expect((await customerInfo("n-order")).subscriptions.pro_monthly.unsubscribe_detected_at).toBeNull();
  });
});

describe("refunds, revocations and upgrades", () => {
  it("REFUND ends access at the revocation time", async () => {
    const tx = await subscribed("n-refund");
    const revoked = Date.now() - 1000;
    const refunded = (await signTransaction({ ...tx, revocationDate: revoked, revocationReason: 0 })).payload;
    await postNotification((await signNotification({ type: "REFUND", transaction: refunded, status: APPLE_STATUS.REVOKED })).signedPayload);
    const info = await customerInfo("n-refund");
    expect(info.subscriptions.pro_monthly).toMatchObject({ refunded_at: iso(revoked), expires_date: iso(revoked) });
    expect(info.entitlements.pro.expires_date).toBe(iso(revoked));
  });

  it("stores a revocationReason of null as NULL, and a number as its digits", async () => {
    const reasonOf = async (transactionId: string) =>
      (await env.DB.prepare("SELECT revocation_reason FROM store_transaction WHERE transaction_id = ?").bind(transactionId).first())?.revocation_reason;
    const a = await subscribed("n-reason-null");
    const nulled = (await signTransaction({ ...a, revocationDate: Date.now() - 1000, revocationReason: null })).payload;
    await postNotification((await signNotification({ type: "REFUND", transaction: nulled, status: APPLE_STATUS.REVOKED })).signedPayload);
    expect(await reasonOf(a.transactionId)).toBeNull();
    const b = await subscribed("n-reason-1");
    const numbered = (await signTransaction({ ...b, revocationDate: Date.now() - 1000, revocationReason: 1 })).payload;
    await postNotification((await signNotification({ type: "REFUND", transaction: numbered, status: APPLE_STATUS.REVOKED })).signedPayload);
    expect(await reasonOf(b.transactionId)).toBe("1");
  });

  it("REVOKE (family sharing ended) removes a one-time purchase", async () => {
    const tx = await subscribed("n-revoke", { productId: "lifetime", type: "Non-Consumable", expiresDate: undefined, inAppOwnershipType: "FAMILY_SHARED" });
    expect((await customerInfo("n-revoke")).entitlements.pro.product_identifier).toBe("lifetime");
    const revoked = (await signTransaction({ ...tx, revocationDate: Date.now() })).payload;
    await postNotification((await signNotification({ type: "REVOKE", transaction: revoked })).signedPayload);
    const info = await customerInfo("n-revoke");
    expect(info.entitlements).toEqual({});
    expect(info.non_subscriptions).toEqual({});
  });

  it("an upgraded transaction stops granting; the upgrade's product takes over", async () => {
    const monthly = await subscribed("n-upgrade", { expiresDate: Date.now() + 20 * DAY });
    const annual = (
      await signTransaction({ productId: "pro_annual", originalTransactionId: monthly.originalTransactionId, expiresDate: Date.now() + 365 * DAY })
    ).payload;
    const upgradedMonthly = (await signTransaction({ ...monthly, isUpgraded: true })).payload;
    await postNotification((await signNotification({ type: "DID_CHANGE_RENEWAL_PREF", subtype: "UPGRADE", transaction: upgradedMonthly })).signedPayload);
    await postNotification((await signNotification({ type: "DID_RENEW", transaction: annual, status: 1 })).signedPayload);
    const info = await customerInfo("n-upgrade");
    expect(info.entitlements.pro.product_identifier).toBe("pro_annual");
    expect(info.entitlements.annual_perks.product_identifier).toBe("pro_annual");
  });
});
