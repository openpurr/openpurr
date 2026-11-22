// export, migrate verify and migrate sql against fake deployments.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { main } from "../src/main.js";

const TOKEN = "pat_testtoken";
const spec = JSON.parse(readFileSync(new URL("../../spec/export-tables.json", import.meta.url), "utf8"));

/**
 * A fake deployment's export API over in-memory tables. A delta (since=) takes rows whose
 * updated_at (or created_at) is at least `since`, or the whole table for delta "all".
 */
function deployment(url, tables, { now = 1_800_000_000_000, infos = {}, charts = {} } = {}) {
  const calls = [];
  const byName = new Map(spec.tables.map((t) => [t.name, t]));
  const fetchImpl = async (u, init = {}) => {
    const url_ = new URL(u);
    if (!url_.href.startsWith(url)) return null;
    calls.push(`${init.method ?? "GET"} ${url_.pathname}${url_.search}`);
    if (init.headers?.authorization !== `Bearer ${TOKEN}`) return Response.json({ message: "Invalid token." }, { status: 401 });
    const path = url_.pathname.replace("/admin/v1", "");
    const q = url_.searchParams;
    if (path === "/export") {
      return Response.json({
        format: "openpurr-export",
        version: 1,
        edition: "lite",
        schema: "0021_snapshot_ledger_version.sql",
        now,
        tables: spec.tables.map((t) => ({ name: t.name, key: t.key, delta: t.delta !== null, customer_column: t.customer_column ?? null })),
      });
    }
    const m = path.match(/^\/export\/tables\/(.+)$/);
    if (m) {
      const t = byName.get(m[1]);
      let rows = [...(tables[t.name] ?? [])];
      if (q.has("customers")) {
        const ids = q.get("customers").split(",");
        rows = rows.filter((r) => ids.includes(r[t.customer_column]));
      } else if (q.has("since")) {
        if (t.delta === null) rows = [];
        else if (t.delta !== "all") rows = rows.filter((r) => (r.updated_at ?? r.created_at ?? 0) >= Number(q.get("since")));
      }
      const key = (r) => JSON.stringify(t.key.map((k) => r[k]));
      rows.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
      if (q.has("after")) rows = rows.filter((r) => key(r) > JSON.stringify(JSON.parse(q.get("after"))));
      const limit = Number(q.get("limit"));
      const page = rows.slice(0, limit);
      return Response.json({ rows: page, next: page.length === limit ? t.key.map((k) => page.at(-1)[k]) : null });
    }
    if (path === "/export/customer-info") {
      const at = Number(q.get("at"));
      const customers = q
        .get("ids")
        .split(",")
        .map((id) => (tables.customer ?? []).find((c) => c.id === id))
        .filter(Boolean)
        .map((c) => ({ id: c.id, project_id: c.project_id, app_user_id: c.app_user_id, customer_info: { request_date_ms: at, subscriber: infos[c.id] ?? { entitlements: {} } } }));
      return Response.json({ at, customers });
    }
    if (path === "/metrics/refresh") return Response.json({ refreshed: true });
    if (path === "/metrics") return Response.json({ charts: [{ id: "revenue" }, { id: "subscription_status" }], first_date: "2026-11-01" });
    const chart = path.match(/^\/metrics\/(.+)$/);
    if (chart) return Response.json({ points: charts[chart[1]] ?? [], categories: null });
    return Response.json({ message: `no fake for ${path}` }, { status: 404 });
  };
  return { fetch: fetchImpl, calls };
}

/** Several fakes behind one fetch. */
const both = (...fakes) => async (u, init) => {
  for (const f of fakes) {
    const r = await f.fetch(u, init);
    if (r) return r;
  }
  throw new Error(`no fake for ${u}`);
};

async function run(argv, fetch) {
  let stdout = "";
  let stderr = "";
  const code = await main(argv, {
    env: { XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), "openpurr-cli-")), OPENPURR_TOKEN: TOKEN },
    stdout: { write: (s) => (stdout += s), isTTY: false },
    stderr: { write: (s) => (stderr += s) },
    stdin: { isTTY: false },
    fetch,
    sleep: async () => {},
  });
  return { code, stdout, stderr };
}

const lines = (path) =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

