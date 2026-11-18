// Outbound webhooks: RevenueCat-shaped events, delivered to the endpoints in the config.
//
// Body: {"api_version": "1.0", "event": {...}}, with RevenueCat's field names, so existing
// RevenueCat webhook handlers work unchanged. `price` is in USD, converted at the purchase date's
// exchange rate (src/fx.ts); it's null for currencies without a rate, which RevenueCat's docs
// allow for unknown prices.
//
// Delivery:
//   - The event and one delivery row per matching endpoint are written in the SAME D1 batch as
//     the ledger change that caused them (enqueueEvent returns statements), so an event exists
//     exactly when its change does. A dedupe key makes each fact produce one event, whichever
//     source reports it first (the SDK's receipt or Apple's notification).
//   - The first attempt runs right after the response (waitUntil). Failures are retried by the
//     scheduled job with backoff for about 72 hours, then marked failed.
//   - At-least-once: consumers should deduplicate on event.id.
//   - Authorization: an optional fixed header value from a Worker secret, as RevenueCat does.
//   - Signature: X-RevenueCat-Webhook-Signature: t=<unix>,v1=<hex>, HMAC-SHA256 over
//     "<t>.<raw body>", the same scheme as RevenueCat. Recomputed on every attempt.

import { type Config, entitlementsFor, type WebhookConfig, type WebhookEventType } from "./config";
import type { Env } from "./env";
import type { TransactionRow } from "./ledger";
import { toUsd } from "./fx";
import { alpha2FromAlpha3 } from "./lib/countries";

export interface EventCustomer {
  id: string;
  /** "Last seen" app user ID. */
  appUserId: string;
  originalAppUserId: string;
  aliases: string[];
  attributes: Record<string, { value: string; updated_at_ms: number }>;
}

export interface EventInput {
  type: WebhookEventType;
  /** One event per dedupe key, ever. */
  dedupeKey: string;
  appId: string;
  environment: "production" | "sandbox";
  store: "app_store" | "play_store";
  customer: EventCustomer;
  transaction?: TransactionRow;
  /** Event-specific fields (cancel_reason, expiration_reason, new_product_id, ...). */
  extra?: Record<string, unknown>;
  /** Refund events report a negative price. */
  negativePrice?: boolean;
  /** The price in USD; looked up by enqueueEvent. */
  priceUsd?: number | null;
  now?: number;
}

/** Retry delays after each failed attempt; about 72 hours in total. */
export const RETRY_DELAYS_MS = [5, 10, 45, 120, 180, 360, 720, 1440, 1440].map((m) => m * 60_000);
const TIMEOUT_MS = 15_000;
/** Deliveries retried per scheduled run (each is a subrequest; the free plan allows 50). */
export const RETRIES_PER_RUN = 20;

export function webhooksFor(config: Config, type: WebhookEventType, environment: "production" | "sandbox") {
  return config.webhooks.filter((w) => w.environments.includes(environment) && (!w.events || w.events.has(type)));
}

export function eventBody(config: Config, input: EventInput, id: string) {
  const t = input.transaction;
  const now = input.now ?? Date.now();
  const sign = input.negativePrice ? -1 : 1;
  const amount = t?.price_micros != null ? (sign * t.price_micros) / 1e6 : null;
  const productId = t ? (t.base_plan_id ? `${t.product_id}:${t.base_plan_id}` : t.product_id) : null;
  return {
    api_version: "1.0",
    event: {
      id,
      type: input.type,
      event_timestamp_ms: now,
      app_id: input.appId,
      app_user_id: input.customer.appUserId,
      original_app_user_id: input.customer.originalAppUserId,
      aliases: input.customer.aliases,
      environment: input.environment === "production" ? "PRODUCTION" : "SANDBOX",
      store: input.store === "app_store" ? "APP_STORE" : "PLAY_STORE",
      ...(t
        ? {
            product_id: productId,
            period_type: t.period_type.toUpperCase(),
            purchased_at_ms: t.purchased_at,
            expiration_at_ms: t.product_type === "subscription" ? t.expires_at : null,
            entitlement_id: null,
            entitlement_ids: (() => {
              const ids = entitlementsFor(config, t.app_id, t.product_id, t.base_plan_id);
              return ids.length ? ids : null;
            })(),
            presented_offering_id: null,
            transaction_id: t.transaction_id,
            original_transaction_id: t.original_transaction_id,
            is_family_share: t.ownership_type === "FAMILY_SHARED",
            // Apple's storefront is ISO 3166-1 alpha-3; RevenueCat sends alpha-2.
            country_code: t.store === "app_store" ? alpha2FromAlpha3(t.storefront) : null,
            currency: t.currency,
            price: input.priceUsd ?? (t.currency === "USD" ? amount : null),
            price_in_purchased_currency: amount,
            tax_percentage: null,
            commission_percentage: null,
            takehome_percentage: null,
            offer_code: null,
          }
        : {}),
      subscriber_attributes: input.customer.attributes,
      ...input.extra,
    },
  };
}

