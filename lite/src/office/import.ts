// Importing existing purchases, for moving to openpurr from RevenueCat or another backend.
//
// An import row says which app user owns which store purchase: an App Store transaction ID, or a
// Google Play purchase token and product. Nothing about the purchase itself is copied from the
// old backend. openpurr asks the store, exactly as it does when the app posts a receipt, so what's
// recorded is the store's current truth: renewals, refunds and expiry included.
//
// One row per request: every D1 statement counts toward the free plan's 50 queries per
// invocation, and one App Store customer alone can bring up to MAX_TRANSACTIONS_PER_SYNC
// transactions. The CLI (openpurr import) reads the file and sends the rows one by one.
//
// What an import does differently from POST /v1/receipts:
//   - It never takes a purchase away from someone. A purchase chain that already has an owner
//     (because the app posted it after switching to openpurr) keeps that owner; the row reports it.
//   - It sends no webhooks: the purchases aren't new, and the old backend already reported them.
//   - A new customer's first_seen is backdated to their first purchase (or the row's first_seen),
//     so they don't all show up as new customers on the day of the import.
//   - Attributes never overwrite what the app has set: they're written as if set long ago.
//   - It stops (429) when the deployment is close to a Cloudflare free-plan daily limit, so the
//     app's own traffic keeps working; resume the next day.

import { type AttributeUpdate, enforceCustomLimit, parseAttributes, writeAttributes } from "../attributes";
import type { AppConfig, ProjectConfig, Store } from "../config";
import type { Deps, Env } from "../env";
import { addAlias, assignOwner, findCustomer, ensureCustomer, type NewTransaction, purchaseOwners, upsertSubscriptionState, upsertTransaction } from "../ledger";
import { lastRollupAt, markImportActive } from "../metrics";
import { invalidateSnapshot } from "../snapshot";
import type { SubscriptionStateUpdate } from "../stores/apple";
import { AppleApiError } from "../stores/apple-api";
import { AppleApiNotConfigured, appleClients, syncFromTransactionId } from "../stores/apple-sync";
import { GoogleMappingError } from "../stores/google";
import { GoogleApiError } from "../stores/google-api";
import { acknowledge, GoogleApiNotConfigured, googleClientFor, markReplaced, PendingPurchase, verifyPlayPurchase } from "../stores/google-sync";
import { assessUsage, cloudflarePlan, readUsage } from "./usage";

const DAY = 864e5;
const MAX_ALIASES = 5;
const MAX_ID_LENGTH = 256;

/** One row of an import file, as the CLI sends it. */
export interface ImportRow {
  app_user_id?: unknown;
  /** app_store or play_store. Optional when the row has a purchase_token (Google) or the project has one app. */
  store?: unknown;
  /** The openpurr app ID; needed only when the project has several apps for the row's store. */
  app?: unknown;
  /** App Store: any transaction ID of the customer's (the original transaction ID is fine). */
  transaction_id?: unknown;
  /** Google Play: the purchase token. */
  purchase_token?: unknown;
  /** Google Play: the product ID. RevenueCat's "product:base_plan" form is accepted. */
  product_id?: unknown;
  /** Other app user IDs of the same customer. */
  aliases?: unknown;
  /** Customer attributes, e.g. {"$email": "jane@example.com"}. */
  attributes?: unknown;
  /** When the old backend first saw the customer (ISO 8601 or milliseconds). */
  first_seen?: unknown;
}

export interface ImportResult {
  app_user_id: string;
  app_id: string | null;
  dry_run: boolean;
  /** Whether the customer is new to openpurr (or would be, on a dry run). */
  created: boolean;
  transactions: number;
  /** Every transaction and original transaction ID recorded: the CLI skips later rows already covered. */
  transaction_ids: string[];
  /** Purchase chains that already belong to another customer, who keeps them. */
  kept_owner: { original_transaction_id: string; app_user_id: string }[];
  /** Products the store reported that the config doesn't list (not imported). */
  skipped_products: string[];
  aliases_added: string[];
  /** Aliases already used by another customer (not added). */
  aliases_skipped: string[];
  attributes: number;
}

/**
 * Why a row wasn't imported. `status` tells the CLI what to do: 400 and 422 mean this row (fix it
 * or skip it, and carry on), 409 a config problem, 429 stop for today, 503 try again shortly.
 */
