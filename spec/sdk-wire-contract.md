# RevenueCat SDK Wire Contract

What the unmodified RevenueCat SDKs send, and accept, when `proxyURL` points at our server. Every point was read from source on 2026-11-17:

- **iOS:** `RevenueCat/purchases-ios` @ `eb95eac`. Paths below are under `Sources/`.
- **Android:** `RevenueCat/purchases-android` @ `3aca07c`. Paths below are under `purchases/src/main/kotlin/com/revenuecat/purchases/`.

Re-check this when new SDK versions come out. The stub in `lite/src/routes/sdk.ts` and its tests in `lite/test/sdk.test.ts` follow this document.

## Rules that break a server if ignored

1. **Never return 304.** iOS re-queues a 304 that has nothing cached, with no retry limit (`HTTPClient.swift:723-736`). Android turns it into an error. Always send a 200 with a full body.
2. **Every error needs a JSON body `{code, message}` with `Content-Type: application/json`.**
   - On Android, an error with no body becomes an `IOException`, which is handled as a connection failure (`HTTPClient.kt:124-141`).
   - iOS only parses error bodies served as `application/json` (`HTTPClient.swift:1410-1420`).
3. **Answer remote config (`POST /v1/config/app`) with `204`.** Both SDKs treat it as "not modified". A 200 must be RevenueCat's binary container format.
4. **On `/v1/receipts`, a 4xx tells the SDK to finish (iOS) or acknowledge (Android) the purchase.** Use a 5xx for anything retryable, such as unknown config or a store outage. That keeps the transaction queued on the device.
5. **Consumables:**
   - iOS finishes one only if `non_subscriptions` contains an entry whose `store_transaction_id` is that transaction's ID (`TransactionPoster.swift:252-282`).
   - Android consumes one only if the response has `purchased_products.{productId}.should_consume: true` (`PostReceiptHelper.kt:126-132`).
6. **Dates:** RFC 3339 with a time zone. Android throws on anything else. Use whole seconds, e.g. `2026-01-01T00:00:00Z`.
7. **The proxy's path prefix is dropped.** Paths are absolute (`/v1/...`), so `https://host/foo` sends requests to `https://host/v1/...`.

## Requests

**URL user IDs:**
- iOS leaves `$` and `:` unencoded (`/v1/subscribers/$RCAnonymousID:…`). Android percent-encodes them.
- Always URL-decode the user ID.
- Anonymous IDs are `$RCAnonymousID:` followed by 32 lowercase hex characters.

**Headers on every request:**
- `Authorization: Bearer <key>` and `Content-Type: application/json` (sent on GETs too).
- `X-Platform`:
  - iOS: `iOS`, `macOS`, `tvOS`, `watchOS`, `visionOS` or `uikitformac`.
  - Android: `android`, or `amazon` for the Amazon store.
- `X-Version`, `X-Platform-Version`, `X-Platform-Flavor`, `X-Platform-Device`, `X-Client-Version`, `X-Client-Bundle-ID`, `X-Preferred-Locales`, `X-Observer-Mode-Enabled`, `X-Is-Debug-Build`, `X-Is-Backgrounded`, and `X-Storefront` (optional).

**ETag and signing headers:**
- `X-RevenueCat-ETag` is always sent on endpoints that use ETags. Against our server it's always `""`, because unsigned responses are never cached.
- When verification isn't disabled (the default), the SDKs also send `X-Nonce` and `X-Post-Params-Hash`, plus `X-Headers-Hash` on iOS.

**`X-Is-Sandbox`:**
- iOS always sends `true` or `false`.
- Android sends it only for its Test Store.
- So sandbox status on Android has to come from the Play API.

**Platform-only headers:**
- iOS: `X-StoreKit2-Enabled`, `X-StoreKit-Version`, `X-Retry-Count`.
- Android: `X-Billing-Client-Sdk-Version`.
- On `/v1/receipts`, Android sends `price_string` and `marketplace` as headers, not in the body.

