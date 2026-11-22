# openpurr Standard

The Standard edition: the same server as Lite (`../lite`), in Go on Postgres, for apps that
outgrow Cloudflare's free plan or need to run on GCP or AWS. It speaks the same RevenueCat SDK API,
reads the same config file and uses the same table names, so the unmodified SDKs work against
either edition and data can move from Lite to Standard later.

This is milestones S1 and S2 of `Specs/standard-plan.md`: the foundation, the SDK read endpoints,
and App Store purchases and notifications. It isn't ready for production use yet (see "Not
implemented yet").

## Build and run

Go 1.26 and Postgres 14 or later.

```sh
go build -o openpurr ./cmd/openpurr
DATABASE_URL=postgres://localhost/openpurr OPENPURR_CONFIG=../lite/openpurr.config.yaml ./openpurr
```

Or with Docker (static binary on distroless):

```sh
docker build -t openpurr-standard .
docker run -e DATABASE_URL=... -p 8080:8080 openpurr-standard
```

The server applies its migrations at startup (several replicas can start at once; they take
turns under an advisory lock), imports `OPENPURR_CONFIG` as the first config version if the
database has none, and serves the SDK API on `/v1`, App Store Server Notifications V2 on
`POST /notifications/apple` and a health check on `GET /healthz`. Logs are JSON on stdout.
SIGTERM drains requests and stops.

