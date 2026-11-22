// Generates golden-metrics.json.gz: what Lite's own chart code (lite/src/metrics.ts) stores and serves
// for a set of ledgers, so the Go tests can check Standard's rollup (every metric_daily row, the
// rollup state and each run's result) and its charts (JSON and CSV) byte for byte.
//
// Lite runs on D1, which is SQLite: this runs Lite's migrations and metrics.ts against Node's
// built-in SQLite (node:sqlite) through a small D1 shim. Each case is a ledger that arrives in
// steps (purchases as they're made, refunds and renewal states as they happen), with a rollup
// after each step at that time: the first run is a full one, later ones incremental, and the last
// a full rebuild. The charts are then read for many queries.
//
// Regenerate after changing that code in Lite, from the repo root (Node 22.5 or later):
//   lite/node_modules/.bin/esbuild standard/internal/testdata/golden-metrics.ts --bundle --platform=node \
//     --format=esm --outfile=/tmp/golden-metrics.mjs && node --no-warnings /tmp/golden-metrics.mjs | gzip -9 -n > standard/internal/testdata/golden-metrics.json.gz
//
// (Compressed: the ledgers and every chart they make come to about 4 MB of JSON.)

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { CHARTS, type ChartQuery, chartCsv, markImportActive, readChart, rollupMetrics } from "../../../lite/src/metrics";

const DAY = 864e5;
const at = (date: string, hour = 12) => Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// --- A D1 shim over node:sqlite ----------------------------------------------------------------------

type Bindable = string | number | null;

class Stmt {
  constructor(
    private db: DatabaseSync,
    readonly sql: string,
    readonly args: Bindable[] = [],
  ) {}
  bind(...args: Bindable[]) {
    return new Stmt(this.db, this.sql, args);
  }
  // node:sqlite binds numbered parameters (?1) only by name, so they're rewritten to plain ones
  // with the arguments in SQLite's order (a plain ? after ?2 is ?3). Lite's SQL has no ? in strings.
  private prepared(): [StatementSync, Bindable[]] {
    let max = 0;
    const args: Bindable[] = [];
    const sql = this.sql.replace(/\?(\d*)/g, (_, n: string) => {
      const i = n ? Number(n) : max + 1;
      max = Math.max(max, i);
      args.push(this.args[i - 1] ?? null);
      return "?";
    });
    return [this.db.prepare(sql), args];
  }
  exec() {
    const [s, args] = this.prepared();
    if (s.columns().length > 0) return { results: s.all(...args) as Record<string, unknown>[], meta: { changes: 0 } };
    const r = s.run(...args);
    return { results: [], meta: { changes: Number(r.changes) } };
  }
  async first<T>() {
    const [s, args] = this.prepared();
    return ((s.get(...args) as T | undefined) ?? null) as T | null;
  }
  async all<T>() {
    const [s, args] = this.prepared();
    return { results: s.all(...args) as T[], meta: { changes: 0 } };
  }
  async run() {
    return this.exec();
  }
}

