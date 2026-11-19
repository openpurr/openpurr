// The CLI against a fake back office: commands, credentials, output and exit codes.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { main } from "../src/main.js";

const URL_ = "https://office.example.com";
const TOKEN = "pat_testtoken";

/** A fake back office. `tools` maps MCP tool names to results; `api` maps "METHOD /path" to JSON. */
function backOffice({ tools = {}, api = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method ?? "GET", path: u.pathname + u.search, body, auth: init.headers?.authorization });
    if (init.headers?.authorization !== `Bearer ${TOKEN}`) return new Response(JSON.stringify({ code: "invalid_token", message: "Invalid token." }), { status: 401 });
    if (u.pathname === "/mcp") {
      const tool = tools[body.params.name];
      if (!tool) return Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: `Unknown tool: ${body.params.name}` } });
      const r = typeof tool === "function" ? tool(body.params.arguments) : tool;
      return Response.json({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: r.text }], ...(r.data ? { structuredContent: r.data } : {}), ...(r.isError ? { isError: true } : {}) } });
    }
    const key = `${init.method ?? "GET"} ${u.pathname.replace("/admin/v1", "")}`;
    const r = api[key];
    if (!r) return new Response(JSON.stringify({ message: `no fake for ${key}` }), { status: 404 });
    if (typeof r === "string") return new Response(r, { headers: { "content-type": "text/csv" } });
    return Response.json(typeof r === "function" ? r(body) : r);
  };
  return { fetch: fetchImpl, calls };
}

async function run(argv, { env = {}, fetch } = {}) {
  let stdout = "";
  let stderr = "";
  const home = env.XDG_CONFIG_HOME ?? mkdtempSync(join(tmpdir(), "openpurr-cli-"));
  const code = await main(argv, {
    env: { XDG_CONFIG_HOME: home, ...env },
    stdout: { write: (s) => (stdout += s), isTTY: false },
    stderr: { write: (s) => (stderr += s) },
    stdin: { isTTY: false },
    fetch,
  });
  return { code, stdout, stderr, home };
}

const signedIn = { OPENPURR_URL: URL_, OPENPURR_TOKEN: TOKEN };
const ME = { operator: { email: "ada@example.com", role: "owner" }, via: "token", permissions: ["read", "grants:manage"] };

