// OAuth 2.1 for the MCP server, end to end the way Claude.ai does it: 401 → metadata discovery →
// registration (or a Client ID Metadata Document) → authorize → consent on the dashboard → token
// exchange with PKCE → /mcp → refresh → revoke. Plus the attacks the spec cares about.
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { mountOffice } from "../src/office/app";
import { SESSION_COOKIE } from "../src/office/auth";
import { randomToken, sha256Hex } from "../src/office/auth-crypto";
import { mountSdk } from "../src/sdk-app";
import { testConfig } from "./helpers";

const SECRET = "test-operator-secret-0123456789abcdef";
const ORIGIN = "https://openpurr.test";
const MCP = `${ORIGIN}/mcp`;
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const envWith = () => ({ ...env, OPERATOR_SECRET: SECRET });

// A client metadata document host, for the Client ID Metadata Document flow.
const METADATA_URL = "https://client.example/oauth/metadata.json";
let metadataDoc: Record<string, unknown> = {};
const fakeFetch = (async (input: RequestInfo | URL) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("https://client.example/")) return new Response(JSON.stringify(metadataDoc), { headers: { "content-type": "application/json" } });
  return new Response("not found", { status: 404 });
}) as typeof fetch;
const app = createApp({ config: testConfig, appleRoots: [], rateLimiters: () => ({}), fetch: fakeFetch }, (a) => (mountSdk(a), mountOffice(a)));

async function request(path: string, init: RequestInit & { session?: string } = {}) {
  const ctx = createExecutionContext();
  const headers = new Headers(init.headers);
  if (init.session) headers.set("cookie", `${SESSION_COOKIE}=${init.session}`);
  const res = await app.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers, redirect: "manual" }), envWith(), ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const jsonOf = async (res: Response) => (await res.json()) as any;

let n = 0;
async function signedIn(role: "owner" | "developer" | "viewer") {
  const id = crypto.randomUUID();
  const session = randomToken();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO operator (id, email, name, role, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, `oauth-${role}${++n}@example.com`, role, role, Date.now()),
    env.DB.prepare("INSERT INTO session (token_hash, operator_id, kind, created_at, expires_at, last_seen_at) VALUES (?, ?, 'full', ?, ?, ?)").bind(
      await sha256Hex(session),
      id,
      Date.now(),
      Date.now() + 3600_000,
      Date.now(),
    ),
  ]);
  return { id, session };
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

async function register(body: Record<string, unknown> = {}) {
  return request("/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: [CALLBACK], ...body }) });
}

function authorizeUrl(clientId: string, challenge: string, extra: Record<string, string> = {}) {
  const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: "S256", state: "xyz", scope: "read write:grants", resource: MCP, ...extra });
  return `/oauth/authorize?${q}`;
}

/** Authorize, approve on the dashboard as `session`, and return the code. */
async function approvedCode(clientId: string, session: string, challenge: string, scopes?: string[]) {
  const start = await request(authorizeUrl(clientId, challenge));
  expect(start.status).toBe(302);
  const consent = new URL(start.headers.get("location")!, ORIGIN);
  expect(consent.pathname).toBe("/admin/oauth/consent");
  const id = consent.searchParams.get("request")!;
  const decided = await request(`/admin/v1/oauth/requests/${id}/approve`, { method: "POST", session, headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(scopes ? { scopes } : {}) });
  expect(decided.status).toBe(200);
  const back = new URL((await jsonOf(decided)).redirect);
  expect(back.origin + back.pathname).toBe(CALLBACK);
  expect(back.searchParams.get("state")).toBe("xyz");
  expect(back.searchParams.get("iss")).toBe(ORIGIN);
  return back.searchParams.get("code")!;
}

async function exchange(params: Record<string, string>) {
  return request("/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString() });
}

async function mcpCall(token: string, method = "tools/list") {
  const res = await request("/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method }),
  });
  return { status: res.status, body: res.status === 200 ? await jsonOf(res) : null, header: res.headers.get("www-authenticate") };
}

