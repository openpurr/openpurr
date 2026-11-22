# Secret Manager: DATABASE_URL and OPERATOR_SECRET, generated here and written write-only (they
# never enter the state), and the secrets your config names, whose values you add yourself.

locals {
  connection_name = google_sql_database_instance.db.connection_name
}

resource "google_secret_manager_secret" "database_url" {
  secret_id = "${var.name}-DATABASE_URL"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "database_url" {
  secret                 = google_secret_manager_secret.database_url.id
  secret_data_wo         = "postgres://${google_sql_user.openpurr.name}:${ephemeral.random_password.db.result}@/${google_sql_database.openpurr.name}?host=/cloudsql/${local.connection_name}&pool_max_conns=${var.db_pool_size}"
  secret_data_wo_version = var.credentials_version
}

resource "google_secret_manager_secret" "operator_secret" {
  secret_id = "${var.name}-OPERATOR_SECRET"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

ephemeral "random_password" "operator_secret" {
  length  = 48
  special = false
}

resource "google_secret_manager_secret_version" "operator_secret" {
  count          = var.generate_operator_secret ? 1 : 0
  secret         = google_secret_manager_secret.operator_secret.id
  secret_data_wo = ephemeral.random_password.operator_secret.result
  # Fixed: a new OPERATOR_SECRET invalidates every password and authenticator.
  secret_data_wo_version = 1
}

resource "google_secret_manager_secret" "store" {
  for_each  = toset(var.secrets)
  secret_id = "${var.name}-${each.value}"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret" "config" {
  count     = var.config_file != "" ? 1 : 0
  secret_id = "${var.name}-config"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "config" {
  count       = var.config_file != "" ? 1 : 0
  secret      = google_secret_manager_secret.config[0].id
  secret_data = file(var.config_file)
}

# The server reads only its own secrets.
resource "google_secret_manager_secret_iam_member" "server" {
  for_each = merge(
    {
      DATABASE_URL    = google_secret_manager_secret.database_url.id
      OPERATOR_SECRET = google_secret_manager_secret.operator_secret.id
    },
    { for k, s in google_secret_manager_secret.store : k => s.id },
    var.config_file != "" ? { config = google_secret_manager_secret.config[0].id } : {},
  )
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.server.member
}
