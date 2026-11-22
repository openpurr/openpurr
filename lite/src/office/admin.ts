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
import { CHARTS, chartCsv, dayOf, type Interval, lastRollupAt, parseDay, readChart, rollupInfo, rollupMetrics } from "../metrics";
import { readCustomerInfo } from "../snapshot";
import { type CustomerExperiment, customerExperimentsQuery, type ExperimentRow, forgetRunning, MAX_VARIANTS, type Variant, VARIANT_IDS, variantsOf } from "../experiments";
import { experimentResults, publicExperiment } from "./experiments";
import { deliverNow } from "../webhooks";
import { audit, type Operator, publicOperator, requireTotpForEveryone } from "./auth";
import { BadInput, searchCustomers } from "./customers";
import { type Actor, GrantError, grantEntitlement, rebuildAfterGrant, revokeGrant } from "./grants";
import { runChecks, summarize } from "./doctor";
import { assessUsage, cloudflarePlan, EDITION, type Plan, readUsage, refreshUsage, usageConfigured } from "./usage";
import { ImportError, importRow, type ImportRow } from "./import";
import { decideRequest, listGrants, pendingRequest, revokeGrantFor } from "./oauth";
import { randomToken, sha256Hex } from "./auth-crypto";
import { ACCESS_TOKEN_PREFIX, adminAuth, can, canSeeApp, type Principal, requirePermission, TOKEN_SCOPES, type TokenScope } from "./principal";
import { chooseProject, visibleProjects } from "./project";
import { isOfficeLocale, OFFICE_LOCALES } from "./locales";
import { guessSdkUrl, parseSdkUrl, storedSdkUrl } from "./setup";
import { exportCustomerInfo, exportDenied, exportInfo, exportTable } from "./export";

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

/**
 * The page size from ?limit=: `def` when it's missing or not a number, at most `max`. Below one
 * it's `max`: SQLite reads a negative LIMIT as no limit at all (a whole-table read), and Standard
 * answers a negative limit with its largest page too.
 */
