# openpurr Standard

The Standard edition: the same server as Lite (`../lite`), in Go on Postgres, for apps that
outgrow Cloudflare's free plan or need to run on GCP or AWS. It speaks the same RevenueCat SDK API,
reads the same config file and uses the same table names, so the unmodified SDKs work against
either edition and data can move from Lite to Standard later.

This is milestones S1 to S6 of `Specs/standard-plan.md`: the foundation, the SDK read endpoints,
App Store purchases and notifications, Google Play purchases and notifications, webhook delivery
with the background jobs, the back office (operator sign-in, the admin API and the dashboard), and
charts.
It isn't ready for production use yet (see "Not implemented yet").

## Build and run

Go 1.26 and Postgres 14 or later.

```sh
go generate ./internal/officeui     # copies the dashboard (../lite/office-ui) in to be embedded
go build -o openpurr ./cmd/openpurr
DATABASE_URL=postgres://localhost/openpurr OPENPURR_CONFIG=../lite/openpurr.config.yaml OPERATOR_SECRET=... ./openpurr
DATABASE_URL=postgres://localhost/openpurr ./openpurr admin create --email you@example.com --url http://localhost:8080
```

Without `go generate` the binary still serves the APIs; the dashboard's pages then say how to add
it. Or with Docker (static binary on distroless, dashboard included), from the repository root:

```sh
docker build -f standard/Dockerfile -t openpurr-standard .
docker run -e DATABASE_URL=... -e OPERATOR_SECRET=... -p 8080:8080 openpurr-standard
```

The server applies its migrations at startup (several replicas can start at once; they take
turns under an advisory lock), imports `OPENPURR_CONFIG` as the first config version if the
database has none, and serves the SDK API on `/v1`, App Store Server Notifications V2 on
`POST /notifications/apple`, Google Play Real-time Developer Notifications on
`POST /notifications/google`, the admin API on `/admin/v1`, the dashboard under `/admin` and a
health check on `GET /healthz`, and runs the background jobs
(see "Webhooks and background jobs"). Logs are JSON on stdout. SIGTERM stops taking requests, lets
those in progress, the job in progress and deferred work (first webhook attempts, snapshot
rebuilds) finish, and stops, within 25 seconds.

| Variable | |
|---|---|
| `DATABASE_URL` | Postgres connection string (required). |
| `PORT` | Port to listen on (default 8080). |
| `OPENPURR_CONFIG` | An `openpurr.config.yaml` (Lite's format, version 1 or 2) imported on first start. A file with mistakes stops the server with a message saying what's wrong. After the first start the database is the source of truth. |
| `OPERATOR_SECRET` | At least 32 random characters: the back office derives the password pepper and the key that encrypts authenticator secrets from it, as Lite does, so use Lite's value when moving from Lite. Without it, sign-in answers 503 (access tokens still work). Changing it invalidates every password and authenticator; reset them with `openpurr admin login-link`. |
| `PUBLIC_URL` | The server's public origin (`https://purchases.example.com`). Optional: setup links and the dashboard's same-origin check use it, else each request's host and scheme (`X-Forwarded-Proto` behind a proxy that ends TLS). |
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

## Google Play

As on Lite:

- **Purchases** posted to `POST /v1/receipts` are verified with the Play Developer API
  (`purchases.subscriptionsv2` or `purchases.products`), using the service account JSON key in the
  secret `google_play_api.service_account_secret` names (default `GOOGLE_SERVICE_ACCOUNT`). The
  service-account assertion (RS256) is exchanged for an access token, reused until two minutes
  before it expires. The price paid comes from the Orders API when the service account may read
  it, otherwise from the plan's recurring price. Android consumes a purchase only when the answer
  says `should_consume: true` (consumables).
- **Acknowledgement**: the server acknowledges subscriptions and non-consumables after recording
  them (Google refunds purchases left unacknowledged for 3 days); a failed attempt is kept in
  `play_ack_pending` and retried by the hourly `retry-play-acknowledgements` job.
- **Upgrades, downgrades and re-signups** (a new purchase token linked to the old one) mark the old
  chain as upgraded, and by notification the new token inherits the old one's owner.
- **Real-time Developer Notifications** at `POST /notifications/google`, from a Pub/Sub push
  subscription with authentication on: the push token (Google-signed RS256 OIDC) is checked against
  Google's keys (cached as long as Google's `Cache-Control` says, refetched for an unknown key ID),
  for the app's `pubsub_push_account` and its `pubsub_audience` (by default
  `https://<host>/notifications/google`). Each notification is followed by a Play Developer API
  call for the current state, and processed once per Pub/Sub message ID.
