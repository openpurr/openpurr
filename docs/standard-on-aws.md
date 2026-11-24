# openpurr Standard on AWS

This guide deploys the Standard edition (`standard/`, Go on Postgres) to AWS with the OpenTofu
module in [`infra/aws`](../infra/aws):

- **ECS on Fargate** runs the server: the SDK API, store notifications, the dashboard, the admin
  API, MCP and the background jobs, from one container (arm64 by default).
- **RDS for PostgreSQL** holds the data in private subnets, encrypted, with TLS required,
  automated backups, point-in-time recovery and deletion protection. RDS generates and rotates
  the password and keeps it in Secrets Manager.
- **Secrets Manager** holds `OPERATOR_SECRET` and the secrets your config names.
- **An Application Load Balancer** serves your own domain with an ACM certificate.
- **A VPC** with public and private subnets in two Availability Zones (or your own).

Standard isn't ready for production yet (see `standard/README.md`, "Not implemented yet"). Try
this in a test account first.

## Before you start

- An AWS account, and credentials for it in your shell that can create VPC, ECS, RDS, ELB, ACM,
  Secrets Manager, IAM, CloudWatch Logs, EventBridge and Step Functions resources
  (AdministratorAccess in a dedicated account is simplest).
- The [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) v2.
- [OpenTofu](https://opentofu.org) 1.11 or later (or Terraform 1.11 or later).
- A domain you control, such as `purchases.example.com`. **The domain is the contract:** apps, App
  Store Connect and Google Play keep whatever address you give them, so with your own domain you
  can move hosts later (from Lite, between clouds) without an app update. The module requires one.
- The image version to run, such as `ghcr.io/openpurr/openpurr-standard:0.4.0` (see the
  [releases](https://github.com/openpurr/openpurr/releases)). Pin a version; `latest` makes
  upgrades happen by accident.

## 1. Set up the module

Copy the module somewhere you keep infrastructure, and keep its state in an S3 bucket rather than
on your laptop:

```sh
cp -r infra/aws ~/openpurr-infra && cd ~/openpurr-infra
aws s3api create-bucket --bucket my-openpurr-tofu-state --region us-east-1
aws s3api put-bucket-versioning --bucket my-openpurr-tofu-state --versioning-configuration Status=Enabled
cat > backend.tf <<'EOF'
terraform {
  backend "s3" {
    bucket       = "my-openpurr-tofu-state"
    key          = "openpurr/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
  }
}
EOF
cp examples/example.tfvars openpurr.tfvars
```

Edit `openpurr.tfvars`: `region`, `image`, `domain`, and `secrets`, the names of the secrets your
config uses (`APPLE_IAP_KEY` for the App Store Server API key, `GOOGLE_SERVICE_ACCOUNT` for the
Play Developer API key, webhook secrets). If a Route 53 hosted zone holds the domain, set
`route53_zone_id` and the module adds the DNS records itself. `variables.tf` describes every
setting. To import a config file on the first start, set `config_file`; otherwise you write the
config on the dashboard.

Generated passwords never enter the state: RDS keeps the database password in a secret of its own,
and `OPERATOR_SECRET` comes from an ephemeral resource and reaches Secrets Manager write-only.

## 2. Create the secrets and the certificate, then everything else

ECS won't start a task whose secrets are empty, and the load balancer can't use a certificate ACM
hasn't issued yet, so create those first:

```sh
tofu init
tofu apply -var-file=openpurr.tfvars \
  -target=aws_secretsmanager_secret.store -target=aws_acm_certificate.server

aws secretsmanager put-secret-value --secret-id openpurr/APPLE_IAP_KEY --secret-string file://AuthKey_ABC123.p8
aws secretsmanager put-secret-value --secret-id openpurr/GOOGLE_SERVICE_ACCOUNT --secret-string file://play-service-account.json
aws secretsmanager put-secret-value --secret-id openpurr/WEBHOOK_SIGNING_SECRET --secret-string 'the webhook secret'

tofu state show aws_acm_certificate.server   # domain_validation_options: the record to add
```

Without `route53_zone_id`, add the `CNAME` record from `domain_validation_options` at your DNS
provider. It only proves you own the domain; the domain itself can keep pointing where it does
(at Lite, say) until you cut over. Then apply the rest:

```sh
tofu apply -var-file=openpurr.tfvars
```

Secrets are named `<name>/<SECRET>` (`name` defaults to `openpurr`). Moving from Lite? Set
`generate_operator_secret = false`, add `-target=aws_secretsmanager_secret.operator_secret` to the
first apply, and put Lite's `OPERATOR_SECRET` in `openpurr/OPERATOR_SECRET`, so passwords and
authenticators keep working. The rest of the move (export, import, verify, cutover) is in
[Moving from Lite to Standard](migrating-from-lite-to-standard.md).

The full apply takes 15 to 20 minutes, most of it RDS, and waits for ACM to issue the certificate
(minutes once the validation record resolves). It prints the outputs, including
`load_balancer_dns_name`.

## 3. Point the domain at it

With `route53_zone_id`, the module has already added an alias record. Otherwise add a `CNAME`
for your domain with `load_balancer_dns_name` (at a zone apex, use your provider's `ALIAS` or
`ANAME` record). Then `https://purchases.example.com/healthz` answers `{"status":"ok"}`, and
`http://` redirects to `https://`.

## 4. Create the owner

The `openpurr-admin` task definition runs `openpurr admin ...` with the server's image and
database access. The `admin_task_command` output is the full `aws ecs run-task` command, with the
right subnets and security group; change the command in `--overrides`:

```sh
aws ecs run-task --region us-east-1 --cluster openpurr --task-definition openpurr-admin \
  --launch-type FARGATE \
  --network-configuration 'awsvpcConfiguration={subnets=[subnet-...,subnet-...],securityGroups=[sg-...],assignPublicIp=DISABLED}' \
  --overrides '{"containerOverrides":[{"name":"openpurr","command":["admin","create","--email","you@example.com"]}]}'
# about a minute later (admin_logs_command):
aws logs tail /ecs/openpurr --region us-east-1 --log-stream-name-prefix admin/ --since 10m
```

The log has a setup link, valid for 24 hours and once. Open it, set a password, and turn on
two-step sign-in under Your account. The link stays in the logs until they expire
(`log_retention_days`), which is one reason it works only once.
`["admin","login-link","--email","you@example.com"]` prints a 15-minute recovery link the same
way, for a lost password or authenticator.

The database is only reachable from inside the VPC, so `openpurr admin` and
`openpurr migrate import` don't run from your laptop as they do with cloud-sql-proxy on Google
Cloud. For the import when moving from Lite, use a machine in the VPC (an EC2 instance you reach
with Session Manager, allowed in by the database's security group); the module doesn't create one.

## 5. Connect your apps and the stores

On the dashboard (`https://purchases.example.com/admin`):

- **Settings → SDK URL:** `https://purchases.example.com`. **Setup checks** then show what's left.
- In each app, set the SDK's `proxyURL` to that URL (the dashboard's setup code shows how).

App Store Connect, for each app (App Information → App Store Server Notifications, Version 2,
both production and sandbox): `https://purchases.example.com/notifications/apple` (the
`apple_notification_url` output).

Google Play sends notifications through Google Cloud Pub/Sub, so this part is in a Google Cloud
project (any project; the Play Console links to one), not in AWS:

```sh
gcloud pubsub topics create openpurr-play-rtdn
gcloud pubsub topics add-iam-policy-binding openpurr-play-rtdn \
  --member=serviceAccount:google-play-developer-notifications@system.gserviceaccount.com \
  --role=roles/pubsub.publisher
gcloud iam service-accounts create openpurr-rtdn-push   # the identity push tokens are signed as
gcloud pubsub subscriptions create openpurr-play-rtdn-push --topic=openpurr-play-rtdn \
  --push-endpoint=https://purchases.example.com/notifications/google \
  --push-auth-service-account=openpurr-rtdn-push@<project>.iam.gserviceaccount.com \
  --ack-deadline=60 --message-retention-duration=7d --expiration-period=never \
  --min-retry-delay=10s --max-retry-delay=600s
```

In projects made before April 2021, also let Pub/Sub sign tokens for that account: grant
`roles/iam.serviceAccountTokenCreator` on it to
`service-<project number>@gcp-sa-pubsub.iam.gserviceaccount.com`.

Then:

1. Play Console → your app → Monetization setup → Real-time developer notifications: the topic is
   `projects/<project>/topics/openpurr-play-rtdn`. Send a test notification.
2. In the config, each Android app's `google_play_api` gets
   `pubsub_push_account: openpurr-rtdn-push@<project>.iam.gserviceaccount.com`. The audience is
   the push endpoint, the default, so leave `pubsub_audience` out.
3. Give the Play service account in `GOOGLE_SERVICE_ACCOUNT` access in Play Console (Users and
   permissions) to view financial data and manage orders.

## Sign-in through the load balancer: not yet

On Google Cloud, Identity-Aware Proxy can sign operators in before the dashboard. The AWS
counterpart is the load balancer's OIDC or Cognito authentication, but Standard doesn't verify the
`x-amzn-oidc-data` header it adds yet, so the module doesn't set it up. The dashboard uses
openpurr's own sign-in (passwords and two-step sign-in, which you can require for everyone).

## Upgrades

Read the release notes, change `image` to the new version, and `tofu apply`. ECS starts tasks
from the new task definition, which apply any database migrations at startup (replicas take turns
under a lock), moves traffic once `/healthz` answers, then drains and stops the old tasks. If the
new tasks keep failing, the deployment circuit breaker rolls back to the previous task
definition. Roll back by hand by applying the previous `image`, as long as the release notes
don't say its migrations can't be undone.

## Backups and restores

- RDS takes a daily snapshot (kept 14 days, `db_backup_retention`) and keeps transaction logs, so
  you can restore to any second in that period. Deletion protection is on, deleting the
  instance takes a final snapshot (`openpurr-final`), and the automated backups outlive it for
  their retention period.
- To recover from a mistake, restore to a new instance at a moment before it, check it, then
  copy the data back (pg_dump and pg_restore from a machine in the VPC):
  `aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier openpurr --target-db-instance-identifier openpurr-restored --restore-time 2026-11-20T09:00:00Z --db-subnet-group-name openpurr --vpc-security-group-ids <db security group>`.
- For a copy outside this account or region: `aws rds copy-db-snapshot` (with `--kms-key-id` for
  another region), or a pg_dump from inside the VPC.
- `OPERATOR_SECRET` isn't in the database. Without it, passwords and authenticators stop working
  (recover with `openpurr admin login-link`), so don't delete its secret.

## How it runs

- **At least one task.** The background jobs (webhook retries, cleanups, exchange rates, the
  charts' rollup) and the work after a response (first webhook attempts, snapshot rebuilds) run
  inside the server, so `min_tasks = 1`; a Fargate task always has its CPU. More tasks are safe:
  jobs run once per slot across all of them. CPU auto scaling adds tasks up to `max_tasks`.
- **Connections.** Each task opens up to `db_pool_size` (5) connections. Keep
  `max_tasks × db_pool_size` plus a few for the admin task under the database's `max_connections`,
  which RDS sizes from memory: roughly 80 on `db.t4g.micro` and 180 on `db.t4g.small` (`SHOW max_connections`
  tells).
- **The database password.** `DATABASE_URL` holds the host and database only; ECS gives the task
  `PGUSER` and `PGPASSWORD` from the secret RDS manages, and pgx reads them. RDS rotates the
  password every 7 days. ECS reads secrets only when a task starts, so when a rotation succeeds,
  EventBridge starts a small Step Functions state machine that forces a new deployment: new tasks
  start with the new password before the old ones stop.
- **TLS to the database.** `rds.force_ssl` refuses unencrypted connections and the server uses
  `sslmode=require`. The image doesn't carry the RDS certificate authority, so the certificate
  isn't verified; only the tasks' security group can reach the database.
- **Shutdown.** When a task stops, the load balancer first drains it for `stop_timeout` (30
  seconds), then ECS sends SIGTERM and waits `stop_timeout` again before killing it; the server is
  told to finish within 25 (`SHUTDOWN_TIMEOUT_SECONDS`). Webhook attempts cut short are retried by
  the next run of the job.
- **Client addresses.** The load balancer appends the client's address to `X-Forwarded-For`, and
  the server takes the last entry (`CLIENT_IP_HOPS=1`) for rate limits and the audit log. The
  tasks only accept connections from the load balancer, so it can't be forged. With another
  proxy that appends in front, such as Cloudflare kept as a CDN after moving from Lite, set
  `env = { CLIENT_IP_HOPS = "2" }`.
- **Network.** By default the tasks run in private subnets and reach the internet (the stores,
  ghcr.io, webhook endpoints, AWS's APIs) through one NAT gateway. `tasks_in_public_subnets = true`
  drops the NAT gateway and gives each task a public address instead; the security group still
  only lets the load balancer in. The tasks may connect out on port 443 only (`egress_ports`);
  add 80 or other ports if your webhook endpoints use them.
- **The image** is pulled straight from ghcr.io. To use ECR instead, push it to a repository of
  yours and set `image` to it.
- **Logs** are JSON lines in the `/ecs/openpurr` log group (`server/` and `admin/` streams), kept
  30 days (`log_retention_days`). CloudWatch Logs Insights reads the `level` and `msg` fields.
- **Health check.** The load balancer calls `/healthz` every 15 seconds; it answers once Postgres
  does. ECS replaces a task the load balancer marks unhealthy. There's no container health check:
  the image has no shell or curl.

## Costs

A ballpark for the defaults in `us-east-1`, on-demand, 730 hours a month, before free tiers and
savings plans. Prices change; check the [pricing calculator](https://calculator.aws/). Rates
below were checked on 2026-11-22.

| Part | Setting | About per month |
|---|---|---|
| Fargate | 1 task, 0.5 vCPU and 1 GB on arm64 ($0.03238 per vCPU-hour, $0.00356 per GB-hour) | $14 |
| RDS | `db.t4g.small`, single-AZ ($0.032 an hour); `db.t4g.micro` is about $12 | $23 |
| RDS storage and backups | 20 GB gp3 (about $0.115 per GB); backups up to the database's size are free | $2–3 |
| Load balancer | $0.0225 an hour plus about $0.008 per LCU-hour | $17–23 |
| NAT gateway | $0.045 an hour plus $0.045 per GB processed | $33–35 |
| Public IPv4 addresses | $0.005 an hour each: two for the load balancer, one for the NAT gateway | $11 |
| Secrets Manager, CloudWatch Logs, EventBridge, Step Functions | $0.40 per secret (about five), a little log ingestion at $0.50 per GB | $3–4 |
| **Total** | | **about $105–115** |

`tasks_in_public_subnets = true` saves the NAT gateway and its address (about $37) and adds $3.65
per task, which brings the total to about $75; with `db.t4g.micro` as well, about $65.
`db_multi_az` doubles the database's cost. Data out to the internet is extra ($0.09 per GB after
the first 100 GB a month), though API responses are small.

Sources: [Fargate pricing](https://aws.amazon.com/fargate/pricing/),
[RDS for PostgreSQL pricing](https://aws.amazon.com/rds/postgresql/pricing/) and Vantage's
[db.t4g.small page](https://instances.vantage.sh/aws/rds/db.t4g.small),
[Elastic Load Balancing pricing](https://aws.amazon.com/elasticloadbalancing/pricing/),
[VPC pricing](https://aws.amazon.com/vpc/pricing/) (NAT gateways and public IPv4 addresses),
[Secrets Manager pricing](https://aws.amazon.com/secrets-manager/pricing/),
[CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/).

## Not covered

- Sign-in through the load balancer (see above), AWS WAF, and IPv6 on the load balancer.
- A way into the VPC (bastion, Session Manager instance) for pg_dump or `openpurr migrate import`.
- Alarms. The load balancer's `UnHealthyHostCount` and 5xx metrics and RDS's `FreeStorageSpace`
  are good first ones.
- A second NAT gateway, read replicas, and anything across regions.
- `openpurr setup gcp` has no AWS counterpart yet; copy `examples/example.tfvars` instead.

## Tearing down

Deletion protection stops `tofu destroy` from removing the database and the load balancer. For a
test deployment, set `deletion_protection = false`, apply, then `tofu destroy`. RDS keeps the
final snapshot (`openpurr-final`) and the automated backups for their retention period; delete the
snapshot yourself when you no longer need it. Deleted secrets are kept 30 days before they're
gone, and their names stay taken until then; to reuse them sooner,
`aws secretsmanager delete-secret --secret-id <name> --force-delete-without-recovery`.
