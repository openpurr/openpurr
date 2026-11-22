// Subscriber attributes: what the SDK syncs, ordering by updated_at_ms, clearing, attribution keys
// that never change, validation (400 / 7263), the 50-key limit, attributes sent with receipts,
// merging on logIn, and attributes as activity for the cleanup job. Stored attributes are read
// through the admin API. Ported from lite/test/attributes.test.ts.

import { beforeEach, describe, expect, it } from "vitest";
import { admin, advanceClock, call, DAY, jobs, reset, signTransaction } from "../src";

const setAttributes = (user: string, attributes: Record<string, { value: string | null; updated_at_ms: number }>) =>
  call(`/v1/subscribers/${encodeURIComponent(user)}/attributes`, { body: { attributes } });

async function attributesOf(user: string): Promise<Record<string, { value: string; updated_at_ms: number }>> {
  const res = await admin("GET", `/customers/${encodeURIComponent(user)}`);
  if (res.status === 404) return {};
  expect(res.status).toBe(200);
  return res.body.attributes;
}

beforeEach(async () => {
  await reset();
});

describe("subscriber attributes", () => {
  it("stores what the SDK syncs", async () => {
    const res = await setAttributes("attr-1", {
      $email: { value: "a@example.com", updated_at_ms: 1000 },
      plan_interest: { value: "annual", updated_at_ms: 1000 },
    });
    expect(res.status).toBe(200);
    expect(await attributesOf("attr-1")).toEqual({
      $email: { value: "a@example.com", updated_at_ms: 1000 },
      plan_interest: { value: "annual", updated_at_ms: 1000 },
    });
  });

  it("keeps the newest value when syncs arrive out of order", async () => {
    await setAttributes("attr-2", { $email: { value: "new@example.com", updated_at_ms: 2000 } });
    await setAttributes("attr-2", { $email: { value: "old@example.com", updated_at_ms: 1000 } });
    expect((await attributesOf("attr-2")).$email?.value).toBe("new@example.com");
  });

  it("clears an attribute sent as an empty string, and an older value can't bring it back", async () => {
    await setAttributes("attr-3", { $displayName: { value: "Sam", updated_at_ms: 1000 } });
    await setAttributes("attr-3", { $displayName: { value: "", updated_at_ms: 2000 } });
    await setAttributes("attr-3", { $displayName: { value: "Sam", updated_at_ms: 1500 } });
    expect(await attributesOf("attr-3")).toEqual({});
  });

  it("never overwrites attribution data once set", async () => {
    await setAttributes("attr-4", { $mediaSource: { value: "facebook", updated_at_ms: 1000 } });
    await setAttributes("attr-4", { $mediaSource: { value: "tiktok", updated_at_ms: 5000 } });
    expect((await attributesOf("attr-4")).$mediaSource?.value).toBe("facebook");
  });

  it("stores the valid attributes and reports the invalid ones with 400 / 7263", async () => {
    const res = await setAttributes("attr-5", {
      good_key: { value: "ok", updated_at_ms: 1 },
      "bad key": { value: "x", updated_at_ms: 1 },
      "1starts_with_digit": { value: "x", updated_at_ms: 1 },
      long_value: { value: "x".repeat(501), updated_at_ms: 1 },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(7263);
    expect(res.body.attribute_errors.map((e: any) => e.key_name).sort()).toEqual(["1starts_with_digit", "bad key", "long_value"]);
    expect(Object.keys(await attributesOf("attr-5"))).toEqual(["good_key"]);
  });

  it("allows at most 50 custom attributes, but reserved keys and updates still work", async () => {
    const fifty = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, { value: "v", updated_at_ms: 1 }]));
    expect((await setAttributes("attr-6", fifty)).status).toBe(200);
    const res = await setAttributes("attr-6", {
      k51: { value: "v", updated_at_ms: 2 },
      k0: { value: "updated", updated_at_ms: 2 },
      $email: { value: "e@example.com", updated_at_ms: 2 },
    });
    expect(res.status).toBe(400);
    expect(res.body.attribute_errors).toEqual([{ key_name: "k51", message: expect.stringMatching(/at most 50/) }]);
    const stored = await attributesOf("attr-6");
    expect(stored.k0?.value).toBe("updated");
    expect(stored.$email?.value).toBe("e@example.com");
    expect(stored.k51).toBeUndefined();
  });

  it("stores attributes sent with a receipt; invalid ones never fail the purchase", async () => {
    const { jws } = await signTransaction();
    const res = await call("/v1/receipts", {
      body: {
        app_user_id: "attr-7",
        fetch_token: jws,
        attributes: { $email: { value: "buyer@example.com", updated_at_ms: 1 }, "not valid!": { value: "x", updated_at_ms: 1 } },
      },
    });
    expect(res.status).toBe(200);
    expect(await attributesOf("attr-7")).toEqual({ $email: { value: "buyer@example.com", updated_at_ms: 1 } });
  });

  it("merge with the account on logIn, newest value winning per key", async () => {
    const anon = "$RCAnonymousID:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    await setAttributes("attr-account", { $email: { value: "old@example.com", updated_at_ms: 1000 }, plan: { value: "free", updated_at_ms: 1000 } });
    await setAttributes(anon, { $email: { value: "new@example.com", updated_at_ms: 2000 }, onboarding: { value: "done", updated_at_ms: 2000 } });
    await call("/v1/subscribers/identify", { body: { app_user_id: anon, new_app_user_id: "attr-account" } });
    const merged = await attributesOf("attr-account");
    expect(merged.$email?.value).toBe("new@example.com");
    expect(merged.plan?.value).toBe("free");
    expect(merged.onboarding?.value).toBe("done");
  });

  it("count as activity for the cleanup job", async () => {
    // Customers who never purchased are cleaned up once inactive for 90 days. Instead of backdating
    // rows, move the server's clock: the customer is first seen now, then syncs an attribute 110 days later.
    await setAttributes("attr-active", { x: { value: "1", updated_at_ms: 1 } });
    await advanceClock(110 * DAY);
    await setAttributes("attr-active", { y: { value: "2", updated_at_ms: 2 } });
    await jobs();
    expect((await admin("GET", "/customers/attr-active")).status).toBe(200);

    // Once the attribute is old too, the customer (and their attributes) are cleaned up.
    await advanceClock(100 * DAY);
    await jobs();
    expect((await admin("GET", "/customers/attr-active")).status).toBe(404);
    // The same ID starts afresh, without the old attributes.
    await setAttributes("attr-active", { z: { value: "3", updated_at_ms: 3 } });
    expect(await attributesOf("attr-active")).toEqual({ z: { value: "3", updated_at_ms: 3 } });
  });
});
