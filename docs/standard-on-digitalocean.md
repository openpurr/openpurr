# openpurr Standard on DigitalOcean

This guide deploys the Standard edition (`standard/`, Go on Postgres) to DigitalOcean with the
OpenTofu module in [`infra/digitalocean`](../infra/digitalocean):

- **App Platform** runs the server from the container image: the SDK API, store notifications,
  the dashboard, the admin API, MCP and the background jobs, from one container. It serves your
  own domain with a certificate it issues and renews.
- **Managed PostgreSQL** holds the data, with daily backups and point-in-time recovery. Only the
  app (and addresses you list) can connect.
- Secrets are **encrypted App Platform environment variables**.

It's usually the cheapest of the three clouds (see [Costs](#costs)). Standard isn't ready for
production yet (see `standard/README.md`, "Not implemented yet"). Try this on a test deployment
first.

Prefer the control panel to OpenTofu? [`infra/digitalocean/app.yaml.example`](../infra/digitalocean/app.yaml.example)
is the same app as a plain App Platform spec; the steps below apply with the control panel in
place of `tofu apply`.

## Before you start

- A DigitalOcean account and a [personal access token](https://docs.digitalocean.com/reference/api/create-personal-access-token/)
  with write scope, in `DIGITALOCEAN_TOKEN` (never in a file in the module).
- [OpenTofu](https://opentofu.org) 1.7 or later (or Terraform 1.7 or later). `doctl` is handy but
  not needed.
- A domain you control, such as `purchases.example.com`. **The domain is the contract:** apps, App
  Store Connect and Google Play keep whatever address you give them, so with your own domain you
  can move hosts later (from Lite, between clouds) without an app update. An
  `*.ondigitalocean.app` address works for a test, not for apps you ship.
- The image version to run, such as `ghcr.io/openpurr/openpurr-standard:0.4.0` (see the
  [releases](https://github.com/openpurr/openpurr/releases)). App Platform pulls public GitHub
  Container Registry images directly, with no credentials and no copy in your own registry. Pin a
  version: App Platform doesn't redeploy when a GHCR tag moves, and `latest` would make the version
  depend on when an instance last started.

## 1. Set up the module

Copy the module somewhere you keep infrastructure, and keep its state in a private bucket rather
than on your laptop (a [Spaces](https://docs.digitalocean.com/products/spaces/) bucket through
OpenTofu's `s3` backend works):

```sh
cp -r infra/digitalocean ~/openpurr-infra && cd ~/openpurr-infra
cp examples/example.tfvars openpurr.tfvars
```

Edit `openpurr.tfvars`: `region` (a datacenter such as `nyc3`, `ams3` or `fra1`; the app runs in
the matching App Platform region), `image`, `domain`, and `secrets`, the names of the secrets your
config uses (`APPLE_IAP_KEY` for the App Store Server API key, `GOOGLE_SERVICE_ACCOUNT` for the
Play Developer API key, webhook secrets). List them all now: the module creates them only with
the app. `variables.tf` describes every setting.

App Platform can't mount a file, so there's no `OPENPURR_CONFIG` here: write the config on the
dashboard after the first sign-in.

## 2. Apply

```sh
export DIGITALOCEAN_TOKEN=...
tofu init
tofu apply -var-file=openpurr.tfvars
```

It takes 10 to 15 minutes, most of it the database. The app's first deployment waits for
`/healthz`, which answers once the server has applied its migrations.

### What OpenTofu keeps, and what it doesn't

App Platform encrypts a secret variable when it's submitted and afterwards hands back only the
ciphertext (`EV[...]`); the DigitalOcean provider has no write-only way to send one. So:

- **`DATABASE_URL`** is built from the attached database's [bindable variables](https://docs.digitalocean.com/products/app-platform/how-to/use-environment-variables/)
  (`postgresql://${db.USERNAME}:${db.PASSWORD}@${db.HOSTNAME}:${db.PORT}/${db.DATABASE}?sslmode=require`),
  which App Platform fills in when the server starts. The password never passes through OpenTofu.
- **Your secrets** are created empty and encrypted, and the module ignores the app-level
  variables after the app exists: what you set in the control panel stays, and the state holds
  only ciphertext.
- **`OPERATOR_SECRET`** is generated (in `random_password.operator_secret`, so it is in the state)
  and set when the app is created. To keep it out of the state, set
  `generate_operator_secret = false` and fill it yourself like the other secrets.
- The **database cluster** resource exports its admin password and connection URIs, and the
  provider keeps them in the state (marked sensitive). That can't be avoided while OpenTofu
  manages the cluster, which is the main reason to keep the state private.

## 3. Fill the secrets

In the control panel: Apps → `openpurr` → Settings → App-Level Environment Variables → Edit. For
each name in the `secrets_to_fill` output, paste the value (the `.p8` file's contents for
`APPLE_IAP_KEY`, the JSON key for `GOOGLE_SERVICE_ACCOUNT`), keep **Encrypt** on, and save. App
Platform redeploys with them. Rotating a secret is the same.

Secrets you add later (a new webhook's signing secret) go here too: the module only creates the
names it was given when the app was created. Empty secrets count as not set, and the dashboard's
Setup checks say which are missing.

Moving from Lite? Set `generate_operator_secret = false` before the first apply and fill
`OPERATOR_SECRET` with Lite's value, so passwords and authenticators keep working; add
`FORWARD_SECRET` to `secrets` for the cutover. The rest of the move (export, import, verify,
cutover) is in [Moving from Lite to Standard](migrating-from-lite-to-standard.md); run
`openpurr migrate import` from your machine as in step 5's second option.

## 4. Point the domain at it

Add a `CNAME` record for your domain with the `default_ingress` output (`openpurr-xxxxx.ondigitalocean.app`).
If the domain's DNS is on DigitalOcean, set `dns_zone` instead and App Platform adds the record.
App Platform issues the certificate once the record resolves, usually within minutes; the app's
Settings → Domains shows its status, and the `DOMAIN_FAILED` alert fires if it fails. Then
`https://purchases.example.com/healthz` answers `{"status":"ok"}`.

## 5. Create the owner

The image is distroless (no shell), so App Platform's console can't run `openpurr admin`. Two ways:

**A one-off job.** Set `admin_command` and apply:

```hcl
admin_command = "admin create --email you@example.com"
```

App Platform deploys again and then runs the `admin` job once, with the server's image and
database. Its output is in the app's logs for the `admin` component (Activity → Jobs, or Runtime
Logs). It has a setup link, valid for 24 hours and once: open it, set a password, and turn on
two-step sign-in under Your account. Then set `admin_command = ""` and apply again, so later
deployments don't run it. `admin login-link --email you@example.com` prints a 15-minute recovery
link the same way, for a lost password or authenticator.

**From your machine.** Add your address to `db_trusted_ips` and apply. Copy the connection string
from Databases → `openpurr` → Connection details (user `doadmin`, database `openpurr`), then:

```sh
docker run --rm -e DATABASE_URL='postgresql://doadmin:<password>@<host>:25060/openpurr?sslmode=require' \
  ghcr.io/openpurr/openpurr-standard:0.4.0 admin create --email you@example.com --url https://purchases.example.com
```

Remove your address from `db_trusted_ips` when you're done.

## 6. Connect your apps and the stores

On the dashboard (`https://purchases.example.com/admin`, the `back_office_url` output):

- **Settings → SDK URL:** `https://purchases.example.com` (the `url` output). **Setup checks** then
  show what's left.
- In each app, set the SDK's `proxyURL` to that URL (the dashboard's setup code shows how).

App Store Connect, for each app (App Information → App Store Server Notifications, Version 2,
both production and sandbox): `https://purchases.example.com/notifications/apple` (the
`apple_notification_url` output).

Google Play publishes Real-time Developer Notifications to a Pub/Sub topic in Google Cloud, so
that part lives in the Google Cloud project your Play service account is in, with a push
subscription to this server:

```sh
gcloud pubsub topics create play-rtdn
gcloud pubsub topics add-iam-policy-binding play-rtdn --role=roles/pubsub.publisher \
  --member=serviceAccount:google-play-developer-notifications@system.gserviceaccount.com
gcloud iam service-accounts create openpurr-rtdn-push --display-name="openpurr Play notifications push"
gcloud pubsub subscriptions create play-rtdn-push --topic=play-rtdn \
  --push-endpoint=https://purchases.example.com/notifications/google \
  --push-auth-service-account=openpurr-rtdn-push@<gcp-project>.iam.gserviceaccount.com \
  --ack-deadline=60 --message-retention-duration=7d --expiration-period=never \
  --min-retry-delay=10s --max-retry-delay=600s
```

The push endpoint is the `google_notification_url` output. Pub/Sub signs each push with a
Google OIDC token for that service account, with the endpoint as its audience, which is what
openpurr checks by default. Then:

1. Play Console → your app → Monetization setup → Real-time developer notifications: the topic is
   `projects/<gcp-project>/topics/play-rtdn`. Send a test notification.
2. In the config, each Android app's `google_play_api` gets
   `pubsub_push_account: openpurr-rtdn-push@<gcp-project>.iam.gserviceaccount.com`. Its
   `pubsub_audience` is the default, so leave it out.
3. Give the Play service account in `GOOGLE_SERVICE_ACCOUNT` access in Play Console (Users and
   permissions) to view financial data and manage orders.

## Upgrades

Read the release notes, change `image` to the new version, and `tofu apply`. App Platform starts
new instances, which apply any database migrations at startup (replicas take turns under a
lock), moves traffic once they pass the `/healthz` check, and drains and stops the old ones. A
deployment that fails its health check doesn't go live, and the `DEPLOYMENT_FAILED` alert fires. Roll back by
applying the previous `image` (or Activity → a previous deployment → Rollback), as long as the
release notes don't say its migrations can't be undone.

## Backups and restores

- DigitalOcean backs the cluster up daily and keeps backups for 7 days, with point-in-time
  recovery to any moment in those 7 days, included in the price.
- A restore always makes a new cluster: Databases → `openpurr` → Actions → Restore from backup,
  pick the moment, and check the new cluster. Then copy what you need back into the `openpurr`
  cluster (`pg_dump` from the restored one, `pg_restore` into it, from your machine with your
  address in both clusters' trusted sources), so the module keeps managing the same cluster.
- For a copy you keep elsewhere: `pg_dump` from your machine with your address in
  `db_trusted_ips`, using the connection string from step 5.
- There's no deletion protection on a cluster, and its backups go with it: `tofu destroy` deletes
  the database. Dump it first.
- `OPERATOR_SECRET` isn't in the database. Without it, passwords and authenticators stop working
  (recover with `openpurr admin login-link`), so keep a copy somewhere safe.

## How it runs

- **At least one instance, always.** The background jobs (webhook retries, cleanups, exchange
  rates, the charts' rollup) run inside the server. App Platform services run continuously; don't
  turn on any sleep-when-idle setting, or the jobs stop with the traffic. More instances are
  safe (jobs run once per slot across all of them), and need `apps-s-1vcpu-1gb` or larger:
  `apps-s-1vcpu-0.5gb` and `apps-s-1vcpu-1gb-fixed` run one instance only.
- **Connections.** Each instance opens up to `db_pool_size` (5) connections, and the admin job 2.
  The cluster allows 22 on `db-s-1vcpu-1gb`, 47 on `db-s-1vcpu-2gb` and 97 on `db-s-2vcpu-4gb`; the
  module refuses an `instance_count × db_pool_size` that leaves fewer than 5 spare.
- **No PgBouncer pool.** DigitalOcean offers PgBouncer connection pools, but the job loop and the
  migrations hold session-level advisory locks on one connection. A transaction-mode pool hands
  that connection to other clients between transactions, which would break the locks; a
  session-mode pool would work but saves nothing over the server's own pool at this scale. The
  server connects to the cluster directly.
- **TLS.** `DATABASE_URL` has `sslmode=require` (and DigitalOcean refuses plain connections): the
  connection is encrypted, but the server doesn't check the cluster's certificate against its CA,
  since the image has no file to read it from. Trusted sources limit who can connect at all.
- **Shutdown.** App Platform stops sending an instance new requests, waits 15 seconds
  (`drain_seconds`), sends SIGTERM, and kills it `shutdown_grace_seconds` (30) later. The server is
  told to finish within 5 seconds less (`SHUTDOWN_TIMEOUT_SECONDS=25`); webhook attempts cut short
  are retried by the next run of the job.
- **Client addresses.** App Platform's edge puts the client's address in the
  [`do-connecting-ip` header](https://docs.digitalocean.com/support/where-can-i-find-the-client-ip-address-of-a-request-connecting-to-my-app/),
  which the server uses for rate limits and the audit log (`CLIENT_IP_HEADER=do-connecting-ip`).
  `X-Forwarded-For` holds the edge's own address instead.
- **The edge.** App Platform serves apps through a CDN. The module turns off its edge cache (every
  response here is dynamic) and its email obfuscation, which rewrites email addresses in HTML.
- **Logs** are JSON lines (`LOG_FORMAT=json`, slog's `level` and `msg`), in the app's Runtime Logs.
  Forwarding them elsewhere (App Platform's log destinations) isn't set up.
- **Health check.** App Platform calls `/healthz` every 5 seconds and takes an instance out of
  rotation after 3 minutes of failures, which leaves room for migrations at startup.

## Costs

A ballpark for the defaults, before taxes. Prices change; check DigitalOcean's pricing pages.
Rates below were checked on 2026-11-22.

| Part | Setting | Per month |
|---|---|---|
| App Platform | 1 instance, `apps-s-1vcpu-1gb` (1 shared vCPU, 1 GiB, 150 GiB outbound included) | $12 |
| Managed PostgreSQL | `db-s-1vcpu-1gb`, one node, 10 GiB storage, daily backups and point-in-time recovery | $15 |
| Domain, certificate, edge | Included with App Platform | $0 |
| **Total** | | **about $27** |

Variations: `apps-s-1vcpu-0.5gb` ($5) brings it to about $20 but can't run a second instance; a
standby needs the 2 GiB size ($30) plus a matching $30 standby, so about $72 with the app.
Outbound traffic over the included amount is $0.02 per GiB, and extra database storage $0.215
per GiB.

For comparison, the [Google Cloud guide](standard-on-gcp.md#costs)'s defaults come to about $90 a
month, most of it Cloud Run with CPU always on and the load balancer that serves the domain;
here the domain and certificate come with App Platform and the smallest database is a dedicated
node rather than a shared core.

Sources: [App Platform pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/),
[Managed PostgreSQL pricing](https://docs.digitalocean.com/products/databases/postgresql/details/pricing/)
and [limits](https://docs.digitalocean.com/products/databases/postgresql/details/limits/),
[backups](https://docs.digitalocean.com/products/databases/postgresql/how-to/restore-from-backups/).

DigitalOcean has announced that from 30 November 2026, new Standard-edition database clusters
can't add standby nodes or use sizes above 4 GiB, which move to its Advanced edition (from $130 a
month). The module doesn't choose an edition; check the
[pricing page](https://docs.digitalocean.com/products/databases/postgresql/details/pricing/)
before turning on `db_standby`.

## What isn't covered

- **A sign-in proxy.** App Platform has nothing like Google's Identity-Aware Proxy, so operators
  sign in with openpurr's own password and two-step sign-in (require it for everyone with
  `openpurr admin require-totp on`). To put an identity provider in front of `/admin`, put the domain behind one, such
  as Cloudflare Access, and keep the SDK, notification, MCP and OAuth paths open.
- **Private networking.** The server reaches the database on its public address, with TLS and
  trusted sources. App Platform can join a VPC and use `${db.DATABASE_PRIVATE_URL}`; the module
  doesn't set that up.
- **Autoscaling.** `instance_count` is fixed; App Platform autoscales only dedicated-CPU sizes.
- **Pub/Sub** for Google Play, which lives in Google Cloud (step 6).
- **A setup command.** There's no `openpurr setup digitalocean` yet; copy
  `examples/example.tfvars`.

## Trying it without a domain

Leave `domain` empty: the server answers on its `*.ondigitalocean.app` address (the `url`
output), and `PUBLIC_URL` is that address. Fine for a test; for apps you ship, add the domain
before the first release, since apps keep the address they were built with.

## Tearing down

`tofu destroy` deletes the app and the database cluster, and the cluster's backups with it.
Dump the database first if you need the data.
