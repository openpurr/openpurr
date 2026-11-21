// Price experiments in the back office: how the admin API shows them, and their results. What the
// SDK Worker needs (assignment, enrollment) is in src/experiments.ts, which explains what counts.

import type { ProjectConfig } from "../config";
import { type ExperimentRow, variantsOf } from "../experiments";
import { usdSql } from "../fx";

/** An experiment as the admin API shows it (without results). */
export function publicExperiment(row: ExperimentRow, project?: ProjectConfig) {
  const offerings = new Set(project?.offerings.map((o) => o.id) ?? []);
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    notes: row.notes,
    status: row.status,
    variants: variantsOf(row).map((v) => ({ ...v, ...(project ? { offering_exists: offerings.has(v.offering_id) } : {}) })),
    created_at: row.created_at,
    created_by: row.created_by,
    started_at: row.started_at,
    stopped_at: row.stopped_at,
  };
}

// --- results -------------------------------------------------------------------------------------

/** Below these, a "chance to beat the control" is mostly noise, and the dashboard says it's too early. */
export const MIN_CUSTOMERS_PER_VARIANT = 100;
export const MIN_PAYING_PER_COMPARISON = 20;

export interface VariantResult {
  id: string;
  offering_id: string;
  weight: number;
  /** Enrolled people (a customer enrolled under two app user IDs counts once). */
  customers: number;
  trials: number;
  trial_conversions: number;
  /** Customers with at least one paid purchase that wasn't refunded. */
  paying: number;
  /** USD, net of refunds. */
  revenue: number;
  revenue_per_customer: number;
  active_subscriptions: number;
  /** USD a month, from the active subscriptions. */
  mrr: number;
  /** Paying subscribers whose subscriptions have all ended. */
  churned: number;
  /** Paying customers by the product of their first paid purchase ("pro:monthly" for Play base plans). */
  products: Record<string, number>;
  /** Versus the control ("a"); null for the control itself. */
  vs_control: {
    /** Relative difference, e.g. 0.12 for 12% higher. Null when the control's value is 0. */
    conversion_lift: number | null;
    revenue_lift: number | null;
    /** Probability (0 to 1) that this variant's true rate or average is higher than the control's. */
    conversion_chance: number | null;
    revenue_chance: number | null;
    enough_data: boolean;
  } | null;
}

export interface ExperimentResults {
  experiment_id: string;
  environment: "production" | "sandbox";
  computed_at: number;
  /** Purchases in currencies with no exchange rate, left out of revenue and MRR. */
  unconverted: number;
  variants: VariantResult[];
  /** Per day: each variant's new enrollments, new paying customers and revenue (by purchase date). */
  daily: { date: string; values: Record<string, { customers: number; paying: number; revenue: number }> }[];
}

/** The standard normal CDF (Abramowitz and Stegun 7.1.26, error below 1.5e-7). */
export function normalCdf(z: number) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/**
 * P(variant's conversion rate > control's): Beta(1 + paying, 1 + others) posteriors, compared with
 * a normal approximation of their difference.
 */
export function chanceConversionHigher(control: { n: number; x: number }, variant: { n: number; x: number }) {
  if (!control.n || !variant.n) return null;
  const beta = ({ n, x }: { n: number; x: number }) => {
    const a = 1 + x;
    const b = 1 + n - x;
    return { mean: a / (a + b), variance: (a * b) / ((a + b) ** 2 * (a + b + 1)) };
  };
  const c = beta(control);
  const v = beta(variant);
  return normalCdf((v.mean - c.mean) / Math.sqrt(c.variance + v.variance));
}

/** P(variant's mean revenue per customer > control's): a normal approximation of the difference of means. */
export function chanceMeanHigher(control: { n: number; sum: number; sumSq: number }, variant: { n: number; sum: number; sumSq: number }) {
  if (control.n < 2 || variant.n < 2) return null;
  const stats = ({ n, sum, sumSq }: { n: number; sum: number; sumSq: number }) => {
    const mean = sum / n;
    return { mean, se2: Math.max(0, (sumSq - n * mean * mean) / (n - 1)) / n };
  };
  const c = stats(control);
  const v = stats(variant);
  const se = Math.sqrt(c.se2 + v.se2);
  if (!se) return c.mean === v.mean ? 0.5 : v.mean > c.mean ? 1 : 0;
  return normalCdf((v.mean - c.mean) / se);
}

