// openpurr config: projects, and each project's apps, products, entitlements, offerings and webhooks.
//
// The config lives in D1 (config_version, migrations/0018_projects.sql; src/config-store.ts) and
// is edited through the admin API and the dashboard. Every save is validated here first, and the
// Workers validate it again when they load it (cheap), so the runtime never trusts an unvalidated
// document.
//
// A project is one title. Customers, secret keys and webhooks belong to a project, so two titles
// in one deployment never share customers or entitlements. App IDs, SDK keys, bundle IDs and
// package names are unique across all projects, because a request or store notification is
// matched to its app (and so its project) by them.
//
// Document shape (version 2):
//   {"version": 2, "projects": {"<project id>": {"name": "Rose", "apps": {...}, "entitlements": {...},
//     "offerings": [...], "webhooks": [...]}}}
// The older single-project file (version 1: apps, entitlements, offerings and webhooks at the top)
// is still accepted, as the project "default"; see upgradeConfig.

export type Store = "app_store" | "play_store";
export type ProductType = "subscription" | "non_consumable" | "consumable";

export interface ProductConfig {
  id: string;
  type: ProductType;
  /** Play subscriptions: the base plans that exist. Optional; used for the entitlement mapping. */
  basePlans: string[];
  /**
   * App Store subscriptions: the subscription group ID. Optional; Apple includes it in every
   * transaction, so it's learned automatically once anyone buys the product. Setting it here
   * makes intro-offer eligibility work before then.
   */
  subscriptionGroup?: string;
}

export interface AppConfig {
  id: string;
  /** The project this app belongs to. */
  projectId: string;
  store: Store;
  /** App Store: the bundle ID every signed transaction must carry. */
  bundleId?: string;
  /** Google Play: the package name. */
  packageName?: string;
  sdkKeys: string[];
  products: Map<string, ProductConfig>;
  /** Google Play Developer API access (Google Play apps). Without it, Play purchases can't be verified. */
  googlePlayApi?: {
    /** Name of the Worker secret holding the service account's JSON key. */
    serviceAccountSecret: string;
    /** The service account Pub/Sub uses to sign push requests to /notifications/google. */
    pubsubPushAccount?: string;
    /** The audience Pub/Sub puts in those tokens; defaults to the notification URL. */
    pubsubAudience?: string;
  };
  /** App Store Server API access. Without it, StoreKit 1 receipts can't be resolved. */
  appStoreServerApi?: {
    issuerId: string;
    keyId: string;
    /** Name of the Worker secret (environment variable) holding the In-App Purchase key (.p8). */
    privateKeySecret: string;
  };
  /**
   * Development only: accept purchases the server can't verify yet (Google Play before M2).
   * Anyone holding the public SDK key could then grant themselves entitlements.
   */
  allowUnverifiedPurchases: boolean;
}

export interface EntitlementConfig {
  id: string;
  description: string;
  /** Per app: product references. "pro" matches every base plan; "pro:monthly" matches one. */
  products: Map<string, { productId: string; basePlanId: string | null }[]>;
}

export interface PackageConfig {
  id: string;
  /** Per app: product reference, as in entitlements. */
  products: Map<string, { productId: string; basePlanId: string | null }>;
}

export interface OfferingConfig {
  id: string;
  description: string;
  metadata: Record<string, unknown>;
  packages: PackageConfig[];
}

