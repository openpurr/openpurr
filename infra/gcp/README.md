# infra/gcp

An OpenTofu (or Terraform 1.11+) root module that runs openpurr Standard on Google Cloud. The
step-by-step guide is [`docs/standard-on-gcp.md`](../../docs/standard-on-gcp.md).

| File | What it makes |
|---|---|
| `main.tf` | The APIs it needs, the server's service account (Cloud SQL client, its own secrets, nothing else), an Artifact Registry remote repository for ghcr.io images |
| `database.tf` | Cloud SQL for Postgres (Enterprise edition): daily backups, point-in-time recovery, deletion protection, reachable only through a Cloud SQL connector |
| `secrets.tf` | Secret Manager: `DATABASE_URL` and `OPERATOR_SECRET` (generated, written write-only, never in the state), and one secret per name in `secrets` (values added by you) |
| `service.tf` | The Cloud Run service (CPU always allocated, at least one instance, Cloud SQL socket, startup probe on `/healthz`) and the `<name>-admin` Cloud Run job for `openpurr admin ...` |
| `loadbalancer.tf` | With `domain`: a global external Application Load Balancer with a Google-managed certificate and an HTTP-to-HTTPS redirect; with `iap_members`, IAP in front of `/admin` |
| `pubsub.tf` | With `google_play_rtdn`: the topic Google Play publishes to and a push subscription to `/notifications/google` with an OIDC token |
| `outputs.tf` | The server's URL, the load balancer's IP, the App Store and Google Play notification settings, the IAP audience |

Every variable is described in `variables.tf`; `examples/example.tfvars` is a starting point.

```sh
tofu init
tofu apply -var-file=openpurr.tfvars
```

`tofu test` checks the module's wiring offline (the Google provider is mocked; no credentials and
no cloud calls).

## What's in the state

Generated passwords aren't: the database password and `OPERATOR_SECRET` come from ephemeral
resources and go to Google through write-only attributes, as does an IAP OAuth client secret. The
state still holds resource names, the config file if you set `config_file`, and the database
user's name, so keep it in a private bucket (a `gcs` backend with versioning) rather than on a
laptop.
