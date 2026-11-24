# Copy to a file outside version control (openpurr.tfvars is ignored by git), fill in, then:
#   export DIGITALOCEAN_TOKEN=...   # a personal access token with write scope
#   tofu init
#   tofu apply -var-file=openpurr.tfvars
# See docs/standard-on-digitalocean.md.

region = "nyc3"

# Pin a version; changing it is how you upgrade.
image = "ghcr.io/openpurr/openpurr-standard:0.4.0"

# A domain you own: apps, App Store Connect and Google Play use it, so you can move hosts later
# without an app update.
domain = "purchases.example.com"
# If example.com's DNS is on DigitalOcean, App Platform adds the record itself:
# dns_zone = "example.com"

# The secrets your config names. They're created empty and encrypted; fill them in the control
# panel after the first apply. Add every name now: later additions are made in the control panel.
secrets = ["APPLE_IAP_KEY", "GOOGLE_SERVICE_ACCOUNT", "WEBHOOK_SIGNING_SECRET"]

# Moving from Lite: fill OPERATOR_SECRET with Lite's value instead of generating one.
# generate_operator_secret = false

# Create the owner: runs once after the next deployment. Set back to "" afterwards.
# admin_command = "admin create --email you@example.com"

# Your address, to reach the database from your machine (pg_dump, openpurr migrate import).
# db_trusted_ips = ["203.0.113.7"]

# Sizes (see variables.tf for what each allows).
# instance_size  = "apps-s-1vcpu-1gb"
# instance_count = 1
# db_size        = "db-s-1vcpu-1gb"
# db_standby     = false
