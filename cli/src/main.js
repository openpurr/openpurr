// openpurr: the command line for an openpurr deployment. A thin client of the back office's
// admin API and MCP server, with a personal access token (create one under Access tokens).

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { CliError, client } from "./client.js";
import { credentialsPath, readCredentials, resolveTarget, writeCredentials } from "./credentials.js";
import { json, styles, table, when } from "./output.js";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const HELP = `openpurr ${VERSION}: the command line for your openpurr deployment

Usage: openpurr <command> [options]

Getting started
  login [--url URL] [--token pat_…]   Sign in with a personal access token (Access tokens in the dashboard)
  logout                              Forget the saved token
  whoami                              Who you're signed in as, and where
  doctor                              Check the setup; every problem comes with the fix

Customers
  customers [QUERY] [--purchases]     Newest customers, or search by app user ID, email or transaction ID
  customer APP_USER_ID                Everything about one customer
  explain APP_USER_ID ENTITLEMENT     Why they do or don't have an entitlement
  grant APP_USER_ID ENTITLEMENT       Give an entitlement without a purchase
        --duration daily|three_day|weekly|monthly|two_month|three_month|six_month|yearly|lifetime
        or --until YYYY-MM-DD, and optionally --note "why"
  revoke-grant APP_USER_ID GRANT_ID   End a grant now

Charts and config
  metrics CHART [--from D] [--to D] [--interval day|week|month] [--environment sandbox]
                [--app ID] [--store app_store|play_store] [--product ID] [--csv]
                                      Charts: revenue, mrr, arr, mrr_movement, active_subscriptions,
                                      subscription_movement, paid_subscriptions, churn, active_trials,
                                      new_trials, trial_movement, new_customers, refunds, refund_rate,
                                      non_subscription_purchases, subscription_status
  config                              Projects, apps, products, entitlements and offerings
  config pull > config.json           The whole config as JSON, to edit
  config push config.json [--note N]  Save an edited config as a new version (checked first)
  config history                      Saved versions; config restore ID brings one back

Webhooks, audit, keys and team
  webhooks [--status failed|pending|delivered]
  webhooks replay EVENT_ID
  audit [--action ACTION] [--limit N]
  keys                                Secret keys (server-to-server)
  keys create NAME | keys revoke ID | keys expire ID --in-hours N
  team                                Who can sign in
  team invite EMAIL --role owner|admin|developer|viewer [--name NAME]

Options
  --project ID       The project (title) for customer, grant, chart and key commands; needed only
                     when the deployment has several (openpurr config lists them)
  --json             Machine-readable output
  --profile NAME     Use a saved profile other than "default"
  --url, --token     Override the deployment and token (also OPENPURR_URL, OPENPURR_TOKEN)
  -h, --help         This help
  -v, --version      The version
`;