- **Refunds**: revoked subscriptions, canceled one-time purchases and voided-purchase
  notifications end access, and the hourly `poll-play-voided-purchases` job reads the voided
  purchases API as a backstop for missed notifications (20 orders per app per run, checkpointed
  in `job_state`).
- Status codes as for the App Store: 4xx only for a purchase token Google doesn't know, 5xx for a
  pending purchase, config mistakes, a missing key or Google being unavailable. Notifications
  answer 2xx when retrying can't help (malformed message, a token Google no longer knows), 401 for
  a bad push token, and 5xx when the config doesn't know the package or product.

## Webhooks and background jobs

As on Lite:

- **Webhook events** are written with the change that causes them (see App Store), and the first
  delivery attempt is made right after the transaction commits. RevenueCat's body and signature:
  `X-RevenueCat-Webhook-Signature: t=<unix>,v1=<hex>`, HMAC-SHA256 over `<t>.<raw body>`, with
  one `v1=` per key while the signing secret holds two (a rotation), recomputed on every attempt;
  `Authorization` is the exact value of the secret `authorization_secret` names. A configured
  secret that isn't set means no request, and the delivery says why. Each request has 15 seconds;
  any 2xx is delivered. Failures are retried after 5, 10, 45, 120, 180, 360, 720, 1440 and 1440
  minutes (about 72 hours), then the delivery is marked failed; an endpoint removed from the config
  fails at once. At-least-once: consumers deduplicate on `event.id`. Several events from one change
  reach an endpoint in the order they were written.
- **Replay** (`POST /admin/v1/webhooks/events/{id}/replay`) queues an event's deliveries again with
  the same body and sends them at once; consumers deduplicate on `event.id`.
