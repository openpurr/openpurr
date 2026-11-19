// The MCP server: /mcp on the back-office Worker, so an AI assistant (Claude Code, Claude Desktop,
// any MCP client) can look up customers, explain entitlements, read charts and grant access.
//
// Transport: MCP Streamable HTTP, stateless. Each JSON-RPC request is a POST answered with one
// JSON response (no SSE: no tool here streams or calls back). GET and DELETE answer 405, which
// the spec allows. Notifications and client responses get 202.
//
// Auth: "Authorization: Bearer pat_..." personal access tokens (the same as the admin API), or
// OAuth access tokens issued for this endpoint (src/office/oauth.ts: Claude.ai connectors and other
// clients that sign in). Either way every tool is limited by the operator's role and the token's
// scopes (src/office/principal.ts) and by the apps they may see. Unauthenticated requests get 401
// with WWW-Authenticate pointing at the protected-resource metadata, which starts OAuth. tools/list only lists what the token can use. Changes are
// audited with source "mcp". Browser requests from other sites are refused (Origin check), and
// calls are rate limited per token.
//
// No MCP SDK: the protocol surface used here (initialize, ping, tools/list, tools/call) is small,
// and the SDK and its schema library would cost more bundle than this whole file.

import type { Context } from "hono";
import { Hono } from "hono/tiny";
import { readAttributes } from "../attributes";
import { ConfigError, entitlementsFor, parseConfig, type ProjectConfig } from "../config";
import { changeProblems, ConfigConflict, currentVersion, saveConfig } from "../config-store";
import { computeSnapshot, promotionalProductId } from "../customer-info";
import type { AppEnv } from "../env";
import { type GrantRow, loadCustomer, type SubscriptionStateRow, type TransactionRow } from "../ledger";
import { cloudflareRateLimiters } from "../lib/rate-limit";
import { CHARTS, dayOf, type Interval, readChart } from "../metrics";
import { deliverNow } from "../webhooks";
import { audit } from "./auth";
import { BadInput, searchCustomers } from "./customers";
import { chooseProject, visibleProjects } from "./project";
import { runChecks, summarize } from "./doctor";
import { type Actor, GRANT_DURATIONS, GrantError, grantEntitlement, rebuildAfterGrant, revokeGrant } from "./grants";
import { ACCESS_PREFIX as OAUTH_ACCESS_PREFIX, mcpResource, oauthTokenOwner, resourceMetadataUrl } from "./oauth";
import { ACCESS_TOKEN_PREFIX, can, canSeeApp, type Permission, type Principal, principalOf, type TokenScope, tokenPrincipal } from "./principal";

export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const SERVER_INFO = { name: "openpurr", title: "openpurr", version: "1.0.0" };
const INSTRUCTIONS = `openpurr is a self-hosted, RevenueCat-compatible subscription backend. Customers are identified by app user ID (what the app passes to the RevenueCat SDK); a customer can have several (aliases). A deployment has one or more projects (one per title); each has its own apps, entitlements and customers. Projects, apps, products and entitlements come from the deployment's config (get_config). When there are several projects, pass project to the customer tools.
- To answer "why does (or doesn't) a customer have X", use explain_entitlement: it checks every purchase and grant and says what decided it.
- To find a customer by email, transaction ID or the start of an ID, use search_customers.
- Charts (get_metrics) are in USD at each purchase date's exchange rate, days in UTC, and production data unless you ask for sandbox.
- grant_entitlement gives access without a purchase; revoke_grant ends it. Both are audited; confirm with the user before granting or revoking.`;

type Ctx = Context<AppEnv>;
type Args = Record<string, unknown>;

interface ToolResult {
  text: string;
  structured?: Record<string, unknown>;
  isError?: boolean;
}

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  permission: Permission;
  /** Needs access to all apps (entitlements and grants aren't per app). */
  allApps?: boolean;
  run: (c: Ctx, principal: Principal, args: Args) => Promise<ToolResult>;
}

class ToolError extends Error {}

// ---- Formatting helpers ---------------------------------------------------------------------------

const STORE: Record<string, string> = { app_store: "App Store", play_store: "Google Play", promotional: "promotional grant" };
const day = (ms: number | null) => (ms === null ? "never" : dayOf(ms));
const when = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
const money = (micros: number | null, currency: string | null) => (micros === null || !currency ? null : `${(micros / 1e6).toFixed(2)} ${currency}`);
const productLabel = (t: { product_id: string; base_plan_id: string | null }) => t.product_id + (t.base_plan_id ? `:${t.base_plan_id}` : "");

function str(args: Args, key: string, { required = true, max = 256 } = {}) {
  const v = args[key];
  if (v === undefined || v === null || v === "") {
    if (required) throw new ToolError(`${key} is required.`);
    return undefined;
  }
  if (typeof v !== "string") throw new ToolError(`${key} must be a string.`);
  if (v.length > max) throw new ToolError(`${key} is too long.`);
  return v;
}

function num(args: Args, key: string, min: number, max: number) {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new ToolError(`${key} must be a number from ${min} to ${max}.`);
  return Math.floor(v);
}

