# infra/aws

An OpenTofu (or Terraform 1.11+) root module that runs openpurr Standard on AWS. The step-by-step
guide is [`docs/standard-on-aws.md`](../../docs/standard-on-aws.md).

| File | What it makes |
|---|---|
| `network.tf` | A VPC with public and private subnets in two Availability Zones and one NAT gateway (or your own VPC and subnets), and security groups: internet → load balancer → tasks → database |
| `database.tf` | RDS for PostgreSQL in the private subnets: encrypted, TLS required, automated backups with point-in-time recovery, deletion protection, the password managed by RDS in Secrets Manager |
| `secrets.tf` | Secrets Manager: `OPERATOR_SECRET` (generated, written write-only, never in the state), one secret per name in `secrets` (values added by you) and the config file |
| `main.tf` | The ECS cluster, the CloudWatch Logs group, and the execution role (its own logs and secrets, nothing else) |
| `service.tf` | The ECS service on Fargate (arm64, at least one task, rolling deployments with the circuit breaker, CPU auto scaling) and the `<name>-admin` task definition for `openpurr admin ...` |
| `loadbalancer.tf` | An Application Load Balancer with an ACM certificate for `domain`, `/healthz` health checks and an HTTP-to-HTTPS redirect; with `route53_zone_id`, the DNS records |
| `rotation.tf` | Restarts the tasks when RDS rotates the database password (EventBridge and a one-step Step Functions state machine) |
| `outputs.tf` | The URLs (SDK, dashboard, App Store and Google Play notifications), the DNS records to add, the admin task's command |

Every variable is described in `variables.tf`; `examples/example.tfvars` is a starting point.
`tofu test` checks the module's wiring offline (the AWS provider is mocked; no credentials and no
cloud calls).

## Choices

- **ECS on Fargate, not App Runner.** App Runner stopped taking new customers on 2026-04-30 and
  gets no new features ([availability change](https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html)).
  AWS points to ECS Express Mode instead, which creates a similar service with fewer settings;
  this module defines the service, load balancer and network itself so each choice below is
  visible and adjustable.
- **The image straight from ghcr.io.** The package is public, and the tasks need a way out to the
  internet anyway (Apple, Google, webhooks), so ECS pulls it directly. An ECR pull-through cache
  would need a GitHub token in Secrets Manager even for a public image; to use ECR, push the image
  to your own repository and set `image` to it (the execution role then gets ECR pull permissions).
- **No password in a URL.** RDS generates the password (it has punctuation) and rotates it.
  `DATABASE_URL` names only the host and database; the task gets `PGUSER` and `PGPASSWORD` from
  RDS's secret, which pgx reads for what the URL leaves out. No code change in Standard.
- **Rotation restarts the tasks.** ECS reads secrets only when a task starts, so after RDS rotates
  the password (every 7 days by default) `rotation.tf` forces a rolling deployment.
- **`sslmode=require`.** The server's image doesn't carry the RDS certificate authority, so it
  encrypts without verifying the certificate; `rds.force_ssl` refuses plain connections, and only
  the tasks' security group reaches the database.
- **Client addresses.** The load balancer appends the client's address to `X-Forwarded-For`, so
  `CLIENT_IP_HOPS=1` (the last entry). Only the load balancer reaches the tasks, so it can't be
  skipped. With another proxy that appends in front (such as Cloudflare), raise it to 2.
- **One NAT gateway**, not one per zone; or none, with `tasks_in_public_subnets`.

## Not yet: sign-in through the load balancer

On Google Cloud, Identity-Aware Proxy can sign operators in (`IAP_AUDIENCE`). The AWS counterpart
is the load balancer's `authenticate-oidc` or `authenticate-cognito` action, but Standard doesn't
verify the `x-amzn-oidc-data` header it adds yet, so this module doesn't offer it. The dashboard
uses openpurr's own sign-in (password and two-step sign-in) meanwhile.

## What's in the state

Generated passwords aren't: RDS keeps the database password in its own secret, and
`OPERATOR_SECRET` comes from an ephemeral resource and goes to Secrets Manager write-only. The
state still holds resource names and ARNs and the config file if you set `config_file`, so keep
it in a private S3 bucket with versioning rather than on a laptop.
