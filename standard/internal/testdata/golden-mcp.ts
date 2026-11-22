// Generates golden-mcp.json: what Lite's own back office (lite/src/office: the MCP server in mcp.ts
// and the OAuth authorization server in oauth.ts, with the admin API's consent and connected-apps
// routes) answers to a long list of requests, so the Go tests can check Standard's answers byte for
// byte (internal/server/mcp_golden_test.go).
//
// Lite runs on D1, which is SQLite: this runs Lite's migrations and its real back-office app
// (buildOfficeApp) against Node's built-in SQLite (node:sqlite) through a small D1 shim. Time is
// frozen at NOW and crypto.randomUUID counts, so the answers are the same on every run. A ledger,
// operators, tokens, sessions, webhook deliveries, experiments, OAuth clients, requests and grants
// are written first (and the chart rollup run); every table is then dumped as "seed", and the
// requests ("cases") run in order, each seeing what the previous ones changed. Random tokens and
// UUIDs in the answers are normalized (see "normalize"), since Standard makes its own.
//
// Regenerate after changing that code in Lite, from the repo root (Node 22.5 or later):
//   lite/node_modules/.bin/esbuild standard/internal/testdata/golden-mcp.ts --bundle --platform=node \
//     --format=esm --outfile=/tmp/golden-mcp.mjs && node --no-warnings /tmp/golden-mcp.mjs > standard/internal/testdata/golden-mcp.json

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { parseConfig } from "../../../lite/src/config";
import { configLoader } from "../../../lite/src/config-store";
import { experimentResults } from "../../../lite/src/office/experiments";
import type { ExperimentRow } from "../../../lite/src/experiments";
import { rollupMetrics } from "../../../lite/src/metrics";
import { buildOfficeApp } from "../../../lite/src/office/app";
import { SESSION_COOKIE } from "../../../lite/src/office/auth";

const NOW = Date.UTC(2026, 2, 15, 12);
const DAY = 864e5;
const ORIGIN = "https://openpurr.test";
const OPERATOR_SECRET = "golden-mcp-operator-secret-0123456789abcdef";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const WEBHOOK_URL = "https://hooks.example/openpurr";
const IP = "203.0.113.7";

// --- Frozen time and counting UUIDs --------------------------------------------------------------------