const OPTIONS = {
  json: { type: "boolean" },
  profile: { type: "string" },
  url: { type: "string" },
  token: { type: "string" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
  purchases: { type: "boolean" },
  duration: { type: "string" },
  until: { type: "string" },
  note: { type: "string" },
  from: { type: "string" },
  to: { type: "string" },
  interval: { type: "string" },
  environment: { type: "string" },
  app: { type: "string" },
  store: { type: "string" },
  product: { type: "string" },
  csv: { type: "boolean" },
  status: { type: "string" },
  action: { type: "string" },
  limit: { type: "string" },
  role: { type: "string" },
  name: { type: "string" },
  "in-hours": { type: "string" },
  project: { type: "string" },
};

/** Runs the CLI. Returns the exit code. io: { env, stdout, stderr, stdin, fetch? }. */
export async function main(argv, io) {
  const out = (s) => io.stdout.write(s.endsWith("\n") ? s : `${s}\n`);
  const err = (s) => io.stderr.write(s.endsWith("\n") ? s : `${s}\n`);
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (e) {
    err(`${e.message}\nRun openpurr --help for usage.`);
    return 2;
  }
  const { values: flags, positionals } = parsed;
  const [command, ...rest] = positionals;
  if (flags.version) return out(VERSION), 0;
  if (flags.help || !command || command === "help") return out(HELP), 0;

  const s = styles(io.stdout, io.env);
  const target = () => resolveTarget(io.env, flags);
  const api = () => client(target(), io.fetch ?? fetch);
  /** --project, for the tools that take one. */
  const inProject = flags.project ? { project: flags.project } : {};
  /** Prints a tool's answer: its text, or its structured data with --json. */
  const show = ({ text, data }) => out(flags.json ? json(data ?? { text }) : text);
  const need = (n, usage) => {
    if (rest.length < n) throw new CliError(`Usage: openpurr ${usage}`, 2);
  };

  try {
    switch (command) {
      case "login":
        return await login(io, flags, out, s);
      case "logout": {
        const creds = readCredentials(io.env);
        delete creds.profiles[flags.profile || "default"];
        writeCredentials(io.env, creds);
        out("Signed out.");
        return 0;
      }
      case "whoami": {
        const c = api();
        const me = await c.api("GET", "/me");
        if (flags.json) return out(json({ url: c.url, ...me })), 0;
        out(`${me.operator.email} (${me.operator.role}) at ${c.url}\nCan: ${me.permissions.join(", ")}`);
        return 0;
      }
      case "doctor":
        return await doctor(api(), flags, out, s);
      case "customers":
        show(await api().tool("search_customers", { ...inProject, ...(rest[0] ? { query: rest[0] } : {}), ...(flags.purchases ? { purchases_only: true } : {}), ...(flags.limit ? { limit: Number(flags.limit) } : {}) }));
        return 0;
      case "customer":
        need(1, "customer APP_USER_ID");
        show(await api().tool("lookup_customer", { app_user_id: rest[0], ...inProject }));
        return 0;
      case "explain":
        need(2, "explain APP_USER_ID ENTITLEMENT");
        show(await api().tool("explain_entitlement", { app_user_id: rest[0], entitlement_id: rest[1], ...inProject }));
        return 0;
      case "grant": {
        need(2, "grant APP_USER_ID ENTITLEMENT --duration monthly (or --until YYYY-MM-DD)");
        if (!flags.duration && !flags.until) throw new CliError("Give --duration (e.g. monthly, yearly, lifetime) or --until YYYY-MM-DD.", 2);
        show(
          await api().tool("grant_entitlement", {
            app_user_id: rest[0],
            entitlement_id: rest[1],
            ...(flags.duration ? { duration: flags.duration } : {}),
            ...(flags.until ? { expires_at: flags.until } : {}),
            ...(flags.note ? { note: flags.note } : {}),
            ...inProject,
          }),
        );
        return 0;
      }
      case "revoke-grant":
        need(2, "revoke-grant APP_USER_ID GRANT_ID");
        show(await api().tool("revoke_grant", { app_user_id: rest[0], grant_id: rest[1], ...inProject }));
        return 0;
      case "metrics": {
        need(1, "metrics CHART (see openpurr --help for the list)");
        const args = { chart: rest[0], from: flags.from, to: flags.to, interval: flags.interval, environment: flags.environment, app: flags.app, store: flags.store, product: flags.product, project: flags.project };
        for (const k of Object.keys(args)) if (args[k] === undefined) delete args[k];
        if (flags.csv) {
          const q = new URLSearchParams({ ...args, format: "csv" });
          q.delete("chart");
          io.stdout.write(await api().apiText(`/metrics/${encodeURIComponent(rest[0])}?${q}`));
          return 0;
        }
        show(await api().tool("get_metrics", args));
        return 0;
      }
      case "config":
        return await config(api(), rest, flags, out, io);
      case "webhooks":
        if (rest[0] === "replay") {
          need(2, "webhooks replay EVENT_ID");
          show(await api().tool("replay_webhook", { event_id: rest[1] }));
          return 0;
        }
        show(await api().tool("list_webhook_deliveries", { ...(flags.status ? { status: flags.status } : {}), ...(flags.limit ? { limit: Number(flags.limit) } : {}) }));
        return 0;
      case "audit":
        show(await api().tool("get_audit_log", { ...(flags.action ? { action: flags.action } : {}), ...(flags.limit ? { limit: Number(flags.limit) } : {}) }));
        return 0;
      case "keys":
        return await keys(api(), rest, flags, out);
      case "team":
        return await team(api(), rest, flags, out);
      default:
        err(`Unknown command: ${command}. Run openpurr --help.`);
        return 2;
    }
  } catch (e) {
    if (e instanceof CliError) {
      err(s.red(e.message));
      return e.exitCode;
    }
    throw e;
  }
}

// ---- login ----------------------------------------------------------------------------------------

async function login(io, flags, out, s) {
  const profileName = flags.profile || "default";
  const saved = readCredentials(io.env).profiles[profileName] ?? {};
  let url = (flags.url || io.env.OPENPURR_URL || saved.url || "").replace(/\/+$/, "");
  if (!url) url = (await ask(io, "Back-office URL (e.g. https://office.example.com): ")).trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(url)) throw new CliError("The URL must start with https:// (or http:// for a local wrangler dev).", 2);
  let token = flags.token || io.env.OPENPURR_TOKEN || "";
  if (!token) {
    out(`Create a personal access token at ${url}/admin/tokens (scopes: read, plus write:grants, write:config or admin if you need them).`);
    token = (await ask(io, "Token: ", true)).trim();
  }
  if (!token.startsWith("pat_")) throw new CliError("That isn't a personal access token (they start with pat_).", 2);
  const me = await client({ url, token }, io.fetch ?? fetch).api("GET", "/me");
  const creds = readCredentials(io.env);
  creds.profiles[profileName] = { url, token };
  writeCredentials(io.env, creds);
  out(`${s.green("Signed in")} as ${me.operator.email} (${me.operator.role}) at ${url}.`);
  out(s.dim(`Saved to ${credentialsPath(io.env)}${profileName !== "default" ? ` (profile ${profileName})` : ""}.`));
  return 0;
}

