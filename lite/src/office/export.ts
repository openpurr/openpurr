// The export API (/admin/v1/export): how `openpurr export` reads a deployment to move it to the
// Standard edition (or back), and how `openpurr migrate verify` compares two deployments. The
// bundle it makes is specified in spec/export-bundle.md; the tables and their delta filters come
// from spec/export-tables.json, which Standard reads too.
//
// Paged, not streamed: each request reads one page of one table (keyset order on the primary key),
// so a page costs about as many D1 row reads as it returns rows and stays well inside the free
// plan's CPU limit, and the CLI can resume. Owners only, and only those who see every app: the
// bundle holds every customer, key hash and operator.

import type { Context } from "hono";
import spec from "../../../spec/export-tables.json";
import type { ProjectConfig } from "../config";
import { computeSnapshot, renderCustomerInfo, type Snapshot } from "../customer-info";
import type { AppEnv } from "../env";
import { loadCustomerById } from "../ledger";
import type { Principal } from "./principal";

type Ctx = Context<AppEnv>;

export interface ExportTable {
  name: string;
  key: string[];
  delta: string | null;
  where?: string;
  customer_column?: string;
  optional?: string[];
}

export const EXPORT_FORMAT = "openpurr-export";
export const EXPORT_VERSION = spec.version;
export const EXPORT_TABLES = spec.tables as ExportTable[];
const TABLES = new Map(EXPORT_TABLES.map((t) => [t.name, t]));

const MAX_PAGE = 1000;
const MAX_IDS = 100;

const bad = (c: Ctx, message: string) => c.json({ code: "bad_request", message }, 400);

/** null when the caller may export, else the 403 answer. */
export function exportDenied(c: Ctx): Response | null {
  const p = c.get("principal") as Principal;
  if (p.operator.role !== "owner" || !p.permissions.has("settings:manage") || p.apps !== null) {
    return c.json({ code: "forbidden", message: "Only owners who see every app can export (with a token: the admin scope)." }, 403);
  }
  return null;
}

/**
 * GET /admin/v1/export: what this server exports, and its clock (the next delta's watermark).
 * POST does the same and records the start of an export in the audit log.
 */
export async function exportInfo(c: Ctx, audit?: (details: unknown) => D1PreparedStatement) {
  if (audit) {
    const b = ((await c.req.json().catch(() => null)) ?? {}) as { since?: unknown };
    await audit({ since: typeof b.since === "number" ? b.since : null }).run();
  }
  const migration = await c.env.DB.prepare("SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1")
    .first<{ name: string }>()
    .catch(() => null);
  return c.json({
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    edition: "lite",
    schema: migration?.name ?? null,
    now: Date.now(),
    // What the CLI needs to page each table and to make deltas.
    tables: EXPORT_TABLES.map((t) => ({ name: t.name, key: t.key, delta: t.delta !== null, customer_column: t.customer_column ?? null })),
  });
}

const columnCache = new Map<string, string[]>();

async function columnsOf(db: D1Database, table: string) {
  let cols = columnCache.get(table);
  if (!cols) {
    const { results } = await db.prepare("SELECT name FROM pragma_table_info(?1)").bind(table).all<{ name: string }>();
    cols = results.map((r) => r.name);
    columnCache.set(table, cols);
  }
  return cols;
}

const quote = (name: string) => `"${name}"`;

/** The UTC date of an epoch-ms time. */
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * GET /admin/v1/export/tables/:table?limit=&after=&since=&customers=&optional=
 *   after      the previous page's `next` (JSON array of key values)
 *   since      epoch ms: a delta, with the table's delta filter
 *   customers  comma-separated customer IDs: every row of theirs (tables with a customer column)
 *   optional   1 to include optional columns (store_notification.payload)
 */