/**
 * Statements that record the event and its deliveries. Add them to the same batch as the
 * ledger change. Empty if no endpoint wants this event. If the dedupe key was already used,
 * the event insert is ignored and so are its deliveries.
 */
export async function enqueueEvent(
  db: D1Database,
  config: Config,
  input: EventInput,
): Promise<{ id: string; statements: D1PreparedStatement[] }> {
  const endpoints = webhooksFor(config, input.type, input.environment);
  if (!endpoints.length) return { id: "", statements: [] };
  const id = crypto.randomUUID();
  const now = input.now ?? Date.now();
  const t = input.transaction;
  if (t && input.priceUsd === undefined && t.price_micros !== null) {
    const amount = ((input.negativePrice ? -1 : 1) * t.price_micros) / 1e6;
    input = { ...input, priceUsd: await toUsd(db, amount, t.currency, t.purchased_at) };
  }
  const body = JSON.stringify(eventBody(config, input, id));
  return {
    id,
    statements: [
      db
        .prepare(
          `INSERT INTO webhook_event (id, dedupe_key, type, app_id, customer_id, environment, body, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (dedupe_key) DO NOTHING`,
        )
        .bind(id, input.dedupeKey, input.type, input.appId, input.customer.id, input.environment, body, now),
      // Inserted only if the event above was (a reused dedupe key leaves no event with this id).
      db
        .prepare(
          `INSERT INTO webhook_delivery (event_id, endpoint, status, next_attempt_at, created_at)
           SELECT ?1, value, 'pending', ?2, ?3 FROM json_each(?4) WHERE EXISTS (SELECT 1 FROM webhook_event WHERE id = ?1)`,
        )
        // The scheduled job won't pick it up until the first, immediate attempt has had time to run.
        .bind(id, now + RETRY_DELAYS_MS[0]!, now, JSON.stringify(endpoints.map((e) => e.id))),
    ],
  };
}

/** Customer context for event bodies: aliases (newest last) and attributes. One D1 round trip. */
export async function loadEventCustomer(db: D1Database, customerIds: string[], into: string, lastAppUserId?: string) {
  const ids = JSON.stringify(customerIds);
  const [aliases, attrs, customer] = await db.batch([
    db
      .prepare("SELECT app_user_id FROM customer_alias WHERE customer_id IN (SELECT value FROM json_each(?)) ORDER BY created_at, app_user_id")
      .bind(ids),
    db
      .prepare(
        "SELECT key, value, updated_at FROM subscriber_attribute WHERE customer_id IN (SELECT value FROM json_each(?)) AND value IS NOT NULL ORDER BY updated_at",
      )
      .bind(ids),
    db.prepare("SELECT app_user_id FROM customer WHERE id = ?").bind(into),
  ]);
  const aliasList = (aliases!.results as { app_user_id: string }[]).map((r) => r.app_user_id);
  // Newest value per key wins, as when customers merge.
  const attributes: EventCustomer["attributes"] = {};
  for (const r of attrs!.results as { key: string; value: string; updated_at: number }[]) {
    attributes[r.key] = { value: r.value, updated_at_ms: r.updated_at };
  }
  const original = (customer!.results[0] as { app_user_id: string } | undefined)?.app_user_id ?? aliasList[0] ?? "";
  return {
    id: into,
    appUserId: lastAppUserId ?? aliasList.at(-1) ?? original,
    originalAppUserId: original,
    aliases: aliasList,
    attributes,
  } satisfies EventCustomer;
}

// --- delivery ----------------------------------------------------------------------------------

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The signature header value: t=<unix>,v1=<hex>[,v1=<hex>] (two during a key rotation). */
export async function signatureHeader(secrets: string[], body: string, nowMs = Date.now()) {
  const t = Math.floor(nowMs / 1000);
  const sigs = await Promise.all(secrets.map((s) => hmacHex(s, `${t}.${body}`)));
  return [`t=${t}`, ...sigs.map((s) => `v1=${s}`)].join(",");
}