/** How a subscription purchase stands, in words. */
function purchaseStatus(t: TransactionRow, state: SubscriptionStateRow | undefined, now: number) {
  if (t.revoked_at !== null) return `refunded on ${day(t.revoked_at)}${t.revocation_reason ? ` (${t.revocation_reason})` : ""}`;
  if (t.is_upgraded) return "replaced by an upgrade";
  if (t.expires_at === null) return t.product_type === "consumable" ? "consumable" : "owned for life";
  const grace = state?.grace_period_expires_at && state.grace_period_expires_at > t.expires_at ? state.grace_period_expires_at : null;
  const end = grace ?? t.expires_at;
  const parts: string[] = [];
  if (end > now) {
    parts.push(`active until ${day(end)}`);
    if (grace) parts.push(`in a billing grace period (payment failed; access continues until ${day(grace)})`);
    if (t.period_type === "trial") parts.push("free trial");
    if (state?.auto_renew === 0) parts.push(`auto-renew turned off${state.unsubscribe_detected_at ? ` on ${day(state.unsubscribe_detected_at)}` : ""}, so it won't renew`);
    else if (state?.auto_renew === 1) parts.push("renews automatically");
  } else {
    parts.push(`expired on ${day(end)}`);
    if (t.period_type === "trial") parts.push("a free trial that didn't convert");
    if (state?.status === 3) parts.push("the store is still retrying a failed payment (billing retry)");
    else if (state?.billing_issue_detected_at) parts.push(`a billing problem was seen on ${day(state.billing_issue_detected_at)}`);
    if (state?.unsubscribe_detected_at) parts.push(`auto-renew was turned off on ${day(state.unsubscribe_detected_at)}`);
    if (grace) parts.push("after a billing grace period ran out");
  }
  return parts.join("; ");
}

/** The latest purchase of each purchase chain (renewals share the original transaction ID). */
function latestPerChain(transactions: TransactionRow[]) {
  const chains = new Map<string, { latest: TransactionRow; first: number; count: number }>();
  for (const t of transactions) {
    const key = `${t.store}:${t.original_transaction_id}`;
    const c = chains.get(key);
    if (!c) chains.set(key, { latest: t, first: t.purchased_at, count: 1 });
    else {
      c.count++;
      c.first = Math.min(c.first, t.purchased_at);
      if (t.purchased_at > c.latest.purchased_at) c.latest = t;
    }
  }
  return [...chains.values()].sort((a, b) => b.latest.purchased_at - a.latest.purchased_at);
}

function chainLine(chain: { latest: TransactionRow; first: number; count: number }, states: SubscriptionStateRow[], now: number) {
  const t = chain.latest;
  const state = states.find((s) => s.store === t.store && s.original_transaction_id === t.original_transaction_id);
  const flags = [t.environment === "sandbox" ? "sandbox" : null, t.verified ? null : "not verified with the store", t.ownership_type === "FAMILY_SHARED" ? "family sharing" : null].filter(Boolean);
  const renewals = chain.count > 1 ? `, ${chain.count - 1} renewal${chain.count === 2 ? "" : "s"}` : "";
  return `- ${productLabel(t)} (${STORE[t.store] ?? t.store}, app ${t.app_id}${flags.length ? `, ${flags.join(", ")}` : ""}): bought ${day(chain.first)}${renewals}; ${purchaseStatus(t, state, now)}. Transaction ${t.transaction_id}.`;
}

function grantLine(g: GrantRow, now: number) {
  const state =
    g.revoked_at !== null
      ? `revoked on ${day(g.revoked_at)}${g.revoked_by ? ` by ${g.revoked_by}` : ""}`
      : g.expires_at === null
        ? "for life"
        : g.expires_at > now
          ? `active until ${day(g.expires_at)}`
          : `ended on ${day(g.expires_at)}`;
  return `- ${g.entitlement_id}, ${g.duration} grant (${state}), given ${day(g.starts_at)}${g.granted_by ? ` by ${g.granted_by}` : ""}${g.note ? ` — "${g.note}"` : ""}. Grant ID ${g.id}.`;
}

function unlockingProducts(config: ProjectConfig, entitlementId: string, principal: Principal) {
  const e = config.entitlements.find((x) => x.id === entitlementId);
  if (!e) return "";
  return [...e.products]
    .filter(([app]) => canSeeApp(principal, app))
    .map(([app, refs]) => {
      // A Google Play subscription listed without a base plan covers all of them.
      const label = (r: { productId: string; basePlanId: string | null }) =>
        r.basePlanId ? `${r.productId}:${r.basePlanId}` : `${r.productId}${config.apps.get(app)?.products.get(r.productId)?.basePlans.length ? " (any base plan)" : ""}`;
      return `${app}: ${refs.map(label).join(", ")}`;
    })
    .join("; ");
}

async function loadVisible(c: Ctx, principal: Principal, project: ProjectConfig, appUserId: string) {
  const data = await loadCustomer(c.env.DB, project.id, appUserId);
  if (!data.customer) return null;
  const transactions = data.transactions.filter((t) => canSeeApp(principal, t.app_id));
  const hidden = data.transactions.length - transactions.length;
  return { ...data, transactions, hidden };
}

function actorOf(c: Ctx, principal: Principal): Actor {
  return { email: principal.operator.email, operatorId: principal.operator.id, source: "mcp", tokenId: principal.tokenId, ip: c.req.header("cf-connecting-ip") ?? null };
}

