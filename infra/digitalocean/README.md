# infra/digitalocean

An OpenTofu (or Terraform 1.7+) root module that runs openpurr Standard on DigitalOcean. The
step-by-step guide is [`docs/standard-on-digitalocean.md`](../../docs/standard-on-digitalocean.md).

| File | What it makes |
|---|---|
| `app.tf` | The App Platform app: the server as a service from the image (at least one instance, health check on `/healthz`, a shutdown that fits App Platform's grace period), the database attached for its connection variables, encrypted app-level secrets, your domain with a certificate App Platform manages, alerts on failed deployments and domains, and with `admin_command` a one-off job running `openpurr admin ...` |
| `database.tf` | Managed PostgreSQL (daily backups kept 7 days, point-in-time recovery within them, optional standby), the `openpurr` database, and trusted sources limited to the app and `db_trusted_ips` |
| `main.tf` | Parsing the image reference, `DATABASE_URL` from the database's bindable variables, the generated `OPERATOR_SECRET` |
| `outputs.tf` | The SDK and dashboard URLs, the CNAME target, the App Store and Google Play notification URLs, the secrets to fill, how to run `openpurr admin` |
| `app.yaml.example` | The same app as a plain App Platform spec, for deploying from the control panel or `doctl apps create --spec` without OpenTofu |

Every variable is described in `variables.tf`; `examples/example.tfvars` is a starting point.

```sh
export DIGITALOCEAN_TOKEN=...
tofu init
tofu apply -var-file=openpurr.tfvars
```

`tofu test` checks the module's wiring offline (the DigitalOcean provider is mocked; no token and
no calls to DigitalOcean).

## What's in the state

App Platform has no write-only way to pass a secret, so:

- **The database password isn't** passed through OpenTofu at all: `DATABASE_URL` is built from the
  database component's bindable variables (`${db.USERNAME}`, `${db.PASSWORD}`...), which App
  Platform fills in when the server starts. But the cluster resource itself exports the admin
  user's password and connection URIs, and the provider keeps them in the state (marked
  sensitive).
- **Your secrets aren't**: they're created empty and filled in the control panel, and the module
  ignores the app-level variables after the app is created, so the state only ever holds App
  Platform's ciphertext (`EV[...]`) for them.
- **A generated `OPERATOR_SECRET` is**, in `random_password.operator_secret`. To keep it out, set
  `generate_operator_secret = false` and fill it in the control panel like the others.
- **`registry_credentials`**, if you set it, is.

So keep the state in a private, encrypted bucket with versioning (a DigitalOcean Spaces bucket
through the `s3` backend, for example) rather than on a laptop.
