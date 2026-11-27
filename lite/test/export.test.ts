import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import spec from "../../spec/export-tables.json";
import { randomToken, sha256Hex } from "../src/office/auth-crypto";
import { EXPORT_TABLES } from "../src/office/export";
import { call, postAppleTransaction, testApp } from "./helpers";

const ORIGIN = "https://openpurr.test";

async function tokenFor(role: "owner" | "admin", scopes: string[], apps: string[] | null = null) {
  const id = crypto.randomUUID();
  const t = `pat_${randomToken()}`;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO operator (id, email, name, role, app_ids, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id, `${id}@example.com`, role, role, apps && JSON.stringify(apps), Date.now()),
    env.DB.prepare("INSERT INTO access_token (id, operator_id, token_hash, token_prefix, name, scopes, created_at) VALUES (?, ?, ?, ?, 'test', ?, ?)").bind(
      crypto.randomUUID(),
      id,
      await sha256Hex(t),
      t.slice(0, 10),
      JSON.stringify(scopes),
      Date.now(),
    ),
  ]);
  return t;
}

async function get(path: string, token: string, method = "GET") {
  const ctx = createExecutionContext();
  const res = await testApp.fetch(new Request(`${ORIGIN}/admin/v1${path}`, { method, headers: { authorization: `Bearer ${token}` } }), env, ctx);
  await waitOnExecutionContext(ctx);
  return { status: res.status, body: await res.json<any>() };
}

/** Every row of a table, page by page. */
async function pages(token: string, table: string, query = "", limit = 2) {
  const rows: any[] = [];
  let after: unknown = null;
  for (let i = 0; i < 100; i++) {
    const q = new URLSearchParams(query);
    q.set("limit", String(limit));
    if (after) q.set("after", JSON.stringify(after));
    const r = await get(`/export/tables/${table}?${q}`, token);
    expect(r.status).toBe(200);
    rows.push(...r.body.rows);
    if (!r.body.next) return rows;
    after = r.body.next;
  }
  throw new Error("too many pages");
}

