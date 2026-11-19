// Charts: daily totals in metric_daily, derived from the ledger (which stays the source of truth).
//
// The rollup runs hourly (src/scheduled.ts) and on demand. It recomputes only from the first day
// something changed: the earliest purchase date among ledger rows updated since the last run, or
// the last run's own day (so subscriptions that simply ran out since then are counted), whichever
// is earlier. Usually that's today, so a run writes a few hundred rows at most: the free plan
// allows 100,000 rows written per day. The first run, or a full rebuild, covers all history.
//
// Subscriptions become time segments: each transaction gives access from its purchase until the
// earliest of its expiry (or the end of a grace period, for the latest one), its refund or
// revocation, and the next transaction in the same chain (renewals don't overlap). A segment
// adds +1 to the running totals on the day it starts and -1 on the day it ends; a chart adds the
// daily changes up from the beginning. MRR does the same with each paid segment's price
// normalized to a month, using the billing period inferred from its length.
//
// Movements classify those same starts and ends, so they always add up to the running totals:
//   a paying segment that starts with no earlier one in its chain, or right after a trial: new;
//   one that starts right after a paying one: a renewal (an expansion or contraction in MRR if
//     the product, price or billing period changed);
//   one that starts after a gap: a reactivation;
//   one that ends with nothing right after it: churn.
// Trials end either converted (a paying segment follows right away) or expired.
//
// Totals are kept per environment, app, store and product. (Not per country: with dozens of
// countries a full rebuild wouldn't fit the free plan's write budget; Standard has that filter.)
// Money is converted to USD at the purchase date's ECB rate (src/fx.ts); prices in currencies
// with no rate are counted as "unconverted" and left out of USD totals. Days are UTC.

const DAY = 864e5;
const GRACE_LOOKBACK = 62 * DAY; // grace periods last at most a few weeks past expiry
const STATE_KEY = "metrics_rollup";
const CHANGE_SLACK = 60_000; // ledger rows written while the previous run was reading
const STATUS_RECENT_DAYS = 30;

export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const startOfDay = (ms: number) => Math.floor(ms / DAY) * DAY;

/** Stored as daily changes and added up by the chart. */
export const RUNNING_METRICS = ["active_subs", "active_trials", "paid_subs", "mrr"] as const;
/** Movements, from the same segments; stored as the day's amount. */
export const MOVEMENT_METRICS = [
  "sub_new",
  "sub_renewed",
  "sub_reactivated",
  "sub_churned",
  "trial_converted",
  "trial_expired",
  "trial_cancelled",
  "mrr_new",
  "mrr_reactivation",
  "mrr_expansion",
  "mrr_contraction",
  "mrr_churned",
] as const;
/** Stored as the day's amount. */
export const DAILY_METRICS = ["revenue", "transactions", "refunds", "refund_amount", "new_trials", "nonsub_revenue", "nonsub_count", "unconverted"] as const;
const SEGMENT_METRICS: readonly string[] = [...RUNNING_METRICS, ...MOVEMENT_METRICS];
const LEDGER_METRICS: readonly string[] = [...SEGMENT_METRICS, ...DAILY_METRICS];
export type Metric = (typeof RUNNING_METRICS)[number] | (typeof MOVEMENT_METRICS)[number] | (typeof DAILY_METRICS)[number] | "new_customers";

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
const periodDays = (ms: string) => `CASE
  WHEN ${ms} < 10 * 864e5 THEN 7
  WHEN ${ms} < 45 * 864e5 THEN 30.4375
  WHEN ${ms} < 100 * 864e5 THEN 91.3125
  WHEN ${ms} < 200 * 864e5 THEN 182.625
  ELSE 365.25 END`;

/** The product as charts show it: Google Play base plans are separate ("pro:monthly"). */
const product = (t: string) => `${t}.product_id || coalesce(':' || ${t}.base_plan_id, '')`;

