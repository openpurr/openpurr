// The scheduled job: one Cron Trigger every 5 minutes (free accounts get 5 triggers; we use one).
// Each task does a bounded amount of work per run, and the heavy lifting happens inside D1
// (DELETE ... WHERE ... LIMIT), so a run stays within the free plan's CPU and query limits even
// with a backlog: the backlog just clears over several runs.
//
// Hourly tasks (storage, so the database stays under the free plan's 500 MB):
//   - drop raw notification payloads after 30 days (the summary row stays);
//   - delete spike request captures after 14 days;
//   - delete customers who never purchased (or got a grant), were first seen over 90 days ago and haven't
//     logged in or synced attributes since. Nothing is lost that matters: they own no
//     purchases, and the SDK recreates them (and re-syncs attributes) when needed;
//   - forget verified Apple certificate chains that have expired;
//   - fetch exchange rates once a day's are published (src/fx.ts);
//   - Google Play: retry failed acknowledgements, and poll voided purchases for missed refunds;
//   - update the chart totals from the ledger (src/metrics.ts), last, after the exchange rates.
// Every run (5 minutes): retry webhook deliveries that are due, build CustomerInfo snapshots
// for customers that lack one (created before snapshots existed, or built from an older config),
// and, every 15 minutes, fetch today's free-plan usage (src/office/usage.ts).

import type { Config } from "./config";
import { currentConfig, type Deps, type Env } from "./env";
import { ecbProvider, refreshRates } from "./fx";
import { rollupMetrics } from "./metrics";
import { pruneOAuth } from "./office/oauth";
import { refreshUsage } from "./office/usage";
import { refreshSnapshot } from "./snapshot";
import { pollVoidedPurchases, retryPlayAcknowledgements } from "./stores/google-jobs";
import { retryDueDeliveries } from "./webhooks";

/** Snapshots built per run. Each costs about 4 D1 queries; the free plan allows 50 per run. */
export const SNAPSHOTS_PER_RUN = 8;

export const RETENTION = {
  notificationPayloadDays: 30,
  captureDays: 14,
  inactiveCustomerDays: 90,
} as const;

/** Rows each task touches per run, at most. */
const BATCH = { payloads: 500, captures: 1000, customers: 200 } as const;
const DAY = 864e5;

export interface TaskResult {
  task: string;
  rows: number;
}

type Task = (env: Env, now: number) => Promise<TaskResult>;

const pruneNotificationPayloads: Task = async (env, now) => {
  const { meta } = await env.DB.prepare(
    `UPDATE store_notification SET payload = NULL WHERE rowid IN (
       SELECT rowid FROM store_notification WHERE payload IS NOT NULL AND received_at < ? LIMIT ${BATCH.payloads})`,
  )
    .bind(now - RETENTION.notificationPayloadDays * DAY)
    .run();
  return { task: "prune-notification-payloads", rows: meta.changes };
};

const pruneCaptures: Task = async (env, now) => {
  const { meta } = await env.DB.prepare(
    `DELETE FROM capture WHERE id IN (SELECT id FROM capture WHERE ts < ? ORDER BY id LIMIT ${BATCH.captures})`,
  )
    .bind(new Date(now - RETENTION.captureDays * DAY).toISOString())
    .run();
  return { task: "prune-captures", rows: meta.changes };
};

const pruneInactiveCustomers: Task = async (env, now) => {
  const cutoff = now - RETENTION.inactiveCustomerDays * DAY;
  const { results } = await env.DB.prepare(
    `SELECT c.id FROM customer c
     WHERE c.first_seen < ?1
       AND NOT EXISTS (SELECT 1 FROM purchase_owner o WHERE o.customer_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM promotional_grant g WHERE g.customer_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM customer_alias a WHERE a.customer_id = c.id AND a.created_at >= ?1)
       AND NOT EXISTS (SELECT 1 FROM subscriber_attribute s WHERE s.customer_id = c.id AND s.received_at >= ?1)
     LIMIT ${BATCH.customers}`,
  )
    .bind(cutoff)
    .all<{ id: string }>();
  if (!results.length) return { task: "prune-inactive-customers", rows: 0 };
  const ids = JSON.stringify(results.map((r) => r.id));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM customer_snapshot WHERE customer_id IN (SELECT value FROM json_each(?))").bind(ids),
    env.DB.prepare("DELETE FROM subscriber_attribute WHERE customer_id IN (SELECT value FROM json_each(?))").bind(ids),
    env.DB.prepare("DELETE FROM customer_alias WHERE customer_id IN (SELECT value FROM json_each(?))").bind(ids),
    env.DB.prepare("DELETE FROM customer WHERE id IN (SELECT value FROM json_each(?))").bind(ids),
  ]);
  return { task: "prune-inactive-customers", rows: results.length };
};

