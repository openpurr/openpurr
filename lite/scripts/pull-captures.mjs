// Pulls captured SDK requests from a deployed Worker into spec/captures/raw/ (git-ignored),
// then writes a scrubbed copy to spec/captures/ and prints requests per session.
//   node scripts/pull-captures.mjs https://openpurr.<you>.workers.dev <BENCH_TOKEN>
//
// Scrubbing: app user IDs become user-1, user-2...; fetch tokens, receipts and attribute
// values are replaced. Review the scrubbed file before committing it.

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [base, token] = process.argv.slice(2);
if (!base || !token) {
  console.error("usage: node scripts/pull-captures.mjs <worker-url> <bench-token>");
  process.exit(1);
}

const rows = [];
for (let since = 0; ; ) {
  const res = await fetch(`${base}/__capture?since=${since}`, { headers: { authorization: `Bearer ${token}` } });
  const { rows: page } = await res.json();
  if (!page.length) break;
  rows.push(...page);
  since = page.at(-1).id;
}

const specDir = fileURLToPath(new URL("../../spec/captures/", import.meta.url));
mkdirSync(`${specDir}raw`, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(`${specDir}raw/${stamp}.json`, JSON.stringify(rows, null, 2));

const users = new Map();
const alias = (id) => {
  if (!id) return id;
  if (!users.has(id)) users.set(id, `${id.startsWith("$RCAnonymousID:") ? "$RCAnonymousID:anon" : "user"}-${users.size + 1}`);
  return users.get(id);
};
const SECRET_KEYS = new Set(["fetch_token", "receipt", "app_transaction", "aad_attribution_token", "store_user_id"]);
const scrub = (v, key) => {
  if (Array.isArray(v)) return v.map((x) => scrub(x));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x, k)]));
  if (typeof v !== "string") return v;
  if (SECRET_KEYS.has(key)) return `[${key}]`;
  if (key === "app_user_id" || key === "new_app_user_id") return alias(v);
  if (key === "value") return "[attribute]";
  return v;
};
const scrubbed = rows.map((r) => {
  let body = r.body;
  try {
    body = body ? scrub(JSON.parse(body)) : null;
  } catch {}
  const path = r.app_user_id ? r.path.replace(encodeURIComponent(r.app_user_id), alias(r.app_user_id)).replace(r.app_user_id, alias(r.app_user_id)) : r.path;
  const headers = JSON.parse(r.headers);
  for (const h of ["x-apple-device-identifier", "x-nonce"]) if (headers[h]) headers[h] = "[redacted]";
  return { ts: r.ts, method: r.method, path, query: r.query, platform: r.platform, sdk_version: r.sdk_version, status: r.status, headers, body };
});
writeFileSync(`${specDir}${stamp}.json`, JSON.stringify(scrubbed, null, 2));

// Requests per (platform, user, 30-minute window): a rough "session" for the request budget.
// The user ID is in the path for GETs and in the body for POSTs like /receipts and /config.
const userOf = (r) => {
  if (r.app_user_id) return r.app_user_id;
  try {
    return JSON.parse(r.body ?? "{}").app_user_id ?? "-";
  } catch {
    return "-";
  }
};
const sessions = new Map();
for (const r of rows) {
  const k = `${r.platform}|${userOf(r)}|${Math.floor(Date.parse(r.ts) / 18e5)}`;
  sessions.set(k, (sessions.get(k) ?? 0) + 1);
}
const byPath = {};
for (const r of rows) {
  const p = `${r.platform} ${r.method} ${r.path.replace(/subscribers\/[^/]+/, "subscribers/{id}")}`;
  byPath[p] = (byPath[p] ?? 0) + 1;
}
console.log(`${rows.length} requests, ${sessions.size} sessions, ${(rows.length / Math.max(sessions.size, 1)).toFixed(1)} requests/session`);
console.table(byPath);
console.log(`raw: ${specDir}raw/${stamp}.json\nscrubbed: ${specDir}${stamp}.json`);
