// Drives the stub the way the SDKs do (headers and bodies per spec/sdk-wire-contract.md)
// and checks every response against the keys each platform requires.

import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const BASE = "https://openpurr.test";
const ANON = "$RCAnonymousID:0123456789abcdef0123456789abcdef";

function call(path: string, opts: { key?: string; body?: unknown; platform?: "ios" | "android" } = {}) {
  const platform = opts.platform ?? "ios";
  const key = opts.key ?? (platform === "ios" ? "appl_testkey" : "goog_testkey");
  return exports.default.fetch(
    new Request(BASE + path, {
      method: opts.body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "x-platform": platform === "ios" ? "iOS" : "android",
        "x-version": platform === "ios" ? "5.103.1" : "11.4.0",
        "x-revenuecat-etag": "",
        ...(platform === "ios" ? { "x-is-sandbox": "true" } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
  );
}

function jwsPayload(payload: object) {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64({ alg: "ES256", x5c: [] })}.${b64(payload)}.sig`;
}

/** Keys from section 3.1 of the wire contract: the union of what iOS and Android require. */
function expectValidCustomerInfo(body: any) {
  expect(body.request_date).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  expect(typeof body.subscriber.original_app_user_id).toBe("string");
  expect(body.subscriber.first_seen).toMatch(/Z$/);
  expect(body.subscriber.subscriptions).toBeTypeOf("object");
  expect(body.subscriber.non_subscriptions).toBeTypeOf("object");
  for (const e of Object.values<any>(body.subscriber.entitlements)) {
    expect(e.purchase_date).toBeTruthy();
    const target =
      body.subscriber.subscriptions[e.product_identifier] ?? body.subscriber.non_subscriptions[e.product_identifier]?.[0];
    expect(target, `entitlement points at missing product ${e.product_identifier}`).toBeTruthy();
    expect(target.original_purchase_date).toBeTruthy();
    expect(target.store).toBeTruthy();
    expect(typeof target.is_sandbox).toBe("boolean");
  }
  for (const list of Object.values<any[]>(body.subscriber.non_subscriptions)) {
    for (const n of list) expect(typeof n.is_sandbox).toBe("boolean");
  }
}

describe("auth", () => {
  it("rejects unknown keys with a JSON 7225 error", async () => {
    const res = await call(`/v1/subscribers/${encodeURIComponent(ANON)}`, { key: "appl_wrong" });
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await res.json()).toMatchObject({ code: 7225 });
  });

  it("serves the DEBUG health check without a key", async () => {
    const res = await exports.default.fetch(`${BASE}/v1/subscribers/x/health_report_availability`);
    expect(await res.json()).toEqual({ report_logs: false });
  });
});

describe("startup calls", () => {
  it("returns an empty CustomerInfo for a new anonymous user, without writing", async () => {
    // iOS sends $ and : raw; Android percent-encodes them. Both must resolve to the same user.
    for (const path of [`/v1/subscribers/${ANON}`, `/v1/subscribers/${encodeURIComponent(ANON)}`]) {
      const res = await call(path);
      expect(res.status).toBe(200);
      const body = await res.json<any>();
      expectValidCustomerInfo(body);
      expect(body.subscriber.original_app_user_id).toBe(ANON);
    }
    const { n } = (await env.DB.prepare("SELECT count(*) AS n FROM spike_customer").first<{ n: number }>())!;
    expect(n).toBe(0);
  });

  it("never answers 304, even when an ETag is sent", async () => {
    const res = await exports.default.fetch(
      new Request(`${BASE}/v1/subscribers/u1`, {
        headers: { authorization: "Bearer appl_testkey", "x-revenuecat-etag": "abc" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("serves offerings with a current_offering_id and per-platform packages", async () => {
    const ios = await (await call(`/v1/subscribers/u1/offerings`)).json<any>();
    expect(ios.current_offering_id).toBe("default");
    expect(ios.offerings[0].packages[0]).toEqual({ identifier: "$rc_monthly", platform_product_identifier: "pro_monthly" });

    const android = await (await call(`/v1/subscribers/u1/offerings`, { platform: "android" })).json<any>();
    expect(android.offerings[0].packages[0]).toMatchObject({ platform_product_plan_identifier: "monthly" });
  });

  it("serves the product entitlement mapping", async () => {
    const body = await (await call("/v1/product_entitlement_mapping")).json<any>();
    expect(body.product_entitlement_mapping.pro_monthly).toEqual({
      product_identifier: "pro_monthly",
      base_plan_id: null,
      entitlements: ["pro"],
    });
  });

  it("answers remote config with 204", async () => {
    const res = await call("/v1/config/app", { body: { app_user_id: "u1", fetch_context: "app_start" } });
    expect(res.status).toBe(204);
  });

  it("accepts attributes and events with 200", async () => {
    expect((await call("/v1/subscribers/u1/attributes", { body: { attributes: {} } })).status).toBe(200);
    expect((await call("/v1/events", { body: { events: [] } })).status).toBe(200);
  });
});

describe("purchase flow", () => {
  it("iOS StoreKit 2: purchase grants the entitlement", async () => {
    const res = await call("/v1/receipts", {
      body: {
        app_user_id: ANON,
        fetch_token: jwsPayload({
          transactionId: "2000000111",
          originalTransactionId: "2000000111",
          productId: "pro_monthly",
          purchaseDate: Date.parse("2026-11-01T00:00:00Z"),
          originalPurchaseDate: Date.parse("2026-11-01T00:00:00Z"),
          expiresDate: Date.parse("2099-12-01T00:00:00Z"),
          environment: "Sandbox",
        }),
        product_id: "pro_monthly",
        transaction_id: "2000000111",
        is_restore: false,
        initiation_source: "purchase",
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expectValidCustomerInfo(body);
    expect(body.subscriber.entitlements.pro).toMatchObject({
      product_identifier: "pro_monthly",
      expires_date: "2099-12-01T00:00:00Z",
    });
    expect(body.subscriber.subscriptions.pro_monthly).toMatchObject({ store: "app_store", is_sandbox: true });
  });

  it("iOS consumable: echoes store_transaction_id so StoreKit can finish it", async () => {
    const body = await (
      await call("/v1/receipts", {
        body: { app_user_id: "u2", fetch_token: "MIIT-base64-receipt", product_id: "coins_100", transaction_id: "2000000222" },
      })
    ).json<any>();
    expectValidCustomerInfo(body);
    expect(body.subscriber.non_subscriptions.coins_100[0].store_transaction_id).toBe("2000000222");
  });

  it("Android: subscription keyed by product with base plan; consumables marked should_consume", async () => {
    const sub = await (
      await call("/v1/receipts", {
        platform: "android",
        body: {
          app_user_id: "u3",
          fetch_token: "play-token-1",
          product_ids: ["pro_monthly"],
          platform_product_ids: [{ product_id: "pro_monthly", base_plan_id: "monthly", offer_id: null }],
        },
      })
    ).json<any>();
    expectValidCustomerInfo(sub);
    expect(sub.subscriber.subscriptions.pro_monthly.product_plan_identifier).toBe("monthly");
    expect(sub.subscriber.entitlements.pro.product_plan_identifier).toBe("monthly");
    expect(sub.purchased_products).toEqual({ pro_monthly: { should_consume: false } });

    const coins = await (
      await call("/v1/receipts", {
        platform: "android",
        body: { app_user_id: "u3", fetch_token: "play-token-2", product_ids: ["coins_100"] },
      })
    ).json<any>();
    expect(coins.purchased_products).toEqual({ coins_100: { should_consume: true } });
  });

  it("unknown product returns 5xx so the store keeps the transaction queued", async () => {
    const res = await call("/v1/receipts", {
      body: { app_user_id: "u4", fetch_token: "x", product_id: "not_configured" },
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 7110 });
  });

  it("logIn: 201 for a new user, 200 after; anonymous purchases move across", async () => {
    await call("/v1/receipts", {
      body: { app_user_id: ANON, fetch_token: "receipt", product_id: "lifetime", transaction_id: "2000000333" },
    });
    const first = await call("/v1/subscribers/identify", { body: { app_user_id: ANON, new_app_user_id: "user@example" } });
    expect(first.status).toBe(201);
    const body = await first.json<any>();
    expectValidCustomerInfo(body);
    expect(body.subscriber.entitlements.pro.product_identifier).toBe("lifetime");
    expect(body.subscriber.entitlements.pro.expires_date).toBeNull();

    const again = await call("/v1/subscribers/identify", { body: { app_user_id: ANON, new_app_user_id: "user@example" } });
    expect(again.status).toBe(200);
  });
});

describe("capture", () => {
  it("records SDK requests with the API key redacted", async () => {
    await call("/v1/subscribers/capture-me");
    // Capture runs in waitUntil; give it a tick.
    await new Promise((r) => setTimeout(r, 50));
    const row = await env.DB.prepare("SELECT * FROM capture WHERE app_user_id = 'capture-me'").first<any>();
    expect(row.platform).toBe("iOS");
    expect(JSON.parse(row.headers).authorization).toBe("Bearer appl_…tkey");
  });
});
