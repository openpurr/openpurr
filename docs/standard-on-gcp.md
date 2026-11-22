# openpurr Standard on Google Cloud

This guide deploys the Standard edition (`standard/`, Go on Postgres) to Google Cloud with the
OpenTofu module in [`infra/gcp`](../infra/gcp):

- **Cloud Run** runs the server: the SDK API, store notifications, the dashboard, the admin API, MCP
  and the background jobs, from one container.
- **Cloud SQL for Postgres** holds the data, with daily backups, point-in-time recovery and
  deletion protection. Only a Cloud SQL connector can reach it.
- **Secret Manager** holds `DATABASE_URL`, `OPERATOR_SECRET` and the secrets your config names.
- **A global load balancer** serves your own domain with a Google-managed certificate.
- Optionally, **Identity-Aware Proxy** in front of the dashboard, and **Pub/Sub** delivering Google
  Play notifications.

Standard isn't ready for production yet (see `standard/README.md`, "Not implemented yet"). Try
this on a test project first.

## Before you start

- A Google Cloud project with billing turned on, and an account that can create resources in it
  (Owner, or Editor plus Security Admin and Secret Manager Admin).
- The [gcloud CLI](https://cloud.google.com/sdk/docs/install), signed in to that account:
  `gcloud auth login` and `gcloud auth application-default login`.
- [OpenTofu](https://opentofu.org) 1.11 or later (or Terraform 1.11 or later).
- A domain you control, such as `purchases.example.com`. **The domain is the contract:** apps, App
  Store Connect and Google Play keep whatever address you give them, so with your own domain you
  can move hosts later (from Lite, between clouds) without an app update. A `*.run.app` address
  works for a test, not for apps you ship.
- The image version to run, such as `ghcr.io/openpurr/openpurr-standard:0.3.0` (see the
  [releases](https://github.com/openpurr/openpurr/releases)). Pin a version; `latest` makes
  upgrades happen by accident.

## 1. Set up the module

Copy the module somewhere you keep infrastructure, and keep its state in a bucket rather than on
your laptop:

```sh
cp -r infra/gcp ~/openpurr-infra && cd ~/openpurr-infra
gcloud storage buckets create gs://my-project-tofu-state --location=us-central1 --uniform-bucket-level-access
gcloud storage buckets update gs://my-project-tofu-state --versioning
cat > backend.tf <<'EOF'
terraform {
  backend "gcs" {
    bucket = "my-project-tofu-state"
    prefix = "openpurr"
  }
}
EOF
cp examples/example.tfvars openpurr.tfvars
```

Edit `openpurr.tfvars`: `project_id`, `region`, `image`, `domain`, and `secrets`, the names of the
secrets your config uses (`APPLE_IAP_KEY` for the App Store Server API key, `GOOGLE_SERVICE_ACCOUNT`
for the Play Developer API key, webhook secrets). `variables.tf` describes every setting. To import
a config file on the first start, set `config_file`; otherwise you write the config on the
dashboard.

Or let the server's binary ask the questions and write the file: `openpurr setup gcp --config
openpurr.config.yaml` (or, with Docker, `docker run --rm -it --user "$(id -u):$(id -g)" -v "$PWD:/work" -w /work
ghcr.io/openpurr/openpurr-standard:0.3.0 setup gcp`). With `--config` it checks the config and
fills in the secrets it names. It only writes `openpurr.tfvars`; it doesn't touch Google Cloud.

Generated passwords never enter the state: the database password and `OPERATOR_SECRET` come from
ephemeral resources and reach Google through write-only attributes.

## 2. Create the secrets, then everything else

Cloud Run won't start a service whose secrets are empty, so create the secrets first, fill them,
then apply the rest:

```sh
tofu init
tofu apply -var-file=openpurr.tfvars -target=google_secret_manager_secret.store

gcloud secrets versions add openpurr-APPLE_IAP_KEY --data-file=AuthKey_ABC123.p8
gcloud secrets versions add openpurr-GOOGLE_SERVICE_ACCOUNT --data-file=play-service-account.json
printf '%s' 'the webhook secret' | gcloud secrets versions add openpurr-WEBHOOK_SIGNING_SECRET --data-file=-

tofu apply -var-file=openpurr.tfvars
```

Secrets are named `<name>-<SECRET>` (`name` defaults to `openpurr`). Moving from Lite? Set
`generate_operator_secret = false`, add `google_secret_manager_secret.operator_secret` to the
first `-target` apply, and add Lite's `OPERATOR_SECRET` as its value, so passwords and
authenticators keep working. The rest of the move (export, import, verify, cutover) is in
[Moving from Lite to Standard](migrating-from-lite-to-standard.md).

The full apply takes about 15 minutes, most of it Cloud SQL. It prints the outputs, including
`load_balancer_ip`.

## 3. Point the domain at it

Add an `A` record for your domain with `load_balancer_ip`. Google issues the certificate once the
record resolves, which can take up to an hour; until then HTTPS fails. Check with:

```sh
gcloud compute ssl-certificates describe openpurr-cert --global --format='value(managed.status)'
```

`ACTIVE` means it's ready. Then `https://purchases.example.com/healthz` answers `{"status":"ok"}`.

## 4. Create the owner

The `openpurr-admin` Cloud Run job runs `openpurr admin ...` with the server's image and database
access:

```sh
gcloud run jobs execute openpurr-admin --region us-central1 --wait \
  --args=admin,create,--email,you@example.com
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="openpurr-admin"' \
  --freshness=10m --format='value(textPayload)'
```

The log has a setup link, valid for 24 hours and once. Open it, set a password, and turn on
two-step sign-in under Your account. The link stays in the job's logs until they expire, which
is one reason it works only once. `--args=admin,login-link,--email,you@example.com` prints a
15-minute recovery link the same way, for a lost password or authenticator.

From your own machine instead, through [cloud-sql-proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy):
run `cloud-sql-proxy <database_connection_name>`, read the password from the `openpurr-DATABASE_URL`
secret, and run `openpurr admin ...` with
`DATABASE_URL=postgres://openpurr:<password>@127.0.0.1:5432/openpurr?sslmode=disable` (the proxy encrypts the connection itself).

## 5. Connect your apps and the stores

On the dashboard (`https://purchases.example.com/admin`):

- **Settings → SDK URL:** `https://purchases.example.com`. **Setup checks** then show what's left.
- In each app, set the SDK's `proxyURL` to that URL (the dashboard's setup code shows how).

App Store Connect, for each app (App Information → App Store Server Notifications, Version 2,
both production and sandbox): `https://purchases.example.com/notifications/apple` (the
`apple_notification_url` output).

Google Play, with `google_play_rtdn = true`:

1. Play Console → your app → Monetization setup → Real-time developer notifications: the topic is
   the `google_play_rtdn_topic` output. Send a test notification.
2. In the config, each Android app's `google_play_api` gets `pubsub_push_account` from the
   `google_play_config` output. Its `pubsub_audience` is the default, so leave it out.
3. Give the Play service account in `GOOGLE_SERVICE_ACCOUNT` access in Play Console (Users and
   permissions) to view financial data and manage orders.

## Sign-in through Identity-Aware Proxy (optional)

With `iap_members = ["user:you@example.com", "group:ops@example.com"]`, the module puts
[IAP](https://cloud.google.com/iap/docs) in front of `/admin` on the load balancer and gives the
server `IAP_AUDIENCE`. Then:

- Opening the dashboard asks for a Google sign-in first. Only the members listed get through.
- A member whose Google email matches an active operator is signed in as that operator, with
  that operator's role; there's no openpurr password prompt. Others see openpurr's sign-in page,
  and password sign-in works as before, behind IAP.
- The server checks IAP's signed assertion on every request. It never trusts the header alone.
- The SDK API, store notifications, MCP and OAuth don't go through IAP: devices, stores and MCP
  clients can't sign in to Google. Neither does the admin API with a personal access token
  (`Authorization: Bearer pat_...`), so the CLI works unchanged.
- **Two-step sign-in** for IAP sign-ins is the Google account's. openpurr's "require two-step
  sign-in" setting applies to password sign-in only, so enforce 2-Step Verification for these
  accounts in the Google Workspace or Cloud Identity admin console.
- By default IAP uses a Google-managed OAuth client, which only admits accounts in your Google
  Workspace or Cloud Identity organization. To admit others (personal Gmail accounts), create an
  OAuth client and set `iap_oauth_client_id` and, through `TF_VAR_iap_oauth_client_secret`, its
  secret.
- To sign out of IAP, open `https://purchases.example.com/admin?gcp-iap-mode=CLEAR_LOGIN_COOKIE`.
- The dashboard's Setup checks include an Identity-Aware Proxy check that says whether your
  request's assertion passed and, if not, why (usually the audience).

If IAP is misconfigured, you aren't locked out: the owner can always fix the IAP members in
Google Cloud, and `openpurr admin login-link` still works.

## Upgrades

Read the release notes, change `image` to the new version, and `tofu apply`. Cloud Run starts the
new revision, which applies any database migrations at startup (replicas take turns under a lock),
and moves traffic once `/healthz` answers. Roll back by applying the previous `image`, as long as
the release notes don't say its migrations can't be undone.

## Backups and restores

- Cloud SQL takes a daily backup (kept 14 days, `db_backup_retention`) and keeps 7 days of
  transaction logs for point-in-time recovery. Deletion protection is on for the instance and
  the service.
- To recover from a mistake, clone the instance to a moment before it, check the clone, then point
  the server at it or copy the data back:
  `gcloud sql instances clone openpurr openpurr-restored --point-in-time=2026-11-20T09:00:00Z`.
- For a copy you keep outside Google Cloud: `gcloud sql export sql openpurr gs://<bucket>/openpurr.sql.gz --database=openpurr`.
- `OPERATOR_SECRET` isn't in the database. Without it, passwords and authenticators stop working
  (recover with `openpurr admin login-link`), so don't delete its secret.

## How it runs

- **At least one instance, CPU always on.** The background jobs (webhook retries, cleanups,
  exchange rates, the charts' rollup) and the work after a response (first webhook attempts,
  snapshot rebuilds) run inside the server, so `min_instances = 1` with instance-based billing.
  More replicas are safe: jobs run once per slot across all of them.
- **Connections.** Each instance opens up to `db_pool_size` (5) connections. Keep
  `max_instances × db_pool_size` plus a few for the admin job under the database's limit: 25 on
  `db-f1-micro`, 50 on `db-g1-small`, more on dedicated tiers.
- **Shutdown.** Cloud Run gives a container 10 seconds after SIGTERM; the server stops within 8.
  Webhook attempts cut short are retried by the next run of the job.
- **Client addresses.** The load balancer sets `X-Client-IP`, which the server uses for rate limits
  and the audit log; Cloud Run only accepts traffic from the load balancer, so it can't be forged.
  Without a domain, the server takes the last `X-Forwarded-For` entry (`CLIENT_IP_HOPS=1`), the one
  Google's front end adds.
- **Logs** are JSON lines with Cloud Logging's `severity` and `message`, so Logs Explorer shows
  levels. Cloud Run also logs every request.
- **Health check.** The startup probe calls `/healthz`. Cloud Run's own front end reserves some
  paths ending in `z`, so `/healthz` on a `*.run.app` address may answer with Google's 404; through
  the load balancer it works.

## Costs

A ballpark for the defaults in `us-central1`, on-demand, before free tiers and sustained-use
discounts. Prices change; check the [pricing calculator](https://cloud.google.com/products/calculator).
Rates below were checked on 2026-11-22.

| Part | Setting | About per month |
|---|---|---|
| Cloud Run | 1 instance, 1 vCPU, 512 MiB, CPU always on (about $0.000018 per vCPU-second and $0.000002 per GiB-second, instance-based billing) | $45–50 |
| Cloud SQL | `db-g1-small` (shared core, 1.7 GB); `db-f1-micro` is about $8 | $26 |
| Cloud SQL storage and backups | 10 GB SSD, backups | $2–4 |
| Load balancer | Up to 5 forwarding rules, about $0.025 an hour, plus data processed | $18 |
| Secret Manager, Pub/Sub, Artifact Registry | A few secrets, low message volumes, one image | under $1 |
| **Total** | | **about $90** |

`db-f1-micro` and `db-g1-small` are shared-core machines, which Google's SLA doesn't cover; a
dedicated `db-custom-1-3840` costs roughly twice `db-g1-small`, and `db_high_availability`
doubles the database's cost. Leaving out the domain saves the load balancer, but the `*.run.app`
address then becomes part of every app you ship.

Sources: [Cloud Run pricing](https://cloud.google.com/run/pricing),
[Cloud SQL pricing](https://cloud.google.com/sql/pricing),
[Cloud Load Balancing pricing](https://cloud.google.com/vpc/network-pricing#lb),
[Secret Manager pricing](https://cloud.google.com/secret-manager/pricing), and Bytebase's
[Cloud SQL price list](https://www.bytebase.com/dbcost/cloudsql-pricing/) for the shared-core
machines.

## Trying it without a domain

Leave `domain` empty: there's no load balancer, Cloud Run takes traffic on its `*.run.app`
address (the `url` output), and IAP isn't available. Fine for a test; for apps you ship, add the
domain before the first release, since apps keep the address they were built with.

## Tearing down

Deletion protection stops `tofu destroy` from removing the database and the service. For a test
deployment, set `deletion_protection = false`, apply, then `tofu destroy`. Cloud SQL keeps no
backups after the instance is deleted, so export first if you need the data.