function pageLimit(c: Ctx, def: number, max: number) {
  const n = Math.min(Number(c.req.query("limit") ?? def) || def, max);
  return n < 1 ? max : Math.floor(n);
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

// Your own preferences. Anyone signed in may change them, with any token scope: they only affect
// how the dashboard looks to you.
admin.patch("/me", async (c) => {
  const b = await body<{ locale: string | null }>(c);
  if (!("locale" in b)) return bad(c, "Nothing to change: send {\"locale\": …}.");
  const locale = b.locale === null || b.locale === "" ? null : b.locale;
  if (locale !== null && !isOfficeLocale(locale)) return bad(c, `locale must be null (follow the browser) or one of ${OFFICE_LOCALES.join(", ")}.`);
  const me = p(c).operator;
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE operator SET locale = ? WHERE id = ?").bind(locale, me.id),
    auditBy(c, "operator.locale", me.id, { locale }),
  ]);
  return c.json({ operator: publicOperator({ ...me, locale }) });
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

  // Never leave the deployment without an active owner. Taking an owner away is one conditional
  // UPDATE that needs another active owner to remain, run before anything else is written: D1 has
  // no transaction to lock the owners while counting, so a count then a write would let two owners
  // demoting each other at the same moment both succeed.
  const losingOwner = target.role === "owner" && ((b.role !== undefined && b.role !== "owner") || b.disabled === true);
  const now = Date.now();
  if (losingOwner) {
    const sets: [string, unknown][] = [];
    if (b.role !== undefined) sets.push(["role", b.role]);
    if (b.disabled === true) sets.push(["disabled_at", now]);
    const res = await db
      .prepare(
        `UPDATE operator SET ${sets.map(([column]) => `${column} = ?`).join(", ")}
         WHERE id = ? AND EXISTS (SELECT 1 FROM operator WHERE role = 'owner' AND disabled_at IS NULL AND id != ?)`,
      )
      .bind(...sets.map(([, value]) => value), target.id, target.id)
      .run();
    if (!res.meta.changes) return forbidden(c, "This is the only owner. Make someone else an owner first.");
  }

  const writes: D1PreparedStatement[] = [];
  if (b.role !== undefined && !losingOwner) writes.push(db.prepare("UPDATE operator SET role = ? WHERE id = ?").bind(b.role, target.id));
  if (apps !== undefined) writes.push(db.prepare("UPDATE operator SET app_ids = ? WHERE id = ?").bind(apps ? JSON.stringify(apps) : null, target.id));
  if (typeof b.name === "string" && b.name.trim()) writes.push(db.prepare("UPDATE operator SET name = ? WHERE id = ?").bind(b.name.trim(), target.id));
  if (b.disabled === true) {
    if (!losingOwner) writes.push(db.prepare("UPDATE operator SET disabled_at = ? WHERE id = ?").bind(now, target.id));
    writes.push(
      db.prepare("DELETE FROM session WHERE operator_id = ?").bind(target.id),
      db.prepare("UPDATE access_token SET revoked_at = ? WHERE operator_id = ? AND revoked_at IS NULL").bind(now, target.id),
    );
  } else if (b.disabled === false) {
    writes.push(db.prepare("UPDATE operator SET disabled_at = NULL, failed_logins = 0, locked_until = NULL WHERE id = ?").bind(target.id));
  }
  if (!writes.length && !losingOwner) return bad(c, "Nothing to change. Send role, app_ids, name or disabled.");
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
  const [{ body: customerInfo }, { transactions, states, grants }, attributes, aliases, events, experiments] = await Promise.all([
    readCustomerInfo(db, project, appUserId),
    loadCustomer(db, project.id, appUserId),
    readAttributes(db, customer.id),
    db.prepare("SELECT app_user_id, created_at FROM customer_alias WHERE customer_id = ? ORDER BY created_at").bind(customer.id).all(),
    db.prepare("SELECT id, type, app_id, environment, created_at FROM webhook_event WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50").bind(customer.id).all<{ app_id: string }>(),
    customerExperimentsQuery(db, JSON.stringify([customer.id]), customer.id).all<CustomerExperiment>(),
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
    experiments: experiments.results,
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

// --- importing purchases (from RevenueCat or another backend; see src/office/import.ts) ----------

// One row per request. Importing writes every app's purchases, so it needs access to all apps.
admin.post("/import", requirePermission("customers:import"), async (c) => {
  if (p(c).apps !== null) return forbidden(c, "Importing needs access to all apps.");
  const b = await body<{ row: ImportRow; dry_run: boolean; project: string }>(c);
  if (!b.row || typeof b.row !== "object") return bad(c, 'Expected {"row": {...}}.');
  const project = projectOf(c, b.project);
  if (project instanceof Response) return project;
  const dryRun = b.dry_run === true;
  const appUserId = typeof b.row.app_user_id === "string" ? b.row.app_user_id : null;
  try {
    const result = await importRow(c.env.DB, c.env, c.get("deps"), project, b.row, {
      dryRun,
      extraWrites: dryRun ? [] : [auditBy(c, "customers.import", appUserId, { project: project.id, store: b.row.store ?? null, app: b.row.app ?? null })],
    });
    return c.json(result);
  } catch (err) {
    if (err instanceof ImportError) {
      if (err.status === 429 || err.status === 503) c.header("Retry-After", err.status === 429 ? "3600" : "30");
      return c.json({ code: err.code, message: err.message }, err.status);
    }
    throw err;
  }
});

// --- price experiments (src/experiments.ts) ------------------------------------------------------
// Experiments change what customers are offered, so changing them takes config:manage. Results add
// up purchases across every app, so only operators who see every app get them.

const EXPERIMENT_NAME_MAX = 100;
const EXPERIMENT_NOTES_MAX = 2000;

async function experimentOf(c: Ctx): Promise<{ row: ExperimentRow; project: ProjectConfig } | Response> {
  const row = await c.env.DB.prepare("SELECT * FROM experiment WHERE id = ?").bind(c.req.param("id")).first<ExperimentRow>();
  if (!row) return notFound(c, "Experiment");
  const project = c.get("config").projects.get(row.project_id);
  if (!project) return notFound(c, "Experiment"); // its project was removed from the config
  const choice = chooseProject(c.get("config"), p(c), row.project_id);
  if (!("project" in choice)) return notFound(c, "Experiment");
  return { row, project };
}

/** Validates variants from a request: 2 to 4 offerings from the project, weights adding up to 100. */
function parseVariants(project: ProjectConfig, raw: unknown): Variant[] | string {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_VARIANTS) return `variants must list 2 to ${MAX_VARIANTS} offerings; the first is the control.`;
  const variants: Variant[] = [];
  for (const [i, v] of raw.entries()) {
    const offering = (v as { offering_id?: unknown })?.offering_id;
    const weight = (v as { weight?: unknown })?.weight;
    if (typeof offering !== "string" || !project.offerings.some((o) => o.id === offering)) return `variants[${i}].offering_id must be one of the project's offerings: ${project.offerings.map((o) => o.id).join(", ") || "(none yet)"}.`;
    if (variants.some((x) => x.offering_id === offering)) return `Offering ${offering} is in two variants; each variant needs its own offering.`;
    if (!Number.isInteger(weight) || (weight as number) < 1 || (weight as number) > 99) return `variants[${i}].weight must be a whole percent from 1 to 99.`;
    variants.push({ id: VARIANT_IDS[i]!, offering_id: offering, weight: weight as number });
  }
  const total = variants.reduce((a, v) => a + v.weight, 0);
  if (total !== 100) return `The weights add up to ${total}; they must add up to 100.`;
  return variants;
}

function parseText(raw: unknown, field: string, max: number, required: boolean): string | { error: string } {
  if (raw === undefined || raw === null) return required ? { error: `${field} is required.` } : "";
  if (typeof raw !== "string") return { error: `${field} must be a string.` };
  const text = raw.trim();
  if (required && !text) return { error: `${field} is required.` };
  if (text.length > max) return { error: `${field} is at most ${max} characters.` };
  return text;
}

admin.get("/experiments", requirePermission("read"), async (c) => {
  const project = projectOf(c);
  if (project instanceof Response) return project;
  const { results } = await c.env.DB.prepare(
    `SELECT x.*, (SELECT count(*) FROM experiment_enrollment e WHERE e.experiment_id = x.id) AS enrolled
     FROM experiment x WHERE x.project_id = ? ORDER BY x.created_at DESC`,
  )
    .bind(project.id)
    .all<ExperimentRow & { enrolled: number }>();
  return c.json({ experiments: results.map((r) => ({ ...publicExperiment(r, project), enrolled: r.enrolled })) });
});

admin.post("/experiments", requirePermission("config:manage"), async (c) => {
  const b = await body<{ project: string; name: string; notes: string; variants: unknown }>(c);
  const project = projectOf(c, b.project);
  if (project instanceof Response) return project;
  const name = parseText(b.name, "name", EXPERIMENT_NAME_MAX, true);
  if (typeof name !== "string") return bad(c, name.error);
  const notes = parseText(b.notes, "notes", EXPERIMENT_NOTES_MAX, false);
  if (typeof notes !== "string") return bad(c, notes.error);
  const variants = parseVariants(project, b.variants);
  if (typeof variants === "string") return bad(c, variants);
  const row: ExperimentRow = {
    id: `exp_${randomToken().slice(0, 16)}`,
    project_id: project.id,
    name,
    notes,
    variants: JSON.stringify(variants),
    status: "draft",
    created_at: Date.now(),
    created_by: p(c).operator.email,
    started_at: null,
    stopped_at: null,
    results: null,
    results_at: null,
  };
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO experiment (id, project_id, name, notes, variants, status, created_at, created_by) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)").bind(
      row.id,
      row.project_id,
      row.name,
      row.notes,
      row.variants,
      row.created_at,
      row.created_by,
    ),
    auditBy(c, "experiment.create", row.id, { project: project.id, name, variants }),
  ]);
  return c.json({ experiment: publicExperiment(row, project) }, 201);
});