export const WEBHOOK_EVENT_TYPES = [
  "INITIAL_PURCHASE",
  "RENEWAL",
  "CANCELLATION",
  "UNCANCELLATION",
  "NON_RENEWING_PURCHASE",
  "EXPIRATION",
  "BILLING_ISSUE",
  "PRODUCT_CHANGE",
  "SUBSCRIPTION_EXTENDED",
  "SUBSCRIPTION_PAUSED",
  "REFUND_REVERSED",
  "TRANSFER",
  "PRICE_INCREASE_CONSENT_REQUIRED",
  "PRICE_INCREASE_CONSENT_APPROVED",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export interface WebhookConfig {
  id: string;
  url: string;
  /** Worker secret holding the exact Authorization header value to send. */
  authorizationSecret?: string;
  /**
   * Worker secret holding the HMAC signing key. During a rotation it may hold two keys
   * separated by a comma; each produces a v1= signature.
   */
  signingSecret?: string;
  environments: ("production" | "sandbox")[];
  /** Event types to send; all when unset. */
  events: Set<WebhookEventType> | null;
}

/** One title: its apps and everything that's shared between them. */
export interface ProjectConfig {
  id: string;
  name: string;
  /** Changes whenever this project's config does; CustomerInfo snapshots built from another version are recomputed. */
  version: string;
  /** This project's apps. */
  apps: Map<string, AppConfig>;
  webhooks: WebhookConfig[];
  entitlements: EntitlementConfig[];
  offerings: OfferingConfig[];
  currentOffering: string | null;
}

export interface Config {
  /** Changes whenever any part of the config does. */
  version: string;
  projects: Map<string, ProjectConfig>;
  /** Every app of every project, by app ID. */
  apps: Map<string, AppConfig>;
  /** SDK key -> app. */
  keys: Map<string, AppConfig>;
  /** The validated document, as version 2 (what config_version stores). */
  document: ConfigDocument;
}

export interface ConfigDocument {
  version: 2;
  projects: Record<string, Record<string, unknown>>;
}

export class ConfigError extends Error {
  // Written out (not a parameter property) so Node can load this file with type stripping.
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid openpurr config:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.problems = problems;
  }
}

const ID = /^[A-Za-z0-9._$-]{1,100}$/;
const KEY_PREFIX: Record<Store, string> = { app_store: "appl_", play_store: "goog_" };
const PRODUCT_TYPES: ProductType[] = ["subscription", "non_consumable", "consumable"];

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

/** The project that a version 1 (single-project) file becomes. */
export const DEFAULT_PROJECT_ID = "default";
const DEFAULT_PROJECT_NAME = "Default";
const PROJECT_ID = /^[a-z0-9][a-z0-9_-]{0,49}$/;
const PROJECT_KEYS = ["name", "apps", "entitlements", "offerings", "webhooks"];

/** A version 1 file as a version 2 document, with everything in the project "default". Anything else is returned as is. */
export function upgradeConfig(raw: unknown): unknown {
  if (!isObject(raw) || raw.version !== 1) return raw;
  const { version: _version, ...rest } = raw;
  return { version: 2, projects: { [DEFAULT_PROJECT_ID]: { name: DEFAULT_PROJECT_NAME, ...rest } } };
}

/** An empty config: no projects yet (a new deployment, before the first app is added). */
export const EMPTY_DOCUMENT: ConfigDocument = { version: 2, projects: {} };

/** Validates and normalizes a config document (version 2, or a version 1 file). Throws ConfigError listing every problem found. */
export function parseConfig(raw: unknown): Config {
  const problems: string[] = [];
  const fail = (path: string, msg: string) => problems.push(`${path}: ${msg}`);

  if (!isObject(raw)) throw new ConfigError(["the config must be a mapping"]);
  // A version 1 file's problems keep version 1 paths ("apps.ios...", not "projects.default.apps.ios...").
  const v1 = raw.version === 1;
  const doc = upgradeConfig(raw) as Raw;
  if (doc.version !== 2) fail("version", "must be 2 (or 1, the single-project file)");
  allowOnly(doc, ["version", "projects"], "", fail);
  if (doc.projects !== undefined && !isObject(doc.projects)) fail("projects", "must be a mapping of project IDs to projects");

  const globals: Globals = { apps: new Map(), keys: new Map() };
  const projects = new Map<string, ProjectConfig>();
  for (const [projectId, project] of Object.entries(isObject(doc.projects) ? doc.projects : {})) {
    const at = v1 ? "" : `projects.${projectId}`;
    if (!PROJECT_ID.test(projectId)) fail(at || "projects", `project IDs are 1–50 lowercase letters, digits, '_' and '-' (got ${projectId})`);
    if (!isObject(project)) {
      fail(at || "projects", "must be a mapping");
      continue;
    }
    projects.set(projectId, parseProject(projectId, project, at, globals, fail));
  }

  if (problems.length) throw new ConfigError(problems);
  const document = { version: 2 as const, projects: (isObject(doc.projects) ? doc.projects : {}) as ConfigDocument["projects"] };
  return { version: fnv1a(JSON.stringify(document)), projects, apps: globals.apps, keys: globals.keys, document };
}

/** What must be unique across every project. */
interface Globals {
  apps: Map<string, AppConfig>;
  keys: Map<string, AppConfig>;
}