describe("discovery", () => {
  it("a 401 from /mcp points at the protected-resource metadata, which points at the authorization server", async () => {
    const r = await mcpCall("");
    expect(r.status).toBe(401);
    expect(r.header).toBe(`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp", scope="read"`);
    for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
      const prm = await jsonOf(await request(path));
      expect(prm).toMatchObject({ resource: MCP, authorization_servers: [ORIGIN], scopes_supported: ["read", "write:grants", "write:webhooks", "write:config"] });
    }
    const as = await jsonOf(await request("/.well-known/oauth-authorization-server"));
    expect(as).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      registration_endpoint: `${ORIGIN}/oauth/register`,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: true,
    });
    const preflight = await request("/oauth/token", { method: "OPTIONS" });
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("the authorization code flow", () => {
  it("registers, authorizes, exchanges with PKCE, calls /mcp, refreshes and revokes", async () => {
    const reg = await register();
    expect(reg.status).toBe(201);
    const { client_id: clientId } = await jsonOf(reg);
    expect(clientId).toMatch(/^opc_/);
    const owner = await signedIn("owner");
    const { verifier, challenge } = await pkce();
    const code = await approvedCode(clientId, owner.session, challenge);

    expect(await jsonOf(await exchange({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: "wrong".repeat(10), redirect_uri: CALLBACK }))).toMatchObject({ error: "invalid_grant" });
    const tokenRes = await exchange({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: verifier, redirect_uri: CALLBACK, resource: MCP });
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.headers.get("cache-control")).toBe("no-store");
    const tokens = await jsonOf(tokenRes);
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "read write:grants" });
    expect(tokens.access_token).toMatch(/^oat_/);
    expect(tokens.refresh_token).toMatch(/^ort_/);

    const listed = await mcpCall(tokens.access_token);
    expect(listed.status).toBe(200);
    expect(listed.body.result.tools.map((t: { name: string }) => t.name)).toEqual(expect.arrayContaining(["explain_entitlement", "grant_entitlement"]));
    expect(listed.body.result.tools.map((t: { name: string }) => t.name)).not.toContain("replay_webhook"); // not approved
    // OAuth tokens are only for /mcp.
    expect((await request("/admin/v1/me", { headers: { authorization: `Bearer ${tokens.access_token}` } })).status).toBe(401);

    const refreshed = await jsonOf(await exchange({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId }));
    expect(refreshed.access_token).toMatch(/^oat_/);
    expect((await mcpCall(tokens.access_token)).status).toBe(401); // rotated out
    expect(await jsonOf(await exchange({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId }))).toMatchObject({ error: "invalid_grant" });
    expect((await mcpCall(refreshed.access_token)).status).toBe(200);

    // The operator sees the connected app and revokes it from the dashboard.
    const grants = (await jsonOf(await request("/admin/v1/oauth/grants", { session: owner.session }))).grants;
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ client_name: "Claude", scopes: ["read", "write:grants"] });
    expect((await request(`/admin/v1/oauth/grants/${grants[0].id}/revoke`, { method: "POST", session: owner.session, headers: { origin: ORIGIN } })).status).toBe(200);
    const after = await mcpCall(refreshed.access_token);
    expect(after.status).toBe(401);
    expect(after.header).toMatch(/error="invalid_token"/);

    const { results } = await env.DB.prepare("SELECT action, target FROM audit_log WHERE operator_id = ? ORDER BY id").bind(owner.id).all();
    expect(results).toEqual([
      { action: "oauth.authorized", target: "Claude" },
      { action: "oauth.revoked", target: "Claude" },
    ]);
  });

  it("a code works once; using it again ends what it created", async () => {
    const { client_id: clientId } = await jsonOf(await register());
    const owner = await signedIn("owner");
    const { verifier, challenge } = await pkce();
    const code = await approvedCode(clientId, owner.session, challenge);
    const first = await jsonOf(await exchange({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: verifier }));
    expect((await mcpCall(first.access_token)).status).toBe(200);
    expect(await jsonOf(await exchange({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: verifier }))).toMatchObject({ error: "invalid_grant" });
    expect((await mcpCall(first.access_token)).status).toBe(401);
  });

  it("a code exchanged twice at the same moment gets tokens once, and the second use ends them", async () => {
    const { client_id: clientId } = await jsonOf(await register());
    const owner = await signedIn("owner");
    const { verifier, challenge } = await pkce();
    const code = await approvedCode(clientId, owner.session, challenge);
    const both = await Promise.all([1, 2].map(() => exchange({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: verifier })));
    expect(both.map((r) => r.status).sort()).toEqual([200, 400]);
    const won = both.find((r) => r.status === 200)!;
    const lost = both.find((r) => r.status === 400)!;
    expect(await jsonOf(lost)).toMatchObject({ error: "invalid_grant", error_description: "This authorization code was already used." });
    const { n } = (await env.DB.prepare("SELECT count(*) AS n FROM oauth_grant WHERE client_id = ?").bind(clientId).first<{ n: number }>())!;
    expect(n).toBe(1);
    // As with a code used twice one after the other, the tokens the code made are ended.
    expect((await mcpCall((await jsonOf(won)).access_token)).status).toBe(401);
  });

  it("a refresh token used twice at the same moment rotates once", async () => {
    const { client_id: clientId } = await jsonOf(await register());
    const owner = await signedIn("owner");
    const { verifier, challenge } = await pkce();
    const code = await approvedCode(clientId, owner.session, challenge);
    const t = await jsonOf(await exchange({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: verifier }));
    const both = await Promise.all([1, 2].map(() => exchange({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: clientId })));
    expect(both.map((r) => r.status).sort()).toEqual([200, 400]);
    const won = both.find((r) => r.status === 200)!;
    const lost = both.find((r) => r.status === 400)!;
    expect(await jsonOf(lost)).toMatchObject({ error: "invalid_grant" });
    const fresh = await jsonOf(won);
    expect((await mcpCall(fresh.access_token)).status).toBe(200);
    expect((await exchange({ grant_type: "refresh_token", refresh_token: fresh.refresh_token, client_id: clientId })).status).toBe(200);
  });

  it("a request decided twice at the same moment is decided once, and an approval's code works", async () => {
    const { client_id: clientId } = await jsonOf(await register());
    const owner = await signedIn("owner");
    for (const decisions of [["approve", "approve"], ["approve", "deny"], ["deny", "deny"]]) {
      const { verifier, challenge } = await pkce();
      const start = await request(authorizeUrl(clientId, challenge));
      const id = new URL(start.headers.get("location")!, ORIGIN).searchParams.get("request")!;
      const before = (await env.DB.prepare("SELECT count(*) AS n FROM audit_log WHERE operator_id = ?").bind(owner.id).first<{ n: number }>())!.n;
      const both = await Promise.all(
        decisions.map((d) => request(`/admin/v1/oauth/requests/${id}/${d}`, { method: "POST", session: owner.session, headers: { origin: ORIGIN, "content-type": "application/json" }, body: "{}" })),
      );
      expect(both.map((r) => r.status).sort()).toEqual([200, 404]);
      const after = (await env.DB.prepare("SELECT count(*) AS n FROM audit_log WHERE operator_id = ?").bind(owner.id).first<{ n: number }>())!.n;
      expect(after - before).toBe(1);
      const back = new URL((await jsonOf(both.find((r) => r.status === 200)!)).redirect);
      const code = back.searchParams.get("code");
      if (code) expect((await exchange({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: verifier })).status).toBe(200);
      else expect(back.searchParams.get("error")).toBe("access_denied");
    }
  });

  it("a connected app revoked twice at the same moment is revoked (and audited) once", async () => {
    const { client_id: clientId } = await jsonOf(await register());
    const owner = await signedIn("owner");
    const { verifier, challenge } = await pkce();
    const code = await approvedCode(clientId, owner.session, challenge);
    await exchange({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: verifier });
    const [grant] = (await jsonOf(await request("/admin/v1/oauth/grants", { session: owner.session }))).grants;
    const both = await Promise.all([1, 2].map(() => request(`/admin/v1/oauth/grants/${grant.id}/revoke`, { method: "POST", session: owner.session, headers: { origin: ORIGIN } })));
    expect(both.map((r) => r.status).sort()).toEqual([200, 404]);
    const { n } = (await env.DB.prepare("SELECT count(*) AS n FROM audit_log WHERE operator_id = ? AND action = 'oauth.revoked'").bind(owner.id).first<{ n: number }>())!;
    expect(n).toBe(1);
  });

  it("a viewer can only approve what their role allows, and denying redirects with access_denied", async () => {
    const { client_id: clientId } = await jsonOf(await register());
    const viewer = await signedIn("viewer");
    const { verifier, challenge } = await pkce();
    const start = await request(authorizeUrl(clientId, challenge));
    const id = new URL(start.headers.get("location")!, ORIGIN).searchParams.get("request")!;
    const view = await jsonOf(await request(`/admin/v1/oauth/requests/${id}`, { session: viewer.session }));
    expect(view).toMatchObject({ client: { name: "Claude" }, redirect_host: "claude.ai", localhost: false });
    expect(view.scopes).toEqual([expect.objectContaining({ scope: "read", allowed: true }), expect.objectContaining({ scope: "write:grants", allowed: false })]);
    const code = await approvedCode(clientId, viewer.session, challenge, ["read", "write:grants"]);
    expect((await jsonOf(await exchange({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: verifier }))).scope).toBe("read");

    const again = await request(authorizeUrl(clientId, (await pkce()).challenge));
    const id2 = new URL(again.headers.get("location")!, ORIGIN).searchParams.get("request")!;
    const denied = await jsonOf(await request(`/admin/v1/oauth/requests/${id2}/deny`, { method: "POST", session: viewer.session, headers: { origin: ORIGIN } }));
    expect(new URL(denied.redirect).searchParams.get("error")).toBe("access_denied");
    expect((await request(`/admin/v1/oauth/requests/${id2}`, { session: viewer.session })).status).toBe(404);
  });

  it("refuses bad requests", async () => {
    const { client_id: clientId } = await jsonOf(await register());
    const { challenge } = await pkce();
    // Before the redirect URI is trusted: an error page, no redirect.
    expect((await request(authorizeUrl("opc_unknown", challenge))).status).toBe(400);
    expect((await request(authorizeUrl(clientId, challenge, { redirect_uri: "https://evil.example/cb" }))).status).toBe(400);
    // After: back to the client with an error.
    const errorOf = async (extra: Record<string, string>) => new URL((await request(authorizeUrl(clientId, challenge, extra))).headers.get("location")!).searchParams.get("error");
    expect(await errorOf({ code_challenge_method: "plain" })).toBe("invalid_request");
    expect(await errorOf({ resource: "https://other.example/mcp" })).toBe("invalid_target");
    expect(await errorOf({ scope: "admin everything" })).toBe("invalid_scope");
    expect(await errorOf({ response_type: "token" })).toBe("unsupported_response_type");
    // Registration rules.
    expect((await register({ redirect_uris: ["http://example.com/cb"] })).status).toBe(400); // http only on localhost
    expect((await register({ redirect_uris: ["http://localhost:8123/cb"] })).status).toBe(201);
    expect((await register({ token_endpoint_auth_method: "client_secret_basic" })).status).toBe(400);
    expect(await jsonOf(await exchange({ grant_type: "password" }))).toMatchObject({ error: "unsupported_grant_type" });
    // A token from /oauth/revoke is gone.
    const owner = await signedIn("owner");
    const p = await pkce();
    const code = await approvedCode(clientId, owner.session, p.challenge);
    const t = await jsonOf(await exchange({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: p.verifier }));
    expect((await request("/oauth/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `token=${t.refresh_token}` })).status).toBe(200);
    expect((await mcpCall(t.access_token)).status).toBe(401);
  });
});

describe("Client ID Metadata Documents", () => {
  it("uses an HTTPS URL as the client_id, fetching and checking the document", async () => {
    metadataDoc = { client_id: METADATA_URL, client_name: "Example MCP Client", redirect_uris: [CALLBACK], token_endpoint_auth_method: "none" };
    const owner = await signedIn("owner");
    const { verifier, challenge } = await pkce();
    const start = await request(authorizeUrl(METADATA_URL, challenge));
    const id = new URL(start.headers.get("location")!, ORIGIN).searchParams.get("request")!;
    expect((await jsonOf(await request(`/admin/v1/oauth/requests/${id}`, { session: owner.session }))).client).toMatchObject({ name: "Example MCP Client", metadata_url: METADATA_URL });
    const code = await approvedCode(METADATA_URL, owner.session, challenge);
    const t = await jsonOf(await exchange({ grant_type: "authorization_code", code, client_id: METADATA_URL, code_verifier: verifier }));
    expect((await mcpCall(t.access_token)).status).toBe(200);
  });

  it("refuses a document whose client_id doesn't match its URL, and non-HTTPS or IP client IDs", async () => {
    await env.DB.prepare("DELETE FROM oauth_client WHERE id = ?").bind("https://client.example/oauth/other.json").run();
    metadataDoc = { client_id: "https://attacker.example/x.json", client_name: "Fake", redirect_uris: [CALLBACK] };
    const { challenge } = await pkce();
    const bad = await request(authorizeUrl("https://client.example/oauth/other.json", challenge));
    expect(bad.status).toBe(400);
    expect(await bad.text()).toMatch(/different client_id/);
    expect((await request(authorizeUrl("http://client.example/meta.json", challenge))).status).toBe(400);
    expect((await request(authorizeUrl("https://10.0.0.1/meta.json", challenge))).status).toBe(400);
  });
});
