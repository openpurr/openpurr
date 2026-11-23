# Offline checks with a domain, secrets to fill, a standby, replicas and the admin job, in a file
# of their own so the app is created with them (plan.tftest.hcl shows that later applies leave the
# secrets alone). The DigitalOcean provider is mocked: no token, no calls to DigitalOcean.

mock_provider "digitalocean" {
  mock_resource "digitalocean_app" {
    defaults = {
      id              = "6f1c2a3b-0000-4000-8000-000000000001"
      default_ingress = "https://openpurr-abc12.ondigitalocean.app"
    }
  }
  mock_resource "digitalocean_database_cluster" {
    defaults = {
      id = "9a8b7c6d-0000-4000-8000-000000000002"
    }
  }
}

variables {
  image = "ghcr.io/openpurr/openpurr-standard:0.3.0"
}

run "domain_secrets_standby_and_admin_job" {
  command = apply

  variables {
    domain                   = "purchases.example.com"
    dns_zone                 = "example.com"
    region                   = "fra1"
    image                    = "registry.digitalocean.com/my-registry/openpurr-standard@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    secrets                  = ["APPLE_IAP_KEY", "GOOGLE_SERVICE_ACCOUNT"]
    generate_operator_secret = false
    instance_count           = 2
    db_size                  = "db-s-1vcpu-2gb"
    db_standby               = true
    db_trusted_ips           = ["203.0.113.7"]
    admin_command            = "admin create --email you@example.com"
  }

  assert {
    condition     = output.url == "https://purchases.example.com" && output.apple_notification_url == "https://purchases.example.com/notifications/apple" && output.google_notification_url == "https://purchases.example.com/notifications/google"
    error_message = "The domain is the server's address, for apps and both stores."
  }
  assert {
    condition     = digitalocean_app.openpurr.spec[0].domain[0].name == "purchases.example.com" && digitalocean_app.openpurr.spec[0].domain[0].type == "PRIMARY" && digitalocean_app.openpurr.spec[0].domain[0].zone == "example.com"
    error_message = "The domain is the app's primary domain, in the DigitalOcean DNS zone."
  }
  assert {
    condition     = contains([for e in digitalocean_app.openpurr.spec[0].service[0].env : "${e.key}=${e.value}"], "PUBLIC_URL=https://purchases.example.com")
    error_message = "PUBLIC_URL is the domain."
  }
  assert {
    condition     = digitalocean_app.openpurr.spec[0].region == "fra"
    error_message = "fra1's App Platform region is fra."
  }
  assert {
    condition = (
      digitalocean_app.openpurr.spec[0].service[0].image[0].registry_type == "DOCR" &&
      digitalocean_app.openpurr.spec[0].service[0].image[0].registry == null &&
      digitalocean_app.openpurr.spec[0].service[0].image[0].tag == null &&
      digitalocean_app.openpurr.spec[0].service[0].image[0].digest == "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    )
    error_message = "DOCR images leave the registry out, and digests are passed as such."
  }
  assert {
    condition     = nonsensitive(sort([for e in digitalocean_app.openpurr.spec[0].env : "${e.key}:${e.type}:${e.value}"])) == tolist(["APPLE_IAP_KEY:SECRET:", "GOOGLE_SERVICE_ACCOUNT:SECRET:", "OPERATOR_SECRET:SECRET:"])
    error_message = "Secrets you fill are created empty and encrypted."
  }
  assert {
    condition     = output.secrets_to_fill == tolist(["OPERATOR_SECRET", "APPLE_IAP_KEY", "GOOGLE_SERVICE_ACCOUNT"])
    error_message = "OPERATOR_SECRET is yours to fill when not generated."
  }
  assert {
    condition     = digitalocean_app.openpurr.spec[0].job[0].kind == "POST_DEPLOY" && digitalocean_app.openpurr.spec[0].job[0].run_command == "/openpurr admin create --email you@example.com"
    error_message = "The admin job runs the command once after the deployment."
  }
  assert {
    condition     = contains([for e in digitalocean_app.openpurr.spec[0].job[0].env : "${e.key}=${e.value}"], "PUBLIC_URL=https://purchases.example.com")
    error_message = "The admin job prints links on the domain."
  }
  assert {
    condition     = digitalocean_database_cluster.db.node_count == 2
    error_message = "A standby is a second node."
  }
  assert {
    condition     = toset([for r in digitalocean_database_firewall.db.rule : "${r.type}=${r.value}"]) == toset(["app=6f1c2a3b-0000-4000-8000-000000000001", "ip_addr=203.0.113.7"])
    error_message = "Trusted sources are the app and the addresses listed."
  }
}
