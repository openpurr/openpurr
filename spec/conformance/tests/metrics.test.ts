// Charts (GET /admin/v1/metrics/:chart) reconcile with a hand-checked ledger, and the incremental
// rollup agrees with a full rebuild (POST /admin/v1/metrics/refresh). Ported from
// lite/test/metrics.test.ts.
//
// Lite's test inserts ledger rows and subscription states straight into D1 and calls
// rollupMetrics() with a fixed now. Here the same ledger comes in over HTTP: each chain's first
// purchase through the SDK (which creates the customers the new-customers chart counts), the rest
// as App Store notifications, grace periods and auto-renew changes as renewal info, the EUR rate
// from the fake ECB, and the server clock pinned to each date. Rollups run through jobs() and the
// refresh endpoint.
//
// Dropped: periodStart() itself (a pure function; the weekly chart's periods are checked instead)
// and "never stores days after today", which reads metric_daily (replaced by the chart route
// ending at today). The rollup's run details (full, from, rows) are Lite's and checked only there.
// JSON has no -0, so Lite's "churned: -0" and the like are 0 here.

import { beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  type AppleTransaction,
  call,
  createOperator,
  fake,
  jobs,
  nextTransactionId,
  onEdition,
  postNotification,
  reset,
  setClock,
  signNotification,
  signTransaction,
  testConfig,
} from "../src";

const at = (date: string, hour = 12) => Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);
const NOW = at("2026-03-15");

/** The test config, with the products the ledger uses. */
function metricsConfig() {
  const raw = testConfig();
  Object.assign(raw.apps.ios.products, { p: { type: "subscription" }, monthly: { type: "subscription" }, yearly: { type: "subscription" } });
  return raw;
}

const APPLE_TYPE = { subscription: "Auto-Renewable Subscription", non_consumable: "Non-Consumable", consumable: "Consumable" } as const;
const DEFAULT_PRODUCT = { subscription: "p", non_consumable: "lifetime", consumable: "coins_100" } as const;

// Chain letters to original transaction IDs, and each chain's first purchase date.
const chains = new Map<string, { id: string; first: number }>();

interface Tx {
  chain: string;
  bought: string;
  expires?: string;
  price: number;
  currency?: string;
  period?: "normal" | "trial";
  type?: "subscription" | "non_consumable" | "consumable";
  env?: "production" | "sandbox";
  product?: string;
}

/** The App Store transaction for a ledger row. */
function transaction(t: Tx): Partial<AppleTransaction> {
  const type = t.type ?? "subscription";
  let chain = chains.get(t.chain);
  if (!chain) chains.set(t.chain, (chain = { id: nextTransactionId(), first: at(t.bought) }));
  const first = chain.first === at(t.bought);
  return {
    transactionId: first ? chain.id : nextTransactionId(),
    originalTransactionId: chain.id,
    productId: t.product ?? DEFAULT_PRODUCT[type],
    type: APPLE_TYPE[type],
    purchaseDate: at(t.bought),
    originalPurchaseDate: chain.first,
    expiresDate: t.expires ? at(t.expires) : undefined,
    price: Math.round(t.price * 1000),
    currency: t.currency ?? "USD",
    environment: t.env === "sandbox" ? "Sandbox" : "Production",
    ...(t.period === "trial" ? { offerType: 1, offerDiscountType: "FREE_TRIAL" as const } : {}),
  };
}

/** A purchase posted by the app for `appUserId` (creating the customer). Returns the transaction. */
async function bought(appUserId: string, t: Tx) {
  const { jws, payload } = await signTransaction(transaction(t));
  const res = await call("/v1/receipts", { body: { app_user_id: appUserId, fetch_token: jws, product_id: payload.productId, transaction_id: payload.transactionId } });
  expect(res.status).toBe(200);
  return payload;
}

/** A transaction the App Store reports in a notification, optionally with renewal info. Returns the transaction. */
async function notified(t: Tx, opts: { renewal?: Record<string, unknown>; status?: number; signedDate?: number } = {}) {
  const { payload } = await signTransaction(transaction(t));
  return notify(payload, { type: "DID_RENEW", ...opts });
}

async function notify(transaction: AppleTransaction, opts: { type: string; renewal?: Record<string, unknown>; status?: number; signedDate?: number }) {
  const { signedPayload } = await signNotification({ type: opts.type, transaction, renewal: opts.renewal, status: opts.status, signedDate: opts.signedDate });
  const res = await postNotification(signedPayload);
  expect(res.status).toBe(200);
  return transaction;
}

type Query = Record<string, string>;