export async function exportTable(c: Ctx) {
  const t = TABLES.get(c.req.param("table") ?? "");
  if (!t) return c.json({ code: "not_found", message: "No such export table." }, 404);
  const limit = Math.min(Math.max(Math.floor(Number(c.req.query("limit") ?? 500)) || 500, 1), MAX_PAGE);

  const params: unknown[] = [];
  const p = (v: unknown) => (params.push(v), `?${params.length}`);
  const conds: string[] = [];
  if (t.where) conds.push(`(${t.where})`);

  const customers = c.req.query("customers");
  const sinceRaw = c.req.query("since");
  if (customers !== undefined) {
    if (!t.customer_column) return bad(c, `${t.name} has no customer column.`);
    const ids = customers.split(",").filter(Boolean);
    if (!ids.length || ids.length > MAX_IDS) return bad(c, `customers takes 1 to ${MAX_IDS} IDs.`);
    conds.push(`${quote(t.customer_column)} IN (${ids.map(p).join(", ")})`);
  } else if (sinceRaw !== undefined) {
    const since = Number(sinceRaw);
    if (!Number.isFinite(since) || since < 0) return bad(c, "since must be epoch milliseconds.");
    if (t.delta === null) return c.json({ rows: [], next: null });
    if (t.delta !== "all") conds.push(`(${t.delta.replace(/:since_day|:since/g, (m) => p(m === ":since" ? since : dayOf(since)))})`);
  }

  const afterRaw = c.req.query("after");
  if (afterRaw) {
    let after: unknown;
    try {
      after = JSON.parse(afterRaw);
    } catch {
      return bad(c, "after must be the previous page's next.");
    }
    if (!Array.isArray(after) || after.length !== t.key.length) return bad(c, "after must be the previous page's next.");
    conds.push(t.key.length === 1 ? `${quote(t.key[0]!)} > ${p(after[0])}` : `(${t.key.map(quote).join(", ")}) > (${after.map(p).join(", ")})`);
  }

  let select = "*";
  if (t.optional?.length && c.req.query("optional") !== "1") {
    const omit = new Set(t.optional);
    select = (await columnsOf(c.env.DB, t.name)).map((col) => (omit.has(col) ? `NULL AS ${quote(col)}` : quote(col))).join(", ");
  }
  const sql = `SELECT ${select} FROM ${quote(t.name)}${conds.length ? ` WHERE ${conds.join(" AND ")}` : ""} ORDER BY ${t.key.map(quote).join(", ")} LIMIT ${p(limit)}`;
  const { results } = await c.env.DB.prepare(sql).bind(...params).all<Record<string, unknown>>();
  const last = results.length === limit ? results[results.length - 1] : undefined;
  return c.json({ rows: results, next: last ? t.key.map((k) => last[k]) : null });
}

/**
 * GET /admin/v1/export/customer-info?ids=a,b&at=ms: each customer's CustomerInfo as the SDK would
 * get it at `at`, by customer ID, for `openpurr migrate verify`. From the snapshot when it's
 * current, else computed from the ledger (never written). Unknown IDs are left out.
 */
export async function exportCustomerInfo(c: Ctx) {
  const ids = (c.req.query("ids") ?? "").split(",").filter(Boolean);
  if (!ids.length || ids.length > MAX_IDS) return bad(c, `ids takes 1 to ${MAX_IDS} customer IDs.`);
  const at = c.req.query("at") ? Number(c.req.query("at")) : Date.now();
  if (!Number.isFinite(at)) return bad(c, "at must be epoch milliseconds.");
  const config = c.get("config");
  const { results } = await c.env.DB.prepare(
    `SELECT c.id, c.project_id, c.app_user_id, s.body, s.config_version
     FROM customer c LEFT JOIN customer_snapshot s ON s.customer_id = c.id AND s.ledger_version = c.ledger_version
     WHERE c.id IN (${ids.map(() => "?").join(", ")}) ORDER BY c.id`,
  )
    .bind(...ids)
    .all<{ id: string; project_id: string; app_user_id: string; body: string | null; config_version: string | null }>();

  const customers = [];
  for (const row of results) {
    const project: ProjectConfig | undefined = config.projects.get(row.project_id);
    const base = { id: row.id, project_id: row.project_id, app_user_id: row.app_user_id };
    if (!project) {
      customers.push({ ...base, customer_info: null });
      continue;
    }
    let snapshot: Snapshot;
    if (row.body && row.config_version === project.version) {
      snapshot = JSON.parse(row.body) as Snapshot;
    } else {
      const { customer, transactions, states, grants } = await loadCustomerById(c.env.DB, row.id);
      snapshot = computeSnapshot({ appUserId: row.app_user_id, customer, transactions, states, grants, config: project });
    }
    customers.push({ ...base, customer_info: renderCustomerInfo(snapshot, project, { now: at }) });
  }
  return c.json({ at, customers });
}