function data() {
  const customer = (id, v, extra = {}) => ({ id, app_user_id: id.replace("c_", "u_"), first_seen: 1, project_id: "default", ledger_version: v, ...extra });
  return {
    customer: [customer("c_1", 1), customer("c_2", 3), customer("c_3", 0), customer("c_4", 2)],
    customer_alias: [
      { project_id: "default", app_user_id: "u_1", customer_id: "c_1", created_at: 10 },
      { project_id: "default", app_user_id: "u_2", customer_id: "c_2", created_at: 10 },
      { project_id: "default", app_user_id: "u_3", customer_id: "c_3", created_at: 10 },
      { project_id: "default", app_user_id: "u_4", customer_id: "c_4", created_at: 10 },
    ],
    store_transaction: [
      { id: 1, store: "app_store", transaction_id: "t1", original_transaction_id: "t1", updated_at: 10, price_micros: 9_990_000 },
      { id: 2, store: "app_store", transaction_id: "t2", original_transaction_id: "t2", updated_at: 10, price_micros: null },
      { id: 3, store: "play_store", transaction_id: "GPA.1", original_transaction_id: "tok", updated_at: 10, price_micros: 1 },
    ],
    operator: [{ id: "op1", email: "owner@example.com", name: "O'Brien", role: "owner", password_hash: "pbkdf2$x", created_at: 1 }],
    job_state: [{ key: "metrics_rollup", value: '{"at":5}', updated_at: 5 }],
    webhook_delivery: [{ event_id: "e1", endpoint: "main", status: "pending", attempts: 1, created_at: 10, claimed_until: 99 }],
    webhook_event: [{ id: "e1", dedupe_key: "d1", type: "TEST", app_id: "ios", environment: "sandbox", body: '{"event":{}}', created_at: 10 }],
  };
}

describe("openpurr export", () => {
  it("writes every table page by page, with a manifest that checks each file", async () => {
    const lite = deployment("https://lite.example.com", data());
    const out = join(mkdtempSync(join(tmpdir(), "bundle-")), "b");
    const r = await run(["export", "--url", "https://lite.example.com", "--out", out, "--page", "2"], lite.fetch);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /OPERATOR_SECRET/);
    assert.ok(lite.calls[0].startsWith("POST /admin/v1/export"));
    const m = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    assert.equal(m.kind, "full");
    assert.equal(m.started_at_ms, 1_800_000_000_000);
    assert.deepEqual(
      m.tables.map((t) => t.name),
      spec.tables.map((t) => t.name),
    );
    const tx = m.tables.find((t) => t.name === "store_transaction");
    assert.equal(tx.rows, 3);
    assert.equal(tx.sha256, createHash("sha256").update(readFileSync(join(out, tx.file))).digest("hex"));
    assert.deepEqual(
      lines(join(out, tx.file)).map((x) => x.id),
      [1, 2, 3],
    );
    // Two rows per request: store_transaction took two pages.
    assert.equal(lite.calls.filter((c) => c.includes("/export/tables/store_transaction")).length, 2);
    assert.equal((statSync(join(out, "manifest.json")).mode & 0o777).toString(8), "600");
    // Never into a directory that has something in it.
    assert.equal((await run(["export", "--url", "https://lite.example.com", "--out", out], lite.fetch)).code, 2);
  });

  it("a delta holds what changed, every row of changed customers, and who is gone", async () => {
    const tables = data();
    const lite = deployment("https://lite.example.com", tables);
    const dir = mkdtempSync(join(tmpdir(), "bundle-"));
    assert.equal((await run(["export", "--url", "https://lite.example.com", "--out", join(dir, "full")], lite.fetch)).code, 0);

    // Afterwards: c_3 merged into c_2 (its alias moves without a new timestamp, c_2's version
    // goes up, c_3 is gone), a new customer c_5, and a renewal on t1.
    tables.customer = tables.customer.filter((c) => c.id !== "c_3");
    tables.customer.find((c) => c.id === "c_2").ledger_version = 4;
    tables.customer.push({ id: "c_5", app_user_id: "u_5", first_seen: 1_800_000_100_000, project_id: "default", ledger_version: 0 });
    tables.customer_alias.find((a) => a.app_user_id === "u_3").customer_id = "c_2";
    tables.customer_alias.push({ project_id: "default", app_user_id: "u_5", customer_id: "c_5", created_at: 1_800_000_100_000 });
    tables.store_transaction[0].updated_at = 1_800_000_100_000;

    const later = deployment("https://lite.example.com", tables, { now: 1_800_000_200_000 });
    const r = await run(["export", "--url", "https://lite.example.com", "--out", join(dir, "delta"), "--since", join(dir, "full")], later.fetch);
    assert.equal(r.code, 0, r.stderr);
    const full = JSON.parse(readFileSync(join(dir, "full", "manifest.json"), "utf8"));
    const m = JSON.parse(readFileSync(join(dir, "delta", "manifest.json"), "utf8"));
    assert.equal(m.kind, "delta");
    assert.equal(m.previous_id, full.id);
    assert.equal(m.since_ms, full.started_at_ms - 60_000);
    assert.ok(!m.tables.some((t) => t.name === "job_state" || t.name === "metric_daily"));
    const file = (name) => lines(join(dir, "delta", m.tables.find((t) => t.name === name).file));
    assert.deepEqual(
      file("customer").map((c) => c.id),
      ["c_2", "c_5"],
    );
    assert.deepEqual(
      file("customer_alias").map((a) => `${a.app_user_id}:${a.customer_id}`),
      ["u_5:c_5", "u_2:c_2", "u_3:c_2"],
    );
    assert.deepEqual(
      file("store_transaction").map((t) => t.id),
      [1],
    );
    assert.deepEqual(lines(join(dir, "delta", m.deleted_customers.file)), [{ id: "c_3" }]);
    assert.equal(m.customer_index.rows, 4);
    // Customers' rows were asked for by ID.
    assert.ok(later.calls.some((c) => c.includes("/export/tables/customer_alias?customers=c_2%2Cc_5")));
  });
});