const lift = (control: number, variant: number) => (control ? variant / control - 1 : null);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Days in a billing period, from a purchase's length (as the charts infer it). */
function periodDays(ms: number) {
  const days = ms / 864e5;
  if (days < 10) return 7;
  if (days < 45) return 30.4375;
  if (days < 100) return 91.3125;
  if (days < 200) return 182.625;
  return 365.25;
}

interface TxRow {
  who: string;
  variant: string;
  store: string;
  original_transaction_id: string;
  product: string;
  product_type: string;
  purchased_at: number;
  expires_at: number | null;
  period_type: string;
  price_micros: number | null;
  revoked_at: number | null;
  usd: number | null;
}

/** Each enrolled person once, with their earliest enrollment. Customers are "c:<id>", unknown app user IDs "u:<id>". */
const ENROLLED = `
  enrolled_all AS (
    SELECT coalesce('c:' || a.customer_id, 'u:' || e.app_user_id) AS who, a.customer_id, e.variant, e.enrolled_at
    FROM experiment_enrollment e LEFT JOIN customer_alias a ON a.project_id = ?2 AND a.app_user_id = e.app_user_id
    WHERE e.experiment_id = ?1),
  enrolled AS (
    SELECT who, customer_id, variant, enrolled_at FROM (
      SELECT *, row_number() OVER (PARTITION BY who ORDER BY enrolled_at, variant) AS rn FROM enrolled_all) WHERE rn = 1)`;