interface RollupState {
  at: number;
  /** The first day with a purchase, for "all time" chart ranges. */
  first?: string | null;
  /** Set by a migration that changed what's stored: the next run rebuilds everything. */
  rebuild?: boolean;
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

/** Updates metric_daily from the ledger. `full` recomputes all history (except new_customers, see migration 0014). */
export async function rollupMetrics(db: D1Database, now: number, opts: { full?: boolean } = {}): Promise<RollupResult> {
  const state = await readState(db);
  const full = !!opts.full || !state || !!state.rebuild;
  let from: number | null;
  if (full) {
    from = (await db.prepare("SELECT min(purchased_at) AS at FROM store_transaction").first<{ at: number | null }>())?.at ?? null;
  } else {
    const since = state!.at - CHANGE_SLACK;
    const [tx, subs] = await db.batch<{ at: number | null }>([
      db.prepare("SELECT min(purchased_at) AS at FROM store_transaction WHERE updated_at >= ?").bind(since),
      // A subscription's renewal state (a grace period, auto-renew) changes with its latest purchase.
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
  const hasLedger = from !== null && Number.isFinite(from);
  const writes: D1PreparedStatement[] = [];
  if (hasLedger) {
    const fromDay = startOfDay(from!);
    const fromDate = dayOf(fromDay);
    writes.push(
      db.prepare(`DELETE FROM metric_daily WHERE metric IN (${LEDGER_METRICS.map(() => "?").join(", ")}) AND date >= ?`).bind(...LEDGER_METRICS, fromDate),
      // Subscription segments: running totals and movements.
      db
        .prepare(
          `WITH base AS (
             SELECT t.app_id, t.store, t.environment, t.original_transaction_id AS chain, ${product("t")} AS product,
               t.period_type, t.purchased_at AS start, t.expires_at, t.revoked_at, t.price_micros, t.currency,
               t.expires_at - t.purchased_at AS period_ms,
               s.grace_period_expires_at AS grace_end, s.unsubscribe_detected_at AS unsubscribed_at,
               (SELECT min(n.purchased_at) FROM store_transaction n
                WHERE n.store = t.store AND n.original_transaction_id = t.original_transaction_id AND n.purchased_at > t.purchased_at) AS next_at,
               (SELECT max(n.purchased_at) FROM store_transaction n
                WHERE n.store = t.store AND n.original_transaction_id = t.original_transaction_id AND n.purchased_at < t.purchased_at) AS prev_at,
               ${usd("t")} AS usd
             FROM store_transaction t
             LEFT JOIN subscription_state s ON s.store = t.store AND s.original_transaction_id = t.original_transaction_id
             WHERE t.product_type = 'subscription' AND t.expires_at >= ?1
           ),
           seg AS MATERIALIZED (
             SELECT b.*,
               min(CASE WHEN b.next_at IS NULL AND b.grace_end > b.expires_at THEN b.grace_end ELSE b.expires_at END,
                   coalesce(b.revoked_at, 9e15), coalesce(b.next_at, 9e15)) AS stop,
               -- The next purchase picks up where this one ends (a renewal or conversion), not after a gap.
               (b.next_at IS NOT NULL AND b.next_at <= min(b.expires_at, coalesce(b.revoked_at, 9e15))) AS continued,
               p.purchased_at IS NOT NULL AS has_prev,
               (p.purchased_at IS NOT NULL AND min(p.expires_at, coalesce(p.revoked_at, 9e15)) >= b.start) AS continues,
               p.period_type AS prev_type,
               (p.price_micros IS b.price_micros AND p.currency IS b.currency AND ${product("p")} = b.product
                 AND ${periodDays("p.expires_at - p.purchased_at")} = ${periodDays("b.period_ms")}) AS same_terms,
               CASE WHEN b.period_type != 'trial' AND b.usd > 0 THEN b.usd * 30.4375 / ${periodDays("b.period_ms")} ELSE 0 END AS mrr,
               CASE WHEN p.period_type != 'trial' THEN coalesce(${usd("p")}, 0) * 30.4375 / ${periodDays("p.expires_at - p.purchased_at")} ELSE 0 END AS prev_mrr
             FROM base b
             LEFT JOIN store_transaction p ON p.store = b.store AND p.original_transaction_id = b.chain AND p.purchased_at = b.prev_at
           ),
           ev AS (
             SELECT *, 'start' AS kind, start AS at, 1 AS dir FROM seg WHERE stop > start AND start >= ?2 AND start < ?3
             UNION ALL
             SELECT *, 'end' AS kind, stop AS at, -1 AS dir FROM seg WHERE stop > start AND stop >= ?2 AND stop < ?3
             UNION ALL
             -- Auto-renew turned off during a free trial.
             SELECT *, 'cancel' AS kind, unsubscribed_at AS at, 0 AS dir FROM seg
             WHERE period_type = 'trial' AND unsubscribed_at >= start AND unsubscribed_at < expires_at AND unsubscribed_at >= ?2 AND unsubscribed_at < ?3
           ),
           cls AS (
             SELECT *,
               (kind = 'start' AND period_type != 'trial' AND (NOT has_prev OR (continues AND prev_type = 'trial'))) AS is_new,
               (kind = 'start' AND period_type != 'trial' AND continues AND prev_type != 'trial') AS is_renewal,
               (kind = 'start' AND period_type != 'trial' AND has_prev AND NOT continues) AS is_reactivation,
               (kind = 'end' AND period_type != 'trial' AND NOT continued) AS is_churn
             FROM ev
           ),
           day AS (
             SELECT environment, app_id, store, product, date(at / 1000, 'unixepoch') AS d,
               sum(dir) AS active_subs,
               sum(CASE WHEN period_type = 'trial' THEN dir ELSE 0 END) AS active_trials,
               sum(CASE WHEN period_type = 'normal' THEN dir ELSE 0 END) AS paid_subs,
               round(sum(dir * mrr), 4) AS mrr,
               sum(is_new) AS sub_new,
               sum(is_renewal) AS sub_renewed,
               sum(is_reactivation) AS sub_reactivated,
               sum(is_churn) AS sub_churned,
               sum(kind = 'end' AND period_type = 'trial' AND continued) AS trial_converted,
               sum(kind = 'end' AND period_type = 'trial' AND NOT continued) AS trial_expired,
               sum(kind = 'cancel') AS trial_cancelled,
               round(sum(CASE WHEN is_new THEN mrr ELSE 0 END), 4) AS mrr_new,
               round(sum(CASE WHEN is_reactivation THEN mrr ELSE 0 END), 4) AS mrr_reactivation,
               round(sum(CASE WHEN is_renewal AND NOT same_terms AND mrr > prev_mrr THEN mrr - prev_mrr ELSE 0 END), 4) AS mrr_expansion,
               round(sum(CASE WHEN is_renewal AND NOT same_terms AND mrr < prev_mrr THEN mrr - prev_mrr ELSE 0 END), 4) AS mrr_contraction,
               round(sum(CASE WHEN is_churn THEN -mrr ELSE 0 END), 4) AS mrr_churned
             FROM cls GROUP BY environment, app_id, store, product, d
           )
           INSERT INTO metric_daily (metric, environment, app_id, store, product_id, date, value)
           SELECT m.value, environment, app_id, store, product, d,
             CASE m.value
               WHEN 'active_subs' THEN active_subs WHEN 'active_trials' THEN active_trials WHEN 'paid_subs' THEN paid_subs WHEN 'mrr' THEN mrr
               WHEN 'sub_new' THEN sub_new WHEN 'sub_renewed' THEN sub_renewed WHEN 'sub_reactivated' THEN sub_reactivated WHEN 'sub_churned' THEN sub_churned
               WHEN 'trial_converted' THEN trial_converted WHEN 'trial_expired' THEN trial_expired WHEN 'trial_cancelled' THEN trial_cancelled
               WHEN 'mrr_new' THEN mrr_new WHEN 'mrr_reactivation' THEN mrr_reactivation WHEN 'mrr_expansion' THEN mrr_expansion
               WHEN 'mrr_contraction' THEN mrr_contraction ELSE mrr_churned END AS v
           FROM day JOIN json_each(?4) m
           WHERE v IS NOT NULL AND v != 0`,
        )
        .bind(fromDay - GRACE_LOOKBACK, fromDay, tomorrow, JSON.stringify(SEGMENT_METRICS)),
      // Daily amounts: purchases by purchase day, refunds by refund day.
      db
        .prepare(
          `WITH tx AS (
             SELECT t.app_id, t.store, t.environment, ${product("t")} AS product, t.product_type, t.period_type, t.price_micros,
               t.purchased_at, t.revoked_at, t.is_upgraded, ${usd("t")} AS usd
             FROM store_transaction t
             WHERE (t.purchased_at >= ?1 AND t.purchased_at < ?2) OR (t.revoked_at >= ?1 AND t.revoked_at < ?2)
           ),
           ev AS (
             SELECT *, 'buy' AS kind, purchased_at AS at FROM tx WHERE purchased_at >= ?1 AND purchased_at < ?2
             UNION ALL
             SELECT *, 'refund' AS kind, revoked_at AS at FROM tx WHERE revoked_at >= ?1 AND revoked_at < ?2 AND NOT is_upgraded AND price_micros > 0
           ),
           day AS (
             SELECT environment, app_id, store, product, date(at / 1000, 'unixepoch') AS d,
               round(sum(CASE WHEN kind = 'buy' AND price_micros > 0 THEN usd END), 2) AS revenue,
               sum(kind = 'buy' AND price_micros > 0) AS transactions,
               sum(kind = 'buy' AND period_type = 'trial') AS new_trials,
               round(sum(CASE WHEN kind = 'buy' AND product_type != 'subscription' AND price_micros > 0 THEN usd END), 2) AS nonsub_revenue,
               sum(kind = 'buy' AND product_type != 'subscription') AS nonsub_count,
               sum(kind = 'buy' AND price_micros > 0 AND usd IS NULL) AS unconverted,
               sum(kind = 'refund') AS refunds,
               round(sum(CASE WHEN kind = 'refund' THEN usd END), 2) AS refund_amount
             FROM ev GROUP BY environment, app_id, store, product, d
           )
           INSERT INTO metric_daily (metric, environment, app_id, store, product_id, date, value)
           SELECT m.value, environment, app_id, store, product, d,
             CASE m.value WHEN 'revenue' THEN revenue WHEN 'transactions' THEN transactions WHEN 'new_trials' THEN new_trials
               WHEN 'nonsub_revenue' THEN nonsub_revenue WHEN 'nonsub_count' THEN nonsub_count WHEN 'unconverted' THEN unconverted
               WHEN 'refunds' THEN refunds ELSE refund_amount END AS v
           FROM day JOIN json_each(?3) m
           WHERE v IS NOT NULL AND v != 0`,
        )
        .bind(fromDay, tomorrow, JSON.stringify(DAILY_METRICS)),
    );
  }

  const known = hasLedger ? dayOf(startOfDay(from!)) : null;
  const nextState: RollupState = { at: now, first: full ? known : [state?.first, known].filter((d): d is string => !!d).sort()[0] ?? null };

  // New customers: counted from the last run's day on (all of history the first time), and never
  // recounted after that, because the cleanup job deletes old non-buyers.
  const customersFrom = state ? startOfDay(state.at) : 0;
  writes.push(
    db
      .prepare(
        `INSERT INTO metric_daily (metric, environment, app_id, store, product_id, date, value)
         SELECT 'new_customers', '', '', '', '', date(first_seen / 1000, 'unixepoch') AS d, count(*) FROM customer
         WHERE first_seen >= ? AND first_seen < ? GROUP BY d
         ON CONFLICT (metric, environment, app_id, store, product_id, date) DO UPDATE SET value = excluded.value`,
      )
      .bind(customersFrom, tomorrow),
    db
      .prepare("INSERT INTO job_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .bind(STATE_KEY, JSON.stringify(nextState satisfies RollupState), now),
  );

  const results = await db.batch(writes);
  const rows = results.slice(hasLedger ? 1 : 0, -1).reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  return { from: known, rows, full };
}

// --- Reading charts ------------------------------------------------------------------------------

export type Interval = "day" | "week" | "month";
export type Unit = "usd" | "count" | "percent";

export interface ChartSeries {
  key: string;
  label: string;
}

interface ChartDef {
  label: string;
  unit: Unit;
  /**
   * running: a value at a point in time (the end of each period); flow: a total per period;
   * breakdown: the current state, by category (no time axis).
   */
  kind: "running" | "flow" | "breakdown";
  /** Per-period totals. */
  flow?: Metric[];
  /** Running totals: `m[metric]` is the value at the end of the period, `m["metric@start"]` just before it. */
  running?: Metric[];
  series: ChartSeries[];
  /** Series values (and extra values for tooltips and the table) from the stored metrics, per period. */
  compute: (m: Record<string, number>) => Record<string, number | null>;
  /** Customers aren't tied to an app, store or product. */
  global?: boolean;
  description: string;
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const paying = (m: Record<string, number>, at = "") => (m[`active_subs${at}`] ?? 0) - (m[`active_trials${at}`] ?? 0);

export const CHARTS: Record<string, ChartDef> = {
  revenue: {
    label: "Revenue",
    unit: "usd",
    kind: "flow",
    flow: ["revenue", "refund_amount", "unconverted"],
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
    running: ["mrr"],
    series: [{ key: "mrr", label: "MRR" }],
    compute: (m) => ({ mrr: round2(m.mrr ?? 0) }),
    description: "Monthly recurring revenue: every active paid subscription's price, normalized to a month. Trials don't count.",
  },
  arr: {
    label: "ARR",
    unit: "usd",
    kind: "running",
    running: ["mrr"],
    series: [{ key: "arr", label: "ARR" }],
    compute: (m) => ({ arr: round2((m.mrr ?? 0) * 12) }),
    description: "Annual recurring revenue: MRR × 12.",
  },
  mrr_movement: {
    label: "MRR movement",
    unit: "usd",
    kind: "flow",
    flow: ["mrr_new", "mrr_reactivation", "mrr_expansion", "mrr_contraction", "mrr_churned"],
    series: [
      { key: "new", label: "New" },
      { key: "reactivation", label: "Reactivation" },
      { key: "expansion", label: "Expansion" },
      { key: "contraction", label: "Contraction" },
      { key: "churned", label: "Churned" },
    ],
    compute: (m) => {
      const v = {
        new: round2(m.mrr_new ?? 0),
        reactivation: round2(m.mrr_reactivation ?? 0),
        expansion: round2(m.mrr_expansion ?? 0),
        contraction: round2(m.mrr_contraction ?? 0),
        churned: round2(m.mrr_churned ?? 0),
      };
      return { ...v, net: round2(v.new + v.reactivation + v.expansion + v.contraction + v.churned) };
    },
    description:
      "How MRR changed in each period: new and reactivated subscriptions, upgrades and downgrades at renewal, and churn. Renewals at the same price aren't movement; exchange-rate drift on renewals isn't counted.",
  },
  active_subscriptions: {
    label: "Active subscriptions",
    unit: "count",
    kind: "running",
    running: ["active_subs", "active_trials"],
    series: [
      { key: "paid", label: "Paying" },
      { key: "trials", label: "Trials" },
    ],
    compute: (m) => ({ paid: paying(m), trials: m.active_trials ?? 0 }),
    description: "Subscriptions giving access at the end of each period, including trials, intro offers and grace periods.",
  },
  subscription_movement: {
    label: "Subscription movement",
    unit: "count",
    kind: "flow",
    flow: ["sub_new", "sub_reactivated", "sub_churned", "sub_renewed"],
    series: [
      { key: "new", label: "New" },
      { key: "reactivated", label: "Reactivated" },
      { key: "churned", label: "Churned" },
    ],
    compute: (m) => {
      const v = { new: m.sub_new ?? 0, reactivated: m.sub_reactivated ?? 0, churned: -(m.sub_churned ?? 0) };
      return { ...v, net: v.new + v.reactivated + v.churned, renewed: m.sub_renewed ?? 0 };
    },
    description: "Paying subscriptions gained and lost in each period. New includes trials converting; renewals don't change the count and are shown for reference.",
  },
  paid_subscriptions: {
    label: "Paid subscriptions",
    unit: "count",
    kind: "running",
    running: ["paid_subs"],
    series: [{ key: "paid", label: "Paid subscriptions" }],
    compute: (m) => ({ paid: m.paid_subs ?? 0 }),
    description: "Active subscriptions at full price: no trials or intro offers.",
  },
  churn: {
    label: "Churn",
    unit: "percent",
    kind: "flow",
    flow: ["sub_churned"],
    running: ["active_subs", "active_trials"],
    series: [{ key: "rate", label: "Churn rate" }],
    compute: (m) => ({ rate: pct(m.sub_churned ?? 0, paying(m, "@start")), churned: m.sub_churned ?? 0, paying_at_start: paying(m, "@start") }),
    description:
      "Paying subscriptions that ended in each period, as a share of those active when it began. A subscription counts as churned when its access ends: after a grace period, not at the first billing failure.",
  },
  active_trials: {
    label: "Active trials",
    unit: "count",
    kind: "running",
    running: ["active_trials"],
    series: [{ key: "trials", label: "Active trials" }],
    compute: (m) => ({ trials: m.active_trials ?? 0 }),
    description: "Free trials in progress at the end of each period.",
  },
  new_trials: {
    label: "New trials",
    unit: "count",
    kind: "flow",
    flow: ["new_trials"],
    series: [{ key: "trials", label: "New trials" }],
    compute: (m) => ({ trials: m.new_trials ?? 0 }),
    description: "Free trials started in each period.",
  },
  trial_movement: {
    label: "Trial movement",
    unit: "count",
    kind: "flow",
    flow: ["new_trials", "trial_converted", "trial_expired", "trial_cancelled"],
    series: [
      { key: "new", label: "Started" },
      { key: "converted", label: "Converted" },
      { key: "expired", label: "Expired" },
    ],
    compute: (m) => ({
      new: m.new_trials ?? 0,
      converted: -(m.trial_converted ?? 0),
      expired: -(m.trial_expired ?? 0),
      cancelled: m.trial_cancelled ?? 0,
      conversion_rate: pct(m.trial_converted ?? 0, (m.trial_converted ?? 0) + (m.trial_expired ?? 0)),
    }),
    description:
      "Trials started, and trials that ended by converting to a paid subscription or expiring. Cancelled counts trials where auto-renew was turned off (most then expire).",
  },
  new_customers: {
    label: "New customers",
    unit: "count",
    kind: "flow",
    flow: ["new_customers"],
    series: [{ key: "customers", label: "New customers" }],
    compute: (m) => ({ customers: m.new_customers ?? 0 }),
    global: true,
    description: "Customers first seen in each period, across all apps.",
  },
  refunds: {
    label: "Refunds",
    unit: "count",
    kind: "flow",
    flow: ["refunds", "refund_amount"],
    series: [{ key: "refunds", label: "Refunds" }],
    compute: (m) => ({ refunds: m.refunds ?? 0, amount: round2(m.refund_amount ?? 0) }),
    description: "Purchases refunded in each period, by refund date. The amount is in USD.",
  },
  refund_rate: {
    label: "Refund rate",
    unit: "percent",
    kind: "flow",
    flow: ["refunds", "transactions", "refund_amount", "revenue"],
    series: [{ key: "rate", label: "Refund rate" }],
    compute: (m) => ({ rate: pct(m.refunds ?? 0, m.transactions ?? 0), amount_rate: pct(m.refund_amount ?? 0, m.revenue ?? 0), refunds: m.refunds ?? 0, transactions: m.transactions ?? 0 }),
    description: "Refunds in each period as a share of paid transactions in it (and refunded amount as a share of revenue).",
  },
  non_subscription_purchases: {
    label: "Non-subscription purchases",
    unit: "count",
    kind: "flow",
    flow: ["nonsub_count", "nonsub_revenue"],
    series: [{ key: "purchases", label: "Purchases" }],
    compute: (m) => ({ purchases: m.nonsub_count ?? 0, revenue: round2(m.nonsub_revenue ?? 0) }),
    description: "One-time purchases (consumables and non-consumables) in each period. Revenue is in USD.",
  },
  subscription_status: {
    label: "Subscription status",
    unit: "count",
    kind: "breakdown",
    series: [{ key: "count", label: "Subscriptions" }],
    compute: (m) => m,
    description: `Every subscription by where it stands now. Expired counts those that ended in the last ${STATUS_RECENT_DAYS} days.`,
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
  product?: string;
  /** Apps the operator may see; null = all. */
  apps: string[] | null;
}

export interface ChartResult {
  chart: string;
  label: string;
  description: string;
  unit: Unit;
  kind: "running" | "flow" | "breakdown";
  interval: Interval;
  from: string;
  to: string;
  series: ChartSeries[];
  points: { date: string; values: Record<string, number | null> }[];
  /** Breakdown charts: the categories, in a fixed order. */
  categories?: { key: string; label: string; value: number }[];
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

/** WHERE clauses for the dimensions (environment, apps the operator may see, filters). */
function dimensions(q: ChartQuery, cols = { app: "app_id", store: "store", product: "product_id", environment: "environment" }) {
  const where: string[] = [`${cols.environment} = ?`];
  const binds: string[] = [q.environment];
  if (q.apps) (where.push(`${cols.app} IN (${q.apps.map(() => "?").join(", ")})`), binds.push(...q.apps));
  if (q.app) (where.push(`${cols.app} = ?`), binds.push(q.app));
  if (q.store) (where.push(`${cols.store} = ?`), binds.push(q.store));
  if (q.product) (where.push(`${cols.product} = ?`), binds.push(q.product));
  return { where, binds };
}

export async function readChart(db: D1Database, chart: string, q: ChartQuery, now = Date.now()): Promise<ChartResult | null> {
  const def = CHARTS[chart];
  if (!def) return null;
  const notes: string[] = [];
  const base = { chart, label: def.label, description: def.description, unit: def.unit, kind: def.kind, interval: q.interval, from: q.from, to: q.to, series: def.series };
  const updated_at = await lastRollupAt(db);

  if (def.kind === "breakdown") return { ...base, points: [], categories: await readStatus(db, q, now), notes, updated_at };

  if (def.global && (q.apps || q.app || q.store || q.product)) {
    if (q.apps) return { ...base, points: [], notes: ["Customers aren't tied to an app, so this chart is only for operators with access to all apps."], updated_at };
    notes.push("New customers aren't tied to an app, store or product, so this chart ignores those filters.");
  }

  const flow = def.flow ?? [];
  const running = def.running ?? [];
  const dims = def.global ? { where: ["environment = ''"], binds: [] as string[] } : dimensions(q);
  const query = (metrics: readonly string[], fromDate: string | null) =>
    db
      .prepare(
        `SELECT metric, date, sum(value) AS value FROM metric_daily
         WHERE metric IN (${metrics.map(() => "?").join(", ")}) AND ${dims.where.join(" AND ")} AND date <= ?${fromDate ? " AND date >= ?" : ""}
         GROUP BY metric, date`,
      )
      .bind(...metrics, ...dims.binds, q.to, ...(fromDate ? [fromDate] : []));
  // Per-period totals need only the range; running totals need every earlier change.
  const statements = [...(flow.length ? [query(flow, q.from)] : []), ...(running.length ? [query(running, null)] : [])];
  const rows = (await db.batch<{ metric: string; date: string; value: number }>(statements)).flatMap((r) => r.results);

  const byDay = new Map<string, Record<string, number>>();
  const total: Record<string, number> = {};
  for (const r of rows) {
    if (r.date < q.from) {
      total[r.metric] = (total[r.metric] ?? 0) + r.value; // running totals before the range
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
    let acc = periods.get(key);
    if (!acc) {
      acc = {};
      for (const m of running) acc[`${m}@start`] = total[m] ?? 0;
      periods.set(key, acc);
    }
    for (const m of flow) acc[m] = (acc[m] ?? 0) + (day[m] ?? 0);
    for (const m of running) {
      total[m] = (total[m] ?? 0) + (day[m] ?? 0);
      acc[m] = total[m]; // the last day of the period wins
    }
  }

  const unconverted = [...byDay.values()].reduce((n, d) => n + (d.unconverted ?? 0), 0);
  if (unconverted) notes.push(`${unconverted} purchase${unconverted === 1 ? " is" : "s are"} in currencies without an exchange rate and aren't in the USD totals.`);

  return { ...base, points: [...periods].map(([date, m]) => ({ date, values: def.compute(m) })), notes, updated_at };
}

const STATUSES = [
  { key: "active", label: "Active, renewing" },
  { key: "cancelled", label: "Active, won't renew" },
  { key: "trial", label: "In a free trial" },
  { key: "grace", label: "Grace period" },
  { key: "billing_retry", label: "Billing retry" },
  { key: "paused", label: "Paused" },
  { key: "expired", label: `Expired (last ${STATUS_RECENT_DAYS} days)` },
];

/** Where every subscription stands now: its latest purchase, and the store's renewal state. Live from the ledger. */
async function readStatus(db: D1Database, q: ChartQuery, now: number) {
  const dims = dimensions(q, { app: "t.app_id", store: "t.store", product: product("t"), environment: "t.environment" });
  // Only subscriptions that are active or ended recently, through the expiry index: the read stays
  // proportional to current subscribers, not to all history.
  const { results } = await db
    .prepare(
      `SELECT CASE
         WHEN t.revoked_at IS NOT NULL AND t.revoked_at <= ?1 THEN 'expired'
         WHEN t.expires_at > ?1 AND t.period_type = 'trial' THEN 'trial'
         WHEN t.expires_at > ?1 AND s.auto_renew = 0 THEN 'cancelled'
         WHEN t.expires_at > ?1 THEN 'active'
         WHEN s.grace_period_expires_at > ?1 THEN 'grace'
         WHEN s.status = 3 THEN 'billing_retry'
         WHEN s.auto_resume_at IS NOT NULL THEN 'paused'
         ELSE 'expired' END AS category, count(*) AS n
       FROM store_transaction t
       LEFT JOIN subscription_state s ON s.store = t.store AND s.original_transaction_id = t.original_transaction_id
       WHERE t.product_type = 'subscription' AND t.expires_at >= ?2
         AND NOT EXISTS (SELECT 1 FROM store_transaction n
                         WHERE n.store = t.store AND n.original_transaction_id = t.original_transaction_id AND n.purchased_at > t.purchased_at)
         AND ${dims.where.join(" AND ")}
       -- Not "status": subscription_state has a column by that name, and GROUP BY would pick it.
       GROUP BY category`,
    )
    .bind(now, now - STATUS_RECENT_DAYS * DAY, ...dims.binds)
    .all<{ category: string; n: number }>();
  const counts = Object.fromEntries(results.map((r) => [r.category, r.n]));
  return STATUSES.map((s) => ({ ...s, value: counts[s.key] ?? 0 }));
}

/** CSV for a chart: one row per period (or category), one column per value. */
export function chartCsv(result: ChartResult) {
  if (result.categories) return `status,label,count\n${result.categories.map((c) => `${c.key},"${c.label}",${c.value}`).join("\n")}\n`;
  const keys = [...new Set(result.points.flatMap((p) => Object.keys(p.values)))];
  const lines = [["date", ...keys].join(",")];
  for (const p of result.points) lines.push([p.date, ...keys.map((k) => p.values[k] ?? "")].join(","));
  return `${lines.join("\n")}\n`;
}
