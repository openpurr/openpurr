# Offline checks of the module's wiring: the Google provider is mocked, so nothing talks to Google
# Cloud and no credentials are needed (the random provider is local). Run with `tofu test` after
# `tofu init -backend=false`.

mock_provider "google" {
  mock_data "google_project" {
    defaults = {
      number = "123456789"
    }
  }
  mock_resource "google_compute_backend_service" {
    defaults = {
      generated_id = 987654321
    }
  }
  mock_resource "google_cloud_run_v2_service" {
    defaults = {
      uri = "https://openpurr-abc123-uc.a.run.app"
    }
  }
  mock_resource "google_service_account" {
    defaults = {
      member = "serviceAccount:openpurr-server@my-project.iam.gserviceaccount.com"
      email  = "openpurr-server@my-project.iam.gserviceaccount.com"
      name   = "projects/my-project/serviceAccounts/openpurr-server@my-project.iam.gserviceaccount.com"
    }
  }
  mock_resource "google_sql_database_instance" {
    defaults = {
      connection_name = "my-project:us-central1:openpurr"
    }
  }
}

variables {
  project_id = "my-project"
  image      = "ghcr.io/openpurr/openpurr-standard:0.3.0"
}

run "run_app_only" {
  command = apply

  assert {
    condition     = output.url == "https://openpurr-abc123-uc.a.run.app"
    error_message = "Without a domain, the run.app URL is the server's address."
  }
  assert {
    condition     = google_cloud_run_v2_service.server.ingress == "INGRESS_TRAFFIC_ALL"
    error_message = "Without a load balancer, the service takes traffic directly."
  }
  assert {
    condition     = length(google_compute_global_forwarding_rule.https) == 0 && length(google_compute_backend_service.admin) == 0
    error_message = "No load balancer without a domain."
  }
  assert {
    condition     = google_cloud_run_v2_service.server.template[0].containers[0].image == "us-central1-docker.pkg.dev/my-project/openpurr-ghcr/openpurr/openpurr-standard:0.3.0"
    error_message = "ghcr.io images go through the Artifact Registry remote repository."
  }
  assert {
    condition     = contains([for e in google_cloud_run_v2_service.server.template[0].containers[0].env : "${e.name}=${e.value == null ? "" : e.value}"], "CLIENT_IP_HOPS=1")
    error_message = "On run.app the client is the last X-Forwarded-For entry."
  }
  assert {
    condition     = google_cloud_run_v2_service.server.template[0].containers[0].resources[0].cpu_idle == false && google_cloud_run_v2_service.server.template[0].scaling[0].min_instance_count == 1
    error_message = "The job loop needs a running instance with CPU."
  }
  assert {
    condition     = google_sql_database_instance.db.settings[0].backup_configuration[0].point_in_time_recovery_enabled && google_sql_database_instance.db.deletion_protection
    error_message = "Backups with point-in-time recovery, and deletion protection."
  }
  assert {
    condition     = length(google_sql_database_instance.db.settings[0].ip_configuration[0].authorized_networks) == 0 && google_sql_database_instance.db.settings[0].ip_configuration[0].ssl_mode == "TRUSTED_CLIENT_CERTIFICATE_REQUIRED"
    error_message = "The database is reachable only through a connector."
  }
}

run "domain_iap_and_play" {
  command = apply

  variables {
    domain           = "purchases.example.com"
    iap_members      = ["user:you@example.com"]
    google_play_rtdn = true
    secrets          = ["APPLE_IAP_KEY", "GOOGLE_SERVICE_ACCOUNT"]
    image            = "us-docker.pkg.dev/my-project/images/openpurr-standard:0.3.0"
  }

  assert {
    condition     = output.url == "https://purchases.example.com"
    error_message = "The domain is the server's address."
  }
  assert {
    condition     = google_cloud_run_v2_service.server.ingress == "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
    error_message = "With a load balancer, the run.app URL must not bypass it."
  }
  assert {
    condition     = output.iap_audience == "/projects/123456789/global/backendServices/987654321"
    error_message = "IAP's audience names the admin backend service."
  }
  assert {
    condition = contains([for e in google_cloud_run_v2_service.server.template[0].containers[0].env : "${e.name}=${e.value == null ? "" : e.value}"], "IAP_AUDIENCE=/projects/123456789/global/backendServices/987654321") && contains(
      [for e in google_cloud_run_v2_service.server.template[0].containers[0].env : "${e.name}=${e.value == null ? "" : e.value}"], "CLIENT_IP_HEADER=X-Client-IP"
    )
    error_message = "The server gets IAP_AUDIENCE and the load balancer's client IP header."
  }
  assert {
    condition     = toset([for e in google_cloud_run_v2_service.server.template[0].containers[0].env : e.name if length(e.value_source) > 0]) == toset(["DATABASE_URL", "OPERATOR_SECRET", "APPLE_IAP_KEY", "GOOGLE_SERVICE_ACCOUNT"])
    error_message = "Secrets come from Secret Manager."
  }
  assert {
    condition     = google_cloud_run_v2_service.server.template[0].containers[0].image == "us-docker.pkg.dev/my-project/images/openpurr-standard:0.3.0" && length(google_artifact_registry_repository.ghcr) == 0
    error_message = "Other images are used as is."
  }
  assert {
    condition     = google_compute_backend_service.admin[0].iap[0].enabled && length(google_compute_backend_service.public[0].iap) == 0
    error_message = "IAP is on for the admin backend only."
  }
  assert {
    condition     = google_pubsub_subscription.rtdn[0].push_config[0].push_endpoint == "https://purchases.example.com/notifications/google" && google_pubsub_subscription.rtdn[0].push_config[0].oidc_token[0].audience == "https://purchases.example.com/notifications/google"
    error_message = "Play notifications are pushed to the domain, with the server's default audience."
  }
  assert {
    condition     = output.apple_notification_url == "https://purchases.example.com/notifications/apple"
    error_message = "The App Store notification URL is on the domain."
  }
}

run "iap_needs_a_domain" {
  command = plan

  variables {
    iap_members = ["user:you@example.com"]
  }

  expect_failures = [google_compute_backend_service.admin]
}
