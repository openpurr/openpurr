// CustomerInfo snapshots as seen over HTTP: reads always reflect the latest purchase, notification,
// transfer and config, whether or not a stored snapshot serves them. Lite serves a current snapshot
// with an ETag header and computes from the ledger (no ETag) when the snapshot is missing or stale;
// those checks are Lite-only. Ported from lite/test/snapshot.test.ts.

import { beforeEach, describe, expect, it } from "vitest";
import {
  admin,
  call,
  DAY,
  itEdition,
  jobs,
  now,
  onEdition,
  postAppleTransaction,
  postNotification,
  putConfig,
  reset,
  settle,
  signNotification,
  signTransaction,
  testConfig,
} from "../src";

const GRACE_PERIOD = 4; // Apple's subscription status code

const get = (user: string) => call(`/v1/subscribers/${encodeURIComponent(user)}`);
const withoutTime = (body: any) => ({ ...body, request_date: undefined, request_date_ms: undefined, subscriber: { ...body.subscriber, last_seen: undefined } });

/** The test config with the offering renamed: a new config version that doesn't change CustomerInfo. */
function renamedOffering() {
  const raw = testConfig();
  raw.offerings[0].description = "Standard, renamed";
  return raw;
}

beforeEach(async () => {
  await reset();
});

describe("CustomerInfo snapshots", () => {
  it("serve reads after a purchase, identical to computing from the ledger", async () => {
    const { res } = await postAppleTransaction("snap-1", { productId: "pro_annual", expiresDate: now() + 300 * DAY });
    await settle();
    const fromSnapshot = await get("snap-1");
    expect(withoutTime(fromSnapshot.body).subscriber).toEqual(withoutTime(res.body).subscriber);

    // A new config version makes the snapshot stale, so the next read is computed.
    expect((await putConfig(renamedOffering())).status).toBe(201);
    const computed = await get("snap-1");
    expect(withoutTime(computed.body)).toEqual(withoutTime(fromSnapshot.body));
    if (onEdition("lite")) {
      expect(fromSnapshot.headers.get("etag")).toBeTruthy();
      expect(computed.headers.get("etag")).toBeNull();
    }
  });

  itEdition("lite", "send an ETag that changes when CustomerInfo does", async () => {
    const first = await postAppleTransaction("snap-etag", { productId: "pro_monthly" });
    const etag1 = first.res.headers.get("etag");
    expect(etag1).toMatch(/^"[0-9a-f]{24}"$/);
    const got = await call("/v1/subscribers/snap-etag");
    expect(got.status).toBe(200); // never 304 to the SDK, even with an ETag
    expect(got.headers.get("etag")).toBe(etag1);

    await postAppleTransaction("snap-etag", { productId: "lifetime", type: "Non-Consumable", expiresDate: undefined });
    expect((await call("/v1/subscribers/snap-etag")).headers.get("etag")).not.toBe(etag1);
  });

  it("aren't served after a notification changes the purchase (invalidated in the same batch)", async () => {
    const { payload: tx, res } = await postAppleTransaction("snap-notify", { expiresDate: now() - DAY });
    const grace = now() + 5 * DAY;
    await postNotification(
      (await signNotification({ type: "DID_FAIL_TO_RENEW", subtype: "GRACE_PERIOD", transaction: tx, renewal: { gracePeriodExpiresDate: grace }, status: GRACE_PERIOD }))
        .signedPayload,
    );
    const after = await get("snap-notify");
    expect(after.body.subscriber.entitlements.pro.grace_period_expires_date).not.toBeNull();
    if (onEdition("lite")) {
      await settle();
      const rebuilt = await get("snap-notify");
      expect(rebuilt.headers.get("etag")).toBeTruthy();
      expect(rebuilt.headers.get("etag")).not.toBe(res.headers.get("etag"));
    }
  });

  it("are recomputed, not served, when the config changes", async () => {
    await postAppleTransaction("snap-config", { productId: "pro_annual", expiresDate: now() + 300 * DAY });
    const changed = testConfig();
    delete changed.entitlements.annual_perks;
    expect((await putConfig(changed)).status).toBe(201);
    const res = await get("snap-config");
    expect(Object.keys(res.body.subscriber.entitlements)).toEqual(["pro"]);
    if (onEdition("lite")) {
      expect(res.headers.get("etag")).toBeNull();
      // The scheduled backfill rebuilds it for the new version.
      await jobs();
      const rebuilt = await get("snap-config");
      expect(rebuilt.headers.get("etag")).toBeTruthy();
      expect(Object.keys(rebuilt.body.subscriber.entitlements)).toEqual(["pro"]);
    }
  });

  it("are rebuilt for a customer who loses a purchase in a transfer", async () => {
    const { payload } = await postAppleTransaction("snap-alice", { productId: "pro_annual", expiresDate: now() + 300 * DAY });
    const { jws } = await signTransaction(payload);
    await call("/v1/receipts", { body: { app_user_id: "snap-bob", fetch_token: jws, is_restore: true } });
    const alice = await get("snap-alice");
    expect(alice.body.subscriber.entitlements).toEqual({});
    if (onEdition("lite")) expect(alice.headers.get("etag")).toBeTruthy();
  });

  itEdition("lite", "are backfilled by the scheduled job, a few per run", async () => {
    const users = Array.from({ length: 10 }, (_, i) => `snap-many-${i}`);
    for (const u of users) await postAppleTransaction(u, { productId: "pro_monthly" });
    // A new config version leaves every snapshot stale.
    expect((await putConfig(renamedOffering())).status).toBe(201);
    const withEtag = async () => (await Promise.all(users.map(get))).filter((r) => r.headers.get("etag")).length;
    expect(await withEtag()).toBe(0);

    await jobs();
    expect(await withEtag()).toBe(8); // SNAPSHOTS_PER_RUN
    await jobs();
    expect(await withEtag()).toBe(10);
  });

  it("make an unknown user's read an empty body, without writing", async () => {
    const res = await get("snap-nobody");
    expect(res.status).toBe(200);
    expect(res.body.subscriber.entitlements).toEqual({});
    expect((await admin("GET", "/customers")).body.customers).toEqual([]);
    if (onEdition("lite")) expect(res.headers.get("etag")).toBeNull();
  });
});
