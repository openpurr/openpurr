import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config";
import { findCustomer } from "../src/ledger";
import { runScheduled, SNAPSHOTS_PER_RUN } from "../src/scheduled";
import { readCustomerInfo } from "../src/snapshot";
import { APPLE_STATUS } from "../src/stores/apple";
import { call, DAY, postAppleTransaction, postNotification, rawTestConfig, signNotification, signTransaction, testConfig } from "./helpers";

const read = (user: string, config = testConfig) => readCustomerInfo(env.DB, config, user, { requestStore: "app_store", now: 1_800_000_000_000 });
const withoutTime = (body: any) => ({ ...body, request_date: undefined, request_date_ms: undefined, subscriber: { ...body.subscriber, last_seen: undefined } });

describe("CustomerInfo snapshots", () => {
  it("serve reads from one row after a purchase, identical to computing from the ledger", async () => {
    await postAppleTransaction("snap-1", { productId: "pro_annual", expiresDate: Date.now() + 300 * DAY });
    const fromSnapshot = await read("snap-1");
    expect(fromSnapshot.source).toBe("snapshot");

    const customer = (await findCustomer(env.DB, "snap-1"))!;
    await env.DB.prepare("DELETE FROM customer_snapshot WHERE customer_id = ?").bind(customer.id).run();
    const computed = await read("snap-1");
    expect(computed.source).toBe("computed");
    expect(withoutTime(computed.body)).toEqual(withoutTime(fromSnapshot.body));
  });

  it("send an ETag that changes when CustomerInfo does", async () => {
    const first = await postAppleTransaction("snap-etag", { productId: "pro_monthly" });
    const etag1 = first.res.headers.get("etag");
    expect(etag1).toMatch(/^"[0-9a-f]{24}"$/);
    const get = await call("/v1/subscribers/snap-etag");
    expect(get.status).toBe(200); // never 304 to the SDK, even with an ETag
    expect(get.headers.get("etag")).toBe(etag1);

    await postAppleTransaction("snap-etag", { productId: "lifetime", type: "Non-Consumable", expiresDate: undefined });
    expect((await call("/v1/subscribers/snap-etag")).headers.get("etag")).not.toBe(etag1);
  });

  it("aren't served after a notification changes the purchase (invalidated in the same batch)", async () => {
    const { payload: tx } = await postAppleTransaction("snap-notify", { expiresDate: Date.now() - DAY });
    const grace = Date.now() + 5 * DAY;
    await postNotification(
      (await signNotification({ type: "DID_FAIL_TO_RENEW", subtype: "GRACE_PERIOD", transaction: tx, renewal: { gracePeriodExpiresDate: grace }, status: APPLE_STATUS.GRACE_PERIOD })).signedPayload,
    );
    const { body } = await read("snap-notify");
    expect((body.subscriber.entitlements as any).pro.grace_period_expires_date).not.toBeNull();
  });

  it("are recomputed, not served, when the config changes", async () => {
    await postAppleTransaction("snap-config", { productId: "pro_annual", expiresDate: Date.now() + 300 * DAY });
    const changed = structuredClone(rawTestConfig) as any;
    delete changed.entitlements.annual_perks;
    const newConfig = parseConfig(changed);
    expect(newConfig.version).not.toBe(testConfig.version);
    const res = await read("snap-config", newConfig);
    expect(res.source).toBe("computed");
    expect(Object.keys(res.body.subscriber.entitlements)).toEqual(["pro"]);
  });

  it("are rebuilt for a customer who loses a purchase in a transfer", async () => {
    const { payload } = await postAppleTransaction("snap-alice", { productId: "pro_annual", expiresDate: Date.now() + 300 * DAY });
    const { jws } = await signTransaction(payload);
    await call("/v1/receipts", { body: { app_user_id: "snap-bob", fetch_token: jws, is_restore: true } });
    const alice = await read("snap-alice");
    expect(alice.source).toBe("snapshot");
    expect(alice.body.subscriber.entitlements).toEqual({});
  });

  it("are backfilled by the scheduled job, a few per run", async () => {
    const customers = await env.DB.prepare("SELECT count(*) AS n FROM customer").first<{ n: number }>();
    await env.DB.prepare("DELETE FROM customer_snapshot").run();
    const results = await runScheduled(env, Date.parse("2026-12-01T10:07:00Z"), { deps: { config: testConfig, appleRoots: [] } });
    const backfilled = results.find((r) => r.task === "backfill-snapshots")!.rows;
    expect(backfilled).toBe(Math.min(SNAPSHOTS_PER_RUN, customers!.n));
    const { n } = (await env.DB.prepare("SELECT count(*) AS n FROM customer_snapshot").first<{ n: number }>())!;
    expect(n).toBe(backfilled);
  });

  it("make an unknown user's read a single query with an empty body", async () => {
    const res = await read("snap-nobody");
    expect(res.source).toBe("empty");
    expect(res.body.subscriber.entitlements).toEqual({});
  });
});
