# With a domain: a global external Application Load Balancer with a Google-managed certificate,
# in front of the Cloud Run service through a serverless network endpoint group.
#
# With IAP (iap_members), two backend services point at the same Cloud Run service:
#   - "admin", with IAP on, for /admin and everything under it (the dashboard, its sign-in routes
#     and the admin API);
#   - "public", for everything else: the SDK API, store notifications, /mcp and /oauth, which
#     can't sign in interactively, and admin API requests carrying a personal access token
#     ("Authorization: Bearer pat_..."), so the CLI works without IAP. openpurr checks every
#     token itself, and a token is all such a request can use (sessions and IAP aren't read when
#     a token is sent), so this route opens nothing a token doesn't already open.

resource "google_compute_region_network_endpoint_group" "server" {
  count                 = local.use_lb ? 1 : 0
  name                  = "${var.name}-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"
  cloud_run {
    # By name, not by reference: the service's IAP_AUDIENCE depends on the backend service.
    service = var.name
  }
}

resource "google_compute_backend_service" "public" {
  count                 = local.use_lb ? 1 : 0
  name                  = "${var.name}-public"
  protocol              = "HTTPS"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  # Overwrites any X-Client-IP a client sent; the server's CLIENT_IP_HEADER.
  custom_request_headers = ["X-Client-IP: {client_ip_address}"]
  log_config {
    enable = false # Cloud Run logs every request already
  }
  backend {
    group = google_compute_region_network_endpoint_group.server[0].id
  }
  depends_on = [google_project_service.apis]
}

resource "google_compute_backend_service" "admin" {
  count                  = local.use_iap ? 1 : 0
  name                   = "${var.name}-admin"
  protocol               = "HTTPS"
  load_balancing_scheme  = "EXTERNAL_MANAGED"
  custom_request_headers = ["X-Client-IP: {client_ip_address}"]
  log_config {
    enable = false
  }
  backend {
    group = google_compute_region_network_endpoint_group.server[0].id
  }
  iap {
    enabled                         = true
    oauth2_client_id                = var.iap_oauth_client_id != "" ? var.iap_oauth_client_id : null
    oauth2_client_secret_wo         = var.iap_oauth_client_id != "" ? var.iap_oauth_client_secret : null
    oauth2_client_secret_wo_version = var.iap_oauth_client_id != "" ? "1" : null
  }
  depends_on = [google_project_service.apis]

  lifecycle {
    precondition {
      condition     = local.use_lb
      error_message = "IAP (iap_members) needs a domain: it's set up on the load balancer."
    }
  }
}

resource "google_iap_web_backend_service_iam_member" "admin" {
  for_each            = local.use_iap ? toset(var.iap_members) : toset([])
  web_backend_service = google_compute_backend_service.admin[0].name
  role                = "roles/iap.httpsResourceAccessor"
  member              = each.value
}

resource "google_compute_url_map" "https" {
  count           = local.use_lb ? 1 : 0
  name            = "${var.name}-https"
  default_service = google_compute_backend_service.public[0].id

  dynamic "host_rule" {
    for_each = local.use_iap ? [1] : []
    content {
      hosts        = ["*"]
      path_matcher = "iap"
    }
  }

  dynamic "path_matcher" {
    for_each = local.use_iap ? [1] : []
    content {
      name            = "iap"
      default_service = google_compute_backend_service.public[0].id

      # Sign-in itself always goes through IAP.
      route_rules {
        priority = 1
        match_rules {
          prefix_match = "/admin/v1/auth/"
        }
        service = google_compute_backend_service.admin[0].id
      }
      # The CLI: the admin API with a personal access token.
      route_rules {
        priority = 2
        match_rules {
          prefix_match = "/admin/v1/"
          header_matches {
            header_name  = "Authorization"
            prefix_match = "Bearer pat_"
          }
        }
        service = google_compute_backend_service.public[0].id
      }
      # The dashboard and the rest of the admin API.
      route_rules {
        priority = 3
        match_rules {
          full_path_match = "/admin"
        }
        match_rules {
          prefix_match = "/admin/"
        }
        service = google_compute_backend_service.admin[0].id
      }
    }
  }
}

resource "google_compute_managed_ssl_certificate" "server" {
  count = local.use_lb ? 1 : 0
  name  = "${var.name}-cert"
  managed {
    domains = [var.domain]
  }
  depends_on = [google_project_service.apis]

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_compute_target_https_proxy" "server" {
  count            = local.use_lb ? 1 : 0
  name             = "${var.name}-https"
  url_map          = google_compute_url_map.https[0].id
  ssl_certificates = [google_compute_managed_ssl_certificate.server[0].id]
}

resource "google_compute_global_address" "server" {
  count      = local.use_lb ? 1 : 0
  name       = "${var.name}-ip"
  depends_on = [google_project_service.apis]
}

resource "google_compute_global_forwarding_rule" "https" {
  count                 = local.use_lb ? 1 : 0
  name                  = "${var.name}-https"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.server[0].address
  port_range            = "443"
  target                = google_compute_target_https_proxy.server[0].id
}

# Plain HTTP redirects to HTTPS.
resource "google_compute_url_map" "http" {
  count = local.use_lb ? 1 : 0
  name  = "${var.name}-http"
  default_url_redirect {
    https_redirect = true
    strip_query    = false
  }
}

resource "google_compute_target_http_proxy" "server" {
  count   = local.use_lb ? 1 : 0
  name    = "${var.name}-http"
  url_map = google_compute_url_map.http[0].id
}

resource "google_compute_global_forwarding_rule" "http" {
  count                 = local.use_lb ? 1 : 0
  name                  = "${var.name}-http"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.server[0].address
  port_range            = "80"
  target                = google_compute_target_http_proxy.server[0].id
}
