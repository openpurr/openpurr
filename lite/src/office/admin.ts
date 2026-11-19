// The admin API, /admin/v1: what the dashboard, CLI and MCP server all use. Permissions and
// audit logging are enforced here, once (src/office/principal.ts). Every write is audited with the
// operator, the access token if one was used, and the source (dashboard or api).

import type { Context } from "hono";
import { Hono } from "hono/tiny";
import { readAttributes } from "../attributes";
import { type AppConfig, ConfigError, parseConfig, type ProjectConfig } from "../config";
import { changeProblems, ConfigConflict, currentVersion, getVersion, listVersions, saveConfig } from "../config-store";
import type { AppEnv } from "../env";
import { findCustomer, loadCustomer } from "../ledger";
import { hashKey, SCOPES as SECRET_KEY_SCOPES } from "../secret-keys";
import { CHARTS, chartCsv, dayOf, type Interval, lastRollupAt, readChart, rollupInfo, rollupMetrics } from "../metrics";
import { readCustomerInfo } from "../snapshot";
import { deliverNow } from "../webhooks";
import { audit, type Operator, publicOperator, requireTotpForEveryone } from "./auth";
import { BadInput, searchCustomers } from "./customers";
import { type Actor, GrantError, grantEntitlement, rebuildAfterGrant, revokeGrant } from "./grants";
import { runChecks, summarize } from "./doctor";
import { decideRequest, listGrants, pendingRequest, revokeGrantFor } from "./oauth";
import { randomToken, sha256Hex } from "./auth-crypto";
import { ACCESS_TOKEN_PREFIX, adminAuth, can, canSeeApp, type Principal, requirePermission, TOKEN_SCOPES, type TokenScope } from "./principal";
import { chooseProject, visibleProjects } from "./project";

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

/** The project a request is about (?project=, or the caller's only project), or an error response. */
function projectOf(c: Ctx, requested?: unknown): ProjectConfig | Response {
  const choice = chooseProject(c.get("config"), p(c), typeof requested === "string" ? requested : c.req.query("project"));
  if ("project" in choice) return choice.project;
  return c.json({ code: choice.status === 404 ? "not_found" : "bad_request", message: choice.message }, choice.status);
}

// --- me ------------------------------------------------------------------------------------------

admin.get("/me", (c) => {
  const principal = p(c);
  return c.json({ operator: publicOperator(principal.operator), via: principal.via, permissions: [...principal.permissions] });
});

/** An app's products as charts name them: Google Play base plans separately ("pro:monthly"). */
function chartProducts(app: AppConfig) {
  return [...app.products.values()].flatMap((p) => (p.basePlans.length ? p.basePlans.map((b) => `${p.id}:${b}`) : [p.id]));
}

// --- projects and apps (from the config) ---------------------------------------------------------

admin.get("/projects", requirePermission("read"), (c) => {
  const principal = p(c);
  const projects = visibleProjects(c.get("config"), principal).map((project) => ({
    id: project.id,
    name: project.name,
    apps: [...project.apps.values()].filter((a) => canSeeApp(principal, a.id)).map((a) => ({ id: a.id, store: a.store })),
    entitlement_ids: project.entitlements.map((e) => e.id),
    current_offering_id: project.currentOffering,
  }));
  return c.json({ projects });
});