export async function computeResults(db: D1Database, exp: ExperimentRow, environment: "production" | "sandbox", now = Date.now()): Promise<ExperimentResults> {
  const variants = variantsOf(exp);
  const until = exp.stopped_at ?? now;
  const [counts, txs] = await db.batch([
    db
      .prepare(`WITH ${ENROLLED} SELECT variant, date(enrolled_at / 1000, 'unixepoch') AS day, count(*) AS n FROM enrolled GROUP BY variant, day`)
      .bind(exp.id, exp.project_id),
    db
      .prepare(
        `WITH ${ENROLLED}
         SELECT en.who, en.variant, t.store, t.original_transaction_id, t.product_id || coalesce(':' || t.base_plan_id, '') AS product,
                t.product_type, t.purchased_at, t.expires_at, t.period_type, t.price_micros, t.revoked_at, ${usdSql("t")} AS usd
         FROM enrolled en
         JOIN purchase_owner o ON o.customer_id = en.customer_id
         JOIN store_transaction t ON t.store = o.store AND t.original_transaction_id = o.original_transaction_id
         WHERE t.environment = ?3 AND t.original_purchased_at >= en.enrolled_at AND t.original_purchased_at < ?4
         ORDER BY t.purchased_at`,
      )
      .bind(exp.id, exp.project_id, environment, until),
  ]);

  const daily = new Map<string, Record<string, { customers: number; paying: number; revenue: number }>>();
  const day = (date: string) => {
    let d = daily.get(date);
    if (!d) daily.set(date, (d = Object.fromEntries(variants.map((v) => [v.id, { customers: 0, paying: 0, revenue: 0 }]))));
    return d;
  };
  const enrolledBy = new Map(variants.map((v) => [v.id, 0]));
  for (const r of counts!.results as { variant: string; day: string; n: number }[]) {
    if (!enrolledBy.has(r.variant)) continue;
    enrolledBy.set(r.variant, enrolledBy.get(r.variant)! + r.n);
    day(r.day)[r.variant]!.customers += r.n;
  }

  // Per customer: what they did, from their transactions (oldest first).
  interface Person {
    variant: string;
    trial: boolean;
    paidAt: number | null;
    firstProduct: string | null;
    revenue: number;
    hadSubscription: boolean;
    /** Latest transaction per subscription chain. */
    chains: Map<string, TxRow>;
  }
  const people = new Map<string, Person>();
  let unconverted = 0;
  for (const t of txs!.results as unknown as TxRow[]) {
    let p = people.get(t.who);
    if (!p) people.set(t.who, (p = { variant: t.variant, trial: false, paidAt: null, firstProduct: null, revenue: 0, hadSubscription: false, chains: new Map() }));
    if (t.period_type === "trial") p.trial = true;
    const paid = (t.price_micros ?? 0) > 0 && t.period_type !== "trial";
    if (paid && t.revoked_at === null) {
      if (t.usd === null) unconverted++;
      else {
        p.revenue += t.usd;
        day(new Date(t.purchased_at).toISOString().slice(0, 10))[t.variant]!.revenue += t.usd;
      }
      if (p.paidAt === null) {
        p.paidAt = t.purchased_at;
        p.firstProduct = t.product;
        if (t.product_type === "subscription") p.hadSubscription = true;
        day(new Date(t.purchased_at).toISOString().slice(0, 10))[t.variant]!.paying++;
      }
      if (t.product_type === "subscription") p.hadSubscription = true;
    }
    if (t.product_type === "subscription") p.chains.set(`${t.store}:${t.original_transaction_id}`, t);
  }

  const agg = new Map(
    variants.map((v) => [v.id, { trials: 0, conversions: 0, paying: 0, revenue: 0, sumSq: 0, active: 0, mrr: 0, churned: 0, products: {} as Record<string, number> }]),
  );
  for (const p of people.values()) {
    const a = agg.get(p.variant);
    if (!a) continue;
    if (p.trial) a.trials++;
    if (p.paidAt !== null) {
      a.paying++;
      if (p.trial) a.conversions++;
      if (p.firstProduct) a.products[p.firstProduct] = (a.products[p.firstProduct] ?? 0) + 1;
    }
    a.revenue += p.revenue;
    a.sumSq += p.revenue * p.revenue;
    let active = false;
    for (const t of p.chains.values()) {
      if (t.revoked_at !== null || t.expires_at === null || t.expires_at <= now) continue;
      active = true;
      a.active++;
      if (t.period_type !== "trial" && t.usd) a.mrr += (t.usd * 30.4375) / periodDays(t.expires_at - t.purchased_at);
    }
    if (p.paidAt !== null && p.hadSubscription && !active) a.churned++;
  }

  const control = variants[0]!;
  const ca = agg.get(control.id)!;
  const cn = enrolledBy.get(control.id)!;
  const results: VariantResult[] = variants.map((v) => {
    const a = agg.get(v.id)!;
    const n = enrolledBy.get(v.id)!;
    const isControl = v.id === control.id;
    return {
      id: v.id,
      offering_id: v.offering_id,
      weight: v.weight,
      customers: n,
      trials: a.trials,
      trial_conversions: a.conversions,
      paying: a.paying,
      revenue: round2(a.revenue),
      revenue_per_customer: n ? round2(a.revenue / n) : 0,
      active_subscriptions: a.active,
      mrr: round2(a.mrr),
      churned: a.churned,
      products: a.products,
      vs_control: isControl
        ? null
        : {
            conversion_lift: cn && n ? lift(ca.paying / cn, a.paying / n) : null,
            revenue_lift: cn && n ? lift(ca.revenue / cn, a.revenue / n) : null,
            conversion_chance: chanceConversionHigher({ n: cn, x: ca.paying }, { n, x: a.paying }),
            revenue_chance: chanceMeanHigher({ n: cn, sum: ca.revenue, sumSq: ca.sumSq }, { n, sum: a.revenue, sumSq: a.sumSq }),
            enough_data: Math.min(cn, n) >= MIN_CUSTOMERS_PER_VARIANT && ca.paying + a.paying >= MIN_PAYING_PER_COMPARISON,
          },
    };
  });

  for (const d of daily.values()) for (const v of Object.values(d)) v.revenue = round2(v.revenue);
  return {
    experiment_id: exp.id,
    environment,
    computed_at: now,
    unconverted,
    variants: results,
    daily: [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => ({ date, values })),
  };
}

const RESULTS_FRESH_MS = 5 * 60_000;
const RESULTS_REFRESH_MIN_MS = 60_000;

/**
 * Results, reading the ledger as little as possible: production results are kept for a few minutes
 * (for good once the experiment has stopped); `refresh` recomputes them, at most once a minute.
 * Sandbox results are always computed (test purchases are few). Null for a draft.
 */
export async function experimentResults(db: D1Database, row: ExperimentRow, environment: "production" | "sandbox", refresh = false, now = Date.now()) {
  if (row.status === "draft") return null;
  if (environment === "production" && row.results && row.results_at) {
    const age = now - row.results_at;
    if (!(refresh && age >= RESULTS_REFRESH_MIN_MS) && (age < RESULTS_FRESH_MS || row.status === "stopped")) return JSON.parse(row.results) as ExperimentResults;
  }
  const results = await computeResults(db, row, environment, now);
  if (environment === "production") await db.prepare("UPDATE experiment SET results = ?, results_at = ? WHERE id = ?").bind(JSON.stringify(results), now, row.id).run();
  return results;
}
