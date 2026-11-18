// Operator management with the deployment's own credentials (wrangler's Cloudflare login), so
// whoever controls the infrastructure can always get in. The admin API takes over day to day.
//
//   node scripts/admin.mjs create --email you@example.com --name "You" [--role owner] [--url https://openpurr-office.example.workers.dev]
//   node scripts/admin.mjs login-link --email you@example.com [--url ...]     recovery: signs in once, 15 minutes
//   node scripts/admin.mjs list
//   node scripts/admin.mjs require-totp on|off
// Add --local to use the local database (wrangler dev). --url (or $OPENPURR_OFFICE_URL) is the
// back-office Worker's address, used to print the full link.
//
// Links carry their token in the #fragment, so it never reaches server logs or Referer headers.
// Only a SHA-256 of the token is stored, and each link works once.

import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

const ROLES = ["owner", "admin", "developer", "viewer"];
const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    email: { type: "string" },
    name: { type: "string" },
    role: { type: "string" },
    url: { type: "string" },
    local: { type: "boolean", default: false },
  },
});
const [command, arg] = positionals;

const sql = (s) => (s === null || s === undefined ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);
function d1(query) {
  const out = execFileSync("npx", ["wrangler", "d1", "execute", "openpurr", args.local ? "--local" : "--remote", "--json", "--command", query], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, CI: "1" },
  });
  return JSON.parse(out)[0]?.results ?? [];
}

function link(operatorId, purpose, ttlMs) {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  const now = Date.now();
  d1(
    `INSERT INTO login_link (token_hash, operator_id, purpose, expires_at, created_at) VALUES (${sql(hash)}, ${sql(operatorId)}, ${sql(purpose)}, ${now + ttlMs}, ${now});
     INSERT INTO audit_log (at, operator_id, actor, source, action) VALUES (${now}, ${sql(operatorId)}, 'cli', 'cli', ${sql(`auth.${purpose}_link_created`)})`,
  );
  const base = (args.url ?? process.env.OPENPURR_OFFICE_URL ?? "").replace(/\/+$/, "");
  return base ? `${base}/admin/link#token=${token}` : `<back-office URL>/admin/link#token=${token}   (pass --url to print the full link)`;
}

const email = (args.email ?? "").trim().toLowerCase();

try {
  if (command === "create") {
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error("--email is required, e.g. --email you@example.com");
    const existing = d1("SELECT count(*) AS n FROM operator")[0]?.n ?? 0;
    const role = args.role ?? (existing ? undefined : "owner");
    if (!ROLES.includes(role)) throw new Error(`--role must be one of: ${ROLES.join(", ")}`);
    const id = randomUUID();
    d1(
      `INSERT INTO operator (id, email, name, role, created_at) VALUES (${sql(id)}, ${sql(email)}, ${sql(args.name ?? email)}, ${sql(role)}, ${Date.now()});
       INSERT INTO audit_log (at, operator_id, actor, source, action, target) VALUES (${Date.now()}, ${sql(id)}, 'cli', 'cli', 'operator.created', ${sql(email)})`,
    );
    console.log(`Created ${role} ${email}. Open this link within 24 hours to set a password:\n\n  ${link(id, "setup", 24 * 3600_000)}\n`);
  } else if (command === "login-link") {
    const [op] = d1(`SELECT id, role FROM operator WHERE email = ${sql(email)} AND disabled_at IS NULL`);
    if (!op) throw new Error(`No active operator with email ${email}.`);
    console.log(`One-time sign-in link for ${email} (${op.role}), valid for 15 minutes. Use it to reset a password or authenticator:\n\n  ${link(op.id, "recovery", 15 * 60_000)}\n`);
  } else if (command === "list") {
    const rows = d1("SELECT email, name, role, app_ids, totp_enabled, password_hash IS NOT NULL AS has_password, disabled_at, last_login_at FROM operator ORDER BY created_at");
    if (!rows.length) console.log("No operators yet. Create the owner with: create --email <email>");
    for (const r of rows) {
      const at = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") : "never");
      console.log(
        `${r.email}  ${r.role}${r.app_ids ? ` (apps ${JSON.parse(r.app_ids).join(",")})` : ""}  ${r.has_password ? "password set" : "setup pending"}  ${r.totp_enabled ? "2-step on" : "2-step off"}  last sign-in ${at(r.last_login_at)}${r.disabled_at ? "  DISABLED" : ""}`,
      );
    }
  } else if (command === "require-totp") {
    if (arg !== "on" && arg !== "off") throw new Error("Usage: require-totp on|off");
    d1(
      `INSERT INTO setting (key, value, updated_at) VALUES ('require_totp', ${sql(arg === "on" ? "true" : "false")}, ${Date.now()}) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
       INSERT INTO audit_log (at, actor, source, action, details) VALUES (${Date.now()}, 'cli', 'cli', 'setting.require_totp', ${sql(JSON.stringify({ value: arg === "on" }))})`,
    );
    console.log(`Two-step sign-in is now ${arg === "on" ? "required for everyone" : "optional"}.`);
  } else {
    console.error("Usage: admin.mjs create --email <email> [--name <name>] [--role owner|admin|developer|viewer] | login-link --email <email> | list | require-totp on|off   [--url <back-office URL>] [--local]");
    process.exit(1);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
