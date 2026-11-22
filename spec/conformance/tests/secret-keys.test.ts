// Secret keys (sk_...) for server-to-server reads: created, expired and revoked through the admin
// API, used on the SDK API. Ported from lite/test/secret-keys.test.ts.

import { beforeEach, describe, expect, it } from "vitest";
import { admin, advanceClock, call, DAY, now, postAppleTransaction, reset } from "../src";

async function createKey(scopes: string[] = ["customers:read"]) {
  const res = await admin("POST", "/secret-keys", {}, { body: { name: "test", scopes } });
  expect(res.status).toBe(201);
  return { key: res.body.key as string, id: res.body.id as string };
}

const keyRow = async (id: string) => ((await admin("GET", "/secret-keys")).body.secret_keys as any[]).find((k) => k.id === id);

const serverGet = (user: string, key: string, headers: Record<string, string> = {}) =>
  call(`/v1/subscribers/${encodeURIComponent(user)}`, { key, headers: { "x-platform": "", ...headers } });

beforeEach(async () => {
  await reset();
});

describe("secret keys", () => {
  it("read full CustomerInfo including subscriber attributes", async () => {
    await postAppleTransaction("srv-user", { productId: "pro_annual", expiresDate: now() + 300 * DAY });
    await call("/v1/subscribers/srv-user/attributes", { body: { attributes: { $email: { value: "s@example.com", updated_at_ms: 5 } } } });
    const { key } = await createKey();
    expect(key).toMatch(/^sk_/);

    const res = await serverGet("srv-user", key);
    expect(res.status).toBe(200);
    expect(res.body.subscriber.entitlements.pro.product_identifier).toBe("pro_annual");
    expect(res.body.subscriber.subscriber_attributes).toEqual({ $email: { value: "s@example.com", updated_at_ms: 5 } });

    // SDK keys never see attributes, as with RevenueCat.
    const sdk = (await call("/v1/subscribers/srv-user")).body;
    expect(sdk.subscriber.subscriber_attributes).toEqual({});
  });

  it("support If-None-Match, with an ETag that also changes when attributes change", async () => {
    await postAppleTransaction("srv-etag", { productId: "pro_monthly" });
    const { key } = await createKey();
    const etag = (await serverGet("srv-etag", key)).headers.get("etag")!;
    expect(etag).toMatch(/^"[0-9a-f]{24}"$/);

    const notModified = await serverGet("srv-etag", key, { "if-none-match": etag });
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get("etag")).toBe(etag);

    await call("/v1/subscribers/srv-etag/attributes", { body: { attributes: { plan: { value: "family", updated_at_ms: 9 } } } });
    const changed = await serverGet("srv-etag", key, { "if-none-match": etag });
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).not.toBe(etag);

    // SDK requests never get a 304, whatever they send.
    expect((await call("/v1/subscribers/srv-etag", { headers: { "if-none-match": etag } })).status).toBe(200);
  });

  it("reject unknown, revoked and expired keys with 401", async () => {
    const revoked = await createKey();
    expect((await admin("POST", `/secret-keys/${revoked.id}/revoke`)).status).toBe(200);
    const expired = await createKey();
    expect((await admin("POST", `/secret-keys/${expired.id}/expire`, {}, { body: { in_hours: 0 } })).status).toBe(200);
    await advanceClock(1000);
    for (const key of ["sk_not_a_real_key_00000000000000", revoked.key, expired.key]) {
      const res = await serverGet("srv-x", key);
      expect(res.status, key).toBe(401);
      expect(res.body).toMatchObject({ code: 7225 });
    }
  });

  it("stop working within a minute of being revoked", async () => {
    const { key, id } = await createKey();
    expect((await serverGet("srv-revoke", key)).status).toBe(200);
    await admin("POST", `/secret-keys/${id}/revoke`);
    expect((await keyRow(id)).revoked_at).toBeTruthy();
    // Lookups may be cached for up to a minute.
    await advanceClock(61_000);
    expect((await serverGet("srv-revoke", key)).status).toBe(401);
  });

  it("keep working during a rotation overlap until the old key expires", async () => {
    const old = await createKey();
    const set = await admin("POST", `/secret-keys/${old.id}/expire`, {}, { body: { in_hours: 1 } });
    expect(set.body.expires_at).toBeGreaterThan(now());
    const fresh = await createKey();
    expect((await serverGet("srv-rotate", old.key)).status).toBe(200);
    expect((await serverGet("srv-rotate", fresh.key)).status).toBe(200);

    await advanceClock(3600_000 + 61_000);
    expect((await serverGet("srv-rotate", old.key)).status).toBe(401);
    expect((await serverGet("srv-rotate", fresh.key)).status).toBe(200);
  });

  it("can only read customers", async () => {
    const { key } = await createKey();
    for (const [path, body] of [
      ["/v1/subscribers/srv-y/offerings", undefined],
      ["/v1/product_entitlement_mapping", undefined],
      ["/v1/receipts", { app_user_id: "srv-y", fetch_token: "x" }],
      ["/v1/subscribers/srv-y/attributes", { attributes: {} }],
    ] as const) {
      const res = await call(path, { key, body });
      expect(res.status, path).toBe(403);
    }
  });

  it("record last use at most hourly", async () => {
    const { key, id } = await createKey();
    expect((await keyRow(id)).last_used_at).toBeNull();
    await serverGet("srv-touch", key);
    const first = (await keyRow(id)).last_used_at;
    expect(first).toBeGreaterThan(now() - 60_000);

    await advanceClock(61_000);
    await serverGet("srv-touch", key);
    expect((await keyRow(id)).last_used_at).toBe(first);

    await advanceClock(3600_000);
    await serverGet("srv-touch", key);
    expect((await keyRow(id)).last_used_at).toBeGreaterThan(first);
  });
});