admin.get("/experiments/:id", requirePermission("read"), async (c) => {
  const found = await experimentOf(c);
  if (found instanceof Response) return found;
  return c.json({ experiment: publicExperiment(found.row, found.project) });
});

// Name and notes can change at any time; variants only before the experiment starts.
admin.patch("/experiments/:id", requirePermission("config:manage"), async (c) => {
  const found = await experimentOf(c);
  if (found instanceof Response) return found;
  const { row, project } = found;
  const b = await body<{ name: string; notes: string; variants: unknown }>(c);
  const next = { ...row };
  if ("name" in b) {
    const name = parseText(b.name, "name", EXPERIMENT_NAME_MAX, true);
    if (typeof name !== "string") return bad(c, name.error);
    next.name = name;
  }
  if ("notes" in b) {
    const notes = parseText(b.notes ?? "", "notes", EXPERIMENT_NOTES_MAX, false);
    if (typeof notes !== "string") return bad(c, notes.error);
    next.notes = notes;
  }
  if ("variants" in b) {
    if (row.status !== "draft") return c.json({ code: "conflict", message: "Variants can't change once an experiment has started: customers are already split. Stop it and create a new one." }, 409);
    const variants = parseVariants(project, b.variants);
    if (typeof variants === "string") return bad(c, variants);
    next.variants = JSON.stringify(variants);
  }
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE experiment SET name = ?, notes = ?, variants = ? WHERE id = ?").bind(next.name, next.notes, next.variants, row.id),
    auditBy(c, "experiment.update", row.id, { name: next.name, ...("variants" in b ? { variants: JSON.parse(next.variants) } : {}) }),
  ]);
  return c.json({ experiment: publicExperiment(next, project) });
});

