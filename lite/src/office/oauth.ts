// OAuth 2.1 for the MCP server, so clients that can't send a personal access token (Claude.ai
// connectors) can connect: the MCP authorization spec (2025-11-25). The same flow signs in the iOS
// app, whose tokens are issued for the admin API (/admin/v1) instead.
//
//   /.well-known/oauth-protected-resource[/mcp]   which authorization server protects /mcp (RFC 9728)
//   /.well-known/oauth-protected-resource/admin/v1   the same for the admin API
//   /.well-known/oauth-authorization-server       endpoints and capabilities (RFC 8414)
//   /oauth/register                               Dynamic Client Registration (RFC 7591), public clients only
//   /oauth/authorize                              checks the request, then hands off to the dashboard's consent screen
//   /oauth/token                                  authorization_code (PKCE S256 required) and refresh_token
//   /oauth/revoke                                 token revocation (RFC 7009)
//
// Clients are identified either by a Client ID Metadata Document (the client_id is an HTTPS URL
// to their metadata, fetched and cached; preferred by the spec) or by an ID from /oauth/register.
// Redirect URIs must match a registered one exactly and be HTTPS or localhost.
//
// Consent happens on the dashboard (/admin/oauth/consent), not here: the session cookie is
// SameSite=Strict, so it isn't sent on the cross-site navigation from the client, but it is sent
// on the dashboard's own requests. The operator signs in there if needed, sees who is asking,
// where the code goes and which scopes, and approves; the dashboard then redirects back.
//
// Tokens: access tokens (oat_..., 1 hour) work only at the resource they were issued for (/mcp, or
// /admin/v1 when the client asked for resource=<origin>/admin/v1);
// refresh tokens (ort_..., 30 days) rotate on every use. Only SHA-256 hashes are stored. What a
// token can do is the operator's role limited to the approved scopes, exactly like a personal
// access token. Operators see and revoke their connected apps under Access tokens.

import type { Context } from "hono";
import { Hono } from "hono/tiny";
import type { AppEnv } from "../env";
import { cloudflareRateLimiters } from "../lib/rate-limit";
import { audit, type Operator } from "./auth";
import { randomToken, sha256Hex } from "./auth-crypto";
import { iosClient, iosClientId } from "./ios";
import { can, type Permission, type Principal } from "./principal";

export const OAUTH_SCOPES = ["read", "write:grants", "write:webhooks", "write:config"] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];
const SCOPE_INFO: Record<OAuthScope, { label: string; needs: Permission }> = {
  read: { label: "Look up customers, purchases, charts, webhook deliveries and the audit log", needs: "read" },
  "write:grants": { label: "Grant and revoke promotional entitlements", needs: "grants:manage" },
  "write:webhooks": { label: "Replay webhook events", needs: "webhooks:replay" },
  "write:config": { label: "Change the configuration: apps, products, entitlements, offerings and webhooks", needs: "config:manage" },
};

export const ACCESS_PREFIX = "oat_";
const REFRESH_PREFIX = "ort_";
const ACCESS_TTL = 3600_000;
const REFRESH_TTL = 30 * 864e5;
const REQUEST_TTL = 10 * 60_000;
const CODE_TTL = 2 * 60_000;
const METADATA_TTL = 864e5;
const METADATA_MAX_BYTES = 64 * 1024;

type Ctx = Context<AppEnv>;
const origin = (c: Ctx) => new URL(c.req.url).origin;
/** The MCP server's canonical URI: tokens are issued for, and only accepted at, this resource. */
export const mcpResource = (c: Ctx) => `${origin(c)}/mcp`;
export const resourceMetadataUrl = (c: Ctx) => `${origin(c)}/.well-known/oauth-protected-resource/mcp`;
/** The admin API as an OAuth resource: the iOS app's tokens. */
export const adminResource = (c: Ctx) => `${origin(c)}/admin/v1`;
export const adminResourceMetadataUrl = (c: Ctx) => `${origin(c)}/.well-known/oauth-protected-resource/admin/v1`;
/** The resources tokens can be issued for, as a request names them; MCP when none is named. */
const resourceFor = (c: Ctx, requested: string | undefined) =>
  requested === undefined ? mcpResource(c) : [mcpResource(c), adminResource(c)].find((r) => sameResource(requested, r));

