// The admin API, /admin/v1: what the dashboard, CLI and MCP server all use. Permissions and
// audit logging are enforced here, once (src/office/principal.ts). Every write is audited with the
// operator, the access token if one was used, and the source (dashboard or api).

import type { Context } from "hono";
import { Hono } from "hono/tiny";
import { readAttributes } from "../attributes";
import type { AppEnv } from "../env";
import { findCustomer, loadCustomer } from "../ledger";
import { hashKey, SCOPES as SECRET_KEY_SCOPES } from "../secret-keys";
import { readCustomerInfo } from "../snapshot";
import { deliverNow } from "../webhooks";
import { audit, type Operator, publicOperator, requireTotpForEveryone } from "./auth";
import { randomToken, sha256Hex } from "./auth-crypto";
import { ACCESS_TOKEN_PREFIX, adminAuth, can, canSeeApp, type Principal, requirePermission, TOKEN_SCOPES, type TokenScope } from "./principal";

export const admin = new Hono<AppEnv>();
admin.use("*", adminAuth);

type Ctx = Context<AppEnv>;
const p = (c: Ctx) => c.get("principal") as Principal;
const bad = (c: Ctx, message: string) => c.json({ code: "bad_request", message }, 400);
const forbidden = (c: Ctx, message: string) => c.json({ code: "forbidden", message }, 403);
const notFound = (c: Ctx, what: string) => c.json({ code: "not_found", message: `${what} not found.` }, 404);
const ROLES: Operator["role"][] = ["owner", "admin", "developer", "viewer"];
const SETUP_LINK_MS = 24 * 3600_000;

/** An audit row for the current caller. */
function auditBy(c: Ctx, action: string, target?: string | null, details?: unknown) {
  const principal = p(c);
  return audit(c.env.DB, {
    operator: principal.operator,
    action,
    target,
    details,
    ip: c.req.header("cf-connecting-ip") ?? null,
    source: principal.via === "token" ? "api" : "dashboard",
    tokenId: principal.tokenId,
  });
}

async function body<T>(c: Ctx) {
  return (await c.req.json<T>().catch(() => null)) ?? ({} as Partial<T>);
}

// --- me ------------------------------------------------------------------------------------------

admin.get("/me", (c) => {
  const principal = p(c);
  return c.json({ operator: publicOperator(principal.operator), via: principal.via, permissions: [...principal.permissions] });
});

// --- apps (from openpurr.config.yaml) ------------------------------------------------------------

admin.get("/apps", requirePermission("read"), (c) => {
  const principal = p(c);
  const apps = [...c.get("deps").config.apps.values()]
    .filter((a) => canSeeApp(principal, a.id))
    .map((a) => ({ id: a.id, store: a.store, bundle_id: a.bundleId ?? null, package_name: a.packageName ?? null, products: a.products.size }));
  return c.json({ apps });
});

// --- operators -----------------------------------------------------------------------------------

admin.get("/operators", requirePermission("read"), async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM operator ORDER BY created_at").all<Operator & { disabled_at: number | null; last_login_at: number | null }>();
  return c.json({
    operators: results.map((o) => ({ ...publicOperator(o), disabled: !!o.disabled_at, last_login_at: o.last_login_at })),
  });
});

/** Owners are managed only by owners. */
function mayManage(principal: Principal, targetRole: Operator["role"]) {
  return can(principal, "operators:manage") && (targetRole !== "owner" || principal.operator.role === "owner");
}

async function setupLink(c: Ctx, operatorId: string) {
  const token = randomToken();
  const now = Date.now();
  await c.env.DB.prepare("INSERT INTO login_link (token_hash, operator_id, purpose, expires_at, created_at) VALUES (?, ?, 'setup', ?, ?)")
    .bind(await sha256Hex(token), operatorId, now + SETUP_LINK_MS, now)
    .run();
  // The token rides in the #fragment, so it never reaches server logs or Referer headers.
  return `${new URL(c.req.url).origin}/admin/link#token=${token}`;
}

