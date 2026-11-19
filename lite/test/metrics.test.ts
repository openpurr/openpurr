// Charts reconcile with a hand-checked ledger, and the hourly incremental rollup agrees with a
// full rebuild.
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { CHARTS, periodStart, readChart, rollupMetrics, type ChartQuery } from "../src/metrics";

const DAY = 864e5;
const at = (date: string, hour = 12) => Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);

let txSeq = 0;
async function tx(t: {
  chain: string;
  bought: string;
  expires?: string;
  price: number | null;
  currency?: string;
  period?: "normal" | "trial" | "intro";
  type?: "subscription" | "non_consumable" | "consumable";
  revoked?: string;
  updatedAt?: number;
  store?: "app_store" | "play_store";
  app?: string;
}) {
  const purchased = at(t.bought);
  await env.DB.prepare(
    `INSERT INTO store_transaction (app_id, store, environment, transaction_id, original_transaction_id, product_id, product_type, purchased_at, original_purchased_at,
       expires_at, period_type, price_micros, currency, revoked_at, verified, source, received_at, updated_at)
     VALUES (?, ?, 'production', ?, ?, 'p', ?, ?, ?, ?, ?, ?, ?, ?, 1, 'sdk', ?, ?)`,
  )
    .bind(
      t.app ?? "ios",
      t.store ?? "app_store",
      `tx-${++txSeq}`,
      t.chain,
      t.type ?? "subscription",
      purchased,
      purchased,
      t.expires ? at(t.expires) : null,
      t.period ?? "normal",
      t.price === null ? null : Math.round(t.price * 1e6),
      t.currency ?? "USD",
      t.revoked ? at(t.revoked) : null,
      t.updatedAt ?? at("2026-03-01"),
      t.updatedAt ?? at("2026-03-01"),
    )
    .run();
}

const NOW = at("2026-03-15");
const q = (over: Partial<ChartQuery> = {}): ChartQuery => ({ from: "2026-01-01", to: "2026-03-15", interval: "day", environment: "production", apps: null, ...over });
const value = async (chart: string, date: string, key: string, over: Partial<ChartQuery> = {}) => {
  const r = await readChart(env.DB, chart, q(over));
  return r!.points.find((p) => p.date === date)?.values[key];
};

beforeAll(async () => {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO fx_rate (date, currency, per_usd, source) VALUES ('2025-12-31', 'EUR', 0.9, 'test')"),
    env.DB.prepare("INSERT INTO customer (id, app_user_id, first_seen) VALUES ('m1', 'm1', ?), ('m2', 'm2', ?), ('m3', 'm3', ?)").bind(at("2026-01-01"), at("2026-01-05"), at("2026-01-10")),
  ]);
  // A: a 7-day trial, then monthly at $10, renewed twice; still active.
  await tx({ chain: "A", bought: "2026-01-01", expires: "2026-01-08", price: 0, period: "trial" });
  await tx({ chain: "A", bought: "2026-01-08", expires: "2026-02-08", price: 10 });
  await tx({ chain: "A", bought: "2026-02-08", expires: "2026-03-08", price: 10 });
  await tx({ chain: "A", bought: "2026-03-08", expires: "2026-04-08", price: 10 });
  // B: yearly at €90 (= $100 at 0.9 EUR per USD), refunded on Feb 1.
  await tx({ chain: "B", bought: "2026-01-10", expires: "2027-01-10", price: 90, currency: "EUR", revoked: "2026-02-01" });
  // C: monthly at $10, not renewed; the billing grace period runs to Feb 12.
  await tx({ chain: "C", bought: "2026-01-05", expires: "2026-02-05", price: 10 });
  await env.DB.prepare("INSERT INTO subscription_state (store, original_transaction_id, status, auto_renew, grace_period_expires_at, signed_at, updated_at) VALUES ('app_store', 'C', 2, 0, ?, ?, ?)")
    .bind(at("2026-02-12"), at("2026-02-12"), at("2026-03-01"))
    .run();
  // D: a lifetime unlock at $20.
  await tx({ chain: "D", bought: "2026-01-20", price: 20, type: "non_consumable" });
  // E: a purchase in a currency with no exchange rate.
  await tx({ chain: "E", bought: "2026-01-25", price: 5, currency: "SAR", type: "consumable" });

  await rollupMetrics(env.DB, NOW);
});