admin.post("/experiments/:id/start", requirePermission("config:manage"), async (c) => {
  const found = await experimentOf(c);
  if (found instanceof Response) return found;
  const { row, project } = found;
  if (row.status !== "draft") return c.json({ code: "conflict", message: `This experiment is ${row.status}; only a draft can start.` }, 409);
  const missing = variantsOf(row).filter((v) => !project.offerings.some((o) => o.id === v.offering_id));
  if (missing.length) return bad(c, `These offerings are no longer in the config: ${missing.map((v) => v.offering_id).join(", ")}. Edit the variants first.`);
  const other = await c.env.DB.prepare("SELECT id, name FROM experiment WHERE project_id = ? AND status = 'running'").bind(project.id).first<{ id: string; name: string }>();
  if (other) return c.json({ code: "conflict", message: `"${other.name}" is already running in this project; stop it first. One experiment runs at a time, so each customer is in at most one.` }, 409);
  const now = Date.now();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE experiment SET status = 'running', started_at = ? WHERE id = ? AND status = 'draft'").bind(now, row.id),
      auditBy(c, "experiment.start", row.id, { project: project.id }),
    ]);
  } catch {
    // The unique index: another experiment started at the same moment.
    return c.json({ code: "conflict", message: "Another experiment is already running in this project; stop it first." }, 409);
  }
  forgetRunning();
  return c.json({ experiment: publicExperiment({ ...row, status: "running", started_at: now }, project) });
});

admin.post("/experiments/:id/stop", requirePermission("config:manage"), async (c) => {
  const found = await experimentOf(c);
  if (found instanceof Response) return found;
  const { row, project } = found;
  if (row.status !== "running") return c.json({ code: "conflict", message: `This experiment is ${row.status}; only a running one can stop.` }, 409);
  const now = Date.now();
  await c.env.DB.batch([
    // Results are recomputed with the end date.
    c.env.DB.prepare("UPDATE experiment SET status = 'stopped', stopped_at = ?, results = NULL, results_at = NULL WHERE id = ?").bind(now, row.id),
    auditBy(c, "experiment.stop", row.id, { project: project.id }),
  ]);
  forgetRunning();
  return c.json({ experiment: publicExperiment({ ...row, status: "stopped", stopped_at: now }, project) });
});

admin.delete("/experiments/:id", requirePermission("config:manage"), async (c) => {
  const found = await experimentOf(c);
  if (found instanceof Response) return found;
  const { row } = found;
  if (row.status === "running") return c.json({ code: "conflict", message: "Stop the experiment before deleting it." }, 409);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM experiment_enrollment WHERE experiment_id = ?").bind(row.id),
    c.env.DB.prepare("DELETE FROM experiment WHERE id = ?").bind(row.id),
    auditBy(c, "experiment.delete", row.id, { name: row.name }),
  ]);
  return c.json({ deleted: true });
});

// Computed from the ledger: a row or two per enrolled customer and their purchases (see
// experimentResults for how long they're kept).
admin.get("/experiments/:id/results", requirePermission("read"), async (c) => {
  const found = await experimentOf(c);
  if (found instanceof Response) return found;
  if (p(c).apps !== null) return forbidden(c, "Experiment results add up purchases in every app, so they're for operators who can see every app.");
  const environment = c.req.query("environment") === "sandbox" ? "sandbox" : "production";
  return c.json({ results: await experimentResults(c.env.DB, found.row, environment, c.req.query("refresh") === "1") });
});

// --- charts --------------------------------------------------------------------------------------

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
  const toMs = parseDay(to);
  const from = c.req.query("from") ?? (Number.isNaN(toMs) ? "" : dayOf(toMs - 89 * 864e5));
  const fromMs = parseDay(from);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || from > to) return bad(c, "from and to must be dates (YYYY-MM-DD), with from on or before to.");
  if ((toMs - fromMs) / 864e5 > MAX_CHART_DAYS) return bad(c, `A chart can cover at most ${MAX_CHART_DAYS} days.`);
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

// --- export (moving to Standard and back; see src/office/export.ts) ------------------------------

admin.get("/export", (c) => exportDenied(c) ?? exportInfo(c));
admin.post("/export", (c) => exportDenied(c) ?? exportInfo(c, (details) => auditBy(c, "data.exported", null, details)));
admin.get("/export/customer-info", (c) => exportDenied(c) ?? exportCustomerInfo(c));
admin.get("/export/tables/:table", (c) => exportDenied(c) ?? exportTable(c));

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
  const limit = pageLimit(c, 50, 200);
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
  const limit = pageLimit(c, 100, 500);
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
  const limit = pageLimit(c, 50, 200);
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