function parseProject(projectId: string, raw: Raw, prefix: string, globals: Globals, fail: (path: string, msg: string) => void): ProjectConfig {
  const path = (p: string) => (prefix ? `${prefix}.${p}` : p);
  allowOnly(raw, PROJECT_KEYS, prefix, fail);
  if (raw.name !== undefined && (typeof raw.name !== "string" || !raw.name.trim() || raw.name.length > 100)) {
    fail(path("name"), "must be a name of 1–100 characters");
  }
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : projectId;

  // --- apps -------------------------------------------------------------------------------
  const apps = new Map<string, AppConfig>();
  if (raw.apps !== undefined && !isObject(raw.apps)) fail(path("apps"), "must be a mapping of app IDs to apps");
  for (const [appId, a] of Object.entries(isObject(raw.apps) ? raw.apps : {})) {
    const at = path(`apps.${appId}`);
    if (!ID.test(appId)) fail(at, "app IDs may only contain letters, digits, '.', '_', '-' and '$'");
    const taken = globals.apps.get(appId);
    if (taken) fail(at, `app ID ${appId} is already used in project ${taken.projectId}; app IDs are unique across projects`);
    if (!isObject(a)) {
      fail(at, "must be a mapping");
      continue;
    }
    allowOnly(
      a,
      ["store", "bundle_id", "package_name", "sdk_keys", "products", "allow_unverified_purchases", "app_store_server_api", "google_play_api"],
      at,
      fail,
    );
    const store = a.store as Store;
    if (store !== "app_store" && store !== "play_store") {
      fail(`${at}.store`, "must be app_store or play_store");
      continue;
    }
    if (store === "app_store" && !nonEmptyString(a.bundle_id)) fail(`${at}.bundle_id`, "required for app_store apps");
    if (store === "play_store" && !nonEmptyString(a.package_name)) fail(`${at}.package_name`, "required for play_store apps");
    // Store notifications identify their app by bundle ID or package name, so each must be unique.
    const storeId = store === "app_store" ? a.bundle_id : a.package_name;
    const twin = [...globals.apps.values()].find(
      (other) => other.store === store && (store === "app_store" ? other.bundleId : other.packageName) === storeId,
    );
    if (nonEmptyString(storeId) && twin) {
      fail(`${at}.${store === "app_store" ? "bundle_id" : "package_name"}`, `${storeId} is already used by app ${twin.id}`);
    }

    const app: AppConfig = {
      id: appId,
      projectId,
      store,
      bundleId: nonEmptyString(a.bundle_id) ? a.bundle_id : undefined,
      packageName: nonEmptyString(a.package_name) ? a.package_name : undefined,
      sdkKeys: [],
      products: new Map(),
      allowUnverifiedPurchases: a.allow_unverified_purchases === true,
    };
    if (a.app_store_server_api !== undefined) {
      const api = a.app_store_server_api;
      const aat = `${at}.app_store_server_api`;
      if (store !== "app_store") fail(aat, "only app_store apps use the App Store Server API");
      else if (!isObject(api)) fail(aat, "must be a mapping with issuer_id and key_id");
      else {
        allowOnly(api, ["issuer_id", "key_id", "private_key_secret"], aat, fail);
        const secret = api.private_key_secret ?? "APPLE_IAP_KEY";
        if (!nonEmptyString(api.issuer_id) || !/^[0-9a-f-]{36}$/i.test(api.issuer_id)) {
          fail(`${aat}.issuer_id`, "must be the issuer ID (a UUID) from App Store Connect > Users and Access > Integrations");
        }
        if (!nonEmptyString(api.key_id) || !/^[A-Z0-9]{10}$/.test(api.key_id)) {
          fail(`${aat}.key_id`, "must be the 10-character key ID of your In-App Purchase key");
        }
        if (typeof secret !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(secret)) {
          fail(`${aat}.private_key_secret`, "must be a secret name like APPLE_IAP_KEY (capitals, digits, underscores)");
        }
        if (nonEmptyString(api.issuer_id) && nonEmptyString(api.key_id) && typeof secret === "string") {
          app.appStoreServerApi = { issuerId: api.issuer_id, keyId: api.key_id, privateKeySecret: secret };
        }
      }
    }
    if (a.google_play_api !== undefined) {
      const g = a.google_play_api;
      const gat = `${at}.google_play_api`;
      if (store !== "play_store") fail(gat, "only play_store apps use the Google Play Developer API");
      else if (!isObject(g)) fail(gat, "must be a mapping with service_account_secret");
      else {
        allowOnly(g, ["service_account_secret", "pubsub_push_account", "pubsub_audience"], gat, fail);
        const secret = g.service_account_secret ?? "GOOGLE_SERVICE_ACCOUNT";
        if (typeof secret !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(secret)) {
          fail(`${gat}.service_account_secret`, "must be a Worker secret name like GOOGLE_SERVICE_ACCOUNT (the key itself never goes here)");
        }
        if (g.pubsub_push_account !== undefined && (typeof g.pubsub_push_account !== "string" || !/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(g.pubsub_push_account))) {
          fail(`${gat}.pubsub_push_account`, "must be a service account email, like rtdn-push@my-project.iam.gserviceaccount.com");
        }
        if (g.pubsub_audience !== undefined && typeof g.pubsub_audience !== "string") fail(`${gat}.pubsub_audience`, "must be a string");
        if (typeof secret === "string") {
          app.googlePlayApi = {
            serviceAccountSecret: secret,
            ...(typeof g.pubsub_push_account === "string" ? { pubsubPushAccount: g.pubsub_push_account } : {}),
            ...(typeof g.pubsub_audience === "string" ? { pubsubAudience: g.pubsub_audience } : {}),
          };
        }
      }
    }
    if (a.allow_unverified_purchases !== undefined && typeof a.allow_unverified_purchases !== "boolean") {
      fail(`${at}.allow_unverified_purchases`, "must be true or false");
    }

    const sdkKeys = a.sdk_keys;
    if (!Array.isArray(sdkKeys) || sdkKeys.length === 0) fail(`${at}.sdk_keys`, "list at least one public SDK key");
    for (const [i, key] of (Array.isArray(sdkKeys) ? sdkKeys : []).entries()) {
      const kat = `${at}.sdk_keys[${i}]`;
      if (typeof key !== "string" || !/^[A-Za-z0-9_]{16,128}$/.test(key)) {
        fail(kat, "must be 16–128 letters, digits or underscores");
      } else if (key.startsWith("test_")) {
        // The SDKs switch to RevenueCat's simulated store for test_ keys (see spec/sdk-wire-contract.md).
        fail(kat, "must not start with test_: the SDKs treat test_ keys as RevenueCat's simulated store");
      } else if (!key.startsWith(KEY_PREFIX[store])) {
        fail(kat, `${store} keys must start with ${KEY_PREFIX[store]}`);
      } else if (globals.keys.has(key)) {
        fail(kat, `already used by app ${globals.keys.get(key)!.id}`);
      } else {
        app.sdkKeys.push(key);
        globals.keys.set(key, app);
      }
    }

    // An app may start without products (added from the dashboard); the setup checks flag it.
    if (a.products !== undefined && !isObject(a.products)) fail(`${at}.products`, "must be a mapping of product IDs, e.g. { pro_monthly: { type: subscription } }");
    for (const [productId, p] of Object.entries(isObject(a.products) ? a.products : {})) {
      const pat = `${at}.products.${productId}`;
      if (!ID.test(productId) || productId.includes(":")) fail(pat, "invalid product ID");
      if (!isObject(p)) {
        fail(pat, "must be a mapping, e.g. { type: subscription }");
        continue;
      }
      allowOnly(p, ["type", "base_plans", "subscription_group"], pat, fail);
      if (p.subscription_group !== undefined) {
        if (store !== "app_store" || p.type !== "subscription") fail(`${pat}.subscription_group`, "only App Store subscriptions have a subscription group");
        else if (typeof p.subscription_group !== "string" && typeof p.subscription_group !== "number") {
          fail(`${pat}.subscription_group`, "must be the subscription group ID from App Store Connect");
        }
      }
      if (!PRODUCT_TYPES.includes(p.type as ProductType)) fail(`${pat}.type`, `must be one of ${PRODUCT_TYPES.join(", ")}`);
      const basePlans = p.base_plans ?? [];
      if (!Array.isArray(basePlans) || !basePlans.every((b) => typeof b === "string" && ID.test(b))) {
        fail(`${pat}.base_plans`, "must be a list of base plan IDs");
      } else if (basePlans.length && (store !== "play_store" || p.type !== "subscription")) {
        fail(`${pat}.base_plans`, "only Google Play subscriptions have base plans");
      }
      app.products.set(productId, {
        id: productId,
        type: p.type as ProductType,
        basePlans: Array.isArray(basePlans) ? (basePlans as string[]) : [],
        ...(p.subscription_group !== undefined ? { subscriptionGroup: String(p.subscription_group) } : {}),
      });
    }
    apps.set(appId, app);
    if (!taken) globals.apps.set(appId, app);
  }

  // A product reference: "pro" or, for Play subscriptions, "pro:monthly".
  const productRef = (appId: string, ref: unknown, at: string) => {
    const app = apps.get(appId);
    if (!app) return void fail(at, `unknown app ${appId}`);
    if (typeof ref !== "string") return void fail(at, "must be a product ID");
    const [productId, basePlanId = null, extra] = ref.split(":");
    const product = app.products.get(productId!);
    if (!product || extra !== undefined) return void fail(at, `${ref} is not a product of app ${appId}`);
    if (basePlanId !== null) {
      if (app.store !== "play_store" || product.type !== "subscription") {
        return void fail(at, `${ref}: only Google Play subscriptions have base plans`);
      }
      if (product.basePlans.length && !product.basePlans.includes(basePlanId)) {
        return void fail(at, `${ref}: base plan ${basePlanId} isn't listed in ${productId}.base_plans`);
      }
    }
    return { productId: productId!, basePlanId };
  };

  // --- entitlements -------------------------------------------------------------------------
  const entitlements: EntitlementConfig[] = [];
  for (const [id, e] of Object.entries(isObject(raw.entitlements) ? raw.entitlements : {})) {
    const at = path(`entitlements.${id}`);
    if (!ID.test(id)) fail(at, "invalid entitlement ID");
    if (!isObject(e)) {
      fail(at, "must be a mapping");
      continue;
    }
    allowOnly(e, ["description", "products"], at, fail);
    const ent: EntitlementConfig = { id, description: typeof e.description === "string" ? e.description : "", products: new Map() };
    for (const [appId, refs] of Object.entries(isObject(e.products) ? e.products : {})) {
      if (!Array.isArray(refs)) {
        fail(`${at}.products.${appId}`, "must be a list of product IDs");
        continue;
      }
      const resolved = refs.map((r, i) => productRef(appId, r, `${at}.products.${appId}[${i}]`)).filter((r) => r !== undefined);
      ent.products.set(appId, resolved);
    }
    if (!isObject(e.products)) fail(`${at}.products`, "map each app to the products that grant this entitlement");
    entitlements.push(ent);
  }
  if (raw.entitlements !== undefined && !isObject(raw.entitlements)) fail(path("entitlements"), "must be a mapping");

  // --- offerings ----------------------------------------------------------------------------
  const offerings: OfferingConfig[] = [];
  let currentOffering: string | null = null;
  const rawOfferings = raw.offerings ?? [];
  if (!Array.isArray(rawOfferings)) fail(path("offerings"), "must be a list");
  for (const [i, o] of (Array.isArray(rawOfferings) ? rawOfferings : []).entries()) {
    const at = path(`offerings[${i}]`);
    if (!isObject(o)) {
      fail(at, "must be a mapping");
      continue;
    }
    allowOnly(o, ["id", "current", "description", "metadata", "packages"], at, fail);
    if (typeof o.id !== "string" || !ID.test(o.id)) fail(`${at}.id`, "required");
    if (offerings.some((x) => x.id === o.id)) fail(`${at}.id`, `duplicate offering ${String(o.id)}`);
    if (o.current === true) {
      if (currentOffering) fail(`${at}.current`, `only one offering can be current (already ${currentOffering})`);
      currentOffering = String(o.id);
    }
    if (o.metadata !== undefined && !isObject(o.metadata)) fail(`${at}.metadata`, "must be a mapping");
    const offering: OfferingConfig = {
      id: String(o.id),
      description: typeof o.description === "string" ? o.description : "",
      metadata: isObject(o.metadata) ? o.metadata : {},
      packages: [],
    };
    if (!Array.isArray(o.packages) || o.packages.length === 0) fail(`${at}.packages`, "list at least one package");
    for (const [j, p] of (Array.isArray(o.packages) ? o.packages : []).entries()) {
      const pat = `${at}.packages[${j}]`;
      if (!isObject(p) || typeof p.id !== "string" || !ID.test(p.id)) {
        fail(pat, "needs an id, e.g. $rc_monthly");
        continue;
      }
      if (offering.packages.some((x) => x.id === p.id)) fail(`${pat}.id`, `duplicate package ${p.id}`);
      const pkg: PackageConfig = { id: p.id, products: new Map() };
      for (const [appId, ref] of Object.entries(p)) {
        if (appId === "id") continue;
        const resolved = productRef(appId, ref, `${pat}.${appId}`);
        if (resolved) pkg.products.set(appId, resolved);
      }
      offering.packages.push(pkg);
    }
    offerings.push(offering);
  }
  if (offerings.length && !currentOffering) fail(path("offerings"), "mark one offering as current: true");

  // --- webhooks -----------------------------------------------------------------------------
  const webhooks: WebhookConfig[] = [];
  const rawWebhooks = raw.webhooks ?? [];
  if (!Array.isArray(rawWebhooks)) fail(path("webhooks"), "must be a list");
  for (const [i, w] of (Array.isArray(rawWebhooks) ? rawWebhooks : []).entries()) {
    const at = path(`webhooks[${i}]`);
    if (!isObject(w)) {
      fail(at, "must be a mapping with id and url");
      continue;
    }
    allowOnly(w, ["id", "url", "authorization_secret", "signing_secret", "environments", "events"], at, fail);
    if (typeof w.id !== "string" || !ID.test(w.id)) fail(`${at}.id`, "required, e.g. backend");
    else if (webhooks.some((x) => x.id === w.id)) fail(`${at}.id`, `duplicate webhook ${w.id}`);
    let url: URL | undefined;
    try {
      url = new URL(String(w.url));
    } catch {
      fail(`${at}.url`, "must be a full URL");
    }
    if (url && url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
      fail(`${at}.url`, "must use https (http is allowed only for localhost)");
    }
    const secretName = (key: string) => {
      const v = w[key];
      if (v === undefined) return undefined;
      if (typeof v !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(v)) {
        fail(`${at}.${key}`, "must be a Worker secret name like WEBHOOK_SIGNING_SECRET (the secret itself never goes here)");
        return undefined;
      }
      return v;
    };
    const envs = w.environments ?? ["production", "sandbox"];
    if (!Array.isArray(envs) || !envs.length || !envs.every((e) => e === "production" || e === "sandbox")) {
      fail(`${at}.environments`, "must list production and/or sandbox");
    }
    let events: Set<WebhookEventType> | null = null;
    if (w.events !== undefined) {
      if (!Array.isArray(w.events) || !w.events.length) fail(`${at}.events`, "must be a list of event types");
      else {
        for (const e of w.events) {
          if (!WEBHOOK_EVENT_TYPES.includes(e as WebhookEventType)) fail(`${at}.events`, `unknown event type ${String(e)}`);
        }
        events = new Set(w.events as WebhookEventType[]);
      }
    }
    webhooks.push({
      id: String(w.id),
      url: String(w.url),
      authorizationSecret: secretName("authorization_secret"),
      signingSecret: secretName("signing_secret"),
      environments: Array.isArray(envs) ? (envs as WebhookConfig["environments"]) : [],
      events,
    });
  }

  return { id: projectId, name, version: fnv1a(JSON.stringify(raw)), apps, entitlements, offerings, currentOffering, webhooks };
}

/** FNV-1a, 32-bit, hex. Synchronous, so the config can be versioned at module load. */
function fnv1a(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function allowOnly(obj: Raw, allowed: string[], at: string, fail: (path: string, msg: string) => void) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) fail(at ? `${at}.${k}` : k, `unknown key (expected one of: ${allowed.join(", ")})`);
  }
}

// --- lookups ------------------------------------------------------------------------------

/** Entitlement IDs granted by a purchase of productId (and base plan) in app. */
export function entitlementsFor(config: ProjectConfig, appId: string, productId: string, basePlanId: string | null): string[] {
  return config.entitlements
    .filter((e) =>
      (e.products.get(appId) ?? []).some(
        (r) => r.productId === productId && (r.basePlanId === null || r.basePlanId === basePlanId),
      ),
    )
    .map((e) => e.id);
}

/** The project an app belongs to. */
export function projectOfApp(config: Config, appId: string): ProjectConfig | undefined {
  const app = config.apps.get(appId);
  return app ? config.projects.get(app.projectId) : undefined;
}
