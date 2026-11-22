# Cloud SQL for Postgres. No authorized networks and client certificates required, so the only way
# in is a Cloud SQL connector (Cloud Run's built-in one, or cloud-sql-proxy), which checks IAM
# (roles/cloudsql.client) before the password is even asked for.

resource "google_sql_database_instance" "db" {
  name                = var.name
  database_version    = var.db_version
  region              = var.region
  deletion_protection = var.deletion_protection

  settings {
    edition                     = "ENTERPRISE"
    tier                        = var.db_tier
    availability_type           = var.db_high_availability ? "REGIONAL" : "ZONAL"
    disk_type                   = "PD_SSD"
    disk_size                   = var.db_disk_gb
    disk_autoresize             = true
    deletion_protection_enabled = var.deletion_protection

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "03:00"
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = var.db_backup_retention
      }
    }

    ip_configuration {
      ipv4_enabled = true
      ssl_mode     = "TRUSTED_CLIENT_CERTIFICATE_REQUIRED"
    }

    maintenance_window {
      day  = 7 # Sunday
      hour = 4 # UTC
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_sql_database" "openpurr" {
  name     = "openpurr"
  instance = google_sql_database_instance.db.name
}

# Generated on each run but only sent when credentials_version changes; never in the state.
ephemeral "random_password" "db" {
  length  = 40
  special = false # it goes into a URL
}

resource "google_sql_user" "openpurr" {
  name                = "openpurr"
  instance            = google_sql_database_instance.db.name
  password_wo         = ephemeral.random_password.db.result
  password_wo_version = var.credentials_version
}
