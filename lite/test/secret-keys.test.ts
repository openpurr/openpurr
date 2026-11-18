import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { clearSecretKeyCache, hashKey } from "../src/secret-keys";
import { appWithRateLimits, call, DAY, postAppleTransaction } from "./helpers";

async function createKey(opts: { scopes?: string[]; expiresAt?: number; revoked?: boolean } = {}) {
  const key = `sk_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO api_key (id, key_hash, key_prefix, name, scopes, created_at, expires_at, revoked_at)
     VALUES (?, ?, ?, 'test', ?, ?, ?, ?)`,
  )
    .bind(id, await hashKey(key), key.slice(0, 10), JSON.stringify(opts.scopes ?? ["customers:read"]), Date.now(), opts.expiresAt ?? null, opts.revoked ? Date.now() : null)
    .run();
  return { key, id };
}

const serverGet = (user: string, key: string, headers: Record<string, string> = {}) =>
  call(`/v1/subscribers/${encodeURIComponent(user)}`, { key, headers: { "x-platform": "", ...headers } });

beforeEach(() => clearSecretKeyCache());

describe("secret keys", () => {
  it("read full CustomerInfo including subscriber attributes", async () => {
    await postAppleTransaction("srv-user", { productId: "pro_annual", expiresDate: Date.now() + 300 * DAY });
    await call("/v1/subscribers/srv-user/attributes", { body: { attributes: { $email: { value: "s@example.com", updated_at_ms: 5 } } } });
    const { key } = await createKey();

    const res = await serverGet("srv-user", key);
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.subscriber.entitlements.pro.product_identifier).toBe("pro_annual");
    expect(body.subscriber.subscriber_attributes).toEqual({ $email: { value: "s@example.com", updated_at_ms: 5 } });

    // SDK keys never see attributes, as with RevenueCat.
    const sdk = await (await call("/v1/subscribers/srv-user")).json<any>();
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
    const revoked = await createKey({ revoked: true });
    const expired = await createKey({ expiresAt: Date.now() - 1000 });
    for (const key of ["sk_not_a_real_key_00000000000000", revoked.key, expired.key]) {
      const res = await serverGet("srv-x", key);
      expect(res.status, key).toBe(401);
      expect(await res.json()).toMatchObject({ code: 7225 });
    }
  });

  it("keep working during a rotation overlap until the old key expires", async () => {
    const old = await createKey({ expiresAt: Date.now() + 3600_000 });
    expect((await serverGet("srv-rotate", old.key)).status).toBe(200);
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
    const noScope = await createKey({ scopes: [] });
    expect((await serverGet("srv-y", noScope.key)).status).toBe(403);
  });

  it("record last use at most hourly", async () => {
    const { key, id } = await createKey();
    await serverGet("srv-touch", key);
    await serverGet("srv-touch", key);
    const row = await env.DB.prepare("SELECT last_used_at FROM api_key WHERE id = ?").bind(id).first<{ last_used_at: number }>();
    expect(row!.last_used_at).toBeGreaterThan(Date.now() - 60_000);
  });

  it("skip the per-IP limit when valid; failed attempts still count against the IP", async () => {
    const { app } = appWithRateLimits({ ip: 1 });
    const { key } = await createKey();
    const ip = { "cf-connecting-ip": "9.9.9.9" };
    for (let i = 0; i < 3; i++) expect((await call("/v1/subscribers/srv-ip", { app, key, headers: ip })).status).toBe(200);
    expect((await call("/v1/subscribers/srv-ip", { app, key: "sk_wrong_wrong_wrong_wrong_0000", headers: ip })).status).toBe(401);
    expect((await call("/v1/subscribers/srv-ip", { app, key: "sk_wrong_wrong_wrong_wrong_0001", headers: ip })).status).toBe(429);
  });
});