function d1(db: DatabaseSync) {
  return {
    prepare: (sql: string) => new Stmt(db, sql),
    async batch(stmts: Stmt[]) {
      db.exec("BEGIN");
      try {
        const out = stmts.map((s) => s.exec());
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  } as unknown as D1Database;
}

function freshDb() {
  const db = new DatabaseSync(":memory:");
  const dir = join(dirname(fileURLToPath(import.meta.url)), "../../../lite/migrations");
  // The bundle runs from /tmp: find the migrations from the repo root (the working directory) instead.
  const migrations = (() => {
    try {
      return readdirSync(dir).length ? dir : "lite/migrations";
    } catch {
      return "lite/migrations";
    }
  })();
  for (const f of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(join(migrations, f), "utf8"));
  return db;
}

// --- Ledgers -------------------------------------------------------------------------------------------

interface Tx {
  app_id: string;
  store: "app_store" | "play_store";
  environment: "production" | "sandbox";
  transaction_id: string;
  original_transaction_id: string;
  product_id: string;
  base_plan_id: string | null;
  product_type: "subscription" | "non_consumable" | "consumable";
  purchased_at: number;
  original_purchased_at: number;
  expires_at: number | null;
  period_type: "normal" | "trial" | "intro";
  price_micros: number | null;
  currency: string | null;
  storefront: string | null;
  revoked_at: number | null;
  is_upgraded: number;
  updated_at: number;
}

interface State {
  store: string;
  original_transaction_id: string;
  status: number | null;
  auto_renew: number | null;
  unsubscribe_detected_at: number | null;
  grace_period_expires_at: number | null;
  auto_resume_at: number | null;
  updated_at: number;
}

interface Revoke {
  store: string;
  transaction_id: string;
  revoked_at: number;
  is_upgraded?: number;
  updated_at: number;
}

interface Step {
  customers?: [string, string, number][];
  transactions?: Tx[];
  revokes?: Revoke[];
  states?: State[];
  /** lite/src/office/import.ts marks an import running at this time. */
  import_at?: number;
  rollup: { now: number; full: boolean };
}

interface ChartCase {
  chart: string;
  query: ChartQuery;
  now: number;
}

interface Case {
  name: string;
  fx: [string, string, number][];
  steps: Step[];
  charts: ChartCase[];
}

function insertTx(db: DatabaseSync, t: Tx) {
  db.prepare(
    `INSERT INTO store_transaction (app_id, store, environment, transaction_id, original_transaction_id, product_id, base_plan_id, product_type,
       purchased_at, original_purchased_at, expires_at, period_type, price_micros, currency, storefront, revoked_at, is_upgraded, verified, source,
       received_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'sdk', ?, ?)`,
  ).run(
    t.app_id,
    t.store,
    t.environment,
    t.transaction_id,
    t.original_transaction_id,
    t.product_id,
    t.base_plan_id,
    t.product_type,
    t.purchased_at,
    t.original_purchased_at,
    t.expires_at,
    t.period_type,
    t.price_micros,
    t.currency,
    t.storefront,
    t.revoked_at,
    t.is_upgraded,
    t.updated_at,
    t.updated_at,
  );
}

function applyStep(db: DatabaseSync, s: Step) {
  for (const [id, project, firstSeen] of s.customers ?? []) {
    db.prepare("INSERT INTO customer (id, app_user_id, first_seen, project_id) VALUES (?, ?, ?, ?)").run(id, id, firstSeen, project);
  }
  for (const t of s.transactions ?? []) insertTx(db, t);
  for (const r of s.revokes ?? []) {
    db.prepare("UPDATE store_transaction SET revoked_at = ?, is_upgraded = coalesce(?, is_upgraded), updated_at = ? WHERE store = ? AND transaction_id = ?").run(
      r.revoked_at,
      r.is_upgraded ?? null,
      r.updated_at,
      r.store,
      r.transaction_id,
    );
  }
  for (const st of s.states ?? []) {
    db.prepare(
      `INSERT INTO subscription_state (store, original_transaction_id, status, auto_renew, unsubscribe_detected_at, grace_period_expires_at, auto_resume_at, signed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (store, original_transaction_id) DO UPDATE SET status = excluded.status, auto_renew = excluded.auto_renew,
         unsubscribe_detected_at = excluded.unsubscribe_detected_at, grace_period_expires_at = excluded.grace_period_expires_at,
         auto_resume_at = excluded.auto_resume_at, signed_at = excluded.signed_at, updated_at = excluded.updated_at`,
    ).run(st.store, st.original_transaction_id, st.status, st.auto_renew, st.unsubscribe_detected_at, st.grace_period_expires_at, st.auto_resume_at, st.updated_at, st.updated_at);
  }
}

/** Deterministic randomness (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    chance: (p: number) => next() < p,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!,
  };
}

const tx = (o: Partial<Tx> & Pick<Tx, "original_transaction_id" | "transaction_id" | "purchased_at">): Tx => ({
  app_id: "ios",
  store: "app_store",
  environment: "production",
  product_id: "p",
  base_plan_id: null,
  product_type: "subscription",
  original_purchased_at: o.purchased_at,
  expires_at: null,
  period_type: "normal",
  price_micros: null,
  currency: "USD",
  storefront: null,
  revoked_at: null,
  is_upgraded: 0,
  updated_at: o.purchased_at,
  ...o,
});

const state = (o: Partial<State> & Pick<State, "original_transaction_id" | "updated_at">): State => ({
  store: "app_store",
  status: null,
  auto_renew: null,
  unsubscribe_detected_at: null,
  grace_period_expires_at: null,
  auto_resume_at: null,
  ...o,
});

const PROJECTS = { default: ["ios", "android"], second: ["ios2"] };
const project = (id: keyof typeof PROJECTS) => ({ id, apps: PROJECTS[id] });

// The hand-checked ledger of lite/test/metrics.test.ts, step by step as the test runs it.
function handCase(): Case {
  let seq = 0;
  const t = (o: { chain: string; bought: string; expires?: string; price: number | null; currency?: string; period?: Tx["period_type"]; type?: Tx["product_type"]; revoked?: string; updatedAt?: number; env?: Tx["environment"]; product?: string }) =>
    tx({
      transaction_id: `tx-${++seq}`,
      original_transaction_id: o.chain,
      purchased_at: at(o.bought),
      expires_at: o.expires ? at(o.expires) : null,
      period_type: o.period ?? "normal",
      price_micros: o.price === null ? null : Math.round(o.price * 1e6),
      currency: o.currency ?? "USD",
      product_type: o.type ?? "subscription",
      revoked_at: o.revoked ? at(o.revoked) : null,
      updated_at: o.updatedAt ?? at("2026-03-01"),
      environment: o.env ?? "production",
      product_id: o.product ?? "p",
    });
  const NOW = at("2026-03-15");
  const later = NOW + 2 * 3600_000;
  const sb = { env: "sandbox" as const };
  const steps: Step[] = [
    {
      customers: [
        ["m1", "default", at("2026-01-01")],
        ["m2", "default", at("2026-01-05")],
        ["m3", "default", at("2026-01-10")],
      ],
      transactions: [
        t({ chain: "A", bought: "2026-01-01", expires: "2026-01-08", price: 0, period: "trial" }),
        t({ chain: "A", bought: "2026-01-08", expires: "2026-02-08", price: 10 }),
        t({ chain: "A", bought: "2026-02-08", expires: "2026-03-08", price: 10 }),
        t({ chain: "A", bought: "2026-03-08", expires: "2026-04-08", price: 10 }),
        t({ chain: "B", bought: "2026-01-10", expires: "2027-01-10", price: 90, currency: "EUR", revoked: "2026-02-01" }),
        t({ chain: "C", bought: "2026-01-05", expires: "2026-02-05", price: 10 }),
        t({ chain: "D", bought: "2026-01-20", price: 20, type: "non_consumable" }),
        t({ chain: "E", bought: "2026-01-25", price: 5, currency: "SAR", type: "consumable" }),
      ],
      states: [state({ original_transaction_id: "C", status: 2, auto_renew: 0, grace_period_expires_at: at("2026-02-12"), updated_at: at("2026-03-01") })],
      rollup: { now: NOW, full: false },
    },
    {
      transactions: [t({ chain: "F", bought: "2026-03-15", expires: "2026-04-15", price: 10, updatedAt: later - 1000 })],
      revokes: [{ store: "app_store", transaction_id: "tx-3", revoked_at: later - 2000, updated_at: later - 2000 }],
      rollup: { now: later, full: false },
    },
    { rollup: { now: later, full: true } },
    { rollup: { now: at("2026-04-01"), full: false } },
    { rollup: { now: at("2026-04-14", 23), full: false } },
    { rollup: { now: at("2026-04-16", 1), full: false } },
    {
      transactions: [
        t({ ...sb, chain: "G", bought: "2026-01-01", expires: "2026-02-01", price: 10 }),
        t({ ...sb, chain: "G", bought: "2026-03-01", expires: "2026-04-01", price: 10 }),
        t({ ...sb, chain: "H", bought: "2026-01-01", expires: "2026-02-01", price: 10, product: "monthly" }),
        t({ ...sb, chain: "H", bought: "2026-02-01", expires: "2026-03-01", price: 12, product: "monthly" }),
        t({ ...sb, chain: "H", bought: "2026-03-01", expires: "2027-03-01", price: 60, product: "yearly" }),
        t({ ...sb, chain: "I", bought: "2026-01-10", expires: "2026-01-17", price: 0, period: "trial" }),
        t({ ...sb, chain: "J", bought: "2026-02-10", expires: "2026-03-10", price: 10 }),
        t({ ...sb, chain: "K", bought: "2026-03-05", expires: "2026-04-05", price: 10 }),
        t({ ...sb, chain: "L", bought: "2026-02-12", expires: "2026-03-12", price: 10 }),
      ],
      states: [
        state({ original_transaction_id: "I", status: 2, auto_renew: 0, unsubscribe_detected_at: at("2026-01-12"), updated_at: 0 }),
        state({ original_transaction_id: "K", status: 1, auto_renew: 0, updated_at: 0 }),
        state({ original_transaction_id: "L", status: 4, auto_renew: 1, grace_period_expires_at: at("2026-03-20"), updated_at: 0 }),
      ],
      rollup: { now: at("2026-04-20"), full: true },
    },
  ];
  const q = (o: Partial<ChartQuery> = {}): ChartQuery => ({ from: "2026-01-01", to: "2026-03-15", interval: "day", environment: "production", apps: null, ...o });
  const charts: ChartCase[] = [];
  for (const chart of Object.keys(CHARTS)) {
    charts.push({ chart, query: q(), now: at("2026-04-20") });
    charts.push({ chart, query: q({ interval: "month", to: "2026-03-31" }), now: at("2026-04-20") });
    charts.push({ chart, query: q({ interval: "week" }), now: at("2026-04-20") });
    charts.push({ chart, query: q({ environment: "sandbox", interval: "month", to: "2026-03-31" }), now: at("2026-03-15") });
    charts.push({ chart, query: q({ environment: "sandbox", interval: "month", to: "2026-03-31", product: "yearly" }), now: at("2026-03-15") });
    charts.push({ chart, query: q({ store: "play_store" }), now: at("2026-04-20") });
    charts.push({ chart, query: q({ apps: ["android"] }), now: at("2026-04-20") });
    charts.push({ chart, query: q({ apps: ["ios"], interval: "month" }), now: at("2026-04-20") });
  }
  return { name: "hand-checked", fx: [["2025-12-31", "EUR", 0.9]], steps, charts };
}

// Odd ledgers: ties within a chain, a renewal at the moment the previous one ends, refunds before
// the purchase, missing prices and expiries, grace periods past the lookback, intro offers, weekly
// periods, a trial cancelled before it starts, prices with no rate until later.
function edgeCase(): Case {
  let seq = 0;
  const base = at("2025-06-01", 0);
  const d = (n: number, h = 12) => base + n * DAY + h * 3600_000;
  const t = (o: Partial<Tx> & { chain: string; day: number; hour?: number; len?: number; price?: number | null }) => {
    const { chain, day, hour, len, price, ...rest } = o;
    const purchased = d(day, hour ?? 12);
    return tx({
      transaction_id: `e-${++seq}`,
      original_transaction_id: chain,
      purchased_at: purchased,
      expires_at: len === undefined ? purchased + 30 * DAY : len < 0 ? null : purchased + len,
      price_micros: price === undefined ? 9_990_000 : price === null ? null : Math.round(price * 1e6),
      updated_at: purchased,
      ...rest,
    });
  };
  const txs: Tx[] = [
    // Two purchases at the same moment in one chain.
    t({ chain: "tie", day: 0 }),
    t({ chain: "tie", day: 0, price: 19.99 }),
    t({ chain: "tie", day: 30 }),
    // A renewal exactly when the previous one ends, and one an hour before.
    t({ chain: "exact", day: 1, len: 30 * DAY }),
    t({ chain: "exact", day: 31, len: 30 * DAY }),
    t({ chain: "exact", day: 61, hour: 11, len: 30 * DAY }),
    // Refunded before it was bought (bad data), and refunded the same day.
    t({ chain: "early", day: 2, revoked_at: d(1) }),
    t({ chain: "sameday", day: 3, revoked_at: d(3, 18) }),
    // No price, no currency, no expiry.
    t({ chain: "noprice", day: 4, price: null }),
    t({ chain: "nocurrency", day: 4, currency: null }),
    t({ chain: "noexpiry", day: 5, len: -1 }),
    t({ chain: "noexpiry", day: 40 }),
    // A previous purchase with no expiry, then one after it.
    t({ chain: "prevnull", day: 6, len: -1, price: 5 }),
    t({ chain: "prevnull", day: 9 }),
    // Weekly, quarterly, half-yearly and yearly periods, and the boundaries between them.
    t({ chain: "weekly", day: 7, len: 7 * DAY, price: 2.99 }),
    t({ chain: "weekly", day: 14, len: 7 * DAY, price: 2.99 }),
    t({ chain: "b10", day: 7, len: 10 * DAY, price: 4 }),
    t({ chain: "b45", day: 7, len: 45 * DAY, price: 12 }),
    t({ chain: "b100", day: 7, len: 100 * DAY, price: 25 }),
    t({ chain: "b200", day: 7, len: 200 * DAY, price: 50 }),
    t({ chain: "b200", day: 207, len: 365 * DAY, price: 80 }),
    // Intro offers: an intro price, then full price.
    t({ chain: "intro", day: 8, period_type: "intro", price: 0.99 }),
    t({ chain: "intro", day: 38, price: 9.99 }),
    t({ chain: "intro", day: 68, price: 9.99, period_type: "intro" }),
    // A trial cancelled before it even starts, one cancelled after it ended, a trial that converts late.
    t({ chain: "trialx", day: 10, len: 7 * DAY, period_type: "trial", price: 0 }),
    t({ chain: "trialy", day: 10, len: 7 * DAY, period_type: "trial", price: 0 }),
    t({ chain: "trialz", day: 11, len: 3 * DAY, period_type: "trial", price: 0 }),
    t({ chain: "trialz", day: 20, price: 9.99 }),
    // A grace period far past expiry (beyond the incremental lookback), and one on an older purchase.
    t({ chain: "longgrace", day: 12 }),
    t({ chain: "oldgrace", day: 13 }),
    t({ chain: "oldgrace", day: 43 }),
    // Prices in currencies with rates only later, and one never.
    t({ chain: "gbp", day: 14, currency: "GBP", price: 7.99 }),
    t({ chain: "gbp", day: 44, currency: "GBP", price: 7.99 }),
    t({ chain: "xyz", day: 15, currency: "XYZ", price: 100 }),
    t({ chain: "jpy", day: 16, currency: "JPY", price: 1200 }),
    t({ chain: "jpy", day: 46, currency: "JPY", price: 1500 }),
    // A downgrade at renewal in another currency, and a product change keeping the price.
    t({ chain: "swap", day: 17, product_id: "monthly", price: 10 }),
    t({ chain: "swap", day: 47, product_id: "monthly_plus", price: 10 }),
    t({ chain: "swap", day: 77, product_id: "monthly_plus", price: 10, currency: "EUR" }),
    // Google: base plans, an upgrade (the old chain marked upgraded and refunded, not counted as a refund).
    t({ chain: "gtok1", day: 18, store: "play_store", app_id: "android", product_id: "pro", base_plan_id: "monthly", transaction_id: "GPA.1", storefront: "US" }),
    t({ chain: "gtok1", day: 48, store: "play_store", app_id: "android", product_id: "pro", base_plan_id: "monthly", transaction_id: "GPA.1..0", storefront: "US", is_upgraded: 1, revoked_at: d(60) }),
    t({ chain: "gtok2", day: 60, store: "play_store", app_id: "android", product_id: "pro", base_plan_id: "annual", transaction_id: "GPA.2", len: 365 * DAY, price: 79.99, storefront: "US" }),
    // Paused, billing retry.
    t({ chain: "paused", day: 19, store: "play_store", app_id: "android", product_id: "pro", base_plan_id: "monthly", transaction_id: "GPA.3" }),
    t({ chain: "retry", day: 21 }),
    // One-time purchases: free, refunded, upgraded-and-revoked (not a refund), sandbox.
    t({ chain: "free", day: 22, product_type: "consumable", product_id: "coins", price: 0, len: -1 }),
    t({ chain: "lt", day: 23, product_type: "non_consumable", product_id: "lifetime", price: 49.99, len: -1, revoked_at: d(25) }),
    t({ chain: "lt2", day: 24, product_type: "non_consumable", product_id: "lifetime", price: 49.99, len: -1, is_upgraded: 1, revoked_at: d(26) }),
    t({ chain: "sbx", day: 24, environment: "sandbox", product_type: "consumable", product_id: "coins", price: 0.99, len: -1 }),
    // Another project's app.
    t({ chain: "second", day: 25, app_id: "ios2", price: 4.99 }),
    t({ chain: "second", day: 55, app_id: "ios2", price: 4.99 }),
    // Fractions that round at the fourth place.
    t({ chain: "frac1", day: 26, price: 3.33335, len: 30 * DAY }),
    t({ chain: "frac2", day: 26, price: 1.00015, len: 30 * DAY }),
    t({ chain: "frac3", day: 26, price: 0.00005 * 3, len: 365 * DAY, currency: "EUR" }),
  ];
  const states: State[] = [
    state({ original_transaction_id: "trialx", unsubscribe_detected_at: d(9), auto_renew: 0, updated_at: d(9) }),
    state({ original_transaction_id: "trialy", unsubscribe_detected_at: d(18), auto_renew: 0, updated_at: d(18) }),
    state({ original_transaction_id: "trialz", unsubscribe_detected_at: d(12), auto_renew: 1, updated_at: d(12) }),
    state({ original_transaction_id: "longgrace", status: 4, grace_period_expires_at: d(12) + 120 * DAY, updated_at: d(43) }),
    state({ original_transaction_id: "oldgrace", status: 4, grace_period_expires_at: d(13) + 40 * DAY, updated_at: d(44) }),
    state({ store: "play_store", original_transaction_id: "paused", status: null, auto_resume_at: d(80), updated_at: d(49) }),
    state({ original_transaction_id: "retry", status: 3, auto_renew: 1, updated_at: d(51) }),
    state({ original_transaction_id: "noexpiry", status: 1, auto_renew: 0, unsubscribe_detected_at: d(41), updated_at: d(41) }),
  ];
  const fx: [string, string, number][] = [
    ["2025-05-30", "EUR", 0.92],
    ["2025-07-15", "EUR", 0.88],
    ["2025-06-25", "GBP", 0.79], // after the first GBP purchase: the closest later rate
    ["2025-07-01", "JPY", 157.3],
    ["2025-07-02", "JPY", 155.1],
  ];
  // Arrives in three steps, then a full rebuild.
  const s1 = base + 20 * DAY;
  const s2 = base + 50 * DAY;
  const s3 = base + 90 * DAY;
  const split = (lo: number, hi: number) => txs.filter((x) => x.purchased_at >= lo && x.purchased_at < hi).map((x) => ({ ...x, updated_at: Math.max(x.updated_at, lo) }));
  const stateIn = (lo: number, hi: number) => states.filter((s) => s.updated_at >= lo && s.updated_at < hi).map((s) => ({ ...s, updated_at: Math.max(s.updated_at, lo) }));
  const steps: Step[] = [
    {
      customers: [
        ["c1", "default", base],
        ["c2", "default", base + 3 * DAY],
        ["c3", "second", base + 25 * DAY],
      ],
      transactions: split(0, s1),
      states: stateIn(0, s1),
      rollup: { now: s1, full: false },
    },
    {
      customers: [["c4", "default", s1 + DAY]],
      transactions: split(s1, s2),
      states: stateIn(s1, s2),
      rollup: { now: s2, full: false },
    },
    // An import running: the rollup waits.
    { import_at: s2 + 3600_000, rollup: { now: s2 + 2 * 3600_000, full: false } },
    {
      customers: [["c5", "second", s2 + 10 * DAY]],
      transactions: split(s2, Infinity),
      states: stateIn(s2, Infinity),
      rollup: { now: s3, full: false },
    },
    { rollup: { now: s3 + 3 * DAY, full: false } },
    { rollup: { now: s3 + 3 * DAY, full: true } },
  ];
  const now = s3 + 3 * DAY;
  const q = (o: Partial<ChartQuery> = {}): ChartQuery => ({ from: dayOf(base), to: dayOf(now), interval: "month", environment: "production", apps: null, ...o });
  const charts: ChartCase[] = [];
  for (const chart of Object.keys(CHARTS)) {
    charts.push({ chart, query: q(), now });
    charts.push({ chart, query: q({ interval: "day", from: dayOf(base + 25 * DAY), to: dayOf(base + 70 * DAY) }), now });
    charts.push({ chart, query: q({ interval: "week" }), now });
    charts.push({ chart, query: q({ environment: "sandbox" }), now });
    charts.push({ chart, query: q({ store: "play_store", product: "pro:monthly" }), now });
    charts.push({ chart, query: q({ project: project("second") }), now });
    charts.push({ chart, query: q({ project: project("default"), app: "ios" }), now });
    charts.push({ chart, query: q({ apps: [], interval: "day", from: dayOf(base + 10 * DAY), to: dayOf(base + 12 * DAY) }), now });
    charts.push({ chart, query: q({ from: dayOf(base + 40 * DAY), to: dayOf(base + 40 * DAY), interval: "day" }), now: base + 40 * DAY });
  }
  return { name: "edge", fx, steps, charts };
}

// A demo-like ledger: 14 months of customers on iOS and Android (Google base plans), monthly and
// annual subscriptions with trials and intro offers, conversions, renewals, upgrades and
// downgrades, price rises, refunds, grace periods, billing retry, pauses, one-time purchases,
// several currencies (one with no rate), storefronts in many countries, and some sandbox.
function demoCase(seed: number, months: number, perDay: number): Case {
  const r = rng(seed);
  const start = at("2025-01-01", 0);
  const end = start + Math.round(months * 30.4375) * DAY;
  const COUNTRIES = [
    { a3: "USA", a2: "US", cur: "USD", w: 40 },
    { a3: "DEU", a2: "DE", cur: "EUR", w: 10 },
    { a3: "FRA", a2: "FR", cur: "EUR", w: 6 },
    { a3: "GBR", a2: "GB", cur: "GBP", w: 8 },
    { a3: "JPN", a2: "JP", cur: "JPY", w: 6 },
    { a3: "BRA", a2: "BR", cur: "BRL", w: 6 },
    { a3: "IND", a2: "IN", cur: "INR", w: 6 },
    { a3: "SAU", a2: "SA", cur: "SAR", w: 3 }, // no ECB rate
    { a3: "CAN", a2: "CA", cur: "CAD", w: 5 },
    { a3: "XKX", a2: "XK", cur: "EUR", w: 1 }, // not in the country table
  ];
  const RATE: Record<string, number> = { USD: 1, EUR: 0.92, GBP: 0.79, JPY: 150, BRL: 5.1, INR: 83, SAR: 3.75, CAD: 1.36 };
  const totalW = COUNTRIES.reduce((n, c) => n + c.w, 0);
  const country = () => {
    let x = r.next() * totalW;
    for (const c of COUNTRIES) if ((x -= c.w) < 0) return c;
    return COUNTRIES[0]!;
  };
  const price = (usd: number, cur: string) => {
    const local = usd * RATE[cur]!;
    return cur === "JPY" ? Math.round(local) * 1e6 : Math.round(local * 100) * 1e4;
  };

  const txs: Tx[] = [];
  const states: State[] = [];
  const revokes: (Revoke & { at: number })[] = [];
  const customers: [string, string, number][] = [];
  let seq = 0;
  let cust = 0;
  for (let day = start; day < end; day += DAY) {
    const n = r.int(0, perDay);
    for (let i = 0; i < n; i++) {
      const id = `d${++cust}`;
      const firstSeen = day + r.int(0, DAY - 1);
      const proj = r.chance(0.12) ? "second" : "default";
      customers.push([id, proj, firstSeen]);
      if (!r.chance(0.55)) continue; // most never buy
      const c = country();
      const google = proj === "default" && r.chance(0.4);
      const app = proj === "second" ? "ios2" : google ? "android" : "ios";
      const store = google ? "play_store" : "app_store";
      const env: Tx["environment"] = r.chance(0.07) ? "sandbox" : "production";
      const storefront = r.chance(0.03) ? null : google ? c.a2 : c.a3;
      const base = { app_id: app, store, environment: env, storefront } as const;
      const kind = r.next();
      let t = firstSeen + r.int(60_000, 3 * 3600_000);
      if (kind < 0.12) {
        // A one-time purchase.
        const lifetime = r.chance(0.5);
        const p = lifetime ? 49.99 : r.pick([0.99, 4.99, 9.99]);
        const id2 = google ? `GPA.${++seq}` : `${2000000 + ++seq}`;
        txs.push(
          tx({
            ...base,
            transaction_id: id2,
            original_transaction_id: google ? `tok-${seq}` : id2,
            purchased_at: t,
            product_id: lifetime ? "lifetime" : "coins",
            product_type: lifetime ? "non_consumable" : "consumable",
            price_micros: google && r.chance(0.05) ? null : price(p, c.cur),
            currency: c.cur,
          }),
        );
        if (r.chance(0.05)) revokes.push({ store, transaction_id: id2, revoked_at: t + r.int(1, 20) * DAY, updated_at: 0, at: 0 });
        continue;
      }
      // A subscription chain.
      const chain = google ? `tok-${++seq}` : `${1000000 + ++seq}`;
      let annual = r.chance(0.25);
      const product = (a: boolean) => (google ? { product_id: "pro", base_plan_id: a ? "annual" : "monthly" } : { product_id: a ? "annual" : "monthly", base_plan_id: null });
      const usd = (a: boolean, when: number) => (a ? 59.99 : when > start + 200 * DAY ? 12.99 : 9.99);
      let n2 = 0;
      const push = (o: Partial<Tx> & { purchased_at: number; expires_at: number }) => {
        const tid = google ? `GPA.${chain}..${n2}` : n2 === 0 ? chain : `${chain}${String(n2).padStart(3, "0")}`;
        n2++;
        const row = tx({ ...base, ...product(annual), transaction_id: tid, original_transaction_id: chain, original_purchased_at: t, currency: c.cur, ...o });
        txs.push(row);
        return row;
      };
      if (r.chance(0.5)) {
        // A 7-day (or 3-day) trial.
        const len = r.chance(0.8) ? 7 * DAY : 3 * DAY;
        push({ purchased_at: t, expires_at: t + len, period_type: "trial", price_micros: 0 });
        const converts = r.chance(0.45);
        if (!converts) {
          states.push(state({ store, original_transaction_id: chain, status: 2, auto_renew: 0, unsubscribe_detected_at: r.chance(0.7) ? t + r.int(1, len - 1) : null, updated_at: t + len }));
          continue;
        }
        if (r.chance(0.15)) states.push(state({ store, original_transaction_id: chain, unsubscribe_detected_at: t + DAY, auto_renew: 1, updated_at: t + DAY }));
        t += len;
      } else if (r.chance(0.1)) {
        // An intro offer: a month at a lower price.
        const e = t + 30 * DAY;
        push({ purchased_at: t, expires_at: e, period_type: "intro", price_micros: price(1.99, c.cur) });
        t = e;
      }
      // Renewals until it churns or the ledger ends.
      for (let k = 0; k < 40 && t < end; k++) {
        const len = annual ? 365 * DAY : (r.chance(0.5) ? 30 : 31) * DAY;
        const row = push({ purchased_at: t, expires_at: t + len, price_micros: google && r.chance(0.04) ? null : price(usd(annual, t), c.cur) });
        if (r.chance(0.03)) {
          revokes.push({ store, transaction_id: row.transaction_id, revoked_at: t + r.int(1, 10) * DAY + r.int(0, DAY), updated_at: 0, at: 0 });
          break;
        }
        const churn = annual ? 0.4 : 0.09;
        if (r.chance(churn)) {
          const fate = r.next();
          const exp = t + len;
          if (fate < 0.15) states.push(state({ store, original_transaction_id: chain, status: 4, auto_renew: 1, grace_period_expires_at: exp + (google ? 7 : 6) * DAY, updated_at: exp }));
          else if (fate < 0.25) states.push(state({ store, original_transaction_id: chain, status: 3, auto_renew: 1, updated_at: exp }));
          else if (fate < 0.3 && google) states.push(state({ store, original_transaction_id: chain, auto_resume_at: exp + 30 * DAY, updated_at: exp }));
          else if (fate < 0.85) states.push(state({ store, original_transaction_id: chain, status: 2, auto_renew: 0, unsubscribe_detected_at: exp - r.int(1, 20) * DAY, updated_at: exp }));
          // Some come back after a gap (same chain on Apple).
          if (!google && r.chance(0.15)) {
            t = exp + r.int(10, 90) * DAY;
            continue;
          }
          break;
        }
        // Switch between monthly and annual at renewal sometimes.
        if (r.chance(0.04)) {
          if (google) {
            // An upgrade on Google: a new purchase token; the old one is marked upgraded and revoked.
            revokes.push({ store, transaction_id: row.transaction_id, revoked_at: t + 5 * DAY, is_upgraded: 1, updated_at: 0, at: 0 });
            break;
          }
          annual = !annual;
        }
        t += len;
      }
      if (txs.length && txs[txs.length - 1]!.original_transaction_id === chain && r.chance(0.2)) {
        const last = txs[txs.length - 1]!;
        if (last.expires_at! > end && !states.some((s) => s.original_transaction_id === chain)) {
          states.push(state({ store, original_transaction_id: chain, status: 1, auto_renew: 0, unsubscribe_detected_at: end - r.int(1, 5) * DAY, updated_at: end - DAY }));
        }
      }
    }
  }

  const fx: [string, string, number][] = [];
  for (let m = 0; m <= months; m++) {
    const date = dayOf(start + m * 30.4375 * DAY);
    for (const cur of ["EUR", "GBP", "JPY", "BRL", "INR", "CAD"]) {
      if (cur === "INR" && m < 2) continue; // rates from March: earlier INR prices use the closest later rate
      fx.push([date, cur, Math.round(RATE[cur]! * (1 + (r.next() - 0.5) * 0.06) * 1e4) / 1e4]);
    }
  }

  // Four steps a few months apart, each bringing what happened since: purchases (received an
  // hour later), refunds and renewal states.
  const span = end - start;
  const cuts = [start + Math.round((span * 0.35) / DAY) * DAY, start + Math.round((span * 0.7) / DAY) * DAY, end - 20 * DAY, end];
  for (const rv of revokes) rv.at = rv.revoked_at;
  const steps: Step[] = [];
  let lo = -Infinity;
  for (const cut of cuts) {
    const now = cut;
    const inStep = (x: number) => x >= lo && x < cut;
    steps.push({
      customers: customers.filter((c) => inStep(c[2])),
      transactions: txs.filter((x) => inStep(x.purchased_at)).map((x) => ({ ...x, updated_at: Math.min(x.purchased_at + 3600_000, now - 1000) })),
      revokes: revokes.filter((x) => inStep(x.at)).map(({ at: _, ...x }) => ({ ...x, updated_at: Math.min(x.revoked_at + 3600_000, now - 1000) })),
      states: states.filter((s) => inStep(s.updated_at)).map((s) => ({ ...s, updated_at: Math.max(s.updated_at, now - 1000) })),
      rollup: { now, full: false },
    });
    lo = cut;
  }
  // A late refund of an old purchase, picked up incrementally; then a full rebuild.
  const old = txs.find((x) => x.product_type === "subscription" && x.revoked_at === null && x.purchased_at < start + 60 * DAY && x.price_micros)!;
  steps.push({ revokes: [{ store: old.store, transaction_id: old.transaction_id, revoked_at: end + 3600_000, updated_at: end + 3600_000 }], rollup: { now: end + 2 * 3600_000, full: false } });
  steps.push({ rollup: { now: end + 2 * 3600_000, full: true } });

  const now = end + 2 * 3600_000;
  const today = dayOf(now);
  const q = (o: Partial<ChartQuery> = {}): ChartQuery => ({ from: dayOf(start), to: today, interval: "month", environment: "production", apps: null, ...o });
  const last90 = dayOf(now - 89 * DAY);
  const charts: ChartCase[] = [];
  for (const chart of Object.keys(CHARTS)) {
    charts.push({ chart, query: q(), now });
    charts.push({ chart, query: q({ interval: "day", from: last90 }), now });
    charts.push({ chart, query: q({ interval: "week", from: dayOf(start + 100 * DAY), to: dayOf(start + 200 * DAY) }), now });
    charts.push({ chart, query: q({ environment: "sandbox" }), now });
    charts.push({ chart, query: q({ store: "play_store" }), now });
    charts.push({ chart, query: q({ app: "ios", product: "annual" }), now });
    charts.push({ chart, query: q({ product: "pro:monthly" }), now });
    charts.push({ chart, query: q({ apps: ["ios", "ios2"], interval: "week", from: last90 }), now });
    charts.push({ chart, query: q({ project: project("second"), interval: "day", from: last90 }), now });
    charts.push({ chart, query: q({ to: dayOf(start + 230 * DAY), from: dayOf(start + 210 * DAY), interval: "day" }), now });
  }
  return { name: `demo-${seed}`, fx, steps, charts };
}

// --- Run Lite's code ---------------------------------------------------------------------------------

async function run(c: Case) {
  const db = freshDb();
  const D1 = d1(db);
  for (const [date, currency, perUsd] of c.fx) db.prepare("INSERT INTO fx_rate (date, currency, per_usd, source) VALUES (?, ?, ?, 'test')").run(date, currency, perUsd);
  const steps = [];
  for (const s of c.steps) {
    applyStep(db, s);
    if (s.import_at !== undefined) await markImportActive(D1, s.import_at).run();
    const result = await rollupMetrics(D1, s.rollup.now, { full: s.rollup.full });
    const rows = (
      db.prepare("SELECT metric, environment, project_id, app_id, store, product_id, date, value FROM metric_daily ORDER BY metric, environment, project_id, app_id, store, product_id, date").all() as Record<string, unknown>[]
    ).map((r) => [r.metric, r.environment, r.project_id, r.app_id, r.store, r.product_id, r.date, String(r.value)].join("|"));
    const st = db.prepare("SELECT value, updated_at FROM job_state WHERE key = 'metrics_rollup'").get() as { value: string; updated_at: number };
    // Every row after the last step; a digest of them after the others (to keep the file small).
    const last = s === c.steps[c.steps.length - 1];
    const digest = createHash("sha256").update(rows.join("\n")).digest("hex");
    steps.push({ ...s, result: JSON.stringify(result), state: st.value, stateUpdatedAt: st.updated_at, rowCount: rows.length, rowsSha256: digest, ...(last ? { rows } : {}) });
  }
  const charts = [];
  for (const ch of c.charts) {
    const result = await readChart(D1, ch.chart, ch.query, ch.now);
    charts.push({ ...ch, json: JSON.stringify(result), csv: result ? chartCsv(result) : null });
  }
  const count = (db.prepare("SELECT count(*) AS n FROM store_transaction").get() as { n: number }).n;
  return { name: c.name, transactions: count, fx: c.fx, steps, charts };
}

const list = Object.entries(CHARTS).map(([id, d]) => ({ id, label: d.label, description: d.description, unit: d.unit, kind: d.kind, series: d.series }));
const cases = [handCase(), edgeCase(), demoCase(7, 14, 4), demoCase(11, 8, 9)];
const out = { charts: JSON.stringify(list), cases: [] as unknown[] };
for (const c of cases) out.cases.push(await run(c));
console.log(JSON.stringify(out));