const RealDate = Date;
class FrozenDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(NOW);
    else super(...(args as [number]));
  }
  static now() {
    return NOW;
  }
}
globalThis.Date = FrozenDate as DateConstructor;
let uuidCounter = 0;
crypto.randomUUID = (() => {
  const n = (++uuidCounter).toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${n}`;
}) as typeof crypto.randomUUID;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

// --- A D1 shim over node:sqlite ----------------------------------------------------------------------

type Bindable = string | number | null;

class Stmt {
  constructor(
    private db: DatabaseSync,
    readonly sql: string,
    readonly args: Bindable[] = [],
  ) {}
  bind(...args: Bindable[]) {
    return new Stmt(this.db, this.sql, args);
  }
  // node:sqlite binds numbered parameters (?1) only by name, so they're rewritten to plain ones
  // with the arguments in SQLite's order (a plain ? after ?2 is ?3). Lite's SQL has no ? in strings.
  private prepared(): [StatementSync, Bindable[]] {
    let max = 0;
    const args: Bindable[] = [];
    const sql = this.sql.replace(/\?(\d*)/g, (_, n: string) => {
      const i = n ? Number(n) : max + 1;
      max = Math.max(max, i);
      args.push(this.args[i - 1] === undefined ? null : this.args[i - 1]!);
      return "?";
    });
    return [this.db.prepare(sql), args];
  }
  exec() {
    const [s, args] = this.prepared();
    if (s.columns().length > 0) return { results: s.all(...args) as Record<string, unknown>[], meta: { changes: 0, last_row_id: 0 } };
    const r = s.run(...args);
    return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  async first<T>() {
    const [s, args] = this.prepared();
    return ((s.get(...args) as T | undefined) ?? null) as T | null;
  }
  async all<T>() {
    const [s, args] = this.prepared();
    return { results: s.all(...args) as T[], meta: { changes: 0 } };
  }
  async run() {
    return this.exec();
  }
}

function d1(db: DatabaseSync) {
  return {
    prepare: (sql: string) => new Stmt(db, sql),
    async batch(stmts: Stmt[]) {
      db.exec("BEGIN");
      try {
        const out = stmts.map((s) => s.exec());
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  } as unknown as D1Database;
}

function freshDb() {
  const db = new DatabaseSync(":memory:");
  const dir = join(dirname(fileURLToPath(import.meta.url)), "../../../lite/migrations");
  // The bundle runs from /tmp: find the migrations from the repo root (the working directory) instead.
  const migrations = (() => {
    try {
      return readdirSync(dir).length ? dir : "lite/migrations";
    } catch {
      return "lite/migrations";
    }
  })();
  for (const f of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(join(migrations, f), "utf8"));
  return db;
}

const sqlite = freshDb();
const DB = d1(sqlite);

function insert(table: string, row: Record<string, Bindable>) {
  const cols = Object.keys(row);
  sqlite.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...cols.map((c) => row[c]!));
}

// --- The config ----------------------------------------------------------------------------------------

const rawConfig = {
  version: 1,
  apps: {
    ios: {
      store: "app_store",
      bundle_id: "com.example.openpurr",
      sdk_keys: ["appl_golden_ios_0123456789"],
      products: {
        pro_monthly: { type: "subscription" },
        pro_annual: { type: "subscription", subscription_group: "21000000" },
        lifetime: { type: "non_consumable" },
        coins_100: { type: "consumable" },
      },
    },
    android: {
      store: "play_store",
      package_name: "com.example.openpurr",
      sdk_keys: ["goog_golden_android_0123456789"],
      allow_unverified_purchases: true,
      products: {
        pro: { type: "subscription", base_plans: ["monthly", "annual"] },
        lifetime: { type: "non_consumable" },
        coins_100: { type: "consumable" },
      },
    },
  },
  entitlements: {
    pro: { description: "Pro", products: { ios: ["pro_monthly", "pro_annual", "lifetime"], android: ["pro", "lifetime"] } },
    annual_perks: { products: { ios: ["pro_annual"], android: ["pro:annual"] } },
  },
  offerings: [
    {
      id: "default",
      current: true,
      description: "Standard",
      metadata: { headline: "Go Pro" },
      packages: [
        { id: "$rc_monthly", ios: "pro_monthly", android: "pro:monthly" },
        { id: "$rc_annual", ios: "pro_annual", android: "pro:annual" },
        { id: "$rc_lifetime", ios: "lifetime", android: "lifetime" },
      ],
    },
    { id: "default_v2", description: "Variant", packages: [{ id: "$rc_monthly", ios: "pro_monthly", android: "pro:monthly" }] },
  ],
  webhooks: [{ id: "backend", url: WEBHOOK_URL }],
};
const config = parseConfig(rawConfig);
insert("config_version", { document: JSON.stringify(config.document), created_at: NOW - 30 * DAY, created_by: "import", note: "Imported from openpurr.config.yaml" });
insert("setting", { key: "sdk_url", value: "https://sdk.openpurr.test", updated_at: NOW - 30 * DAY });

// --- Operators, tokens, sessions ----------------------------------------------------------------------

const operators: [string, string, string, string | null, number | null][] = [
  ["op-owner", "owner@example.com", "owner", null, null],
  ["op-admin", "admin@example.com", "admin", null, null],
  ["op-dev", "dev@example.com", "developer", null, null],
  ["op-viewer", "viewer@example.com", "viewer", null, null],
  ["op-limited", "limited@example.com", "admin", JSON.stringify(["ios"]), null],
  ["op-disabled", "disabled@example.com", "owner", null, NOW - DAY],
];
for (const [id, email, role, apps, disabled] of operators) {
  insert("operator", { id, email, name: role, role, app_ids: apps, disabled_at: disabled, created_at: NOW - 60 * DAY });
}

const T = {
  ownerAll: "pat_golden_owner_all",
  ownerRead: "pat_golden_owner_read",
  adminConfig: "pat_golden_admin_config",
  devConfig: "pat_golden_dev_config",
  devGrants: "pat_golden_dev_grants",
  viewer: "pat_golden_viewer",
  limited: "pat_golden_limited",
  disabled: "pat_golden_disabled",
  expired: "pat_golden_expired",
  revoked: "pat_golden_revoked",
};
const tokens: [string, string, string, string[], number | null, number | null][] = [
  ["tok-owner-all", "op-owner", T.ownerAll, ["read", "write:grants", "write:webhooks", "write:config", "admin"], null, null],
  ["tok-owner-read", "op-owner", T.ownerRead, ["read"], null, null],
  ["tok-admin-config", "op-admin", T.adminConfig, ["read", "write:config"], null, null],
  ["tok-dev-config", "op-dev", T.devConfig, ["read", "write:config"], null, null],
  ["tok-dev-grants", "op-dev", T.devGrants, ["read", "write:grants", "write:webhooks"], null, null],
  ["tok-viewer", "op-viewer", T.viewer, ["read", "write:grants"], null, null],
  ["tok-limited", "op-limited", T.limited, ["read", "write:grants", "write:webhooks", "write:config"], null, null],
  ["tok-disabled", "op-disabled", T.disabled, ["read"], null, null],
  ["tok-expired", "op-owner", T.expired, ["read"], NOW - DAY, null],
  ["tok-revoked", "op-owner", T.revoked, ["read"], null, NOW - DAY],
];
for (const [id, operator, token, scopes, expires, revoked] of tokens) {
  // last_used_at is recent, so no request stamps it (that write happens after the response).
  insert("access_token", {
    id,
    operator_id: operator,
    token_hash: sha(token),
    token_prefix: token.slice(0, 10),
    name: id,
    scopes: JSON.stringify(scopes),
    created_at: NOW - 10 * DAY,
    last_used_at: NOW - 60_000,
    expires_at: expires,
    revoked_at: revoked,
  });
}

const S = { owner: "sess_golden_owner", viewer: "sess_golden_viewer" };
for (const [token, operator] of [
  [S.owner, "op-owner"],
  [S.viewer, "op-viewer"],
]) {
  insert("session", { token_hash: sha(token!), operator_id: operator!, kind: "full", created_at: NOW - 3600_000, expires_at: NOW + DAY, last_seen_at: NOW - 60_000 });
}

// --- The ledger ----------------------------------------------------------------------------------------

function customer(id: string, appUserId: string, firstSeen: number, aliases: string[] = [], email?: string) {
  insert("customer", { id, app_user_id: appUserId, first_seen: firstSeen, project_id: "default" });
  insert("customer_alias", { project_id: "default", app_user_id: appUserId, customer_id: id, created_at: firstSeen });
  aliases.forEach((a, i) => insert("customer_alias", { project_id: "default", app_user_id: a, customer_id: id, created_at: firstSeen + (i + 1) * 1000 }));
  if (email) insert("subscriber_attribute", { customer_id: id, key: "$email", value: email, updated_at: firstSeen, received_at: firstSeen });
}

interface TxIn {
  app?: "ios" | "android";
  env?: "production" | "sandbox";
  id: string;
  orig?: string;
  product: string;
  basePlan?: string | null;
  type?: "subscription" | "non_consumable" | "consumable";
  at: number;
  origAt?: number;
  expires?: number | null;
  period?: "normal" | "trial" | "intro";
  ownership?: string;
  price?: number | null;
  revokedAt?: number | null;
  reason?: string | null;
  upgraded?: number;
  verified?: number;
  storefront?: string | null;
}

function tx(customerId: string, t: TxIn) {
  const app = t.app ?? "ios";
  const store = app === "ios" ? "app_store" : "play_store";
  const orig = t.orig ?? t.id;
  insert("store_transaction", {
    app_id: app,
    store,
    environment: t.env ?? "production",
    transaction_id: t.id,
    original_transaction_id: orig,
    product_id: t.product,
    base_plan_id: t.basePlan ?? null,
    product_type: t.type ?? "subscription",
    purchased_at: t.at,
    original_purchased_at: t.origAt ?? t.at,
    expires_at: t.expires === undefined ? t.at + 30 * DAY : t.expires,
    period_type: t.period ?? "normal",
    ownership_type: t.ownership ?? "PURCHASED",
    price_micros: t.price === undefined ? 9_990_000 : t.price,
    currency: t.price === null ? null : "USD",
    storefront: t.storefront === undefined ? (app === "ios" ? "USA" : "US") : t.storefront,
    revoked_at: t.revokedAt ?? null,
    revocation_reason: t.reason ?? null,
    is_upgraded: t.upgraded ?? 0,
    verified: t.verified ?? 1,
    source: "sdk",
    received_at: t.at,
    updated_at: t.at,
  });
  const owned = sqlite.prepare("SELECT 1 FROM purchase_owner WHERE store = ? AND original_transaction_id = ?").get(store, orig);
  if (!owned) insert("purchase_owner", { store, original_transaction_id: orig, customer_id: customerId, app_id: app, updated_at: t.at });
}

function state(store: string, orig: string, s: Partial<Record<string, number | string | null>>) {
  insert("subscription_state", {
    store,
    original_transaction_id: orig,
    status: null,
    auto_renew: null,
    auto_renew_product_id: null,
    unsubscribe_detected_at: null,
    billing_issue_detected_at: null,
    grace_period_expires_at: null,
    auto_resume_at: null,
    signed_at: NOW - DAY,
    updated_at: NOW - DAY,
    ...s,
  } as Record<string, Bindable>);
}

function grant(id: string, customerId: string, entitlement: string, duration: string, startsAt: number, expiresAt: number | null, extra: Record<string, Bindable> = {}) {
  insert("promotional_grant", {
    id,
    customer_id: customerId,
    entitlement_id: entitlement,
    duration,
    starts_at: startsAt,
    expires_at: expiresAt,
    note: null,
    granted_by: "owner@example.com",
    source: "dashboard",
    created_at: startsAt,
    revoked_at: null,
    revoked_by: null,
    ...extra,
  });
}

// alice: a renewing monthly chain on iOS, an annual Google base plan with auto-renew off, grants.
customer("c-alice", "alice", NOW - 90 * DAY, ["$RCAnonymousID:a11ce0000000000000000000000000a1"], "alice@example.com");
insert("subscriber_attribute", { customer_id: "c-alice", key: "$displayName", value: "Alice", updated_at: NOW - 80 * DAY, received_at: NOW - 80 * DAY });
tx("c-alice", { id: "1000001", product: "pro_monthly", at: NOW - 70 * DAY, expires: NOW - 40 * DAY });
tx("c-alice", { id: "1000002", orig: "1000001", product: "pro_monthly", at: NOW - 40 * DAY, origAt: NOW - 70 * DAY, expires: NOW - 10 * DAY });
tx("c-alice", { id: "1000003", orig: "1000001", product: "pro_monthly", at: NOW - 10 * DAY, origAt: NOW - 70 * DAY, expires: NOW + 20 * DAY });
state("app_store", "1000001", { status: 1, auto_renew: 1, auto_renew_product_id: "pro_monthly" });
tx("c-alice", { app: "android", id: "GPA.1111-2222-3333-44444", orig: "golden-token-alice", product: "pro", basePlan: "annual", at: NOW - 100 * DAY, expires: NOW + 265 * DAY, price: 59_990_000 });
state("play_store", "golden-token-alice", { status: 1, auto_renew: 0, unsubscribe_detected_at: NOW - 5 * DAY });
grant("grant-alice-perks", "c-alice", "annual_perks", "weekly", NOW - 2 * DAY, NOW + 5 * DAY, { note: "Make-good for an outage" });
grant("grant-alice-old", "c-alice", "pro", "monthly", NOW - 200 * DAY, NOW - 170 * DAY, { revoked_at: NOW - 180 * DAY, revoked_by: "admin@example.com" });

// bob: in a billing grace period, and a family-shared lifetime purchase.
customer("c-bob", "bob", NOW - 400 * DAY, [], "bob@example.com");
tx("c-bob", { id: "2000001", product: "pro_annual", at: NOW - 367 * DAY, expires: NOW - 2 * DAY, price: 49_990_000 });
state("app_store", "2000001", { status: 4, auto_renew: 1, billing_issue_detected_at: NOW - 2 * DAY, grace_period_expires_at: NOW + 5 * DAY });
tx("c-bob", { id: "2000002", product: "lifetime", type: "non_consumable", at: NOW - 300 * DAY, expires: null, ownership: "FAMILY_SHARED", price: 99_990_000 });

// carol: a trial that didn't convert, and a consumable no entitlement includes.
customer("c-carol", "carol", NOW - 50 * DAY, [], "carol@example.com");
tx("c-carol", { id: "3000001", product: "pro_monthly", at: NOW - 37 * DAY, expires: NOW - 30 * DAY, period: "trial", price: 0 });
state("app_store", "3000001", { status: 2, auto_renew: 0, unsubscribe_detected_at: NOW - 33 * DAY });
tx("c-carol", { id: "3000002", product: "coins_100", type: "consumable", at: NOW - 20 * DAY, expires: null, price: 990_000 });

// dave: a refunded annual, and a monthly in billing retry.
customer("c-dave", "dave", NOW - 120 * DAY);
tx("c-dave", { id: "4000001", product: "pro_annual", at: NOW - 100 * DAY, expires: NOW + 265 * DAY, revokedAt: NOW - 5 * DAY, reason: "1", price: 49_990_000 });
tx("c-dave", { id: "4000002", product: "pro_monthly", at: NOW - 33 * DAY, expires: NOW - 3 * DAY });
state("app_store", "4000002", { status: 3, auto_renew: 1, billing_issue_detected_at: NOW - 3 * DAY });

// erin: upgraded from monthly to annual.
customer("c-erin", "erin", NOW - 60 * DAY, ["erin-old-id"]);
tx("c-erin", { id: "5000001", product: "pro_monthly", at: NOW - 50 * DAY, expires: NOW - 20 * DAY, upgraded: 1 });
tx("c-erin", { id: "5000002", product: "pro_annual", at: NOW - 21 * DAY, expires: NOW + 344 * DAY, price: 49_990_000 });
state("app_store", "5000002", { status: 1, auto_renew: 1 });

// frank: sandbox, and an unverified Google lifetime purchase.
customer("c-frank", "frank", NOW - 15 * DAY);
tx("c-frank", { id: "6000001", env: "sandbox", product: "pro_monthly", at: NOW - 5 * DAY, expires: NOW + 25 * DAY });
tx("c-frank", { app: "android", id: "GPA.6666-0000-0000-00001", orig: "golden-token-frank", product: "lifetime", type: "non_consumable", at: NOW - 4 * DAY, expires: null, verified: 0, price: null });

// gina: grants only (lifetime, ended, revoked).
customer("c-gina", "gina", NOW - 10 * DAY, [], "gina@example.com");
grant("grant-gina-life", "c-gina", "pro", "lifetime", NOW - 9 * DAY, null);
grant("grant-gina-ended", "c-gina", "annual_perks", "daily", NOW - 3 * DAY, NOW - 2 * DAY);
grant("grant-gina-revoked", "c-gina", "annual_perks", "monthly", NOW - DAY, NOW + 29 * DAY, { revoked_at: NOW - 3600_000, revoked_by: "owner@example.com" });

// hank: a long Google monthly chain (several renewals) that expired.
customer("c-hank", "hank", NOW - 200 * DAY);
for (let i = 0; i < 4; i++) {
  tx("c-hank", { app: "android", id: `GPA.7777-0000-0000-0000${i}`, orig: "golden-token-hank", product: "pro", basePlan: "monthly", at: NOW - (150 - 30 * i) * DAY, origAt: NOW - 150 * DAY, expires: NOW - (120 - 30 * i) * DAY, price: 4_990_000 });
}
state("play_store", "golden-token-hank", { status: 2, auto_renew: 0, unsubscribe_detected_at: NOW - 40 * DAY });

// Customers without purchases, and the experiment's customers.
customer("c-ivy", "ivy", NOW - 2 * DAY);
for (let i = 1; i <= 6; i++) {
  customer(`c-exp${i}`, `exp-${i}`, NOW - 9 * DAY + i * 3600_000);
  if (i % 2 === 0) tx(`c-exp${i}`, { id: `800000${i}`, product: "pro_monthly", at: NOW - 8 * DAY + i * 3600_000, expires: NOW + 22 * DAY });
  if (i === 3) tx(`c-exp${i}`, { id: `800000${i}`, product: "pro_monthly", at: NOW - 8 * DAY, expires: NOW - DAY, period: "trial", price: 0 });
}

// --- Webhook events and deliveries -----------------------------------------------------------------------

const events: [string, string, string, string, string, number][] = [
  ["evt-golden-1", "INITIAL_PURCHASE", "ios", "c-alice", "production", NOW - 70 * DAY],
  ["evt-golden-2", "RENEWAL", "ios", "c-alice", "production", NOW - 10 * DAY],
  ["evt-golden-3", "BILLING_ISSUE", "ios", "c-bob", "production", NOW - 2 * DAY],
  ["evt-golden-4", "INITIAL_PURCHASE", "android", "c-hank", "production", NOW - 150 * DAY],
  ["evt-golden-5", "INITIAL_PURCHASE", "ios", "c-frank", "sandbox", NOW - 5 * DAY],
];
for (const [id, type, app, customerId, environment, at] of events) {
  insert("webhook_event", {
    id,
    dedupe_key: `golden:${id}`,
    type,
    app_id: app,
    customer_id: customerId,
    environment,
    body: JSON.stringify({ api_version: "1.0", event: { id, type, app_id: app, environment: environment.toUpperCase() } }),
    created_at: at,
  });
}
const deliveries: [string, string, number, number | null, number | null, string | null, number | null][] = [
  ["evt-golden-1", "delivered", 1, null, 200, null, NOW - 70 * DAY],
  ["evt-golden-2", "pending", 2, NOW + 600_000, 500, "HTTP 500", null],
  ["evt-golden-3", "failed", 10, null, null, "The operation was aborted due to timeout", null],
  ["evt-golden-4", "delivered", 1, null, 204, null, NOW - 150 * DAY],
  ["evt-golden-5", "pending", 1, NOW + 300_000, 404, "HTTP 404", null],
];
for (const [event, status, attempts, next, lastStatus, lastError, deliveredAt] of deliveries) {
  const at = events.find((e) => e[0] === event)![5];
  insert("webhook_delivery", { event_id: event, endpoint: "backend", status, attempts, next_attempt_at: next, last_status: lastStatus, last_error: lastError, delivered_at: deliveredAt, created_at: at });
}

// --- The audit log ---------------------------------------------------------------------------------------

const audits: [number, string | null, string | null, string | null, string, string, string | null, string | null, string | null][] = [
  [NOW - 5 * DAY, "op-owner", "owner@example.com", null, "dashboard", "auth.login", null, null, "198.51.100.1"],
  [NOW - 2 * DAY, "op-owner", "owner@example.com", null, "dashboard", "grant.created", "alice", JSON.stringify({ grant_id: "grant-alice-perks", entitlement: "annual_perks", duration: "weekly" }), "198.51.100.1"],
  [NOW - DAY, "op-dev", "dev@example.com", "tok-dev-grants", "api", "webhook.replayed", "evt-golden-1", null, null],
  [NOW - 3600_000, null, "system", null, "cli", "operator.created", "viewer@example.com", JSON.stringify({ role: "viewer", app_ids: null }), null],
];
for (const [at, op, actor, token, source, action, target, details, ip] of audits) {
  insert("audit_log", { at, operator_id: op, actor, token_id: token, source, action, target, details, ip });
}

// --- Experiments -------------------------------------------------------------------------------------------

const variants = JSON.stringify([
  { id: "a", offering_id: "default", weight: 50 },
  { id: "b", offering_id: "default_v2", weight: 50 },
]);
insert("experiment", {
  id: "exp-golden-old",
  project_id: "default",
  name: "Winter price test",
  notes: "Ran over the holidays",
  variants,
  status: "stopped",
  created_at: NOW - 40 * DAY,
  created_by: "owner@example.com",
  started_at: NOW - 39 * DAY,
  stopped_at: NOW - 20 * DAY,
  results: null,
  results_at: null,
});
insert("experiment", {
  id: "exp-golden-run",
  project_id: "default",
  name: "Spring price test",
  notes: "",
  variants,
  status: "running",
  created_at: NOW - 10 * DAY,
  created_by: "owner@example.com",
  started_at: NOW - 9 * DAY,
  stopped_at: null,
  results: null,
  results_at: null,
});
insert("experiment", {
  id: "exp-golden-draft",
  project_id: "default",
  name: "Next idea",
  notes: "",
  variants: JSON.stringify([
    { id: "a", offering_id: "default", weight: 70 },
    { id: "b", offering_id: "default_v2", weight: 30 },
  ]),
  status: "draft",
  created_at: NOW - DAY,
  created_by: "admin@example.com",
  started_at: null,
  stopped_at: null,
  results: null,
  results_at: null,
});
for (let i = 1; i <= 6; i++) {
  insert("experiment_enrollment", { experiment_id: "exp-golden-run", app_user_id: `exp-${i}`, variant: i % 2 ? "a" : "b", enrolled_at: NOW - 9 * DAY + i * 3600_000 });
}
for (const id of ["alice", "carol"]) insert("experiment_enrollment", { experiment_id: "exp-golden-old", app_user_id: id, variant: id === "alice" ? "a" : "b", enrolled_at: NOW - 38 * DAY });

// --- OAuth -------------------------------------------------------------------------------------------------

const C = {
  registered: "opc_golden_registered",
  single: "opc_golden_single",
  metadata: "https://client.example/oauth/metadata.json",
  stale: "https://client.example/oauth/stale.json",
};
insert("oauth_client", { id: C.registered, kind: "registered", name: "Golden Client", client_uri: "https://claude.ai", redirect_uris: JSON.stringify([CALLBACK, "http://localhost:8123/cb"]), created_at: NOW - DAY, fetched_at: null });
insert("oauth_client", { id: C.single, kind: "registered", name: "Single Redirect", client_uri: null, redirect_uris: JSON.stringify(["http://127.0.0.1:9000/callback"]), created_at: NOW - DAY, fetched_at: null });
insert("oauth_client", { id: C.metadata, kind: "metadata_document", name: "Example MCP Client", client_uri: "https://client.example", redirect_uris: JSON.stringify([CALLBACK]), created_at: NOW - DAY, fetched_at: NOW - 3600_000 });
insert("oauth_client", { id: C.stale, kind: "metadata_document", name: "Old Name", client_uri: null, redirect_uris: JSON.stringify([CALLBACK]), created_at: NOW - 3 * DAY, fetched_at: NOW - 2 * DAY });

const V = { one: "golden-verifier-one-0123456789-0123456789-0123456789", two: "golden-verifier-two-0123456789-0123456789-0123456789" };
const CHALLENGE = { one: s256(V.one), two: s256(V.two) };
const CODE = { one: "code_golden_one", expired: "code_golden_expired", disabled: "code_golden_disabled", meta: "code_golden_meta" };
const R = { pending: "req_golden_pending", deny: "req_golden_deny", meta: "req_golden_meta", expired: "req_golden_expired", local: "req_golden_local" };

function request(id: string, client: string, extra: Record<string, Bindable>) {
  insert("oauth_request", {
    id,
    client_id: client,
    redirect_uri: CALLBACK,
    state: "st-golden",
    code_challenge: CHALLENGE.one,
    scope: "read write:grants write:config",
    resource: `${ORIGIN}/mcp`,
    created_at: NOW - 60_000,
    expires_at: NOW + 540_000,
    operator_id: null,
    granted_scope: null,
    code_hash: null,
    used_at: null,
    grant_id: null,
    ...extra,
  });
}
request(R.pending, C.registered, {});
request(R.deny, C.registered, { state: null });
request(R.meta, C.metadata, { scope: "read" });
request(R.expired, C.registered, { expires_at: NOW - 60_000 });
request(R.local, C.registered, { redirect_uri: "http://localhost:8123/cb", scope: "read write:webhooks" });
request("req_golden_code", C.registered, { operator_id: "op-owner", granted_scope: "read write:grants", code_hash: sha(CODE.one), expires_at: NOW + 60_000 });
request("req_golden_code_expired", C.registered, { operator_id: "op-owner", granted_scope: "read", code_hash: sha(CODE.expired), expires_at: NOW - 1000 });
request("req_golden_code_disabled", C.registered, { operator_id: "op-disabled", granted_scope: "read", code_hash: sha(CODE.disabled), expires_at: NOW + 60_000 });
request("req_golden_code_meta", C.metadata, { operator_id: "op-viewer", granted_scope: "read", code_hash: sha(CODE.meta), code_challenge: CHALLENGE.two, expires_at: NOW + 60_000 });

const A = {
  live: "oat_golden_live_access",
  dev: "oat_golden_dev_access",
  expired: "oat_golden_expired_access",
  revoked: "oat_golden_revoked_access",
  other: "oat_golden_other_access",
  viewer: "oat_golden_viewer_access",
};
const RT = {
  live: "ort_golden_live_refresh",
  dev: "ort_golden_dev_refresh",
  expired: "ort_golden_expired_refresh",
  revoked: "ort_golden_revoked_refresh",
  other: "ort_golden_other_refresh",
  viewer: "ort_golden_viewer_refresh",
  stale: "ort_golden_stale_refresh",
};
function oauthGrant(id: string, client: string, operator: string, scopes: string[], access: string, refresh: string, extra: Record<string, Bindable> = {}) {
  insert("oauth_grant", {
    id,
    client_id: client,
    operator_id: operator,
    scopes: JSON.stringify(scopes),
    resource: `${ORIGIN}/mcp`,
    access_hash: sha(access),
    access_expires_at: NOW + 1800_000,
    refresh_hash: sha(refresh),
    refresh_expires_at: NOW + 29 * DAY,
    created_at: NOW - 2 * DAY,
    last_used_at: NOW - 60_000,
    revoked_at: null,
    ...extra,
  });
}
oauthGrant("grant-golden-live", C.registered, "op-owner", ["read", "write:grants"], A.live, RT.live);
oauthGrant("grant-golden-dev", C.metadata, "op-dev", ["read", "write:grants", "write:webhooks"], A.dev, RT.dev, { created_at: NOW - 3 * DAY, last_used_at: null });
oauthGrant("grant-golden-expired", C.registered, "op-owner", ["read"], A.expired, RT.expired, { access_expires_at: NOW - 60_000, created_at: NOW - 4 * DAY });
oauthGrant("grant-golden-revoked", C.registered, "op-owner", ["read"], A.revoked, RT.revoked, { revoked_at: NOW - DAY });
oauthGrant("grant-golden-other", C.registered, "op-owner", ["read"], A.other, RT.other, { resource: "https://other.example/mcp", created_at: NOW - 2 * DAY - 3600_000 });
oauthGrant("grant-golden-viewer", C.single, "op-viewer", ["read"], A.viewer, RT.viewer, { created_at: NOW - 5 * DAY });
oauthGrant("grant-golden-stale", C.registered, "op-owner", ["read"], "oat_golden_stale_access", RT.stale, { refresh_expires_at: NOW - 60_000, access_expires_at: NOW - 3 * DAY, created_at: NOW - 40 * DAY });

// --- Charts and experiment results, as Lite computes them -----------------------------------------------------

await rollupMetrics(DB, NOW, { full: true });
{
  const old = sqlite.prepare("SELECT * FROM experiment WHERE id = 'exp-golden-old'").get() as unknown as ExperimentRow;
  await experimentResults(DB, old, "production", false, NOW - 19 * DAY);
}

// --- The seed: every table, in an order that respects foreign keys -----------------------------------------------

const ORDER = [
  "config_version",
  "setting",
  "operator",
  "access_token",
  "session",
  "customer",
  "customer_alias",
  "store_transaction",
  "purchase_owner",
  "subscription_state",
  "subscriber_attribute",
  "promotional_grant",
  "webhook_event",
  "webhook_delivery",
  "audit_log",
  "experiment",
  "experiment_enrollment",
  "oauth_client",
  "oauth_request",
  "oauth_grant",
  "metric_daily",
  "job_state",
];
const SKIP = new Set(["d1_migrations", "sqlite_sequence", "_cf_KV", "_cf_METADATA", "capture", "customer_snapshot"]);
const tables = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((t) => t.name).filter((n) => !SKIP.has(n) && !n.startsWith("sqlite_") && !n.startsWith("_cf_"));
const ordered = [...ORDER.filter((t) => tables.includes(t)), ...tables.filter((t) => !ORDER.includes(t))];
const seed: { table: string; rows: Record<string, unknown>[] }[] = [];
for (const table of ordered) {
  const pk = table === "metric_daily" ? "metric, environment, project_id, app_id, store, product_id, date" : "rowid";
  const rows = sqlite.prepare(`SELECT * FROM ${table} ORDER BY ${pk}`).all() as Record<string, unknown>[];
  if (rows.length) seed.push({ table, rows });
}
const auditMax = (sqlite.prepare("SELECT max(id) AS id FROM audit_log").get() as { id: number }).id;

// --- Requests ----------------------------------------------------------------------------------------------------

// What the fake network answers: the webhook endpoint and the client metadata documents.
const fetchRoutes: Record<string, { status: number; body: string }> = {
  [WEBHOOK_URL]: { status: 200, body: "ok" },
  [C.stale]: { status: 200, body: JSON.stringify({ client_id: C.stale, client_name: "Refreshed Client", client_uri: "https://client.example/", redirect_uris: [CALLBACK, "http://example.com/insecure"] }) },
  "https://client.example/oauth/fresh.json": {
    status: 200,
    body: JSON.stringify({ client_id: "https://client.example/oauth/fresh.json", client_name: "  Fresh Client  ", redirect_uris: [CALLBACK] }),
  },
  "https://client.example/oauth/other.json": { status: 200, body: JSON.stringify({ client_id: "https://client.example/oauth/someone-else.json", redirect_uris: [CALLBACK] }) },
  "https://client.example/oauth/noredirect.json": { status: 200, body: JSON.stringify({ client_id: "https://client.example/oauth/noredirect.json", redirect_uris: ["http://example.com/cb"] }) },
  "https://client.example/oauth/notjson.json": { status: 200, body: "<html>nope</html>" },
  "https://client.example/oauth/gone.json": { status: 404, body: "not found" },
};
const fakeFetch = (async (input: RequestInfo | URL) => {
  const url = String(input instanceof Request ? input.url : input);
  const route = fetchRoutes[url];
  if (!route) return new Response("not found", { status: 404 });
  return new Response(route.body, { status: route.status, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const app = buildOfficeApp({ loadConfig: configLoader({ maxAgeMs: 0 }), appleRoots: [], rateLimiters: () => ({}), fetch: fakeFetch });
const env = { DB, OPERATOR_SECRET };

const KEEP_HEADERS = [
  "content-type",
  "www-authenticate",
  "allow",
  "cache-control",
  "pragma",
  "location",
  "access-control-allow-origin",
  "access-control-allow-methods",
  "access-control-allow-headers",
  "access-control-max-age",
];

function normalize(s: string) {
  return s
    .replace(/(opc_|oat_|ort_|request=|code=|"code":")[A-Za-z0-9_-]{43}/g, "$1<random>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>");
}

interface Case {
  name: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string | null;
  status: number;
  response_headers: Record<string, string>;
  response_body: string;
}
const cases: Case[] = [];

async function send(name: string, method: string, path: string, headers: Record<string, string>, body: string | null) {
  if (cases.some((c) => c.name === name)) throw new Error(`duplicate case ${name}`);
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {}, props: {} };
  const res = await app.fetch(new Request(`${ORIGIN}${path}`, { method, headers, body: body ?? undefined, redirect: "manual" }), env, ctx as unknown as ExecutionContext);
  const text = await res.text();
  while (pending.length) await pending.shift();
  const kept: Record<string, string> = {};
  for (const h of KEEP_HEADERS) {
    const v = res.headers.get(h);
    if (v !== null) kept[h] = normalize(v);
  }
  cases.push({ name, method, path, headers, body, status: res.status, response_headers: kept, response_body: normalize(text) });
  return { status: res.status, text };
}

const MCP_HEADERS = (token: string | null, extra: Record<string, string> = {}) => ({
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  "cf-connecting-ip": IP,
  ...(token ? { authorization: `Bearer ${token}` } : {}),
  ...extra,
});
let rpcId = 0;
const rpc = (name: string, token: string | null, method: string, params?: unknown, extra: Record<string, string> = {}) =>
  send(name, "POST", "/mcp", MCP_HEADERS(token, { "mcp-protocol-version": "2025-11-25", ...extra }), JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, ...(params === undefined ? {} : { params }) }));
const tool = (name: string, token: string, toolName: string, args?: unknown) => rpc(name, token, "tools/call", args === undefined ? { name: toolName } : { name: toolName, arguments: args });
const raw = (name: string, token: string | null, body: string, extra: Record<string, string> = {}) => send(name, "POST", "/mcp", MCP_HEADERS(token, extra), body);

const form = (p: Record<string, string>) => new URLSearchParams(p).toString();
const FORM = { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": IP };
const JSONH = { "content-type": "application/json", "cf-connecting-ip": IP };
const token = (name: string, p: Record<string, string>) => send(name, "POST", "/oauth/token", FORM, form(p));
const session = (s: string, extra: Record<string, string> = {}) => ({ cookie: `${SESSION_COOKIE}=${s}`, origin: ORIGIN, "content-type": "application/json", "cf-connecting-ip": IP, ...extra });
const adminCall = (name: string, method: string, path: string, headers: Record<string, string>, body: unknown = null) =>
  send(name, method, `/admin/v1${path}`, headers, body === null ? null : JSON.stringify(body));

function authorizePath(p: Record<string, string | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined) q.set(k, v);
  return `/oauth/authorize?${q}`;
}
const goodAuthorize = (extra: Record<string, string | undefined> = {}) =>
  authorizePath({ response_type: "code", client_id: C.registered, redirect_uri: CALLBACK, code_challenge: CHALLENGE.one, code_challenge_method: "S256", state: "xyz", scope: "read write:grants", resource: `${ORIGIN}/mcp`, ...extra });

// ---- MCP transport --------------------------------------------------------------------------------------------

for (const v of ["2025-11-25", "2025-06-18", "2025-03-26", "2099-01-01"]) {
  await rpc(`initialize ${v}`, T.viewer, "initialize", { protocolVersion: v, capabilities: {}, clientInfo: { name: "golden", version: "1" } });
}
await rpc("initialize without params", T.viewer, "initialize");
await rpc("ping", T.viewer, "ping");
await raw("notification gets 202", T.viewer, JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
await raw("client response gets 202", T.viewer, JSON.stringify({ jsonrpc: "2.0", id: 7, result: {} }));
await raw("null id gets 202", T.viewer, JSON.stringify({ jsonrpc: "2.0", id: null, method: "ping" }));
await send("GET /mcp is 405", "GET", "/mcp", MCP_HEADERS(T.viewer), null);
await send("DELETE /mcp is 405", "DELETE", "/mcp", MCP_HEADERS(T.viewer), null);
await rpc("foreign origin", T.viewer, "ping", undefined, { origin: "https://evil.example" });
await rpc("same origin", T.viewer, "ping", undefined, { origin: ORIGIN });
await rpc("unsupported protocol version", T.viewer, "ping", undefined, { "mcp-protocol-version": "1999-01-01" });
await rpc("no token", null, "initialize", {});
await rpc("unknown access token", "pat_not_a_real_token", "ping");
await rpc("not a bearer header", null, "ping", undefined, { authorization: "Basic dXNlcjpwYXNz" });
await rpc("other token kind", "sk_live_whatever", "ping");
await rpc("disabled operator's token", T.disabled, "ping");
await rpc("expired access token", T.expired, "ping");
await rpc("revoked access token", T.revoked, "ping");
await raw("batch body", T.viewer, "[{}]");
await raw("not JSON", T.viewer, "{nope");
await raw("not JSON-RPC 2.0", T.viewer, JSON.stringify({ jsonrpc: "1.0", id: 1, method: "ping" }));
await raw("a string body", T.viewer, JSON.stringify("ping"));
await rpc("unknown method", T.viewer, "resources/list");
await rpc("unknown tool", T.viewer, "tools/call", { name: "drop_tables", arguments: {} });
await rpc("tool without a name", T.viewer, "tools/call", {});

// ---- tools/list --------------------------------------------------------------------------------------------------

await rpc("tools/list owner with every scope", T.ownerAll, "tools/list");
await rpc("tools/list owner read", T.ownerRead, "tools/list");
await rpc("tools/list admin config", T.adminConfig, "tools/list");
await rpc("tools/list developer config", T.devConfig, "tools/list");
await rpc("tools/list developer grants", T.devGrants, "tools/list");
await rpc("tools/list viewer", T.viewer, "tools/list");
await rpc("tools/list limited to ios", T.limited, "tools/list");
await rpc("tools/list OAuth token", A.live, "tools/list");

// ---- access to tools -----------------------------------------------------------------------------------------------

await tool("grant needs grants:manage", T.ownerRead, "grant_entitlement", { app_user_id: "alice", entitlement_id: "pro", duration: "weekly" });
await tool("grant needs all apps", T.limited, "grant_entitlement", { app_user_id: "alice", entitlement_id: "pro", duration: "weekly" });
await tool("audit needs audit:read", T.devGrants, "get_audit_log");
await tool("save_config needs config:manage", T.devConfig, "save_config", { document: {}, base_id: 1 });
await tool("replay needs webhooks:replay", T.viewer, "replay_webhook", { event_id: "evt-golden-1" });
await tool("grant through OAuth without the role", A.viewer, "grant_entitlement", { app_user_id: "alice", entitlement_id: "pro", duration: "weekly" });
await rpc("arguments not an object", T.ownerAll, "tools/call", { name: "lookup_customer", arguments: ["alice"] });
await rpc("arguments a string", T.ownerAll, "tools/call", { name: "lookup_customer", arguments: "alice" });

// ---- lookup_customer -------------------------------------------------------------------------------------------------

for (const user of ["alice", "bob", "carol", "dave", "erin", "frank", "gina", "hank", "ivy", "$RCAnonymousID:a11ce0000000000000000000000000a1", "erin-old-id"]) {
  await tool(`lookup_customer ${user}`, T.ownerAll, "lookup_customer", { app_user_id: user });
}
await tool("lookup_customer limited alice", T.limited, "lookup_customer", { app_user_id: "alice" });
await tool("lookup_customer limited hank", T.limited, "lookup_customer", { app_user_id: "hank" });
await tool("lookup_customer unknown", T.ownerAll, "lookup_customer", { app_user_id: "nobody" });
await tool("lookup_customer missing id", T.ownerAll, "lookup_customer", {});
await tool("lookup_customer empty id", T.ownerAll, "lookup_customer", { app_user_id: "" });
await tool("lookup_customer number id", T.ownerAll, "lookup_customer", { app_user_id: 42 });
await tool("lookup_customer long id", T.ownerAll, "lookup_customer", { app_user_id: "x".repeat(257) });
await tool("lookup_customer project", T.ownerAll, "lookup_customer", { app_user_id: "bob", project: "default" });
await tool("lookup_customer unknown project", T.ownerAll, "lookup_customer", { app_user_id: "bob", project: "nope" });
await tool("lookup_customer long project", T.ownerAll, "lookup_customer", { app_user_id: "bob", project: "p".repeat(51) });
await tool("lookup_customer null args", T.ownerAll, "lookup_customer", { app_user_id: null });

// ---- search_customers -------------------------------------------------------------------------------------------------

await tool("search_customers newest", T.ownerAll, "search_customers");
await tool("search_customers prefix", T.ownerAll, "search_customers", { query: "exp-" });
await tool("search_customers email", T.ownerAll, "search_customers", { query: "BOB@example.com" });
await tool("search_customers transaction", T.ownerAll, "search_customers", { query: "1000002" });
await tool("search_customers original transaction", T.ownerAll, "search_customers", { query: "golden-token-hank" });
await tool("search_customers purchases only", T.ownerAll, "search_customers", { purchases_only: true, limit: 3 });
await tool("search_customers limit 1", T.ownerAll, "search_customers", { limit: 1.7 });
await tool("search_customers no match", T.ownerAll, "search_customers", { query: "zzz-nobody" });
await tool("search_customers limited", T.limited, "search_customers");
await tool("search_customers bad limit", T.ownerAll, "search_customers", { limit: 0 });
await tool("search_customers string limit", T.ownerAll, "search_customers", { limit: "5" });
await tool("search_customers long query", T.ownerAll, "search_customers", { query: "q".repeat(300) });
await tool("search_customers number query", T.ownerAll, "search_customers", { query: 5 });

// ---- explain_entitlement -------------------------------------------------------------------------------------------------

const explain: [string, string, string][] = [
  ["alice pro", "alice", "pro"],
  ["alice perks", "alice", "annual_perks"],
  ["bob pro grace", "bob", "pro"],
  ["bob perks", "bob", "annual_perks"],
  ["carol pro trial", "carol", "pro"],
  ["carol perks never", "carol", "annual_perks"],
  ["dave pro", "dave", "pro"],
  ["dave perks refunded", "dave", "annual_perks"],
  ["erin perks", "erin", "annual_perks"],
  ["frank pro", "frank", "pro"],
  ["gina pro lifetime grant", "gina", "pro"],
  ["gina perks grants ended", "gina", "annual_perks"],
  ["hank pro expired chain", "hank", "pro"],
  ["ivy pro nothing", "ivy", "pro"],
  ["nobody pro", "nobody", "pro"],
];
for (const [name, user, ent] of explain) await tool(`explain_entitlement ${name}`, T.ownerAll, "explain_entitlement", { app_user_id: user, entitlement_id: ent });
await tool("explain_entitlement limited alice", T.limited, "explain_entitlement", { app_user_id: "alice", entitlement_id: "pro" });
await tool("explain_entitlement limited hank", T.limited, "explain_entitlement", { app_user_id: "hank", entitlement_id: "pro" });
await tool("explain_entitlement unknown entitlement", T.ownerAll, "explain_entitlement", { app_user_id: "alice", entitlement_id: "gold" });
await tool("explain_entitlement missing entitlement", T.ownerAll, "explain_entitlement", { app_user_id: "alice" });

// ---- get_metrics -----------------------------------------------------------------------------------------------------------

const metrics: [string, Record<string, unknown>][] = [
  ["revenue default range", { chart: "revenue" }],
  ["mrr by month", { chart: "mrr", from: "2025-10-01", to: "2026-03-15", interval: "month" }],
  ["active_subscriptions by week", { chart: "active_subscriptions", from: "2026-01-01", to: "2026-03-15" }],
  ["revenue by day", { chart: "revenue", from: "2026-02-20", to: "2026-03-15" }],
  ["revenue ios app store", { chart: "revenue", from: "2025-12-01", to: "2026-03-15", app: "ios", store: "app_store" }],
  ["revenue product", { chart: "revenue", from: "2025-12-01", to: "2026-03-15", product: "pro:monthly" }],
  ["revenue project", { chart: "revenue", from: "2026-01-01", to: "2026-03-15", interval: "month", project: "default" }],
  ["revenue sandbox", { chart: "revenue", from: "2026-03-01", to: "2026-03-15", environment: "sandbox" }],
  ["new_customers", { chart: "new_customers", from: "2026-03-01", to: "2026-03-15" }],
  ["subscription_status", { chart: "subscription_status" }],
  ["active_trials", { chart: "active_trials", from: "2026-01-01", to: "2026-03-15", interval: "week" }],
  ["churn", { chart: "churn", from: "2025-09-01", to: "2026-03-15", interval: "month" }],
  ["to in the future", { chart: "mrr", from: "2026-03-01", to: "2026-04-30", interval: "week" }],
  ["only to", { chart: "mrr", to: "2026-03-01" }],
  ["too many points", { chart: "revenue", from: "2025-01-01", to: "2026-03-15", interval: "day" }],
  ["unknown chart", { chart: "nope" }],
  ["missing chart", {}],
  ["bad date", { chart: "mrr", from: "2026-3-1", to: "2026-03-15" }],
  ["from after to", { chart: "mrr", from: "2026-03-15", to: "2026-03-01" }],
  ["too long", { chart: "mrr", from: "2010-01-01", to: "2026-03-15" }],
  ["bad interval", { chart: "mrr", interval: "year" }],
  ["bad environment", { chart: "mrr", environment: "staging" }],
  ["unknown app", { chart: "mrr", app: "web" }],
  ["bad store", { chart: "mrr", store: "amazon" }],
  ["unknown project", { chart: "mrr", project: "nope" }],
];
for (const [name, args] of metrics) await tool(`get_metrics ${name}`, T.ownerAll, "get_metrics", args);
await tool("get_metrics limited other app", T.limited, "get_metrics", { chart: "mrr", app: "android" });
await tool("get_metrics limited", T.limited, "get_metrics", { chart: "revenue", from: "2026-01-01", to: "2026-03-15", interval: "month" });

// ---- get_experiments, get_config ---------------------------------------------------------------------------------------------

await tool("get_experiments", T.viewer, "get_experiments");
await tool("get_experiments sandbox", T.viewer, "get_experiments", { environment: "sandbox" });
await tool("get_experiments limited", T.limited, "get_experiments");
await tool("get_experiments unknown project", T.viewer, "get_experiments", { project: "nope" });
await tool("get_config owner", T.ownerAll, "get_config");
await tool("get_config limited", T.limited, "get_config");

// ---- webhooks ------------------------------------------------------------------------------------------------------------------

await tool("list_webhook_deliveries", T.viewer, "list_webhook_deliveries");
await tool("list_webhook_deliveries pending", T.viewer, "list_webhook_deliveries", { status: "pending" });
await tool("list_webhook_deliveries failed limit", T.viewer, "list_webhook_deliveries", { status: "failed", limit: 1 });
await tool("list_webhook_deliveries limited", T.limited, "list_webhook_deliveries");
await tool("list_webhook_deliveries bad status", T.viewer, "list_webhook_deliveries", { status: "lost" });
await tool("list_webhook_deliveries bad limit", T.viewer, "list_webhook_deliveries", { limit: 500 });
await tool("replay_webhook", T.devGrants, "replay_webhook", { event_id: "evt-golden-3" });
await tool("replay_webhook unknown", T.devGrants, "replay_webhook", { event_id: "evt-nope" });
await tool("replay_webhook limited other app", T.limited, "replay_webhook", { event_id: "evt-golden-4" });
await tool("list_webhook_deliveries after replay", T.viewer, "list_webhook_deliveries");

// ---- grants -----------------------------------------------------------------------------------------------------------------------

await tool("grant_entitlement weekly", T.devGrants, "grant_entitlement", { app_user_id: "ivy", entitlement_id: "pro", duration: "weekly", note: "support make-good" });
await tool("grant_entitlement until", T.ownerAll, "grant_entitlement", { app_user_id: "ivy", entitlement_id: "annual_perks", expires_at: "2026-06-01" });
await tool("grant_entitlement until time", T.ownerAll, "grant_entitlement", { app_user_id: "carol", entitlement_id: "pro", expires_at: "2026-04-01T08:30:00Z" });
await tool("grant_entitlement lifetime", T.ownerAll, "grant_entitlement", { app_user_id: "erin", entitlement_id: "pro", duration: "lifetime" });
await tool("grant_entitlement no duration", T.ownerAll, "grant_entitlement", { app_user_id: "ivy", entitlement_id: "pro" });
await tool("grant_entitlement bad duration", T.ownerAll, "grant_entitlement", { app_user_id: "ivy", entitlement_id: "pro", duration: "forever" });
await tool("grant_entitlement bad date", T.ownerAll, "grant_entitlement", { app_user_id: "ivy", entitlement_id: "pro", expires_at: "next week" });
await tool("grant_entitlement past date", T.ownerAll, "grant_entitlement", { app_user_id: "ivy", entitlement_id: "pro", expires_at: "2020-01-01" });
await tool("grant_entitlement too far", T.ownerAll, "grant_entitlement", { app_user_id: "ivy", entitlement_id: "pro", expires_at: "2040-01-01" });
await tool("grant_entitlement unknown entitlement", T.ownerAll, "grant_entitlement", { app_user_id: "ivy", entitlement_id: "gold", duration: "weekly" });
await tool("grant_entitlement no customer", T.ownerAll, "grant_entitlement", { app_user_id: "no-such-user", entitlement_id: "pro", duration: "weekly" });
await tool("grant_entitlement long note", T.ownerAll, "grant_entitlement", { app_user_id: "ivy", entitlement_id: "pro", duration: "weekly", note: "n".repeat(501) });
await tool("grant_entitlement missing entitlement", T.ownerAll, "grant_entitlement", { app_user_id: "ivy", duration: "weekly" });
await tool("explain_entitlement after grant", T.ownerAll, "explain_entitlement", { app_user_id: "ivy", entitlement_id: "pro" });
await tool("revoke_grant", T.devGrants, "revoke_grant", { app_user_id: "alice", grant_id: "grant-alice-perks" });
await tool("revoke_grant again", T.devGrants, "revoke_grant", { app_user_id: "alice", grant_id: "grant-alice-perks" });
await tool("revoke_grant unknown", T.devGrants, "revoke_grant", { app_user_id: "alice", grant_id: "grant-nope" });
await tool("revoke_grant other customer's", T.devGrants, "revoke_grant", { app_user_id: "bob", grant_id: "grant-gina-life" });
await tool("revoke_grant missing grant", T.devGrants, "revoke_grant", { app_user_id: "bob" });
await tool("lookup_customer alice after revoke", T.ownerAll, "lookup_customer", { app_user_id: "alice" });

// ---- save_config ------------------------------------------------------------------------------------------------------------------

{
  const renamed = structuredClone(config.document) as { projects: Record<string, { name: string; apps: Record<string, { sdk_keys: string[] }> }> };
  renamed.projects.default!.name = "Renamed";
  await tool("save_config", T.adminConfig, "save_config", { document: renamed, base_id: 1, note: "Rename" });
  await tool("save_config stale", T.adminConfig, "save_config", { document: renamed, base_id: 1 });
  const bad = structuredClone(renamed);
  bad.projects.default!.apps.ios!.sdk_keys = ["test_nope_nope_nope_nope"];
  await tool("save_config invalid", T.adminConfig, "save_config", { document: bad, base_id: 2 });
  await tool("save_config not a config", T.adminConfig, "save_config", { document: { version: 2, projects: "x" }, base_id: 2 });
  await tool("save_config missing base_id", T.adminConfig, "save_config", { document: renamed });
  await tool("save_config negative base_id", T.adminConfig, "save_config", { document: renamed, base_id: -1 });
  await tool("save_config long note", T.adminConfig, "save_config", { document: renamed, base_id: 2, note: "n".repeat(501) });
  const moved = structuredClone(renamed) as unknown as { projects: Record<string, unknown> };
  moved.projects = { other: (moved.projects as Record<string, unknown>).default };
  await tool("save_config removes a project with customers", T.adminConfig, "save_config", { document: moved, base_id: 2 });
  await tool("save_config limited", T.limited, "save_config", { document: renamed, base_id: 2 });
  await tool("get_config after save", T.ownerAll, "get_config");
}

// ---- get_audit_log -----------------------------------------------------------------------------------------------------------------

await tool("get_audit_log", T.ownerAll, "get_audit_log");
await tool("get_audit_log limit", T.ownerAll, "get_audit_log", { limit: 3 });
await tool("get_audit_log action", T.ownerAll, "get_audit_log", { action: "grant.created" });
await tool("get_audit_log nothing", T.ownerAll, "get_audit_log", { action: "nothing.here" });
await tool("get_audit_log bad limit", T.ownerAll, "get_audit_log", { limit: 101 });

// ---- OAuth discovery ------------------------------------------------------------------------------------------------------------------

await send("protected resource metadata /mcp", "GET", "/.well-known/oauth-protected-resource/mcp", {}, null);
await send("protected resource metadata", "GET", "/.well-known/oauth-protected-resource", {}, null);
await send("authorization server metadata", "GET", "/.well-known/oauth-authorization-server", {}, null);
await send("well-known preflight", "OPTIONS", "/.well-known/oauth-authorization-server", { origin: "https://claude.ai", "access-control-request-method": "GET" }, null);
await send("token preflight", "OPTIONS", "/oauth/token", { origin: "https://claude.ai", "access-control-request-method": "POST" }, null);
await send("register preflight", "OPTIONS", "/oauth/register", { origin: "https://claude.ai", "access-control-request-method": "POST" }, null);

// ---- Registration -----------------------------------------------------------------------------------------------------------------------

const register = (name: string, body: unknown) => send(name, "POST", "/oauth/register", JSONH, typeof body === "string" ? body : JSON.stringify(body));
await register("register", { client_name: "Claude", client_uri: "https://claude.ai", redirect_uris: [CALLBACK] });
await register("register localhost, no name", { redirect_uris: ["http://localhost:8123/cb", "http://127.0.0.1/cb"], grant_types: ["authorization_code"] });
await register("register non-https client_uri", { client_name: "  Spaces  ", client_uri: "http://claude.ai", redirect_uris: [CALLBACK], token_endpoint_auth_method: "none" });
await register("register http redirect", { redirect_uris: ["http://example.com/cb"] });
await register("register no redirects", { client_name: "x" });
await register("register empty redirects", { redirect_uris: [] });
await register("register fragment redirect", { redirect_uris: ["https://claude.ai/cb#x"] });
await register("register too many redirects", { redirect_uris: Array.from({ length: 11 }, (_, i) => `https://claude.ai/cb${i}`) });
await register("register client secret", { redirect_uris: [CALLBACK], token_endpoint_auth_method: "client_secret_basic" });
await register("register bad grant type", { redirect_uris: [CALLBACK], grant_types: ["client_credentials"] });
await register("register not JSON", "nope");
await register("register JSON null", "null");

// ---- Authorization -------------------------------------------------------------------------------------------------------------------------

const authorize = (name: string, path: string) => send(name, "GET", path, { "cf-connecting-ip": IP }, null);
await authorize("authorize", goodAuthorize());
await authorize("authorize without scope or resource", goodAuthorize({ scope: undefined, resource: undefined, state: undefined }));
await authorize("authorize filters unknown scopes", goodAuthorize({ scope: "read admin write:config" }));
await authorize("authorize default redirect", authorizePath({ response_type: "code", client_id: C.single, code_challenge: CHALLENGE.one, code_challenge_method: "S256" }));
await authorize("authorize localhost redirect", goodAuthorize({ redirect_uri: "http://localhost:8123/cb" }));
await authorize("authorize resource with trailing slash", goodAuthorize({ resource: `${ORIGIN}/mcp/` }));
await authorize("authorize cached metadata client", goodAuthorize({ client_id: C.metadata }));
await authorize("authorize refetches a stale metadata document", goodAuthorize({ client_id: C.stale }));
await authorize("authorize new metadata document", goodAuthorize({ client_id: "https://client.example/oauth/fresh.json" }));
await authorize("authorize missing client_id", goodAuthorize({ client_id: undefined }));
await authorize("authorize unknown client", goodAuthorize({ client_id: "opc_unknown" }));
await authorize("authorize http client id", goodAuthorize({ client_id: "http://client.example/meta.json" }));
await authorize("authorize IP client id", goodAuthorize({ client_id: "https://10.0.0.1/meta.json" }));
await authorize("authorize root client id", goodAuthorize({ client_id: "https://client.example/" }));
await authorize("authorize mismatched metadata", goodAuthorize({ client_id: "https://client.example/oauth/other.json" }));
await authorize("authorize metadata without redirects", goodAuthorize({ client_id: "https://client.example/oauth/noredirect.json" }));
await authorize("authorize metadata not JSON", goodAuthorize({ client_id: "https://client.example/oauth/notjson.json" }));
await authorize("authorize metadata 404", goodAuthorize({ client_id: "https://client.example/oauth/gone.json" }));
await authorize("authorize wrong redirect", goodAuthorize({ redirect_uri: "https://evil.example/cb" }));
await authorize("authorize no redirect with two registered", goodAuthorize({ redirect_uri: undefined }));
await authorize("authorize token response type", goodAuthorize({ response_type: "token" }));
await authorize("authorize plain PKCE", goodAuthorize({ code_challenge_method: "plain" }));
await authorize("authorize no PKCE", goodAuthorize({ code_challenge: undefined, code_challenge_method: undefined }));
await authorize("authorize short challenge", goodAuthorize({ code_challenge: "short" }));
await authorize("authorize other resource", goodAuthorize({ resource: "https://other.example/mcp" }));
await authorize("authorize bad resource", goodAuthorize({ resource: "not a url" }));
await authorize("authorize unknown scopes", goodAuthorize({ scope: "admin everything" }));

// ---- Consent ---------------------------------------------------------------------------------------------------------------------------------

await adminCall("consent view", "GET", `/oauth/requests/${R.pending}`, session(S.owner));
await adminCall("consent view as viewer", "GET", `/oauth/requests/${R.pending}`, session(S.viewer));
await adminCall("consent view metadata client", "GET", `/oauth/requests/${R.meta}`, session(S.viewer));
await adminCall("consent view localhost", "GET", `/oauth/requests/${R.local}`, session(S.owner));
await adminCall("consent view expired", "GET", `/oauth/requests/${R.expired}`, session(S.owner));
await adminCall("consent view unknown", "GET", "/oauth/requests/req_nope", session(S.owner));
await adminCall("consent view with a token", "GET", `/oauth/requests/${R.pending}`, { authorization: `Bearer ${T.ownerAll}` });
await adminCall("consent view signed out", "GET", `/oauth/requests/${R.pending}`, {});
await adminCall("consent unknown decision", "POST", `/oauth/requests/${R.pending}/maybe`, session(S.owner), {});
await adminCall("consent approve with a token", "POST", `/oauth/requests/${R.pending}/approve`, { authorization: `Bearer ${T.ownerAll}`, "content-type": "application/json" }, {});
await adminCall("consent approve from another site", "POST", `/oauth/requests/${R.pending}/approve`, session(S.owner, { origin: "https://evil.example" }), {});
await adminCall("consent approve nothing allowed", "POST", `/oauth/requests/${R.local}/approve`, session(S.viewer), { scopes: ["write:webhooks"] });
await adminCall("consent approve viewer", "POST", `/oauth/requests/${R.local}/approve`, session(S.viewer), {});
await adminCall("consent approve subset", "POST", `/oauth/requests/${R.pending}/approve`, session(S.owner), { scopes: ["read", "write:config", "admin"] });
await adminCall("consent approve again", "POST", `/oauth/requests/${R.pending}/approve`, session(S.owner), {});
await adminCall("consent deny", "POST", `/oauth/requests/${R.deny}/deny`, session(S.owner), null);
await adminCall("consent view after deny", "GET", `/oauth/requests/${R.deny}`, session(S.owner));
await adminCall("consent approve expired", "POST", `/oauth/requests/${R.expired}/approve`, session(S.owner), {});
await adminCall("consent approve metadata client", "POST", `/oauth/requests/${R.meta}/approve`, session(S.owner), { scopes: "read" });

// ---- Tokens -------------------------------------------------------------------------------------------------------------------------------------

const code = (extra: Record<string, string>) => ({ grant_type: "authorization_code", code: CODE.one, client_id: C.registered, code_verifier: V.one, ...extra });
await token("token missing params", { grant_type: "authorization_code", code: CODE.one });
await token("token unknown code", code({ code: "code_nope" }));
await token("token expired code", code({ code: CODE.expired }));
await token("token other client", code({ client_id: C.single }));
await token("token other redirect", code({ redirect_uri: "http://localhost:8123/cb" }));
await token("token other resource", code({ resource: "https://other.example/mcp" }));
await token("token wrong verifier", code({ code_verifier: "wrong".repeat(10) }));
await token("token disabled operator", code({ code: CODE.disabled }));
await token("token", code({ redirect_uri: CALLBACK, resource: `${ORIGIN}/mcp/` }));
await token("token code reused", code({}));
await send("token metadata client JSON body", "POST", "/oauth/token", JSONH, JSON.stringify({ grant_type: "authorization_code", code: CODE.meta, client_id: C.metadata, code_verifier: V.two, extra: 5 }));
await token("token unsupported grant", { grant_type: "password", username: "a", password: "b" });
await token("token no grant type", {});
await send("token not a form", "POST", "/oauth/token", { "content-type": "text/plain" }, "grant_type=refresh_token");

await rpc("mcp with the live OAuth token", A.live, "tools/list");
await tool("mcp OAuth tool call is audited", A.live, "grant_entitlement", { app_user_id: "gina", entitlement_id: "annual_perks", duration: "daily" });
await rpc("mcp with another resource's token", A.other, "ping");
await rpc("mcp with an expired OAuth token", A.expired, "ping");
await rpc("mcp with a revoked OAuth token", A.revoked, "ping");
await rpc("mcp with an unknown OAuth token", "oat_golden_nope", "ping");
await rpc("mcp with an OAuth refresh token", RT.live, "ping");
await adminCall("OAuth token at the admin API", "GET", "/me", { authorization: `Bearer ${A.live}` });

await token("refresh missing client", { grant_type: "refresh_token", refresh_token: RT.dev });
await token("refresh other client", { grant_type: "refresh_token", refresh_token: RT.dev, client_id: C.registered });
await token("refresh unknown", { grant_type: "refresh_token", refresh_token: "ort_nope", client_id: C.metadata });
await token("refresh revoked", { grant_type: "refresh_token", refresh_token: RT.revoked, client_id: C.registered });
await token("refresh past its 30 days", { grant_type: "refresh_token", refresh_token: RT.stale, client_id: C.registered });
await token("refresh invalid scope", { grant_type: "refresh_token", refresh_token: RT.dev, client_id: C.metadata, scope: "admin write:config" });
await token("refresh narrowing", { grant_type: "refresh_token", refresh_token: RT.dev, client_id: C.metadata, scope: "read write:webhooks admin" });
await token("refresh rotated out", { grant_type: "refresh_token", refresh_token: RT.dev, client_id: C.metadata });
await rpc("mcp with the rotated-out access token", A.dev, "ping");
await token("refresh expired access", { grant_type: "refresh_token", refresh_token: RT.expired, client_id: C.registered });
await rpc("mcp after refreshing an expired access token", A.expired, "ping");

// ---- Connected apps and revocation ---------------------------------------------------------------------------------------------------------

await adminCall("connected apps owner", "GET", "/oauth/grants", session(S.owner));
await adminCall("connected apps viewer", "GET", "/oauth/grants", session(S.viewer));
await adminCall("connected apps with a token", "GET", "/oauth/grants", { authorization: `Bearer ${T.viewer}` });
await adminCall("revoke connected app with a token", "POST", "/oauth/grants/grant-golden-viewer/revoke", { authorization: `Bearer ${T.viewer}` });
await adminCall("revoke someone else's connected app", "POST", "/oauth/grants/grant-golden-viewer/revoke", session(S.owner));
await adminCall("revoke connected app", "POST", "/oauth/grants/grant-golden-viewer/revoke", session(S.viewer));
await adminCall("revoke connected app again", "POST", "/oauth/grants/grant-golden-viewer/revoke", session(S.viewer));
await adminCall("revoke unknown connected app", "POST", "/oauth/grants/grant-nope/revoke", session(S.owner));
await rpc("mcp after the connected app was revoked", A.viewer, "ping");

await send("revoke endpoint refresh token", "POST", "/oauth/revoke", FORM, form({ token: RT.live }));
await rpc("mcp after revoking the refresh token", A.live, "ping");
await send("revoke endpoint unknown token", "POST", "/oauth/revoke", FORM, form({ token: "whatever" }));
await send("revoke endpoint no token", "POST", "/oauth/revoke", FORM, "");
await send("revoke endpoint JSON", "POST", "/oauth/revoke", JSONH, JSON.stringify({ token: A.other }));
await rpc("mcp after JSON revoke", A.other, "ping");
await adminCall("connected apps owner at the end", "GET", "/oauth/grants", session(S.owner));
await tool("get_audit_log at the end", T.ownerAll, "get_audit_log", { limit: 100 });

// --- Output -----------------------------------------------------------------------------------------------------------------------------------------

const auditAfter = (sqlite.prepare("SELECT at, operator_id, actor, token_id, source, action, target, details, ip FROM audit_log WHERE id > ? ORDER BY id").all(auditMax) as Record<string, unknown>[]).map((r) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" ? normalize(v) : v])),
);

process.stdout.write(
  JSON.stringify(
    {
      origin: ORIGIN,
      now: NOW,
      operator_secret: OPERATOR_SECRET,
      session_cookie: SESSION_COOKIE,
      webhook_url: WEBHOOK_URL,
      fetch_routes: fetchRoutes,
      normalize: [String(/(opc_|oat_|ort_|request=|code=|"code":")[A-Za-z0-9_-]{43}/g) + ' -> "$1<random>"', String(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) + ' -> "<uuid>"'],
      seed,
      cases,
      audit_after: auditAfter,
    },
    null,
    1,
  ) + "\n",
);
