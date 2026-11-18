// Manages secret API keys (sk_...) until the admin API (M4a) takes over.
//
//   node scripts/secret-keys.mjs create --name "backend" [--scopes customers:read] [--local]
//   node scripts/secret-keys.mjs list [--local]
//   node scripts/secret-keys.mjs revoke <id or key prefix> [--local]
//   node scripts/secret-keys.mjs expire <id or key prefix> --in 7d [--local]   (end a rotation overlap)
//
// Runs SQL against the D1 database through wrangler (remote by default; --local for wrangler dev).
// A new key is printed once and only its SHA-256 hash is stored, so copy it when it's shown.
// Rotation: create a new key, switch your backend to it, then expire or revoke the old one.

import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { parseArgs } from "node:util";

const SCOPES = ["customers:read"];
const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: "string" },
    scopes: { type: "string", default: "customers:read" },
    in: { type: "string" },
    local: { type: "boolean", default: false },
  },
});
const [command, target] = positionals;

const sql = (s) => `'${String(s).replace(/'/g, "''")}'`;
function d1(query) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "openpurr", args.local ? "--local" : "--remote", "--json", "--command", query],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, CI: "1" } },
  );
  return JSON.parse(out)[0]?.results ?? [];
}

function base62(bytes) {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let n = BigInt(`0x${bytes.toString("hex")}`);
  let s = "";
  while (n > 0n) {
    s = alphabet[Number(n % 62n)] + s;
    n /= 62n;
  }
  return s.padStart(43, "0");
}

function findKey(ref) {
  if (!ref) throw new Error("Give a key id or the start of the key (as shown by list).");
  const rows = d1(`SELECT id, key_prefix, name FROM api_key WHERE id = ${sql(ref)} OR key_prefix = ${sql(ref)} OR ${sql(ref)} LIKE key_prefix || '%'`);
  if (rows.length !== 1) throw new Error(rows.length ? `"${ref}" matches ${rows.length} keys; use the id.` : `No key matches "${ref}".`);
  return rows[0];
}

function duration(text) {
  const m = /^(\d+)(m|h|d)$/.exec(text ?? "");
  if (!m) throw new Error("--in takes a duration like 30m, 12h or 7d.");
  return Number(m[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
}

try {
  if (command === "create") {
    if (!args.name) throw new Error("--name is required, e.g. --name backend");
    const scopes = args.scopes.split(",").map((s) => s.trim()).filter(Boolean);
    const unknown = scopes.filter((s) => !SCOPES.includes(s));
    if (unknown.length || !scopes.length) throw new Error(`Scopes must be from: ${SCOPES.join(", ")}`);
    const key = `sk_${base62(randomBytes(32))}`;
    const hash = createHash("sha256").update(key).digest("hex");
    const id = randomBytes(8).toString("hex");
    d1(
      `INSERT INTO api_key (id, key_hash, key_prefix, name, scopes, created_at) VALUES (${sql(id)}, ${sql(hash)}, ${sql(key.slice(0, 10))}, ${sql(args.name)}, ${sql(JSON.stringify(scopes))}, ${Date.now()})`,
    );
    console.log(`Created key ${id} ("${args.name}", ${scopes.join(", ")}).\n`);
    console.log(`  ${key}\n`);
    console.log("This is the only time the key is shown. Store it in your backend's secrets now.");
  } else if (command === "list") {
    const rows = d1("SELECT id, key_prefix, name, scopes, created_at, last_used_at, expires_at, revoked_at FROM api_key ORDER BY created_at");
    if (!rows.length) console.log("No secret keys yet. Create one with: create --name <name>");
    const at = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") : "-");
    for (const r of rows) {
      const state = r.revoked_at ? "revoked" : r.expires_at && r.expires_at < Date.now() ? "expired" : r.expires_at ? `expires ${at(r.expires_at)}` : "active";
      console.log(`${r.id}  ${r.key_prefix}…  ${r.name}  ${JSON.parse(r.scopes).join(",")}  created ${at(r.created_at)}  last used ${at(r.last_used_at)}  ${state}`);
    }
  } else if (command === "revoke") {
    const k = findKey(target);
    d1(`UPDATE api_key SET revoked_at = ${Date.now()} WHERE id = ${sql(k.id)}`);
    console.log(`Revoked ${k.id} ("${k.name}"). It stops working within a minute.`);
  } else if (command === "expire") {
    const k = findKey(target);
    const when = Date.now() + duration(args.in);
    d1(`UPDATE api_key SET expires_at = ${when} WHERE id = ${sql(k.id)}`);
    console.log(`${k.id} ("${k.name}") expires at ${new Date(when).toISOString()}.`);
  } else {
    console.error("Usage: secret-keys.mjs create --name <name> | list | revoke <id> | expire <id> --in 7d   [--local]");
    process.exit(1);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