async function chart(name: string, over: Query = {}, auth: { session?: string } = {}) {
  const params = new URLSearchParams({ from: "2026-01-01", to: "2026-03-15", interval: "day", environment: "production", ...over });
  const res = await admin("GET", `/metrics/${name}?${params}`, auth);
  expect(res.status, res.text).toBe(200);
  return res.body as { to: string; points: { date: string; values: Record<string, number | null> }[]; categories?: { key: string; value: number }[]; notes: string[] };
}

const value = async (name: string, date: string, key: string, over: Query = {}) => (await chart(name, over)).points.find((p) => p.date === date)?.values[key];

async function refresh(full = false) {
  const res = await admin("POST", "/metrics/refresh", {}, { body: full ? { full: true } : {} });
  expect(res.status).toBe(200);
  expect(res.body.refreshed).toBe(true);
  return res.body as { from: string | null; rows: number; full: boolean; deferred?: boolean };
}

let refundedRenewal: AppleTransaction;

beforeAll(async () => {
  await reset(metricsConfig());
  // Customers first seen Jan 1, 5 and 10, each with a subscription bought that day.
  // A: a 7-day trial, then monthly at $10, renewed twice; still active.
  await setClock(at("2026-01-01"));
  await bought("m1", { chain: "A", bought: "2026-01-01", expires: "2026-01-08", price: 0, period: "trial" });
  // C: monthly at $10, not renewed; the billing grace period runs to Feb 12.
  await setClock(at("2026-01-05"));
  const c = await bought("m2", { chain: "C", bought: "2026-01-05", expires: "2026-02-05", price: 10 });
  // B: yearly at €90 (= $100 at 0.9 EUR per USD), refunded on Feb 1.
  await setClock(at("2026-01-10"));
  const b = await bought("m3", { chain: "B", bought: "2026-01-10", expires: "2027-01-10", price: 90, currency: "EUR" });

  // The rest arrives an hour before the first rollup (so the next run doesn't re-read it).
  await setClock(NOW - 3600_000);
  await notified({ chain: "A", bought: "2026-01-08", expires: "2026-02-08", price: 10 });
  refundedRenewal = await notified({ chain: "A", bought: "2026-02-08", expires: "2026-03-08", price: 10 });
  await notified({ chain: "A", bought: "2026-03-08", expires: "2026-04-08", price: 10 });
  await notify({ ...b, revocationDate: at("2026-02-01"), revocationReason: 0 }, { type: "REFUND" });
  await notify(c, {
    type: "DID_FAIL_TO_RENEW",
    status: 4,
    signedDate: at("2026-02-06"),
    renewal: { autoRenewStatus: 0, gracePeriodExpiresDate: at("2026-02-12"), signedDate: at("2026-02-06") },
  });
  // D: a lifetime unlock at $20. E: a purchase in a currency with no exchange rate.
  await notified({ chain: "D", bought: "2026-01-20", price: 20, type: "non_consumable" });
  await notified({ chain: "E", bought: "2026-01-25", price: 5, currency: "SAR", type: "consumable" });

  fake.ecb([{ date: "2025-12-31", perEur: { USD: 1 / 0.9 } }]);
  await setClock(NOW);
  await jobs();
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
    const r = await chart("revenue", { interval: "month" });
    const byMonth = Object.fromEntries(r.points.map((p) => [p.date, p.values]));
    expect(byMonth["2026-01-01"]).toMatchObject({ gross: 140, refunds: 0, net: 140 }); // A 10 + B 100 + C 10 + D 20
    expect(byMonth["2026-02-01"]).toMatchObject({ gross: 10, refunds: 100, net: -90 });
    expect(byMonth["2026-03-01"]).toMatchObject({ gross: 10, net: 10 });
    expect(r.notes.join(" ")).toMatch(/1 purchase is in currencies without an exchange rate/);
  });

  it("new trials, refunds, one-time purchases and new customers", async () => {
    const month = { interval: "month" };
    expect((await chart("new_trials", month)).points[0]!.values.trials).toBe(1);
    expect((await chart("refunds", month)).points[1]!.values).toMatchObject({ refunds: 1, amount: 100 });
    expect((await chart("non_subscription_purchases", month)).points[0]!.values).toMatchObject({ purchases: 2, revenue: 20 });
    expect((await chart("new_customers", month)).points[0]!.values.customers).toBe(3);
  });

  it("weeks start on Monday; a running total takes the period's last day", async () => {
    const weekly = await chart("active_subscriptions", { interval: "week" });
    expect(weekly.points[0]!.date).toBe("2025-12-29"); // Jan 1 is a Thursday
    expect(weekly.points[1]!.date).toBe("2026-01-05");
    expect(weekly.points.find((p) => p.date === "2026-01-26")!.values.paid).toBe(2); // Sunday Feb 1: A and C
  });

  it("filters by store and app, and limits app-restricted operators", async () => {
    expect(await value("active_subscriptions", "2026-01-31", "paid", { store: "play_store" })).toBe(0);
    expect(await value("active_subscriptions", "2026-01-31", "paid", { app: "android" })).toBe(0);
    const android = await createOperator("viewer", { apps: ["android"] });
    expect((await chart("active_subscriptions", {}, android)).points.find((p) => p.date === "2026-01-31")!.values.paid).toBe(0);
    const ios = await createOperator("viewer", { apps: ["ios"] });
    expect((await chart("new_customers", {}, ios)).points).toEqual([]);
  });
});