**API keys:**
- The SDKs never reject a key by its format; a prefix that doesn't match the platform is only logged.
- **Don't issue keys starting with `test_`.** That prefix switches on RevenueCat's simulated Test Store, which blocks or crashes release builds.
- Use `appl_…` for iOS and `goog_…` for Android.

## Responses

**Response headers the SDKs read:**
- `X-RevenueCat-ETag`.
- `X-RevenueCat-Request-Time` (epoch ms).
- `X-Signature`.

None of these is required. If `X-Signature` is missing, verification counts as FAILED. In the default INFORMATIONAL mode that's only logged, and the response is still used.

## Endpoints

### `GET /v1/subscribers/{id}`: CustomerInfo

Also the response to `POST /v1/receipts` and `POST /v1/subscribers/identify`.

**Required, combining both platforms:**
- `request_date`: iOS always requires it. Android needs it unless the `X-RevenueCat-Request-Time` header is sent.
- `subscriber.original_app_user_id` (iOS).
- `subscriber.first_seen`.
- `subscriber.subscriptions` and `subscriber.non_subscriptions`: Android requires both as objects.
- Each entitlement needs `product_identifier`, and `purchase_date` (Android).
- **An entitlement's `product_identifier` must be a key in `subscriptions` or `non_subscriptions`,** or Android drops the entitlement.
- That purchase needs `original_purchase_date`, `store` and `is_sandbox` (Android).
- Each `non_subscriptions` entry needs `purchase_date` and `is_sandbox`, a bool with no default (iOS).
- Each subscription needs `period_type`. Without it, Android silently empties its typed subscription map.

**Google subscriptions:**
- They're keyed by subscription ID, with the base plan in `product_plan_identifier`.
- Put `product_plan_identifier` on both the subscription and the entitlement.
- The SDK builds the `sub:basePlan` IDs itself.

**`store` values:** `app_store`, `play_store`, `amazon`, `test_store`.

**Never read by either SDK:** `request_date_ms` and `other_purchases`.

### `POST /v1/receipts`

**iOS body:**
- `fetch_token`: a StoreKit 2 JWS, or a StoreKit 1 base64 receipt.
- `app_user_id`, `is_restore`, `observer_mode`, `initiation_source` (`purchase`, `restore` or `queue`), `transaction_id`, `product_id`.
- Product fields: `price` (a string), `currency`, `store_country`, `subscription_group_id`, `offers`, `introductory_price`, `normal_duration`.
- `presented_offering_identifier` and other paywall context.
- `payload_version: 1`.

**Android body:**
- `fetch_token`: the purchase token.
- `product_ids[]`.
- `platform_product_ids[]`, each `{product_id, base_plan_id, offer_id}`.
- `app_user_id`, `is_restore`, `observer_mode`, `price`, `currency`, `normal_duration`, `store_user_id`, `pricing_phases[]`, `proration_mode`, `initiation_source`, `payload_version: 1`.

**Response:** CustomerInfo. Android also reads `purchased_products` (rule 5).

**5xx behavior:**
- iOS leaves the transaction unfinished.
- Android neither acknowledges nor consumes it, and re-sends it from the pending-purchase sync on the next foreground.

### `POST /v1/subscribers/identify`: logIn

- Body: `{app_user_id, new_app_user_id}`.
- Response: CustomerInfo.
- Status: **201 means the user was created**; any other 2xx means it already existed.
- Android rejects an empty 2xx body.

### `POST /v1/subscribers/{id}/alias`

- Android only, for Google Block Store recovery.
- Any 2xx counts as success, and the body is ignored.

### `GET /v1/subscribers/{id}/offerings`

```json
{"current_offering_id":"default",
 "offerings":[{"identifier":"default","description":"Default","metadata":{},
   "packages":[{"identifier":"$rc_monthly","platform_product_identifier":"monthly"}]}],
 "placements":null,"targeting":null}
```

