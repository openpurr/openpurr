# --- Where ------------------------------------------------------------------------------------------

variable "project_id" {
  description = "The Google Cloud project to deploy into (its ID, such as my-project)."
  type        = string
}

variable "region" {
  description = "The region for Cloud Run, Cloud SQL and the registry, such as us-central1 or europe-west1."
  type        = string
  default     = "us-central1"
}

variable "name" {
  description = "Prefix for every resource's name. Change it to run several deployments in one project."
  type        = string
  default     = "openpurr"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,20}[a-z0-9]$", var.name))
    error_message = "name must be 3 to 22 lowercase letters, digits or hyphens, starting with a letter."
  }
}

# --- The server ------------------------------------------------------------------------------------

variable "image" {
  description = <<-EOT
    The openpurr Standard container image, such as ghcr.io/openpurr/openpurr-standard:0.4.0. Cloud Run
    can't pull from ghcr.io itself, so a ghcr.io image is pulled through an Artifact Registry remote
    repository this module creates; an Artifact Registry or Docker Hub image is used as is. Pin a
    version: changing it is how you upgrade.
  EOT
  type        = string
}

variable "domain" {
  description = <<-EOT
    The domain apps, App Store Connect and Google Play reach openpurr at, such as purchases.example.com.
    Strongly recommended: it's the contract that lets you move hosts later without an app update.
    Setting it creates a global external Application Load Balancer with a Google-managed certificate,
    and limits the Cloud Run service to traffic from that load balancer. Empty uses the *.run.app URL.
  EOT
  type        = string
  default     = ""
}

variable "min_instances" {
  description = <<-EOT
    Instances kept running. The background jobs (webhook retries, cleanups, exchange rates, charts)
    run inside the server, and the CPU is always allocated, so keep at least 1 or they only run while
    requests come in.
  EOT
  type        = number
  default     = 1
}

variable "max_instances" {
  description = "Most instances Cloud Run starts. Keep max_instances x db_pool_size under the database's connection limit."
  type        = number
  default     = 4
}

variable "cpu" {
  description = "vCPUs per instance (Cloud Run's limit, as a string: \"1\", \"2\"...)."
  type        = string
  default     = "1"
}

variable "memory" {
  description = "Memory per instance."
  type        = string
  default     = "512Mi"
}

variable "config_file" {
  description = <<-EOT
    Path to an openpurr.config.yaml imported on the first start (OPENPURR_CONFIG). Optional: after the
    first start the database holds the config, edited on the dashboard. It's stored in Secret Manager
    and in the state (it names secrets but holds none).
  EOT
  type        = string
  default     = ""
}

variable "secrets" {
  description = <<-EOT
    Names of the secrets your config uses, such as APPLE_IAP_KEY, GOOGLE_SERVICE_ACCOUNT and webhook
    secrets. Each becomes a Secret Manager secret (<name>-<SECRET>) and an environment variable of
    that name. Their values never pass through OpenTofu: add them with
    `gcloud secrets versions add`, before the first full apply (see docs/standard-on-gcp.md).
  EOT
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for s in var.secrets : can(regex("^[A-Z][A-Z0-9_]*$", s))])
    error_message = "Secret names are environment variable names: capital letters, digits and underscores."
  }
}

variable "env" {
  description = "Other environment variables for the server, such as LOG_LEVEL or RATE_LIMIT_IP_PER_MINUTE."
  type        = map(string)
  default     = {}
}

variable "generate_operator_secret" {
  description = <<-EOT
    Generate OPERATOR_SECRET (true), or leave the secret empty for you to add (false), for example
    Lite's value when moving from Lite so passwords and authenticators keep working.
  EOT
  type        = bool
  default     = true
}

# --- Database --------------------------------------------------------------------------------------

variable "db_tier" {
  description = <<-EOT
    Cloud SQL machine type (Enterprise edition). db-f1-micro and db-g1-small are shared-core
    (cheapest, no SLA, 25 and 50 connections); db-custom-1-3840 is 1 dedicated vCPU and 3.75 GB.
  EOT
  type        = string
  default     = "db-g1-small"
}

variable "db_version" {
  description = "Postgres version."
  type        = string
  default     = "POSTGRES_17"
}

variable "db_high_availability" {
  description = "A standby in a second zone with automatic failover (REGIONAL). Doubles the database's cost."
  type        = bool
  default     = false
}

variable "db_disk_gb" {
  description = "Initial disk size in GB. It grows automatically; it can't shrink."
  type        = number
  default     = 10
}

variable "db_backup_retention" {
  description = "Daily backups kept."
  type        = number
  default     = 14
}

variable "db_pool_size" {
  description = "Database connections per server instance (pgx's pool_max_conns)."
  type        = number
  default     = 5
}

variable "credentials_version" {
  description = <<-EOT
    Bump to generate a new database password (written to the database user and the DATABASE_URL
    secret, never to the state). Running instances keep their connections; deploy a new revision
    afterwards.
  EOT
  type        = number
  default     = 1
}

variable "deletion_protection" {
  description = "Refuse to delete the database and the Cloud Run service. Turn off only to tear a test deployment down."
  type        = bool
  default     = true
}

# --- Identity-Aware Proxy ----------------------------------------------------------------------------

variable "iap_members" {
  description = <<-EOT
    Who IAP lets reach the dashboard, such as ["user:you@example.com", "group:ops@example.com"].
    Non-empty puts IAP in front of /admin (needs domain) and sets IAP_AUDIENCE, so these people are
    signed in as the operator with their email. Password sign-in still works behind IAP.
  EOT
  type        = list(string)
  default     = []
}

variable "iap_oauth_client_id" {
  description = <<-EOT
    An OAuth client for IAP's sign-in screen. Empty uses a Google-managed client, which only admits
    accounts in your Google Workspace or Cloud Identity organization; set one (with
    iap_oauth_client_secret) to admit others, such as personal Gmail accounts.
  EOT
  type        = string
  default     = ""
}

variable "iap_oauth_client_secret" {
  description = "The OAuth client's secret, sent to Google write-only (not kept in the state). Use TF_VAR_iap_oauth_client_secret."
  type        = string
  default     = ""
  sensitive   = true
  ephemeral   = true
}

# --- Google Play -----------------------------------------------------------------------------------

variable "google_play_rtdn" {
  description = <<-EOT
    Create a Pub/Sub topic for Google Play's Real-time Developer Notifications and a push subscription
    to /notifications/google with an OIDC token. Put the topic's name in the Play Console.
  EOT
  type        = bool
  default     = false
}
