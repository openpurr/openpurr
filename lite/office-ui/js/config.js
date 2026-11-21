// Editing the config from the dashboard. The config is one document (GET /admin/v1/config); a change
// re-reads the current version, applies the edit to it and saves it with that version's id, so
// edits by two people to different things never overwrite each other, and a real clash (both
// saving the same moment) gets a clear "reload" error instead of losing work.
import { get, put } from "./api.js";
import { t } from "./i18n.js";

export const STORES = { app_store: "App Store", play_store: "Google Play" };
export const PRODUCT_TYPES = [
  { value: "subscription", label: "Subscription" },
  { value: "non_consumable", label: "Non-consumable" },
  { value: "consumable", label: "Consumable" },
];
export const WEBHOOK_EVENTS = [
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
];

/** The current config: { id, document, created_at, created_by, note }. */
export const loadConfig = () => get("/config");

/** The project's part of a document, with its lists filled in. */
export function projectOf(document, projectId) {
  const p = document.projects?.[projectId];
  if (!p) return null;
  p.apps ??= {};
  p.entitlements ??= {};
  p.offerings ??= [];
  p.webhooks ??= [];
  return p;
}

/**
 * Applies `edit(document)` to the newest version and saves it. `edit` may throw an Error to stop
 * with a message. Returns the new version's id.
 */
export async function saveConfig(edit, note) {
  const current = await loadConfig();
  const document = structuredClone(current.document);
  document.version = 2;
  document.projects ??= {};
  edit(document);
  const { id } = await put("/config", { document, base_id: current.id, ...(note ? { note } : {}) });
  return id;
}

/** Same as saveConfig, scoped to one project: `edit(project, document)`. */
export function saveProject(projectId, edit, note) {
  return saveConfig((document) => {
    const project = projectOf(document, projectId);
    if (!project) throw new Error(t("Project {id} no longer exists. Reload the page.", { id: projectId }));
    edit(project, document);
  }, note);
}

// ---- IDs and keys -------------------------------------------------------------------------------

const ID = /^[A-Za-z0-9._$-]{1,100}$/;
export const validId = (id) => ID.test(id) && !id.includes(":");

/** A project ID from a name: "Rose Garden" -> "rose-garden", made unique. */
export function projectIdFor(name, taken) {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "project";
  return unique(base, taken);
}

/** An app ID for a project and store ("rose_ios"), unique across every project. */
export function appIdFor(projectId, store, document) {
  const taken = new Set(Object.values(document.projects ?? {}).flatMap((p) => Object.keys(p.apps ?? {})));
  return unique(`${projectId.replace(/-/g, "_")}_${store === "app_store" ? "ios" : "android"}`, taken);
}

function unique(base, taken) {
  const has = (id) => (taken instanceof Set ? taken.has(id) : taken.includes(id));
  if (!has(base)) return base;
  for (let i = 2; ; i++) if (!has(`${base}${i}`)) return `${base}${i}`;
}

/** A new public SDK key: appl_ (App Store) or goog_ (Google Play) and 32 random characters. */
export function newSdkKey(store) {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "A").replace(/\//g, "B").replace(/=+$/, "");
  return `${store === "app_store" ? "appl_" : "goog_"}${b64}`;
}

// ---- References ---------------------------------------------------------------------------------

/** A product reference as entitlements and packages use it: "pro" or "pro:monthly". */
export const productRefs = (app) =>
  Object.entries(app.products ?? {}).flatMap(([id, p]) => [
    { value: id, label: p.base_plans?.length ? t("{id} (any base plan)", { id }) : id },
    ...(p.base_plans ?? []).map((b) => ({ value: `${id}:${b}`, label: `${id}:${b}` })),
  ]);

/** Removes every reference to an app, or to one of its products, from entitlements and offerings. */
export function dropReferences(project, appId, productId = null) {
  const matches = (ref) => productId === null || ref === productId || ref.startsWith(`${productId}:`);
  for (const e of Object.values(project.entitlements)) {
    if (!e.products?.[appId]) continue;
    e.products[appId] = e.products[appId].filter((r) => !matches(r));
    if (productId === null || !e.products[appId].length) delete e.products[appId];
  }
  for (const o of project.offerings) {
    for (const pkg of o.packages ?? []) if (pkg[appId] !== undefined && matches(pkg[appId])) delete pkg[appId];
    // A package needs at least one app's product.
    o.packages = (o.packages ?? []).filter((pkg) => Object.keys(pkg).some((k) => k !== "id"));
  }
  project.offerings = project.offerings.filter((o) => o.packages.length);
  if (project.offerings.length && !project.offerings.some((o) => o.current)) project.offerings[0].current = true;
}

/** How many entitlements and packages use an app (or one of its products). */
export function usage(project, appId, productId = null) {
  const matches = (ref) => productId === null || ref === productId || ref.startsWith(`${productId}:`);
  const entitlements = Object.values(project.entitlements).filter((e) => (e.products?.[appId] ?? []).some(matches)).length;
  const packages = project.offerings.flatMap((o) => o.packages ?? []).filter((pkg) => pkg[appId] !== undefined && matches(pkg[appId])).length;
  return { entitlements, packages };
}
