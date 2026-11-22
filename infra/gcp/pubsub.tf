# Google Play Real-time Developer Notifications: Play publishes to a topic, and a push subscription
# delivers each message to /notifications/google with a Google-signed OIDC token, which openpurr
# verifies (the push service account and audience below must match the app's google_play_api
# settings in the config: pubsub_push_account, and pubsub_audience if it isn't the default).

resource "google_pubsub_topic" "rtdn" {
  count      = var.google_play_rtdn ? 1 : 0
  name       = "${var.name}-play-rtdn"
  depends_on = [google_project_service.apis]
}

# Google Play publishes as this account (Play Console → Monetization setup).
resource "google_pubsub_topic_iam_member" "play_publisher" {
  count  = var.google_play_rtdn ? 1 : 0
  topic  = google_pubsub_topic.rtdn[0].id
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:google-play-developer-notifications@system.gserviceaccount.com"
}

# The identity Pub/Sub signs push tokens as. It needs no roles.
resource "google_service_account" "rtdn_push" {
  count        = var.google_play_rtdn ? 1 : 0
  account_id   = "${var.name}-rtdn-push"
  display_name = "openpurr Play notifications push"
  depends_on   = [google_project_service.apis]
}

# Lets Pub/Sub mint tokens for it (granted automatically in projects made after April 2021).
resource "google_service_account_iam_member" "pubsub_token_creator" {
  count              = var.google_play_rtdn ? 1 : 0
  service_account_id = google_service_account.rtdn_push[0].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

resource "google_pubsub_subscription" "rtdn" {
  count                      = var.google_play_rtdn ? 1 : 0
  name                       = "${var.name}-play-rtdn-push"
  topic                      = google_pubsub_topic.rtdn[0].id
  ack_deadline_seconds       = 60
  message_retention_duration = "604800s" # 7 days, Pub/Sub's longest

  push_config {
    push_endpoint = "${local.base_url}/notifications/google"
    oidc_token {
      service_account_email = google_service_account.rtdn_push[0].email
      audience              = "${local.base_url}/notifications/google"
    }
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  expiration_policy {
    ttl = "" # never expires
  }

  depends_on = [google_service_account_iam_member.pubsub_token_creator]
}
