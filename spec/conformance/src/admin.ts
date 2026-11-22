// The admin API (/admin/v1), the operator sign-in flow and the MCP server, over HTTP. Operators
// other than the reset's owner are made the way a real owner does: invite (setup link), set a
// password, sign in.

import { TARGET } from "./env";
import { request, type Res } from "./helpers";
import { owner } from "./server";

/** The server's origin: session-cookie writes must carry it (CSRF check). */
export const ORIGIN = new URL(TARGET).origin;
export const SESSION_COOKIE = "__Host-openpurr_session";
export const PASSWORD = "a long test passphrase";

export interface Auth {
  /** Session cookie value. */
  session?: string;
  /** Access token (pat_...). Defaults to the owner token when neither is given. */
  token?: string;
  /** Neither: an anonymous request. */
  none?: boolean;
}

/** Calls /admin/v1{path}. `origin: null` leaves the Origin header out. */
export function admin(method: string, path: string, auth: Auth = {}, opts: { body?: unknown; origin?: string | null; headers?: Record<string, string> } = {}) {
  const token = auth.token ?? (auth.session || auth.none ? undefined : owner());
  return request(method, `/admin/v1${path}`, {
    body: opts.body,
    headers: {
      "content-type": "application/json",
      ...(auth.session ? { cookie: `${SESSION_COOKIE}=${auth.session}` } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(opts.origin === null ? {} : { origin: opts.origin ?? ORIGIN }),
      ...opts.headers,
    },
  });
}

/** The session token a response set, if any. */
export function sessionFrom(res: Res) {
  const header = res.headers.get("set-cookie") ?? "";
  const m = new RegExp(`${SESSION_COOKIE}=([^;]*)`).exec(header);
  return m && m[1] ? m[1] : null;
}

/** The token in a setup or recovery link (it rides in the #fragment). */
export const linkToken = (link: string) => new URL(link).hash.replace(/^#token=/, "");

let n = 0;

/**
 * A signed-in operator with `role`, invited by the owner: { id, email, password, session }.
 * `apps` limits them to some apps.
 */
export async function createOperator(role: "owner" | "admin" | "developer" | "viewer", opts: { apps?: string[]; email?: string } = {}) {
  const email = opts.email ?? `${role}${++n}-${Date.now()}@example.com`;
  const invited = await admin("POST", "/operators", {}, { body: { email, name: role, role, app_ids: opts.apps ?? null } });
  if (invited.status !== 201) throw new Error(`invite failed: ${invited.status} ${invited.text}`);
  const link = await admin("POST", "/auth/link", { none: true }, { body: { token: linkToken(invited.body.setup_link) } });
  const setup = sessionFrom(link);
  if (!setup) throw new Error(`setup link failed: ${link.status} ${link.text}`);
  const pw = await admin("POST", "/auth/password", { session: setup }, { body: { new_password: PASSWORD } });
  if (pw.status !== 200) throw new Error(`setting the password failed: ${pw.status} ${pw.text}`);
  return { id: invited.body.id as string, email, password: PASSWORD, session: setup };
}

/** Signs in; returns the response and its session token. */
export async function login(email: string, password: string, extra: Record<string, unknown> = {}) {
  const res = await admin("POST", "/auth/login", { none: true }, { body: { email, password, ...extra } });
  return { res, session: sessionFrom(res) };
}

/** An access token for a signed-in operator, limited to `scopes`. */
export async function createToken(session: string, scopes: string[], opts: { expires_in_days?: number; name?: string } = {}) {
  const res = await admin("POST", "/tokens", { session }, { body: { name: opts.name ?? "test", scopes, ...opts } });
  if (res.status !== 201) throw new Error(`token failed: ${res.status} ${res.text}`);
  return res.body.token as string;
}

/** A role with an access token in one go. */
export async function operatorToken(role: "owner" | "admin" | "developer" | "viewer", scopes: string[], opts: { apps?: string[] } = {}) {
  const op = await createOperator(role, opts);
  return { ...op, token: await createToken(op.session, scopes) };
}

// --- MCP ------------------------------------------------------------------------------------------

let rpcId = 0;

/** One JSON-RPC call to /mcp with a bearer token (default: the owner's). */
export function mcp(method: string, params: unknown = {}, opts: { token?: string | null; headers?: Record<string, string> } = {}) {
  const token = opts.token === undefined ? owner() : opts.token;
  return request("POST", "/mcp", {
    body: { jsonrpc: "2.0", id: ++rpcId, method, params },
    headers: {
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
  });
}

/** Calls an MCP tool; returns the JSON-RPC response body. */
export async function mcpTool(name: string, args: Record<string, unknown> = {}, opts: { token?: string | null } = {}) {
  return (await mcp("tools/call", { name, arguments: args }, opts)).body;
}

/** Replaces the current config through the admin API (as an operator would). */
export async function putConfig(document: object, opts: { token?: string; note?: string } = {}) {
  const current = await admin("GET", "/config", { token: opts.token });
  return admin("PUT", "/config", { token: opts.token }, { body: { document, base_id: current.body.id, note: opts.note } });
}
