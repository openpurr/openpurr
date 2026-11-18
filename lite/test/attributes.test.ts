import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { readAttributes } from "../src/attributes";
import { findCustomer } from "../src/ledger";
import { runScheduled } from "../src/scheduled";
import { call, signTransaction } from "./helpers";

const setAttributes = (user: string, attributes: Record<string, { value: string | null; updated_at_ms: number }>) =>
  call(`/v1/subscribers/${encodeURIComponent(user)}/attributes`, { body: { attributes } });

async function attributesOf(user: string): Promise<Record<string, { value: string; updated_at_ms: number }>> {
  const customer = await findCustomer(env.DB, user);
  return customer ? readAttributes(env.DB, customer.id) : {};
}

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
    const body = await res.json<any>();
    expect(body.code).toBe(7263);
    expect(body.attribute_errors.map((e: any) => e.key_name).sort()).toEqual(["1starts_with_digit", "bad key", "long_value"]);
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
    expect((await res.json<any>()).attribute_errors).toEqual([{ key_name: "k51", message: expect.stringMatching(/at most 50/) }]);
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
    const DAY = 864e5;
    const now = Date.now() + 200 * DAY;
    await setAttributes("attr-active", { x: { value: "1", updated_at_ms: 1 } });
    // Make the customer look old, but with an attribute synced recently relative to `now`.
    await env.DB.prepare("UPDATE customer SET first_seen = ? WHERE app_user_id = 'attr-active'").bind(now - 120 * DAY).run();
    await env.DB.prepare("UPDATE customer_alias SET created_at = ? WHERE app_user_id = 'attr-active'").bind(now - 120 * DAY).run();
    await env.DB.prepare(
      "UPDATE subscriber_attribute SET received_at = ? WHERE customer_id = (SELECT customer_id FROM customer_alias WHERE app_user_id = 'attr-active')",
    ).bind(now - 10 * DAY).run();
    await runScheduled(env, now, { all: true });
    expect(await findCustomer(env.DB, "attr-active")).not.toBeNull();

    // Once the attribute is old too, the customer (and their attributes) are cleaned up.
    await env.DB.prepare(
      "UPDATE subscriber_attribute SET received_at = ? WHERE customer_id = (SELECT customer_id FROM customer_alias WHERE app_user_id = 'attr-active')",
    ).bind(now - 120 * DAY).run();
    await runScheduled(env, now, { all: true });
    expect(await findCustomer(env.DB, "attr-active")).toBeNull();
    const left = await env.DB.prepare("SELECT count(*) AS n FROM subscriber_attribute WHERE key = 'x'").first<{ n: number }>();
    expect(left!.n).toBe(0);
  });
});