- **The job loop** runs in the server process. Every 5 minutes: `retry-webhooks` (due deliveries,
  oldest first) and `backfill-snapshots` (CustomerInfo for customers without a current snapshot:
  none, an older config, or a write whose rebuild didn't happen). Every hour:
  `prune-notification-payloads` (raw payloads after 30 days), `prune-captures` (14 days),
  `prune-inactive-customers` (customers with no purchase and no grant, first seen over 90 days ago,
  with no new app user ID or attribute sync since), `prune-expired-apple-chains`, `prune-oauth`,
  `refresh-exchange-rates` (90 days of the European Central Bank's rates on first run, then each
  day's once published, checked from 15:00 UTC), `retry-play-acknowledgements`,
  `poll-play-voided-purchases` and, last, `rollup-metrics` (the charts, see below). Slots are aligned to the clock (as a cron), and a job runs once per
  slot across all replicas: it holds a Postgres advisory lock while it runs and records its slot
  in `job_state`. A failing job is logged and tried again next slot; it doesn't stop the others.
- **Several replicas** are safe: deliveries are claimed with `FOR UPDATE SKIP LOCKED` and a lease
  (`webhook_delivery.claimed_until`), so a delivery is attempted by one server at a time and no
  database connection waits on a slow endpoint. A server that stops mid-attempt leaves a lease
  that runs out, and the retry job picks the delivery up.

## The back office

As on Lite (`lite/src/office`), with the same tables, so operators, tokens and settings move over:

- **Operators** sign in at `/admin/v1/auth/*` with a password (HMAC-SHA256 with a pepper derived
  from `OPERATOR_SECRET`, then PBKDF2-SHA256, Lite's exact format) and optionally an authenticator
  app (RFC 6238; the secret AES-GCM encrypted with a second key from `OPERATOR_SECRET`) or a
  one-time recovery code. Sessions are an HttpOnly, Secure, SameSite=Strict cookie (7 days; 30
  minutes for setup and recovery links), and every cookie-authenticated write must carry this
  server's `Origin`. Unknown emails cost the same as wrong passwords and get the same answer; 10
  failures in a row (wrong passwords, authenticator codes and recovery codes alike) lock the
  account for 15 minutes; sign-in counts against the per-IP and per-user rate limits.
- **Bootstrap and recovery:** `openpurr admin create` makes the owner and prints a 24-hour setup
  link; `openpurr admin login-link` prints a 15-minute recovery link (to replace a lost password
  or authenticator); `list` and `require-totp on|off` as Lite's `scripts/admin.mjs`. They use
  `DATABASE_URL`, so whoever runs the infrastructure can always get in.
- **Roles** (owner, admin, developer, viewer), optionally limited to some apps, and **personal
  access tokens** (`pat_...`, scopes `read`, `write:grants`, `write:webhooks`, `write:config`,
  `admin`) for the CLI: a token can do what its operator's role allows, limited to its scopes.
- **The admin API** (`/admin/v1`): projects and apps, operators, tokens, secret keys, customers
  (the list and search, and each customer's CustomerInfo, transactions, attributes, events, grants
  and experiments), promotional grants, imports from RevenueCat (one row per request, as
  `openpurr import` sends them), price experiments and their results, webhook deliveries and
  replay, the audit log (every write: who, which token, from where), the versioned config
  (validate, save with a base version, history, restore), settings and the setup checks
  (`/doctor`), and charts (`/metrics`, see below). The MCP consent routes answer 501 until S7.
- **The dashboard** is `lite/office-ui`, unchanged, embedded at build time. Its files get the
  headers of its own `_headers` file (a strict Content-Security-Policy, no framing), and any other
  page under `/admin` gets `index.html`, as Cloudflare's single-page-application mode does.
- **Edition:** `GET /admin/v1/settings` and `GET /admin/v1/usage` include `"edition": "standard"`.
  The usage report has no metrics (Standard has no Cloudflare daily limits) and
  `POST /admin/v1/usage/refresh` answers 400. The dashboard doesn't read the edition yet; until it
  does, it shows "Lite" and the usage card's Cloudflare text.

## Charts

As on Lite (`lite/src/metrics.ts`), in `internal/metrics`:

- **Daily totals** in `metric_daily`, derived from the ledger: subscriptions become time segments
  (purchase to the earliest of expiry or grace end, refund, or the next renewal; purchases at the
  same moment taken in the order they were recorded, so only the last gives access; a purchase with
  no expiry gives none and is left out of its chain) that add +1/-1 to the running totals (active
  subscriptions, trials, paid subscriptions, MRR) on the days they start and end; movements (new,
  renewed, reactivated, churned; trials converted, expired, cancelled; MRR new, reactivation,
  expansion, contraction, churned) classify the same starts and ends; revenue, transactions,
  refunds, new trials and one-time purchases are per-day amounts, in USD at the purchase date's
  rate. New customers are counted once per day and never recounted (the cleanup job deletes old
  non-buyers).
- **The rollup** runs hourly (`rollup-metrics`, after the exchange rates) and on
  `POST /admin/v1/metrics/refresh` (at most once a minute; `{"full": true}` rebuilds all history,
  owners only, audited). It recomputes from the earliest purchase date among ledger rows changed
  since the last run (or that run's own day), waits while an import is running (until an hour
  after the last imported row), and does a full rebuild the first time and after migration 0004.
  Runs on any replica take turns under an advisory lock.
- **The charts** (`GET /admin/v1/metrics`, `/metrics/{chart}`, `format=csv`): the same 16 charts,
  parameters (`from`, `to`, `interval`, `environment`, `store`, `app`, `product`, `project`),
  checks, permissions and output as Lite, byte for byte.
- **Exact numbers:** Lite does the arithmetic in SQLite. Standard reads the same ledger rows and
  does it in Go with SQLite's summation (Kahan-Babuska-Neumaier) and `round()`, adding values up in
  Lite's order, so every stored total and every chart matches Lite's to the last bit (see Tests).
- **Country filter** (Standard only; Lite left it to Standard): `?country=US` (ISO 3166-1 alpha-2,
  any case) on any chart, combined with the other filters, from the country of each purchase's
  storefront (Apple's alpha-3 codes mapped with `internal/countries`, Google's region code as is;
  purchases without one are in no country). New customers aren't tied to a country, so that chart
  ignores the filter with a note; the status breakdown filters live from the ledger.
  `GET /admin/v1/metrics` adds `"edition": "standard"` and `"countries"`, the countries with data.
  The totals are kept per country in `metric_daily_country` (migration 0004), written by the same
  rollup from the same in-memory totals, rather than computed from the ledger on each request: a
  chart over all history needs every earlier change (running totals), so computing it per request
  would read the whole ledger for each of the dashboard's charts, while the stored totals make a
  filtered chart cheaper to read than an unfiltered one. It's a separate table, not a column of
  `metric_daily`, because each stored value is rounded and per-country values rounded separately
  don't always add up to the rounded total, so unfiltered charts keep reading rows identical to
  Lite's (which also move over from Lite unchanged). Like everything in both tables, it can be
  rebuilt from the ledger at any time.
- **Speed:** a rollup reads the ledger rows it needs, computes in memory, then writes only the
  totals that changed (Lite deletes and re-inserts; re-inserting keys deleted in the same Postgres
  transaction is slow). On a laptop, for a generated ledger of 98,437 transactions in 22,222
  subscriptions over three years (`OPENPURR_PERF_TRANSACTIONS=100000 go test -run
  TestFullRebuildOnALargeLedger -v ./internal/metrics`): the first full rollup takes about 2 s
  (52,015 rows in `metric_daily`, 119,639 in `metric_daily_country`), a full rebuild about 0.8 s,
  an hourly run with nothing changed about 0.1 s, and reading all 16 charts over three years by
  month about 80 ms (40 ms with a country filter). Both tables compare text byte by byte
  (`COLLATE "C"`), as SQLite does, which is also faster than a locale's collation.

## Tests

```sh
go vet ./...
OPENPURR_TEST_DATABASE_URL=postgres://localhost/openpurr_test go test ./...
```

Tests that need Postgres skip without `OPENPURR_TEST_DATABASE_URL`. Each one gets its own schema,
so packages run in parallel against one database. The HTTP tests mirror Lite's `sdk`, `snapshot`,
`attributes`, `secret-keys`, `rate-limit`, `projects`, `intro-eligibility`, `notifications` and
`apple-server-api` suites, `webhooks` (events, delivery, retries, replay), `scheduled`, `fx`, the
snapshot backfill, `operator-auth`, `admin-api`, `import`, `doctor`, `setup-urls`, the admin parts
of `experiments`, and `metrics` (in `internal/metrics`); `internal/applejws` mirrors `apple-jws`, `internal/authcrypto` the credential
crypto of `operator-auth`. The Google Play tests mirror `google-play`,
`google-rtdn`, `google-jobs` and `store-tokens` against a fake Google (OAuth token endpoint, Play
Developer API and push-token keys, `internal/testutil/google.go`). App Store payloads are signed
with a certificate chain the tests generate (`internal/testutil/apple.go`), and a fake App Store
Server API stands in for Apple's.

`internal/testdata/golden.json` holds what Lite's own code produces for a set of config documents
(versions, stored form and every validation message) and CustomerInfo scenarios (snapshot bytes and
rendered bodies); `golden-apple.json` holds Lite's App Store transaction rows, subscription states,
planned webhook events, event bodies and App Store Server API syncs; `golden-google.json` holds
Lite's Google Play rows, subscription states, planned events, event bodies and purchase
verifications; `golden-webhooks.json` holds Lite's signature headers, the request each delivery
attempt makes, what it records, the retry schedule, and its ECB rate parsing; `golden-auth.json`
holds Lite's password hashes, TOTP codes, encrypted authenticator secrets, base32, recovery codes
and tokens, made from predictable random bytes so Standard can make the same ones;
`golden-metrics.json.gz` holds what Lite's chart code stores and serves for four ledgers (the
hand-checked one of Lite's metrics test, odd edge cases, and two demo-like ledgers with trials,
upgrades, refunds, grace periods, pauses, several currencies and Google base plans): every
`metric_daily` row after each of 25 rollups (full, incremental, during an import), each run's
result and state, and 592 charts as JSON and CSV. The tests check
Standard matches them byte for byte. The `.ts` file next to each says how to regenerate it after a
change in Lite.

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
- no rate limits, no background job loop (`/__conformance/jobs` runs every job at once, slot or
  not, so deliveries made due by moving the clock are retried), config changes seen on the next
  request, and deferred work (snapshot rebuilds, first webhook attempts) finished before a response
  completes, as in Lite's conformance Worker.

## Not implemented yet

- Cohort charts (project plan section 7, phase 3: subscription retention, trial conversion,
  initial conversion, realized LTV, trial cancellation rate), which Lite leaves to Standard.
- MCP and OAuth (S7): `/mcp`, `/oauth/*` and the dashboard's consent routes (501; the connected
  apps list is empty). Access tokens already work the way MCP will use them.
- GCP packaging and IAP sign-in (S8), moving from Lite (S9).
- Lite's free-plan usage check (`refresh-usage`, Cloudflare analytics) has no Standard counterpart.
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
- **The default Pub/Sub audience** is `https://` plus the request's host and
  `/notifications/google`, whatever scheme the request arrived with (Lite uses the request URL,
  always https on Workers). Pub/Sub only pushes to https endpoints, and TLS usually ends at a
  proxy in front of Standard; set `pubsub_audience` if the public URL differs.
- **Google times and numbers that can't be read.** A time in a Play Developer API answer that
  isn't RFC 3339, or a purchase time that isn't a number, is a config-style 500 naming the field
  (Lite would store NaN). The Pub/Sub message data is decoded as UTF-8 (Lite reads it as Latin-1
  before parsing, which only matters for non-ASCII text).
- **The missing-key message** for Google Play says "The secret GOOGLE_SERVICE_ACCOUNT ..." where
  Lite says "The Worker secret ...".
- **A failed acknowledgement's `last_error`** is "Error: " and the error's message; Lite stores
  `String(err)`, which names the JavaScript error class.
- **Webhook delivery wording.** A missing secret is reported as "Secret WEBHOOK_AUTH isn't set"
  (Lite: "Worker secret ..."). A failed request's `last_error` is Go's description of the error
  ("dial tcp ...: connection refused") where Lite has the Workers runtime's; a timeout is "The
  operation was aborted due to timeout" in both.
- **Webhook ordering.** The first attempt sends events to one endpoint one after another, in the
  order they were written (Lite starts them together, which in practice arrives in order).
  Retries run together, as on Lite.
- **Work per job run.** Lite's limits come from the free plan's subrequest and query budgets:
  Standard retries due deliveries in batches of 20 until a batch comes back short (at most 500 per
  run, Lite 20), and builds up to 200 snapshots per backfill run (Lite 8).
- **Job slots.** Lite's cron runs every 5 minutes and its hourly tasks in the first 5 minutes of
  each hour; Standard's loop checks every minute and runs each job once per 5-minute or hourly
  slot, whichever replica gets to it.
- **`webhook_delivery.claimed_until`** is a Standard-only column (migration 0003), the delivery
  lease above.
- **The back office's wording** says "The secret OPERATOR_SECRET ..." where Lite says "The Worker
  secret ...", and its setup checks give environment variables where Lite gives `wrangler secret
  put`. Lite's Cloudflare checks (D1 migrations and size, free-plan usage, the workers.dev domain)
  are replaced by a check of Standard's own migrations; the scheduled-job check reads the job
  loop's slots.
- **The SDK URL guess** is this server's own origin (it serves the SDK API too); Lite guesses the
  SDK Worker's workers.dev address.
- **Unknown pages:** only `/`, `/admin` and pages under it fall back to the dashboard; any other
  unknown path still gets the SDK's JSON 404 (Lite's back-office Worker answers every unknown page
  with `index.html`).
- **Dates in the admin API** (a grant's `expires_at`, an import row's `first_seen`) are read in the
  ECMAScript date format (`2026-01-31`, `2026-01-31T12:00:00Z`, with an offset); V8's looser forms
  ("Jan 31 2026") aren't accepted.
- **Customer search:** the email lookup is case-insensitive for all of Unicode (D1's `NOCASE` folds
  ASCII only), and a customer's `stores` are listed in alphabetical order.
- **Imports** don't stop near a daily limit (Standard has none).
- **The inactive-customer cleanup** locks its candidates (`FOR UPDATE SKIP LOCKED`), so a customer
  a request is writing to at that moment is left for the next run.
- **Chart requests Lite fails on:** a chart named after an `Object.prototype` member
  (`/metrics/constructor`) is a 404 (Lite finds the member and fails).
- **Chart totals are written as a difference:** a rollup deletes, updates and inserts only the
  rows that changed, where Lite deletes the range and inserts it again; the stored rows and the
  run's `rows` count are the same. Rollups take turns under an advisory lock.
- **Chart text columns** (`metric_daily`'s and `metric_daily_country`'s) use `COLLATE "C"`, as
  SQLite compares text.
- **Additions:** the country filter, `metric_daily_country`, and `edition` and `countries` in
  `GET /admin/v1/metrics` (see Charts).
