// OAuth 2.1 for the MCP server, end to end the way Claude.ai does it: 401 → metadata discovery →
// registration (or a Client ID Metadata Document) → authorize → consent on the dashboard → token
// exchange with PKCE → /mcp → refresh → revoke. Plus the attacks the spec cares about, and expiry
// of requests, codes and access tokens (on the server's clock). Ported from lite/test/oauth.test.ts.

import { beforeEach, describe, expect, it } from "vitest";
import { admin, advanceClock, b64url, createOperator, ORIGIN, request, reset } from "../src";

const MCP = `${ORIGIN}/mcp`;
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const METADATA_URL = "https://client.example/oauth/metadata.json";

const signedIn = (role: "owner" | "developer" | "viewer") => createOperator(role);

async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

const register = (body: Record<string, unknown> = {}) => request("POST", "/oauth/register", { body: { client_name: "Claude", redirect_uris: [CALLBACK], ...body } });

function authorizeUrl(clientId: string, challenge: string, extra: Record<string, string> = {}) {
  const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: "S256", state: "xyz", scope: "read write:grants", resource: MCP, ...extra });
  return `/oauth/authorize?${q}`;
}

/** Starts an authorization; returns the pending request's id from the consent redirect. */
async function startAuthorize(clientId: string, challenge: string) {
  const start = await request("GET", authorizeUrl(clientId, challenge));
  expect(start.status).toBe(302);
  const consent = new URL(start.headers.get("location")!, ORIGIN);
  expect(consent.pathname).toBe("/admin/oauth/consent");
  return consent.searchParams.get("request")!;
}

/** Authorize, approve on the dashboard as `session`, and return the code. */
async function approvedCode(clientId: string, session: string, challenge: string, scopes?: string[]) {
  const id = await startAuthorize(clientId, challenge);
  const decided = await admin("POST", `/oauth/requests/${id}/approve`, { session }, { body: scopes ? { scopes } : {} });
  expect(decided.status).toBe(200);
  const back = new URL(decided.body.redirect);
  expect(back.origin + back.pathname).toBe(CALLBACK);
  expect(back.searchParams.get("state")).toBe("xyz");
  expect(back.searchParams.get("iss")).toBe(ORIGIN);
  return back.searchParams.get("code")!;
}

const exchange = (params: Record<string, string>) =>
  request("POST", "/oauth/token", { rawBody: new URLSearchParams(params).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });

async function mcpCall(token: string, method = "tools/list") {
  const res = await request("POST", "/mcp", {
    body: { jsonrpc: "2.0", id: 1, method },
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), accept: "application/json, text/event-stream" },
  });
  return { status: res.status, body: res.status === 200 ? res.body : null, header: res.headers.get("www-authenticate") };
}

/** A registered client, a signed-in owner and tokens they approved. */
async function connected() {
  const { client_id: clientId } = (await register()).body;
  const owner = await signedIn("owner");
  const { verifier, challenge } = await pkce();
  const code = await approvedCode(clientId, owner.session, challenge);
  const tokens = (await exchange({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: verifier })).body;
  return { clientId, owner, tokens };
}

beforeEach(async () => {
  await reset();
});