describe("charts reconcile with a hand-checked ledger", () => {
  it("active subscriptions, trials and paid subscriptions at the end of each day", async () => {
    expect(await value("active_subscriptions", "2026-01-03", "trials")).toBe(1); // A's trial
    expect(await value("active_subscriptions", "2026-01-07", "paid")).toBe(1); // C
    expect(await value("active_subscriptions", "2026-01-31", "paid")).toBe(3); // A, B, C
    expect(await value("active_subscriptions", "2026-01-31", "trials")).toBe(0);
    expect(await value("active_subscriptions", "2026-02-01", "paid")).toBe(2); // B refunded
    expect(await value("active_subscriptions", "2026-02-11", "paid")).toBe(2); // C in its grace period
    expect(await value("active_subscriptions", "2026-02-12", "paid")).toBe(1); // C's grace period over
    expect(await value("active_subscriptions", "2026-03-15", "paid")).toBe(1); // A, renewals don't double-count
    expect(await value("paid_subscriptions", "2026-01-31", "paid")).toBe(3);
    expect(await value("active_trials", "2026-01-08", "trials")).toBe(0);
  });

  it("MRR normalizes yearly prices to a month, in USD", async () => {
    expect(await value("mrr", "2026-01-31", "mrr")).toBe(28.33); // 10 + 100/12 + 10
    expect(await value("mrr", "2026-02-01", "mrr")).toBe(20);
    expect(await value("mrr", "2026-03-15", "mrr")).toBe(10);
    expect(await value("arr", "2026-03-15", "arr")).toBe(120);
  });

  it("revenue by month: purchases by purchase date, refunds by refund date", async () => {
    const r = await readChart(env.DB, "revenue", q({ interval: "month" }));
    const byMonth = Object.fromEntries(r!.points.map((p) => [p.date, p.values]));
    expect(byMonth["2026-01-01"]).toMatchObject({ gross: 140, refunds: 0, net: 140 }); // A 10 + B 100 + C 10 + D 20
    expect(byMonth["2026-02-01"]).toMatchObject({ gross: 10, refunds: 100, net: -90 });
    expect(byMonth["2026-03-01"]).toMatchObject({ gross: 10, net: 10 });
    expect(r!.notes.join(" ")).toMatch(/1 purchase is in currencies without an exchange rate/);
  });

  it("new trials, refunds, one-time purchases and new customers", async () => {
    const month = q({ interval: "month" });
    expect((await readChart(env.DB, "new_trials", month))!.points[0]!.values.trials).toBe(1);
    expect((await readChart(env.DB, "refunds", month))!.points[1]!.values).toMatchObject({ refunds: 1, amount: 100 });
    expect((await readChart(env.DB, "non_subscription_purchases", month))!.points[0]!.values).toMatchObject({ purchases: 2, revenue: 20 });
    expect((await readChart(env.DB, "new_customers", month))!.points[0]!.values.customers).toBe(3);
  });

  it("weeks start on Monday; a running total takes the period's last day", async () => {
    expect(periodStart("2026-01-04", "week")).toBe("2025-12-29"); // a Sunday
    expect(periodStart("2026-01-05", "week")).toBe("2026-01-05");
    const weekly = await readChart(env.DB, "active_subscriptions", q({ interval: "week" }));
    expect(weekly!.points.find((p) => p.date === "2026-01-26")!.values.paid).toBe(2); // Sunday Feb 1: A and C
  });

  it("filters by store and app, and limits app-restricted operators", async () => {
    expect(await value("active_subscriptions", "2026-01-31", "paid", { store: "play_store" })).toBe(0);
    expect(await value("active_subscriptions", "2026-01-31", "paid", { apps: ["android"] })).toBe(0);
    const limited = await readChart(env.DB, "new_customers", q({ apps: ["ios"] }));
    expect(limited!.points).toEqual([]);
  });
});

describe("the incremental rollup", () => {
  it("picks up new purchases and late refunds, matches a full rebuild, and writes little", async () => {
    const later = NOW + 2 * 3600_000;
    // A new subscription today, and A's February renewal refunded today.
    await tx({ chain: "F", bought: "2026-03-15", expires: "2026-04-15", price: 10, updatedAt: later - 1000 });
    await env.DB.prepare("UPDATE store_transaction SET revoked_at = ?, updated_at = ? WHERE original_transaction_id = 'A' AND purchased_at = ?")
      .bind(later - 2000, later - 2000, at("2026-02-08"))
      .run();

    const run = await rollupMetrics(env.DB, later);
    expect(run.full).toBe(false);
    expect(run.from).toBe("2026-02-08"); // the refunded purchase's date
    expect(run.rows).toBeLessThan(150);

    const charts = Object.keys(CHARTS);
    const snapshot = async () => Promise.all(charts.map((c) => readChart(env.DB, c, q()).then((r) => r!.points)));
    const incremental = await snapshot();
    expect(await value("active_subscriptions", "2026-03-15", "paid")).toBe(2); // A and F
    expect(await value("refunds", "2026-03-15", "refunds")).toBe(1);

    await rollupMetrics(env.DB, later, { full: true });
    expect(await snapshot()).toEqual(incremental);
  });

  it("counts subscriptions that ran out since the last run, with no ledger change", async () => {
    // F expires on Apr 15; a run that day removes it without anything in the ledger changing.
    // (The first run here still re-reads the refund above: each run re-reads the last minute
    // before the previous run, in case something was written while that run was reading.)
    await rollupMetrics(env.DB, at("2026-04-01"));
    const before = await rollupMetrics(env.DB, at("2026-04-14", 23));
    const after = await rollupMetrics(env.DB, at("2026-04-16", 1));
    expect(before.from).toBe("2026-04-01");
    expect(after.from).toBe("2026-04-14");
    const r = await readChart(env.DB, "active_subscriptions", q({ from: "2026-04-14", to: "2026-04-16" }));
    expect(r!.points.map((p) => p.values.paid)).toEqual([1, 0, 0]); // F until Apr 15; A ran out on Apr 8
  });
});

describe("the hourly window", () => {
  it("never stores days after today", async () => {
    const { n } = (await env.DB.prepare("SELECT count(*) AS n FROM metric_daily WHERE date > '2026-04-16'").first<{ n: number }>())!;
    expect(n).toBe(0);
    expect(DAY).toBe(864e5);
  });
});