export class ImportError extends Error {
  constructor(
    public status: 400 | 409 | 422 | 429 | 503,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

/** The store for a value like "app_store", "APP_STORE", "ios" or "google". */
export function parseStore(v: unknown): Store | null {
  const s = str(v).toLowerCase().replace(/[\s-]/g, "_");
  if (["app_store", "appstore", "apple", "ios", "mac_app_store"].includes(s)) return "app_store";
  if (["play_store", "playstore", "google", "google_play", "android"].includes(s)) return "play_store";
  return null;
}

function parseFirstSeen(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : /^\d+$/.test(str(v)) ? Number(str(v)) : Date.parse(str(v));
  if (!Number.isFinite(n) || n <= 0) throw new ImportError(400, "bad_row", `first_seen "${str(v)}" isn't a date (ISO 8601) or milliseconds since 1970.`);
  // Seconds, not milliseconds (a 10-digit number).
  return n < 1e11 ? n * 1000 : n;
}

function resolveApp(project: ProjectConfig, row: ImportRow, store: Store | null): AppConfig {
  const wanted = str(row.app);
  if (wanted) {
    const app = project.apps.get(wanted);
    if (!app) throw new ImportError(400, "bad_row", `Project ${project.id} has no app "${wanted}".`);
    if (store && app.store !== store) throw new ImportError(400, "bad_row", `App ${wanted} is a ${app.store} app, but the row says ${store}.`);
    return app;
  }
  const candidates = [...project.apps.values()].filter((a) => !store || a.store === store);
  if (candidates.length === 1) return candidates[0]!;
  if (!candidates.length) throw new ImportError(409, "no_app", `Project ${project.id} has no ${store ?? ""} app. Add it to the config first.`.replace("  ", " "));
  throw new ImportError(
    400,
    "ambiguous_app",
    `Project ${project.id} has several ${store ?? ""} apps (${candidates.map((a) => a.id).join(", ")}). Add an app column, or pass --app.`.replace("  ", " "),
  );
}

/** Stops the import close to a free-plan daily limit (90%, the same point the usage check fails). */
async function checkUsage(db: D1Database, now: number) {
  const [snapshot, plan] = await Promise.all([readUsage(db), cloudflarePlan(db)]);
  const over = assessUsage(snapshot, plan, now).filter((m) => m.status === "fail");
  if (over.length) {
    throw new ImportError(
      429,
      "daily_limit",
      `Stopped to keep your app working: ${over.map((m) => m.label).join(", ")} ${over.length > 1 ? "are" : "is"} at 90% of today's free-plan limit. The limits reset at 00:00 UTC; run the same command again then, and it carries on where it stopped.`,
    );
  }
}

interface Fetched {
  transactions: NewTransaction[];
  states: SubscriptionStateUpdate[];
  skipped: string[];
  replaces: string | null;
  ack: Parameters<typeof acknowledge>[3] | null;
}

async function fromAppStore(app: AppConfig, env: Env, deps: Deps, transactionId: string): Promise<Fetched> {
  let clients;
  try {
    clients = appleClients(app, env, deps);
  } catch (err) {
    if (err instanceof AppleApiNotConfigured) throw new ImportError(409, "store_not_configured", `${err.message} Importing needs App Store Server API access.`);
    throw err;
  }
  try {
    const sync = await syncFromTransactionId(clients, app, transactionId);
    return { transactions: sync.transactions, states: sync.states, skipped: sync.skipped, replaces: null, ack: null };
  } catch (err) {
    if (err instanceof AppleApiError) {
      if (err.notFound) throw new ImportError(422, "not_found_at_store", `Apple doesn't know transaction ${transactionId} for ${app.bundleId}.`);
      if (err.retryable) throw new ImportError(503, "store_unavailable", "The App Store Server API is rate limiting or unavailable; try again shortly.");
      throw new ImportError(409, "store_error", `App Store Server API error ${err.status}; check the In-App Purchase key settings.`);
    }
    throw err;
  }
}

async function fromPlay(app: AppConfig, env: Env, deps: Deps, token: string, rawProduct: string): Promise<Fetched> {
  // RevenueCat writes Play subscriptions as "product:base_plan".
  const productId = rawProduct.split(":")[0]!;
  if (!productId) throw new ImportError(400, "bad_row", "Google Play rows need a product_id.");
  if (!app.products.has(productId)) {
    return { transactions: [], states: [], skipped: [productId], replaces: null, ack: null };
  }
  let client;
  try {
    client = googleClientFor(app, env, deps);
  } catch (err) {
    if (err instanceof GoogleApiNotConfigured) throw new ImportError(409, "store_not_configured", `${err.message} Importing needs Play Developer API access.`);
    throw err;
  }
  try {
    const p = await verifyPlayPurchase(client, app, token, productId);
    return { transactions: p.transactions, states: p.states, skipped: [], replaces: p.replaces, ack: p.ack };
  } catch (err) {
    if (err instanceof GoogleApiError && err.notFound) throw new ImportError(422, "not_found_at_store", `Google Play doesn't know this purchase token for ${app.packageName}.`);
    if (err instanceof GoogleApiError && err.retryable) throw new ImportError(503, "store_unavailable", "The Play Developer API is rate limiting or unavailable; try again shortly.");
    if (err instanceof GoogleApiError) throw new ImportError(409, "store_error", `Play Developer API error ${err.status}; check the service account's access.`);
    if (err instanceof PendingPurchase) throw new ImportError(422, "pending", err.message);
    if (err instanceof GoogleMappingError) throw new ImportError(409, "config_mismatch", err.message);
    throw err;
  }
}

function parseAliases(v: unknown, appUserId: string): string[] {
  const list = Array.isArray(v) ? v.map(str) : str(v).split(/[|;,]/).map((s) => s.trim());
  const aliases = [...new Set(list.filter((a) => a && a !== appUserId))];
  if (aliases.some((a) => a.length > MAX_ID_LENGTH)) throw new ImportError(400, "bad_row", "An alias is too long.");
  if (aliases.length > MAX_ALIASES) throw new ImportError(400, "bad_row", `At most ${MAX_ALIASES} aliases per row.`);
  return aliases;
}

function parseRowAttributes(v: unknown): Map<string, AttributeUpdate> {
  if (v === undefined || v === null || v === "") return new Map();
  if (typeof v !== "object" || Array.isArray(v)) throw new ImportError(400, "bad_row", "attributes must be an object of strings.");
  // Written as if set at the start of time: anything the app has set, or sets later, wins.
  const raw = Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, val]) => str(val) !== "").map(([k, val]) => [k, { value: str(val), updated_at_ms: 1 }]));
  const { updates, errors } = parseAttributes(raw);
  if (errors.length) throw new ImportError(400, "bad_row", `Invalid attribute ${errors[0]!.key_name || ""}: ${errors[0]!.message}`.trim());
  return updates;
}