function parseApps(c: Ctx, raw: unknown): string[] | null | undefined | Response {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const { config } = c.get("deps");
  if (!Array.isArray(raw) || !raw.every((a) => typeof a === "string" && config.apps.has(a))) {
    return bad(c, `app_ids must be null (all apps) or a list of app IDs from the config: ${[...config.apps.keys()].join(", ")}.`);
  }
  return raw as string[];
}

admin.post("/operators", requirePermission("operators:manage"), async (c) => {
  const b = await body<{ email: string; name: string; role: Operator["role"]; app_ids: string[] | null }>(c);
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return bad(c, "A valid email is required.");
  if (!ROLES.includes(b.role as Operator["role"])) return bad(c, `role must be one of: ${ROLES.join(", ")}.`);
  if (!mayManage(p(c), b.role!)) return forbidden(c, "Only owners can add owners.");
  const apps = parseApps(c, b.app_ids);
  if (apps instanceof Response) return apps;
  const db = c.env.DB;
  if (await db.prepare("SELECT 1 FROM operator WHERE email = ?").bind(email).first()) return c.json({ code: "exists", message: "That email already has an account." }, 409);
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO operator (id, email, name, role, app_ids, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
      id,
      email,
      typeof b.name === "string" && b.name.trim() ? b.name.trim() : email,
      b.role,
      apps ? JSON.stringify(apps) : null,
      Date.now(),
    ),
    auditBy(c, "operator.created", email, { role: b.role, app_ids: apps ?? null }),
  ]);
  return c.json({ id, setup_link: await setupLink(c, id), setup_link_expires_in_hours: 24 }, 201);
});

admin.patch("/operators/:id", requirePermission("operators:manage"), async (c) => {
  const principal = p(c);
  const db = c.env.DB;
  const target = await db.prepare("SELECT * FROM operator WHERE id = ?").bind(c.req.param("id")).first<Operator>();
  if (!target) return notFound(c, "Operator");
  if (!mayManage(principal, target.role)) return forbidden(c, "Only owners can change owners.");
  const b = await body<{ role: Operator["role"]; app_ids: string[] | null; disabled: boolean; name: string }>(c);
  if (b.role !== undefined) {
    if (!ROLES.includes(b.role)) return bad(c, `role must be one of: ${ROLES.join(", ")}.`);
    if (target.id === principal.operator.id) return forbidden(c, "You can't change your own role.");
    if (!mayManage(principal, b.role)) return forbidden(c, "Only owners can make someone an owner.");
  }
  const apps = parseApps(c, b.app_ids);
  if (apps instanceof Response) return apps;
  if (b.disabled === true && target.id === principal.operator.id) return forbidden(c, "You can't disable yourself.");

  // Never leave the deployment without an active owner.
  const losingOwner = target.role === "owner" && ((b.role !== undefined && b.role !== "owner") || b.disabled === true);
  if (losingOwner) {
    const { n } = (await db.prepare("SELECT count(*) AS n FROM operator WHERE role = 'owner' AND disabled_at IS NULL").first<{ n: number }>())!;
    if (n <= 1) return forbidden(c, "This is the only owner. Make someone else an owner first.");
  }

  const writes: D1PreparedStatement[] = [];
  if (b.role !== undefined) writes.push(db.prepare("UPDATE operator SET role = ? WHERE id = ?").bind(b.role, target.id));
  if (apps !== undefined) writes.push(db.prepare("UPDATE operator SET app_ids = ? WHERE id = ?").bind(apps ? JSON.stringify(apps) : null, target.id));
  if (typeof b.name === "string" && b.name.trim()) writes.push(db.prepare("UPDATE operator SET name = ? WHERE id = ?").bind(b.name.trim(), target.id));
  if (b.disabled === true) {
    writes.push(
      db.prepare("UPDATE operator SET disabled_at = ? WHERE id = ?").bind(Date.now(), target.id),
      db.prepare("DELETE FROM session WHERE operator_id = ?").bind(target.id),
      db.prepare("UPDATE access_token SET revoked_at = ? WHERE operator_id = ? AND revoked_at IS NULL").bind(Date.now(), target.id),
    );
  } else if (b.disabled === false) {
    writes.push(db.prepare("UPDATE operator SET disabled_at = NULL, failed_logins = 0, locked_until = NULL WHERE id = ?").bind(target.id));
  }
  if (!writes.length) return bad(c, "Nothing to change. Send role, app_ids, name or disabled.");
  writes.push(auditBy(c, "operator.updated", target.email, { role: b.role, app_ids: apps, disabled: b.disabled }));
  await db.batch(writes);
  const updated = (await db.prepare("SELECT * FROM operator WHERE id = ?").bind(target.id).first<Operator>())!;
  return c.json({ operator: publicOperator(updated), disabled: b.disabled ?? undefined });
});

