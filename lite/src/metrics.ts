// Charts: daily totals in metric_daily, derived from the ledger (which stays the source of truth).
//
// The rollup runs hourly (src/scheduled.ts) and on demand. It recomputes only from the first day
// something changed: the earliest purchase date among ledger rows updated since the last run, or
// the last run's own day (so subscriptions that simply ran out since then are counted), whichever
// is earlier. Usually that's today, so a run writes about a hundred rows: the free plan allows
// 100,000 rows written per day. The first run, or a full rebuild, covers all history.
//
// Subscriptions become time segments: each transaction gives access from its purchase until the
// earliest of its expiry (or the end of a grace period, for the latest one), its refund or
// revocation, and the next transaction in the same chain (renewals don't overlap). A segment
// adds +1 to the running totals on the day it starts and -1 on the day it ends. A chart adds the
// daily changes up from the beginning. MRR does the same with each paid segment's price
// normalized to a month, using the billing period inferred from its length.
//
// Money is converted to USD at the purchase date's ECB rate (src/fx.ts); prices in currencies
// with no rate are counted as "unconverted" and left out of USD totals. Days are UTC.

const DAY = 864e5;
const GRACE_LOOKBACK = 62 * DAY; // grace periods last at most a few weeks past expiry
const STATE_KEY = "metrics_rollup";
const CHANGE_SLACK = 60_000; // ledger rows written while the previous run was reading

export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const startOfDay = (ms: number) => Math.floor(ms / DAY) * DAY;

/** Stored as daily changes and added up by the chart. */
export const RUNNING_METRICS = ["active_subs", "active_trials", "paid_subs", "mrr"] as const;
/** Stored as the day's amount. */
export const DAILY_METRICS = ["revenue", "transactions", "refunds", "refund_amount", "new_trials", "nonsub_revenue", "nonsub_count", "unconverted"] as const;
const LEDGER_METRICS: readonly string[] = [...RUNNING_METRICS, ...DAILY_METRICS];
export type Metric = (typeof RUNNING_METRICS)[number] | (typeof DAILY_METRICS)[number] | "new_customers";

/** A transaction's price in USD at its purchase date: the rate for that day or the closest earlier one (else the closest later one). */
function usd(t: string) {
  const day = `date(${t}.purchased_at / 1000, 'unixepoch')`;
  return `CASE
    WHEN ${t}.price_micros IS NULL OR ${t}.currency IS NULL THEN NULL
    WHEN ${t}.currency = 'USD' THEN ${t}.price_micros / 1e6
    ELSE ${t}.price_micros / 1e6 / coalesce(
      (SELECT f.per_usd FROM fx_rate f WHERE f.currency = ${t}.currency AND f.date <= ${day} ORDER BY f.date DESC LIMIT 1),
      (SELECT f.per_usd FROM fx_rate f WHERE f.currency = ${t}.currency AND f.date > ${day} ORDER BY f.date LIMIT 1))
  END`;
}

/** Days in a billing period, from a segment's length (weekly, monthly, quarterly, half-yearly, yearly). */
const PERIOD_DAYS = `CASE
  WHEN period_ms < 10 * 864e5 THEN 7
  WHEN period_ms < 45 * 864e5 THEN 30.4375
  WHEN period_ms < 100 * 864e5 THEN 91.3125
  WHEN period_ms < 200 * 864e5 THEN 182.625
  ELSE 365.25 END`;

interface RollupState {
  at: number;
  /** The first day with a purchase, for "all time" chart ranges. */
  first?: string | null;
}

export interface RollupResult {
  from: string | null;
  rows: number;
  full: boolean;
}

async function readState(db: D1Database): Promise<RollupState | null> {
  const row = await db.prepare("SELECT value FROM job_state WHERE key = ?").bind(STATE_KEY).first<{ value: string }>();
  return row ? (JSON.parse(row.value) as RollupState) : null;
}

export async function lastRollupAt(db: D1Database) {
  return (await readState(db))?.at ?? null;
}

/** When the chart totals were last updated, and the first day with a purchase. */
export async function rollupInfo(db: D1Database) {
  const state = await readState(db);
  return { updated_at: state?.at ?? null, first_date: state?.first ?? null };
}