const secretValue = (env: Env, name?: string) => {
  if (!name) return undefined;
  const v = (env as unknown as Record<string, unknown>)[name];
  return typeof v === "string" && v ? v : undefined;
};

async function send(env: Env, endpoint: WebhookConfig, body: string, fetchImpl: typeof fetch) {
  const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "openpurr-webhooks" };
  const auth = secretValue(env, endpoint.authorizationSecret);
  if (auth) headers.authorization = auth;
  const signing = secretValue(env, endpoint.signingSecret);
  if (signing) {
    const keys = signing.split(",").map((k) => k.trim()).filter(Boolean);
    headers["x-revenuecat-webhook-signature"] = await signatureHeader(keys, body);
  }
  if (endpoint.authorizationSecret && !auth) return { status: 0, error: `Worker secret ${endpoint.authorizationSecret} isn't set` };
  if (endpoint.signingSecret && !signing) return { status: 0, error: `Worker secret ${endpoint.signingSecret} isn't set` };
  try {
    const res = await fetchImpl(endpoint.url, { method: "POST", headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
    await res.body?.cancel();
    return res.ok ? { status: res.status } : { status: res.status, error: `HTTP ${res.status}` };
  } catch (err) {
    return { status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

interface DueDelivery {
  event_id: string;
  endpoint: string;
  attempts: number;
  body: string;
}

async function attempt(env: Env, config: Config, fetchImpl: typeof fetch, rows: DueDelivery[], now: number) {
  const endpoints = new Map(config.webhooks.map((w) => [w.id, w]));
  const updates = await Promise.all(
    rows.map(async (row) => {
      const endpoint = endpoints.get(row.endpoint);
      const attempts = row.attempts + 1;
      // The endpoint was removed from the config: stop trying.
      const result = endpoint ? await send(env, endpoint, row.body, fetchImpl) : { status: 0, error: "endpoint no longer configured" };
      if (!result.error) {
        return env.DB.prepare(
          `UPDATE webhook_delivery SET status = 'delivered', attempts = ?, last_status = ?, last_error = NULL,
             delivered_at = ?, next_attempt_at = NULL WHERE event_id = ? AND endpoint = ?`,
        ).bind(attempts, result.status, now, row.event_id, row.endpoint);
      }
      const delay = endpoint ? RETRY_DELAYS_MS[attempts - 1] : undefined;
      return env.DB.prepare(
        `UPDATE webhook_delivery SET status = ?, attempts = ?, last_status = ?, last_error = ?, next_attempt_at = ?
         WHERE event_id = ? AND endpoint = ?`,
      ).bind(
        delay === undefined ? "failed" : "pending",
        attempts,
        result.status,
        result.error.slice(0, 500),
        delay === undefined ? null : now + delay,
        row.event_id,
        row.endpoint,
      );
    }),
  );
  if (updates.length) await env.DB.batch(updates);
  return rows.length;
}

/** First attempt for freshly enqueued events (run in waitUntil after the response). */
export async function deliverNow(env: Env, config: Config, fetchImpl: typeof fetch, eventIds: string[], now = Date.now()) {
  const ids = eventIds.filter(Boolean);
  if (!ids.length) return 0;
  const { results } = await env.DB.prepare(
    `SELECT d.event_id, d.endpoint, d.attempts, e.body FROM webhook_delivery d JOIN webhook_event e ON e.id = d.event_id
     WHERE d.event_id IN (SELECT value FROM json_each(?)) AND d.status = 'pending' AND d.attempts = 0`,
  )
    .bind(JSON.stringify(ids))
    .all<DueDelivery>();
  return attempt(env, config, fetchImpl, results, now);
}

/** Retries deliveries that are due (the scheduled job, every 5 minutes). */
export async function retryDueDeliveries(env: Env, config: Config, fetchImpl: typeof fetch, now = Date.now()) {
  const { results } = await env.DB.prepare(
    `SELECT d.event_id, d.endpoint, d.attempts, e.body FROM webhook_delivery d JOIN webhook_event e ON e.id = d.event_id
     WHERE d.status = 'pending' AND d.next_attempt_at <= ? ORDER BY d.next_attempt_at LIMIT ${RETRIES_PER_RUN}`,
  )
    .bind(now)
    .all<DueDelivery>();
  return attempt(env, config, fetchImpl, results, now);
}