describe("discovery", () => {
  it("a 401 from /mcp points at the protected-resource metadata, which points at the authorization server", async () => {
    const r = await mcpCall("");
    expect(r.status).toBe(401);
    expect(r.header).toBe(`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp", scope="read"`);
    for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
      const prm = (await request("GET", path)).body;
      expect(prm).toMatchObject({ resource: MCP, authorization_servers: [ORIGIN], scopes_supported: ["read", "write:grants", "write:webhooks", "write:config"] });
    }
    const as = (await request("GET", "/.well-known/oauth-authorization-server")).body;
    expect(as).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      registration_endpoint: `${ORIGIN}/oauth/register`,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: true,
    });
    const preflight = await request("OPTIONS", "/oauth/token");
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("the authorization code flow", () => {
  it("registers, authorizes, exchanges with PKCE, calls /mcp, refreshes and revokes", async () => {
    const reg = await register();
    expect(reg.status).toBe(201);
    const { client_id: clientId } = reg.body;
    expect(clientId).toMatch(/^opc_/);
    const owner = await signedIn("owner");
    const { verifier, challenge } = await pkce();
    const code = await approvedCode(clientId, owner.session, challenge);

    expect((await exchange({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: "wrong".repeat(10), redirect_uri: CALLBACK })).body).toMatchObject({ error: "invalid_grant" });
    const tokenRes = await exchange({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: verifier, redirect_uri: CALLBACK, resource: MCP });
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.headers.get("cache-control")).toBe("no-store");
    const tokens = tokenRes.body;
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "read write:grants" });
    expect(tokens.access_token).toMatch(/^oat_/);
    expect(tokens.refresh_token).toMatch(/^ort_/);

    const listed = await mcpCall(tokens.access_token);
    expect(listed.status).toBe(200);
    expect(listed.body.result.tools.map((t: { name: string }) => t.name)).toEqual(expect.arrayContaining(["explain_entitlement", "grant_entitlement"]));
    expect(listed.body.result.tools.map((t: { name: string }) => t.name)).not.toContain("replay_webhook"); // not approved
    // OAuth tokens are only for /mcp.
    expect((await admin("GET", "/me", { token: tokens.access_token })).status).toBe(401);

    const refreshed = (await exchange({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId })).body;
    expect(refreshed.access_token).toMatch(/^oat_/);
    expect((await mcpCall(tokens.access_token)).status).toBe(401); // rotated out
    expect((await exchange({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId })).body).toMatchObject({ error: "invalid_grant" });
    expect((await mcpCall(refreshed.access_token)).status).toBe(200);

    // The operator sees the connected app and revokes it from the dashboard.
    const grants = (await admin("GET", "/oauth/grants", { session: owner.session })).body.grants;
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ client_name: "Claude", scopes: ["read", "write:grants"] });
    expect((await admin("POST", `/oauth/grants/${grants[0].id}/revoke`, { session: owner.session })).status).toBe(200);
    const after = await mcpCall(refreshed.access_token);
    expect(after.status).toBe(401);
    expect(after.header).toMatch(/error="invalid_token"/);

    const entries = (await admin("GET", "/audit")).body.entries as { operator_id: string; action: string; target: string }[];
    const oauthEntries = entries.filter((e) => e.operator_id === owner.id && e.action.startsWith("oauth.")).reverse();
    expect(oauthEntries.map(({ action, target }) => ({ action, target }))).toEqual([
      { action: "oauth.authorized", target: "Claude" },
      { action: "oauth.revoked", target: "Claude" },
    ]);
  });

  it("a code works once; using it again ends what it created", async () => {
    const { client_id: clientId } = (await register()).body;
    const owner = await signedIn("owner");
    const { verifier, challenge } = await pkce();
    const code = await approvedCode(clientId, owner.session, challenge);
    const first = (await exchange({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: verifier })).body;
    expect((await mcpCall(first.access_token)).status).toBe(200);
    expect((await exchange({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: verifier })).body).toMatchObject({ error: "invalid_grant" });
    expect((await mcpCall(first.access_token)).status).toBe(401);
  });

  it("a viewer can only approve what their role allows, and denying redirects with access_denied", async () => {
    const { client_id: clientId } = (await register()).body;
    const viewer = await signedIn("viewer");
    const { verifier, challenge } = await pkce();
    const id = await startAuthorize(clientId, challenge);
    const view = (await admin("GET", `/oauth/requests/${id}`, { session: viewer.session })).body;
    expect(view).toMatchObject({ client: { name: "Claude" }, redirect_host: "claude.ai", localhost: false });
    expect(view.scopes).toEqual([expect.objectContaining({ scope: "read", allowed: true }), expect.objectContaining({ scope: "write:grants", allowed: false })]);
    const code = await approvedCode(clientId, viewer.session, challenge, ["read", "write:grants"]);
    expect((await exchange({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: verifier })).body.scope).toBe("read");

    const id2 = await startAuthorize(clientId, (await pkce()).challenge);
    const denied = (await admin("POST", `/oauth/requests/${id2}/deny`, { session: viewer.session })).body;
    expect(new URL(denied.redirect).searchParams.get("error")).toBe("access_denied");
    expect((await admin("GET", `/oauth/requests/${id2}`, { session: viewer.session })).status).toBe(404);
  });

  it("refuses bad requests", async () => {
    const { client_id: clientId } = (await register()).body;
    const { challenge } = await pkce();
    // Before the redirect URI is trusted: an error page, no redirect.
    expect((await request("GET", authorizeUrl("opc_unknown", challenge))).status).toBe(400);
    expect((await request("GET", authorizeUrl(clientId, challenge, { redirect_uri: "https://evil.example/cb" }))).status).toBe(400);
    // After: back to the client with an error.
    const errorOf = async (extra: Record<string, string>) => new URL((await request("GET", authorizeUrl(clientId, challenge, extra))).headers.get("location")!).searchParams.get("error");
    expect(await errorOf({ code_challenge_method: "plain" })).toBe("invalid_request");
    expect(await errorOf({ resource: "https://other.example/mcp" })).toBe("invalid_target");
    expect(await errorOf({ scope: "admin everything" })).toBe("invalid_scope");
    expect(await errorOf({ response_type: "token" })).toBe("unsupported_response_type");
    // Registration rules.
    expect((await register({ redirect_uris: ["http://example.com/cb"] })).status).toBe(400); // http only on localhost
    expect((await register({ redirect_uris: ["http://localhost:8123/cb"] })).status).toBe(201);
    expect((await register({ token_endpoint_auth_method: "client_secret_basic" })).status).toBe(400);
    expect((await exchange({ grant_type: "password" })).body).toMatchObject({ error: "unsupported_grant_type" });
    // A token from /oauth/revoke is gone.
    const owner = await signedIn("owner");
    const p = await pkce();
    const code = await approvedCode(clientId, owner.session, p.challenge);
    const t = (await exchange({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: p.verifier })).body;
    const revoked = await request("POST", "/oauth/revoke", { rawBody: `token=${t.refresh_token}`, headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(revoked.status).toBe(200);
    expect((await mcpCall(t.access_token)).status).toBe(401);
  });
});

