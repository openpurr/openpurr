output "url" {
  description = "The server's address: the SDK URL (Purchases.proxyURL) and the dashboard at /admin."
  value       = local.base_url
}

output "cloud_run_url" {
  description = "The Cloud Run service's own address. With a domain, it only answers the load balancer."
  value       = google_cloud_run_v2_service.server.uri
}

output "load_balancer_ip" {
  description = "Point the domain's A record here. The certificate is issued once DNS resolves (up to an hour or so)."
  value       = local.use_lb ? google_compute_global_address.server[0].address : null
}

output "apple_notification_url" {
  description = "App Store Connect → App Information → App Store Server Notifications (production and sandbox, Version 2)."
  value       = "${local.base_url}/notifications/apple"
}

output "google_notification_url" {
  description = "Where the push subscription delivers Play notifications."
  value       = "${local.base_url}/notifications/google"
}

output "google_play_rtdn_topic" {
  description = "Play Console → Monetization setup → Real-time developer notifications → Topic name."
  value       = var.google_play_rtdn ? google_pubsub_topic.rtdn[0].id : null
}

output "google_play_config" {
  description = "Put these in each Android app's google_play_api settings in the config."
  value = var.google_play_rtdn ? {
    pubsub_push_account = google_service_account.rtdn_push[0].email
    pubsub_audience     = "${local.base_url}/notifications/google"
  } : null
}

output "iap_audience" {
  description = "IAP_AUDIENCE, as the server was given it."
  value       = local.use_iap ? local.iap_audience : null
}

output "secrets_to_fill" {
  description = "Secret Manager secrets whose values you add (gcloud secrets versions add <secret> --data-file=...)."
  value       = concat([for s in google_secret_manager_secret.store : s.secret_id], var.generate_operator_secret ? [] : [google_secret_manager_secret.operator_secret.secret_id])
}

output "admin_job" {
  description = "Runs `openpurr admin ...`: gcloud run jobs execute <this> --region <region> --args=admin,create,--email,you@example.com --wait"
  value       = google_cloud_run_v2_job.admin.name
}

output "database_connection_name" {
  description = "For cloud-sql-proxy, to reach the database from your machine."
  value       = google_sql_database_instance.db.connection_name
}
