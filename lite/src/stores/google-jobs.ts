// Scheduled Google Play work (hourly, from src/scheduled.ts):
//   - retry acknowledgements that failed (Google refunds purchases unacknowledged after 3 days);
//   - poll the voided purchases API, a backstop for refunds and chargebacks whose notification
//     was missed. Bounded per run; a per-app checkpoint in job_state means a backlog clears over
//     several runs.
// Each app is handled on its own: one whose key is missing or whose API calls fail is logged and
// skipped, and the other apps' work goes ahead.

import type { AppConfig, Config } from "../config";
import type { Deps, Env } from "../env";
import type { TransactionRow } from "../ledger";
import { invalidateSnapshot, refreshSnapshot } from "../snapshot";
import { deliverNow, enqueueEvent, loadEventCustomer } from "../webhooks";
import { googleRefundEvent } from "./google-events";
import { acknowledge, googleClientFor } from "./google-sync";

const DAY = 864e5;
export const ACKS_PER_RUN = 10;
export const VOIDED_PER_RUN = 20;

export async function retryPlayAcknowledgements(env: Env, deps: Deps, config: Config, now: number) {
  const db = env.DB;
  // Too late to matter: Google has refunded these already.
  const { meta: dropped } = await db.prepare("DELETE FROM play_ack_pending WHERE created_at < ?").bind(now - 3 * DAY).run();
  if (dropped.changes) console.error(`Dropped ${dropped.changes} Play acknowledgements older than 3 days (Google refunds those).`);
  const { results } = await db
    .prepare(`SELECT purchase_token, app_id, product_id, kind FROM play_ack_pending ORDER BY created_at LIMIT ${ACKS_PER_RUN}`)
    .all<{ purchase_token: string; app_id: string; product_id: string; kind: "subscription" | "product" }>();
  let done = 0;
  for (const r of results) {
    const app = config.apps.get(r.app_id);
    if (!app?.googlePlayApi) continue;
    let client;
    try {
      client = googleClientFor(app, env, deps);
    } catch (err) {
      // Kept for a later run, once the key is fixed.
      console.error(`Can't retry Play acknowledgements for app ${app.id}:`, err);
      await db.prepare("UPDATE play_ack_pending SET last_error = ? WHERE purchase_token = ?").bind(String(err).slice(0, 500), r.purchase_token).run();
      continue;
    }
    const ok = await acknowledge(db, client, app.id, { kind: r.kind, productId: r.product_id, purchaseToken: r.purchase_token });
    if (ok) done++;
  }
  return done;
}

export async function pollVoidedPurchases(env: Env, deps: Deps, config: Config, now: number) {
  let processed = 0;
  for (const app of config.apps.values()) {
    if (app.store !== "play_store" || !app.googlePlayApi) continue;
    try {
      processed += await pollApp(env, deps, config, app, now);
    } catch (err) {
      // The checkpoint stays where it was, so the next run tries this app again.
      console.error(`Polling voided purchases failed for app ${app.id}:`, err);
    }
  }
  return processed;
}

/** One app's voided purchases; returns how many orders it marked refunded. */
async function pollApp(env: Env, deps: Deps, config: Config, app: AppConfig, now: number) {
  const db = env.DB;
  let processed = 0;
  const project = config.projects.get(app.projectId)!;
  const key = `play_voided_checkpoint:${app.id}`;
  const checkpoint = await db.prepare("SELECT value FROM job_state WHERE key = ?").bind(key).first<{ value: string }>();
  // The API looks back at most 30 days.
  const since = Math.max(Number(checkpoint?.value ?? 0), now - 30 * DAY);
  const client = googleClientFor(app, env, deps);
  const { voidedPurchases = [] } = await client.voided(since);
  const batch = voidedPurchases
    .map((v) => ({ ...v, at: Number(v.voidedTimeMillis ?? now) }))
    .sort((a, b) => a.at - b.at)
    .slice(0, VOIDED_PER_RUN);

  const writes: D1PreparedStatement[] = [];
  const eventIds: string[] = [];
  const owners = new Set<string>();
  for (const v of batch) {
    const tx = await db
      .prepare(
        `SELECT t.*, o.customer_id FROM store_transaction t
         LEFT JOIN purchase_owner o ON o.store = t.store AND o.original_transaction_id = t.original_transaction_id
         WHERE t.store = 'play_store' AND t.transaction_id = ? AND t.revoked_at IS NULL`,
      )
      .bind(v.orderId)
      .first<TransactionRow & { customer_id: string | null }>();
    if (!tx) continue; // unknown order, or already marked refunded (for example by its notification)
    writes.push(
      db
        .prepare("UPDATE store_transaction SET revoked_at = ?, revocation_reason = 'voided', updated_at = ? WHERE store = 'play_store' AND transaction_id = ?")
        .bind(v.at, now, v.orderId),
    );
    if (tx.customer_id) {
      owners.add(tx.customer_id);
      const refunded = { ...tx, revoked_at: v.at } as TransactionRow;
      const event = googleRefundEvent(refunded);
      const customer = await loadEventCustomer(db, [tx.customer_id], tx.customer_id);
      const { id, statements } = await enqueueEvent(db, project, { ...event, appId: app.id, environment: tx.environment, store: "play_store", customer, transaction: refunded, now });
      eventIds.push(id);
      writes.push(...statements);
    }
    processed++;
  }
  for (const id of owners) writes.push(invalidateSnapshot(db, id));
  // Advance past what this run handled; the rest waits for the next run.
  const reached = batch.length === voidedPurchases.length ? now : (batch.at(-1)?.at ?? since);
  writes.push(
    db
      .prepare("INSERT INTO job_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .bind(key, String(reached), now),
  );
  await db.batch(writes);
  if (eventIds.length) await deliverNow(env, config, deps.fetch ?? fetch, eventIds, now);
  for (const id of owners) await refreshSnapshot(db, config, id);
  return processed;
}

