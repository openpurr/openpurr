# Managed PostgreSQL. DigitalOcean backs it up daily (kept 7 days) with point-in-time recovery
# within those 7 days, at no extra cost; a restore always makes a new cluster. Trusted sources
# limit connections to the app (and db_trusted_ips), and the server connects with TLS.
#
# No PgBouncer pool: the job loop and migrations hold session-level advisory locks
# (pg_try_advisory_lock, pg_advisory_lock) on one connection, which a transaction-mode pool would
# hand to other clients between transactions. The server's own pgx pool (db_pool_size per
# instance) is enough at this scale.

locals {
  # Backend connections per node size (docs.digitalocean.com/products/databases/postgresql/details/limits/).
  db_connections = {
    "db-s-1vcpu-1gb"  = 22
    "db-s-1vcpu-2gb"  = 47
    "db-s-2vcpu-4gb"  = 97
    "db-s-4vcpu-8gb"  = 197
    "db-s-6vcpu-16gb" = 397
  }
}

resource "digitalocean_database_cluster" "db" {
  name       = var.name
  engine     = "pg"
  version    = var.db_version
  size       = var.db_size
  region     = var.region
  node_count = var.db_standby ? 2 : 1
  project_id = var.project_id != "" ? var.project_id : null

  maintenance_window {
    day  = "sunday"
    hour = "04:00:00"
  }

  lifecycle {
    precondition {
      # The server's instances, the admin job's pool and a few for you (psql, pg_dump).
      condition     = !contains(keys(local.db_connections), var.db_size) || var.instance_count * var.db_pool_size + 5 <= lookup(local.db_connections, var.db_size, 0)
      error_message = "instance_count x db_pool_size (plus 5 to spare) is over db_size's connection limit; use a larger db_size or a smaller pool."
    }
  }
}

resource "digitalocean_database_db" "openpurr" {
  cluster_id = digitalocean_database_cluster.db.id
  name       = "openpurr"
}

# Only the app (every component: the server and the admin job) and the addresses you list.
resource "digitalocean_database_firewall" "db" {
  cluster_id = digitalocean_database_cluster.db.id

  rule {
    type  = "app"
    value = digitalocean_app.openpurr.id
  }

  dynamic "rule" {
    for_each = toset(var.db_trusted_ips)
    content {
      type  = "ip_addr"
      value = rule.value
    }
  }
}