admin.get("/apps", requirePermission("read"), (c) => {
  const principal = p(c);
  const only = c.req.query("project");
  const apps = [...c.get("config").apps.values()]
    .filter((a) => canSeeApp(principal, a.id) && (!only || a.projectId === only))
    .map((a) => ({
      id: a.id,
      project_id: a.projectId,
      store: a.store,
      bundle_id: a.bundleId ?? null,
      package_name: a.packageName ?? null,
      products: chartProducts(a),
    }));
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
  const config = c.get("config");
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

// A secret key reads one project's customers. The list shows every project's keys unless
// ?project= narrows it.
admin.get("/secret-keys", requirePermission("keys:manage"), async (c) => {
  const only = c.req.query("project");
  const { results } = await c.env.DB.prepare(
    `SELECT id, project_id, key_prefix, name, scopes, created_at, last_used_at, expires_at, revoked_at FROM api_key
     ${only ? "WHERE project_id = ?" : ""} ORDER BY created_at`,
  )
    .bind(...(only ? [only] : []))
    .all<{ scopes: string }>();
  return c.json({ secret_keys: results.map((k) => ({ ...k, scopes: JSON.parse(k.scopes) })) });
});

admin.post("/secret-keys", requirePermission("keys:manage"), async (c) => {
  const b = await body<{ name: string; scopes: string[]; project: string }>(c);
  if (typeof b.name !== "string" || !b.name.trim()) return bad(c, "name is required.");
  const project = projectOf(c, b.project);
  if (project instanceof Response) return project;
  const scopes = b.scopes ?? ["customers:read"];
  if (!Array.isArray(scopes) || !scopes.length || !scopes.every((s) => (SECRET_KEY_SCOPES as readonly string[]).includes(s))) {
    return bad(c, `scopes must list some of: ${SECRET_KEY_SCOPES.join(", ")}.`);
  }
  const key = `sk_${randomToken()}`;
  const id = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO api_key (id, project_id, key_hash, key_prefix, name, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
      id,
      project.id,
      await hashKey(key),
      key.slice(0, 10),
      b.name.trim(),
      JSON.stringify(scopes),
      Date.now(),
    ),
    auditBy(c, "secret_key.created", id, { name: b.name.trim(), scopes, project: project.id }),
  ]);
  return c.json({ id, key, scopes, project_id: project.id }, 201); // shown once
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

admin.get("/customers", requirePermission("read"), async (c) => {
  const project = projectOf(c);
  if (project instanceof Response) return project;
  try {
    return c.json(
      await searchCustomers(c.env.DB, project.id, p(c).apps, {
        q: c.req.query("q"),
        purchasesOnly: c.req.query("purchases") === "1",
        limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
        before: c.req.query("before"),
      }),
    );
  } catch (err) {
    if (err instanceof BadInput) return bad(c, err.message);
    throw err;
  }
});

admin.get("/customers/:app_user_id", requirePermission("read"), async (c) => {
  const principal = p(c);
  const project = projectOf(c);
  if (project instanceof Response) return project;
  const db = c.env.DB;
  const appUserId = c.req.param("app_user_id");
  const customer = await findCustomer(db, project.id, appUserId);
  if (!customer) return notFound(c, "Customer");
  const [{ body: customerInfo }, { transactions, states, grants }, attributes, aliases, events] = await Promise.all([
    readCustomerInfo(db, project, appUserId),
    loadCustomer(db, project.id, appUserId),
    readAttributes(db, customer.id),
    db.prepare("SELECT app_user_id, created_at FROM customer_alias WHERE customer_id = ? ORDER BY created_at").bind(customer.id).all(),
    db.prepare("SELECT id, type, app_id, environment, created_at FROM webhook_event WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50").bind(customer.id).all<{ app_id: string }>(),
  ]);
  const visible = transactions.filter((t) => canSeeApp(principal, t.app_id));
  return c.json({
    customer: { id: customer.id, project_id: customer.projectId, original_app_user_id: customer.appUserId, first_seen: customer.firstSeen },
    aliases: aliases.results,
    customer_info: principal.apps === null ? customerInfo : undefined, // spans every app, so only for all-apps operators
    attributes,
    transactions: visible.sort((a, b) => b.purchased_at - a.purchased_at),
    subscription_states: states.filter((s) => visible.some((t) => t.store === s.store && t.original_transaction_id === s.original_transaction_id)),
    webhook_events: events.results.filter((e) => canSeeApp(principal, e.app_id)),
    // Grants span every app (entitlements aren't per app), so only all-apps operators see them.
    grants: principal.apps === null ? grants : undefined,
    entitlement_ids: project.entitlements.map((e) => e.id),
  });
});

// --- promotional grants --------------------------------------------------------------------------

function actorOf(c: Ctx): Actor {
  const principal = p(c);
  return {
    email: principal.operator.email,
    operatorId: principal.operator.id,
    source: principal.via === "token" ? "api" : "dashboard",
    tokenId: principal.tokenId,
    ip: c.req.header("cf-connecting-ip") ?? null,
  };
}

// Entitlements cover every app of a project, so granting needs access to all apps.
function allAppsOnly(c: Ctx) {
  return p(c).apps === null ? null : forbidden(c, "Granting entitlements needs access to all apps.");
}

admin.post("/customers/:app_user_id/grants", requirePermission("grants:manage"), async (c) => {
  const denied = allAppsOnly(c);
  if (denied) return denied;
  const b = await body<{ entitlement_id: string; duration: string; expires_at: string | number; note: string }>(c);
  let expiresAt: number | undefined;
  if (b.expires_at !== undefined) {
    expiresAt = typeof b.expires_at === "number" ? b.expires_at : Date.parse(String(b.expires_at));
    if (!Number.isFinite(expiresAt)) return bad(c, "expires_at must be a date (ISO 8601) or milliseconds since 1970.");
  }
  const project = projectOf(c);
  if (project instanceof Response) return project;
  try {
    const { grant, customerId } = await grantEntitlement(
      c.env.DB,
      project,
      { appUserId: c.req.param("app_user_id"), entitlementId: String(b.entitlement_id ?? ""), duration: b.duration, expiresAt, note: b.note ?? null },
      actorOf(c),
    );
    c.executionCtx.waitUntil(rebuildAfterGrant(c.env.DB, c.get("config"), customerId));
    return c.json({ grant }, 201);
  } catch (err) {
    if (err instanceof GrantError) return c.json({ code: err.status === 404 ? "not_found" : "bad_request", message: err.message }, err.status);
    throw err;
  }
});

admin.post("/customers/:app_user_id/grants/:grant_id/revoke", requirePermission("grants:manage"), async (c) => {
  const denied = allAppsOnly(c);
  if (denied) return denied;
  const project = projectOf(c);
  if (project instanceof Response) return project;
  try {
    const { customerId } = await revokeGrant(c.env.DB, { projectId: project.id, appUserId: c.req.param("app_user_id"), grantId: c.req.param("grant_id") }, actorOf(c));
    c.executionCtx.waitUntil(rebuildAfterGrant(c.env.DB, c.get("config"), customerId));
    return c.json({ revoked: c.req.param("grant_id") });
  } catch (err) {
    if (err instanceof GrantError) return c.json({ code: err.status === 404 ? "not_found" : "bad_request", message: err.message }, err.status);
    throw err;
  }
});

// --- charts --------------------------------------------------------------------------------------

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CHART_DAYS = 3660;
const REFRESH_EVERY_MS = 60_000;

admin.get("/metrics", requirePermission("read"), async (c) =>
  c.json({
    charts: Object.entries(CHARTS).map(([id, d]) => ({ id, label: d.label, description: d.description, unit: d.unit, kind: d.kind, series: d.series })),
    ...(await rollupInfo(c.env.DB)),
  }),
);

admin.get("/metrics/:chart", requirePermission("read"), async (c) => {
  const principal = p(c);
  const today = dayOf(Date.now());
  const to = c.req.query("to") ?? today;
  const from = c.req.query("from") ?? dayOf(Date.parse(`${to}T00:00:00Z`) - 89 * 864e5);
  if (!DATE.test(from) || !DATE.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || from > to) {
    return bad(c, "from and to must be dates (YYYY-MM-DD), with from on or before to.");
  }
  if ((Date.parse(to) - Date.parse(from)) / 864e5 > MAX_CHART_DAYS) return bad(c, `A chart can cover at most ${MAX_CHART_DAYS} days.`);
  const interval = (c.req.query("interval") ?? "day") as Interval;
  if (!["day", "week", "month"].includes(interval)) return bad(c, "interval must be day, week or month.");
  const environment = c.req.query("environment") ?? "production";
  if (environment !== "production" && environment !== "sandbox") return bad(c, "environment must be production or sandbox.");
  const store = c.req.query("store") || undefined;
  if (store && store !== "app_store" && store !== "play_store") return bad(c, "store must be app_store or play_store.");
  const app = c.req.query("app") || undefined;
  const product = c.req.query("product") || undefined;
  const config = c.get("config");
  if (product) {
    const known = [...config.apps.values()].some((a) => canSeeApp(principal, a.id) && (!app || a.id === app) && chartProducts(a).includes(product));
    if (!known) return notFound(c, "Product");
  }
  if (app && (!config.apps.has(app) || !canSeeApp(principal, app))) return notFound(c, "App");
  // Charts cover every project unless ?project= picks one.
  let project: { id: string; apps: string[] } | undefined;
  if (c.req.query("project")) {
    const chosen = projectOf(c);
    if (chosen instanceof Response) return chosen;
    project = { id: chosen.id, apps: [...chosen.apps.keys()] };
  }

  const result = await readChart(c.env.DB, c.req.param("chart"), { from, to: to > today ? today : to, interval, environment, store, app, product, apps: principal.apps, project });
  if (!result) return notFound(c, "Chart");
  if (c.req.query("format") === "csv") {
    return c.body(chartCsv(result), 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="openpurr-${result.chart}-${result.from}-to-${result.to}.csv"`,
    });
  }
  return c.json(result);
});

// The hourly rollup, now. A full rebuild recomputes all history: owners only, since it writes a
// row per day and metric (the free plan allows 100,000 rows written per day).
admin.post("/metrics/refresh", requirePermission("read"), async (c) => {
  const { full } = await body<{ full: boolean }>(c);
  if (full && !can(p(c), "settings:manage")) return forbidden(c, "Only owners can rebuild all chart history.");
  const last = await lastRollupAt(c.env.DB);
  if (!full && last && Date.now() - last < REFRESH_EVERY_MS) return c.json({ refreshed: false, updated_at: last });
  const result = await rollupMetrics(c.env.DB, Date.now(), { full: !!full });
  if (full) await auditBy(c, "metrics.rebuilt", null, { from: result.from, rows: result.rows }).run();
  return c.json({ refreshed: true, ...result, updated_at: await lastRollupAt(c.env.DB) });
});

// --- setup checks ----------------------------------------------------------------------------------

admin.get("/doctor", requirePermission("read"), async (c) => {
  const checks = await runChecks(c, p(c));
  return c.json({ summary: summarize(checks), checks });
});

// --- OAuth: the consent screen and connected apps (dashboard sessions only) ---------------------

const sessionOnly = (c: Ctx) => (p(c).via === "session" ? null : forbidden(c, "This is for the dashboard (signed in), not access tokens."));

admin.get("/oauth/requests/:id", async (c) => {
  const denied = sessionOnly(c);
  if (denied) return denied;
  const r = await pendingRequest(c.env.DB, c.req.param("id"), p(c));
  return r ? c.json(r) : notFound(c, "Sign-in request (it may have expired: start again from the app)");
});

admin.post("/oauth/requests/:id/:decision{approve|deny}", async (c) => {
  const denied = sessionOnly(c);
  if (denied) return denied;
  const b = await body<{ scopes: string[] }>(c);
  try {
    const r = await decideRequest(c, c.req.param("id"), p(c), { approve: c.req.param("decision") === "approve", scopes: Array.isArray(b.scopes) ? b.scopes : undefined });
    return r ? c.json(r) : notFound(c, "Sign-in request (it may have expired: start again from the app)");
  } catch (err) {
    return bad(c, (err as Error).message);
  }
});

admin.get("/oauth/grants", async (c) => c.json({ grants: await listGrants(c.env.DB, p(c).operator.id) }));

admin.post("/oauth/grants/:id/revoke", async (c) => {
  const denied = sessionOnly(c);
  if (denied) return denied;
  return (await revokeGrantFor(c, p(c).operator, c.req.param("id"))) ? c.json({ revoked: c.req.param("id") }) : notFound(c, "Connected app");
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
  c.executionCtx.waitUntil(deliverNow(c.env, c.get("config"), c.get("deps").fetch ?? fetch, [id]));
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

// --- config --------------------------------------------------------------------------------------
//
// The whole config is one document (src/config.ts): every project, app, product, entitlement,
// offering and webhook. Each save is a new version (config_version), so the history is a list of
// documents and a rollback is saving an old one again. Saves name the version they were made from
// (base_id), so two people editing at once can't overwrite each other: the second save gets 409.
// It holds no secrets: store keys and webhook secrets are Worker secrets, named here.

const configProblems = (c: Ctx, problems: string[]) =>
  c.json({ code: "invalid_config", message: "The config has problems.", problems }, 400);

admin.get("/config", requirePermission("read"), async (c) => {
  const version = await currentVersion(c.env.DB);
  return c.json(version ?? { id: 0, document: c.get("config").document, created_at: null, created_by: null, note: null });
});

admin.post("/config/validate", requirePermission("read"), async (c) => {
  const b = await body<{ document: unknown }>(c);
  try {
    const next = parseConfig(b.document);
    const problems = await changeProblems(c.env.DB, c.get("config"), next);
    return c.json({ valid: !problems.length, problems });
  } catch (err) {
    if (err instanceof ConfigError) return c.json({ valid: false, problems: err.problems });
    throw err;
  }
});

/** Validates, checks the change against the current config, and saves it as a new version. */
async function saveVersion(c: Ctx, document: unknown, baseId: unknown, note: string | null, action: string, details: Record<string, unknown> = {}) {
  if (typeof baseId !== "number" || !Number.isInteger(baseId) || baseId < 0) {
    return bad(c, "base_id must be the id of the version you changed (from GET /admin/v1/config; 0 if there's none).");
  }
  if (note !== null && note.length > 500) return bad(c, "note can be at most 500 characters.");
  try {
    const next = parseConfig(document);
    const problems = await changeProblems(c.env.DB, c.get("config"), next);
    if (problems.length) return configProblems(c, problems);
    const { id } = await saveConfig(c.env.DB, next.document, { baseId, by: p(c).operator.email, note });
    // Audited once saved (a refused save writes nothing).
    await auditBy(c, action, String(id), { base_id: baseId, note, ...details }).run();
    return c.json({ id }, 201);
  } catch (err) {
    if (err instanceof ConfigError) return configProblems(c, err.problems);
    if (err instanceof ConfigConflict) return c.json({ code: "conflict", message: err.message }, 409);
    throw err;
  }
}

admin.put("/config", requirePermission("config:manage"), async (c) => {
  const b = await body<{ document: unknown; base_id: number; note: string }>(c);
  return saveVersion(c, b.document, b.base_id, typeof b.note === "string" && b.note.trim() ? b.note.trim() : null, "config.saved");
});

admin.get("/config/versions", requirePermission("read"), async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
  const before = Number(c.req.query("before") ?? 0) || undefined;
  const versions = await listVersions(c.env.DB, limit, before);
  return c.json({ versions, next_before: versions.length === limit ? versions.at(-1)!.id : null });
});

admin.get("/config/versions/:id", requirePermission("read"), async (c) => {
  const version = await getVersion(c.env.DB, Number(c.req.param("id")) || 0);
  return version ? c.json(version) : notFound(c, "Config version");
});

// A rollback: the old document is saved again as the newest version (the history keeps everything).
admin.post("/config/versions/:id/restore", requirePermission("config:manage"), async (c) => {
  const id = Number(c.req.param("id")) || 0;
  const version = await getVersion(c.env.DB, id);
  if (!version) return notFound(c, "Config version");
  const b = await body<{ base_id: number }>(c);
  return saveVersion(c, version.document, b.base_id, `Restored version ${id}`, "config.restored", { restored: id });
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