function describeProject(config: ProjectConfig, principal: Principal) {
  const apps = [...config.apps.values()]
    .filter((a) => canSeeApp(principal, a.id))
    .map((a) => ({
      id: a.id,
      store: a.store,
      bundle_id: a.bundleId ?? null,
      package_name: a.packageName ?? null,
      sdk_keys: a.sdkKeys,
      products: [...a.products.values()].map((pr) => ({ id: pr.id, type: pr.type, base_plans: pr.basePlans.length ? pr.basePlans : undefined })),
    }));
  const entitlements = config.entitlements.map((e) => ({
    id: e.id,
    description: e.description,
    products: Object.fromEntries([...e.products].filter(([app]) => canSeeApp(principal, app)).map(([app, refs]) => [app, refs.map((r) => (r.basePlanId ? `${r.productId}:${r.basePlanId}` : r.productId))])),
  }));
  const offerings = config.offerings.map((o) => ({
    id: o.id,
    current: o.id === config.currentOffering,
    description: o.description,
    packages: o.packages.map((pk) => ({ id: pk.id, products: Object.fromEntries([...pk.products].filter(([app]) => canSeeApp(principal, app)).map(([app, r]) => [app, r.basePlanId ? `${r.productId}:${r.basePlanId}` : r.productId])) })),
  }));
  const text = [
    `Apps:\n${apps.map((a) => `- ${a.id} (${STORE[a.store]}, ${a.bundle_id ?? a.package_name}; SDK key ${a.sdk_keys.join(", ")}): ${a.products.map((pr) => `${pr.id} [${pr.type}${pr.base_plans ? `; base plans ${pr.base_plans.join(", ")}` : ""}]`).join(", ")}`).join("\n")}`,
    `Entitlements:\n${entitlements.map((e) => `- ${e.id}${e.description ? ` (${e.description})` : ""}: ${Object.entries(e.products).map(([app, prs]) => `${app}: ${prs.join(", ")}`).join("; ")}`).join("\n")}`,
    `Offerings:\n${offerings.map((o) => `- ${o.id}${o.current ? " (current)" : ""}: ${o.packages.map((pk) => `${pk.id} = ${Object.entries(pk.products).map(([app, pr]) => `${app}:${pr}`).join(", ")}`).join("; ")}`).join("\n")}`,
  ].join("\n\n");
  return { text: `Project ${config.id} (${config.name})\n\n${text}`, structured: { id: config.id, name: config.name, apps, entitlements, offerings } };
}

// ---- Tools ------------------------------------------------------------------------------------------

const appUserIdProp = { type: "string", description: "The customer's app user ID (or any alias, including $RCAnonymousID:…)." };
const projectProp = { type: "string", description: "The project (get_config lists them). Needed only when the deployment has several projects." };

/** The project a tool call is about: the `project` argument, or the caller's only project. */
function projectArg(c: Ctx, principal: Principal, args: Args): ProjectConfig {
  const choice = chooseProject(c.get("config"), principal, str(args, "project", { required: false, max: 50 }));
  if ("project" in choice) return choice.project;
  throw new ToolError(choice.message);
}

