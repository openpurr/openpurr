# --- Where ------------------------------------------------------------------------------------------

variable "region" {
  description = <<-EOT
    The datacenter for the database, such as nyc3, ams3, fra1 or sfo3. The app runs in the matching
    App Platform region (nyc3 -> nyc, fra1 -> fra).
  EOT
  type        = string
  default     = "nyc3"

  validation {
    condition     = can(regex("^[a-z]{3}[0-9]$", var.region))
    error_message = "region is a datacenter slug such as nyc3, ams3 or fra1."
  }
}

variable "name" {
  description = "Name of the app and the database cluster. Change it to run several deployments in one team."
  type        = string
  default     = "openpurr"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,30}[a-z0-9]$", var.name))
    error_message = "name must be 3 to 32 lowercase letters, digits or hyphens, starting with a letter."
  }
}

variable "project_id" {
  description = "The DigitalOcean project to put the app and the database in. Empty uses the team's default project."
  type        = string
  default     = ""
}

# --- The server ------------------------------------------------------------------------------------

variable "image" {
  description = <<-EOT
    The openpurr Standard container image, such as ghcr.io/openpurr/openpurr-standard:0.3.0. App
    Platform pulls from GitHub Container Registry, Docker Hub (docker.io/<owner>/<repo>:<tag>) and
    DigitalOcean Container Registry (registry.digitalocean.com/<registry>/<repo>:<tag>). Pin a
    version (a tag or @sha256:...): changing it is how you upgrade.
  EOT
  type        = string

  validation {
    condition     = can(regex("^(ghcr\\.io|docker\\.io|registry\\.digitalocean\\.com)/[^/]+/[^:@/]+(:[A-Za-z0-9_.-]+|@sha256:[0-9a-f]{64})$", var.image))
    error_message = "image is ghcr.io/, docker.io/ or registry.digitalocean.com/<owner>/<repo> with a :tag or @sha256: digest."
  }
  validation {
    condition     = !endswith(var.image, ":latest")
    error_message = "Pin a version instead of latest: upgrades should happen when you choose."
  }
}

variable "registry_credentials" {
  description = <<-EOT
    <username>:<token> for a private GHCR or Docker Hub image (a read-only token that doesn't
    expire: App Platform pulls again whenever an instance starts). Not needed for the public
    ghcr.io/openpurr image. It's kept in the state; use TF_VAR_registry_credentials.
  EOT
  type        = string
  default     = ""
  sensitive   = true
}

variable "domain" {
  description = <<-EOT
    The domain apps, App Store Connect and Google Play reach openpurr at, such as purchases.example.com.
    Strongly recommended: it's the contract that lets you move hosts later without an app update.
    App Platform issues and renews its certificate once the domain points at the app (a CNAME to
    the default_ingress output, or set dns_zone). Empty uses the *.ondigitalocean.app address.
  EOT
  type        = string
  default     = ""
}

variable "dns_zone" {
  description = <<-EOT
    If the domain's DNS is hosted on DigitalOcean, the zone it's in (example.com for
    purchases.example.com): App Platform then adds the record itself. Empty: you add a CNAME.
  EOT
  type        = string
  default     = ""
}

variable "instance_count" {
  description = <<-EOT
    Instances of the server. App Platform services don't scale to zero, and the background jobs
    (webhook retries, cleanups, exchange rates, charts) run inside the server, so at least 1.
    More is safe: jobs run once per slot across all of them.
  EOT
  type        = number
  default     = 1

  validation {
    condition     = var.instance_count >= 1
    error_message = "Keep at least one instance: the background jobs run inside the server."
  }
}

variable "instance_size" {
  description = <<-EOT
    App Platform instance size. apps-s-1vcpu-1gb (1 shared vCPU, 1 GiB) is the smallest that allows
    more than one instance; apps-s-1vcpu-0.5gb and apps-s-1vcpu-1gb-fixed allow only one;
    apps-d-* are dedicated CPUs.
  EOT
  type        = string
  default     = "apps-s-1vcpu-1gb"
}