- **`current_offering_id` must be present.** Android reads it with `getString`.
- Google subscription packages need `platform_product_plan_identifier`.
- Leave out `ui_config`; a malformed value fails decoding on iOS.
- Product IDs must resolve in the store (or a StoreKit configuration file). Zero resolvable products is a configuration error on both platforms.

### `GET /v1/product_entitlement_mapping`

```json
{"product_entitlement_mapping":{"monthly":{"product_identifier":"monthly","base_plan_id":null,"entitlements":["pro"]}}}
```

Used for offline entitlements when the server returns 5xx. An empty map is valid.

### `POST /v1/subscribers/{id}/attributes`

- Body: `{"attributes":{"$email":{"value":"…","updated_at_ms":…}}}`.
- The response body is ignored.
- 2xx, or any 4xx except 404, marks the attributes as synced. 5xx or 404 means they're retried later.

### `POST /v1/subscribers/{id}/intro_eligibility`

- iOS only, StoreKit 1 path only.
- Body: `{product_identifiers, fetch_token}`.
- Response: `{"<productId>": true | false | null}`, where null means unknown.

### `POST /v1/config/{domain}`

- Domain is `app`, and both SDKs call it by default.
- Body: `{app_user_id, fetch_context, manifest?, prefetched_blobs}`.
- Answer **204**. With no config, diagnostics stay off, which is the SDK default.

### `POST /v1/events`, `POST /v1/diagnostics`

- iOS sends these through the proxy. Android sends them to RevenueCat's hosts directly. openpurr can't receive them on Android..
- Answer **200 `{}`**. A 404 or 5xx makes the SDK keep the events and retry them forever.

### Health checks

**`GET /v1/subscribers/{id}/health_report_availability`:**
- Sent only by iOS SDKs compiled in DEBUG.
- Unauthenticated.
- Answer `{"report_logs":false}`.

**`GET /v1/health`:**
- Called only from `PurchasesDiagnostics`.
- Signature verification is always enforced on it, so it can never pass against our server.

### On demand only

These are called only when the app uses the matching API: `customercenter`, `virtual_currencies`, `/v1/offers`, `adservices_attribution`, `redeem_purchase`, `/rcbilling/*`, and `/auth/*` (the IAM flow, off by default).

## Startup sequence

- **iOS:** CustomerInfo, product_entitlement_mapping, offerings, remote config, then attributes. The DEBUG health check follows if applicable.
- **Android, on foreground:**
  1. remote config
  2. CustomerInfo
  3. offerings
  4. pending purchase sync (`/receipts`)
  5. attributes
  6. product_entitlement_mapping
  7. events (to RevenueCat)
  8. diagnostics (to RevenueCat)

**iOS sends requests one at a time,** with at most one connection per host. A slow response delays every SDK call behind it.

## Error codes the SDKs recognize

| Code | Meaning |
|---|---|
| `0` | unknown error |
| `7102` | purchase can't be transferred (`receiptAlreadyInUseError`) |
| `7110` | internal server error |
| `7225` | invalid API key |
| `7226` | bad request |
| `7220` | empty app user ID |
| `7256` | invalid app user ID |
| `7263` | invalid subscriber attributes |
| `7852` | purchase belongs to another user. Grouped with the web-redemption codes; don't use it for store transfers. |

The full list is in iOS `Error Handling/BackendErrorCode.swift` and Android `common/errors.kt`.

## Retries

- **iOS** retries only 429, only on `/v1/receipts` and a few purchase endpoints:
  - up to 3 times, with backoff of 0, 0.75 and 3 seconds;
  - it honors `Retry-After` (capped at 3600 s) and `Is-Retryable: false`.
- **Android** has no 429 handling.
- **With a proxy set, neither SDK fails over** to fallback hosts.

## Response signing

- Default mode is INFORMATIONAL on both platforms.
- The verification key is hard-coded to RevenueCat's, so our responses always show `verification = FAILED`. That's only logged, but it also disables ETag caching.
- Test apps should set `entitlementVerificationMode` to disabled to get `NOT_REQUESTED`.
- ENFORCED mode fails every signed endpoint. openpurr can't support it without a forked SDK.