| Variable | |
|---|---|
| `DATABASE_URL` | Postgres connection string (required). |
| `PORT` | Port to listen on (default 8080). |
| `OPENPURR_CONFIG` | An `openpurr.config.yaml` (Lite's format, version 1 or 2) imported on first start. A file with mistakes stops the server with a message saying what's wrong. After the first start the database is the source of truth. |
| `OPERATOR_SECRET` | At least 32 random characters, for the back office (operator passwords and TOTP), once it arrives. |
| `RATE_LIMIT_IP_PER_MINUTE` | SDK requests per client IP per minute (default 300, 0 = off). |
| `RATE_LIMIT_USER_PER_MINUTE` | SDK requests per app user per minute (default 60, 0 = off). |
| `CLIENT_IP_HEADER` | The header your load balancer puts the client IP in (for example `X-Forwarded-For` or `CF-Connecting-IP`). Without it, the connection's address is used. Only set it behind a proxy that overwrites the header. |
| `LOG_LEVEL` | `debug`, `info` (default), `warn` or `error`. |

Secrets the config names (`APPLE_IAP_KEY`, `GOOGLE_SERVICE_ACCOUNT`, webhook secrets) are
environment variables of that name, as they're Worker secrets of that name on Lite.

## App Store

As on Lite:

- **StoreKit 2** apps post a signed transaction to `POST /v1/receipts`. It's verified against
  Apple Root CA G3 (alg, chain, validity, Apple's marker extensions, signature); verified chains
  are cached in memory and in `apple_verified_chain`, so another replica reads the stored leaf
  key instead of checking the chain again. A restore (`is_restore`) also asks the App Store
  Server API for the current status of every subscription, when the app has API access.
- **StoreKit 1** apps post the app receipt. One transaction ID is read from it and the App Store
  Server API (production, then sandbox) is asked for the customer's history and subscription
  statuses; Apple's answer is what's recorded. This needs `app_store_server_api` in the config and
  the In-App Purchase key (`.p8`) in the secret it names (default `APPLE_IAP_KEY`).
- **Server Notifications V2** at `POST /notifications/apple`: three signatures verified, the
  transaction and renewal status applied, each notification processed once. Point App Store
  Connect's production and sandbox notification URLs at it.
- Purchases follow RevenueCat's default restore behavior (an anonymous owner is merged in, a named
  owner's purchase transfers), and the status codes of `spec/sdk-wire-contract.md`: 4xx only for
  receipts that will never be good, 5xx (keeping the purchase queued on the device) for config
  mistakes, a missing key or Apple being unavailable.
- Every ledger change, its webhook events and the snapshot invalidation are one Postgres
  transaction (Lite's D1 batch).

## Tests

```sh
go vet ./...
OPENPURR_TEST_DATABASE_URL=postgres://localhost/openpurr_test go test ./...
```

Tests that need Postgres skip without `OPENPURR_TEST_DATABASE_URL`. Each one gets its own schema,
so packages run in parallel against one database. The HTTP tests mirror Lite's `sdk`, `snapshot`,
`attributes`, `secret-keys`, `rate-limit`, `projects`, `intro-eligibility`, `notifications` and
`apple-server-api` suites, and the App Store parts of `webhooks` (checked on the recorded events);
`internal/applejws` mirrors `apple-jws`. App Store payloads are signed with a certificate chain the
tests generate (`internal/testutil/apple.go`), and a fake App Store Server API stands in for
Apple's.

`internal/testdata/golden.json` holds what Lite's own code produces for a set of config documents
(versions, stored form and every validation message) and CustomerInfo scenarios (snapshot bytes and
rendered bodies); `golden-apple.json` holds Lite's App Store transaction rows, subscription states,
planned webhook events, event bodies and App Store Server API syncs. The tests check Standard
matches them byte for byte. `golden.ts` and `golden-apple.ts` next to them say how to regenerate
them after a change in Lite.

The shared HTTP suite is in `../spec/conformance` (see its README); run it against a Standard
server started in conformance mode.

## Conformance mode

For the conformance suite only. `OPENPURR_CONFORMANCE=1` (refused unless `CONFORMANCE_TOKEN` is
set too) turns on:

- `POST /__conformance/reset`, `/jobs` and `/clock`, guarded by `Authorization: Bearer
  $CONFORMANCE_TOKEN` (404 otherwise), as specified in `../spec/conformance/README.md`;
- a clock the suite can move, read by everything that uses the time;
- outbound requests to the store, Google, ECB and Cloudflare hosts sent to
  `CONFORMANCE_STORE_BASE` instead;
- `CONFORMANCE_APPLE_ROOT_B64` trusted instead of Apple Root CA G3;
- no rate limits, no background job loop (the suite runs jobs with `/__conformance/jobs`),
  config changes seen on the next request, and deferred work (snapshot rebuilds) finished before
  a response completes, as in Lite's conformance Worker.

## Not implemented yet

- Google Play (S3). Unverified development purchases (`allow_unverified_purchases`) work; an app
  with `google_play_api` gets 503 on `/v1/receipts`, which keeps the purchase queued on the device,
  and `/notifications/google` doesn't exist yet.
- Webhook delivery (S4). Events and their pending deliveries are recorded exactly as Lite records
  them, in the same transaction as the purchase, but nothing sends them yet: the first attempt
  after the response, signing, retries and replay come with the job loop, as do its other jobs
  (acknowledgements, FX rates, cleanup, snapshot backfill). USD prices use whatever is in `fx_rate`,
  which nothing fills yet.
- The back office (`/admin/v1`, operator sign-in, the dashboard, config editing) in S5. A
  conformance reset already creates the owner operator and access token in Lite's formats.
- Charts and experiment results (S6), MCP and OAuth (S7), GCP packaging (S8), moving from Lite (S9).
  Running price experiments already pick the current offering on `/v1/.../offerings`.

## Differences from Lite

On purpose, or because Postgres and Go aren't D1 and Workers:

- **Order of a customer's transactions.** CustomerInfo is built from transactions in the order
  they were recorded (`store_transaction.id`); Lite gets SQLite's join order, which is nearly
  always the same. Only the order of keys inside `subscriptions` and `entitlements` could differ.
- **Case-insensitive columns.** D1's `COLLATE NOCASE` (operator emails, the attribute search
  index) is an index on `lower(...)`.
- **Creating a customer** happens in one transaction, so two concurrent first requests for the same
  app user ID can't leave an orphan customer row behind.
- **The seed config** is validated when the server starts (Lite validates it at build time).
- **Rate limits** are counted in memory per process (an interface allows a shared store), with the
  limits set by environment variables instead of `wrangler.jsonc`.
- **Malformed URLs** (invalid percent-encoding) are refused by Go's HTTP server with a plain 400
  before they reach the SDK API.
- **Request capture** (Lite's `CAPTURE` spike tooling) isn't ported; the `capture` table exists
  for export compatibility.
- **Non-string IDs** in a logIn body are used as their text, as D1 stores them; fractional
  `updated_at_ms` values are truncated to whole milliseconds.
- **App Store payload fields of the wrong JSON type.** A date or price that isn't a number counts
  as missing (D1 would store whatever it was given); `price` in milliunits is rounded to whole
  micros for the `bigint` column.
- **Certificates** are parsed with `crypto/x509` rather than Lite's DER reader, so the detail after
  "malformed certificate:" in an error message is Go's wording; the checks and every other message
  are Lite's.
- **The missing-key message** for StoreKit 1 receipts says "The secret APPLE_IAP_KEY ..." where
  Lite says "The Worker secret ...".
- **Ties in webhook event bodies.** Aliases with the same creation time are ordered by app user ID
  and attributes with the same update time by key (SQLite leaves both to its row order).
- **Calls to the App Store Server API** end when the SDK's request does, and after the outbound
  client's 30-second timeout.
