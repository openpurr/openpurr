# --- Where ------------------------------------------------------------------------------------------

variable "region" {
  description = "The AWS region to deploy into, such as us-east-1 or eu-west-1."
  type        = string
  default     = "us-east-1"
}

variable "name" {
  description = "Prefix for every resource's name. Change it to run several deployments in one account and region."
  type        = string
  default     = "openpurr"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,20}[a-z0-9]$", var.name))
    error_message = "name must be 3 to 22 lowercase letters, digits or hyphens, starting with a letter."
  }
}

variable "tags" {
  description = "Tags added to every resource, on top of openpurr = <name>."
  type        = map(string)
  default     = {}
}

# --- The server ------------------------------------------------------------------------------------

variable "image" {
  description = <<-EOT
    The openpurr Standard container image, such as ghcr.io/openpurr/openpurr-standard:0.4.0. ECS
    pulls a public ghcr.io image directly (through the NAT gateway or the task's public IP); an ECR
    image works too (the execution role may pull from ECR). Pin a version: changing it is how you
    upgrade.
  EOT
  type        = string
}

variable "domain" {
  description = <<-EOT
    The domain apps, App Store Connect and Google Play reach openpurr at, such as purchases.example.com.
    It's the contract that lets you move hosts later without an app update. The load balancer gets
    an ACM certificate for it, validated through DNS.
  EOT
  type        = string

  validation {
    condition     = can(regex("^([a-z0-9]([a-z0-9-]*[a-z0-9])?\\.)+[a-z]{2,}$", var.domain))
    error_message = "domain must be a lowercase host name, such as purchases.example.com."
  }
}

variable "route53_zone_id" {
  description = <<-EOT
    A Route 53 hosted zone that holds the domain. Set, the module creates the certificate's
    validation record and an alias record pointing the domain at the load balancer. Empty, you add
    both at your DNS provider (see the certificate_validation_records and load_balancer_dns_name
    outputs).
  EOT
  type        = string
  default     = ""
}

variable "cpu_architecture" {
  description = "ARM64 (Graviton, about 20% cheaper on Fargate) or X86_64. The image is built for both."
  type        = string
  default     = "ARM64"

  validation {
    condition     = contains(["ARM64", "X86_64"], var.cpu_architecture)
    error_message = "cpu_architecture must be ARM64 or X86_64."
  }
}

variable "cpu" {
  description = "CPU units per task (1024 = 1 vCPU). Fargate pairs each with a memory range: 256 takes 512 to 2048 MiB, 512 takes 1024 to 4096."
  type        = number
  default     = 512
}

variable "memory" {
  description = "Memory per task, in MiB."
  type        = number
  default     = 1024
}

variable "min_tasks" {
  description = <<-EOT
    Tasks kept running. The background jobs (webhook retries, cleanups, exchange rates, charts) run
    inside the server, so keep at least 1.
  EOT
  type        = number
  default     = 1

  validation {
    condition     = var.min_tasks >= 1
    error_message = "min_tasks must be at least 1: the background jobs need a running task."
  }
}

variable "max_tasks" {
  description = <<-EOT
    Most tasks CPU-based auto scaling starts. Equal to min_tasks turns auto scaling off. Keep
    max_tasks x db_pool_size under the database's connection limit.
  EOT
  type        = number
  default     = 4

  validation {
    condition     = var.max_tasks >= var.min_tasks
    error_message = "max_tasks must be at least min_tasks."
  }
}

variable "stop_timeout" {
  description = <<-EOT
    Seconds ECS waits after SIGTERM before it kills the container (Fargate allows up to 120). The
    server is told to finish within this minus 5 (SHUTDOWN_TIMEOUT_SECONDS), and the load balancer
    drains a task for the same time before ECS sends SIGTERM.
  EOT
  type        = number
  default     = 30

  validation {
    condition     = var.stop_timeout >= 10 && var.stop_timeout <= 120
    error_message = "stop_timeout must be between 10 and 120 seconds."
  }
}

variable "log_retention_days" {
  description = "Days CloudWatch Logs keeps the server's and the admin task's logs (one of CloudWatch's allowed values: 1, 3, 5, 7, 14, 30, 60, 90, ...)."
  type        = number
  default     = 30
}

variable "config_file" {
  description = <<-EOT
    Path to an openpurr.config.yaml imported on the first start (OPENPURR_CONFIG). Optional: after the
    first start the database holds the config, edited on the dashboard. It's stored in Secrets
    Manager and in the state (it names secrets but holds none), and a small init container writes it
    to a file the server reads.
  EOT
  type        = string
  default     = ""
}

variable "secrets" {
  description = <<-EOT
    Names of the secrets your config uses, such as APPLE_IAP_KEY, GOOGLE_SERVICE_ACCOUNT and webhook
    secrets. Each becomes a Secrets Manager secret (<name>/<SECRET>) and an environment variable of
    that name. Their values never pass through OpenTofu: add them with
    `aws secretsmanager put-secret-value` before the first full apply (see docs/standard-on-aws.md).
  EOT
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for s in var.secrets : can(regex("^[A-Z][A-Z0-9_]*$", s))])
    error_message = "Secret names are environment variable names: capital letters, digits and underscores."
  }
  validation {
    condition     = length(setintersection(toset(var.secrets), toset(["DATABASE_URL", "PGUSER", "PGPASSWORD", "OPERATOR_SECRET"]))) == 0
    error_message = "DATABASE_URL, PGUSER, PGPASSWORD and OPERATOR_SECRET are set by the module."
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

# --- Network ---------------------------------------------------------------------------------------

variable "vpc_id" {
  description = <<-EOT
    An existing VPC to use. Empty creates one with public and private subnets in two Availability
    Zones. Set, also set public_subnet_ids and private_subnet_ids.
  EOT
  type        = string
  default     = ""
}

variable "public_subnet_ids" {
  description = "With vpc_id: two or more public subnets (a route to an internet gateway), in different Availability Zones, for the load balancer."
  type        = list(string)
  default     = []
}

variable "private_subnet_ids" {
  description = <<-EOT
    With vpc_id: two or more private subnets, in different Availability Zones, for the database and
    (unless tasks_in_public_subnets) the tasks, which then need a route to the internet through a
    NAT gateway you provide.
  EOT
  type        = list(string)
  default     = []
}

variable "vpc_cidr" {
  description = "Without vpc_id: the new VPC's address range (a /16 is split into /24 subnets)."
  type        = string
  default     = "10.40.0.0/16"
}

variable "tasks_in_public_subnets" {
  description = <<-EOT
    Run the tasks in the public subnets with public IP addresses instead of in private subnets behind
    a NAT gateway. Saves the NAT gateway (about $33 a month plus $0.045 per GB) for about $3.60 a
    month per task's address. The security group still only admits the load balancer, but each task
    has an address on the internet and its outgoing address changes with every deployment. The
    database stays in the private subnets either way.
  EOT
  type        = bool
  default     = false
}

variable "egress_ports" {
  description = <<-EOT
    TCP ports the tasks may connect out to, anywhere: 443 reaches Apple, Google, ghcr.io and AWS's
    own APIs. Add 80 or others if your webhook endpoints use them.
  EOT
  type        = list(number)
  default     = [443]
}

# --- Database --------------------------------------------------------------------------------------

variable "db_instance_class" {
  description = <<-EOT
    RDS instance class. db.t4g.micro (2 vCPUs burstable, 1 GiB) is the cheapest; db.t4g.small
    (2 GiB) is the default; db.m7g.large (8 GiB, not burstable) for steady load.
  EOT
  type        = string
  default     = "db.t4g.small"
}

variable "db_engine_version" {
  description = "Postgres major version (RDS applies minor versions in the maintenance window)."
  type        = string
  default     = "17"
}

variable "db_multi_az" {
  description = "A standby in a second Availability Zone with automatic failover. Doubles the database's cost."
  type        = bool
  default     = false
}

variable "db_storage_gb" {
  description = "Initial storage in GiB (gp3, 20 at least). It grows automatically up to db_max_storage_gb; it can't shrink."
  type        = number
  default     = 20
}

variable "db_max_storage_gb" {
  description = "Ceiling for storage autoscaling."
  type        = number
  default     = 100
}

variable "db_backup_retention" {
  description = "Days of automated backups and point-in-time recovery (1 to 35)."
  type        = number
  default     = 14

  validation {
    condition     = var.db_backup_retention >= 1 && var.db_backup_retention <= 35
    error_message = "db_backup_retention must be 1 to 35 days (0 would turn backups off)."
  }
}

variable "db_pool_size" {
  description = "Database connections per task (pgx's pool_max_conns)."
  type        = number
  default     = 5
}

variable "deletion_protection" {
  description = "Refuse to delete the database and the load balancer. Turn off only to tear a test deployment down."
  type        = bool
  default     = true
}
