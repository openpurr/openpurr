// Precomputed CustomerInfo (customer_snapshot, migration 0007), so GET /v1/subscribers/{id} is
// one D1 query.
//
// Consistency rule: every write that changes what a customer's CustomerInfo shows bumps their
// ledger version IN THE SAME BATCH (invalidate*, migration 0021), and the snapshot is rebuilt
// afterwards (refreshSnapshot). A snapshot counts only while its ledger version is the customer's
// current one, and a rebuild saves only if the version it read is still current, so a write that
// lands between a rebuild's read and its save makes the save a no-op. If the rebuild fails or
// hasn't happened yet, there's simply no current snapshot and reads compute from the ledger
// without writing (free-plan rule: no writes on reads). So the worst case is a little extra CPU,
// never stale data. A snapshot built from an older config is treated as missing: each project
// has its own config version, so a change to one project only rebuilds that project's snapshots.
//
// Invalidating is one row write (the customer row; no index covers ledger_version). The old
// snapshot row stays and is overwritten in place by the rebuild.
//
// Why not also the Workers Cache API: its contents stay in one data center and cache.delete only
// purges that one, so after a purchase another data center could keep serving the old
// CustomerInfo, and the SDK would overwrite the device's fresh copy with it.

import type { Config, ProjectConfig, Store } from "./config";
import { computeSnapshot, renderCustomerInfo, type Snapshot } from "./customer-info";
import { type Customer, loadCustomer, loadCustomerById } from "./ledger";

async function etagOf(body: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
  return `"${Array.from(digest.subarray(0, 12), (b) => b.toString(16).padStart(2, "0")).join("")}"`;
}

/** Makes a customer's snapshot outdated; put it in the same batch as the change. */
export function invalidateSnapshot(db: D1Database, customerId: string) {
  return db.prepare("UPDATE customer SET ledger_version = ledger_version + 1 WHERE id = ?").bind(customerId);
}

/** Makes the snapshot of whoever owns a purchase chain outdated (no lookup needed). */
export function invalidateOwnerSnapshot(db: D1Database, store: Store, originalTransactionId: string) {
  return db
    .prepare(
      `UPDATE customer SET ledger_version = ledger_version + 1 WHERE id =
         (SELECT customer_id FROM purchase_owner WHERE store = ? AND original_transaction_id = ?)`,
    )
    .bind(store, originalTransactionId);
}

/**
 * Rebuilds and stores a customer's snapshot, with their project's config. Returns it, or null if
 * the customer (or their project) is gone.
 */
export async function refreshSnapshot(db: D1Database, all: Config, customerId: string): Promise<{ snapshot: Snapshot; etag: string; project: ProjectConfig } | null> {
  const { customer, ledgerVersion, transactions, states, grants } = await loadCustomerById(db, customerId);
  const config = customer ? all.projects.get(customer.projectId) : undefined;
  if (!customer || !config) return null;
  const snapshot = computeSnapshot({ appUserId: customer.appUserId, customer, transactions, states, grants, config });
  const body = JSON.stringify(snapshot);
  const etag = await etagOf(body);
  // Saved only if no write has bumped the ledger version since we read it (one statement, so atomic).
  await db
    .prepare(
      `INSERT INTO customer_snapshot (customer_id, body, etag, config_version, updated_at, ledger_version)
       SELECT id, ?, ?, ?, ?, ledger_version FROM customer WHERE id = ? AND ledger_version = ?
       ON CONFLICT (customer_id) DO UPDATE SET body = excluded.body, etag = excluded.etag,
         config_version = excluded.config_version, updated_at = excluded.updated_at, ledger_version = excluded.ledger_version`,
    )
    .bind(body, etag, config.version, Date.now(), customerId, ledgerVersion)
    .run();
  return { snapshot, etag, project: config };
}

/**
 * CustomerInfo for an app user ID of a project. One query when the snapshot is current; otherwise
 * computed from the ledger (one more round trip), never written.
 */
export async function readCustomerInfo(
  db: D1Database,
  config: ProjectConfig,
  appUserId: string,
  opts: { requestStore?: "app_store" | "play_store"; now?: number } = {},
) {
  const row = await db
    .prepare(
      `SELECT c.id, c.app_user_id, c.first_seen, s.body, s.etag, s.config_version
       FROM customer_alias a JOIN customer c ON c.id = a.customer_id
       LEFT JOIN customer_snapshot s ON s.customer_id = c.id AND s.ledger_version = c.ledger_version
       WHERE a.project_id = ? AND a.app_user_id = ?`,
    )
    .bind(config.id, appUserId)
    .first<{ id: string; app_user_id: string; first_seen: number; body: string | null; etag: string | null; config_version: string | null }>();

  if (row?.body && row.config_version === config.version) {
    return { body: renderCustomerInfo(JSON.parse(row.body) as Snapshot, config, opts), etag: row.etag, customerId: row.id, source: "snapshot" as const };
  }
  if (!row) {
    // Unknown user: an empty CustomerInfo, nothing to load.
    const customer: Customer | null = null;
    const snapshot = computeSnapshot({ appUserId, customer, transactions: [], config, now: opts.now });
    return { body: renderCustomerInfo(snapshot, config, opts), etag: null, customerId: null, source: "empty" as const };
  }
  const { customer, transactions, states, grants } = await loadCustomer(db, config.id, appUserId);
  const snapshot = computeSnapshot({ appUserId, customer, transactions, states, grants, config });
  return { body: renderCustomerInfo(snapshot, config, opts), etag: null, customerId: row.id, source: "computed" as const };
}