// Reset: clears the password and two-step sign-in, ends sessions and issues a new setup link.
admin.post("/operators/:id/reset", requirePermission("operators:manage"), async (c) => {
  const principal = p(c);
  const db = c.env.DB;
  const target = await db.prepare("SELECT * FROM operator WHERE id = ? AND disabled_at IS NULL").bind(c.req.param("id")).first<Operator>();
  if (!target) return notFound(c, "Operator");
  if (!mayManage(principal, target.role)) return forbidden(c, "Only owners can reset owners.");
  if (target.id === principal.operator.id) return forbidden(c, "Change your own password from your account instead.");
  await db.batch([
    db.prepare("UPDATE operator SET password_hash = NULL, totp_enabled = 0, totp_secret = NULL, totp_last_step = NULL, failed_logins = 0, locked_until = NULL WHERE id = ?").bind(target.id),
    db.prepare("DELETE FROM recovery_code WHERE operator_id = ?").bind(target.id),
    db.prepare("DELETE FROM session WHERE operator_id = ?").bind(target.id),
    auditBy(c, "operator.reset", target.email),
  ]);
  return c.json({ setup_link: await setupLink(c, target.id), setup_link_expires_in_hours: 24 });
});

// --- personal access tokens (your own) -----------------------------------------------------------

admin.get("/tokens", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, token_prefix, name, scopes, created_at, last_used_at, expires_at, revoked_at FROM access_token WHERE operator_id = ? ORDER BY created_at",
  )
    .bind(p(c).operator.id)
    .all<{ scopes: string }>();
  return c.json({ tokens: results.map((t) => ({ ...t, scopes: JSON.parse(t.scopes) })) });
});

admin.post("/tokens", async (c) => {
  const principal = p(c);
  // Tokens are minted from a signed-in session only, never by another token.
  if (principal.via !== "session") return forbidden(c, "Create access tokens from the dashboard.");
  const b = await body<{ name: string; scopes: TokenScope[]; expires_in_days: number }>(c);
  if (typeof b.name !== "string" || !b.name.trim()) return bad(c, "name is required.");
  if (!Array.isArray(b.scopes) || !b.scopes.length || !b.scopes.every((s) => TOKEN_SCOPES.includes(s))) {
    return bad(c, `scopes must list some of: ${TOKEN_SCOPES.join(", ")}.`);
  }
  const days = b.expires_in_days;
  if (days !== undefined && (typeof days !== "number" || days < 1 || days > 3650)) return bad(c, "expires_in_days must be 1–3650, or left out for no expiry.");
  const token = `${ACCESS_TOKEN_PREFIX}${randomToken()}`;
  const id = crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO access_token (id, operator_id, token_hash, token_prefix, name, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(
      id,
      principal.operator.id,
      await sha256Hex(token),
      token.slice(0, 10),
      b.name.trim(),
      JSON.stringify(b.scopes),
      now,
      days ? now + days * 864e5 : null,
    ),
    auditBy(c, "token.created", id, { name: b.name.trim(), scopes: b.scopes }),
  ]);
  // Shown once. Effective access is the operator's role, limited to these scopes.
  return c.json({ id, token, scopes: b.scopes }, 201);
});

