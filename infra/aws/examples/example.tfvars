# Copy to a file outside version control (openpurr.tfvars is ignored by git), fill in, then follow
# docs/standard-on-aws.md (the first apply creates the secrets and the certificate only).

region = "us-east-1"

# Pin a version; changing it is how you upgrade.
image = "ghcr.io/openpurr/openpurr-standard:0.4.0"

# A domain you own: apps, App Store Connect and Google Play use it, so you can move hosts later
# without an app update.
domain = "purchases.example.com"

# Optional: a Route 53 hosted zone for the domain, so the module adds the DNS records itself.
# route53_zone_id = "Z0123456789ABCDEFGHIJ"

# Optional: the config imported on the first start (afterwards, edit it on the dashboard).
# config_file = "openpurr.config.yaml"

# The secrets your config names. Add their values with `aws secretsmanager put-secret-value` before
# the full apply.
secrets = ["APPLE_IAP_KEY", "GOOGLE_SERVICE_ACCOUNT", "WEBHOOK_SIGNING_SECRET"]

# Optional: an existing VPC instead of a new one.
# vpc_id             = "vpc-0123456789abcdef0"
# public_subnet_ids  = ["subnet-0123456789abcdef0", "subnet-0123456789abcdef1"]
# private_subnet_ids = ["subnet-0123456789abcdef2", "subnet-0123456789abcdef3"]

# Optional: skip the NAT gateway by giving the tasks public addresses (see variables.tf).
# tasks_in_public_subnets = true

# Sizes (see variables.tf for what each costs).
# db_instance_class = "db.t4g.small"
# cpu               = 512
# memory            = 1024
# min_tasks         = 1
# max_tasks         = 4
