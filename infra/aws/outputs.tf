locals {
  run_task_network = "awsvpcConfiguration={subnets=[${join(",", local.task_subnet_ids)}],securityGroups=[${aws_security_group.tasks.id}],assignPublicIp=${var.tasks_in_public_subnets ? "ENABLED" : "DISABLED"}}"
}

output "url" {
  description = "The server's address: the SDK URL (Purchases.proxyURL)."
  value       = local.base_url
}

output "dashboard_url" {
  description = "The back office."
  value       = "${local.base_url}/admin"
}

output "apple_notification_url" {
  description = "App Store Connect → App Information → App Store Server Notifications (production and sandbox, Version 2)."
  value       = "${local.base_url}/notifications/apple"
}

output "google_notification_url" {
  description = "The push endpoint of the Pub/Sub subscription for Google Play notifications (created in Google Cloud; see docs/standard-on-aws.md)."
  value       = "${local.base_url}/notifications/google"
}

output "load_balancer_dns_name" {
  description = "Without route53_zone_id: point the domain here (a CNAME, or an alias/ALIAS/ANAME record at the zone apex)."
  value       = aws_lb.server.dns_name
}

output "certificate_validation_records" {
  description = "Without route53_zone_id: add these CNAME records at your DNS provider so ACM issues the certificate."
  value = [for o in aws_acm_certificate.server.domain_validation_options : {
    name  = o.resource_record_name
    type  = o.resource_record_type
    value = o.resource_record_value
  }]
}

output "secrets_to_fill" {
  description = "Secrets Manager secrets whose values you add (aws secretsmanager put-secret-value --secret-id <name> --secret-string file://...)."
  value       = concat([for s in aws_secretsmanager_secret.store : s.name], var.generate_operator_secret ? [] : [aws_secretsmanager_secret.operator_secret.name])
}

output "admin_task_command" {
  description = "Runs `openpurr admin list`; change the command in --overrides for create, login-link or require-totp. Read the output with admin_logs_command."
  value = join(" ", [
    "aws ecs run-task --region ${var.region} --cluster ${aws_ecs_cluster.this.name}",
    "--task-definition ${aws_ecs_task_definition.admin.family} --launch-type FARGATE",
    "--network-configuration '${local.run_task_network}'",
    "--overrides '{\"containerOverrides\":[{\"name\":\"openpurr\",\"command\":[\"admin\",\"list\"]}]}'",
  ])
}

output "admin_logs_command" {
  description = "Shows the admin task's output (setup and recovery links) from the last 10 minutes."
  value       = "aws logs tail ${aws_cloudwatch_log_group.this.name} --region ${var.region} --log-stream-name-prefix admin/ --since 10m"
}

output "log_group" {
  description = "The CloudWatch Logs group with the server's (server/...) and the admin task's (admin/...) logs."
  value       = aws_cloudwatch_log_group.this.name
}

output "database_endpoint" {
  description = "The database's address, reachable only from the tasks' security group."
  value       = aws_db_instance.db.endpoint
}

output "database_secret_arn" {
  description = "The secret RDS manages with the database user's name and password (rotated by RDS)."
  value       = local.db_secret_arn
}