admin.delete("/tokens/:id", async (c) => {
  const db = c.env.DB;
  const res = await db
    .prepare("UPDATE access_token SET revoked_at = ? WHERE id = ? AND operator_id = ? AND revoked_at IS NULL")
    .bind(Date.now(), c.req.param("id"), p(c).operator.id)
    .run();
  if (!res.meta.changes) return notFound(c, "Token");
  await auditBy(c, "token.revoked", c.req.param("id")).run();
  return c.json({});
});

// --- secret keys (server-to-server) --------------------------------------------------------------

admin.get("/secret-keys", requirePermission("keys:manage"), async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, key_prefix, name, scopes, created_at, last_used_at, expires_at, revoked_at FROM api_key ORDER BY created_at",
  ).all<{ scopes: string }>();
  return c.json({ secret_keys: results.map((k) => ({ ...k, scopes: JSON.parse(k.scopes) })) });
});

admin.post("/secret-keys", requirePermission("keys:manage"), async (c) => {
  const b = await body<{ name: string; scopes: string[] }>(c);
  if (typeof b.name !== "string" || !b.name.trim()) return bad(c, "name is required.");
  const scopes = b.scopes ?? ["customers:read"];
  if (!Array.isArray(scopes) || !scopes.length || !scopes.every((s) => (SECRET_KEY_SCOPES as readonly string[]).includes(s))) {
    return bad(c, `scopes must list some of: ${SECRET_KEY_SCOPES.join(", ")}.`);
  }
  const key = `sk_${randomToken()}`;
  const id = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO api_key (id, key_hash, key_prefix, name, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
      id,
      await hashKey(key),
      key.slice(0, 10),
      b.name.trim(),
      JSON.stringify(scopes),
      Date.now(),
    ),
    auditBy(c, "secret_key.created", id, { name: b.name.trim(), scopes }),
  ]);
  return c.json({ id, key, scopes }, 201); // shown once
});

