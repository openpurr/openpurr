// Operator sign-in for the back-office Worker: /admin/v1/auth/*.
//
// Sessions: a random token in an HttpOnly, Secure, SameSite=Strict cookie; only its SHA-256 is
// stored. Cookie-authenticated requests that change anything must carry an Origin header matching
// this Worker (CSRF protection; browsers always send Origin on POST).
//
// Sign-in rules (plan section 8.2):
//   - the same answer, with the same CPU cost, for an unknown email and a wrong password;
//   - rate limits per IP and per email, plus a 15-minute lockout after 10 failures in a row;
//   - TOTP when the operator has enabled it (or a one-time recovery code instead);
//   - setup links (24 h) let a new operator set a password; recovery links (15 min) sign in once.
//     Both are created by scripts/admin.mjs with the deployment's own credentials.

import type { Context } from "hono";
import { Hono } from "hono/tiny";
import type { AppEnv } from "../env";
import { cloudflareRateLimiters } from "../lib/rate-limit";
import {
  base32Encode,
  decryptTotpSecret,
  dummyPasswordCheck,
  encryptTotpSecret,
  hashPassword,
  newRecoveryCodes,
  newTotpSecret,
  normalizeRecoveryCode,
  OperatorSecretMissing,
  otpauthUri,
  randomToken,
  sha256Hex,
  verifyPassword,
  verifyTotp,
} from "./auth-crypto";

export const SESSION_COOKIE = "__Host-openpurr_session";
const SESSION_MS = 7 * 864e5;
const SETUP_SESSION_MS = 30 * 60_000;
const LOCKOUT_AFTER = 10;
const LOCKOUT_MS = 15 * 60_000;
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export interface Operator {
  id: string;
  email: string;
  name: string;
  role: "owner" | "admin" | "developer" | "viewer";
  app_ids: string | null;
  password_hash: string | null;
  totp_secret: string | null;
  totp_enabled: number;
  totp_last_step: number | null;
  failed_logins: number;
  locked_until: number | null;
  disabled_at: number | null;
}

export interface SessionInfo {
  operator: Operator;
  kind: "full" | "setup";
  tokenHash: string;
}

type Ctx = Context<AppEnv>;
const fail = (c: Ctx, status: 400 | 401 | 403 | 409 | 429 | 503, code: string, message: string) => c.json({ code, message }, status);

export function publicOperator(o: Operator) {
  return {
    id: o.id,
    email: o.email,
    name: o.name,
    role: o.role,
    app_ids: o.app_ids ? (JSON.parse(o.app_ids) as string[]) : null,
    totp_enabled: !!o.totp_enabled,
    has_password: !!o.password_hash,
  };
}

/** An audit log row. `source` is dashboard for cookie sessions. */
export function audit(
  db: D1Database,
  e: { operator?: Pick<Operator, "id" | "email"> | null; actor?: string; action: string; target?: string | null; details?: unknown; ip?: string | null; source?: string; tokenId?: string | null },
) {
  return db
    .prepare("INSERT INTO audit_log (at, operator_id, actor, token_id, source, action, target, details, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(
      Date.now(),
      e.operator?.id ?? null,
      e.actor ?? e.operator?.email ?? null,
      e.tokenId ?? null,
      e.source ?? "dashboard",
      e.action,
      e.target ?? null,
      e.details === undefined ? null : JSON.stringify(e.details),
      e.ip ?? null,
    );
}

export async function requireTotpForEveryone(db: D1Database) {
  const row = await db.prepare("SELECT value FROM setting WHERE key = 'require_totp'").first<{ value: string }>();
  return row?.value === "true";
}

function cookie(c: Ctx) {
  const header = c.req.header("cookie") ?? "";
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === SESSION_COOKIE) return part.slice(i + 1);
  }
  return null;
}

function setSessionCookie(c: Ctx, token: string, maxAgeMs: number) {
  c.header("Set-Cookie", `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(maxAgeMs / 1000)}`);
}