const TOOLS: Tool[] = [
  {
    name: "lookup_customer",
    title: "Look up a customer",
    description: "Everything about one customer: app user IDs, attributes (email…), entitlements and when they end, subscriptions with their status, recent purchases and promotional grants.",
    inputSchema: { type: "object", properties: { app_user_id: appUserIdProp, project: projectProp }, required: ["app_user_id"], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    permission: "read",
    async run(c, principal, args) {
      const appUserId = str(args, "app_user_id")!;
      const config = projectArg(c, principal, args);
      const data = await loadVisible(c, principal, config, appUserId);
      if (!data) return { text: `No customer with app user ID "${appUserId}". Try search_customers with an email, a transaction ID or the start of the ID.`, isError: true };
      const now = Date.now();
      const db = c.env.DB;
      const [attributes, aliases] = await Promise.all([
        readAttributes(db, data.customer!.id),
        db.prepare("SELECT app_user_id FROM customer_alias WHERE customer_id = ? ORDER BY created_at").bind(data.customer!.id).all<{ app_user_id: string }>(),
      ]);
      const allApps = principal.apps === null;
      const snapshot = computeSnapshot({ appUserId, customer: data.customer, transactions: data.transactions, states: data.states, grants: allApps ? data.grants : [], config, now });
      const entitlements = Object.entries(snapshot.subscriber.entitlements).map(([id, e]) => ({
        id,
        active: e.expires_date === null || Date.parse(e.expires_date) > now,
        expires: e.expires_date,
        product: e.product_identifier,
      }));
      const chains = latestPerChain(data.transactions);
      const lines = [
        `Customer ${data.customer!.appUserId} (first seen ${day(data.customer!.firstSeen)}).`,
        `App user IDs: ${aliases.results.map((a) => a.app_user_id).join(", ")}`,
        Object.keys(attributes).length ? `Attributes: ${Object.entries(attributes).map(([k, v]) => `${k}=${v.value}`).join(", ")}` : "No attributes.",
        "",
        entitlements.length
          ? `Entitlements:\n${entitlements.map((e) => `- ${e.id}: ${e.active ? (e.expires ? `active until ${e.expires.slice(0, 10)}` : "active for life") : `expired ${e.expires?.slice(0, 10)}`} (from ${e.product.startsWith("rc_promo_") ? "a promotional grant" : e.product})`).join("\n")}`
          : "No entitlements.",
        "",
        chains.length ? `Purchases (latest per subscription or one-time purchase):\n${chains.slice(0, 25).map((ch) => chainLine(ch, data.states, now)).join("\n")}` : "No purchases.",
        chains.length > 25 ? `(${chains.length - 25} more not shown.)` : "",
        allApps && data.grants.length ? `\nPromotional grants:\n${data.grants.map((g) => grantLine(g, now)).join("\n")}` : "",
        data.hidden ? `\n${data.hidden} purchase${data.hidden === 1 ? " is" : "s are"} in apps your access doesn't include.` : "",
      ];
      return {
        text: lines.filter((l) => l !== undefined).join("\n").replace(/\n{3,}/g, "\n\n").trim(),
        structured: {
          customer: { original_app_user_id: data.customer!.appUserId, first_seen: data.customer!.firstSeen, aliases: aliases.results.map((a) => a.app_user_id) },
          attributes,
          entitlements,
          purchases: chains.map((ch) => ({ ...ch.latest, first_purchased_at: ch.first, purchases_in_chain: ch.count })),
          grants: allApps ? data.grants : undefined,
        },
      };
    },
  },
  {
    name: "search_customers",
    title: "Search customers",
    description:
      "Find customers by the start of an app user ID, an exact email (the $email attribute), or an exact store transaction ID (Apple transaction or original transaction ID, Google order ID or purchase token). Without a query, lists the newest customers.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "App user ID prefix, email, or transaction ID." },
        purchases_only: { type: "boolean", description: "Only customers who bought something." },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "At most this many (default 20)." },
        project: projectProp,
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    permission: "read",
    async run(c, principal, args) {
      const query = str(args, "query", { required: false });
      const limit = num(args, "limit", 1, 50) ?? 20;
      const purchasesOnly = args.purchases_only === true;
      let list;
      try {
        list = await searchCustomers(c.env.DB, projectArg(c, principal, args).id, principal.apps, { q: query, purchasesOnly, limit });
      } catch (err) {
        if (err instanceof BadInput) throw new ToolError(err.message);
        throw err;
      }
      if (!list.customers.length) return { text: query ? `No customers match "${query}".` : "No customers yet.", structured: { customers: [] } };
      const rows = list.customers.map(
        (x) =>
          `- ${x.app_user_id}${x.email ? ` <${x.email}>` : ""}: first seen ${day(x.first_seen)}; ${x.purchases ? `${x.purchases} purchase${x.purchases === 1 ? "" : "s"}, latest ${x.last_product} on ${day(x.last_purchase_at)}, ${x.active ? "something active" : "nothing active"}` : "no purchases"}`,
      );
      return { text: `${list.customers.length} customer${list.customers.length === 1 ? "" : "s"}:\n${rows.join("\n")}`, structured: list as unknown as Record<string, unknown> };
    },
  },
  {
    name: "explain_entitlement",
    title: "Explain an entitlement",
    description:
      "Why a customer does or doesn't have an entitlement right now: which purchase or grant decides it, and what happened to each relevant purchase (expired, refunded, auto-renew off, billing problems, sandbox, not verified). Also says which products unlock it and flags purchases of products no entitlement includes.",
    inputSchema: {
      type: "object",
      properties: { app_user_id: appUserIdProp, entitlement_id: { type: "string", description: "The entitlement, e.g. pro. get_config lists them." }, project: projectProp },
      required: ["app_user_id", "entitlement_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    permission: "read",
    async run(c, principal, args) {
      const appUserId = str(args, "app_user_id")!;
      const entitlementId = str(args, "entitlement_id")!;
      const config = projectArg(c, principal, args);
      if (!config.entitlements.some((e) => e.id === entitlementId)) {
        return { text: `There's no entitlement "${entitlementId}" in project ${config.id}. Entitlements: ${config.entitlements.map((e) => e.id).join(", ") || "none"}.`, isError: true };
      }
      const unlocks = unlockingProducts(config, entitlementId, principal);
      const data = await loadVisible(c, principal, config, appUserId);
      if (!data) {
        return {
          text: `No: there's no customer with app user ID "${appUserId}". Products that unlock ${entitlementId}: ${unlocks}.\nIf they did buy, the purchase may be under another app user ID (an anonymous ID before logIn, or another account): try search_customers with their email or the store transaction ID from their receipt.`,
          structured: { has_entitlement: false, reason: "no_customer" },
        };
      }
      const now = Date.now();
      const allApps = principal.apps === null;
      const grants = allApps ? data.grants : [];
      const snapshot = computeSnapshot({ appUserId, customer: data.customer, transactions: data.transactions, states: data.states, grants, config, now });
      const e = snapshot.subscriber.entitlements[entitlementId];
      const active = !!e && (e.expires_date === null || Date.parse(e.expires_date) > now);
      const relevant = data.transactions.filter((t) => entitlementsFor(config, t.app_id, t.product_id, t.base_plan_id).includes(entitlementId));
      const unmapped = [...new Set(data.transactions.filter((t) => entitlementsFor(config, t.app_id, t.product_id, t.base_plan_id).length === 0).map(productLabel))];
      const chains = latestPerChain(relevant);
      const relevantGrants = grants.filter((g) => g.entitlement_id === entitlementId);
      const fromGrant = e?.product_identifier.startsWith("rc_promo_");

      let verdict: string;
      if (active) {
        verdict = `Yes: ${data.customer!.appUserId} has ${entitlementId} ${e!.expires_date ? `until ${e!.expires_date.slice(0, 10)}` : "for life"}, from ${fromGrant ? "a promotional grant" : `a purchase of ${e!.product_identifier}${e!.product_plan_identifier ? `:${e!.product_plan_identifier}` : ""}`}.`;
      } else if (e) {
        verdict = `No: ${entitlementId} ended on ${e.expires_date!.slice(0, 10)} (the last purchase or grant that gave it is below).`;
      } else if (!relevant.length && !relevantGrants.length) {
        verdict = `No: this customer has never bought a product that unlocks ${entitlementId}, and has no grant for it.`;
      } else {
        verdict = `No: nothing they bought currently gives ${entitlementId} (see below).`;
      }

      const lines = [verdict, "", `Products that unlock ${entitlementId}: ${unlocks || "none in the apps you can see"}.`];
      if (chains.length) lines.push("", `Their purchases of those products:\n${chains.map((ch) => chainLine(ch, data.states, now)).join("\n")}`);
      if (relevantGrants.length) lines.push("", `Grants of ${entitlementId}:\n${relevantGrants.map((g) => grantLine(g, now)).join("\n")}`);
      if (unmapped.length) {
        lines.push("", `They also bought ${unmapped.join(", ")}, which no entitlement includes. If one of those should unlock ${entitlementId}, add it to the entitlement in the config (the dashboard, or PUT /admin/v1/config).`);
      }
      if (!active && !chains.length) {
        lines.push(
          "",
          "Common causes: the purchase was made under a different app user ID (before logIn, or on another account), or the app hasn't sent it yet (Restore Purchases or syncPurchases sends it). search_customers with their email or the receipt's transaction ID finds where a purchase went.",
        );
      }
      if (data.hidden) lines.push("", `${data.hidden} purchase${data.hidden === 1 ? " is" : "s are"} in apps your access doesn't include, so this answer may be incomplete.`);
      if (!allApps) lines.push("Grants aren't shown because your access is limited to some apps.");
      return {
        text: lines.join("\n"),
        structured: {
          has_entitlement: active,
          entitlement: e ?? null,
          source: e ? (fromGrant ? "grant" : "purchase") : null,
          purchases: chains.map((ch) => ch.latest),
          grants: relevantGrants,
          unmapped_products: unmapped,
        },
      };
    },
  },
  {
    name: "get_metrics",
    title: "Get a chart",
    description: `A chart's values per day, week or month: ${Object.entries(CHARTS)
      .map(([id, d]) => `${id} (${d.label})`)
      .join(", ")}. Money is USD at each purchase date's exchange rate. Running charts (MRR, active subscriptions, trials) give the value at the end of each period; the others give totals per period. subscription_status is a current breakdown.`,
    inputSchema: {
      type: "object",
      properties: {
        chart: { type: "string", enum: Object.keys(CHARTS) },
        from: { type: "string", description: "First day, YYYY-MM-DD (default: 90 days before to)." },
        to: { type: "string", description: "Last day, YYYY-MM-DD (default: today)." },
        interval: { type: "string", enum: ["day", "week", "month"], description: "Default: month for ranges over 120 days, else week over 31 days, else day." },
        environment: { type: "string", enum: ["production", "sandbox"] },
        app: { type: "string", description: "Only this app (get_config lists app IDs)." },
        store: { type: "string", enum: ["app_store", "play_store"] },
        product: { type: "string", description: "Only this product (Google base plans as product:base_plan)." },
        project: { type: "string", description: "Only this project (get_config lists them). Default: every project." },
      },
      required: ["chart"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    permission: "read",
    async run(c, principal, args) {
      const chart = str(args, "chart")!;
      if (!CHARTS[chart]) throw new ToolError(`chart must be one of: ${Object.keys(CHARTS).join(", ")}.`);
      const today = dayOf(Date.now());
      const DATE = /^\d{4}-\d{2}-\d{2}$/;
      const to = str(args, "to", { required: false }) ?? today;
      const from = str(args, "from", { required: false }) ?? dayOf(Date.parse(`${to}T00:00:00Z`) - 89 * 864e5);
      if (!DATE.test(from) || !DATE.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || from > to) throw new ToolError("from and to must be dates (YYYY-MM-DD), from on or before to.");
      const days = (Date.parse(to) - Date.parse(from)) / 864e5 + 1;
      if (days > 3660) throw new ToolError("A chart can cover at most 3660 days.");
      const interval = (str(args, "interval", { required: false }) ?? (days > 120 ? "month" : days > 31 ? "week" : "day")) as Interval;
      if (!["day", "week", "month"].includes(interval)) throw new ToolError("interval must be day, week or month.");
      const environment = (str(args, "environment", { required: false }) ?? "production") as "production" | "sandbox";
      if (environment !== "production" && environment !== "sandbox") throw new ToolError("environment must be production or sandbox.");
      const app = str(args, "app", { required: false });
      if (app && (!c.get("config").apps.has(app) || !canSeeApp(principal, app))) throw new ToolError(`No app "${app}" you can see.`);
      const chosen = str(args, "project", { required: false, max: 50 }) ? projectArg(c, principal, args) : undefined;
      const project = chosen ? { id: chosen.id, apps: [...chosen.apps.keys()] } : undefined;
      const store = str(args, "store", { required: false });
      if (store && store !== "app_store" && store !== "play_store") throw new ToolError("store must be app_store or play_store.");
      const product = str(args, "product", { required: false });
      const result = (await readChart(c.env.DB, chart, { from, to: to > today ? today : to, interval, environment, app, store, product, apps: principal.apps, project }))!;
      if (result.categories) {
        return {
          text: `${result.label} (${result.description}):\n${result.categories.map((x) => `- ${x.label}: ${x.value}`).join("\n")}`,
          structured: result as unknown as Record<string, unknown>,
        };
      }
      if (result.points.length > 200) throw new ToolError(`That's ${result.points.length} ${interval}s; use a longer interval or a shorter range (at most 200 points).`);
      const keys = [...new Set(result.points.flatMap((pt) => Object.keys(pt.values)))];
      const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "—" : String(v));
      const table = [`| ${interval} | ${keys.join(" | ")} |`, `|${" --- |".repeat(keys.length + 1)}`, ...result.points.map((pt) => `| ${pt.date} | ${keys.map((k) => fmt(pt.values[k])).join(" | ")} |`)];
      const unit = result.unit === "usd" ? "Money values are USD." : result.unit === "percent" ? "Rates are percentages." : "";
      return {
        text: `${result.label}, ${from} to ${result.to}, by ${interval} (${environment}${chosen ? `, project ${chosen.id}` : ""}${app ? `, app ${app}` : ""}${store ? `, ${STORE[store]}` : ""}${product ? `, product ${product}` : ""}). ${result.description} ${unit}\n\n${table.join("\n")}${result.notes.length ? `\n\n${result.notes.join(" ")}` : ""}${result.updated_at ? `\n\nTotals last updated ${when(result.updated_at)} (hourly).` : ""}`,
        structured: result as unknown as Record<string, unknown>,
      };
    },
  },
  {
    name: "get_config",
    title: "Get the configuration",
    description:
      "The deployment's projects and, for each, its apps (store, bundle ID or package name, SDK keys, products), entitlements (which products unlock each, per app) and offerings. For operators with access to every app, the structured result also has the whole config document and its version_id, for save_config. No secrets.",
    inputSchema: { type: "object", additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    permission: "read",
    async run(c, principal) {
      const projects = visibleProjects(c.get("config"), principal).map((config) => describeProject(config, principal));
      // The whole document spans every app, so only operators who can see every app get it.
      const stored = principal.apps === null ? await currentVersion(c.env.DB) : null;
      const full = principal.apps === null ? { version_id: stored?.id ?? 0, document: stored?.document ?? c.get("config").document } : {};
      if (!projects.length) return { text: "No projects yet: the config is empty.", structured: { projects: [], ...full } };
      return { text: projects.map((pr) => pr.text).join("\n\n"), structured: { projects: projects.map((pr) => pr.structured), ...full } };
    },
  },
  {
    name: "save_config",
    title: "Save the configuration",
    description:
      'Saves an edited config document (from get_config) as a new version: {"version": 2, "projects": {"<id>": {"name", "apps", "entitlements", "offerings", "webhooks"}}}. Pass the version_id you edited as base_id; if someone saved since, it\'s refused and you get the config again and redo the edit. Invalid documents are refused with every problem listed. Takes effect in the back office at once and in the SDK within a minute. Change only what the user asked for, and confirm with them first.',
    inputSchema: {
      type: "object",
      properties: {
        document: { type: "object", description: "The whole config document, edited." },
        base_id: { type: "integer", minimum: 0, description: "version_id from get_config." },
        note: { type: "string", description: "What changed, for the history (e.g. Added product pro_annual to rose_ios)." },
      },
      required: ["document", "base_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    permission: "config:manage",
    allApps: true,
    async run(c, principal, args) {
      const baseId = num(args, "base_id", 0, Number.MAX_SAFE_INTEGER);
      if (baseId === undefined) throw new ToolError("base_id is required: the version_id from get_config.");
      const note = str(args, "note", { required: false, max: 500 }) ?? null;
      try {
        const next = parseConfig(args.document);
        const problems = await changeProblems(c.env.DB, c.get("config"), next);
        if (problems.length) return { text: `Not saved:\n${problems.map((p) => `- ${p}`).join("\n")}`, isError: true };
        const { id } = await saveConfig(c.env.DB, next.document, { baseId, by: principal.operator.email, note });
        await audit(c.env.DB, {
          operator: principal.operator,
          action: "config.saved",
          target: String(id),
          details: { base_id: baseId, note },
          source: "mcp",
          tokenId: principal.tokenId,
          ip: c.req.header("cf-connecting-ip") ?? null,
        }).run();
        return { text: `Saved as version ${id}. The back office uses it now; the SDK within a minute.`, structured: { version_id: id } };
      } catch (err) {
        if (err instanceof ConfigError) return { text: `Not saved: the config has problems.\n${err.problems.map((p) => `- ${p}`).join("\n")}`, isError: true };
        if (err instanceof ConfigConflict) return { text: `Not saved: ${err.message} Call get_config again and redo the change.`, isError: true };
        throw err;
      }
    },
  },
  {
    name: "list_webhook_deliveries",
    title: "List webhook deliveries",
    description: "Recent webhook deliveries to your endpoints: event type and ID, endpoint, status (pending = retrying, delivered, failed), attempts and the last error.",
    inputSchema: {
      type: "object",
      properties: { status: { type: "string", enum: ["pending", "delivered", "failed"] }, limit: { type: "integer", minimum: 1, maximum: 100 } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    permission: "read",
    async run(c, principal, args) {
      const status = str(args, "status", { required: false });
      if (status && !["pending", "delivered", "failed"].includes(status)) throw new ToolError("status must be pending, delivered or failed.");
      const limit = num(args, "limit", 1, 100) ?? 25;
      const { results } = await c.env.DB.prepare(
        `SELECT d.event_id, d.endpoint, d.status, d.attempts, d.last_status, d.last_error, d.created_at, e.type, e.app_id, e.environment
         FROM webhook_delivery d JOIN webhook_event e ON e.id = d.event_id
         ${status ? "WHERE d.status = ?" : ""} ORDER BY d.created_at DESC LIMIT ${limit}`,
      )
        .bind(...(status ? [status] : []))
        .all<{ event_id: string; endpoint: string; status: string; attempts: number; last_status: number | null; last_error: string | null; created_at: number; type: string; app_id: string; environment: string }>();
      const rows = results.filter((d) => canSeeApp(principal, d.app_id));
      if (!rows.length) return { text: status ? `No ${status} deliveries.` : "No webhook deliveries yet.", structured: { deliveries: [] } };
      return {
        text: rows
          .map((d) => `- ${when(d.created_at)} ${d.type} (event ${d.event_id}) → ${d.endpoint}: ${d.status}, ${d.attempts} attempt${d.attempts === 1 ? "" : "s"}${d.last_status ? `, last HTTP ${d.last_status}` : ""}${d.last_error ? `, ${d.last_error}` : ""}`)
          .join("\n"),
        structured: { deliveries: rows },
      };
    },
  },
  {
    name: "replay_webhook",
    title: "Replay a webhook event",
    description: "Sends a webhook event to its endpoints again, with the same event ID and body (consumers deduplicate on event.id).",
    inputSchema: { type: "object", properties: { event_id: { type: "string" } }, required: ["event_id"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    permission: "webhooks:replay",
    async run(c, principal, args) {
      const id = str(args, "event_id")!;
      const db = c.env.DB;
      const event = await db.prepare("SELECT app_id, type FROM webhook_event WHERE id = ?").bind(id).first<{ app_id: string; type: string }>();
      if (!event || !canSeeApp(principal, event.app_id)) return { text: `No webhook event ${id}.`, isError: true };
      await db.batch([
        db.prepare("UPDATE webhook_delivery SET status = 'pending', attempts = 0, next_attempt_at = ?, last_error = NULL WHERE event_id = ?").bind(Date.now() + 300_000, id),
        audit(db, { operator: principal.operator, action: "webhook.replayed", target: id, source: "mcp", tokenId: principal.tokenId, ip: c.req.header("cf-connecting-ip") ?? null }),
      ]);
      c.executionCtx.waitUntil(deliverNow(c.env, c.get("config"), c.get("deps").fetch ?? fetch, [id]));
      return { text: `Replaying ${event.type} event ${id}. It's sent now and retried if an endpoint fails.`, structured: { replayed: id } };
    },
  },
  {
    name: "grant_entitlement",
    title: "Grant an entitlement",
    description: `Gives a customer an entitlement without a purchase, for a duration (${GRANT_DURATIONS.join(", ")}) or until a date. The app sees it on its next CustomerInfo fetch, as a promotional entitlement. Audited. Confirm with the user first.`,
    inputSchema: {
      type: "object",
      properties: {
        app_user_id: appUserIdProp,
        entitlement_id: { type: "string" },
        duration: { type: "string", enum: [...GRANT_DURATIONS] },
        expires_at: { type: "string", description: "Instead of duration: when it ends (ISO 8601 date or time)." },
        note: { type: "string", description: "Why (shown in the dashboard and audit log)." },
        project: projectProp,
      },
      required: ["app_user_id", "entitlement_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    permission: "grants:manage",
    allApps: true,
    async run(c, principal, args) {
      const appUserId = str(args, "app_user_id")!;
      const duration = str(args, "duration", { required: false });
      const expiresRaw = str(args, "expires_at", { required: false });
      if (!duration && !expiresRaw) throw new ToolError(`Give a duration (${GRANT_DURATIONS.join(", ")}) or expires_at.`);
      let expiresAt: number | undefined;
      if (expiresRaw) {
        expiresAt = Date.parse(expiresRaw);
        if (Number.isNaN(expiresAt)) throw new ToolError("expires_at must be an ISO 8601 date or time.");
      }
      const config = projectArg(c, principal, args);
      try {
        const { grant, customerId } = await grantEntitlement(
          c.env.DB,
          config,
          { appUserId, entitlementId: str(args, "entitlement_id")!, duration, expiresAt, note: str(args, "note", { required: false, max: 500 }) ?? null },
          actorOf(c, principal),
        );
        c.executionCtx.waitUntil(rebuildAfterGrant(c.env.DB, c.get("config"), customerId));
        return {
          text: `Granted ${grant.entitlement_id} to ${appUserId} ${grant.expires_at === null ? "for life" : `until ${when(grant.expires_at)}`} (grant ${grant.id}). The app sees it the next time it fetches CustomerInfo (on launch, or after a purchase or restore).`,
          structured: { grant, product_identifier: promotionalProductId(grant.entitlement_id, grant.duration) },
        };
      } catch (err) {
        if (err instanceof GrantError) return { text: err.message, isError: true };
        throw err;
      }
    },
  },
  {
    name: "revoke_grant",
    title: "Revoke a grant",
    description: "Ends a promotional grant now (lookup_customer or explain_entitlement shows grant IDs). Purchases aren't affected. Audited. Confirm with the user first.",
    inputSchema: { type: "object", properties: { app_user_id: appUserIdProp, grant_id: { type: "string" }, project: projectProp }, required: ["app_user_id", "grant_id"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    permission: "grants:manage",
    allApps: true,
    async run(c, principal, args) {
      const appUserId = str(args, "app_user_id")!;
      const grantId = str(args, "grant_id")!;
      try {
        const { customerId } = await revokeGrant(c.env.DB, { projectId: projectArg(c, principal, args).id, appUserId, grantId }, actorOf(c, principal));
        c.executionCtx.waitUntil(rebuildAfterGrant(c.env.DB, c.get("config"), customerId));
        return { text: `Revoked grant ${grantId} for ${appUserId}. The app sees the change on its next CustomerInfo fetch.`, structured: { revoked: grantId } };
      } catch (err) {
        if (err instanceof GrantError) return { text: err.message, isError: true };
        throw err;
      }
    },
  },
  {
    name: "check_setup",
    title: "Check the setup",
    description:
      "Checks this openpurr deployment: database migrations, custom domain, store credentials per app, store notifications received, webhook secrets and failures, the scheduled job, exchange rates and two-step sign-in. Each problem comes with the exact fix.",
    inputSchema: { type: "object", additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    permission: "read",
    async run(c, principal) {
      const checks = await runChecks(c, principal);
      const mark = { ok: "✓", warn: "!", fail: "✗", info: "·" } as const;
      return {
        text: `${summarize(checks)}\n\n${checks.map((x) => `${mark[x.status]} ${x.title}: ${x.message}${x.fix && x.status !== "ok" ? `\n  Fix: ${x.fix}` : ""}`).join("\n")}`,
        structured: { summary: summarize(checks), checks },
      };
    },
  },
  {
    name: "get_audit_log",
    title: "Read the audit log",
    description: "Recent sign-ins, credential changes and every change made through the dashboard, admin API, CLI or MCP: who, when, what, and through which token.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 100 }, action: { type: "string", description: "Only this action, e.g. grant.created or auth.login." } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    permission: "audit:read",
    async run(c, _principal, args) {
      const limit = num(args, "limit", 1, 100) ?? 30;
      const action = str(args, "action", { required: false, max: 64 });
      const { results } = await c.env.DB.prepare(
        `SELECT at, actor, source, action, target, details FROM audit_log ${action ? "WHERE action = ?" : ""} ORDER BY id DESC LIMIT ${limit}`,
      )
        .bind(...(action ? [action] : []))
        .all<{ at: number; actor: string | null; source: string; action: string; target: string | null; details: string | null }>();
      if (!results.length) return { text: "Nothing logged.", structured: { entries: [] } };
      return {
        text: results.map((r) => `- ${when(r.at)} ${r.actor ?? "?"} (${r.source}) ${r.action}${r.target ? ` ${r.target}` : ""}${r.details ? ` ${r.details}` : ""}`).join("\n"),
        structured: { entries: results.map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null })) },
      };
    },
  },
];

const allowed = (principal: Principal, tool: Tool) => can(principal, tool.permission) && (!tool.allApps || principal.apps === null);

// ---- JSON-RPC over Streamable HTTP --------------------------------------------------------------

interface RpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const rpcError = (id: RpcMessage["id"] | undefined, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

export const mcp = new Hono<AppEnv>();

// No server-initiated stream and no sessions to end: the spec's 405 for both.
mcp.get("/", (c) => c.body(null, 405, { Allow: "POST" }));
mcp.delete("/", (c) => c.body(null, 405, { Allow: "POST" }));

mcp.post("/", async (c) => {
  // DNS-rebinding and cross-site protection: a browser page elsewhere can't drive this endpoint.
  const origin = c.req.header("origin");
  if (origin && origin !== new URL(c.req.url).origin) return c.json(rpcError(null, -32000, "Requests from other sites aren't allowed."), 403);
  const version = c.req.header("mcp-protocol-version");
  if (version && !PROTOCOL_VERSIONS.includes(version)) return c.json(rpcError(null, -32000, `Unsupported MCP-Protocol-Version ${version}. Supported: ${PROTOCOL_VERSIONS.join(", ")}.`), 400);

  const header = c.req.header("authorization") ?? "";
  const principal = await mcpPrincipal(c, header);
  if (!principal) {
    const sent = header.startsWith("Bearer ");
    return c.json(rpcError(null, -32001, "Sign in (OAuth), or send a personal access token: Authorization: Bearer pat_… (create one under Access tokens in the openpurr dashboard)."), 401, {
      "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl(c)}", scope="read"${sent ? ', error="invalid_token"' : ""}`,
    });
  }

  const message = (await c.req.json<unknown>().catch(() => undefined)) as RpcMessage | undefined;
  if (!message || typeof message !== "object" || Array.isArray(message) || message.jsonrpc !== "2.0") {
    return c.json(rpcError(null, -32600, "Send one JSON-RPC 2.0 message per request."), 400);
  }
  // Notifications (no id) and responses (no method) need no answer.
  if (message.method === undefined || message.id === undefined || message.id === null) return c.body(null, 202);

  const { id, method } = message;
  const params = message.params ?? {};
  switch (method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        },
      });
    }
    case "ping":
      return c.json({ jsonrpc: "2.0", id, result: {} });
    case "tools/list":
      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          tools: TOOLS.filter((t) => allowed(principal, t)).map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })),
        },
      });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return c.json(rpcError(id, -32602, `Unknown tool: ${String(params.name)}`));
      const result = await callTool(c, principal, tool, (params.arguments as Args | undefined) ?? {});
      return c.json({ jsonrpc: "2.0", id, result });
    }
    default:
      return c.json(rpcError(id, -32601, `Method not found: ${method}`));
  }
});

/** A personal access token, or an OAuth access token issued for this endpoint. */
async function mcpPrincipal(c: Ctx, header: string): Promise<Principal | null> {
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (token.startsWith(ACCESS_TOKEN_PREFIX)) return tokenPrincipal(c, token);
  if (!token.startsWith(OAUTH_ACCESS_PREFIX)) return null;
  const owner = await oauthTokenOwner(c.env.DB, token, mcpResource(c));
  if (!owner) return null;
  if (!owner.lastUsed || Date.now() - owner.lastUsed > 3600_000) {
    c.executionCtx.waitUntil(c.env.DB.prepare("UPDATE oauth_grant SET last_used_at = ? WHERE id = ?").bind(Date.now(), owner.grantId).run());
  }
  return principalOf(owner.operator, "token", owner.grantId, owner.scopes as TokenScope[]);
}

async function callTool(c: Ctx, principal: Principal, tool: Tool, args: Args) {
  const fail = (text: string) => ({ content: [{ type: "text", text }], isError: true });
  if (!allowed(principal, tool)) {
    return fail(
      tool.allApps && principal.apps !== null
        ? "This needs access to all apps."
        : `This needs the ${tool.permission} permission${principal.via === "token" ? " (check the token's scopes, and your role)" : ""}.`,
    );
  }
  if (typeof args !== "object" || args === null || Array.isArray(args)) return fail("arguments must be an object.");
  // Per-token limit (the spec asks servers to rate limit tool calls).
  const limiter = (c.get("deps").rateLimiters ?? cloudflareRateLimiters)(c.env).user;
  if (limiter && !(await limiter.allow(`mcp:${principal.tokenId}`))) return fail("Too many calls; wait a minute and try again.");
  try {
    const r = await tool.run(c, principal, args);
    return { content: [{ type: "text", text: r.text }], ...(r.structured ? { structuredContent: r.structured } : {}), ...(r.isError ? { isError: true } : {}) };
  } catch (err) {
    if (err instanceof ToolError) return fail(err.message);
    console.error(`MCP tool ${tool.name} failed:`, err);
    return fail("Something went wrong running this tool. It's in the Worker's logs.");
  }
}
