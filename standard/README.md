# openpurr Standard

The Standard edition: the same server as Lite (`../lite`), in Go on Postgres, for apps that
outgrow Cloudflare's free plan or need to run on GCP or AWS. It speaks the same RevenueCat SDK API,
reads the same config file and uses the same table names, so the unmodified SDKs work against
either edition and data can move from Lite to Standard later.

This is milestone S1 of `Specs/standard-plan.md`: the foundation and the SDK read endpoints. It
isn't ready for production use yet (see "Not implemented yet").

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
database has none, and serves the SDK API on `/v1` and a health check on `GET /healthz`. Logs are
JSON on stdout. SIGTERM drains requests and stops.

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

## Tests

```sh
go vet ./...
OPENPURR_TEST_DATABASE_URL=postgres://localhost/openpurr_test go test ./...
```

Tests that need Postgres skip without `OPENPURR_TEST_DATABASE_URL`. Each one gets its own schema,
so packages run in parallel against one database. The HTTP tests mirror Lite's `sdk`, `snapshot`,
`attributes`, `secret-keys`, `rate-limit`, `projects` and `intro-eligibility` suites; purchases
are written to the ledger directly until the receipt endpoint exists.

`internal/testdata/golden.json` holds what Lite's own code produces for a set of config documents
(versions, stored form and every validation message) and CustomerInfo scenarios (snapshot bytes and
rendered bodies); the tests check Standard matches it byte for byte. `golden.ts` next to it says how
to regenerate it after a change in Lite.

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
- no rate limits, no background job loop (the suite runs jobs with `/__conformance/jobs`), and
  config changes seen on the next request.

## Not implemented yet

- `POST /v1/receipts` answers 503 for any well-formed receipt, which keeps the purchase queued on
  the device. Recording purchases, JWS and chain verification, StoreKit 1 receipts and App Store
  Server Notifications come in S2; Google Play in S3.
- Webhooks, the job loop's jobs (retries, acknowledgements, FX rates, cleanup, snapshot backfill)
  in S4. The job registry is there, empty.
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