async function settingsOf(c: Ctx) {
  const [requireTotp, plan, sdkUrl] = await Promise.all([requireTotpForEveryone(c.env.DB), cloudflarePlan(c.env.DB), storedSdkUrl(c.env.DB)]);
  // sdk_url is what was set (null if nothing); sdk_url_guess is the workers.dev guess shown until then.
  // edition tells the shared dashboard which server it's on (Standard says "standard").
  return { require_totp: requireTotp, cloudflare_plan: plan, sdk_url: sdkUrl, sdk_url_guess: guessSdkUrl(new URL(c.req.url).origin), edition: EDITION };
}

admin.get("/settings", requirePermission("read"), async (c) => c.json(await settingsOf(c)));

const setSetting = (c: Ctx, key: string, value: string) =>
  c.env.DB.prepare(
    "INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).bind(key, value, Date.now());

// Send only the settings to change.
admin.put("/settings", requirePermission("settings:manage"), async (c) => {
  const b = await body<{ require_totp: boolean; cloudflare_plan: Plan; sdk_url: string | null }>(c);
  if (b.require_totp === undefined && b.cloudflare_plan === undefined && b.sdk_url === undefined) return bad(c, "Send require_totp, cloudflare_plan and/or sdk_url.");
  if (b.require_totp !== undefined && typeof b.require_totp !== "boolean") return bad(c, "require_totp must be true or false.");
  if (b.cloudflare_plan !== undefined && b.cloudflare_plan !== "free" && b.cloudflare_plan !== "paid") return bad(c, "cloudflare_plan must be free or paid.");
  if (b.require_totp && !p(c).operator.totp_enabled) return forbidden(c, "Turn on two-step sign-in for yourself first.");
  // sdk_url: an address, or null or "" to go back to the guess.
  let sdkUrl: string | null | undefined;
  if (b.sdk_url !== undefined) {
    if (b.sdk_url !== null && typeof b.sdk_url !== "string") return bad(c, "sdk_url must be an address or null.");
    if (!b.sdk_url?.trim()) sdkUrl = null;
    else {
      const parsed = parseSdkUrl(b.sdk_url);
      if ("error" in parsed) return bad(c, parsed.error);
      sdkUrl = parsed.url;
    }
  }
  const writes: D1PreparedStatement[] = [];
  if (b.require_totp !== undefined) writes.push(setSetting(c, "require_totp", String(b.require_totp)), auditBy(c, "setting.require_totp", null, { value: b.require_totp }));
  if (b.cloudflare_plan !== undefined) writes.push(setSetting(c, "cloudflare_plan", b.cloudflare_plan), auditBy(c, "setting.cloudflare_plan", null, { value: b.cloudflare_plan }));
  if (sdkUrl !== undefined) {
    writes.push(
      sdkUrl ? setSetting(c, "sdk_url", sdkUrl) : c.env.DB.prepare("DELETE FROM setting WHERE key = 'sdk_url'"),
      auditBy(c, "setting.sdk_url", null, { value: sdkUrl }),
    );
  }
  await c.env.DB.batch(writes);
  return c.json(await settingsOf(c));
});

// --- free-plan usage -----------------------------------------------------------------------------

async function usageReport(c: Ctx) {
  const [snapshot, plan] = await Promise.all([readUsage(c.env.DB), cloudflarePlan(c.env.DB)]);
  return {
    configured: usageConfigured(c.env),
    plan,
    updated_at: snapshot?.at || null,
    error: snapshot?.error ?? null,
    error_at: snapshot?.errorAt ?? null,
    metrics: assessUsage(snapshot, plan),
    edition: EDITION,
  };
}

admin.get("/usage", requirePermission("read"), async (c) => c.json(await usageReport(c)));

// Fetch now instead of waiting for the scheduled job (at most once a minute).
admin.post("/usage/refresh", requirePermission("read"), async (c) => {
  if (!usageConfigured(c.env)) return bad(c, "Usage alerts are off: set the CLOUDFLARE_ANALYTICS_TOKEN secret on the back office first.");
  const last = await readUsage(c.env.DB);
  if (Date.now() - Math.max(last?.at ?? 0, last?.errorAt ?? 0) >= 60_000) await refreshUsage(c.env, c.get("deps").fetch ?? fetch, Date.now(), true);
  return c.json(await usageReport(c));
});

admin.all("*", (c) => notFound(c, "Endpoint"));
