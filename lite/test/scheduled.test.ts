import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { RETENTION, runScheduled } from "../src/scheduled";

const DAY = 864e5;
const now = Date.parse("2026-12-01T00:00:00Z");
const daysAgo = (d: number) => now - d * DAY;

async function insertNotification(id: string, receivedAt: number) {
  await env.DB.prepare(
    `INSERT INTO store_notification (store, notification_id, notification_type, environment, signed_at, received_at, payload)
     VALUES ('app_store', ?, 'DID_RENEW', 'sandbox', ?, ?, 'eyJ...')`,
  )
    .bind(id, receivedAt, receivedAt)
    .run();
}

async function insertCustomer(id: string, firstSeen: number, opts: { purchase?: boolean; aliasAt?: number } = {}) {
  const stmts = [
    env.DB.prepare("INSERT INTO customer (id, app_user_id, first_seen) VALUES (?, ?, ?)").bind(id, `user-${id}`, firstSeen),
    env.DB.prepare("INSERT INTO customer_alias (project_id, app_user_id, customer_id, created_at) VALUES ('default', ?, ?, ?)").bind(
      `user-${id}`,
      id,
      opts.aliasAt ?? firstSeen,
    ),
  ];
  if (opts.purchase) {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO purchase_owner (store, original_transaction_id, customer_id, app_id, updated_at) VALUES ('app_store', ?, ?, 'ios', ?)",
      ).bind(`otx-${id}`, id, firstSeen),
    );
  }
  await env.DB.batch(stmts);
}

const exists = async (sql: string, ...params: unknown[]) => (await env.DB.prepare(sql).bind(...params).first()) !== null;

describe("scheduled job", () => {
  it("drops raw notification payloads after 30 days but keeps the summary row", async () => {
    await insertNotification("old", daysAgo(RETENTION.notificationPayloadDays + 1));
    await insertNotification("recent", daysAgo(1));
    await runScheduled(env, now, { all: true });
    const rows = await env.DB.prepare("SELECT notification_id, payload FROM store_notification ORDER BY notification_id").all();
    expect(rows.results).toEqual([
      { notification_id: "old", payload: null },
      { notification_id: "recent", payload: "eyJ..." },
    ]);
  });

  it("deletes inactive customers who never purchased, and nobody else", async () => {
    await insertCustomer("inactive", daysAgo(120));
    await insertCustomer("buyer", daysAgo(120), { purchase: true });
    await insertCustomer("new", daysAgo(10));
    await insertCustomer("logged-in-lately", daysAgo(120), { aliasAt: daysAgo(5) });

    const results = await runScheduled(env, now, { all: true });
    expect(results.find((r) => r.task === "prune-inactive-customers")?.rows).toBe(1);
    expect(await exists("SELECT 1 FROM customer WHERE id = 'inactive'")).toBe(false);
    expect(await exists("SELECT 1 FROM customer_alias WHERE customer_id = 'inactive'")).toBe(false);
    for (const id of ["buyer", "new", "logged-in-lately"]) {
      expect(await exists("SELECT 1 FROM customer WHERE id = ?", id), id).toBe(true);
    }
  });

  it("deletes old spike captures and expired Apple chains", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO capture (ts, method, path, headers) VALUES (?, 'GET', '/old', '{}')").bind(new Date(daysAgo(30)).toISOString()),
      env.DB.prepare("INSERT INTO capture (ts, method, path, headers) VALUES (?, 'GET', '/new', '{}')").bind(new Date(daysAgo(1)).toISOString()),
      env.DB.prepare(
        "INSERT INTO apple_verified_chain (fingerprint, leaf_spki, not_before, not_after, verified_at) VALUES ('expired', 'x', 0, ?, 0), ('valid', 'x', 0, ?, 0)",
      ).bind(daysAgo(1), now + DAY),
    ]);
    await runScheduled(env, now, { all: true });
    const paths = await env.DB.prepare("SELECT path FROM capture").all();
    expect(paths.results).toEqual([{ path: "/new" }]);
    const chains = await env.DB.prepare("SELECT fingerprint FROM apple_verified_chain").all();
    expect(chains.results).toEqual([{ fingerprint: "valid" }]);
  });

  it("runs the hourly tasks only in the first slot of each hour", async () => {
    // Five storage tasks (including OAuth cleanup), then the chart rollup (the exchange-rate and Google tasks need deps).
    expect(await runScheduled(env, Date.parse("2026-12-01T10:00:00Z"))).toHaveLength(6);
    expect(await runScheduled(env, Date.parse("2026-12-01T10:35:00Z"))).toHaveLength(0);
  });

  it("is wired up as the back-office Worker's scheduled handler", async () => {
    const { default: worker } = await import("../src/office/index");
    expect(typeof worker.scheduled).toBe("function");
  });
});
