---
name: webhooks
description: Set up openpurr webhooks (RevenueCat-shaped purchase events POSTed to the user's backend), write or check a handler that verifies the signature and deduplicates events, and find, debug and replay failed deliveries. Use when the user asks about webhooks, purchase events on their server, webhook signatures, or failed deliveries.
---

# Webhooks

openpurr POSTs RevenueCat-shaped events to the user's backend, so existing RevenueCat webhook handlers work unchanged. Delivery is at least once. A failed delivery is retried with backoff for about 72 hours, then marked failed.

## 1. Configure an endpoint

Each project has its own endpoints: in the dashboard, Webhooks → Endpoints → Add endpoint. Change the config in the dashboard (Configuration), or for the user with the MCP tools `get_config` / `save_config` or `npx @openpurr/cli config pull` / `push` (see the `deploy` skill, "Changing the config"). No deploy is needed; the SDK picks changes up within a minute. In the config document, they're the project's `webhooks`:

```json
"webhooks": [
  {
    "id": "backend",
    "url": "https://api.example.com/webhooks/revenuecat",
    "signing_secret": "WEBHOOK_SIGNING_SECRET",
    "environments": ["production", "sandbox"]
  }
]
```

`signing_secret` is recommended; `authorization_secret` adds a fixed Authorization header; `events` limits the event types (every type when omitted).

The values are the **names** of Worker secrets, not the secrets themselves. Ask the user to set them on **both** Workers (from `lite/`):

```sh
npx wrangler secret put WEBHOOK_SIGNING_SECRET
npx wrangler secret put WEBHOOK_SIGNING_SECRET --env office
```

Have them run these in their own terminal, not through Claude, so the value stays out of the conversation. Generate it with a password manager or `openssl rand -hex 32`. The same value goes on both Workers and into the backend's own secret store. No deploy is needed.

## 2. The event

```json
{
  "api_version": "1.0",
  "event": {
    "id": "…", "type": "INITIAL_PURCHASE", "event_timestamp_ms": 1767225600000,
    "app_id": "ios", "app_user_id": "user_123", "original_app_user_id": "…", "aliases": ["…"],
    "environment": "PRODUCTION", "store": "APP_STORE",
    "product_id": "pro_monthly", "entitlement_ids": ["pro"], "period_type": "NORMAL",
    "purchased_at_ms": 1767225600000, "expiration_at_ms": 1769904000000,
    "transaction_id": "…", "original_transaction_id": "…",
    "price": 9.99, "currency": "USD", "price_in_purchased_currency": 9.99, "country_code": "US",
    "subscriber_attributes": {}
  }
}
```

Types: `INITIAL_PURCHASE`, `RENEWAL`, `CANCELLATION`, `UNCANCELLATION`, `NON_RENEWING_PURCHASE`, `EXPIRATION`, `BILLING_ISSUE`, `PRODUCT_CHANGE`, `SUBSCRIPTION_EXTENDED`, `SUBSCRIPTION_PAUSED`, `REFUND_REVERSED`, `TRANSFER`, `PRICE_INCREASE_CONSENT_REQUIRED`, `PRICE_INCREASE_CONSENT_APPROVED`. A refund arrives as `CANCELLATION` with a negative price. Google Play product IDs include the base plan: `pro:monthly`.

## 3. The handler

When writing or reviewing the user's handler, make sure it:

1. **Verifies the signature** before parsing. The header is `X-RevenueCat-Webhook-Signature: t=<unix seconds>,v1=<hex>`, an HMAC-SHA256 with the signing secret over `<t>.<raw request body>`. During a key rotation the header carries two `v1=` values; accept the request if either matches. Compare in constant time, and reject a `t` more than 5 minutes from now.
2. **Deduplicates on `event.id`.** The same event can arrive more than once.
3. **Responds 2xx quickly** and does slow work afterwards. Anything other than 2xx, or a timeout, is retried.
4. **Treats the event as a hint.** For the authoritative state, fetch the customer with a secret key (`GET /v1/subscribers/<app user ID>`, see the `integrate` skill), especially when events arrive out of order.

Node example (Node 21 or later):

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(rawBody, header, secret, nowSec = Math.floor(Date.now() / 1000)) {
  const parts = Object.groupBy(header.split(","), (p) => p.slice(0, p.indexOf("=")));
  const t = Number(parts.t?.[0]?.slice(2));
  if (!t || Math.abs(nowSec - t) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  return (parts.v1 ?? []).some((p) => {
    const got = Buffer.from(p.slice(3), "hex");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}
```

Use the raw body exactly as received. Re-serialized JSON won't match.

## 4. Failed deliveries

- List them: the `list_webhook_deliveries` MCP tool, or `npx @openpurr/cli webhooks --status failed`. Each shows the endpoint's last response.
- Common causes: the handler rejects the signature (secret differs between the Workers and the backend, or it hashes a re-serialized body); a wrong URL or one that needs auth the config doesn't send; a timeout; a missing secret (doctor reports it).
- Once the endpoint is fixed, replay: the `replay_webhook` MCP tool, or `npx @openpurr/cli webhooks replay <event ID>`. Doctor warns when deliveries gave up in the last 24 hours.

To try a handler without a real purchase, make a sandbox purchase (events are sent for sandbox too, unless `environments` excludes it).
