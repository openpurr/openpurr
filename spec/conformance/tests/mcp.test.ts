// The MCP server (/mcp): transport rules, token auth and scopes, and the tools, including
// promotional grants end to end (what the SDK sees afterwards). Operators and their access tokens
// are made over the admin API; the audit log and config history are read back the same way.
// Ported from lite/test/mcp.test.ts.

import { beforeEach, describe, expect, it } from "vitest";
import { admin, call, DAY, IOS_KEY, mcp, now, operatorToken, ORIGIN, owner, postAppleTransaction, putConfig, request, reset, testConfig } from "../src";

const tokenFor = operatorToken;

const rpc = (token: string, method: string, params?: unknown) => mcp(method, params, { token, headers: { "mcp-protocol-version": "2025-11-25" } });
async function tool(token: string, name: string, args: Record<string, unknown> = {}) {
  const r = await rpc(token, "tools/call", { name, arguments: args });
  expect(r.status).toBe(200);
  return r.body.result as { content: { type: string; text: string }[]; structuredContent?: any; isError?: boolean };
}
const text = (r: { content: { text: string }[] }) => r.content.map((x) => x.text).join("\n");
/** CustomerInfo as the SDK gets it. */
const customerInfo = async (user: string) => (await call(`/v1/subscribers/${encodeURIComponent(user)}`)).body.subscriber;
const names = async (token: string) => ((await rpc(token, "tools/list")).body.result.tools as { name: string }[]).map((t) => t.name);
/** A raw POST to /mcp (for bodies mcp() can't send). */
const post = (rawBody: string, token: string) =>
  request("POST", "/mcp", { rawBody, headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` } });
const auditEntries = async () => (await admin("GET", "/audit?limit=500")).body.entries as { actor: string; source: string; action: string; target: string | null }[];

beforeEach(async () => {
  await reset();
});

describe("transport and auth", () => {
  it("needs a personal access token", async () => {
    const r = await mcp("initialize", {}, { token: null });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toMatch(/^Bearer/);
    expect((await mcp("ping", undefined, { token: "pat_not_a_real_token" })).status).toBe(401);
  });

  it("follows the Streamable HTTP rules", async () => {
    const { token } = await tokenFor("viewer", ["read"]);
    const get = await request("GET", "/mcp", { headers: { authorization: `Bearer ${token}` } });
    expect(get.status).toBe(405); // no server-initiated stream
    expect((await post(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), token)).status).toBe(202);
    expect((await mcp("ping", undefined, { token, headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await mcp("ping", undefined, { token, headers: { "mcp-protocol-version": "1999-01-01" } })).status).toBe(400);
    expect((await post("[{}]", token)).status).toBe(400); // no batches
    expect((await rpc(token, "resources/list")).body.error.code).toBe(-32601);
  });

  it("negotiates the protocol version", async () => {
    const { token } = await tokenFor("viewer", ["read"]);
    const older = await rpc(token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(older.body.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "openpurr" } });
    expect(older.body.result.instructions).toMatch(/explain_entitlement/);
    const unknown = await rpc(token, "initialize", { protocolVersion: "2099-01-01" });
    expect(unknown.body.result.protocolVersion).toBe("2025-11-25");
  });

  it("lists only the tools a token can use", async () => {
    const reader = await names((await tokenFor("owner", ["read"])).token);
    expect(reader).toEqual(expect.arrayContaining(["lookup_customer", "explain_entitlement", "get_metrics", "get_audit_log"]));
    expect(reader).not.toContain("grant_entitlement");
    const granter = await names((await tokenFor("developer", ["read", "write:grants"])).token);
    expect(granter).toEqual(expect.arrayContaining(["grant_entitlement", "revoke_grant"]));
    expect(granter).not.toContain("get_audit_log"); // developers can't read the audit log
    const viewer = await names((await tokenFor("viewer", ["read", "write:grants"])).token);
    expect(viewer).not.toContain("grant_entitlement"); // a scope can't give more than the role
    const limited = await names((await tokenFor("owner", ["read", "write:grants"], { apps: ["ios"] })).token);
    expect(limited).not.toContain("grant_entitlement"); // grants span apps
    const tools = (await rpc((await tokenFor("owner", ["read", "write:grants"])).token, "tools/list")).body.result.tools as { name: string; annotations: object; inputSchema: object }[];
    expect(tools.find((t) => t.name === "revoke_grant")!.annotations).toMatchObject({ destructiveHint: true });
    expect(tools.find((t) => t.name === "lookup_customer")!.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("offers every tool, in order, to an owner with every scope", async () => {
    const tools = (await rpc(owner(), "tools/list")).body.result.tools as { name: string; title: string; description: string; inputSchema: { type: string }; annotations: object }[];
    expect(tools.map((t) => t.name)).toEqual([
      "lookup_customer",
      "search_customers",
      "explain_entitlement",
      "get_metrics",
      "get_experiments",
      "get_config",
      "save_config",
      "list_webhook_deliveries",
      "replay_webhook",
      "grant_entitlement",
      "revoke_grant",
      "check_setup",
      "get_audit_log",
    ]);
    for (const t of tools) {
      expect(Object.keys(t).sort(), t.name).toEqual(["annotations", "description", "inputSchema", "name", "title"]);
      expect(t.inputSchema.type, t.name).toBe("object");
      expect(t.title && t.description, t.name).toBeTruthy();
    }
  });
});

describe("tools", () => {
  it("explains why a customer does or doesn't have an entitlement", async () => {
    const { token } = await tokenFor("owner", ["read"]);
    const user = `explain-${crypto.randomUUID()}`;
    await postAppleTransaction(user, { productId: "pro_monthly" });
    const yes = await tool(token, "explain_entitlement", { app_user_id: user, entitlement_id: "pro" });
    expect(text(yes)).toMatch(/^Yes: .* has pro until/);
    expect(yes.structuredContent).toMatchObject({ has_entitlement: true, source: "purchase" });

    const lapsed = `explain-${crypto.randomUUID()}`;
    await postAppleTransaction(lapsed, { productId: "pro_monthly", purchaseDate: now() - 60 * DAY });
    const no = await tool(token, "explain_entitlement", { app_user_id: lapsed, entitlement_id: "pro" });
    expect(text(no)).toMatch(/^No: pro ended on/);
    expect(text(no)).toMatch(/expired on/);

    const coins = `explain-${crypto.randomUUID()}`;
    await postAppleTransaction(coins, { productId: "coins_100", type: "Consumable", expiresDate: undefined });
    const never = await tool(token, "explain_entitlement", { app_user_id: coins, entitlement_id: "annual_perks" });
    expect(text(never)).toMatch(/never bought a product that unlocks annual_perks/);
    expect(text(never)).toMatch(/coins_100, which no entitlement includes/);

    expect(text(await tool(token, "explain_entitlement", { app_user_id: "nobody-at-all", entitlement_id: "pro" }))).toMatch(/no customer/);
    const bad = await tool(token, "explain_entitlement", { app_user_id: user, entitlement_id: "gold" });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toMatch(/Entitlements: pro, annual_perks/);
  });

  it("looks up and finds customers, reads the config and charts", async () => {
    const { token } = await tokenFor("owner", ["read"]);
    const user = `lookup-${crypto.randomUUID()}`;
    await postAppleTransaction(user, { productId: "pro_annual", expiresDate: now() + 300 * DAY });
    const found = await tool(token, "lookup_customer", { app_user_id: user });
    expect(text(found)).toMatch(/pro: active until/);
    expect(found.structuredContent.purchases[0]).toMatchObject({ product_id: "pro_annual" });
    expect((await tool(token, "search_customers", { query: user.slice(0, 20) })).structuredContent.customers.map((x: { app_user_id: string }) => x.app_user_id)).toContain(user);
    const config = await tool(token, "get_config");
    expect(text(config)).toMatch(/pro \(Pro\): ios: pro_monthly, pro_annual, lifetime; android: pro, lifetime/);
    expect(text(config)).toMatch(/^SDK URL \(Purchases.proxyURL\): not set/);
    expect(text(config)).toContain(`store notifications to ${ORIGIN}/notifications/apple`);
    expect(config.structuredContent.projects[0].apps.find((a: { id: string }) => a.id === "android").notification_url).toBe(`${ORIGIN}/notifications/google`);
    const mrr = await tool(token, "get_metrics", { chart: "mrr", environment: "sandbox", from: "2026-01-01", to: "2026-03-31", interval: "month" });
    expect(text(mrr)).toMatch(/\| month \| mrr \|/);
    expect((await tool(token, "get_metrics", { chart: "nope" })).isError).toBe(true);
    expect((await tool(token, "lookup_customer", {})).isError).toBe(true);
  });

  it("grants and revokes an entitlement; the SDK sees it as a promotional entitlement", async () => {
    const { token, email } = await tokenFor("developer", ["read", "write:grants"]);
    const user = `grant-${crypto.randomUUID()}`;
    await call(`/v1/subscribers/${encodeURIComponent(user)}/attributes`, { body: { attributes: { $email: { value: "g@example.com", updated_at_ms: now() } } } });

    const granted = await tool(token, "grant_entitlement", { app_user_id: user, entitlement_id: "pro", duration: "monthly", note: "support make-good" });
    expect(granted.isError).toBeUndefined();
    expect(text(granted)).toMatch(/^Granted pro to/);
    const grantId = granted.structuredContent.grant.id as string;

    const info = await customerInfo(user);
    expect(info.entitlements.pro).toMatchObject({ product_identifier: "rc_promo_pro_monthly" });
    expect(Date.parse(info.entitlements.pro.expires_date)).toBeGreaterThan(now() + 27 * DAY);
    expect(info.subscriptions.rc_promo_pro_monthly).toMatchObject({ store: "promotional", is_sandbox: false, period_type: "normal" });

    expect(text(await tool(token, "explain_entitlement", { app_user_id: user, entitlement_id: "pro" }))).toMatch(/from a promotional grant/);
    const logged = (await auditEntries()).filter((e) => e.target === user).map(({ actor, source, action }) => ({ actor, source, action }));
    expect(logged).toEqual([{ actor: email, source: "mcp", action: "grant.created" }]);

    expect((await tool(token, "revoke_grant", { app_user_id: user, grant_id: grantId })).isError).toBeUndefined();
    expect((await customerInfo(user)).entitlements.pro).toBeUndefined();
    expect((await tool(token, "revoke_grant", { app_user_id: user, grant_id: grantId })).isError).toBe(true); // already revoked

    // Validation and access.
    expect(text(await tool(token, "grant_entitlement", { app_user_id: user, entitlement_id: "pro" }))).toMatch(/Give a duration/);
    expect(text(await tool(token, "grant_entitlement", { app_user_id: user, entitlement_id: "pro", duration: "forever" }))).toMatch(/duration must be one of/);
    expect(text(await tool(token, "grant_entitlement", { app_user_id: "no-such-user", entitlement_id: "pro", duration: "weekly" }))).toMatch(/No customer/);
    const reader = (await tokenFor("owner", ["read"])).token;
    expect(text(await tool(reader, "grant_entitlement", { app_user_id: user, entitlement_id: "pro", duration: "weekly" }))).toMatch(/grants:manage permission/);
  });

  it("a grant never shortens access a purchase already gives, and lifetime wins", async () => {
    const { token } = await tokenFor("owner", ["read", "write:grants"]);
    const user = `both-${crypto.randomUUID()}`;
    await postAppleTransaction(user, { productId: "pro_annual", expiresDate: now() + 200 * DAY });
    await tool(token, "grant_entitlement", { app_user_id: user, entitlement_id: "pro", duration: "weekly" });
    let pro = (await customerInfo(user)).entitlements.pro;
    expect(pro.product_identifier).toBe("pro_annual"); // the purchase lasts longer
    await tool(token, "grant_entitlement", { app_user_id: user, entitlement_id: "pro", duration: "lifetime" });
    pro = (await customerInfo(user)).entitlements.pro;
    expect(pro).toMatchObject({ product_identifier: "rc_promo_pro_lifetime", expires_date: null });
  });
});

describe("MCP config tools", () => {
  it("get_config returns the document and its version; save_config saves a new version, refusing stale or invalid ones", async () => {
    const { token, email } = await tokenFor("owner", ["read", "write:config"]);
    const got = await tool(token, "get_config");
    // Lite's in-process test has no saved version (0); here the reset saved one.
    const baseId = (await admin("GET", "/config")).body.id as number;
    expect(got.structuredContent.version_id).toBe(baseId);
    expect(got.structuredContent.projects[0].apps.find((a: { id: string }) => a.id === "ios").sdk_keys).toEqual([IOS_KEY]);
    const document = structuredClone(got.structuredContent.document);
    document.projects.default.name = "Renamed";

    const saved = await tool(token, "save_config", { document, base_id: baseId, note: "Rename" });
    expect(saved.isError).toBeFalsy();
    const id = saved.structuredContent.version_id;
    const version = (await admin("GET", `/config/versions/${id}`)).body;
    expect(version).toMatchObject({ created_by: email, note: "Rename" });
    expect(version.document.projects.default.name).toBe("Renamed");

    const stale = await tool(token, "save_config", { document, base_id: baseId });
    expect(stale.isError).toBe(true);
    expect(text(stale)).toMatch(/changed by someone else/);

    document.projects.default.apps.ios.sdk_keys = ["test_nope_nope_nope_nope"];
    const invalid = await tool(token, "save_config", { document, base_id: id });
    expect(invalid.isError).toBe(true);
    expect(text(invalid)).toMatch(/apps\.ios\.sdk_keys\[0\]: must not start with test_/);
    expect((await auditEntries()).filter((e) => e.action === "config.saved").map((e) => ({ source: e.source }))).toEqual([{ source: "mcp" }]);
  });

  it("offers save_config only to tokens that may change the config", async () => {
    expect(await names((await tokenFor("owner", ["read"])).token)).not.toContain("save_config");
    expect(await names((await tokenFor("developer", ["read", "write:config"])).token)).not.toContain("save_config");
    expect(await names((await tokenFor("admin", ["read", "write:config"])).token)).toContain("save_config");
  });
});

describe("get_experiments", () => {
  it("lists experiments with results per variant, for operators who see every app", async () => {
    // Two offerings, so the experiment can split customers between them.
    const config = testConfig();
    config.offerings.push({ id: "default_v2", description: "Variant", packages: [{ id: "$rc_monthly", ios: "pro_monthly", android: "pro:monthly" }] });
    await reset(config);
    const created = await admin("POST", "/experiments", {}, {
      body: { name: "MCP price test", variants: [{ offering_id: "default", weight: 50 }, { offering_id: "default_v2", weight: 50 }] },
    });
    expect(created.status).toBe(201);
    const id = created.body.experiment.id as string;
    expect((await admin("POST", `/experiments/${id}/start`)).status).toBe(200);

    // New customers fetching offerings are enrolled; the current offering says which variant they got.
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 40 && (!counts.a || !counts.b); i++) {
      const res = await call(`/v1/subscribers/mcp-exp-${i}/offerings`);
      counts[res.body.current_offering_id === "default_v2" ? "b" : "a"]++;
    }
    expect(counts.a && counts.b).toBeTruthy();
    expect((await admin("POST", `/experiments/${id}/stop`)).status).toBe(200);
    // The variant's offering leaves the config after the experiment stopped.
    const document = (await admin("GET", "/config")).body.document;
    document.projects.default.offerings = document.projects.default.offerings.filter((o: { id: string }) => o.id !== "default_v2");
    expect((await putConfig(document)).status).toBe(201);

    const { token } = await tokenFor("viewer", ["read"]);
    const r = await tool(token, "get_experiments");
    expect(text(r)).toContain(`MCP price test (${id}): stopped`);
    expect(text(r)).toMatch(/b: \d+ customers, .*vs a: .*too early to call/);
    const mine = r.structuredContent.experiments.find((e: { id: string }) => e.id === id);
    expect(mine.variants[1]).toMatchObject({ offering_id: "default_v2", offering_exists: false });
    expect(mine.results.variants.map((v: { customers: number }) => v.customers)).toEqual([counts.a, counts.b]);

    const { token: limited } = await tokenFor("viewer", ["read"], { apps: ["ios"] });
    const l = await tool(limited, "get_experiments");
    expect(text(l)).toContain("Results aren't shown");
    expect(l.structuredContent.experiments.find((e: { id: string }) => e.id === id).results).toBeNull();
  });
});