/** The signed-in operator for this request's session cookie, or null. */
export async function sessionFor(c: Ctx): Promise<SessionInfo | null> {
  const token = cookie(c);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT s.kind, s.expires_at, s.last_seen_at, o.* FROM session s JOIN operator o ON o.id = s.operator_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND o.disabled_at IS NULL`,
  )
    .bind(tokenHash, Date.now())
    .first<Operator & { kind: "full" | "setup"; expires_at: number; last_seen_at: number }>();
  if (!row) return null;
  if (Date.now() - row.last_seen_at > 3600_000) {
    c.executionCtx.waitUntil(c.env.DB.prepare("UPDATE session SET last_seen_at = ? WHERE token_hash = ?").bind(Date.now(), tokenHash).run());
  }
  const { kind, expires_at: _e, last_seen_at: _l, ...operator } = row;
  return { operator: operator as Operator, kind, tokenHash };
}

/** CSRF: a cookie-authenticated request that changes something must come from this origin. */
export function sameOrigin(c: Ctx) {
  const origin = c.req.header("origin");
  return !!origin && origin === new URL(c.req.url).origin;
}

async function startSession(c: Ctx, operatorId: string, kind: "full" | "setup") {
  const token = randomToken();
  const ttl = kind === "setup" ? SETUP_SESSION_MS : SESSION_MS;
  const now = Date.now();
  await c.env.DB.prepare("INSERT INTO session (token_hash, operator_id, kind, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(await sha256Hex(token), operatorId, kind, now, now + ttl, now)
    .run();
  setSessionCookie(c, token, ttl);
}

const ip = (c: Ctx) => c.req.header("cf-connecting-ip") ?? null;

export const auth = new Hono<AppEnv>();

// Every write here needs a same-origin request (login included: no cross-site sign-in forms).
auth.use("*", async (c, next) => {
  if (c.req.method !== "GET" && !sameOrigin(c)) return fail(c, 403, "bad_origin", "Requests must come from the openpurr dashboard.");
  // Checked up front: Hono routes a handler's thrown error to the app's onError, not back here.
  const secret = c.env.OPERATOR_SECRET;
  if (!secret || secret.length < 32) {
    return fail(c, 503, "not_configured", new OperatorSecretMissing("The Worker secret OPERATOR_SECRET must be set (at least 32 random characters).").message);
  }
  await next();
});

auth.post("/login", async (c) => {
  const body = await c.req.json<{ email?: unknown; password?: unknown; code?: unknown; recovery_code?: unknown }>().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) return fail(c, 400, "bad_request", "Email and password are required.");

  const limiters = (c.get("deps").rateLimiters ?? cloudflareRateLimiters)(c.env);
  const clientIp = ip(c);
  if ((clientIp && limiters.ip && !(await limiters.ip.allow(`login:${clientIp}`))) || (limiters.user && !(await limiters.user.allow(`login:${email}`)))) {
    return fail(c, 429, "rate_limited", "Too many sign-in attempts. Try again in a minute.");
  }

  const db = c.env.DB;
  const secret = c.env.OPERATOR_SECRET;
  const operator = await db.prepare("SELECT * FROM operator WHERE email = ? AND disabled_at IS NULL").bind(email).first<Operator>();
  const invalid = () => fail(c, 401, "invalid_credentials", "Wrong email or password.");

  if (!operator || !operator.password_hash) {
    await dummyPasswordCheck(secret, password);
    await audit(db, { actor: email, action: "auth.login_failed", details: { reason: "unknown" }, ip: clientIp }).run();
    return invalid();
  }
  if (operator.locked_until && operator.locked_until > Date.now()) {
    return fail(c, 429, "locked", "Too many failed sign-ins. Try again in 15 minutes, or use a recovery link.");
  }
  const { ok, rehash } = await verifyPassword(secret, password, operator.password_hash);
  if (!ok) {
    const failures = operator.failed_logins + 1;
    await db.batch([
      db.prepare("UPDATE operator SET failed_logins = ?, locked_until = ? WHERE id = ?").bind(
        failures,
        failures >= LOCKOUT_AFTER ? Date.now() + LOCKOUT_MS : operator.locked_until,
        operator.id,
      ),
      audit(db, { operator, action: "auth.login_failed", details: { reason: "password", failures }, ip: clientIp }),
    ]);
    return invalid();
  }

  // Second factor.
  const writes: D1PreparedStatement[] = [];
  if (operator.totp_enabled) {
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    const recovery = typeof body?.recovery_code === "string" ? normalizeRecoveryCode(body.recovery_code) : "";
    if (!code && !recovery) return fail(c, 401, "totp_required", "Enter the code from your authenticator app.");
    if (code) {
      const step = await verifyTotp(await decryptTotpSecret(secret, operator.totp_secret!), code, Date.now(), operator.totp_last_step);
      if (step === null) {
        await db.batch([
          db.prepare("UPDATE operator SET failed_logins = failed_logins + 1 WHERE id = ?").bind(operator.id),
          audit(db, { operator, action: "auth.login_failed", details: { reason: "totp" }, ip: clientIp }),
        ]);
        return fail(c, 401, "invalid_code", "That code didn't work. Check your authenticator app's time and try again.");
      }
      writes.push(db.prepare("UPDATE operator SET totp_last_step = ? WHERE id = ?").bind(step, operator.id));
    } else {
      const used = await db
        .prepare("UPDATE recovery_code SET used_at = ? WHERE operator_id = ? AND code_hash = ? AND used_at IS NULL")
        .bind(Date.now(), operator.id, await sha256Hex(recovery))
        .run();
      if (!used.meta.changes) {
        await audit(db, { operator, action: "auth.login_failed", details: { reason: "recovery_code" }, ip: clientIp }).run();
        return fail(c, 401, "invalid_code", "That recovery code isn't valid or was already used.");
      }
      writes.push(audit(db, { operator, action: "auth.recovery_code_used", ip: clientIp }));
    }
  }

  if (rehash) writes.push(db.prepare("UPDATE operator SET password_hash = ? WHERE id = ?").bind(await hashPassword(secret, password), operator.id));
  writes.push(
    db.prepare("UPDATE operator SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?").bind(Date.now(), operator.id),
    audit(db, { operator, action: "auth.login", ip: clientIp }),
  );
  await db.batch(writes);
  await startSession(c, operator.id, "full");
  return c.json({ operator: publicOperator(operator), totp_enrollment_required: !operator.totp_enabled && (await requireTotpForEveryone(db)) });
});

auth.post("/logout", async (c) => {
  const session = await sessionFor(c);
  if (session) {
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM session WHERE token_hash = ?").bind(session.tokenHash),
      audit(c.env.DB, { operator: session.operator, action: "auth.logout", ip: ip(c) }),
    ]);
  }
  c.header("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
  return c.json({});
});

auth.get("/me", async (c) => {
  const session = await sessionFor(c);
  if (!session) return fail(c, 401, "signed_out", "Not signed in.");
  return c.json({
    operator: publicOperator(session.operator),
    session: session.kind,
    totp_enrollment_required: !session.operator.totp_enabled && (await requireTotpForEveryone(c.env.DB)),
  });
});

// Redeem a setup or recovery link. Setup links give a short session that can only set a password.
auth.post("/link", async (c) => {
  const body = await c.req.json<{ token?: unknown }>().catch(() => null);
  if (typeof body?.token !== "string") return fail(c, 400, "bad_request", "token is required.");
  const db = c.env.DB;
  const tokenHash = await sha256Hex(body.token);
  const link = await db
    .prepare("SELECT l.purpose, o.* FROM login_link l JOIN operator o ON o.id = l.operator_id WHERE l.token_hash = ? AND l.used_at IS NULL AND l.expires_at > ? AND o.disabled_at IS NULL")
    .bind(tokenHash, Date.now())
    .first<Operator & { purpose: "setup" | "recovery" }>();
  if (!link) return fail(c, 401, "invalid_link", "This link is invalid, expired or already used. Ask for a new one.");
  const { purpose, ...operator } = link;
  await db.batch([
    db.prepare("UPDATE login_link SET used_at = ? WHERE token_hash = ?").bind(Date.now(), tokenHash),
    db.prepare("UPDATE operator SET failed_logins = 0, locked_until = NULL WHERE id = ?").bind(operator.id),
    audit(db, { operator, action: `auth.${purpose}_link_used`, ip: ip(c) }),
  ]);
  // A recovery link signs in fully: it's how a lost password or authenticator gets reset.
  await startSession(c, operator.id, purpose === "setup" ? "setup" : "full");
  return c.json({ operator: publicOperator(operator as Operator), session: purpose === "setup" ? "setup" : "full" });
});

auth.post("/password", async (c) => {
  const session = await sessionFor(c);
  if (!session) return fail(c, 401, "signed_out", "Not signed in.");
  const body = await c.req.json<{ current_password?: unknown; new_password?: unknown }>().catch(() => null);
  const next = typeof body?.new_password === "string" ? body.new_password : "";
  if (next.length < PASSWORD_MIN || next.length > PASSWORD_MAX) {
    return fail(c, 400, "weak_password", `Use ${PASSWORD_MIN} to ${PASSWORD_MAX} characters. A passphrase or a password manager works well.`);
  }
  const db = c.env.DB;
  const secret = c.env.OPERATOR_SECRET;
  const { operator } = session;
  // A full session changing an existing password must prove it knows the current one.
  if (session.kind === "full" && operator.password_hash) {
    const current = typeof body?.current_password === "string" ? body.current_password : "";
    if (!(await verifyPassword(secret, current, operator.password_hash)).ok) return fail(c, 401, "invalid_credentials", "The current password is wrong.");
  }
  await db.batch([
    db.prepare("UPDATE operator SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?").bind(await hashPassword(secret, next), operator.id),
    // Other sessions end; this one becomes a full session.
    db.prepare("DELETE FROM session WHERE operator_id = ? AND token_hash != ?").bind(operator.id, session.tokenHash),
    db.prepare("UPDATE session SET kind = 'full', expires_at = ? WHERE token_hash = ?").bind(Date.now() + SESSION_MS, session.tokenHash),
    audit(db, { operator, action: "auth.password_changed", ip: ip(c) }),
  ]);
  return c.json({ totp_enrollment_required: !operator.totp_enabled && (await requireTotpForEveryone(db)) });
});

/** A full session, or a 401 response. */
async function fullSession(c: Ctx) {
  const session = await sessionFor(c);
  return session?.kind === "full" ? session : null;
}

auth.post("/totp/setup", async (c) => {
  const session = await fullSession(c);
  if (!session) return fail(c, 401, "signed_out", "Not signed in.");
  if (session.operator.totp_enabled) return fail(c, 409, "already_enabled", "Two-step sign-in is already on.");
  const raw = newTotpSecret();
  await c.env.DB.prepare("UPDATE operator SET totp_secret = ? WHERE id = ?").bind(await encryptTotpSecret(c.env.OPERATOR_SECRET, raw), session.operator.id).run();
  const secretB32 = base32Encode(raw);
  return c.json({ secret: secretB32, otpauth_uri: otpauthUri(secretB32, session.operator.email) });
});

auth.post("/totp/enable", async (c) => {
  const session = await fullSession(c);
  if (!session) return fail(c, 401, "signed_out", "Not signed in.");
  const { operator } = session;
  if (operator.totp_enabled) return fail(c, 409, "already_enabled", "Two-step sign-in is already on.");
  if (!operator.totp_secret) return fail(c, 400, "no_setup", "Start with /totp/setup.");
  const body = await c.req.json<{ code?: unknown }>().catch(() => null);
  const step = await verifyTotp(await decryptTotpSecret(c.env.OPERATOR_SECRET, operator.totp_secret), String(body?.code ?? ""), Date.now(), null);
  if (step === null) return fail(c, 400, "invalid_code", "That code didn't work. Check your authenticator app's time and try again.");
  const codes = newRecoveryCodes();
  const db = c.env.DB;
  await db.batch([
    db.prepare("UPDATE operator SET totp_enabled = 1, totp_last_step = ? WHERE id = ?").bind(step, operator.id),
    db.prepare("DELETE FROM recovery_code WHERE operator_id = ?").bind(operator.id),
    ...(await Promise.all(codes.map(async (code) => db.prepare("INSERT INTO recovery_code (operator_id, code_hash) VALUES (?, ?)").bind(operator.id, await sha256Hex(code))))),
    audit(db, { operator, action: "auth.totp_enabled", ip: ip(c) }),
  ]);
  // Shown once. Each works one time in place of an authenticator code.
  return c.json({ recovery_codes: codes });
});

auth.post("/totp/disable", async (c) => {
  const session = await fullSession(c);
  if (!session) return fail(c, 401, "signed_out", "Not signed in.");
  const { operator } = session;
  const db = c.env.DB;
  if (await requireTotpForEveryone(db)) return fail(c, 403, "required", "The owner requires two-step sign-in for everyone.");
  const body = await c.req.json<{ password?: unknown }>().catch(() => null);
  if (!operator.password_hash || !(await verifyPassword(c.env.OPERATOR_SECRET, String(body?.password ?? ""), operator.password_hash)).ok) {
    return fail(c, 401, "invalid_credentials", "Confirm with your password.");
  }
  await db.batch([
    db.prepare("UPDATE operator SET totp_enabled = 0, totp_secret = NULL, totp_last_step = NULL WHERE id = ?").bind(operator.id),
    db.prepare("DELETE FROM recovery_code WHERE operator_id = ?").bind(operator.id),
    audit(db, { operator, action: "auth.totp_disabled", ip: ip(c) }),
  ]);
  return c.json({});
});
