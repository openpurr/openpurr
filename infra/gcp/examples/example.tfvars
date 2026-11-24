# Copy to a file outside version control (openpurr.tfvars is ignored by git), fill in, then:
#   tofu init
#   tofu apply -var-file=openpurr.tfvars
# See docs/standard-on-gcp.md.

project_id = "my-project"
region     = "us-central1"

# Pin a version; changing it is how you upgrade.
image = "ghcr.io/openpurr/openpurr-standard:0.4.0"

# A domain you own: apps, App Store Connect and Google Play use it, so you can move hosts later
# without an app update.
domain = "purchases.example.com"

# Optional: the config imported on the first start (afterwards, edit it on the dashboard).
# config_file = "openpurr.config.yaml"

# The secrets your config names. Add their values with `gcloud secrets versions add` before the
# first full apply.
secrets = ["APPLE_IAP_KEY", "GOOGLE_SERVICE_ACCOUNT", "WEBHOOK_SIGNING_SECRET"]

# Optional: Identity-Aware Proxy in front of the dashboard.
# iap_members = ["user:you@example.com"]

# Optional: a Pub/Sub topic and push subscription for Google Play notifications.
google_play_rtdn = true

# Sizes (see variables.tf for what each costs).
# db_tier       = "db-g1-small"
# min_instances = 1
# max_instances = 4
