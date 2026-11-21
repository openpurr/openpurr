// Price experiments: customers new to the app are split between variants, each showing a different
// offering as the current one, and the results compare what each variant's customers went on to buy.
//
// Prices live in the stores, so a price experiment is an offering experiment: each price is its own
// product, and each variant's offering sells a different set of them. Apps need no changes: the
// SDK's getOfferings() returns the variant's offering as `current`, and the other offerings as
// usual.
//
// Who is in it: anyone who fetches offerings while the experiment runs and wasn't a customer before
// it started (an app user ID we've never seen, or a customer first seen since). Existing customers
// keep seeing the current offering. Each person gets one variant, at random by the weights, and
// keeps it: by app user ID, and after logIn by any of the customer's IDs (the earliest enrollment
// wins). One experiment runs per project at a time; when it stops, everyone sees the current
// offering again.
//
// What counts: purchases that start a new purchase chain between a customer's enrollment and the
// experiment's end, with everything those chains go on to do (renewals, refunds, churn) up to now.
// Money is in USD at the purchase date's rate, net of refunds. Results and the admin API's view of an
// experiment are in src/office/experiments.ts (the back office); this file is what the SDK Worker needs.


export interface Variant {
  /** "a" (the control), "b", "c", "d". */
  id: string;
  offering_id: string;
  /** Percent of new customers; the variants' weights add up to 100. */
  weight: number;
}

export interface ExperimentRow {
  id: string;
  project_id: string;
  name: string;
  notes: string;
  variants: string;
  status: "draft" | "running" | "stopped";
  created_at: number;
  created_by: string | null;
  started_at: number | null;
  stopped_at: number | null;
  results: string | null;
  results_at: number | null;
}

export const VARIANT_IDS = ["a", "b", "c", "d"];
export const MAX_VARIANTS = VARIANT_IDS.length;

export const variantsOf = (row: Pick<ExperimentRow, "variants">) => JSON.parse(row.variants) as Variant[];

// --- the running experiment ----------------------------------------------------------------------
// Looked up on every getOfferings, so kept in memory briefly: a start or stop reaches the SDK
// within RUNNING_CACHE_MS (the admin API runs in the other Worker, which can't clear this cache).

const RUNNING_CACHE_MS = 30_000;
const running = new Map<string, { at: number; row: ExperimentRow | null }>();

/** Forgets the cached running experiments (after a change made in this isolate, and in tests). */
export const forgetRunning = () => running.clear();

export async function runningExperiment(db: D1Database, projectId: string, now = Date.now()) {
  const hit = running.get(projectId);
  if (hit && now - hit.at < RUNNING_CACHE_MS) return hit.row;
  const row = await db.prepare("SELECT * FROM experiment WHERE project_id = ? AND status = 'running'").bind(projectId).first<ExperimentRow>();
  running.set(projectId, { at: now, row: row ?? null });
  return row ?? null;
}

/** The same person always lands in the same variant: a hash of the experiment and the person, split by weight. */
export function pickVariant(experimentId: string, who: string, variants: Variant[]) {
  let h = 0x811c9dc5;
  for (const ch of `${experimentId}:${who}`) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Mix the low bits (FNV's are weak) before taking a bucket out of 10,000.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  const bucket = (h % 10_000) / 100;
  let edge = 0;
  for (const v of variants) {
    edge += v.weight;
    if (bucket < edge) return v;
  }
  return variants.at(-1)!;
}

export interface Assignment {
  experimentId: string;
  variant: Variant;
  /** The enrollment to record when it's new (run it after responding). */
  write: D1PreparedStatement | null;
}

/**
 * The running experiment's variant for this app user, enrolling them if they qualify; null when no
 * experiment is running or they don't qualify (an existing customer).
 */
export async function assignVariant(db: D1Database, projectId: string, appUserId: string, now = Date.now()): Promise<Assignment | null> {
  const exp = await runningExperiment(db, projectId, now);
  if (!exp) return null;
  const variants = variantsOf(exp);
  const row = await db
    .prepare(
      `WITH me AS (SELECT c.id, c.first_seen FROM customer_alias a JOIN customer c ON c.id = a.customer_id WHERE a.project_id = ?1 AND a.app_user_id = ?2),
            ids AS (SELECT ?2 AS app_user_id UNION SELECT a.app_user_id FROM customer_alias a WHERE a.customer_id = (SELECT id FROM me))
       SELECT (SELECT id FROM me) AS customer_id, (SELECT first_seen FROM me) AS first_seen,
              (SELECT e.variant FROM experiment_enrollment e WHERE e.experiment_id = ?3 AND e.app_user_id IN (SELECT app_user_id FROM ids)
               ORDER BY e.enrolled_at LIMIT 1) AS variant`,
    )
    .bind(projectId, appUserId, exp.id)
    .first<{ customer_id: string | null; first_seen: number | null; variant: string | null }>();
  const enrolled = row?.variant ? variants.find((v) => v.id === row.variant) : undefined;
  if (enrolled) return { experimentId: exp.id, variant: enrolled, write: null };
  if (row?.customer_id && row.first_seen !== null && row.first_seen < exp.started_at!) return null;
  const variant = pickVariant(exp.id, row?.customer_id ?? appUserId, variants);
  const write = db
    .prepare("INSERT INTO experiment_enrollment (experiment_id, app_user_id, variant, enrolled_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING")
    .bind(exp.id, appUserId, variant.id, now);
  return { experimentId: exp.id, variant, write };
}

/** A customer's experiments, for webhooks and the dashboard: RevenueCat's `experiments` entries, plus the name. */
export function customerExperimentsQuery(db: D1Database, customerIdsJson: string, projectCustomerId: string) {
  return db
    .prepare(
      `SELECT e.experiment_id, e.variant AS experiment_variant, min(e.enrolled_at) AS enrolled_at_ms, x.name AS experiment_name
       FROM experiment_enrollment e JOIN experiment x ON x.id = e.experiment_id
       WHERE e.app_user_id IN (SELECT app_user_id FROM customer_alias WHERE customer_id IN (SELECT value FROM json_each(?1)))
         AND x.project_id = (SELECT project_id FROM customer WHERE id = ?2)
       GROUP BY e.experiment_id ORDER BY enrolled_at_ms`,
    )
    .bind(customerIdsJson, projectCustomerId);
}

export interface CustomerExperiment {
  experiment_id: string;
  experiment_variant: string;
  enrolled_at_ms: number;
  /** For the dashboard; webhooks send only RevenueCat's three fields. */
  experiment_name?: string;
}