describe("the incremental rollup", () => {
  it("picks up new purchases and late refunds, matches a full rebuild, and writes little", async () => {
    const later = NOW + 2 * 3600_000;
    // A new subscription today, and A's February renewal refunded today.
    await setClock(later - 5000);
    await notified({ chain: "F", bought: "2026-03-15", expires: "2026-04-15", price: 10 });
    await notify({ ...refundedRenewal, revocationDate: later - 2000, revocationReason: 0 }, { type: "REFUND" });

    await setClock(later);
    const run = await refresh();
    if (onEdition("lite")) {
      expect(run.full).toBe(false);
      expect(run.from).toBe("2026-02-08"); // the refunded purchase's date
      expect(run.rows).toBeLessThan(150);
    }

    const charts = ((await admin("GET", "/metrics")).body.charts as { id: string }[]).map((c) => c.id);
    expect(charts.length).toBeGreaterThan(10);
    const snapshot = async () => Promise.all(charts.map(async (c) => (await chart(c)).points));
    const incremental = await snapshot();
    expect(await value("active_subscriptions", "2026-03-15", "paid")).toBe(2); // A and F
    expect(await value("refunds", "2026-03-15", "refunds")).toBe(1);

    await refresh(true);
    expect(await snapshot()).toEqual(incremental);
  });

  it("counts subscriptions that ran out since the last run, with no ledger change", async () => {
    // F expires on Apr 15; a run that day removes it without anything in the ledger changing.
    // (The first run here still re-reads the refund above: each run re-reads the last minute
    // before the previous run, in case something was written while that run was reading.)
    await setClock(at("2026-04-01"));
    await refresh();
    await setClock(at("2026-04-14", 23));
    const before = await refresh();
    await setClock(at("2026-04-16", 1));
    const after = await refresh();
    if (onEdition("lite")) {
      expect(before.from).toBe("2026-04-01");
      expect(after.from).toBe("2026-04-14");
    }
    const r = await chart("active_subscriptions", { from: "2026-04-14", to: "2026-04-16" });
    expect(r.points.map((p) => p.values.paid)).toEqual([1, 0, 0]); // F until Apr 15; A ran out on Apr 8
  });
});

describe("the hourly window", () => {
  it("never shows days after today", async () => {
    // The server's clock is on Apr 16.
    const r = await chart("active_subscriptions", { from: "2026-04-10", to: "2026-05-30" });
    expect(r.to).toBe("2026-04-16");
    expect(r.points.at(-1)!.date).toBe("2026-04-16");
  });
});

describe("phase 2: movements, churn, refund rate (the same hand-checked ledger)", () => {
  const byMonth = async (name: string, over: Query = {}) =>
    Object.fromEntries((await chart(name, { interval: "month", to: "2026-03-31", ...over })).points.map((p) => [p.date.slice(0, 7), p.values]));

  it("subscription movement: new (including A's trial converting), renewals, churn", async () => {
    const m = await byMonth("subscription_movement");
    expect(m["2026-01"]).toMatchObject({ new: 3, reactivated: 0, churned: 0, net: 3, renewed: 0 }); // A converts, B and C start
    expect(m["2026-02"]).toMatchObject({ new: 0, churned: -2, net: -2, renewed: 1 }); // B refunded, C's grace ends; A renews
  });

  it("MRR movement: new MRR on conversion and purchase, churned MRR on refund and expiry", async () => {
    const m = await byMonth("mrr_movement");
    expect(m["2026-01"]).toMatchObject({ new: 28.33, churned: 0, net: 28.33 });
    expect(m["2026-02"]).toMatchObject({ new: 0, expansion: 0, churned: -18.33, net: -18.33 }); // A renews at the same price: no movement
  });

  it("trial movement and churn and refund rates", async () => {
    expect((await byMonth("trial_movement"))["2026-01"]).toMatchObject({ new: 1, converted: -1, expired: 0, conversion_rate: 100 });
    const churn = await byMonth("churn");
    expect(churn["2026-02"]).toMatchObject({ rate: 66.7, churned: 2, paying_at_start: 3 });
    expect(churn["2026-01"]).toMatchObject({ rate: null, paying_at_start: 0 }); // nobody paying when January began
    const refunds = await byMonth("refund_rate");
    expect(refunds["2026-02"]).toMatchObject({ rate: 100, refunds: 1, transactions: 1 }); // B refunded; A's renewal the only purchase
    expect(refunds["2026-01"]).toMatchObject({ rate: 0, transactions: 5 }); // A, B, C, D and E (SAR)
  });
});

