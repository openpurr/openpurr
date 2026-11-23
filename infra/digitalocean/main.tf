# openpurr Standard on DigitalOcean: an App Platform app running the server from the container
# image, and a Managed PostgreSQL cluster only the app can reach. See
# docs/standard-on-digitalocean.md.

locals {
  # App Platform regions are the datacenter's letters (nyc3 -> nyc).
  app_region = substr(var.region, 0, 3)

  # ghcr.io/<owner>/<repo>:<tag>, docker.io/..., registry.digitalocean.com/<registry>/<repo>@sha256:...
  image_parts = regex("^(ghcr\\.io|docker\\.io|registry\\.digitalocean\\.com)/([^/]+)/([^:@/]+)(?::([A-Za-z0-9_.-]+))?(?:@(sha256:[0-9a-f]{64}))?$", var.image)
  image = {
    registry_type = { "ghcr.io" = "GHCR", "docker.io" = "DOCKER_HUB", "registry.digitalocean.com" = "DOCR" }[local.image_parts[0]]
    # For DOCR the registry is the team's own and must be left out.
    registry   = local.image_parts[0] == "registry.digitalocean.com" ? null : local.image_parts[1]
    repository = local.image_parts[2]
    tag        = local.image_parts[3]
    digest     = local.image_parts[4]
  }

  # ${APP_URL} is App Platform's own address for the app, filled in at run time.
  public_url = var.domain != "" ? "https://${var.domain}" : "$${APP_URL}"

  # Built from the database component's bindable variables, which App Platform fills in at run
  # time: the password never passes through OpenTofu. TLS is required (DigitalOcean's clusters
  # refuse plain connections anyway).
  database_url = "postgresql://$${db.USERNAME}:$${db.PASSWORD}@$${db.HOSTNAME}:$${db.PORT}/$${db.DATABASE}?sslmode=require&pool_max_conns=${var.db_pool_size}"
}

# Generated once. A new OPERATOR_SECRET invalidates every password and authenticator, so it's
# never regenerated, and the app's copy is only set when the app is created.
resource "random_password" "operator_secret" {
  count   = var.generate_operator_secret ? 1 : 0
  length  = 48
  special = false
}
