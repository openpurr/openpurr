// Finding a project's customers: the newest first, or a search by app user ID prefix, email or
// store transaction ID. Used by the admin API (the dashboard's Customers page) and the MCP server.

// The customer list: newest first, or a search. Every query reads through an index and stops at the
// page size, because D1's free plan counts rows read per day. D1 also allows at most 100 bound
// parameters per query, which caps the page size (IDs are bound in IN lists below).
export const CUSTOMER_PAGE_MAX = 50;
const MAX_STRING = "\u{10FFFF}"; // sorts after any app user ID that starts with the prefix

interface CustomerRow {
  id: string;
  app_user_id: string;
  first_seen: number;
}

export class BadInput extends Error {}

export interface CustomerList {
  customers: {
    id: string;
    app_user_id: string;
    email: string | null;
    first_seen: number;
    purchases: number;
    last_purchase_at: number | null;
    last_product: string | null;
    active: boolean;
    stores: string[];
  }[];
  next_before: string | null;
}

export async function searchCustomers(
  db: D1Database,
  projectId: string,
  apps: string[] | null,
  opts: { q?: string; purchasesOnly?: boolean; limit?: number; before?: string | null } = {},
): Promise<CustomerList> {
  const q = (opts.q ?? "").trim();
  if (q.length > 256) throw new BadInput("q is too long.");
  const limit = Math.min(Math.max(Math.floor(Number(opts.limit ?? CUSTOMER_PAGE_MAX)) || CUSTOMER_PAGE_MAX, 1), CUSTOMER_PAGE_MAX);
  if (apps && !apps.length) return { customers: [], next_before: null };

  // Operators limited to some apps see only customers with purchases in those apps. Customers
  // without purchases aren't tied to an app, so only all-apps operators see them.
  const appList = apps ? apps.map(() => "?").join(", ") : "";
  const owned =
    apps || opts.purchasesOnly
      ? `EXISTS (SELECT 1 FROM purchase_owner o WHERE o.customer_id = c.id${apps ? ` AND o.app_id IN (${appList})` : ""})`
      : "1";
  const ownedBinds = apps ?? [];

  let rows: CustomerRow[];
  let nextBefore: string | null = null;
  if (q) {
    // An app user ID prefix (any alias), an exact email, or an exact store transaction ID.
    const lookups = [
      db
        .prepare("SELECT customer_id FROM customer_alias WHERE project_id = ? AND app_user_id >= ? AND app_user_id < ? ORDER BY app_user_id LIMIT ?")
        .bind(projectId, q, q + MAX_STRING, limit),
      db
        .prepare(
          `SELECT o.customer_id FROM store_transaction t JOIN purchase_owner o ON o.store = t.store AND o.original_transaction_id = t.original_transaction_id
           WHERE t.store IN ('app_store', 'play_store') AND t.transaction_id = ? LIMIT 1`,
        )
        .bind(q),
      db.prepare("SELECT customer_id FROM purchase_owner WHERE store IN ('app_store', 'play_store') AND original_transaction_id = ? LIMIT 1").bind(q),
    ];
    if (q.includes("@")) {
      lookups.push(db.prepare("SELECT customer_id FROM subscriber_attribute WHERE key = '$email' AND value = ? COLLATE NOCASE LIMIT ?").bind(q, limit));
    }
    const found = await db.batch<{ customer_id: string }>(lookups);
    const ids = [...new Set(found.flatMap((r) => r.results.map((x) => x.customer_id)))].slice(0, limit);
    if (!ids.length) return { customers: [], next_before: null };
    ({ results: rows } = await db
      .prepare(
        `SELECT c.id, c.app_user_id, c.first_seen FROM customer c
         WHERE c.id IN (${ids.map(() => "?").join(", ")}) AND c.project_id = ? AND ${owned} ORDER BY c.first_seen DESC, c.id DESC`,
      )
      .bind(...ids, projectId, ...ownedBinds)
      .all<CustomerRow>());
  } else {
    // Newest first. The cursor is "first_seen:id" of the last row on the previous page.
    const before = opts.before;
    let cursor: [number, string] | null = null;
    if (before) {
      const i = before.indexOf(":");
      const at = Number(before.slice(0, i));
      if (i < 1 || !Number.isFinite(at)) throw new BadInput("before must be the next_before value from the previous page.");
      cursor = [at, before.slice(i + 1)];
    }
    ({ results: rows } = await db
      .prepare(
        `SELECT c.id, c.app_user_id, c.first_seen FROM customer c
         WHERE c.project_id = ? AND ${cursor ? "(c.first_seen, c.id) < (?, ?)" : "1"} AND ${owned} ORDER BY c.first_seen DESC, c.id DESC LIMIT ?`,
      )
      .bind(projectId, ...(cursor ?? []), ...ownedBinds, limit)
      .all<CustomerRow>());
    if (rows.length === limit) nextBefore = `${rows.at(-1)!.first_seen}:${rows.at(-1)!.id}`;
  }
  if (!rows.length) return { customers: [], next_before: null };

  // One summary per customer: purchases (in the operator's apps), the latest one, and whether
  // anything is still active (an unexpired, unrefunded subscription or a non-consumable).
  const idList = rows.map(() => "?").join(", ");
  const ids = rows.map((r) => r.id);
  const now = Date.now();
  const [summaries, emails] = await db.batch([
    db
      .prepare(
        `SELECT o.customer_id, count(*) AS purchases, max(t.purchased_at) AS last_purchase_at,
           max(CASE WHEN t.revoked_at IS NULL AND t.product_type != 'consumable' AND (t.expires_at IS NULL OR t.expires_at > ?) THEN 1 ELSE 0 END) AS active,
           group_concat(DISTINCT t.store) AS stores,
           (SELECT t2.product_id FROM purchase_owner o2 JOIN store_transaction t2 ON t2.store = o2.store AND t2.original_transaction_id = o2.original_transaction_id
            WHERE o2.customer_id = o.customer_id${apps ? ` AND o2.app_id IN (${appList})` : ""} ORDER BY t2.purchased_at DESC LIMIT 1) AS last_product
         FROM purchase_owner o JOIN store_transaction t ON t.store = o.store AND t.original_transaction_id = o.original_transaction_id
         WHERE o.customer_id IN (${idList})${apps ? ` AND o.app_id IN (${appList})` : ""}
         GROUP BY o.customer_id`,
      )
      .bind(now, ...(apps ?? []), ...ids, ...(apps ?? [])),
    db.prepare(`SELECT customer_id, value FROM subscriber_attribute WHERE key = '$email' AND value IS NOT NULL AND customer_id IN (${idList})`).bind(...ids),
  ]);
  type Summary = { customer_id: string; purchases: number; last_purchase_at: number; active: number; stores: string; last_product: string };
  const byId = new Map(((summaries?.results ?? []) as Summary[]).map((s) => [s.customer_id, s]));
  const emailOf = new Map(((emails?.results ?? []) as { customer_id: string; value: string }[]).map((e) => [e.customer_id, e.value]));

  return {
    customers: rows.map((r) => {
      const s = byId.get(r.id);
      return {
        id: r.id,
        app_user_id: r.app_user_id,
        email: emailOf.get(r.id) ?? null,
        first_seen: r.first_seen,
        purchases: s?.purchases ?? 0,
        last_purchase_at: s?.last_purchase_at ?? null,
        last_product: s?.last_product ?? null,
        active: !!s?.active,
        stores: s?.stores ? s.stores.split(",") : [],
      };
    }),
    next_before: nextBefore,
  };
}

