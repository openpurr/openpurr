# Moving from Lite to Standard

This guide moves a running openpurr Lite deployment (Cloudflare Workers and D1) to the Standard edition (Go and Postgres, for example on [Google Cloud](standard-on-gcp.md)) without an app update, without changing anything in App Store Connect or the Play Console, and without losing a purchase.

## How it works

- **Your domains are the contract.** Apps, Apple and Google only know your hostnames. During the move Lite's Workers keep answering on them, and forward every request to Standard; afterwards you point the hostnames wherever you like.
- **Only the ledger moves.** Customers, purchases, store-reported subscription status, grants, attributes, operators, keys and settings are copied. CustomerInfo snapshots and chart totals are rebuilt on Standard from the copy.
- **Keys and logins carry over.** Secret keys and access tokens are stored as hashes, and passwords and authenticator secrets with a key derived from `OPERATOR_SECRET`, so they work on Standard as long as it has Lite's `OPERATOR_SECRET`.
- **Nothing is final until you say so.** You can verify, catch up and verify again before cutting over, and cutting over is one secret you can delete again.

In order:

1. Check the prerequisites.
2. Set up Standard.
3. Export from Lite.
4. Import into Standard.
5. Verify.
6. Catch up (optional, as often as you like).
7. Cut over.
8. Import the last changes.
9. Finish.

### What moves

| | |
|---|---|
| Customers, app user IDs, aliases and attributes | Yes |
| Purchases, renewals, refunds, upgrades (the ledger) | Yes |
| Renewal status, billing problems, grace periods (`subscription_state`) | Yes. It's what Apple and Google last said, so it can't be rebuilt from the ledger. |
| Promotional grants, price experiments and enrollments | Yes |
| Webhook events and deliveries, including pending ones | Yes. Standard retries the pending ones on schedule. |
| Operators, roles, passwords, authenticators, recovery codes, sessions | Yes, with the same `OPERATOR_SECRET` |
| Personal access tokens, secret keys, MCP connections (OAuth) | Yes |
| The config and its history, settings, the audit log | Yes |
| Exchange rates, the `new_customers` chart | Yes (old non-buyers are deleted over time, so `new_customers` can't be recounted) |
| Other chart totals, CustomerInfo snapshots | Rebuilt on Standard |
| Raw store notification payloads | Only with `openpurr export --optional` (the notifications themselves move, so Apple's retries aren't processed twice) |
| Store credentials, webhook secrets, `OPERATOR_SECRET` | No. Set them on Standard yourself; they never leave the deployment. |

## Design

Decisions behind the tools, for the curious and for reviewers. The bundle format is [`spec/export-bundle.md`](../spec/export-bundle.md).

- **Export through the admin API, not wrangler.** `openpurr export` reads `/admin/v1/export`, which both editions serve, so the CLI works the same against Lite, against Standard (backups, the way back) and in tests, and needs no Cloudflare credentials, only an owner's access token. Each request reads one page of one table in primary-key order (500 rows by default), which keeps it inside a Worker's CPU limit, costs about as many D1 row reads as rows it returns, and lets a failed page be retried. Reading D1 through `wrangler d1 export` would also work, but gives SQL, needs the account's API token, and doesn't exist for Standard.
- **Import with Standard's own binary, straight into Postgres.** `openpurr migrate import` needs `DATABASE_URL`, like `openpurr admin`, so it needs no operator on Standard first (the bundle brings yours), runs in one transaction with `COPY`, and can't half-apply. Over the admin API it would need a bootstrap owner, who'd then clash with Lite's.
- **Deltas by timestamp and by ledger version.** Most tables have a timestamp that says what changed. Merges (an anonymous user logging in) move rows to another customer without one, so a delta also re-sends every row of each customer whose ledger version changed, and lists the customers that are gone. Deletions elsewhere aren't seen (see Limits).
- **Verify from the outside.** `openpurr migrate verify` asks both deployments for every customer's CustomerInfo at the same instant and compares them, then compares every chart. It uses only the API, so it checks what apps and the dashboard see, not table contents.
- **Forward mode in the Worker itself.** With the `FORWARD_TO` secret set, each Worker passes every request to Standard unchanged and returns the answer. Standard trusts the extra headers (the original address and the client IP) only with the shared `FORWARD_SECRET`. There's no DNS change and no window where both servers take writes. It costs 386 bytes of the SDK Worker's 100 KiB budget, leaving about 150 bytes.

## 1. Prerequisites

- **Your apps use your own domains.** The SDK's `proxyURL` must be your SDK Worker's custom domain (for example `https://purchases.example.com`), not `*.workers.dev`. Apps still on `workers.dev` keep working through forward mode, but only as long as Lite's Worker stays up. Store notification URLs work on either, for the same reason: forward mode passes them on.
- **The CLI, signed in as an owner who sees every app,** with an access token that has the `admin` scope (Developers → Access tokens):

  ```sh
  npx @openpurr/cli login --url https://office.example.com
  ```

  Use the back office's own address. The SDK Worker doesn't serve the export API.
- **Lite's `OPERATOR_SECRET`.** Find it where you keep secrets (Cloudflare only shows that it's set). Without it, Standard can't check passwords or authenticator codes: operators would need recovery links from `openpurr admin login-link`.
- **Your store credentials and webhook secrets:** the App Store In-App Purchase key (`.p8`), the Google service account JSON, and each webhook's signing and authorization secrets.
- **D1's daily limits.** A full export reads each row once: about as many D1 row reads as the bundle has rows. A catch-up (delta) reads about as much, because its filters scan the tables, but sends only what changed. On the free plan (5 million rows read per day), a database over about 2 million rows should export one day and catch up the next, or move to Workers Paid for the month.