/**
 * Imports one row: asks the store, then records the purchases for the row's app user. With
 * `dryRun`, asks the store and reports what would happen, writing nothing. `extraWrites` (the
 * audit row) go in the same batch.
 */
export async function importRow(
  db: D1Database,
  env: Env,
  deps: Deps,
  project: ProjectConfig,
  row: ImportRow,
  opts: { dryRun?: boolean; now?: number; extraWrites?: D1PreparedStatement[] } = {},
): Promise<ImportResult> {
  const now = opts.now ?? Date.now();
  const dryRun = !!opts.dryRun;
  const appUserId = str(row.app_user_id);
  if (!appUserId) throw new ImportError(400, "bad_row", "app_user_id is required.");
  if (appUserId.length > MAX_ID_LENGTH) throw new ImportError(400, "bad_row", "app_user_id is too long.");
  const transactionId = str(row.transaction_id);
  const token = str(row.purchase_token);
  if (transactionId && token) throw new ImportError(400, "bad_row", "Give a transaction_id (App Store) or a purchase_token (Google Play), not both.");
  const rawStore = str(row.store);
  const store = rawStore ? parseStore(rawStore) : token ? "play_store" : transactionId ? "app_store" : null;
  if (rawStore && !store) throw new ImportError(400, "bad_row", `Unknown store "${rawStore}". Use app_store or play_store.`);
  if (store === "app_store" && token) throw new ImportError(400, "bad_row", "App Store rows take a transaction_id, not a purchase_token.");
  if (store === "play_store" && transactionId) {
    throw new ImportError(400, "bad_row", "Google Play rows need the purchase_token. An order ID (GPA.…) can't be looked up; RevenueCat Support's migration export has the tokens.");
  }
  const aliases = parseAliases(row.aliases, appUserId);
  const attributes = parseRowAttributes(row.attributes);
  const firstSeenGiven = parseFirstSeen(row.first_seen);

  const result: ImportResult = {
    app_user_id: appUserId,
    app_id: null,
    dry_run: dryRun,
    created: false,
    transactions: 0,
    transaction_ids: [],
    kept_owner: [],
    skipped_products: [],
    aliases_added: [],
    aliases_skipped: [],
    attributes: 0,
  };

  if (!dryRun) await checkUsage(db, now);

  // No purchase: only aliases and attributes, for a customer openpurr already has (import the
  // purchases first). Creating customers who never bought would only add rows to clean up later.
  const existing = await findCustomer(db, project.id, appUserId);
  if (!transactionId && !token) {
    if (!aliases.length && !attributes.size) throw new ImportError(400, "bad_row", "The row has no transaction_id, purchase_token, aliases or attributes: nothing to import.");
    if (!existing) throw new ImportError(422, "no_customer", `No customer "${appUserId}" yet. Rows without a purchase only add aliases and attributes to customers openpurr already has.`);
    return dryRun ? { ...result, attributes: attributes.size } : await write(db, project, existing.id, result, { transactions: [], states: [], replaces: null, aliases, attributes, extraWrites: opts.extraWrites, now });
  }

  const app = resolveApp(project, row, store);
  result.app_id = app.id;
  const fetched = app.store === "app_store" ? await fromAppStore(app, env, deps, transactionId) : await fromPlay(app, env, deps, token, str(row.product_id));
  result.skipped_products = [...new Set(fetched.skipped)];
  if (!fetched.transactions.length) {
    throw new ImportError(
      422,
      result.skipped_products.length ? "unknown_products" : "nothing_to_import",
      result.skipped_products.length
        ? `The store reported only products the config doesn't list: ${result.skipped_products.join(", ")}. Add them to app ${app.id} and import this row again.`
        : "The store reported no purchases for this row.",
    );
  }

  const chains = [...new Set(fetched.transactions.map((t) => t.original_transaction_id))];
  const owners = await purchaseOwners(db, app.store, chains);
  const customerId = existing?.id ?? null;
  for (const [chain, owner] of owners) {
    if (owner.id !== customerId) result.kept_owner.push({ original_transaction_id: chain, app_user_id: owner.appUserId });
  }
  result.transactions = fetched.transactions.length;
  result.transaction_ids = [...new Set(fetched.transactions.flatMap((t) => [t.transaction_id, t.original_transaction_id]))];

  if (dryRun) {
    // Aliases and attributes would apply to the customer, new or not.
    return { ...result, created: !existing, attributes: attributes.size, aliases_added: aliases };
  }

  const extraWrites = [...(opts.extraWrites ?? [])];
  let id = customerId;
  if (!id) {
    const firstPurchase = Math.min(...fetched.transactions.map((t) => t.original_purchased_at));
    const firstSeen = Math.min(firstSeenGiven ?? Infinity, firstPurchase, now);
    id = (await ensureCustomer(db, project.id, appUserId, firstSeen)).id;
    result.created = true;
    // The charts count each day's new customers once, at the hourly rollup, and never again.
    // Someone backdated to before the last rollup's day would never be counted, so count them now.
    const rolledUpAt = await lastRollupAt(db);
    if (rolledUpAt !== null && firstSeen < Math.floor(rolledUpAt / DAY) * DAY) {
      extraWrites.push(countNewCustomer(db, project.id, firstSeen));
    }
  }
  if (fetched.ack) await acknowledge(db, googleClientFor(app, env, deps), app.id, fetched.ack);
  const unowned = new Set(chains.filter((c) => !owners.has(c) || owners.get(c)!.id === id));
  return await write(db, project, id, result, {
    transactions: fetched.transactions,
    states: fetched.states,
    replaces: fetched.replaces,
    assign: unowned,
    aliases,
    attributes,
    extraWrites,
    now,
  });
}

