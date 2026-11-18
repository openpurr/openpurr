// The scheduled job: one Cron Trigger every 5 minutes (free accounts get 5 triggers; we use one).
// Each task does a bounded amount of work per run, and the heavy lifting happens inside D1
// (DELETE ... WHERE ... LIMIT), so a run stays within the free plan's CPU and query limits even
// with a backlog: the backlog just clears over several runs.
//
// Hourly tasks (storage, so the database stays under the free plan's 500 MB):
//   - drop raw notification payloads after 30 days (the summary row stays);
//   - delete spike request captures after 14 days;
//   - delete customers who never purchased, were first seen over 90 days ago and haven't
//     logged in or synced attributes since. Nothing is lost that matters: they own no
//     purchases, and the SDK recreates them (and re-syncs attributes) when needed;
//   - forget verified Apple certificate chains that have expired.
// The 5-minute cadence is for work that can't wait an hour, such as webhook retries (M3).

import type { Env } from "./env";

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
       AND NOT EXISTS (SELECT 1 FROM customer_alias a WHERE a.customer_id = c.id AND a.created_at >= ?1)
       AND NOT EXISTS (SELECT 1 FROM subscriber_attribute s WHERE s.customer_id = c.id AND s.received_at >= ?1)
     LIMIT ${BATCH.customers}`,
  )
    .bind(cutoff)
    .all<{ id: string }>();
  if (!results.length) return { task: "prune-inactive-customers", rows: 0 };
  const ids = JSON.stringify(results.map((r) => r.id));
  await env.DB.batch([
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

export const HOURLY_TASKS: Task[] = [pruneNotificationPayloads, pruneCaptures, pruneInactiveCustomers, pruneExpiredChains];

/** Runs the tasks due at `scheduledTime`. Hourly tasks run in the first 5-minute slot of each hour. */
export async function runScheduled(env: Env, scheduledTime: number, opts: { all?: boolean } = {}): Promise<TaskResult[]> {
  const due: Task[] = [];
  if (opts.all || new Date(scheduledTime).getUTCMinutes() < 5) due.push(...HOURLY_TASKS);

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
export function scheduledHandler(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
  ctx.waitUntil(runScheduled(env, controller.scheduledTime));
}
