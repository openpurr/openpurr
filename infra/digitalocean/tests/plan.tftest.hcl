# Offline checks of the module's wiring: the DigitalOcean provider is mocked, so nothing talks to
# DigitalOcean and no token is needed (the random provider is local). Run with `tofu test` after
# `tofu init -backend=false`.

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

run "defaults_without_a_domain" {
  command = apply

  assert {
    condition     = output.url == "https://openpurr-abc12.ondigitalocean.app" && output.back_office_url == "https://openpurr-abc12.ondigitalocean.app/admin"
    error_message = "Without a domain, the ondigitalocean.app address is the server's."
  }
  assert {
    condition     = length(digitalocean_app.openpurr.spec[0].domain) == 0
    error_message = "No custom domain without one."
  }
  assert {
    condition     = digitalocean_app.openpurr.spec[0].region == "nyc" && digitalocean_database_cluster.db.region == "nyc3"
    error_message = "The app runs in the database's region."
  }
  assert {
    condition = (
      digitalocean_app.openpurr.spec[0].service[0].image[0].registry_type == "GHCR" &&
      digitalocean_app.openpurr.spec[0].service[0].image[0].registry == "openpurr" &&
      digitalocean_app.openpurr.spec[0].service[0].image[0].repository == "openpurr-standard" &&
      digitalocean_app.openpurr.spec[0].service[0].image[0].tag == "0.3.0"
    )
    error_message = "ghcr.io images are pulled from GHCR directly."
  }
  assert {
    condition     = digitalocean_app.openpurr.spec[0].service[0].instance_count == 1 && digitalocean_app.openpurr.spec[0].service[0].health_check[0].http_path == "/healthz"
    error_message = "One instance for the job loop, health-checked on /healthz."
  }
  assert {
    condition = alltrue([
      for kv in ["CLIENT_IP_HEADER=do-connecting-ip", "CLIENT_IP_HOPS=0", "LOG_FORMAT=json", "SHUTDOWN_TIMEOUT_SECONDS=25", "PUBLIC_URL=$${APP_URL}"] :
      contains([for e in digitalocean_app.openpurr.spec[0].service[0].env : "${e.key}=${e.value}"], kv)
    ])
    error_message = "The server reads the client IP from do-connecting-ip, logs JSON, stops before the kill, and knows its URL."
  }
  assert {
    condition     = one([for e in digitalocean_app.openpurr.spec[0].service[0].env : e.value if e.key == "DATABASE_URL"]) == "postgresql://$${db.USERNAME}:$${db.PASSWORD}@$${db.HOSTNAME}:$${db.PORT}/$${db.DATABASE}?sslmode=require&pool_max_conns=5"
    error_message = "DATABASE_URL comes from the database component's bindable variables, with TLS required."
  }
  assert {
    condition     = digitalocean_app.openpurr.spec[0].database[0].production && digitalocean_app.openpurr.spec[0].database[0].cluster_name == "openpurr" && digitalocean_app.openpurr.spec[0].database[0].db_name == "openpurr"
    error_message = "The app attaches the managed cluster's openpurr database."
  }
  assert {
    condition     = digitalocean_app.openpurr.spec[0].service[0].termination[0].grace_period_seconds == 30
    error_message = "SIGKILL comes 5 seconds after the server's own shutdown timeout."
  }
  assert {
    condition     = toset([for e in digitalocean_app.openpurr.spec[0].env : e.key]) == toset(["OPERATOR_SECRET"]) && alltrue([for e in digitalocean_app.openpurr.spec[0].env : e.type == "SECRET" && length(e.value) == 48])
    error_message = "OPERATOR_SECRET is generated and encrypted."
  }
  assert {
    condition     = length(digitalocean_app.openpurr.spec[0].job) == 0
    error_message = "No admin job unless asked."
  }
  assert {
    condition     = digitalocean_app.openpurr.spec[0].disable_edge_cache && digitalocean_app.openpurr.spec[0].disable_email_obfuscation
    error_message = "The edge neither caches nor rewrites responses."
  }
  assert {
    condition     = digitalocean_database_cluster.db.node_count == 1 && digitalocean_database_cluster.db.version == "17" && digitalocean_database_cluster.db.size == "db-s-1vcpu-1gb"
    error_message = "One node of the smallest size by default."
  }
  assert {
    condition     = [for r in digitalocean_database_firewall.db.rule : "${r.type}=${r.value}"] == ["app=6f1c2a3b-0000-4000-8000-000000000001"]
    error_message = "Only the app may connect to the database."
  }
  assert {
    condition     = length(output.secrets_to_fill) == 0
    error_message = "Nothing to fill by default."
  }
}

# Secrets are set when the app is created and then left to the control panel: a later apply
# neither overwrites the values filled there nor adds names.
run "later_applies_leave_secrets_alone" {
  command = apply

  variables {
    secrets                  = ["APPLE_IAP_KEY"]
    generate_operator_secret = false
  }

  assert {
    condition     = toset(nonsensitive([for e in digitalocean_app.openpurr.spec[0].env : e.key])) == toset(["OPERATOR_SECRET"]) && nonsensitive(length(one(digitalocean_app.openpurr.spec[0].env).value)) == 48
    error_message = "The app-level variables keep what the app was created with."
  }
}

run "too_many_connections" {
  command = plan

  variables {
    instance_count = 4
    db_pool_size   = 5
  }

  expect_failures = [digitalocean_database_cluster.db]
}

run "single_instance_size_with_replicas" {
  command = plan

  variables {
    instance_count = 2
    instance_size  = "apps-s-1vcpu-0.5gb"
  }

  expect_failures = [digitalocean_app.openpurr]
}

run "latest_is_refused" {
  command = plan

  variables {
    image = "ghcr.io/openpurr/openpurr-standard:latest"
  }

  expect_failures = [var.image]
}

run "at_least_one_instance" {
  command = plan

  variables {
    instance_count = 0
  }

  expect_failures = [var.instance_count]
}

run "docker_hub_image" {
  command = plan

  variables {
    image = "docker.io/someone/openpurr-standard:0.3.0"
  }

  assert {
    condition     = digitalocean_app.openpurr.spec[0].service[0].image[0].registry_type == "DOCKER_HUB" && digitalocean_app.openpurr.spec[0].service[0].image[0].registry == "someone" && digitalocean_app.openpurr.spec[0].service[0].image[0].repository == "openpurr-standard"
    error_message = "Docker Hub images name their owner as the registry."
  }
}
