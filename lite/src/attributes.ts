// Subscriber attributes: what the SDK syncs with POST /v1/subscribers/{id}/attributes and
// inside POST /v1/receipts, as {"<key>": {"value": "...", "updated_at_ms": 1700000000000}}.
//
// Rules follow RevenueCat's documentation:
//   - Custom keys start with a letter and use only letters, digits, "-" and "_", up to 40
//     characters; at most 50 custom attributes per customer.
//   - Keys starting with "$" are reserved ($email, $displayName, attribution keys...).
//   - Values are up to 500 characters. The SDK sends "" to clear an attribute; we keep the row
//     with a NULL value so an older update can't bring it back.
//   - Attribution keys can't change once set, so the original install's attribution sticks.
// Updates apply only if their updated_at_ms is newer than what's stored, because the SDK can
// sync out of order.

export interface AttributeUpdate {
  value: string | null;
  updatedAt: number;
}

export interface AttributeError {
  key_name: string;
  message: string;
}

const CUSTOM_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const RESERVED_KEY = /^\$[A-Za-z][A-Za-z0-9_]{0,39}$/;
const MAX_VALUE = 500;
export const MAX_CUSTOM_ATTRIBUTES = 50;

/** Attribution data: kept from the original install, never overwritten. */
export const ATTRIBUTION_KEYS = [
  "$mediaSource",
  "$campaign",
  "$adGroup",
  "$ad",
  "$keyword",
  "$creative",
  "$appleAdsCampaignId",
  "$appleAdsAdGroupId",
  "$appleAdsKeywordId",
  "$claimType",
  "$conversionType",
  "$appleAdsCountryOrRegion",
  "$supplyPlacement",
  "$appleAdsOrgId",
  "$appleAdsAdId",
];

const isCustom = (key: string) => !key.startsWith("$");

/** Splits a request's attributes into valid updates and per-key errors. */
export function parseAttributes(raw: unknown, now = Date.now()) {
  const updates = new Map<string, AttributeUpdate>();
  const errors: AttributeError[] = [];
  if (raw === undefined || raw === null) return { updates, errors };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    errors.push({ key_name: "", message: "attributes must be an object" });
    return { updates, errors };
  }
  for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!(isCustom(key) ? CUSTOM_KEY : RESERVED_KEY).test(key)) {
      errors.push({ key_name: key, message: "Invalid key: use letters, digits, - and _, up to 40 characters, starting with a letter." });
      continue;
    }
    const e = (entry ?? {}) as { value?: unknown; updated_at_ms?: unknown };
    const value = e.value === null || e.value === undefined || e.value === "" ? null : e.value;
    if (value !== null && typeof value !== "string") {
      errors.push({ key_name: key, message: "Value must be a string." });
      continue;
    }
    if (value !== null && value.length > MAX_VALUE) {
      errors.push({ key_name: key, message: `Value is longer than ${MAX_VALUE} characters.` });
      continue;
    }
    const updatedAt = typeof e.updated_at_ms === "number" && Number.isFinite(e.updated_at_ms) ? e.updated_at_ms : now;
    updates.set(key, { value, updatedAt });
  }
  return { updates, errors };
}

/**
 * Drops new custom keys that would take the customer past the 50-custom-attribute limit.
 * Existing keys can always be updated. One query.
 */
export async function enforceCustomLimit(db: D1Database, customerId: string, updates: Map<string, AttributeUpdate>) {
  const errors: AttributeError[] = [];
  const incoming = [...updates.keys()].filter(isCustom);
  if (!incoming.length) return errors;
  const { results } = await db
    .prepare("SELECT key FROM subscriber_attribute WHERE customer_id = ? AND key NOT LIKE '$%' AND value IS NOT NULL")
    .bind(customerId)
    .all<{ key: string }>();
  const existing = new Set(results.map((r) => r.key));
  let count = existing.size;
  for (const key of incoming) {
    if (existing.has(key) || updates.get(key)!.value === null) continue;
    if (count >= MAX_CUSTOM_ATTRIBUTES) {
      updates.delete(key);
      errors.push({ key_name: key, message: `Customers can have at most ${MAX_CUSTOM_ATTRIBUTES} custom attributes.` });
    } else count++;
  }
  return errors;
}

/** Upserts every update in ONE statement (each D1 statement counts toward the free plan's limit). */
export function writeAttributes(db: D1Database, customerId: string, updates: Map<string, AttributeUpdate>, now = Date.now()) {
  const payload = JSON.stringify(Object.fromEntries([...updates].map(([k, u]) => [k, { v: u.value, t: u.updatedAt }])));
  return db
    .prepare(
      `INSERT INTO subscriber_attribute (customer_id, key, value, updated_at, received_at)
       SELECT ?1, j.key, json_extract(j.value, '$.v'), json_extract(j.value, '$.t'), ?2 FROM json_each(?3) AS j WHERE true
       ON CONFLICT (customer_id, key) DO UPDATE SET
         value = excluded.value, updated_at = excluded.updated_at, received_at = excluded.received_at
       WHERE excluded.updated_at > subscriber_attribute.updated_at
         AND NOT (subscriber_attribute.key IN (SELECT value FROM json_each(?4)) AND subscriber_attribute.value IS NOT NULL)`,
    )
    .bind(customerId, now, payload, JSON.stringify(ATTRIBUTION_KEYS));
}

/** A customer's current attributes (for webhooks, the admin API and secret-key reads). */
export async function readAttributes(db: D1Database, customerId: string) {
  const { results } = await db
    .prepare("SELECT key, value, updated_at FROM subscriber_attribute WHERE customer_id = ? AND value IS NOT NULL")
    .bind(customerId)
    .all<{ key: string; value: string; updated_at: number }>();
  return Object.fromEntries(results.map((r) => [r.key, { value: r.value, updated_at_ms: r.updated_at }]));
}