describe("openpurr CLI", () => {
  it("prints help and the version; rejects unknown commands and options", async () => {
    assert.match((await run([])).stdout, /Usage: openpurr <command>/);
    assert.match((await run(["--version"])).stdout, /^\d+\.\d+\.\d+\n$/);
    assert.equal((await run(["frobnicate"])).code, 2);
    assert.equal((await run(["doctor", "--nope"])).code, 2);
  });

  it("login checks the token, saves it readable only by you, and later commands use it", async () => {
    const office = backOffice({ api: { "GET /me": ME }, tools: { config: { text: "x" }, get_config: { text: "Apps:\n- ios" } } });
    const login = await run(["login", "--url", `${URL_}/`, "--token", TOKEN], { fetch: office.fetch });
    assert.equal(login.code, 0, login.stderr);
    assert.match(login.stdout, /Signed in as ada@example.com \(owner\) at https:\/\/office.example.com\./);
    const file = join(login.home, "openpurr", "credentials.json");
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).profiles.default, { url: URL_, token: TOKEN });
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const config = await run(["config"], { env: { XDG_CONFIG_HOME: login.home }, fetch: office.fetch });
    assert.equal(config.stdout, "Apps:\n- ios\n");

    assert.equal((await run(["login", "--url", URL_, "--token", "sk_nope"], { fetch: office.fetch })).code, 2);
    const bad = await run(["login", "--url", URL_, "--token", "pat_wrong"], { fetch: office.fetch });
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /Invalid token/);
    assert.match((await run(["login", "--url", URL_])).stderr, /Pass --token/); // not a terminal: no prompt
  });

  it("explains, finds customers, grants and revokes through the MCP tools", async () => {
    const office = backOffice({
      tools: {
        explain_entitlement: (a) => ({ text: `Yes: ${a.app_user_id} has ${a.entitlement_id}`, data: { has_entitlement: true } }),
        search_customers: (a) => ({ text: `1 customer matching ${a.query}` }),
        grant_entitlement: (a) => ({ text: `Granted ${a.entitlement_id} (${a.duration ?? a.expires_at}) note=${a.note}` }),
        revoke_grant: { text: "Revoked." },
        lookup_customer: { text: "No customer", isError: true },
      },
    });
    const opts = { env: signedIn, fetch: office.fetch };
    assert.equal((await run(["explain", "user_1", "pro"], opts)).stdout, "Yes: user_1 has pro\n");
    assert.deepEqual(JSON.parse((await run(["explain", "user_1", "pro", "--json"], opts)).stdout), { has_entitlement: true });
    assert.match((await run(["customers", "ada@example.com"], opts)).stdout, /matching ada@example.com/);
    assert.match((await run(["grant", "user_1", "pro", "--duration", "monthly", "--note", "make-good"], opts)).stdout, /Granted pro \(monthly\) note=make-good/);
    assert.match((await run(["grant", "user_1", "pro", "--until", "2027-01-01"], opts)).stdout, /\(2027-01-01\)/);
    assert.equal((await run(["grant", "user_1", "pro"], opts)).code, 2); // needs a duration
    assert.equal((await run(["revoke-grant", "user_1", "g1"], opts)).code, 0);
    const missing = await run(["customer", "nobody"], opts);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /No customer/);
    assert.equal((await run(["explain", "user_1"], opts)).code, 2); // missing entitlement
  });

  it("doctor shows each check with its fix, and exits 1 when something must be fixed", async () => {
    const checks = (status) => ({
      summary: status === "fail" ? "1 problem to fix." : "Everything checks out.",
      checks: [{ id: "database", title: "Database", status, message: "Migrations are behind.", fix: "Run: pnpm db:migrate:remote" }],
    });
    let report = checks("fail");
    const office = backOffice({ api: { "GET /doctor": () => report } });
    const failing = await run(["doctor"], { env: signedIn, fetch: office.fetch });
    assert.equal(failing.code, 1);
    assert.match(failing.stdout, /✗ Database: Migrations are behind\.\n {4}Fix: Run: pnpm db:migrate:remote/);
    report = checks("ok");
    const fine = await run(["doctor", "--json"], { env: signedIn, fetch: office.fetch });
    assert.equal(fine.code, 0);
    assert.equal(JSON.parse(fine.stdout).summary, "Everything checks out.");
  });

  it("metrics as a table (MCP) or CSV (admin API), with filters", async () => {
    const office = backOffice({ tools: { get_metrics: (a) => ({ text: `chart ${a.chart} by ${a.interval} for ${a.product}` }) }, api: { "GET /metrics/mrr": "date,mrr\n2026-01-01,10\n" } });
    const opts = { env: signedIn, fetch: office.fetch };
    assert.equal((await run(["metrics", "mrr", "--interval", "month", "--product", "pro_annual"], opts)).stdout, "chart mrr by month for pro_annual\n");
    assert.equal((await run(["metrics", "mrr", "--csv", "--from", "2026-01-01"], opts)).stdout, "date,mrr\n2026-01-01,10\n");
    assert.equal(office.calls.at(-1).path, "/admin/v1/metrics/mrr?from=2026-01-01&format=csv");
  });

  it("keys and team go through the admin API", async () => {
    const office = backOffice({
      api: {
        "GET /secret-keys": { secret_keys: [{ id: "k1", name: "Backend", key_prefix: "sk_abcdefg", scopes: ["customers:read"], last_used_at: null, revoked_at: null, expires_at: null }] },
        "POST /secret-keys": (b) => ({ id: "k2", key: `sk_secret_for_${b.name}`, scopes: ["customers:read"] }),
        "POST /operators": (b) => ({ id: "o1", setup_link: `${URL_}/admin/link#token=abc`, setup_link_expires_in_hours: 24, role: b.role }),
      },
    });
    const opts = { env: signedIn, fetch: office.fetch };
    assert.match((await run(["keys"], opts)).stdout, /k1\s+Backend\s+sk_abcdefg…\s+customers:read\s+never\s+active/);
    assert.match((await run(["keys", "create", "Prod"], opts)).stdout, /sk_secret_for_Prod/);
    const invite = await run(["team", "invite", "bo@example.com", "--role", "developer"], opts);
    assert.match(invite.stdout, /Added bo@example.com as developer\..*\n\n {2}https:\/\/office.example.com\/admin\/link#token=abc/s);
    assert.equal((await run(["team", "invite", "bo@example.com"], opts)).code, 2); // needs --role
  });

  it("says how to sign in when there's no token", async () => {
    const r = await run(["doctor"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /openpurr login --url/);
  });
});