/** Same URI, compared the way RFC 8707 asks: case-insensitive scheme and host, no trailing slash. */
function sameResource(a: string, b: string) {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin.toLowerCase() === y.origin.toLowerCase() && x.pathname.replace(/\/+$/, "") === y.pathname.replace(/\/+$/, "") && !x.hash;
  } catch {
    return false;
  }
}

async function s256(verifier: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A redirect URI clients may use: HTTPS, or http on localhost (native and CLI clients). No fragments. */
function validRedirect(uri: unknown): uri is string {
  if (typeof uri !== "string" || uri.length > 2000) return false;
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

const isLocalhost = (uri: string) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(uri).hostname);

// CORS for the metadata and token endpoints (no cookies involved), for browser-based clients.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};
const json = (c: Ctx, body: unknown, status: 200 | 201 | 400 | 401 | 429 = 200, headers: Record<string, string> = {}) =>
  c.json(body, status, { ...CORS, "Cache-Control": "no-store", ...headers });
const oauthError = (c: Ctx, error: string, description: string, status: 400 | 401 | 429 = 400) => json(c, { error, error_description: description }, status);

// ---- Discovery ----------------------------------------------------------------------------------

export const wellKnown = new Hono<AppEnv>();
const protectedResource = (c: Ctx, resource = mcpResource(c)) =>
  json(c, {
    resource,
    authorization_servers: [origin(c)],
    scopes_supported: [...OAUTH_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "openpurr",
  });
wellKnown.get("/oauth-protected-resource", (c) => protectedResource(c));
wellKnown.get("/oauth-protected-resource/mcp", (c) => protectedResource(c));
wellKnown.get("/oauth-protected-resource/admin/v1", (c) => protectedResource(c, adminResource(c)));
wellKnown.get("/oauth-authorization-server", (c) =>
  json(c, {
    issuer: origin(c),
    authorization_endpoint: `${origin(c)}/oauth/authorize`,
    token_endpoint: `${origin(c)}/oauth/token`,
    registration_endpoint: `${origin(c)}/oauth/register`,
    revocation_endpoint: `${origin(c)}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...OAUTH_SCOPES],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  }),
);
wellKnown.options("*", (c) => c.body(null, 204, CORS));

// ---- Clients ------------------------------------------------------------------------------------

interface Client {
  id: string;
  kind: "registered" | "metadata_document";
  name: string;
  client_uri: string | null;
  redirect_uris: string[];
}

class ClientError extends Error {}

/** The first `max` UTF-16 code units of `s`, dropping a character that would be cut in half. */
function truncate(s: string, max: number) {
  const t = s.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(t) ? t.slice(0, -1) : t;
}

/** A Client ID Metadata Document URL: HTTPS with a path, a real host name (no IPs or localhost). */
function metadataUrl(clientId: string) {
  let u: URL;
  try {
    u = new URL(clientId);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.pathname === "/" || u.username || u.password || u.hash) return null;
  if (u.hostname === "localhost" || /^[\d.]+$/.test(u.hostname) || u.hostname.startsWith("[")) return null;
  return u;
}

async function fetchMetadataDocument(c: Ctx, url: URL): Promise<Client> {
  const fetchImpl = c.get("deps").fetch ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(url.toString(), { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(5000) });
  } catch {
    throw new ClientError(`Couldn't fetch the client's metadata document at ${url}.`);
  }
  if (res.status !== 200) throw new ClientError(`The client's metadata document at ${url} answered HTTP ${res.status}.`);
  const text = await res.text();
  if (text.length > METADATA_MAX_BYTES) throw new ClientError("The client's metadata document is too large.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ClientError("The client's metadata document isn't valid JSON.");
  }
  // JSON that isn't an object (null, a number, a string, an array) has no client_id: refused like one that doesn't match.
  const doc = (parsed !== null && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  if (doc.client_id !== url.toString()) throw new ClientError("The client's metadata document has a different client_id than its URL.");
  const redirects = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.filter(validRedirect) : [];
  if (!redirects.length) throw new ClientError("The client's metadata document has no usable redirect_uris (HTTPS or localhost).");
  const name = typeof doc.client_name === "string" && doc.client_name.trim() ? truncate(doc.client_name.trim(), 100) : url.hostname;
  const clientUri = typeof doc.client_uri === "string" && doc.client_uri.startsWith("https://") ? truncate(doc.client_uri, 500) : null;
  return { id: url.toString(), kind: "metadata_document", name, client_uri: clientUri, redirect_uris: redirects };
}

/** The client for a client_id: a registered one, or a metadata document (cached for a day). */
async function resolveClient(c: Ctx, clientId: string): Promise<Client | null> {
  const db = c.env.DB;
  // This deployment's own iOS app (src/office/ios.ts): known without fetching anything. Saved like a
  // fetched document, since requests and grants refer to the client's row.
  if (clientId === iosClientId(c)) {
    const client = iosClient(c);
    await saveMetadataClient(db, client);
    return client;
  }
  const row = await db.prepare("SELECT id, kind, name, client_uri, redirect_uris, fetched_at FROM oauth_client WHERE id = ?").bind(clientId).first<{
    id: string;
    kind: Client["kind"];
    name: string;
    client_uri: string | null;
    redirect_uris: string;
    fetched_at: number | null;
  }>();
  const url = metadataUrl(clientId);
  if (row && (row.kind === "registered" || (row.fetched_at && Date.now() - row.fetched_at < METADATA_TTL))) {
    return { ...row, redirect_uris: JSON.parse(row.redirect_uris) as string[] };
  }
  if (!url) return null;
  const client = await fetchMetadataDocument(c, url);
  await saveMetadataClient(db, client);
  return client;
}

const saveMetadataClient = (db: D1Database, client: Client) =>
  db
    .prepare(
      `INSERT INTO oauth_client (id, kind, name, client_uri, redirect_uris, created_at, fetched_at) VALUES (?, 'metadata_document', ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, client_uri = excluded.client_uri, redirect_uris = excluded.redirect_uris, fetched_at = excluded.fetched_at`,
    )
    .bind(client.id, client.name, client.client_uri, JSON.stringify(client.redirect_uris), Date.now(), Date.now())
    .run();

// ---- Endpoints ----------------------------------------------------------------------------------

export const oauth = new Hono<AppEnv>();
oauth.options("*", (c) => c.body(null, 204, CORS));

/** Form or JSON body, as an object of strings. */
async function params(c: Ctx): Promise<Record<string, string>> {
  const type = c.req.header("content-type") ?? "";
  if (type.includes("application/json")) {
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    return Object.fromEntries(Object.entries(b ?? {}).filter(([, v]) => typeof v === "string")) as Record<string, string>;
  }
  const form = await c.req.parseBody().catch(() => ({}));
  return Object.fromEntries(Object.entries(form).filter(([, v]) => typeof v === "string")) as Record<string, string>;
}

oauth.post("/register", async (c) => {
  const ip = c.req.header("cf-connecting-ip");
  const limiter = (c.get("deps").rateLimiters ?? cloudflareRateLimiters)(c.env).ip;
  if (ip && limiter && !(await limiter.allow(`oauth-register:${ip}`))) return oauthError(c, "slow_down", "Too many registrations; try again in a minute.", 429);
  const b = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!b || typeof b !== "object") return oauthError(c, "invalid_client_metadata", "Send the client metadata as JSON.");
  const redirects = b.redirect_uris;
  if (!Array.isArray(redirects) || !redirects.length || redirects.length > 10 || !redirects.every(validRedirect)) {
    return oauthError(c, "invalid_redirect_uri", "redirect_uris must list 1 to 10 HTTPS or localhost URLs.");
  }
  if (b.token_endpoint_auth_method !== undefined && b.token_endpoint_auth_method !== "none") {
    return oauthError(c, "invalid_client_metadata", 'Only public clients are supported (token_endpoint_auth_method "none"), with PKCE.');
  }
  const grantTypes = (b.grant_types as unknown[] | undefined) ?? ["authorization_code", "refresh_token"];
  if (!Array.isArray(grantTypes) || !grantTypes.every((g) => g === "authorization_code" || g === "refresh_token")) {
    return oauthError(c, "invalid_client_metadata", "grant_types may only include authorization_code and refresh_token.");
  }
  const name = typeof b.client_name === "string" && b.client_name.trim() ? truncate(b.client_name.trim(), 100) : "Unnamed MCP client";
  const clientUri = typeof b.client_uri === "string" && b.client_uri.startsWith("https://") ? truncate(b.client_uri, 500) : null;
  const id = `opc_${randomToken()}`;
  const now = Date.now();
  await c.env.DB.prepare("INSERT INTO oauth_client (id, kind, name, client_uri, redirect_uris, created_at) VALUES (?, 'registered', ?, ?, ?, ?)")
    .bind(id, name, clientUri, JSON.stringify(redirects), now)
    .run();
  return json(
    c,
    {
      client_id: id,
      client_id_issued_at: Math.floor(now / 1000),
      client_name: name,
      ...(clientUri ? { client_uri: clientUri } : {}),
      redirect_uris: redirects,
      grant_types: grantTypes,
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
  );
});

oauth.get("/authorize", async (c) => {
  const q = c.req.query();
  // Until the client and redirect URI are known good, errors are shown here, never redirected.
  const page = (message: string) => c.text(`openpurr couldn't start signing in this app: ${message}`, 400, { "Cache-Control": "no-store" });
  if (!q.client_id) return page("client_id is missing.");
  let client: Client | null;
  try {
    client = await resolveClient(c, q.client_id);
  } catch (err) {
    if (err instanceof ClientError) return page(err.message);
    throw err;
  }
  if (!client) return page("this app isn't registered (unknown client_id).");
  const redirectUri = q.redirect_uri ?? (client.redirect_uris.length === 1 ? client.redirect_uris[0] : undefined);
  if (!redirectUri || !client.redirect_uris.includes(redirectUri)) return page("the redirect_uri doesn't match one the app registered.");

  const back = (params: Record<string, string | undefined>) => {
    const u = new URL(redirectUri);
    for (const [k, v] of Object.entries({ ...params, state: q.state, iss: origin(c) })) if (v !== undefined) u.searchParams.set(k, v);
    return c.redirect(u.toString(), 302);
  };
  if (q.response_type !== "code") return back({ error: "unsupported_response_type", error_description: "Only response_type=code is supported." });
  if (!q.code_challenge || q.code_challenge_method !== "S256") return back({ error: "invalid_request", error_description: "PKCE with code_challenge_method=S256 is required." });
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge)) return back({ error: "invalid_request", error_description: "code_challenge isn't a valid S256 challenge." });
  const resource = resourceFor(c, q.resource);
  if (!resource) return back({ error: "invalid_target", error_description: `This server only issues tokens for ${mcpResource(c)} and ${adminResource(c)}.` });
  const requested = q.scope ? q.scope.split(/\s+/).filter((s): s is OAuthScope => (OAUTH_SCOPES as readonly string[]).includes(s)) : [...OAUTH_SCOPES];
  if (!requested.length) return back({ error: "invalid_scope", error_description: `Scopes: ${OAUTH_SCOPES.join(" ")}.` });

  const id = randomToken();
  const now = Date.now();
  await c.env.DB.prepare(
    "INSERT INTO oauth_request (id, client_id, redirect_uri, state, code_challenge, scope, resource, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, client.id, redirectUri, q.state ?? null, q.code_challenge, [...new Set(requested)].join(" "), resource, now, now + REQUEST_TTL)
    .run();
  return c.redirect(`/admin/oauth/consent?request=${encodeURIComponent(id)}`, 302);
});

/** Issues a fresh access and refresh token pair for a grant (both stored as hashes). */
async function newTokens() {
  const access = `${ACCESS_PREFIX}${randomToken()}`;
  const refresh = `${REFRESH_PREFIX}${randomToken()}`;
  const now = Date.now();
  return { access, refresh, accessHash: await sha256Hex(access), refreshHash: await sha256Hex(refresh), accessExpires: now + ACCESS_TTL, refreshExpires: now + REFRESH_TTL };
}

const tokenResponse = (c: Ctx, t: { access: string; refresh: string }, scopes: string[]) =>
  json(c, { access_token: t.access, token_type: "Bearer", expires_in: ACCESS_TTL / 1000, refresh_token: t.refresh, scope: scopes.join(" ") }, 200, { Pragma: "no-cache" });

oauth.post("/token", async (c) => {
  const p = await params(c);
  const db = c.env.DB;
  const now = Date.now();
  if (p.grant_type === "authorization_code") {
    if (!p.code || !p.client_id || !p.code_verifier) return oauthError(c, "invalid_request", "code, client_id and code_verifier are required.");
    const r = await db
      .prepare("SELECT * FROM oauth_request WHERE code_hash = ?")
      .bind(await sha256Hex(p.code))
      .first<{ id: string; client_id: string; redirect_uri: string; code_challenge: string; resource: string; expires_at: number; operator_id: string; granted_scope: string; used_at: number | null; grant_id: string | null }>();
    if (!r) return oauthError(c, "invalid_grant", "Unknown or expired authorization code.");
    // A code used twice may have been stolen: end what the first use created (OAuth 2.1 asks to
    // revoke the tokens issued from it; the grant holds them, rotated or not).
    const reused = async (grantId: string | null) => {
      if (grantId) await db.prepare("UPDATE oauth_grant SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now, grantId).run();
      return oauthError(c, "invalid_grant", "This authorization code was already used.");
    };
    if (r.used_at !== null) return reused(r.grant_id);
    if (r.expires_at < now) return oauthError(c, "invalid_grant", "The authorization code expired; sign in again.");
    if (r.client_id !== p.client_id) return oauthError(c, "invalid_grant", "The code was issued to another client.");
    if (p.redirect_uri !== undefined && p.redirect_uri !== r.redirect_uri) return oauthError(c, "invalid_grant", "redirect_uri doesn't match the authorization request.");
    if (p.resource !== undefined && !sameResource(p.resource, r.resource)) return oauthError(c, "invalid_target", "resource doesn't match the authorization request.");
    if ((await s256(p.code_verifier)) !== r.code_challenge) return oauthError(c, "invalid_grant", "code_verifier doesn't match the code_challenge (PKCE).");
    const operator = await db.prepare("SELECT id FROM operator WHERE id = ? AND disabled_at IS NULL").bind(r.operator_id).first();
    if (!operator) return oauthError(c, "invalid_grant", "The operator who approved this is no longer active.");
    const scopes = r.granted_scope.split(" ");
    const t = await newTokens();
    const grantId = crypto.randomUUID();
    // The code is claimed by a conditional UPDATE, and the grant is created only if that claim is
    // ours, in one batch (one transaction): D1 has no transaction to lock the request between the
    // read above and this write, so of two exchanges at the same moment only one claims it.
    const [claim] = await db.batch([
      db.prepare("UPDATE oauth_request SET used_at = ?, grant_id = ? WHERE id = ? AND used_at IS NULL RETURNING id").bind(now, grantId, r.id),
      db
        .prepare(
          `INSERT INTO oauth_grant (id, client_id, operator_id, scopes, resource, access_hash, access_expires_at, refresh_hash, refresh_expires_at, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM oauth_request WHERE id = ? AND grant_id = ?)`,
        )
        .bind(grantId, r.client_id, r.operator_id, JSON.stringify(scopes), r.resource, t.accessHash, t.accessExpires, t.refreshHash, t.refreshExpires, now, r.id, grantId),
    ]);
    if (!claim?.results.length) {
      // Another exchange claimed it in between: this is the second use, which ends the first's grant.
      const winner = await db.prepare("SELECT grant_id FROM oauth_request WHERE id = ?").bind(r.id).first<{ grant_id: string | null }>();
      return reused(winner?.grant_id ?? null);
    }
    return tokenResponse(c, t, scopes);
  }

  if (p.grant_type === "refresh_token") {
    if (!p.refresh_token || !p.client_id) return oauthError(c, "invalid_request", "refresh_token and client_id are required.");
    const refreshHash = await sha256Hex(p.refresh_token);
    const g = await db
      .prepare(
        `SELECT g.id, g.client_id, g.scopes FROM oauth_grant g JOIN operator o ON o.id = g.operator_id
         WHERE g.refresh_hash = ? AND g.revoked_at IS NULL AND g.refresh_expires_at > ? AND o.disabled_at IS NULL`,
      )
      .bind(refreshHash, now)
      .first<{ id: string; client_id: string; scopes: string }>();
    if (!g || g.client_id !== p.client_id) return oauthError(c, "invalid_grant", "Unknown, expired or revoked refresh token.");
    let scopes = JSON.parse(g.scopes) as string[];
    if (p.scope) {
      const narrower = [...new Set(p.scope.split(/\s+/))].filter((s) => scopes.includes(s));
      if (!narrower.length) return oauthError(c, "invalid_scope", "Refresh can only keep or narrow the approved scopes.");
      scopes = narrower;
    }
    const t = await newTokens();
    // Rotation: the old refresh token stops working now. The grant is only rotated if it still holds
    // the token we were given, in the same statement, so of two refreshes with one token at the same
    // moment one wins and the other is refused.
    const rotated = await db
      .prepare(
        `UPDATE oauth_grant SET access_hash = ?, access_expires_at = ?, refresh_hash = ?, refresh_expires_at = ?, scopes = ?
         WHERE id = ? AND refresh_hash = ? AND revoked_at IS NULL RETURNING id`,
      )
      .bind(t.accessHash, t.accessExpires, t.refreshHash, t.refreshExpires, JSON.stringify(scopes), g.id, refreshHash)
      .first();
    if (!rotated) return oauthError(c, "invalid_grant", "Unknown, expired or revoked refresh token.");
    return tokenResponse(c, t, scopes);
  }
  return oauthError(c, "unsupported_grant_type", "grant_type must be authorization_code or refresh_token.");
});

// RFC 7009: always 200, whether or not the token was known.
oauth.post("/revoke", async (c) => {
  const p = await params(c);
  if (p.token) {
    const hash = await sha256Hex(p.token);
    await c.env.DB.prepare("UPDATE oauth_grant SET revoked_at = ? WHERE (access_hash = ? OR refresh_hash = ?) AND revoked_at IS NULL").bind(Date.now(), hash, hash).run();
  }
  return c.body(null, 200, CORS);
});

// ---- Used by the MCP server and the admin API ----------------------------------------------------

/** The operator and scopes behind an OAuth access token, if it's valid for `resource`. */
export async function oauthTokenOwner(db: D1Database, token: string, resource: string) {
  const row = await db
    .prepare(
      `SELECT g.id AS grant_id, g.scopes, g.resource, g.last_used_at AS grant_last_used, o.* FROM oauth_grant g JOIN operator o ON o.id = g.operator_id
       WHERE g.access_hash = ? AND g.revoked_at IS NULL AND g.access_expires_at > ? AND o.disabled_at IS NULL`,
    )
    .bind(await sha256Hex(token), Date.now())
    .first<Operator & { grant_id: string; scopes: string; resource: string; grant_last_used: number | null }>();
  if (!row || !sameResource(row.resource, resource)) return null; // audience: only tokens issued for this server
  const { grant_id, scopes, resource: _r, grant_last_used, ...operator } = row;
  return { operator: operator as Operator, grantId: grant_id, scopes: JSON.parse(scopes) as OAuthScope[], lastUsed: grant_last_used };
}

/** The consent screen's view of a pending authorization. */
export async function pendingRequest(db: D1Database, id: string, principal: Principal) {
  const r = await db
    .prepare(
      `SELECT r.id, r.redirect_uri, r.scope, r.resource, r.expires_at, r.code_hash, c.id AS client_id, c.kind, c.name, c.client_uri
       FROM oauth_request r JOIN oauth_client c ON c.id = r.client_id WHERE r.id = ?`,
    )
    .bind(id)
    .first<{ id: string; redirect_uri: string; scope: string; resource: string; expires_at: number; code_hash: string | null; client_id: string; kind: string; name: string; client_uri: string | null }>();
  if (!r || r.code_hash || r.expires_at < Date.now()) return null;
  const redirect = new URL(r.redirect_uri);
  return {
    id: r.id,
    client: { name: r.name, uri: r.client_uri, kind: r.kind, metadata_url: r.kind === "metadata_document" ? r.client_id : null },
    redirect_host: redirect.host,
    redirect_uri: r.redirect_uri,
    /** What the tokens are for: the MCP server, or the admin API (the iOS app). */
    api: new URL(r.resource).pathname.replace(/\/+$/, "") === "/admin/v1" ? "admin" : "mcp",
    localhost: isLocalhost(r.redirect_uri),
    scopes: r.scope.split(" ").map((s) => ({ scope: s, label: SCOPE_INFO[s as OAuthScope]?.label ?? s, allowed: can(principal, SCOPE_INFO[s as OAuthScope]?.needs ?? "read") })),
  };
}

/** Approves (with the chosen scopes) or denies a pending authorization. Returns where to send the browser. */
export async function decideRequest(c: Ctx, id: string, principal: Principal, decision: { approve: boolean; scopes?: string[] }) {
  const db = c.env.DB;
  const pending = await pendingRequest(db, id, principal);
  if (!pending) return null;
  const r = await db.prepare("SELECT redirect_uri, state FROM oauth_request WHERE id = ?").bind(id).first<{ redirect_uri: string; state: string | null }>();
  if (!r) return null; // denied a moment ago
  const back = new URL(r.redirect_uri);
  if (r.state !== null) back.searchParams.set("state", r.state);
  back.searchParams.set("iss", origin(c));
  const ip = c.req.header("cf-connecting-ip") ?? null;
  // Each decision is taken by one conditional statement that only matches a request still waiting
  // for one, before anything else is written: D1 has no transaction to lock the request between the
  // read above and the write, so of two decisions at the same moment one wins and the other is a 404
  // (an approval never hands out a code that a moment-earlier decision made useless).
  if (!decision.approve) {
    const deleted = await db.prepare("DELETE FROM oauth_request WHERE id = ? AND code_hash IS NULL RETURNING id").bind(id).first();
    if (!deleted) return null;
    await audit(db, { operator: principal.operator, action: "oauth.denied", target: pending.client.name, ip }).run();
    back.searchParams.set("error", "access_denied");
    return { redirect: back.toString() };
  }
  const allowed = pending.scopes.filter((s) => s.allowed).map((s) => s.scope);
  const scopes = [...new Set(decision.scopes ?? allowed)].filter((s) => allowed.includes(s)); // each once, in the order given
  if (!scopes.length) throw new Error("Pick at least one permission you have.");
  const code = randomToken();
  const approved = await db
    .prepare("UPDATE oauth_request SET operator_id = ?, granted_scope = ?, code_hash = ?, expires_at = ? WHERE id = ? AND code_hash IS NULL RETURNING id")
    .bind(principal.operator.id, scopes.join(" "), await sha256Hex(code), Date.now() + CODE_TTL, id)
    .first();
  if (!approved) return null;
  await audit(db, {
    operator: principal.operator,
    action: "oauth.authorized",
    target: pending.client.name,
    details: { client: pending.client.metadata_url ?? pending.client.name, scopes, redirect_host: pending.redirect_host },
    ip,
  }).run();
  back.searchParams.set("code", code);
  return { redirect: back.toString() };
}

/** An operator's connected apps. */
export async function listGrants(db: D1Database, operatorId: string) {
  const { results } = await db
    .prepare(
      `SELECT g.id, g.scopes, g.created_at, g.last_used_at, g.refresh_expires_at, c.name AS client_name, c.client_uri, c.kind, c.id AS client_id
       FROM oauth_grant g JOIN oauth_client c ON c.id = g.client_id
       WHERE g.operator_id = ? AND g.revoked_at IS NULL AND g.refresh_expires_at > ? ORDER BY g.created_at DESC`,
    )
    .bind(operatorId, Date.now())
    .all<{ id: string; scopes: string; created_at: number; last_used_at: number | null; refresh_expires_at: number; client_name: string; client_uri: string | null; kind: string; client_id: string }>();
  return results.map((g) => ({ ...g, scopes: JSON.parse(g.scopes) as string[], client_id: g.kind === "metadata_document" ? g.client_id : undefined }));
}

export async function revokeGrantFor(c: Ctx, operator: Operator, grantId: string) {
  const db = c.env.DB;
  const g = await db
    .prepare("SELECT g.id, c.name FROM oauth_grant g JOIN oauth_client c ON c.id = g.client_id WHERE g.id = ? AND g.operator_id = ? AND g.revoked_at IS NULL")
    .bind(grantId, operator.id)
    .first<{ id: string; name: string }>();
  if (!g) return false;
  // Revoked only if still active, in the same statement, so two revokes at the same moment revoke
  // (and audit) it once.
  const revoked = await db.prepare("UPDATE oauth_grant SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL RETURNING id").bind(Date.now(), g.id).first();
  if (!revoked) return false;
  await audit(db, { operator, action: "oauth.revoked", target: g.name, ip: c.req.header("cf-connecting-ip") ?? null }).run();
  return true;
}

/** Hourly: forget unfinished authorizations, unused registrations and long-dead grants. */
export async function pruneOAuth(db: D1Database, now: number) {
  const results = await db.batch([
    db.prepare("DELETE FROM oauth_request WHERE id IN (SELECT id FROM oauth_request WHERE expires_at < ? LIMIT 500)").bind(now - 864e5),
    db.prepare("DELETE FROM oauth_grant WHERE id IN (SELECT id FROM oauth_grant WHERE (revoked_at IS NOT NULL AND revoked_at < ?) OR refresh_expires_at < ? LIMIT 500)").bind(now - 30 * 864e5, now - 30 * 864e5),
    db.prepare(
      `DELETE FROM oauth_client WHERE id IN (SELECT c.id FROM oauth_client c WHERE c.created_at < ?
         AND NOT EXISTS (SELECT 1 FROM oauth_grant g WHERE g.client_id = c.id)
         AND NOT EXISTS (SELECT 1 FROM oauth_request r WHERE r.client_id = c.id) LIMIT 500)`,
    ).bind(now - 864e5),
  ]);
  return results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
}