describe("export", () => {
  it("uses the tables of spec/export-tables.json", () => {
    expect(EXPORT_TABLES).toEqual(spec.tables);
  });

  it("is for owners who see every app", async () => {
    expect((await get("/export", await tokenFor("admin", ["read", "admin"]))).status).toBe(403);
    expect((await get("/export", await tokenFor("owner", ["read"]))).status).toBe(403);
    expect((await get("/export", await tokenFor("owner", ["admin"], ["ios"]))).status).toBe(403);
    const ok = await get("/export", await tokenFor("owner", ["admin"]));
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ format: "openpurr-export", version: 1, edition: "lite", now: expect.any(Number) });
    expect(ok.body.schema).toMatch(/^0022_/);
    expect(ok.body.tables.map((t: { name: string }) => t.name)).toEqual(spec.tables.map((t) => t.name));
    expect(ok.body.tables.find((t: { name: string }) => t.name === "customer_alias")).toEqual({
      name: "customer_alias",
      key: ["project_id", "app_user_id"],
      delta: true,
      customer_column: "customer_id",
    });
  });

  it("records the start of an export in the audit log", async () => {
    const token = await tokenFor("owner", ["admin"]);
    expect((await get("/export", token, "POST")).status).toBe(200);
    const row = await env.DB.prepare("SELECT action, source FROM audit_log ORDER BY id DESC LIMIT 1").first();
    expect(row).toEqual({ action: "data.exported", source: "api" });
  });

  it("pages through a table in key order", async () => {
    const token = await tokenFor("owner", ["admin"]);
    for (const u of ["exp_a", "exp_b", "exp_c"]) await postAppleTransaction(u);
    const all = await pages(token, "customer_alias");
    const ours = all.filter((r) => r.app_user_id.startsWith("exp_"));
    expect(ours.map((r) => r.app_user_id)).toEqual(["exp_a", "exp_b", "exp_c"]);
    const keys = all.map((r) => [r.project_id, r.app_user_id].join("\u0000"));
    expect(keys).toEqual([...keys].sort());
    const tx = await pages(token, "store_transaction", "", 1);
    expect(tx.length).toBeGreaterThanOrEqual(3);
    expect(tx[0]).toMatchObject({ id: expect.any(Number), store: "app_store", verified: 1 });
  });

  it("takes a delta, a customer's rows, and leaves optional columns out unless asked", async () => {
    const token = await tokenFor("owner", ["admin"]);
    const before = Date.now();
    await postAppleTransaction("exp_delta");
    const { results } = await env.DB.prepare("SELECT customer_id FROM customer_alias WHERE app_user_id = 'exp_delta'").all<{ customer_id: string }>();
    const id = results[0]!.customer_id;

    const delta = await pages(token, "customer_alias", `since=${before}`, 50);
    expect(delta.map((r) => r.app_user_id)).toContain("exp_delta");
    expect(delta.every((r) => r.created_at >= before)).toBe(true);
    expect(await pages(token, "job_state", `since=${before}`)).toEqual([]);

    const owned = await pages(token, "purchase_owner", `customers=${id}`);
    expect(owned).toHaveLength(1);
    expect(owned[0].customer_id).toBe(id);
    expect((await get(`/export/tables/store_transaction?customers=${id}`, token)).status).toBe(400);

    await env.DB.prepare(
      "INSERT INTO store_notification (store, notification_id, notification_type, environment, signed_at, received_at, payload) VALUES ('app_store', 'n-export', 'TEST', 'sandbox', 1, 1, 'signed')",
    ).run();
    const plain = (await pages(token, "store_notification", "", 50)).find((r) => r.notification_id === "n-export");
    expect(plain).toMatchObject({ notification_type: "TEST", payload: null });
    const full = (await pages(token, "store_notification", "optional=1", 50)).find((r) => r.notification_id === "n-export");
    expect(full.payload).toBe("signed");
    expect((await get("/export/tables/nope", token)).status).toBe(404);
    expect((await get("/export/tables/customer?after=oops", token)).status).toBe(400);
  });

  it("exports only new_customers from metric_daily", async () => {
    const token = await tokenFor("owner", ["admin"]);
    await env.DB.prepare(
      `INSERT INTO metric_daily (metric, environment, project_id, app_id, store, product_id, date, value) VALUES
         ('new_customers', '', 'default', '', '', '', '2026-01-01', 3), ('revenue', 'production', '', 'ios', 'app_store', 'pro_monthly', '2026-01-01', 9.99)`,
    ).run();
    const rows = await pages(token, "metric_daily", "", 50);
    expect(rows.map((r) => r.metric)).toEqual(["new_customers"]);
  });

  it("answers CustomerInfo by customer ID at a given time", async () => {
    const token = await tokenFor("owner", ["admin"]);
    await postAppleTransaction("exp_info");
    const row = await env.DB.prepare("SELECT customer_id FROM customer_alias WHERE app_user_id = 'exp_info'").first<{ customer_id: string }>();
    const at = Date.UTC(2030, 0, 1);
    const r = await get(`/export/customer-info?ids=${row!.customer_id},unknown&at=${at}`, token);
    expect(r.status).toBe(200);
    expect(r.body.customers).toHaveLength(1);
    const [c] = r.body.customers;
    expect(c).toMatchObject({ id: row!.customer_id, project_id: "default", app_user_id: "exp_info" });
    expect(c.customer_info.request_date_ms).toBe(at);
    // The same as the SDK sees, but for the time.
    const sdk = await call("/v1/subscribers/exp_info");
    const { request_date, request_date_ms, ...sdkRest } = (await sdk.json()) as any;
    const { request_date: _d, request_date_ms: _m, ...ours } = c.customer_info;
    for (const body of [sdkRest, ours]) {
      delete body.subscriber.last_seen;
      delete body.subscriber.management_url; // the SDK request names its store
    }
    expect(ours).toEqual(sdkRest);
  });
});