describe("phase 2: reactivation, expansion, contraction, trials, status (a sandbox ledger)", () => {
  const sandbox = (over: Query = {}) => ({ environment: "sandbox", interval: "month", from: "2026-01-01", to: "2026-03-31", ...over });
  const months = async (name: string, over: Query = {}) => Object.fromEntries((await chart(name, sandbox(over))).points.map((p) => [p.date.slice(0, 7), p.values]));

  beforeAll(async () => {
    await setClock(at("2026-04-20"));
    const sb = { env: "sandbox" as const };
    // G: monthly, lapses for February, comes back in March (same chain): churn, then reactivation.
    await notified({ ...sb, chain: "G", bought: "2026-01-01", expires: "2026-02-01", price: 10 });
    await notified({ ...sb, chain: "G", bought: "2026-03-01", expires: "2026-04-01", price: 10 });
    // H: monthly at $10, renews at $12 (expansion +2), then switches to yearly at $60 (= $5/month: contraction -7).
    await notified({ ...sb, chain: "H", bought: "2026-01-01", expires: "2026-02-01", price: 10, product: "monthly" });
    await notified({ ...sb, chain: "H", bought: "2026-02-01", expires: "2026-03-01", price: 12, product: "monthly" });
    await notified({ ...sb, chain: "H", bought: "2026-03-01", expires: "2027-03-01", price: 60, product: "yearly" });
    // I: a trial, auto-renew turned off on day 2, then it expires.
    await notified(
      { ...sb, chain: "I", bought: "2026-01-10", expires: "2026-01-17", price: 0, period: "trial" },
      { signedDate: at("2026-01-12"), renewal: { autoRenewStatus: 0, signedDate: at("2026-01-12") } },
    );
    // For the status breakdown on Mar 15: J ended Mar 10, K won't renew, L is in a grace period.
    await notified({ ...sb, chain: "J", bought: "2026-02-10", expires: "2026-03-10", price: 10 });
    await notified({ ...sb, chain: "K", bought: "2026-03-05", expires: "2026-04-05", price: 10 }, { status: 1, renewal: { autoRenewStatus: 0 } });
    await notified({ ...sb, chain: "L", bought: "2026-02-12", expires: "2026-03-12", price: 10 }, { status: 4, renewal: { gracePeriodExpiresDate: at("2026-03-20") } });
    await refresh(true);
  });

  it("classifies reactivations, expansions and contractions", async () => {
    const mrr = await months("mrr_movement");
    expect(mrr["2026-02"]).toMatchObject({ expansion: 2, churned: -10 }); // H's price rise; G lapses
    expect(mrr["2026-03"]).toMatchObject({ reactivation: 10, contraction: -7 }); // G is back; H goes yearly
    const subs = await months("subscription_movement");
    expect(subs["2026-03"]).toMatchObject({ reactivated: 1 });
    const trials = await months("trial_movement");
    expect(trials["2026-01"]).toMatchObject({ new: 1, converted: 0, expired: -1, cancelled: 1, conversion_rate: 0 });
  });

  it("movements add up to the change in the running totals, every month", async () => {
    const [mrr, mrrMove, subs, subsMove, trials, trialMove] = await Promise.all(
      ["mrr", "mrr_movement", "active_subscriptions", "subscription_movement", "active_trials", "trial_movement"].map((c) => chart(c, sandbox())),
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
    await setClock(at("2026-03-15"));
    const r = await chart("subscription_status", sandbox({ to: "2026-03-15" }));
    const status = Object.fromEntries(r.categories!.map((c) => [c.key, c.value]));
    // G and H active and renewing; K won't renew; L in its grace period; J expired 5 days ago.
    // I's trial ended in January, more than 30 days ago, so it isn't listed.
    expect(status).toEqual({ active: 2, cancelled: 1, trial: 0, grace: 1, billing_retry: 0, paused: 0, expired: 1 });
  });
});
