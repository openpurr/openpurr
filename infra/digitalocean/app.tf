# The App Platform app: the server as a service from the image, the database attached as a
# component (for its bindable connection variables), the secrets as encrypted app-level variables,
# your domain with a certificate App Platform manages, and optionally a one-off admin job.

locals {
  plain_env = merge(
    {
      DATABASE_URL = local.database_url
      PUBLIC_URL   = local.public_url
      # App Platform's edge puts the client's address in do-connecting-ip
      # (docs.digitalocean.com/support/where-can-i-find-the-client-ip-address-of-a-request-connecting-to-my-app/).
      # X-Forwarded-For holds the edge's address instead.
      CLIENT_IP_HEADER         = "do-connecting-ip"
      CLIENT_IP_HOPS           = "0"
      LOG_FORMAT               = "json"
      SHUTDOWN_TIMEOUT_SECONDS = tostring(var.shutdown_grace_seconds - 5)
    },
    var.env,
  )

  # Encrypted app-level variables. App Platform encrypts a value when it's submitted and then
  # returns only the ciphertext (EV[...]), so OpenTofu sets them when the app is created and
  # ignores them afterwards (lifecycle below): you fill and rotate them in the control panel.
  secret_env = merge(
    { OPERATOR_SECRET = var.generate_operator_secret ? random_password.operator_secret[0].result : "" },
    { for s in var.secrets : s => "" },
  )

  image_block = [local.image]
}

resource "digitalocean_app" "openpurr" {
  project_id = var.project_id != "" ? var.project_id : null

  spec {
    name   = var.name
    region = local.app_region

    # Every response is dynamic, and the dashboard shows email addresses that the edge's email
    # obfuscation would rewrite.
    disable_edge_cache        = true
    disable_email_obfuscation = true

    dynamic "domain" {
      for_each = var.domain != "" ? [var.domain] : []
      content {
        name = domain.value
        type = "PRIMARY"
        zone = var.dns_zone != "" ? var.dns_zone : null
      }
    }

    dynamic "env" {
      for_each = local.secret_env
      content {
        key   = env.key
        value = env.value
        type  = "SECRET"
        scope = "RUN_TIME"
      }
    }

    alert {
      rule = "DEPLOYMENT_FAILED"
    }
    alert {
      rule = "DOMAIN_FAILED"
    }

    # The existing cluster, attached for its bindable variables (${db.HOSTNAME} and so on). It
    # connects as the cluster's admin user, which owns the openpurr database: on Postgres 15 and
    # later a newly created user can't create tables in the public schema without a GRANT.
    database {
      name         = "db"
      engine       = "PG"
      production   = true
      cluster_name = digitalocean_database_cluster.db.name
      db_name      = digitalocean_database_db.openpurr.name
    }

    service {
      name               = "server"
      instance_count     = var.instance_count
      instance_size_slug = var.instance_size
      http_port          = 8080

      dynamic "image" {
        for_each = local.image_block
        content {
          registry_type        = image.value.registry_type
          registry             = image.value.registry
          repository           = image.value.repository
          tag                  = image.value.tag
          digest               = image.value.digest
          registry_credentials = var.registry_credentials != "" ? var.registry_credentials : null
        }
      }

      dynamic "env" {
        for_each = local.plain_env
        content {
          key   = env.key
          value = env.value
          type  = "GENERAL"
          scope = "RUN_TIME"
        }
      }

      # Migrations run at startup; /healthz answers once Postgres does. An instance gets traffic
      # once it passes, and a deployment goes live only when the new instances do.
      health_check {
        http_path             = "/healthz"
        initial_delay_seconds = 0
        period_seconds        = 5
        timeout_seconds       = 3
        success_threshold     = 1
        failure_threshold     = 36
      }

      termination {
        drain_seconds        = 15
        grace_period_seconds = var.shutdown_grace_seconds
      }
    }

    # `openpurr admin ...` once after a deployment (the image has no shell, so App Platform's
    # console can't run it).
    dynamic "job" {
      for_each = var.admin_command != "" ? [var.admin_command] : []
      content {
        name               = "admin"
        kind               = "POST_DEPLOY"
        instance_count     = 1
        instance_size_slug = "apps-s-1vcpu-0.5gb"
        run_command        = "/openpurr ${job.value}"

        dynamic "image" {
          for_each = local.image_block
          content {
            registry_type        = image.value.registry_type
            registry             = image.value.registry
            repository           = image.value.repository
            tag                  = image.value.tag
            digest               = image.value.digest
            registry_credentials = var.registry_credentials != "" ? var.registry_credentials : null
          }
        }

        env {
          key   = "DATABASE_URL"
          value = replace(local.database_url, "pool_max_conns=${var.db_pool_size}", "pool_max_conns=2")
          type  = "GENERAL"
          scope = "RUN_TIME"
        }
        env {
          key   = "PUBLIC_URL"
          value = local.public_url
          type  = "GENERAL"
          scope = "RUN_TIME"
        }
      }
    }

    ingress {
      rule {
        component {
          name = "server"
        }
        match {
          path {
            prefix = "/"
          }
        }
      }
    }
  }

  lifecycle {
    # The secrets: set on creation, then yours (see secret_env).
    ignore_changes = [spec[0].env]

    precondition {
      condition     = var.instance_count == 1 || !contains(["apps-s-1vcpu-0.5gb", "apps-s-1vcpu-1gb-fixed"], var.instance_size)
      error_message = "apps-s-1vcpu-0.5gb and apps-s-1vcpu-1gb-fixed run one instance only; use apps-s-1vcpu-1gb or larger for more."
    }
  }
}