describe("openpurr migrate verify", () => {
  const tables = data();
  const infos = { c_1: { entitlements: { pro: { expires_date: "2030-01-01T00:00:00Z" } }, subscriptions: { a: 1, b: 2 } } };
  const charts = { revenue: [{ date: "2026-11-01", values: { revenue: 9.99 } }] };

  it("finds no differences between identical deployments", async () => {
    const a = deployment("https://lite.example.com", tables, { infos, charts });
    // Key order inside CustomerInfo may differ between editions.
    const b = deployment("https://std.example.com", tables, { infos: { c_1: { subscriptions: { b: 2, a: 1 }, entitlements: infos.c_1.entitlements } }, charts, now: 1_800_000_000_500 });
    const r = await run(["migrate", "verify", "--from", "https://lite.example.com", "--to", "https://std.example.com"], both(a, b));
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /4 customers and 4 charts compared .*: no differences/);
    // Both asked at the same moment.
    const at = (calls) => calls.find((c) => c.includes("customer-info")).match(/at=(\d+)/)[1];
    assert.equal(at(a.calls), at(b.calls));
  });

  it("reports each difference and exits 1", async () => {
    const a = deployment("https://lite.example.com", tables, { infos, charts });
    const other = { ...tables, customer: [...tables.customer.filter((c) => c.id !== "c_4"), { id: "c_9", app_user_id: "u_9", project_id: "default", ledger_version: 0 }] };
    const b = deployment("https://std.example.com", other, {
      infos: { c_1: { entitlements: { pro: { expires_date: "2029-01-01T00:00:00Z" } }, subscriptions: { a: 1, b: 2 } } },
      charts: { revenue: [{ date: "2026-11-01", values: { revenue: 9.98 } }] },
    });
    const r = await run(["migrate", "verify", "--from", "https://lite.example.com", "--to", "https://std.example.com", "--json"], both(a, b));
    assert.equal(r.code, 1);
    const report = JSON.parse(r.stdout);
    assert.equal(report.ok, false);
    assert.deepEqual(report.customer_differences[0].differences, [
      { path: "customer_info.subscriber.entitlements.pro.expires_date", from: "2030-01-01T00:00:00Z", to: "2029-01-01T00:00:00Z" },
    ]);
    assert.deepEqual(
      report.only_on_from.map((x) => x.id),
      ["c_4"],
    );
    assert.deepEqual(
      report.only_on_to.map((x) => x.id),
      ["c_9"],
    );
    assert.deepEqual(
      report.chart_differences.map((d) => `${d.chart} ${d.environment}`),
      ["revenue production", "revenue sandbox"],
    );
    const text = await run(["migrate", "verify", "--from", "https://lite.example.com", "--to", "https://std.example.com"], both(a, b));
    assert.match(text.stdout, /5 differences\. Don't cut over yet/);
    assert.match(text.stdout, /u_4 \(customer c_4\) is missing on https:\/\/std\.example\.com/);
  });

  it("doesn't count inactive customers the target already cleaned up", async () => {
    const old = { ...tables, customer: [...tables.customer, { id: "c_old", app_user_id: "u_old", project_id: "default", ledger_version: 0 }] };
    const oldInfo = { c_old: { first_seen: "2020-01-01T00:00:00Z", entitlements: {}, subscriptions: {}, non_subscriptions: {} } };
    const a = deployment("https://lite.example.com", old, { infos: { ...infos, ...oldInfo }, charts });
    const b = deployment("https://std.example.com", tables, { infos, charts });
    const r = await run(["migrate", "verify", "--from", "https://lite.example.com", "--to", "https://std.example.com", "--json"], both(a, b));
    assert.equal(r.code, 0, r.stdout);
    assert.equal(JSON.parse(r.stdout).cleaned_up_on_to, 1);
  });
});

