// Who is calling the admin API, and what they may do.
//
// Two ways in:
//   - the dashboard session cookie (full and recovery sessions, not setup; changes must be same-origin, see auth.ts);
//   - "Authorization: Bearer pat_..." personal access tokens, for the CLI and MCP.
//
// Permission = the operator's ROLE, further limited by the token's SCOPES when a token is used:
//   viewer     read
//   developer  read, replay webhooks, manage secret keys
//   admin      everything except managing owners and owner-only settings
//   owner      everything
// An operator limited to certain apps (app_ids) only sees those apps' data.

import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";
import { type Operator, requireTotpForEveryone, sameOrigin, sessionFor } from "./auth";
import { sha256Hex } from "./auth-crypto";

export type Permission = "read" | "audit:read" | "webhooks:replay" | "keys:manage" | "operators:manage" | "settings:manage";
export const TOKEN_SCOPES = ["read", "write:grants", "write:webhooks", "admin"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

const ROLE_PERMISSIONS: Record<Operator["role"], Permission[]> = {
  viewer: ["read"],
  developer: ["read", "webhooks:replay", "keys:manage"],
  admin: ["read", "audit:read", "webhooks:replay", "keys:manage", "operators:manage"],
  owner: ["read", "audit:read", "webhooks:replay", "keys:manage", "operators:manage", "settings:manage"],
};

const SCOPE_PERMISSIONS: Record<TokenScope, Permission[]> = {
  read: ["read", "audit:read"],
  "write:webhooks": ["webhooks:replay"],
  // Grants arrive with the MCP tools (M6).
  "write:grants": [],
  admin: ["keys:manage", "operators:manage", "settings:manage", "audit:read"],
};

export interface Principal {
  operator: Operator;
  via: "session" | "token";
  tokenId: string | null;
  permissions: Set<Permission>;
  /** App IDs this operator may see; null = all apps. */
  apps: string[] | null;
}

export const ACCESS_TOKEN_PREFIX = "pat_";
const LAST_USED_EVERY_MS = 3600_000;

type Ctx = Context<AppEnv>;
const deny = (c: Ctx, status: 401 | 403, code: string, message: string) => c.json({ code, message }, status);

export function can(p: Principal, permission: Permission) {
  return p.permissions.has(permission);
}

export function canSeeApp(p: Principal, appId: string) {
  return p.apps === null || p.apps.includes(appId);
}

function principalOf(operator: Operator, via: Principal["via"], tokenId: string | null, scopes: TokenScope[] | null): Principal {
  let permissions = new Set(ROLE_PERMISSIONS[operator.role] ?? []);
  if (scopes) {
    const allowed = new Set(scopes.flatMap((s) => SCOPE_PERMISSIONS[s] ?? []));
    permissions = new Set([...permissions].filter((p) => allowed.has(p)));
  }
  return { operator, via, tokenId, permissions, apps: operator.app_ids ? (JSON.parse(operator.app_ids) as string[]) : null };
}

/** Authenticates every /admin/v1 request except /admin/v1/auth/*. Sets c.var.principal. */
export const adminAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.path.startsWith("/admin/v1/auth/")) return next();
  const header = c.req.header("authorization") ?? "";

  if (header.startsWith(`Bearer ${ACCESS_TOKEN_PREFIX}`)) {
    const db = c.env.DB;
    const row = await db
      .prepare(
        `SELECT t.id AS token_id, t.scopes, t.last_used_at AS token_last_used, o.* FROM access_token t JOIN operator o ON o.id = t.operator_id
         WHERE t.token_hash = ? AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > ?) AND o.disabled_at IS NULL`,
      )
      .bind(await sha256Hex(header.slice(7).trim()), Date.now())
      .first<Operator & { token_id: string; scopes: string; token_last_used: number | null }>();
    if (!row) return deny(c, 401, "invalid_token", "Invalid, expired or revoked access token.");
    const { token_id, scopes, token_last_used, ...operator } = row;
    if (!token_last_used || Date.now() - token_last_used > LAST_USED_EVERY_MS) {
      c.executionCtx.waitUntil(db.prepare("UPDATE access_token SET last_used_at = ? WHERE id = ?").bind(Date.now(), token_id).run());
    }
    c.set("principal", principalOf(operator as Operator, "token", token_id, JSON.parse(scopes) as TokenScope[]));
    return next();
  }

  const session = await sessionFor(c);
  if (!session || session.kind === "setup") return deny(c, 401, "signed_out", "Sign in, or send a personal access token.");
  if (c.req.method !== "GET" && !sameOrigin(c)) return deny(c, 403, "bad_origin", "Requests must come from the openpurr dashboard.");
  // When the owner requires two-step sign-in, operators without it can only see who they are.
  if (!session.operator.totp_enabled && c.req.path !== "/admin/v1/me" && (await requireTotpForEveryone(c.env.DB))) {
    return deny(c, 403, "totp_enrollment_required", "Set up two-step sign-in to continue.");
  }
  c.set("principal", principalOf(session.operator, "session", null, null));
  await next();
};

/** 403 unless the caller has `permission`. */
export function requirePermission(permission: Permission): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const p = c.get("principal");
    if (!p || !can(p, permission)) {
      return deny(c, 403, "forbidden", `This needs the ${permission} permission${p?.via === "token" ? " (check the token's scopes)" : ""}.`);
    }
    await next();
  };
}