function countNewCustomer(db: D1Database, projectId: string, firstSeen: number) {
  return db
    .prepare(
      `INSERT INTO metric_daily (metric, environment, project_id, app_id, store, product_id, date, value)
       VALUES ('new_customers', '', ?, '', '', '', date(? / 1000, 'unixepoch'), 1)
       ON CONFLICT (metric, environment, project_id, app_id, store, product_id, date) DO UPDATE SET value = value + 1`,
    )
    .bind(projectId, firstSeen);
}

async function write(
  db: D1Database,
  project: ProjectConfig,
  customerId: string,
  result: ImportResult,
  w: {
    transactions: NewTransaction[];
    states: SubscriptionStateUpdate[];
    replaces: string | null;
    assign?: Set<string>;
    aliases: string[];
    attributes: Map<string, AttributeUpdate>;
    extraWrites?: D1PreparedStatement[];
    now: number;
  },
): Promise<ImportResult> {
  const writes: D1PreparedStatement[] = [];
  for (const t of w.transactions) writes.push(upsertTransaction(db, t, w.now));
  const firstOfChain = new Map(w.transactions.map((t) => [t.original_transaction_id, t]));
  for (const chain of w.assign ?? []) writes.push(assignOwner(db, firstOfChain.get(chain)!, customerId, w.now));
  for (const s of w.states) writes.push(upsertSubscriptionState(db, s, w.now));
  if (w.replaces) writes.push(...markReplaced(db, w.replaces));

  for (const alias of w.aliases) {
    const holder = await findCustomer(db, project.id, alias);
    if (!holder) {
      writes.push(addAlias(db, project.id, alias, customerId, w.now));
      result.aliases_added.push(alias);
    } else if (holder.id !== customerId) result.aliases_skipped.push(alias);
  }
  if (w.attributes.size) {
    await enforceCustomLimit(db, customerId, w.attributes);
    if (w.attributes.size) writes.push(writeAttributes(db, customerId, w.attributes, w.now));
    result.attributes = w.attributes.size;
  }
  writes.push(invalidateSnapshot(db, customerId), markImportActive(db, w.now), ...(w.extraWrites ?? []));
  await db.batch(writes);
  return result;
}