describe("openpurr migrate sql", () => {
  it("loads a full bundle into a new Lite database", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const lite = deployment("https://std.example.com", {
      ...data(),
      store_transaction: [
        {
          id: 7, app_id: "ios", store: "app_store", environment: "sandbox", transaction_id: "t1", original_transaction_id: "t1", product_id: "pro_monthly",
          base_plan_id: null, product_type: "subscription", purchased_at: 1, original_purchased_at: 1, expires_at: 2, period_type: "normal",
          ownership_type: "PURCHASED", price_micros: 9_990_000, currency: "USD", storefront: "USA", revoked_at: null, revocation_reason: null,
          is_upgraded: 0, verified: 1, source: "sdk", received_at: 1, updated_at: 1, subscription_group: null,
        },
      ],
      customer: [{ id: "c_1", app_user_id: "u_1", first_seen: 1, project_id: "default", ledger_version: 0 }],
      customer_alias: [{ project_id: "default", app_user_id: "it's me", customer_id: "c_1", created_at: 1 }],
      webhook_event: [{ id: "e1", dedupe_key: "d1", type: "TEST", app_id: "ios", customer_id: null, environment: "sandbox", body: '{"a":"b"}', created_at: 1 }],
      webhook_delivery: [{ event_id: "e1", endpoint: "main", status: "pending", attempts: 1, next_attempt_at: 5, last_status: null, last_error: null, delivered_at: null, created_at: 1, claimed_until: 99 }],
      operator: [{ id: "op1", email: "o@example.com", name: "O'Brien", role: "owner", app_ids: null, password_hash: null, totp_secret: null, totp_enabled: 0, totp_last_step: null, failed_logins: 0, locked_until: null, disabled_at: null, created_at: 1, last_login_at: null, locale: null }],
      job_state: [{ key: "metrics_rollup", value: '{"at":5,"first":null}', updated_at: 5 }],
    });
    const dir = join(mkdtempSync(join(tmpdir(), "bundle-")), "b");
    assert.equal((await run(["export", "--url", "https://std.example.com", "--out", dir], lite.fetch)).code, 0);
    const sql = await run(["migrate", "sql", "--bundle", dir]);
    assert.equal(sql.code, 0, sql.stderr);

    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    const migrations = new URL("../../lite/migrations/", import.meta.url);
    for (const f of readdirSync(migrations).sort()) db.exec(readFileSync(new URL(f, migrations), "utf8"));
    db.exec(sql.stdout);
    assert.deepEqual({ ...db.prepare("SELECT app_user_id FROM customer_alias").get() }, { app_user_id: "it's me" });
    assert.deepEqual({ ...db.prepare("SELECT id, price_micros FROM store_transaction").get() }, { id: 7, price_micros: 9_990_000 });
    assert.equal(db.prepare("SELECT name FROM operator").get().name, "O'Brien");
    assert.equal(JSON.parse(db.prepare("SELECT value FROM job_state WHERE key = 'metrics_rollup'").get().value).rebuild, true);
    // The next transaction continues after the imported IDs.
    assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'store_transaction'").get().seq, 7);

    const deltaDir = join(dir, "..", "d");
    await run(["export", "--url", "https://std.example.com", "--out", deltaDir, "--since", dir], lite.fetch);
    assert.equal((await run(["migrate", "sql", "--bundle", deltaDir])).code, 2);
  });
});