/** Updates metric_daily from the ledger. `full` recomputes all history (except new_customers, see the migration). */
export async function rollupMetrics(db: D1Database, now: number, opts: { full?: boolean } = {}): Promise<RollupResult> {
  const state = await readState(db);
  const full = !!opts.full || !state;
  let from: number | null;
  if (full) {
    from = (await db.prepare("SELECT min(purchased_at) AS at FROM store_transaction").first<{ at: number | null }>())?.at ?? null;
  } else {
    const since = state!.at - CHANGE_SLACK;
    const [tx, subs] = await db.batch<{ at: number | null }>([
      db.prepare("SELECT min(purchased_at) AS at FROM store_transaction WHERE updated_at >= ?").bind(since),
      // A subscription's renewal state (a grace period) changes when its latest purchase ends.
      db.prepare(
        `SELECT min(latest) AS at FROM (
           SELECT max(t.purchased_at) AS latest FROM subscription_state s
           JOIN store_transaction t ON t.store = s.store AND t.original_transaction_id = s.original_transaction_id
           WHERE s.updated_at >= ? GROUP BY s.store, s.original_transaction_id)`,
      ).bind(since),
    ]);
    from = Math.min(tx?.results[0]?.at ?? Infinity, subs?.results[0]?.at ?? Infinity, state!.at);
  }

  const tomorrow = startOfDay(now) + DAY;
  const writes: D1PreparedStatement[] = [];
  if (from !== null && Number.isFinite(from)) {
    const fromDay = startOfDay(from);
    const fromDate = dayOf(fromDay);
    writes.push(
      db.prepare(`DELETE FROM metric_daily WHERE metric IN (${LEDGER_METRICS.map(() => "?").join(", ")}) AND date >= ?`).bind(...LEDGER_METRICS, fromDate),
      // Running totals: +1 / -1 per subscription segment, and MRR.
      db
        .prepare(
          `WITH seg AS MATERIALIZED (
             SELECT x.*, min(
                 CASE WHEN x.next_at IS NULL AND x.grace_end > x.expires_at THEN x.grace_end ELSE x.expires_at END,
                 coalesce(x.revoked_at, 9e15),
                 coalesce(x.next_at, 9e15)) AS stop
             FROM (
               SELECT t.app_id, t.store, t.environment, t.period_type, t.purchased_at AS start, t.expires_at, t.revoked_at,
                 t.expires_at - t.purchased_at AS period_ms, s.grace_period_expires_at AS grace_end,
                 (SELECT min(n.purchased_at) FROM store_transaction n
                  WHERE n.store = t.store AND n.original_transaction_id = t.original_transaction_id AND n.purchased_at > t.purchased_at) AS next_at,
                 ${usd("t")} AS usd
               FROM store_transaction t
               LEFT JOIN subscription_state s ON s.store = t.store AND s.original_transaction_id = t.original_transaction_id
               WHERE t.product_type = 'subscription' AND t.expires_at >= ?1
             ) x
           ),
           ev AS (
             SELECT app_id, store, environment, period_type, usd, period_ms, start AS at, 1 AS dir FROM seg WHERE stop > start AND start >= ?2 AND start < ?3
             UNION ALL
             SELECT app_id, store, environment, period_type, usd, period_ms, stop AS at, -1 AS dir FROM seg WHERE stop > start AND stop >= ?2 AND stop < ?3
           ),
           day AS (
             SELECT environment, app_id, store, date(at / 1000, 'unixepoch') AS d,
               sum(dir) AS active_subs,
               sum(CASE WHEN period_type = 'trial' THEN dir ELSE 0 END) AS active_trials,
               sum(CASE WHEN period_type = 'normal' THEN dir ELSE 0 END) AS paid_subs,
               round(sum(CASE WHEN period_type != 'trial' AND usd > 0 THEN dir * usd * 30.4375 / ${PERIOD_DAYS} ELSE 0 END), 4) AS mrr
             FROM ev GROUP BY environment, app_id, store, d
           )
           INSERT INTO metric_daily (metric, environment, app_id, store, date, value)
           SELECT m.value, environment, app_id, store, d,
             CASE m.value WHEN 'active_subs' THEN active_subs WHEN 'active_trials' THEN active_trials WHEN 'paid_subs' THEN paid_subs ELSE mrr END AS v
           FROM day JOIN json_each('["active_subs","active_trials","paid_subs","mrr"]') m
           WHERE v != 0`,
        )
        .bind(fromDay - GRACE_LOOKBACK, fromDay, tomorrow),
      // Daily amounts: purchases by purchase day, refunds by refund day.
      db
        .prepare(
          `WITH tx AS (
             SELECT t.app_id, t.store, t.environment, t.product_type, t.period_type, t.price_micros, t.purchased_at, t.revoked_at, t.is_upgraded,
               ${usd("t")} AS usd
             FROM store_transaction t
             WHERE (t.purchased_at >= ?1 AND t.purchased_at < ?2) OR (t.revoked_at >= ?1 AND t.revoked_at < ?2)
           ),
           ev AS (
             SELECT *, 'buy' AS kind, purchased_at AS at FROM tx WHERE purchased_at >= ?1 AND purchased_at < ?2
             UNION ALL
             SELECT *, 'refund' AS kind, revoked_at AS at FROM tx WHERE revoked_at >= ?1 AND revoked_at < ?2 AND NOT is_upgraded AND price_micros > 0
           ),
           day AS (
             SELECT environment, app_id, store, date(at / 1000, 'unixepoch') AS d,
               round(sum(CASE WHEN kind = 'buy' AND price_micros > 0 THEN usd END), 2) AS revenue,
               sum(kind = 'buy' AND price_micros > 0) AS transactions,
               sum(kind = 'buy' AND period_type = 'trial') AS new_trials,
               round(sum(CASE WHEN kind = 'buy' AND product_type != 'subscription' AND price_micros > 0 THEN usd END), 2) AS nonsub_revenue,
               sum(kind = 'buy' AND product_type != 'subscription') AS nonsub_count,
               sum(kind = 'buy' AND price_micros > 0 AND usd IS NULL) AS unconverted,
               sum(kind = 'refund') AS refunds,
               round(sum(CASE WHEN kind = 'refund' THEN usd END), 2) AS refund_amount
             FROM ev GROUP BY environment, app_id, store, d
           )
           INSERT INTO metric_daily (metric, environment, app_id, store, date, value)
           SELECT m.value, environment, app_id, store, d,
             CASE m.value WHEN 'revenue' THEN revenue WHEN 'transactions' THEN transactions WHEN 'new_trials' THEN new_trials
               WHEN 'nonsub_revenue' THEN nonsub_revenue WHEN 'nonsub_count' THEN nonsub_count WHEN 'unconverted' THEN unconverted
               WHEN 'refunds' THEN refunds ELSE refund_amount END AS v
           FROM day JOIN json_each('["revenue","transactions","new_trials","nonsub_revenue","nonsub_count","unconverted","refunds","refund_amount"]') m
           WHERE v IS NOT NULL AND v != 0`,
        )
        .bind(fromDay, tomorrow),
    );
  }

  const known = from !== null && Number.isFinite(from) ? dayOf(startOfDay(from)) : null;
  const nextState: RollupState = { at: now, first: full ? known : [state?.first, known].filter((d): d is string => !!d).sort()[0] ?? null };

  // New customers: counted from the last run's day on (all of history the first time), and never
  // recounted after that, because the cleanup job deletes old non-buyers.
  const customersFrom = state ? startOfDay(state.at) : 0;
  writes.push(
    db
      .prepare(
        `INSERT INTO metric_daily (metric, environment, app_id, store, date, value)
         SELECT 'new_customers', '', '', '', date(first_seen / 1000, 'unixepoch') AS d, count(*) FROM customer
         WHERE first_seen >= ? AND first_seen < ? GROUP BY d
         ON CONFLICT (metric, environment, app_id, store, date) DO UPDATE SET value = excluded.value`,
      )
      .bind(customersFrom, tomorrow),
    db
      .prepare("INSERT INTO job_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .bind(STATE_KEY, JSON.stringify(nextState satisfies RollupState), now),
  );

  const results = await db.batch(writes);
  const rows = results.slice(from !== null && Number.isFinite(from) ? 1 : 0, -1).reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  return { from: from !== null && Number.isFinite(from) ? dayOf(startOfDay(from)) : null, rows, full };
}

// --- Reading charts ------------------------------------------------------------------------------

export type Interval = "day" | "week" | "month";

export interface ChartSeries {
  key: string;
  label: string;
}

interface ChartDef {
  label: string;
  unit: "usd" | "count";
  /** running: a value at a point in time (the end of each period); flow: a total per period. */
  kind: "running" | "flow";
  metrics: Metric[];
  series: ChartSeries[];
  /** Series values from the stored metrics, per period. */
  compute: (m: Record<string, number>) => Record<string, number>;
  /** Customers aren't tied to an app or store. */
  global?: boolean;
  description: string;
}

export const CHARTS: Record<string, ChartDef> = {
  revenue: {
    label: "Revenue",
    unit: "usd",
    kind: "flow",
    metrics: ["revenue", "refund_amount", "unconverted"],
    series: [
      { key: "net", label: "Revenue" },
      { key: "refunds", label: "Refunded" },
    ],
    compute: (m) => ({ net: round2((m.revenue ?? 0) - (m.refund_amount ?? 0)), refunds: round2(m.refund_amount ?? 0), gross: round2(m.revenue ?? 0) }),
    description: "Purchases and renewals by purchase date, minus refunds by refund date. In USD at each purchase date's exchange rate.",
  },
  mrr: {
    label: "MRR",
    unit: "usd",
    kind: "running",
    metrics: ["mrr"],
    series: [{ key: "mrr", label: "MRR" }],
    compute: (m) => ({ mrr: round2(m.mrr ?? 0) }),
    description: "Monthly recurring revenue: every active paid subscription's price, normalized to a month. Trials don't count.",
  },
  arr: {
    label: "ARR",
    unit: "usd",
    kind: "running",
    metrics: ["mrr"],
    series: [{ key: "arr", label: "ARR" }],
    compute: (m) => ({ arr: round2((m.mrr ?? 0) * 12) }),
    description: "Annual recurring revenue: MRR × 12.",
  },
  active_subscriptions: {
    label: "Active subscriptions",
    unit: "count",
    kind: "running",
    metrics: ["active_subs", "active_trials"],
    series: [
      { key: "paid", label: "Paying" },
      { key: "trials", label: "Trials" },
    ],
    compute: (m) => ({ paid: (m.active_subs ?? 0) - (m.active_trials ?? 0), trials: m.active_trials ?? 0 }),
    description: "Subscriptions giving access at the end of each period, including trials, intro offers and grace periods.",
  },
  paid_subscriptions: {
    label: "Paid subscriptions",
    unit: "count",
    kind: "running",
    metrics: ["paid_subs"],
    series: [{ key: "paid", label: "Paid subscriptions" }],
    compute: (m) => ({ paid: m.paid_subs ?? 0 }),
    description: "Active subscriptions at full price: no trials or intro offers.",
  },
  active_trials: {
    label: "Active trials",
    unit: "count",
    kind: "running",
    metrics: ["active_trials"],
    series: [{ key: "trials", label: "Active trials" }],
    compute: (m) => ({ trials: m.active_trials ?? 0 }),
    description: "Free trials in progress at the end of each period.",
  },
  new_trials: {
    label: "New trials",
    unit: "count",
    kind: "flow",
    metrics: ["new_trials"],
    series: [{ key: "trials", label: "New trials" }],
    compute: (m) => ({ trials: m.new_trials ?? 0 }),
    description: "Free trials started in each period.",
  },
  new_customers: {
    label: "New customers",
    unit: "count",
    kind: "flow",
    metrics: ["new_customers"],
    series: [{ key: "customers", label: "New customers" }],
    compute: (m) => ({ customers: m.new_customers ?? 0 }),
    global: true,
    description: "Customers first seen in each period, across all apps.",
  },
  refunds: {
    label: "Refunds",
    unit: "count",
    kind: "flow",
    metrics: ["refunds", "refund_amount"],
    series: [{ key: "refunds", label: "Refunds" }],
    compute: (m) => ({ refunds: m.refunds ?? 0, amount: round2(m.refund_amount ?? 0) }),
    description: "Purchases refunded in each period, by refund date. The amount is in USD.",
  },
  non_subscription_purchases: {
    label: "Non-subscription purchases",
    unit: "count",
    kind: "flow",
    metrics: ["nonsub_count", "nonsub_revenue"],
    series: [{ key: "purchases", label: "Purchases" }],
    compute: (m) => ({ purchases: m.nonsub_count ?? 0, revenue: round2(m.nonsub_revenue ?? 0) }),
    description: "One-time purchases (consumables and non-consumables) in each period. Revenue is in USD.",
  },
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export interface ChartQuery {
  from: string;
  to: string;
  interval: Interval;
  environment: "production" | "sandbox";
  store?: string;
  app?: string;
  /** Apps the operator may see; null = all. */
  apps: string[] | null;
}

export interface ChartResult {
  chart: string;
  label: string;
  description: string;
  unit: "usd" | "count";
  kind: "running" | "flow";
  interval: Interval;
  from: string;
  to: string;
  series: ChartSeries[];
  points: { date: string; values: Record<string, number> }[];
  notes: string[];
  updated_at: number | null;
}

/** The first day of the period containing `date` (weeks start on Monday). */
export function periodStart(date: string, interval: Interval) {
  if (interval === "day") return date;
  if (interval === "month") return `${date.slice(0, 7)}-01`;
  const d = new Date(`${date}T00:00:00Z`);
  return dayOf(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY);
}

function* days(from: string, to: string) {
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY) yield dayOf(t);
}

export async function readChart(db: D1Database, chart: string, q: ChartQuery): Promise<ChartResult | null> {
  const def = CHARTS[chart];
  if (!def) return null;
  const notes: string[] = [];
  const base = { chart, label: def.label, description: def.description, unit: def.unit, kind: def.kind, interval: q.interval, from: q.from, to: q.to, series: def.series };
  const updated_at = await lastRollupAt(db);

  if (def.global && (q.apps || q.app || q.store)) {
    notes.push("New customers aren't tied to an app or store, so this chart can't be filtered by them.");
    if (q.apps) return { ...base, points: [], notes: ["Customers aren't tied to an app, so this chart is only for operators with access to all apps."], updated_at };
  }

  const where: string[] = [`metric IN (${def.metrics.map(() => "?").join(", ")})`];
  const binds: (string | number)[] = [...def.metrics];
  if (def.global) where.push("environment = ''");
  else {
    where.push("environment = ?");
    binds.push(q.environment);
    if (q.apps) {
      where.push(`app_id IN (${q.apps.map(() => "?").join(", ")})`);
      binds.push(...q.apps);
    }
    if (q.app) (where.push("app_id = ?"), binds.push(q.app));
    if (q.store) (where.push("store = ?"), binds.push(q.store));
  }
  where.push("date <= ?");
  binds.push(q.to);
  // Running totals need every earlier change; per-day amounts only the range.
  if (def.kind === "flow") (where.push("date >= ?"), binds.push(q.from));

  const { results } = await db
    .prepare(`SELECT metric, date, sum(value) AS value FROM metric_daily WHERE ${where.join(" AND ")} GROUP BY metric, date ORDER BY date`)
    .bind(...binds)
    .all<{ metric: string; date: string; value: number }>();

  // Per day: the stored values, then running totals added up.
  const byDay = new Map<string, Record<string, number>>();
  const running: Record<string, number> = {};
  for (const r of results) {
    if (def.kind === "running" && r.date < q.from) {
      running[r.metric] = (running[r.metric] ?? 0) + r.value;
      continue;
    }
    const day = byDay.get(r.date) ?? {};
    day[r.metric] = (day[r.metric] ?? 0) + r.value;
    byDay.set(r.date, day);
  }

  const periods = new Map<string, Record<string, number>>();
  for (const date of days(q.from, q.to)) {
    const day = byDay.get(date) ?? {};
    const key = periodStart(date, q.interval);
    if (def.kind === "running") {
      for (const m of def.metrics) running[m] = (running[m] ?? 0) + (day[m] ?? 0);
      periods.set(key, { ...running }); // the last day of the period wins
    } else {
      const acc = periods.get(key) ?? {};
      for (const m of def.metrics) acc[m] = (acc[m] ?? 0) + (day[m] ?? 0);
      periods.set(key, acc);
    }
  }

  const unconverted = [...byDay.values()].reduce((n, d) => n + (d.unconverted ?? 0), 0);
  if (unconverted) notes.push(`${unconverted} purchase${unconverted === 1 ? " is" : "s are"} in currencies without an exchange rate and aren't in the USD totals.`);

  return { ...base, points: [...periods].map(([date, m]) => ({ date, values: def.compute(m) })), notes, updated_at };
}

/** CSV for a chart: one row per period, one column per value. */
export function chartCsv(result: ChartResult) {
  const keys = [...new Set(result.points.flatMap((p) => Object.keys(p.values)))];
  const lines = [["date", ...keys].join(",")];
  for (const p of result.points) lines.push([p.date, ...keys.map((k) => p.values[k] ?? 0)].join(","));
  return `${lines.join("\n")}\n`;
}
