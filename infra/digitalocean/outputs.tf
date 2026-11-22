locals {
  default_host = trimsuffix(trimprefix(digitalocean_app.openpurr.default_ingress, "https://"), "/")
  base_url     = var.domain != "" ? "https://${var.domain}" : "https://${local.default_host}"
}

output "url" {
  description = "The SDK URL (Purchases.proxyURL): the domain, or the *.ondigitalocean.app address without one."
  value       = local.base_url
}

output "back_office_url" {
  description = "The dashboard."
  value       = "${local.base_url}/admin"
}

output "default_ingress" {
  description = "The app's own *.ondigitalocean.app host. Point the domain's CNAME here (unless dns_zone is set); the certificate follows."
  value       = local.default_host
}

output "apple_notification_url" {
  description = "App Store Connect → App Information → App Store Server Notifications (production and sandbox, Version 2)."
  value       = "${local.base_url}/notifications/apple"
}

output "google_notification_url" {
  description = "The push endpoint (and the default audience) of the Pub/Sub push subscription for Google Play notifications."
  value       = "${local.base_url}/notifications/google"
}

output "secrets_to_fill" {
  description = "Encrypted app-level variables to fill in the control panel (Settings → App-Level Environment Variables)."
  value       = concat(var.generate_operator_secret ? [] : ["OPERATOR_SECRET"], var.secrets)
}

output "admin" {
  description = "How to run `openpurr admin ...`."
  value       = <<-EOT
    Set admin_command = "admin create --email you@example.com" and apply: the "admin" job runs once
    after the deployment, and its output (the setup link) is in the app's logs for the admin
    component (control panel: the app → Activity → Jobs, or Runtime Logs). Then set
    admin_command = "" and apply again. From your own machine instead: add your address to
    db_trusted_ips and run the image with the cluster's connection string (docs/standard-on-digitalocean.md).
  EOT
}

output "app_id" {
  description = "The App Platform app's ID (for doctl apps ...)."
  value       = digitalocean_app.openpurr.id
}

output "database_cluster_id" {
  description = "The database cluster's ID (for doctl databases ...)."
  value       = digitalocean_database_cluster.db.id
}
