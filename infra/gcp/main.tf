# openpurr Standard on Google Cloud: Cloud Run running the server, Cloud SQL for Postgres, Secret
# Manager for its secrets and, with a domain, a global load balancer (optionally with
# Identity-Aware Proxy in front of the dashboard). See docs/standard-on-gcp.md.

data "google_project" "this" {
  project_id = var.project_id
}

locals {
  use_lb  = var.domain != ""
  use_iap = length(var.iap_members) > 0

  # Where apps, App Store Connect and Pub/Sub reach the server.
  base_url = local.use_lb ? "https://${var.domain}" : google_cloud_run_v2_service.server.uri

  # ghcr.io images come through the Artifact Registry remote repository (Cloud Run can't pull
  # from ghcr.io itself).
  from_ghcr = startswith(var.image, "ghcr.io/")
  image     = local.from_ghcr ? "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.ghcr[0].repository_id}/${trimprefix(var.image, "ghcr.io/")}" : var.image

  iap_audience = local.use_iap ? "/projects/${data.google_project.this.number}/global/backendServices/${google_compute_backend_service.admin[0].generated_id}" : ""
}

resource "google_project_service" "apis" {
  for_each = toset(concat(
    ["run.googleapis.com", "sqladmin.googleapis.com", "secretmanager.googleapis.com", "artifactregistry.googleapis.com", "iam.googleapis.com"],
    local.use_lb ? ["compute.googleapis.com"] : [],
    local.use_iap ? ["iap.googleapis.com"] : [],
    var.google_play_rtdn ? ["pubsub.googleapis.com"] : [],
  ))
  service            = each.value
  disable_on_destroy = false
}

# The identity the server runs as. It can connect to the database and read its own secrets, nothing
# else.
resource "google_service_account" "server" {
  account_id   = "${var.name}-server"
  display_name = "openpurr server"
  depends_on   = [google_project_service.apis]
}

resource "google_project_iam_member" "server_sql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = google_service_account.server.member
}

# Pulls ghcr.io images through Artifact Registry.
resource "google_artifact_registry_repository" "ghcr" {
  count         = local.from_ghcr ? 1 : 0
  location      = var.region
  repository_id = "${var.name}-ghcr"
  description   = "ghcr.io, for the openpurr image"
  format        = "DOCKER"
  mode          = "REMOTE_REPOSITORY"
  remote_repository_config {
    description = "ghcr.io"
    docker_repository {
      custom_repository {
        uri = "https://ghcr.io"
      }
    }
  }
  depends_on = [google_project_service.apis]
}
