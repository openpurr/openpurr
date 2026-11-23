# An internet-facing Application Load Balancer on the domain: an ACM certificate validated through
# DNS, HTTPS to the tasks' target group, and plain HTTP redirected to HTTPS.
#
# The certificate must be issued before the HTTPS listener can use it. With route53_zone_id the
# module adds the validation record itself; otherwise apply the certificate first, add the record
# the certificate_validation_records output shows, then apply the rest (docs/standard-on-aws.md).

resource "aws_acm_certificate" "server" {
  domain_name       = var.domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "validation" {
  for_each = var.route53_zone_id != "" ? {
    for o in aws_acm_certificate.server.domain_validation_options : o.domain_name => o
  } : {}
  zone_id         = var.route53_zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

# Waits until ACM has issued the certificate.
resource "aws_acm_certificate_validation" "server" {
  certificate_arn         = aws_acm_certificate.server.arn
  validation_record_fqdns = var.route53_zone_id != "" ? [for r in aws_route53_record.validation : r.fqdn] : null
}

resource "aws_lb" "server" {
  name                       = var.name
  load_balancer_type         = "application"
  internal                   = false
  subnets                    = local.public_subnet_ids
  security_groups            = [aws_security_group.alb.id]
  drop_invalid_header_fields = true
  # The client's address is appended to X-Forwarded-For (the server's CLIENT_IP_HEADER).
  xff_header_processing_mode = "append"
  enable_deletion_protection = var.deletion_protection
}

resource "aws_lb_target_group" "server" {
  name        = var.name
  port        = local.port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = local.vpc_id
  # A stopping task gets this long to finish its requests before ECS sends SIGTERM.
  deregistration_delay = var.stop_timeout

  # /healthz answers 200 once the database does.
  health_check {
    path                = "/healthz"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.server.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.server.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.server.arn
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.server.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      protocol    = "HTTPS"
      port        = "443"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_route53_record" "server" {
  count   = var.route53_zone_id != "" ? 1 : 0
  zone_id = var.route53_zone_id
  name    = var.domain
  type    = "A"
  alias {
    name                   = aws_lb.server.dns_name
    zone_id                = aws_lb.server.zone_id
    evaluate_target_health = true
  }
}
