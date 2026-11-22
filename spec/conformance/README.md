# openpurr conformance suite

One suite, every edition. It drives an openpurr server over HTTP only (the SDK API, store
notifications, the admin API, webhooks it sends and the MCP server), so the same scenarios run
against Lite (TypeScript on Cloudflare Workers) and Standard (Go on Postgres). An edition is done
when it passes.

## Running it

Against Lite (boots it for you):

```sh
pnpm --filter @openpurr/conformance test:lite                       # everything
pnpm --filter @openpurr/conformance test:lite -- tests/sdk.test.ts  # one file (any vitest args)
```

`test:lite` runs `wrangler dev --env conformance` (`lite/src/conformance/worker.ts`) on a free port
with a fresh local D1 in a temporary directory, applies the migrations, passes the variables below,
runs the suite and stops the server. `--keep` leaves the server running afterwards;
`--serve-only` just boots it and prints how to point the suite at it. `CONFORMANCE_LOG_LEVEL=log`
shows the Worker's logs.

Against any server that's already running in conformance mode:

```sh
pnpm --filter @openpurr/conformance test -- --target http://127.0.0.1:8787 --edition standard
```

| Runner setting | Flag | Default |
|---|---|---|
| `CONFORMANCE_TARGET` | `--target` | none (without one, `test` does nothing, so `pnpm -r test` stays offline) |
| `CONFORMANCE_TOKEN` | `--token` | `conformance-token` |
| `CONFORMANCE_EDITION` | `--edition` | `lite` (`lite` or `standard`; edition-specific checks run only on theirs) |
| `CONFORMANCE_STORE_PORT` | `--store-port` | `9911` (where the fake store server listens) |
| `CONFORMANCE_STORE_HOST` | | `127.0.0.1` |
| `CONFORMANCE_STORE_BASE` | `--store-base` | `http://<host>:<port>` (the fake store's URL as the server sees it) |

The test keys and certificates are generated on first run into `fixtures/generated.json`
(git-ignored); `pnpm --filter @openpurr/conformance fixtures` makes a fresh set. Restart the server
under test afterwards, since it trusts the root and holds the keys.

## The server side: conformance mode

A server under test runs in conformance mode: Lite as the wrangler environment `conformance`,
Standard with `OPENPURR_CONFORMANCE=1` (refused unless set explicitly). Production builds never
include it.

### Variables

| Variable | What |
|---|---|
| `CONFORMANCE_TOKEN` | Bearer token for the `/__conformance` routes. |
| `CONFORMANCE_STORE_BASE` | The runner's fake store server, e.g. `http://127.0.0.1:9911`. |
| `CONFORMANCE_APPLE_ROOT_B64` | The test Apple root (DER, base64), trusted instead of Apple's real root. |

The server also needs these secrets, which the scenarios' configs refer to by name. Their values
come from the fixtures (`serverSecrets()` in `src/env.ts`; `scripts/run-lite.mjs` shows how they're
passed):

| Secret | What |
|---|---|
| `APPLE_IAP_KEY` | The test App Store Connect API key (P-256 PKCS#8 PEM). |
| `GOOGLE_SERVICE_ACCOUNT` | A service account JSON with the test RSA key. |
| `WEBHOOK_AUTH` | `Bearer hook-secret-123` (webhook authorization header). |
| `WEBHOOK_SECRET` | `whsec_test_signing_key` (webhook signing secret). |
| `OPERATOR_SECRET` | Lite's operator pepper (Standard: its equivalent). |

### Outbound requests

Every outbound request to `https://<host><path>?<query>` where host is one of
`api.storekit.apple.com`, `api.storekit-sandbox.apple.com`, `androidpublisher.googleapis.com`,
`oauth2.googleapis.com`, `www.googleapis.com`, `www.ecb.europa.eu` or `api.cloudflare.com` goes to
`${CONFORMANCE_STORE_BASE}/<host><path>?<query>` instead, with the same method, headers and body.
Anything else (webhook endpoints, which the scenarios point at the runner's receiver directly) is
fetched as is. Webhook URLs are `http://127.0.0.1:...`, so the server must allow http for localhost
webhook URLs (the config validator does).

The fake store serves:

- `/<apple host>/...`: the App Store Server API, per environment, as each scenario programs it
  (unknown transactions answer 404 `4040010`);
- `/androidpublisher.googleapis.com/...`: the Play Developer API, likewise;
- `/oauth2.googleapis.com/token`: an access token for any JWT-shaped assertion;
- `/www.googleapis.com/oauth2/v3/certs`: the JWKS whose key signs the scenarios' Pub/Sub push tokens;
- `/www.ecb.europa.eu/stats/eurofxref/...`: exchange rates (none unless a scenario sets them);
- `/api.cloudflare.com/...`: whatever a scenario programs (Lite's usage alerts);
- `/hooks/<name>`: a webhook receiver that records every delivery.

### Routes

Present only in conformance mode. All are `POST` with a JSON body and need
`Authorization: Bearer $CONFORMANCE_TOKEN`; anything else answers 404.

- `POST /__conformance/reset` `{ "config": <config document, optional> }`: wipes all data (every
  table back to its post-migration state), sets the clock offset to 0, saves the given config (else
  the server's default test config, the same as `testConfig()` in `src/config.ts`) as the current
  version, creates an owner operator and answers `200 {"owner_token": "pat_..."}`: an access token
  with the owner role and every scope, working on `/admin/v1/*` and `/mcp` like any other. An
  invalid config answers 400 `invalid_config`.
- `POST /__conformance/jobs` `{}`: runs everything the scheduled handler runs (the hourly tasks
  included), synchronously, flushes deferred work, then answers `200 {}`.
- `POST /__conformance/clock` `{ "advance_ms": n }` or `{ "now_ms": n }`: shifts the server's now
  for every later request and job; answers `200 {"now_ms": <server now>}`.

Deferred work (webhook delivery after a purchase, snapshot rebuilds, Play acknowledgements) must be
finished before the response is observed or by the next `/__conformance/jobs` call. Lite finishes
it before responding; Standard may leave it for its job loop. Scenarios that observe deferred
effects call `settle()` (which is `/__conformance/jobs`) first, so either works.

Other conformance-mode behavior: no rate limits, and Apple's root replaced by the test root.

## Writing scenarios

Scenarios live in `tests/`, one file per area, and import everything from `src/index.ts`. Each test
starts with `await reset(config?)`. The building blocks:

- `src/server.ts`: `reset`, `jobs`, `settle`, `advanceClock`, `setClock`, `now` (the server's now:
  use it, not `Date.now()`, for any time the server compares), `owner` (the owner token).
- `src/config.ts`: `testConfig()` and `withAppleApi`, `withGooglePlay`, `withWebhooks`.
- `src/helpers.ts`: `call` (an SDK request with the SDK's headers), `request`, App Store signing
  (`signJws`, `signTransaction`, `signNotification`, `postNotification`, `postAppleTransaction`),
  Google (`playSubscription`, `pubsubToken`, `postGoogleNotification`), `expectValidCustomerInfo`.
- `src/admin.ts`: `admin` (an admin API request, by default as the owner), operators made the way a
  real owner makes them (`createOperator`, `login`, `createToken`, `operatorToken`), `mcp`,
  `mcpTool`, `putConfig`.
- `src/fake-store.ts`: `fake`, cleared before each test: `fake.apple(routes)`, `fake.google(routes)`,
  `fake.googleStore()`, `fake.on`, `fake.onMatch`, `fake.ecb`, `fake.requests`, and for webhooks
  `fake.webhookUrl`, `fake.webhookStatus`, `fake.received`, `fake.events`.
- `src/tags.ts`: `describeEdition("lite", ...)` and `itEdition(...)` for edition-specific checks.

Check only what's visible over HTTP. Pure unit tests (DER parsing, FX math, config parsing) stay in
each edition's own tests.

## Coverage

Ported from Lite's suites (238 tests pass against Lite, 3 skipped):

| File | From `lite/test/` |
|---|---|
| `sdk.test.ts` | `sdk` (plus untrusted-root and clock-driven expiry checks) |
| `notifications.test.ts` | `notifications` (App Store Server Notifications V2) |
| `apple-server-api.test.ts` | `apple-server-api`, and `apple-receipt` through `/v1/receipts` |
| `intro-eligibility.test.ts` | `intro-eligibility` |
| `snapshot.test.ts` | `snapshot` (ETag checks are Lite-only: the wire contract doesn't define one) |
| `google-play.test.ts`, `google-rtdn.test.ts`, `google-jobs.test.ts` | `google-play`, `google-rtdn`, `google-jobs` |
| `webhooks.test.ts` | `webhooks` (the exact retry schedule is Lite-only) |
| `secret-keys.test.ts`, `attributes.test.ts` | `secret-keys`, `attributes` |
| `admin-api.test.ts`, `operator-auth.test.ts`, `projects.test.ts` | `admin-api`, `operator-auth`, `projects` |
| `metrics.test.ts`, `experiments.test.ts`, `import.test.ts` | `metrics`, `experiments`, `import` |
| `mcp.test.ts`, `oauth.test.ts` | `mcp`, `oauth` |
| `scheduled.test.ts`, `doctor.test.ts`, `usage.test.ts` | the HTTP-visible parts of `scheduled`, `doctor`, `usage` (usage is Lite-only) |

Staying in Lite (unit tests or internals): `apple-jws`, `der`, `fx`, `config`, `countries`,
`store-tokens`, `setup-urls`, `bench`, `capture`, the config loader's caching, and the pure parts
of the suites above (variant hashing, statistics, credential crypto, usage thresholds).

Not ported yet:

- Rate limits (`rate-limit`, sign-in limits in `operator-auth`, the per-IP exemption in
  `secret-keys`): conformance mode runs without rate limits and nothing sets them over HTTP. Needs
  a contract addition, e.g. limits in the reset body.
- Client ID Metadata Documents in `oauth` (2 skipped tests): the client_id must be an HTTPS URL on a
  real host name, and none is routed to the fake store. Needs a faked host added to the contract.
- Cloudflare usage fetching and near-limit checks (`usage`, and the import test that stops near a
  free-plan limit, skipped): Lite's conformance Worker has no `CLOUDFLARE_ANALYTICS_TOKEN`. Setting
  a dummy one (calls already go to the fake store) would make them Lite-only scenarios.
- Recovery links (`operator-auth`): only `scripts/admin.mjs` makes them, writing straight to D1.
- Anything that needs a store or webhook secret other than the fixed ones above (missing secrets
  are tested by naming a secret that isn't set).