// Not in Lite's in-process tests: expiry, driven by the server's clock.
describe("expiry", () => {
  it("a sign-in request lasts 10 minutes", async () => {
    const { client_id: clientId } = (await register()).body;
    const owner = await signedIn("owner");
    const id = await startAuthorize(clientId, (await pkce()).challenge);
    await advanceClock(11 * 60_000);
    expect((await admin("GET", `/oauth/requests/${id}`, { session: owner.session })).status).toBe(404);
    expect((await admin("POST", `/oauth/requests/${id}/approve`, { session: owner.session }, { body: {} })).status).toBe(404);
  });

  it("an authorization code lasts 2 minutes", async () => {
    const { client_id: clientId } = (await register()).body;
    const owner = await signedIn("owner");
    const { verifier, challenge } = await pkce();
    const code = await approvedCode(clientId, owner.session, challenge);
    await advanceClock(3 * 60_000);
    expect((await exchange({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: verifier })).body).toMatchObject({ error: "invalid_grant" });
  });

  it("an access token lasts an hour; the refresh token still gets a new one", async () => {
    const { clientId, tokens } = await connected();
    await advanceClock(59 * 60_000);
    expect((await mcpCall(tokens.access_token)).status).toBe(200);
    await advanceClock(2 * 60_000);
    const expired = await mcpCall(tokens.access_token);
    expect(expired.status).toBe(401);
    expect(expired.header).toMatch(/error="invalid_token"/);
    const refreshed = (await exchange({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId })).body;
    expect((await mcpCall(refreshed.access_token)).status).toBe(200);
  });

  it("a refresh token lasts 30 days", async () => {
    const { clientId, tokens } = await connected();
    await advanceClock(31 * 864e5);
    expect((await exchange({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId })).body).toMatchObject({ error: "invalid_grant" });
  });
});

describe("Client ID Metadata Documents", () => {
  // Skipped: the client's metadata document is fetched from its own HTTPS host, and the conformance
  // Worker only sends the store, Google, ECB and Cloudflare hosts to the fake server, so there's no
  // way to serve one. Needs a faked metadata host (e.g. client.example) in lite/src/conformance/worker.ts.
  it.skip("uses an HTTPS URL as the client_id, fetching and checking the document", async () => {
    const owner = await signedIn("owner");
    const { verifier, challenge } = await pkce();
    const id = await startAuthorize(METADATA_URL, challenge);
    expect((await admin("GET", `/oauth/requests/${id}`, { session: owner.session })).body.client).toMatchObject({ name: "Example MCP Client", metadata_url: METADATA_URL });
    const code = await approvedCode(METADATA_URL, owner.session, challenge);
    const t = (await exchange({ grant_type: "authorization_code", code, client_id: METADATA_URL, code_verifier: verifier })).body;
    expect((await mcpCall(t.access_token)).status).toBe(200);
  });

  // Skipped for the same reason (the document has to be served).
  it.skip("refuses a document whose client_id doesn't match its URL", async () => {
    const { challenge } = await pkce();
    const bad = await request("GET", authorizeUrl("https://client.example/oauth/other.json", challenge));
    expect(bad.status).toBe(400);
    expect(bad.text).toMatch(/different client_id/);
  });

  it("refuses non-HTTPS or IP client IDs", async () => {
    const { challenge } = await pkce();
    expect((await request("GET", authorizeUrl("http://client.example/meta.json", challenge))).status).toBe(400);
    expect((await request("GET", authorizeUrl("https://10.0.0.1/meta.json", challenge))).status).toBe(400);
  });
});