admin.post("/secret-keys/:id/revoke", requirePermission("keys:manage"), async (c) => {
  const res = await c.env.DB.prepare("UPDATE api_key SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(Date.now(), c.req.param("id")).run();
  if (!res.meta.changes) return notFound(c, "Secret key");
  await auditBy(c, "secret_key.revoked", c.req.param("id")).run();
  return c.json({ note: "Revoked. It stops working within a minute (lookups are cached briefly)." });
});

// Rotation: create a new key, switch your backend over, then expire the old one.
admin.post("/secret-keys/:id/expire", requirePermission("keys:manage"), async (c) => {
  const b = await body<{ in_hours: number }>(c);
  const hours = typeof b.in_hours === "number" && b.in_hours >= 0 && b.in_hours <= 24 * 90 ? b.in_hours : null;
  if (hours === null) return bad(c, "in_hours must be 0–2160.");
  const at = Date.now() + hours * 3600_000;
  const res = await c.env.DB.prepare("UPDATE api_key SET expires_at = ? WHERE id = ? AND revoked_at IS NULL").bind(at, c.req.param("id")).run();
  if (!res.meta.changes) return notFound(c, "Secret key");
  await auditBy(c, "secret_key.expiry_set", c.req.param("id"), { expires_at: at }).run();
  return c.json({ expires_at: at });
});

// --- customers -----------------------------------------------------------------------------------

// The customer list: newest first, or a search. Every query reads through an index and stops at the
// page size, because D1's free plan counts rows read per day. D1 also allows at most 100 bound
// parameters per query, which caps the page size (IDs are bound in IN lists below).
const CUSTOMER_PAGE_MAX = 50;
const MAX_STRING = "\u{10FFFF}"; // sorts after any app user ID that starts with the prefix

interface CustomerRow {
  id: string;
  app_user_id: string;
  first_seen: number;
}

admin.get("/customers", requirePermission("read"), async (c) => {
  const principal = p(c);
  const db = c.env.DB;
  const q = (c.req.query("q") ?? "").trim();
  if (q.length > 256) return bad(c, "q is too long.");
  const limit = Math.min(Math.max(Math.floor(Number(c.req.query("limit") ?? CUSTOMER_PAGE_MAX)) || CUSTOMER_PAGE_MAX, 1), CUSTOMER_PAGE_MAX);
  const apps = principal.apps;
  if (apps && !apps.length) return c.json({ customers: [], next_before: null });

  // Operators limited to some apps see only customers with purchases in those apps. Customers
  // without purchases aren't tied to an app, so only all-apps operators see them.
  const appList = apps ? apps.map(() => "?").join(", ") : "";
  const owned =
    apps || c.req.query("purchases") === "1"
      ? `EXISTS (SELECT 1 FROM purchase_owner o WHERE o.customer_id = c.id${apps ? ` AND o.app_id IN (${appList})` : ""})`
      : "1";
  const ownedBinds = apps ?? [];

  let rows: CustomerRow[];
  let nextBefore: string | null = null;
  if (q) {
    // An app user ID prefix (any alias), an exact email, or an exact store transaction ID.
    const lookups = [
      db.prepare("SELECT customer_id FROM customer_alias WHERE app_user_id >= ? AND app_user_id < ? ORDER BY app_user_id LIMIT ?").bind(q, q + MAX_STRING, limit),
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
    if (!ids.length) return c.json({ customers: [], next_before: null });
    ({ results: rows } = await db
      .prepare(`SELECT c.id, c.app_user_id, c.first_seen FROM customer c WHERE c.id IN (${ids.map(() => "?").join(", ")}) AND ${owned} ORDER BY c.first_seen DESC, c.id DESC`)
      .bind(...ids, ...ownedBinds)
      .all<CustomerRow>());
  } else {
    // Newest first. The cursor is "first_seen:id" of the last row on the previous page.
    const before = c.req.query("before");
    let cursor: [number, string] | null = null;
    if (before) {
      const i = before.indexOf(":");
      const at = Number(before.slice(0, i));
      if (i < 1 || !Number.isFinite(at)) return bad(c, "before must be the next_before value from the previous page.");
      cursor = [at, before.slice(i + 1)];
    }
    ({ results: rows } = await db
      .prepare(`SELECT c.id, c.app_user_id, c.first_seen FROM customer c WHERE ${cursor ? "(c.first_seen, c.id) < (?, ?)" : "1"} AND ${owned} ORDER BY c.first_seen DESC, c.id DESC LIMIT ?`)
      .bind(...(cursor ?? []), ...ownedBinds, limit)
      .all<CustomerRow>());
    if (rows.length === limit) nextBefore = `${rows.at(-1)!.first_seen}:${rows.at(-1)!.id}`;
  }
  if (!rows.length) return c.json({ customers: [], next_before: null });

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

  return c.json({
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
  });
});

admin.get("/customers/:app_user_id", requirePermission("read"), async (c) => {
  const principal = p(c);
  const db = c.env.DB;
  const appUserId = c.req.param("app_user_id");
  const customer = await findCustomer(db, appUserId);
  if (!customer) return notFound(c, "Customer");
  const [{ body: customerInfo }, { transactions, states }, attributes, aliases, events] = await Promise.all([
    readCustomerInfo(db, c.get("deps").config, appUserId),
    loadCustomer(db, appUserId),
    readAttributes(db, customer.id),
    db.prepare("SELECT app_user_id, created_at FROM customer_alias WHERE customer_id = ? ORDER BY created_at").bind(customer.id).all(),
    db.prepare("SELECT id, type, app_id, environment, created_at FROM webhook_event WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50").bind(customer.id).all<{ app_id: string }>(),
  ]);
  const visible = transactions.filter((t) => canSeeApp(principal, t.app_id));
  return c.json({
    customer: { id: customer.id, original_app_user_id: customer.appUserId, first_seen: customer.firstSeen },
    aliases: aliases.results,
    customer_info: principal.apps === null ? customerInfo : undefined, // spans every app, so only for all-apps operators
    attributes,
    transactions: visible.sort((a, b) => b.purchased_at - a.purchased_at),
    subscription_states: states.filter((s) => visible.some((t) => t.store === s.store && t.original_transaction_id === s.original_transaction_id)),
    webhook_events: events.results.filter((e) => canSeeApp(principal, e.app_id)),
  });
});

// --- webhooks ------------------------------------------------------------------------------------

admin.get("/webhooks/deliveries", requirePermission("read"), async (c) => {
  const principal = p(c);
  const status = c.req.query("status");
  if (status && !["pending", "delivered", "failed"].includes(status)) return bad(c, "status must be pending, delivered or failed.");
  const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
  const { results } = await c.env.DB.prepare(
    `SELECT d.event_id, d.endpoint, d.status, d.attempts, d.next_attempt_at, d.last_status, d.last_error, d.delivered_at, d.created_at,
            e.type, e.app_id, e.environment
     FROM webhook_delivery d JOIN webhook_event e ON e.id = d.event_id
     ${status ? "WHERE d.status = ?" : ""} ORDER BY d.created_at DESC LIMIT ${limit}`,
  )
    .bind(...(status ? [status] : []))
    .all<{ app_id: string }>();
  return c.json({ deliveries: results.filter((d) => canSeeApp(principal, d.app_id)) });
});

admin.post("/webhooks/events/:id/replay", requirePermission("webhooks:replay"), async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const event = await db.prepare("SELECT app_id FROM webhook_event WHERE id = ?").bind(id).first<{ app_id: string }>();
  if (!event || !canSeeApp(p(c), event.app_id)) return notFound(c, "Event");
  // The same event (same id and body) goes out again: consumers deduplicate on event.id.
  await db.batch([
    db.prepare("UPDATE webhook_delivery SET status = 'pending', attempts = 0, next_attempt_at = ?, last_error = NULL WHERE event_id = ?").bind(Date.now() + 300_000, id),
    auditBy(c, "webhook.replayed", id),
  ]);
  const { config, fetch: fetchImpl } = c.get("deps");
  c.executionCtx.waitUntil(deliverNow(c.env, config, fetchImpl ?? fetch, [id]));
  return c.json({ replayed: id });
});

// --- audit log -----------------------------------------------------------------------------------

admin.get("/audit", requirePermission("audit:read"), async (c) => {
  const before = Number(c.req.query("before") ?? 0) || null;
  const limit = Math.min(Number(c.req.query("limit") ?? 100) || 100, 500);
  const { results } = await c.env.DB.prepare(
    `SELECT id, at, operator_id, actor, token_id, source, action, target, details, ip FROM audit_log
     ${before ? "WHERE id < ?" : ""} ORDER BY id DESC LIMIT ${limit}`,
  )
    .bind(...(before ? [before] : []))
    .all<{ id: number; details: string | null }>();
  return c.json({
    entries: results.map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null })),
    next_before: results.length === limit ? results.at(-1)!.id : null,
  });
});

// --- settings ------------------------------------------------------------------------------------

admin.get("/settings", requirePermission("read"), async (c) => c.json({ require_totp: await requireTotpForEveryone(c.env.DB) }));

admin.put("/settings", requirePermission("settings:manage"), async (c) => {
  const b = await body<{ require_totp: boolean }>(c);
  if (typeof b.require_totp !== "boolean") return bad(c, "require_totp must be true or false.");
  if (b.require_totp && !p(c).operator.totp_enabled) return forbidden(c, "Turn on two-step sign-in for yourself first.");
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO setting (key, value, updated_at) VALUES ('require_totp', ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    ).bind(String(b.require_totp), Date.now()),
    auditBy(c, "setting.require_totp", null, { value: b.require_totp }),
  ]);
  return c.json({ require_totp: b.require_totp });
});

admin.all("*", (c) => notFound(c, "Endpoint"));
