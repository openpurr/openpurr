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
  env?: "production" | "sandbox";
  product?: string;
}) {
  const purchased = at(t.bought);
  await env.DB.prepare(
    `INSERT INTO store_transaction (app_id, store, environment, transaction_id, original_transaction_id, product_id, product_type, purchased_at, original_purchased_at,
       expires_at, period_type, price_micros, currency, revoked_at, verified, source, received_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'sdk', ?, ?)`,
  )
    .bind(
      t.app ?? "ios",
      t.store ?? "app_store",
      t.env ?? "production",
      `tx-${++txSeq}`,
      t.chain,
      t.product ?? "p",
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

describe("phase 2: movements, churn, refund rate (the same hand-checked ledger)", () => {
  const month = q({ interval: "month", to: "2026-03-31" });
  const byMonth = async (chart: string, over: Partial<ChartQuery> = {}) =>
    Object.fromEntries((await readChart(env.DB, chart, { ...month, ...over }))!.points.map((p) => [p.date.slice(0, 7), p.values]));

  it("subscription movement: new (including A's trial converting), renewals, churn", async () => {
    const m = await byMonth("subscription_movement");
    expect(m["2026-01"]).toMatchObject({ new: 3, reactivated: 0, churned: -0, net: 3, renewed: 0 }); // A converts, B and C start
    expect(m["2026-02"]).toMatchObject({ new: 0, churned: -2, net: -2, renewed: 1 }); // B refunded, C's grace ends; A renews
  });

  it("MRR movement: new MRR on conversion and purchase, churned MRR on refund and expiry", async () => {
    const m = await byMonth("mrr_movement");
    expect(m["2026-01"]).toMatchObject({ new: 28.33, churned: 0, net: 28.33 });
    expect(m["2026-02"]).toMatchObject({ new: 0, expansion: 0, churned: -18.33, net: -18.33 }); // A renews at the same price: no movement
  });

  it("trial movement and churn and refund rates", async () => {
    expect((await byMonth("trial_movement"))["2026-01"]).toMatchObject({ new: 1, converted: -1, expired: -0, conversion_rate: 100 });
    const churn = await byMonth("churn");
    expect(churn["2026-02"]).toMatchObject({ rate: 66.7, churned: 2, paying_at_start: 3 });
    expect(churn["2026-01"]).toMatchObject({ rate: null, paying_at_start: 0 }); // nobody paying when January began
    const refunds = await byMonth("refund_rate");
    expect(refunds["2026-02"]).toMatchObject({ rate: 100, refunds: 1, transactions: 1 }); // B refunded; A's renewal the only purchase
    expect(refunds["2026-01"]).toMatchObject({ rate: 0, transactions: 5 }); // A, B, C, D and E (SAR)
  });
});

describe("phase 2: reactivation, expansion, contraction, trials, status (a sandbox ledger)", () => {
  const sandbox = (over: Partial<ChartQuery> = {}) => q({ environment: "sandbox", interval: "month", from: "2026-01-01", to: "2026-03-31", ...over });
  const months = async (chart: string, over: Partial<ChartQuery> = {}) =>
    Object.fromEntries((await readChart(env.DB, chart, sandbox(over)))!.points.map((p) => [p.date.slice(0, 7), p.values]));

  beforeAll(async () => {
    const sb = { env: "sandbox" as const };
    // G: monthly, lapses for February, comes back in March (same chain): churn, then reactivation.
    await tx({ ...sb, chain: "G", bought: "2026-01-01", expires: "2026-02-01", price: 10 });
    await tx({ ...sb, chain: "G", bought: "2026-03-01", expires: "2026-04-01", price: 10 });
    // H: monthly at $10, renews at $12 (expansion +2), then switches to yearly at $60 (= $5/month: contraction -7).
    await tx({ ...sb, chain: "H", bought: "2026-01-01", expires: "2026-02-01", price: 10, product: "monthly" });
    await tx({ ...sb, chain: "H", bought: "2026-02-01", expires: "2026-03-01", price: 12, product: "monthly" });
    await tx({ ...sb, chain: "H", bought: "2026-03-01", expires: "2027-03-01", price: 60, product: "yearly" });
    // I: a trial, auto-renew turned off on day 2, then it expires.
    await tx({ ...sb, chain: "I", bought: "2026-01-10", expires: "2026-01-17", price: 0, period: "trial" });
    // For the status breakdown on Mar 15: J ended Mar 10, K won't renew, L is in a grace period.
    await tx({ ...sb, chain: "J", bought: "2026-02-10", expires: "2026-03-10", price: 10 });
    await tx({ ...sb, chain: "K", bought: "2026-03-05", expires: "2026-04-05", price: 10 });
    await tx({ ...sb, chain: "L", bought: "2026-02-12", expires: "2026-03-12", price: 10 });
    await env.DB.batch([
      env.DB.prepare("INSERT INTO subscription_state (store, original_transaction_id, status, auto_renew, unsubscribe_detected_at, signed_at, updated_at) VALUES ('app_store', 'I', 2, 0, ?, 0, 0)").bind(at("2026-01-12")),
      env.DB.prepare("INSERT INTO subscription_state (store, original_transaction_id, status, auto_renew, signed_at, updated_at) VALUES ('app_store', 'K', 1, 0, 0, 0)"),
      env.DB.prepare("INSERT INTO subscription_state (store, original_transaction_id, status, auto_renew, grace_period_expires_at, signed_at, updated_at) VALUES ('app_store', 'L', 4, 1, ?, 0, 0)").bind(at("2026-03-20")),
    ]);
    await rollupMetrics(env.DB, at("2026-04-20"), { full: true });
  });

  it("classifies reactivations, expansions and contractions", async () => {
    const mrr = await months("mrr_movement");
    expect(mrr["2026-02"]).toMatchObject({ expansion: 2, churned: -10 }); // H's price rise; G lapses
    expect(mrr["2026-03"]).toMatchObject({ reactivation: 10, contraction: -7 }); // G is back; H goes yearly
    const subs = await months("subscription_movement");
    expect(subs["2026-03"]).toMatchObject({ reactivated: 1 });
    const trials = await months("trial_movement");
    expect(trials["2026-01"]).toMatchObject({ new: 1, converted: -0, expired: -1, cancelled: 1, conversion_rate: 0 });
  });

  it("movements add up to the change in the running totals, every month", async () => {
    const [mrr, mrrMove, subs, subsMove, trials, trialMove] = await Promise.all(
      ["mrr", "mrr_movement", "active_subscriptions", "subscription_movement", "active_trials", "trial_movement"].map((c) => readChart(env.DB, c, sandbox())),
    );
    let before = { mrr: 0, paid: 0, trials: 0 };
    mrr!.points.forEach((p, i) => {
      const now = { mrr: p.values.mrr!, paid: subs!.points[i]!.values.paid!, trials: trials!.points[i]!.values.trials! };
      expect(mrrMove!.points[i]!.values.net).toBeCloseTo(now.mrr - before.mrr, 2);
      expect(subsMove!.points[i]!.values.net).toBe(now.paid - before.paid);
      const t = trialMove!.points[i]!.values;
      expect(t.new! + t.converted! + t.expired!).toBe(now.trials - before.trials);
      before = now;
    });
  });

  it("filters by product", async () => {
    expect((await months("mrr", { product: "yearly" }))["2026-03"]).toMatchObject({ mrr: 5 });
    expect((await months("mrr", { product: "monthly" }))["2026-03"]).toMatchObject({ mrr: 0 });
  });

  it("subscription status: where each subscription stands now", async () => {
    const r = await readChart(env.DB, "subscription_status", sandbox(), at("2026-03-15"));
    const status = Object.fromEntries(r!.categories!.map((c) => [c.key, c.value]));
    // G and H active and renewing; K won't renew; L in its grace period; J expired 5 days ago.
    // I's trial ended in January, more than 30 days ago, so it isn't listed.
    expect(status).toEqual({ active: 2, cancelled: 1, trial: 0, grace: 1, billing_retry: 0, paused: 0, expired: 1 });
  });
});