describe("tokens for the admin API (the iOS app)", () => {
  const ADMIN = `${ORIGIN}/admin/v1`;
  const IOS_CLIENT = `${ORIGIN}/app/ios-client.json`;
  const IOS_CALLBACK = `${ORIGIN}/app/oauth-callback`;
  const bearer = (token: string) => ({ token, none: false });

  /** The iOS app's sign-in, approved by `session`: its client is the deployment's own document. */
  async function iosTokens(session: string) {
    const { verifier, challenge } = await pkce();
    const q = new URLSearchParams({ response_type: "code", client_id: IOS_CLIENT, redirect_uri: IOS_CALLBACK, code_challenge: challenge, code_challenge_method: "S256", state: "s", scope: "read", resource: ADMIN });
    const start = await request("GET", `/oauth/authorize?${q}`);
    expect(start.status).toBe(302);
    const id = new URL(start.headers.get("location")!, ORIGIN).searchParams.get("request")!;
    const pending = await admin("GET", `/oauth/requests/${id}`, { session });
    expect(pending.body).toMatchObject({ client: { name: "openpurr for iOS" }, api: "admin", redirect_uri: IOS_CALLBACK });
    const decided = await admin("POST", `/oauth/requests/${id}/approve`, { session }, { body: {} });
    const back = new URL(decided.body.redirect);
    expect(back.origin + back.pathname).toBe(IOS_CALLBACK);
    const res = await exchange({ grant_type: "authorization_code", code: back.searchParams.get("code")!, client_id: IOS_CLIENT, code_verifier: verifier, redirect_uri: IOS_CALLBACK });
    expect(res.status).toBe(200);
    return res.body;
  }

  it("issues tokens for resource=<origin>/admin/v1 that work at /admin/v1 and not at /mcp", async () => {
    expect((await request("GET", "/.well-known/oauth-protected-resource/admin/v1")).body).toMatchObject({ resource: ADMIN, authorization_servers: [ORIGIN] });

    const viewer = await signedIn("viewer");
    const tokens = await iosTokens(viewer.session);
    expect((await admin("GET", "/me", bearer(tokens.access_token))).status).toBe(200);
    expect((await admin("GET", "/events?environment=sandbox", bearer(tokens.access_token))).status).toBe(200);
    // The role still applies.
    expect((await admin("POST", "/operators", bearer(tokens.access_token), { body: {}, origin: null })).status).toBe(403);
    // Issued for the admin API, so refused at /mcp; and an MCP token is refused here.
    expect((await mcpCall(tokens.access_token)).status).toBe(401);
    const mcp = await connected();
    expect((await admin("GET", "/me", bearer(mcp.tokens.access_token))).status).toBe(401);

    // Refreshing keeps the resource.
    const refreshed = (await exchange({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: IOS_CLIENT })).body;
    expect((await admin("GET", "/me", bearer(refreshed.access_token))).status).toBe(200);

    // Revoked: a 401 that points at the admin API's metadata.
    await request("POST", "/oauth/revoke", { rawBody: new URLSearchParams({ token: refreshed.access_token }).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });
    const after = await admin("GET", "/me", bearer(refreshed.access_token));
    expect(after.status).toBe(401);
    expect(after.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/admin/v1", error="invalid_token"`);
  });

  it("refuses a resource that is neither /mcp nor /admin/v1", async () => {
    const { client_id: clientId } = (await register()).body;
    const { challenge } = await pkce();
    const other = await request("GET", authorizeUrl(clientId, challenge, { resource: `${ORIGIN}/admin/v1/events` }));
    expect(new URL(other.headers.get("location")!).searchParams.get("error")).toBe("invalid_target");
  });
});
