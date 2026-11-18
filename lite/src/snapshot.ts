// Precomputed CustomerInfo (customer_snapshot, migration 0007), so GET /v1/subscribers/{id} is
// one D1 query.
//
// Consistency rule: every write that changes what a customer's CustomerInfo shows deletes their
// snapshot IN THE SAME BATCH (invalidate*), and the snapshot is rebuilt afterwards
// (refreshSnapshot). If the rebuild fails or hasn't happened yet, there's simply no snapshot and
// reads compute from the ledger without writing (free-plan rule: no writes on reads). So the
// worst case is a little extra CPU, never stale data. A snapshot built from an older config is
// treated as missing.
//
// Why not also the Workers Cache API: its contents stay in one data center and cache.delete only
// purges that one, so after a purchase another data center could keep serving the old
// CustomerInfo, and the SDK would overwrite the device's fresh copy with it.

import type { Config, Store } from "./config";
import { computeSnapshot, renderCustomerInfo, type Snapshot } from "./customer-info";
import { type Customer, loadCustomer, loadCustomerById } from "./ledger";

async function etagOf(body: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
  return `"${Array.from(digest.subarray(0, 12), (b) => b.toString(16).padStart(2, "0")).join("")}"`;
}

/** Deletes a customer's snapshot; put it in the same batch as the change. */
export function invalidateSnapshot(db: D1Database, customerId: string) {
  return db.prepare("DELETE FROM customer_snapshot WHERE customer_id = ?").bind(customerId);
}

/** Deletes the snapshot of whoever owns a purchase chain (no lookup needed). */
export function invalidateOwnerSnapshot(db: D1Database, store: Store, originalTransactionId: string) {
  return db
    .prepare(
      `DELETE FROM customer_snapshot WHERE customer_id =
         (SELECT customer_id FROM purchase_owner WHERE store = ? AND original_transaction_id = ?)`,
    )
    .bind(store, originalTransactionId);
}

/** Rebuilds and stores a customer's snapshot. Returns it, or null if the customer is gone. */
export async function refreshSnapshot(db: D1Database, config: Config, customerId: string): Promise<{ snapshot: Snapshot; etag: string } | null> {
  const { customer, transactions, states } = await loadCustomerById(db, customerId);
  if (!customer) return null;
  const snapshot = computeSnapshot({ appUserId: customer.appUserId, customer, transactions, states, config });
  const body = JSON.stringify(snapshot);
  const etag = await etagOf(body);
  await db
    .prepare(
      `INSERT INTO customer_snapshot (customer_id, body, etag, config_version, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (customer_id) DO UPDATE SET body = excluded.body, etag = excluded.etag,
         config_version = excluded.config_version, updated_at = excluded.updated_at`,
    )
    .bind(customerId, body, etag, config.version, Date.now())
    .run();
  return { snapshot, etag };
}

/**
 * CustomerInfo for an app user ID. One query when the snapshot is current; otherwise computed
 * from the ledger (one more round trip), never written.
 */
export async function readCustomerInfo(
  db: D1Database,
  config: Config,
  appUserId: string,
  opts: { requestStore?: "app_store" | "play_store"; now?: number } = {},
) {
  const row = await db
    .prepare(
      `SELECT c.id, c.app_user_id, c.first_seen, s.body, s.etag, s.config_version
       FROM customer_alias a JOIN customer c ON c.id = a.customer_id
       LEFT JOIN customer_snapshot s ON s.customer_id = c.id
       WHERE a.app_user_id = ?`,
    )
    .bind(appUserId)
    .first<{ id: string; app_user_id: string; first_seen: number; body: string | null; etag: string | null; config_version: string | null }>();

  if (row?.body && row.config_version === config.version) {
    return { body: renderCustomerInfo(JSON.parse(row.body) as Snapshot, config, opts), etag: row.etag, source: "snapshot" as const };
  }
  if (!row) {
    // Unknown user: an empty CustomerInfo, nothing to load.
    const customer: Customer | null = null;
    const snapshot = computeSnapshot({ appUserId, customer, transactions: [], config, now: opts.now });
    return { body: renderCustomerInfo(snapshot, config, opts), etag: null, source: "empty" as const };
  }
  const { customer, transactions, states } = await loadCustomer(db, appUserId);
  const snapshot = computeSnapshot({ appUserId, customer, transactions, states, config });
  return { body: renderCustomerInfo(snapshot, config, opts), etag: null, source: "computed" as const };
}
