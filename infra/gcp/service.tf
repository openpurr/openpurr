# The server on Cloud Run, and a Cloud Run job running `openpurr admin ...` with the same image,
# database and secrets (to create the owner and print recovery links; see docs/standard-on-gcp.md).

locals {
  plain_env = merge(
    {
      # Behind the load balancer, X-Client-IP is set by it (overwriting what a client sent). On the
      # run.app URL, Google's front end appends the client's address to X-Forwarded-For.
      CLIENT_IP_HEADER = local.use_lb ? "X-Client-IP" : "X-Forwarded-For"
      CLIENT_IP_HOPS   = local.use_lb ? "0" : "1"
    },
    local.use_lb ? { PUBLIC_URL = "https://${var.domain}" } : {},
    local.use_iap ? { IAP_AUDIENCE = local.iap_audience } : {},
    var.config_file != "" ? { OPENPURR_CONFIG = "/etc/openpurr/openpurr.config.yaml" } : {},
    var.env,
  )
  secret_env = merge(
    {
      DATABASE_URL    = google_secret_manager_secret.database_url.secret_id
      OPERATOR_SECRET = google_secret_manager_secret.operator_secret.secret_id
    },
    { for k, s in google_secret_manager_secret.store : k => s.secret_id },
  )
}

resource "google_cloud_run_v2_service" "server" {
  name                = var.name
  location            = var.region
  deletion_protection = var.deletion_protection
  # With a domain, only the load balancer reaches the service: IAP and the client IP header can't
  # be bypassed through the run.app URL.
  ingress = local.use_lb ? "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER" : "INGRESS_TRAFFIC_ALL"
  # The SDK API, store notifications and MCP are public; openpurr checks keys and tokens itself.
  invoker_iam_disabled = true

  template {
    service_account                  = google_service_account.server.email
    max_instance_request_concurrency = 80
    timeout                          = "60s"

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      image = local.image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        # Instance-based billing: the CPU stays on between requests, for the job loop and the
        # work done after a response (first webhook attempts, snapshot rebuilds).
        cpu_idle          = false
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = local.plain_env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      dynamic "volume_mounts" {
        for_each = var.config_file != "" ? [1] : []
        content {
          name       = "config"
          mount_path = "/etc/openpurr"
        }
      }

      # Migrations run at startup; /healthz answers once Postgres does.
      startup_probe {
        http_get {
          path = "/healthz"
        }
        initial_delay_seconds = 0
        period_seconds        = 3
        timeout_seconds       = 3
        failure_threshold     = 40
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [local.connection_name]
      }
    }

    dynamic "volumes" {
      for_each = var.config_file != "" ? [1] : []
      content {
        name = "config"
        secret {
          secret = google_secret_manager_secret.config[0].secret_id
          items {
            version = "latest"
            path    = "openpurr.config.yaml"
          }
        }
      }
    }
  }

  depends_on = [
    google_project_service.apis,
    google_project_iam_member.server_sql,
    google_secret_manager_secret_iam_member.server,
    google_secret_manager_secret_version.database_url,
    google_secret_manager_secret_version.operator_secret,
    google_secret_manager_secret_version.config,
    google_sql_user.openpurr,
  ]
}

# `openpurr admin ...` (create, login-link, list, require-totp), run with
#   gcloud run jobs execute <name>-admin --region <region> --args=admin,list --wait
# Its output (setup and recovery links) is in the job's logs.
resource "google_cloud_run_v2_job" "admin" {
  name                = "${var.name}-admin"
  location            = var.region
  deletion_protection = var.deletion_protection

  template {
    task_count = 1
    template {
      service_account = google_service_account.server.email
      max_retries     = 0
      timeout         = "120s"

      containers {
        image = local.image
        args  = ["admin", "list"]

        env {
          name  = "PUBLIC_URL"
          value = local.use_lb ? "https://${var.domain}" : ""
        }
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_url.secret_id
              version = "latest"
            }
          }
        }

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [local.connection_name]
        }
      }
    }
  }

  depends_on = [
    google_project_service.apis,
    google_project_iam_member.server_sql,
    google_secret_manager_secret_iam_member.server,
    google_secret_manager_secret_version.database_url,
  ]
}