const pruneExpiredChains: Task = async (env, now) => {
  const { meta } = await env.DB.prepare("DELETE FROM apple_verified_chain WHERE not_after < ?").bind(now).run();
  return { task: "prune-expired-apple-chains", rows: meta.changes };
};

const pruneOAuthState: Task = async (env, now) => ({ task: "prune-oauth", rows: await pruneOAuth(env.DB, now) });

export const HOURLY_TASKS: Task[] = [pruneNotificationPayloads, pruneCaptures, pruneInactiveCustomers, pruneExpiredChains, pruneOAuthState];

const chartTotals: Task = async (env, now) => ({ task: "rollup-metrics", rows: (await rollupMetrics(env.DB, now)).rows });

function webhookRetries(deps: Deps, config: Config): Task {
  const anyWebhooks = [...config.projects.values()].some((p) => p.webhooks.length);
  return async (env, now) => ({
    task: "retry-webhooks",
    rows: anyWebhooks ? await retryDueDeliveries(env, config, deps.fetch ?? fetch, now) : 0,
  });
}

function snapshotBackfill(config: Config): Task {
  return async (env) => {
    // Each customer's snapshot must match their own project's config version.
    const versions = JSON.stringify(Object.fromEntries([...config.projects].map(([id, p]) => [id, p.version])));
    const { results } = await env.DB.prepare(
      `SELECT c.id FROM customer c LEFT JOIN customer_snapshot s ON s.customer_id = c.id AND s.ledger_version = c.ledger_version
       WHERE c.project_id IN (SELECT key FROM json_each(?1))
         AND (s.customer_id IS NULL OR s.config_version IS NOT (SELECT value FROM json_each(?1) WHERE key = c.project_id))
       LIMIT ${SNAPSHOTS_PER_RUN}`,
    )
      .bind(versions)
      .all<{ id: string }>();
    for (const { id } of results) await refreshSnapshot(env.DB, config, id);
    return { task: "backfill-snapshots", rows: results.length };
  };
}

function usage(deps: Deps): Task {
  return async (env, now) => ({ task: "refresh-usage", rows: (await refreshUsage(env, deps.fetch ?? fetch, now)) ? 1 : 0 });
}

function playAcks(deps: Deps, config: Config): Task {
  return async (env, now) => ({ task: "retry-play-acknowledgements", rows: await retryPlayAcknowledgements(env, deps, config, now) });
}

function playVoided(deps: Deps, config: Config): Task {
  return async (env, now) => ({ task: "poll-play-voided-purchases", rows: await pollVoidedPurchases(env, deps, config, now) });
}

function exchangeRates(deps: Deps): Task {
  return async (env, now) => ({ task: "refresh-exchange-rates", rows: await refreshRates(env, deps.fetch ?? fetch, now, deps.fx ?? ecbProvider) });
}

/** Runs the tasks due at `scheduledTime`. Hourly tasks run in the first 5-minute slot of each hour. */
export async function runScheduled(
  env: Env,
  scheduledTime: number,
  opts: { all?: boolean; deps?: Deps } = {},
): Promise<TaskResult[]> {
  const due: Task[] = [];
  const config = opts.deps ? await currentConfig(opts.deps, env.DB) : null;
  if (opts.deps && config) due.push(webhookRetries(opts.deps, config), snapshotBackfill(config), usage(opts.deps));
  if (opts.all || new Date(scheduledTime).getUTCMinutes() < 5) {
    due.push(...HOURLY_TASKS);
    if (opts.deps && config) due.push(exchangeRates(opts.deps), playAcks(opts.deps, config), playVoided(opts.deps, config));
    due.push(chartTotals);
  }

  const results: TaskResult[] = [];
  for (const task of due) {
    // One failing task shouldn't stop the others; the next run tries again.
    try {
      results.push(await task(env, scheduledTime));
    } catch (err) {
      console.error(`Scheduled task failed:`, err);
    }
  }
  if (results.some((r) => r.rows > 0)) console.log(JSON.stringify({ scheduled: results }));
  return results;
}

/** The Worker's scheduled handler. */
export function scheduledHandler(deps: Deps) {
  return (controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(runScheduled(env, controller.scheduledTime, { deps }));
  };
}
