// Data access for the purchase ledger (migrations/0003_ledger.sql).
//
// Reads never write (free-plan rule 2). Writes are batched so each request makes as few D1
// round trips as possible.

import type { ProductType, Store } from "./config";

export interface Customer {
  id: string;
  /** original_app_user_id */
  appUserId: string;
  firstSeen: number;
}

export interface TransactionRow {
  app_id: string;
  store: Store;
  environment: "production" | "sandbox";
  transaction_id: string;
  original_transaction_id: string;
  product_id: string;
  base_plan_id: string | null;
  product_type: ProductType;
  purchased_at: number;
  original_purchased_at: number;
  expires_at: number | null;
  period_type: "normal" | "trial" | "intro";
  ownership_type: "PURCHASED" | "FAMILY_SHARED";
  price_micros: number | null;
  currency: string | null;
  storefront: string | null;
  revoked_at: number | null;
  revocation_reason: string | null;
  is_upgraded: number;
  verified: number;
}

export type NewTransaction = TransactionRow & { source: "sdk" | "notification" | "store_api" };

const TX_COLUMNS = `t.app_id, t.store, t.environment, t.transaction_id, t.original_transaction_id, t.product_id,
  t.base_plan_id, t.product_type, t.purchased_at, t.original_purchased_at, t.expires_at, t.period_type,
  t.ownership_type, t.price_micros, t.currency, t.storefront, t.revoked_at, t.revocation_reason, t.is_upgraded,
  t.verified`;

interface CustomerRecord {
  id: string;
  app_user_id: string;
  first_seen: number;
}

const toCustomer = (r: CustomerRecord): Customer => ({ id: r.id, appUserId: r.app_user_id, firstSeen: r.first_seen });

export function isAnonymous(appUserId: string) {
  return appUserId.startsWith("$RCAnonymousID:");
}

/** The customer an app user ID belongs to, plus every transaction they own. One D1 round trip. */
export async function loadCustomer(db: D1Database, appUserId: string) {
  const [customer, transactions] = await db.batch([
    db
      .prepare(
        `SELECT c.id, c.app_user_id, c.first_seen FROM customer_alias a JOIN customer c ON c.id = a.customer_id
         WHERE a.app_user_id = ?`,
      )
      .bind(appUserId),
    db
      .prepare(
        `SELECT ${TX_COLUMNS} FROM customer_alias a
         JOIN purchase_owner o ON o.customer_id = a.customer_id
         JOIN store_transaction t ON t.store = o.store AND t.original_transaction_id = o.original_transaction_id
         WHERE a.app_user_id = ?`,
      )
      .bind(appUserId),
  ]);
  const row = customer!.results[0] as CustomerRecord | undefined;
  return {
    customer: row ? toCustomer(row) : null,
    transactions: transactions!.results as unknown as TransactionRow[],
  };
}

export async function findCustomer(db: D1Database, appUserId: string): Promise<Customer | null> {
  const row = await db
    .prepare(
      `SELECT c.id, c.app_user_id, c.first_seen FROM customer_alias a JOIN customer c ON c.id = a.customer_id
       WHERE a.app_user_id = ?`,
    )
    .bind(appUserId)
    .first<CustomerRecord>();
  return row ? toCustomer(row) : null;
}

/** Finds or creates the customer for an app user ID. Write path only. */
export async function ensureCustomer(db: D1Database, appUserId: string, now = Date.now()): Promise<Customer> {
  const existing = await findCustomer(db, appUserId);
  if (existing) return existing;
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO customer (id, app_user_id, first_seen) VALUES (?, ?, ?)").bind(id, appUserId, now),
    db
      .prepare("INSERT INTO customer_alias (app_user_id, customer_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")
      .bind(appUserId, id, now),
  ]);
  // If a concurrent request created the alias first, ours was ignored; resolve again to agree.
  return (await findCustomer(db, appUserId))!;
}

/** Adds another app user ID to an existing customer. */
export function addAlias(db: D1Database, appUserId: string, customerId: string, now = Date.now()) {
  return db
    .prepare("INSERT INTO customer_alias (app_user_id, customer_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")
    .bind(appUserId, customerId, now);
}

/**
 * Folds one customer into another: every alias and every owned purchase moves to `into`.
 * Used when an anonymous user logs in to an existing account, or restores a purchase that an
 * anonymous user owns.
 */
export function mergeCustomers(db: D1Database, from: string, into: string) {
  return [
    db.prepare("UPDATE customer_alias SET customer_id = ? WHERE customer_id = ?").bind(into, from),
    db.prepare("UPDATE purchase_owner SET customer_id = ? WHERE customer_id = ?").bind(into, from),
    db.prepare("DELETE FROM customer WHERE id = ?").bind(from),
  ];
}

/** The customer that currently owns a purchase chain, if any. */
export async function purchaseOwner(db: D1Database, store: Store, originalTransactionId: string) {
  const row = await db
    .prepare(
      `SELECT c.id, c.app_user_id, c.first_seen,
              (SELECT count(*) FROM customer_alias a WHERE a.customer_id = c.id AND a.app_user_id NOT LIKE '$RCAnonymousID:%') AS named
       FROM purchase_owner o JOIN customer c ON c.id = o.customer_id
       WHERE o.store = ? AND o.original_transaction_id = ?`,
    )
    .bind(store, originalTransactionId)
    .first<CustomerRecord & { named: number }>();
  return row ? { ...toCustomer(row), anonymousOnly: row.named === 0 } : null;
}

/**
 * Upserts a transaction and assigns its chain to `customerId`. The store's latest facts win
 * (expiry, refund, upgrade); identity columns never change.
 */
export function recordTransaction(db: D1Database, tx: NewTransaction, customerId: string, now = Date.now()) {
  return [
    db
      .prepare(
        `INSERT INTO store_transaction (app_id, store, environment, transaction_id, original_transaction_id, product_id,
           base_plan_id, product_type, purchased_at, original_purchased_at, expires_at, period_type, ownership_type,
           price_micros, currency, storefront, revoked_at, revocation_reason, is_upgraded, verified, source,
           received_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (store, transaction_id) DO UPDATE SET
           expires_at = excluded.expires_at,
           revoked_at = excluded.revoked_at,
           revocation_reason = excluded.revocation_reason,
           is_upgraded = excluded.is_upgraded,
           ownership_type = excluded.ownership_type,
           verified = max(verified, excluded.verified),
           updated_at = excluded.updated_at`,
      )
      .bind(
        tx.app_id,
        tx.store,
        tx.environment,
        tx.transaction_id,
        tx.original_transaction_id,
        tx.product_id,
        tx.base_plan_id,
        tx.product_type,
        tx.purchased_at,
        tx.original_purchased_at,
        tx.expires_at,
        tx.period_type,
        tx.ownership_type,
        tx.price_micros,
        tx.currency,
        tx.storefront,
        tx.revoked_at,
        tx.revocation_reason,
        tx.is_upgraded,
        tx.verified,
        tx.source,
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO purchase_owner (store, original_transaction_id, customer_id, app_id, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (store, original_transaction_id) DO UPDATE SET customer_id = excluded.customer_id,
           updated_at = excluded.updated_at`,
      )
      .bind(tx.store, tx.original_transaction_id, customerId, tx.app_id, now),
  ];
}