/** Reads a line from the terminal; `hidden` doesn't echo it (for tokens). */
function ask(io, question, hidden = false) {
  if (!io.stdin.isTTY) {
    throw new CliError(hidden ? "No token given. Pass --token or set OPENPURR_TOKEN." : "No URL given. Pass --url or set OPENPURR_URL.", 2);
  }
  return new Promise((resolve) => {
    const rl = createInterface({ input: io.stdin, output: io.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (text) => {
        if (text.includes(question)) io.stdout.write(text);
      };
    }
    rl.question(question, (answer) => {
      if (hidden) io.stdout.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}

// ---- doctor ---------------------------------------------------------------------------------------

async function doctor(c, flags, out, s) {
  const r = await c.api("GET", "/doctor");
  const failed = r.checks.some((x) => x.status === "fail");
  if (flags.json) return out(json(r)), failed ? 1 : 0;
  const mark = { ok: s.green("✓"), warn: s.yellow("!"), fail: s.red("✗"), info: s.dim("·") };
  out(`${s.bold("openpurr doctor")} ${s.dim(c.url)}\n`);
  for (const x of r.checks) {
    out(`${mark[x.status]} ${s.bold(x.title)}: ${x.message}`);
    if (x.fix && x.status !== "ok") out(`    ${s.cyan("Fix:")} ${x.fix}`);
  }
  out(`\n${failed ? s.red(r.summary) : r.checks.some((x) => x.status === "warn") ? s.yellow(r.summary) : s.green(r.summary)}`);
  return failed ? 1 : 0;
}

// ---- keys and team (admin API: secrets never go through MCP) ---------------------------------------

// ---- config ---------------------------------------------------------------------------------------

/**
 * The config lives in the deployment's database. `pull` prints it with the version it came from;
 * `push` saves the edited file as a new version, refused if someone saved in between.
 */
async function config(c, rest, flags, out, io) {
  const [sub, arg] = rest;
  if (!sub) {
    const r = await c.tool("get_config");
    out(flags.json ? json(r.data ?? { text: r.text }) : r.text);
    return 0;
  }
  if (sub === "pull") {
    const v = await c.api("GET", "/config");
    out(json({ base_id: v.id, document: v.document }));
    return 0;
  }
  if (sub === "push") {
    if (!arg) throw new CliError("Usage: openpurr config push FILE (from openpurr config pull)", 2);
    let file;
    try {
      file = JSON.parse(readFileSync(arg, "utf8"));
    } catch (e) {
      throw new CliError(`Can't read ${arg} as JSON: ${e.message}`, 2);
    }
    if (typeof file?.base_id !== "number" || !file.document) throw new CliError(`${arg} should be what openpurr config pull printed: {"base_id": …, "document": {…}}.`, 2);
    const r = await c.api("PUT", "/config", { document: file.document, base_id: file.base_id, ...(flags.note ? { note: flags.note } : {}) });
    out(flags.json ? json(r) : `Saved as version ${r.id}. The back office uses it now; the SDK Worker within a minute.\nPull again before your next change.`);
    return 0;
  }
  if (sub === "history") {
    const { versions } = await c.api("GET", "/config/versions");
    if (flags.json) return out(json(versions)), 0;
    out(table(["VERSION", "SAVED", "BY", "NOTE"], versions.map((v) => [String(v.id), when(v.created_at), v.created_by ?? "", v.note ?? ""])));
    return 0;
  }
  if (sub === "restore") {
    if (!arg) throw new CliError("Usage: openpurr config restore VERSION", 2);
    const current = await c.api("GET", "/config");
    const r = await c.api("POST", `/config/versions/${encodeURIComponent(arg)}/restore`, { base_id: current.id });
    out(flags.json ? json(r) : `Restored version ${arg} as version ${r.id}.`);
    return 0;
  }
  throw new CliError(`Unknown config command: ${sub}. Use pull, push, history or restore.`, 2);
}

async function keys(c, rest, flags, out) {
  const [sub, arg] = rest;
  if (!sub) {
    const { secret_keys } = await c.api("GET", `/secret-keys${flags.project ? `?project=${encodeURIComponent(flags.project)}` : ""}`);
    if (flags.json) return out(json(secret_keys)), 0;
    if (!secret_keys.length) return out("No secret keys. Create one: openpurr keys create NAME"), 0;
    const state = (k) => (k.revoked_at ? "revoked" : k.expires_at && k.expires_at <= Date.now() ? "expired" : k.expires_at ? `expires ${when(k.expires_at)}` : "active");
    out(
      table(
        ["ID", "PROJECT", "NAME", "PREFIX", "SCOPES", "LAST USED", "STATUS"],
        secret_keys.map((k) => [k.id, k.project_id ?? "", k.name, `${k.key_prefix}…`, k.scopes.join(","), when(k.last_used_at), state(k)]),
      ),
    );
    return 0;
  }
  if (sub === "create") {
    if (!arg) throw new CliError("Usage: openpurr keys create NAME", 2);
    const r = await c.api("POST", "/secret-keys", { name: arg, ...(flags.project ? { project: flags.project } : {}) });
    if (flags.json) return out(json(r)), 0;
    out(`Created secret key "${arg}"${r.project_id ? ` for project ${r.project_id}` : ""}. Copy it now; it isn't shown again:\n\n  ${r.key}\n\nUse it from your backend as Authorization: Bearer sk_… on /v1 requests.`);
    return 0;
  }
  if (sub === "revoke") {
    if (!arg) throw new CliError("Usage: openpurr keys revoke ID", 2);
    const r = await c.api("POST", `/secret-keys/${encodeURIComponent(arg)}/revoke`);
    out(flags.json ? json(r) : r.note ?? "Revoked.");
    return 0;
  }
  if (sub === "expire") {
    if (!arg || flags["in-hours"] === undefined) throw new CliError("Usage: openpurr keys expire ID --in-hours N", 2);
    const r = await c.api("POST", `/secret-keys/${encodeURIComponent(arg)}/expire`, { in_hours: Number(flags["in-hours"]) });
    out(flags.json ? json(r) : `It stops working at ${when(r.expires_at)} UTC.`);
    return 0;
  }
  throw new CliError(`Unknown keys command: ${sub}. Use create, revoke or expire.`, 2);
}

async function team(c, rest, flags, out) {
  const [sub, email] = rest;
  if (!sub) {
    const { operators } = await c.api("GET", "/operators");
    if (flags.json) return out(json(operators)), 0;
    out(
      table(
        ["EMAIL", "NAME", "ROLE", "APPS", "TWO-STEP", "LAST SIGN-IN", "STATUS"],
        operators.map((o) => [o.email, o.name, o.role, o.app_ids ? o.app_ids.join(",") : "all", o.totp_enabled ? "on" : "off", when(o.last_login_at), o.disabled ? "disabled" : o.has_password ? "active" : "setup pending"]),
      ),
    );
    return 0;
  }
  if (sub === "invite") {
    if (!email || !flags.role) throw new CliError("Usage: openpurr team invite EMAIL --role owner|admin|developer|viewer [--name NAME]", 2);
    const r = await c.api("POST", "/operators", { email, role: flags.role, ...(flags.name ? { name: flags.name } : {}) });
    if (flags.json) return out(json(r)), 0;
    out(`Added ${email} as ${flags.role}. Send them this link privately; it works once, within ${r.setup_link_expires_in_hours} hours:\n\n  ${r.setup_link}`);
    return 0;
  }
  throw new CliError(`Unknown team command: ${sub}. Use invite.`, 2);
}