## 2. Set up Standard

Follow [Standard on Google Cloud](standard-on-gcp.md), with these differences:

- **Give it its own hostname,** such as `origin.example.com`, as `domain`. Your apps' hostnames stay with Lite until the move is done.
- **Use Lite's `OPERATOR_SECRET`.** Set `generate_operator_secret = false` and store Lite's value, as that guide says under "Moving from Lite".
- **Create the store and webhook secrets** with the same names your config uses (the config itself comes with the export).
- **Add a `FORWARD_SECRET`:** at least 32 random characters, also given to Lite's Workers in step 7. Add `FORWARD_SECRET` to `secrets` in `openpurr.tfvars` and store a value:

  ```sh
  openssl rand -hex 32 | tee forward-secret.txt | gcloud secrets versions add openpurr-FORWARD_SECRET --data-file=-
  ```

- **Don't create an owner** (skip "Create the owner"): your operators come with the export.

Leave App Store Connect and Google Play alone.

## 3. Export from Lite

**From here until you finish (step 8), hold off on these in Lite's dashboard, CLI and MCP:** signing out, regenerating recovery codes, renaming keys or tokens, and editing experiments. Catch-up exports don't carry them (see [Limits](#limits)). Purchases, customers, grants, attributes, new keys and revocations all carry over, so your apps and your team can keep working as usual.


```sh
npx @openpurr/cli export --out lite-export
```

It writes a directory: `manifest.json` and one file per table. On a demo-sized deployment (26,000 customers, 9,300 purchases, 92,000 rows in all) the bundle is 20 MB and the export takes a few seconds; expect roughly a minute per million rows. If it stops, run it again into a new directory.

The bundle holds every customer, and the hashes of passwords, keys and tokens. Keep it private and delete it when you're done.

## 4. Import into Standard

The import runs Standard's binary with the database's `DATABASE_URL`. From your machine, through [cloud-sql-proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy) as in the Google Cloud guide:

```sh
cloud-sql-proxy <database_connection_name> &
docker run --rm --network host -v "$PWD/lite-export:/bundle:ro" \
  -e DATABASE_URL="postgres://openpurr:<password>@127.0.0.1:5432/openpurr?sslmode=disable" \
  ghcr.io/openpurr/openpurr-standard:<version> migrate import --bundle /bundle
```

(Or with a local build of `standard/`: `DATABASE_URL=... ./openpurr migrate import --bundle lite-export`.)

It loads everything in one transaction, continues the ID sequences after the imported IDs, then rebuilds the chart totals and every customer's CustomerInfo. The demo-sized bundle above imports in under 2 seconds and rebuilds in 3, on a laptop next to the database; through a proxy, the rebuild takes longer (`--skip-snapshots` leaves it to the server, which computes CustomerInfo on each read until its backfill job catches up).

- It refuses a database that already has customers, purchases, operators or keys. `--replace` erases them first (to start the move over).
- It imports each bundle once, and a damaged file stops it with nothing written.

Standard now has your config, so `https://origin.example.com/admin` signs you in with your Lite password, and your access token works there too.

## 5. Verify

```sh
npx @openpurr/cli migrate verify --from https://office.example.com --to https://origin.example.com
```

It compares every customer's CustomerInfo, as the SDK would get it, at the same moment on both, looks for customers on only one side, and compares every chart over all of history in production and sandbox. Your saved token works for both (`--from-token` and `--to-token` if not). The demo-sized deployment verifies in about 20 seconds.

It exits 1 on any difference and lists them. Expect differences only for customers who bought or changed something after the export started: step 6 brings them over. Inactive customers that Standard's cleanup job deleted already (nothing bought, first seen over 90 days ago) are reported but aren't differences: Lite deletes them on its next runs too.

Anything else is a bug: don't cut over, and please [open an issue](https://github.com/openpurr/openpurr/issues) with the output.

## 6. Catch up (optional)

```sh
npx @openpurr/cli export --since lite-export --out lite-delta-1
DATABASE_URL=... ./openpurr migrate import --bundle lite-delta-1
npx @openpurr/cli migrate verify --from https://office.example.com --to https://origin.example.com
```

A delta holds what changed since the bundle it follows began (with a minute of overlap). Each delta follows the previous one: `--since lite-delta-1` for the next. Run one right before cutting over, so the final delta is small.

## 7. Cut over

On both Lite Workers, set the forwarding secrets. `wrangler secret put` deploys the new secret at once; no code changes.

```sh
cd lite
npx wrangler secret put FORWARD_SECRET              # the value from step 2
npx wrangler secret put FORWARD_SECRET --env office
npx wrangler secret put FORWARD_TO                  # https://origin.example.com
npx wrangler secret put FORWARD_TO --env office
```

(Set `FORWARD_SECRET` first, so no request reaches Standard without it. If you deploy with custom Worker names, `scripts/deploy-config.mjs`, add `--name` with each Worker's name.) From then on:

- every SDK request, store notification, admin API call, MCP request and OAuth step goes to Standard and gets Standard's answer;
- Standard sees the hostname the client called (for the Pub/Sub audience, the dashboard's sign-in and MCP's OAuth issuer) and the client's IP, because the request carries the matching `FORWARD_SECRET`;
- Lite's scheduled jobs stop (Standard runs its own), and Lite writes nothing more, except the audit row of the next export;
- the dashboard's files are still served by Lite's back office, and talk to Standard through it.

Check: `npx @openpurr/cli whoami` and `npx @openpurr/cli doctor` now answer from Standard (`doctor` shows Standard's checks).

Apple and Google retry notifications for days, and the SDK retries receipt posts, so a request that fails in the seconds of the switch is delivered again rather than lost.

## 8. Import the last changes

```sh
npx @openpurr/cli export --since lite-delta-1 --out lite-final
DATABASE_URL=... ./openpurr migrate import --bundle lite-final
```

The back office keeps serving its export API from Lite's database in forward mode, so this reads what Lite wrote between your last delta and the switch. Standard has been taking writes meanwhile, so the import keeps the newer fact where it can tell: a later `updated_at`, more delivery attempts, a revocation. For customers who changed on Lite in those minutes, Lite's view of their aliases, purchase owners and grants wins.

Don't run `migrate verify` after the cutover: Lite no longer sees new purchases, so the two differ by design.

## 9. Finish

Standard is live. Lite's Workers are now a thin forwarding layer on Cloudflare, which you can keep (a free CDN and DDoS layer in front) or remove:

- **Keep it:** nothing to do. Every request still counts as a Worker request (100,000 a day on the free plan).
- **Point your hostnames at Standard directly:** remove the Workers' custom domains (Workers & Pages → the Worker → Settings → Domains & Routes) and add DNS records for those hostnames pointing at Standard's load balancer, with a certificate that covers them. Then make your SDK hostname Standard's `domain` (it sets `PUBLIC_URL`), update the SDK URL under Settings, and remove `FORWARD_SECRET`.

Keep Lite's D1 database for a while as a rollback point, then delete the Workers and the database.

## Rolling back

- **Before step 7:** nothing has changed for your apps. Delete Standard if you like.
- **After step 7:** delete `FORWARD_TO` on both Workers (`npx wrangler secret delete FORWARD_TO`, and with `--env office`). Lite answers again with the data it had at the switch. Anything written to Standard since then (new purchases, renewals) isn't in Lite's database; Lite catches up with Apple and Google through their notifications and the SDK's next posts, but webhook events and admin changes made on Standard stay there.
- **Back to Lite with Standard's data,** as long as it fits D1 (500 MB on the free plan, 10 GB on Workers Paid): export from Standard, turn the bundle into SQL, load it into a new D1 database and point the Workers at it.

  ```sh
  npx @openpurr/cli export --url https://origin.example.com --out standard-export
  npx @openpurr/cli migrate sql --bundle standard-export --out restore.sql
  cd lite
  npx wrangler d1 create openpurr-restored
  OPENPURR_D1_DATABASE_NAME=openpurr-restored node scripts/deploy-config.mjs   # plus your other OPENPURR_* settings
  npx wrangler d1 migrations apply DB --remote -c wrangler.deploy.json
  npx wrangler d1 execute DB --remote -c wrangler.deploy.json --file ../restore.sql
  npx wrangler deploy -c wrangler.deploy.json --env= && npx wrangler deploy -c wrangler.deploy.json --env office
  ```

  Then delete `FORWARD_TO` on both Workers. There are no deltas this way round: what Standard takes between the export and this switch isn't in the restored database (Lite catches up on purchases as above), so do it at a quiet time. Lite rebuilds the chart totals on its next hourly run, and the CustomerInfo snapshots with its backfill job (until then it computes CustomerInfo from the ledger on each read).

## Limits

- **A few changes don't travel in catch-up exports.** They only matter if they happen between the first export (step 3) and the last import (step 8), usually minutes to hours. If one did, here's what it means and how to fix it on Standard after you finish:

  | Change on Lite during the move | What Standard has afterwards | Fix |
  |---|---|---|
  | An operator signed out | That session still works on Standard until it expires | Sign out again on Standard, or wait for it to expire |
  | An operator regenerated recovery codes | The old codes work on Standard, the new ones don't | Regenerate them on Standard |
  | A Play acknowledgement went through | Standard acknowledges the purchase again | Nothing: Google accepts it, at most a line in the log |
  | A key or token was renamed | The old name | Rename it on Standard |
  | An experiment was edited | The version from before the edit | Make the edit again on Standard. Check this one: a running experiment decides which offering new customers see |

  Revocations (keys, tokens, grants, OAuth connections) and disabled operators do travel.
- Forward mode adds a hop: the Worker's own time (a fraction of a millisecond of CPU) plus the network between Cloudflare and Standard.