variable "secrets" {
  description = <<-EOT
    Names of the secrets your config uses, such as APPLE_IAP_KEY, GOOGLE_SERVICE_ACCOUNT and webhook
    secrets (and FORWARD_SECRET while moving from Lite). Each becomes an encrypted app-level
    environment variable, created empty; you fill it in the control panel. OpenTofu creates them
    and then leaves the app-level variables alone, so a later apply never overwrites a value you
    set (see docs/standard-on-digitalocean.md). Add names before the first apply.
  EOT
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for s in var.secrets : can(regex("^[A-Z][A-Z0-9_]*$", s))])
    error_message = "Secret names are environment variable names: capital letters, digits and underscores."
  }
  validation {
    condition     = length(setintersection(toset(var.secrets), toset(["OPERATOR_SECRET", "DATABASE_URL", "PUBLIC_URL"]))) == 0
    error_message = "OPERATOR_SECRET, DATABASE_URL and PUBLIC_URL are set by the module."
  }
}

variable "env" {
  description = "Other environment variables for the server, such as LOG_LEVEL or RATE_LIMIT_IP_PER_MINUTE."
  type        = map(string)
  default     = {}
}

variable "generate_operator_secret" {
  description = <<-EOT
    Generate OPERATOR_SECRET (true; the generated value is kept in the state), or create it empty
    for you to fill in the control panel (false), for example with Lite's value when moving from
    Lite so passwords and authenticators keep working.
  EOT
  type        = bool
  default     = true
}

variable "shutdown_grace_seconds" {
  description = <<-EOT
    Seconds App Platform waits between SIGTERM and SIGKILL. The server is told to stop 5 seconds
    sooner (SHUTDOWN_TIMEOUT_SECONDS); work cut short is picked up by the next run of the jobs.
  EOT
  type        = number
  default     = 30

  validation {
    condition     = var.shutdown_grace_seconds >= 10 && var.shutdown_grace_seconds <= 600
    error_message = "Between 10 and 600 seconds (App Platform's limit is 600)."
  }
}

variable "admin_command" {
  description = <<-EOT
    Runs `openpurr <admin_command>` once after the next deployment, as a job with the server's image
    and database, such as "admin create --email you@example.com". Its output (setup and recovery
    links) is in the job's logs. Set it back to "" afterwards. Empty: no job.
  EOT
  type        = string
  default     = ""

  validation {
    condition     = var.admin_command == "" || startswith(var.admin_command, "admin ")
    error_message = "admin_command starts with \"admin \", such as \"admin create --email you@example.com\"."
  }
}

# --- Database --------------------------------------------------------------------------------------

variable "db_size" {
  description = <<-EOT
    Managed PostgreSQL node size. db-s-1vcpu-1gb (22 connections), db-s-1vcpu-2gb (47),
    db-s-2vcpu-4gb (97), db-s-4vcpu-8gb (197).
  EOT
  type        = string
  default     = "db-s-1vcpu-1gb"
}

variable "db_version" {
  description = "PostgreSQL major version."
  type        = string
  default     = "17"
}

variable "db_standby" {
  description = <<-EOT
    Add a standby node with automatic failover. Doubles the database's cost; DigitalOcean offers
    standbys from the 2 GiB size up.
  EOT
  type        = bool
  default     = false
}

variable "db_pool_size" {
  description = "Database connections per server instance (pgx's pool_max_conns). Keep instance_count x db_pool_size under db_size's limit."
  type        = number
  default     = 5
}

variable "db_trusted_ips" {
  description = <<-EOT
    Addresses (or CIDR ranges) besides the app that may connect to the database, such as your own
    for `openpurr admin`, pg_dump or `openpurr migrate import`. Empty: only the app.
  EOT
  type        = list(string)
  default     = []
}
