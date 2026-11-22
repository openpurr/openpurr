# Offline checks of the module's wiring: the AWS provider is mocked, so nothing talks to AWS and no
# credentials are needed (the random provider is local). Run with `tofu test` after
# `tofu init -backend=false`.

mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = {
      names = ["us-east-1a", "us-east-1b", "us-east-1c"]
    }
  }
  mock_resource "aws_db_instance" {
    defaults = {
      address = "openpurr.abc123.us-east-1.rds.amazonaws.com"
      port    = 5432
      master_user_secret = [{
        secret_arn    = "arn:aws:secretsmanager:us-east-1:123456789012:secret:rds!db-0000-abcdef"
        secret_status = "active"
        kms_key_id    = ""
      }]
    }
  }
  mock_resource "aws_lb" {
    defaults = {
      arn      = "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/openpurr/0000"
      dns_name = "openpurr-123.us-east-1.elb.amazonaws.com"
      zone_id  = "Z35SXDOTRQ7X7K"
    }
  }
  mock_resource "aws_acm_certificate" {
    defaults = {
      arn = "arn:aws:acm:us-east-1:123456789012:certificate/0000"
      domain_validation_options = [{
        domain_name           = "purchases.example.com"
        resource_record_name  = "_abc.purchases.example.com."
        resource_record_type  = "CNAME"
        resource_record_value = "_def.acm-validations.aws."
      }]
    }
  }
  # The provider checks ARNs' shape even when mocked.
  mock_resource "aws_iam_role" {
    defaults = {
      arn = "arn:aws:iam::123456789012:role/openpurr-mock"
    }
  }
  mock_resource "aws_lb_target_group" {
    defaults = {
      arn = "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/openpurr/0000"
    }
  }
  mock_resource "aws_ecs_cluster" {
    defaults = {
      arn = "arn:aws:ecs:us-east-1:123456789012:cluster/openpurr"
    }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = {
      arn = "arn:aws:logs:us-east-1:123456789012:log-group:/ecs/openpurr"
    }
  }
  mock_resource "aws_secretsmanager_secret" {
    defaults = {
      arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:openpurr/mock-AbCdEf"
    }
  }
  mock_resource "aws_sfn_state_machine" {
    defaults = {
      arn = "arn:aws:states:us-east-1:123456789012:stateMachine:openpurr-redeploy"
    }
  }
  mock_resource "aws_ecs_service" {
    defaults = {
      id = "arn:aws:ecs:us-east-1:123456789012:service/openpurr/openpurr"
    }
  }
}

variables {
  image  = "ghcr.io/openpurr/openpurr-standard:0.3.0"
  domain = "purchases.example.com"
}

run "defaults" {
  command = apply

  assert {
    condition     = output.url == "https://purchases.example.com" && output.apple_notification_url == "https://purchases.example.com/notifications/apple" && output.google_notification_url == "https://purchases.example.com/notifications/google"
    error_message = "The domain is the server's address."
  }
  assert {
    condition     = length(aws_vpc.this) == 1 && length(aws_subnet.public) == 2 && length(aws_subnet.private) == 2 && aws_subnet.public[0].availability_zone != aws_subnet.public[1].availability_zone
    error_message = "A new VPC with public and private subnets in two zones."
  }
  assert {
    condition     = length(aws_nat_gateway.this) == 1 && length(aws_route_table.private[0].route) == 1
    error_message = "Tasks in private subnets get out through one NAT gateway."
  }
  assert {
    condition     = aws_ecs_service.server.network_configuration[0].assign_public_ip == false && toset(aws_ecs_service.server.network_configuration[0].subnets) == toset(aws_subnet.private[*].id)
    error_message = "Tasks run in the private subnets without public addresses."
  }
  assert {
    condition     = aws_ecs_task_definition.server.runtime_platform[0].cpu_architecture == "ARM64" && aws_ecs_service.server.launch_type == "FARGATE"
    error_message = "Fargate on arm64 by default."
  }
  assert {
    condition     = aws_ecs_service.server.desired_count == 1 && aws_appautoscaling_target.server.min_capacity == 1 && aws_appautoscaling_target.server.max_capacity == 4 && length(aws_appautoscaling_policy.cpu) == 1
    error_message = "At least one task for the job loop; CPU scaling up to four."
  }
  assert {
    condition     = aws_ecs_service.server.deployment_circuit_breaker[0].enable && aws_ecs_service.server.deployment_circuit_breaker[0].rollback && aws_ecs_service.server.deployment_minimum_healthy_percent == 100
    error_message = "Rolling deployments with the circuit breaker rolling back."
  }
  assert {
    condition     = aws_lb_target_group.server.health_check[0].path == "/healthz" && aws_lb_target_group.server.deregistration_delay == "30"
    error_message = "The load balancer checks /healthz and drains for the stop timeout."
  }
  assert {
    condition = (
      jsondecode(aws_ecs_task_definition.server.container_definitions)[0].stopTimeout == 30 &&
      contains(jsondecode(aws_ecs_task_definition.server.container_definitions)[0].environment, { name = "SHUTDOWN_TIMEOUT_SECONDS", value = "25" })
    )
    error_message = "The server finishes within ECS's stop timeout."
  }
  assert {
    condition = (
      contains(jsondecode(aws_ecs_task_definition.server.container_definitions)[0].environment, { name = "CLIENT_IP_HEADER", value = "X-Forwarded-For" }) &&
      contains(jsondecode(aws_ecs_task_definition.server.container_definitions)[0].environment, { name = "CLIENT_IP_HOPS", value = "1" }) &&
      contains(jsondecode(aws_ecs_task_definition.server.container_definitions)[0].environment, { name = "PUBLIC_URL", value = "https://purchases.example.com" })
    )
    error_message = "The client is the last X-Forwarded-For entry, which the load balancer appends."
  }
  assert {
    condition     = contains(jsondecode(aws_ecs_task_definition.server.container_definitions)[0].environment, { name = "DATABASE_URL", value = "postgres://openpurr.abc123.us-east-1.rds.amazonaws.com:5432/openpurr?sslmode=require&pool_max_conns=5" })
    error_message = "DATABASE_URL holds no credentials and requires TLS."
  }
  assert {
    condition = jsondecode(aws_ecs_task_definition.server.container_definitions)[0].secrets == [
      { name = "OPERATOR_SECRET", valueFrom = aws_secretsmanager_secret.operator_secret.arn },
      { name = "PGPASSWORD", valueFrom = "arn:aws:secretsmanager:us-east-1:123456789012:secret:rds!db-0000-abcdef:password::" },
      { name = "PGUSER", valueFrom = "arn:aws:secretsmanager:us-east-1:123456789012:secret:rds!db-0000-abcdef:username::" },
    ]
    error_message = "The database credentials come from the RDS-managed secret, OPERATOR_SECRET from its own."
  }
  assert {
    condition     = length(jsondecode(aws_ecs_task_definition.server.container_definitions)) == 1 && length(aws_ecs_task_definition.server.volume) == 0
    error_message = "No config, no init container."
  }
  assert {
    condition = (
      aws_db_instance.db.manage_master_user_password && aws_db_instance.db.storage_encrypted && !aws_db_instance.db.publicly_accessible &&
      aws_db_instance.db.deletion_protection && aws_db_instance.db.backup_retention_period == 14 && !aws_db_instance.db.skip_final_snapshot
    )
    error_message = "RDS manages the password; encrypted, private, backed up and protected."
  }
  assert {
    condition     = one([for p in aws_db_parameter_group.db.parameter : p.value if p.name == "rds.force_ssl"]) == "1"
    error_message = "The database requires TLS."
  }
  assert {
    condition     = toset(aws_db_subnet_group.db.subnet_ids) == toset(aws_subnet.private[*].id)
    error_message = "The database is in the private subnets."
  }
  assert {
    condition     = toset(jsondecode(aws_iam_role_policy.execution.policy).Statement[1].Resource) == toset(["arn:aws:secretsmanager:us-east-1:123456789012:secret:rds!db-0000-abcdef", aws_secretsmanager_secret.operator_secret.arn])
    error_message = "The execution role reads only this deployment's secrets."
  }
  assert {
    condition     = length(jsondecode(aws_iam_role_policy.execution.policy).Statement) == 2
    error_message = "No ECR permissions for a ghcr.io image."
  }
  assert {
    condition     = length(aws_secretsmanager_secret_version.operator_secret) == 1 && aws_secretsmanager_secret_version.operator_secret[0].secret_string_wo_version == 1
    error_message = "OPERATOR_SECRET is generated and written write-only."
  }
  assert {
    condition     = aws_lb_listener.http.default_action[0].type == "redirect" && aws_lb_listener.http.default_action[0].redirect[0].protocol == "HTTPS" && aws_lb_listener.https.protocol == "HTTPS"
    error_message = "HTTPS, with plain HTTP redirected."
  }
  assert {
    condition     = length(aws_route53_record.server) == 0 && length(aws_route53_record.validation) == 0 && output.certificate_validation_records[0].value == "_def.acm-validations.aws."
    error_message = "Without a hosted zone, the DNS records are outputs to add by hand."
  }
  assert {
    condition     = strcontains(output.admin_task_command, "--task-definition openpurr-admin") && strcontains(output.admin_task_command, "assignPublicIp=DISABLED")
    error_message = "The admin command runs the admin task in the tasks' subnets."
  }
  assert {
    condition     = jsondecode(aws_cloudwatch_event_rule.db_password_rotated.event_pattern).detail.additionalEventData.SecretId == ["arn:aws:secretsmanager:us-east-1:123456789012:secret:rds!db-0000-abcdef"]
    error_message = "A rotation of the database secret restarts the tasks."
  }
}

run "public_subnets_and_x86" {
  command = apply

  variables {
    tasks_in_public_subnets = true
    cpu_architecture        = "X86_64"
    min_tasks               = 2
    max_tasks               = 2
    stop_timeout            = 60
  }

  assert {
    condition     = length(aws_nat_gateway.this) == 0 && length(aws_eip.nat) == 0 && length(aws_route_table.private[0].route) == 0
    error_message = "No NAT gateway when tasks have public addresses."
  }
  assert {
    condition     = aws_ecs_service.server.network_configuration[0].assign_public_ip && toset(aws_ecs_service.server.network_configuration[0].subnets) == toset(aws_subnet.public[*].id)
    error_message = "Tasks run in the public subnets with public addresses."
  }
  assert {
    condition     = toset(aws_db_subnet_group.db.subnet_ids) == toset(aws_subnet.private[*].id)
    error_message = "The database stays private."
  }
  assert {
    condition     = strcontains(output.admin_task_command, "assignPublicIp=ENABLED")
    error_message = "The admin task needs a public address too, to pull the image."
  }
  assert {
    condition     = aws_ecs_task_definition.server.runtime_platform[0].cpu_architecture == "X86_64" && aws_ecs_task_definition.admin.runtime_platform[0].cpu_architecture == "X86_64"
    error_message = "The architecture can be x86."
  }
  assert {
    condition     = length(aws_appautoscaling_policy.cpu) == 0 && aws_appautoscaling_target.server.min_capacity == 2
    error_message = "max_tasks = min_tasks turns scaling off but keeps the minimum."
  }
  assert {
    condition     = contains(jsondecode(aws_ecs_task_definition.server.container_definitions)[0].environment, { name = "SHUTDOWN_TIMEOUT_SECONDS", value = "55" }) && aws_lb_target_group.server.deregistration_delay == "60"
    error_message = "The shutdown and drain times follow stop_timeout."
  }
}

run "existing_vpc_route53_config_and_secrets" {
  command = apply

  variables {
    vpc_id                   = "vpc-0123456789abcdef0"
    public_subnet_ids        = ["subnet-0aaa", "subnet-0bbb"]
    private_subnet_ids       = ["subnet-0ccc", "subnet-0ddd"]
    route53_zone_id          = "Z0123456789ABCDEFGHIJ"
    config_file              = "tests/openpurr.config.yaml"
    secrets                  = ["APPLE_IAP_KEY", "GOOGLE_SERVICE_ACCOUNT"]
    generate_operator_secret = false
    image                    = "123456789012.dkr.ecr.us-east-1.amazonaws.com/openpurr-standard:0.3.0"
    env                      = { LOG_LEVEL = "debug" }
  }

  assert {
    condition     = length(aws_vpc.this) == 0 && length(aws_nat_gateway.this) == 0 && aws_security_group.tasks.vpc_id == "vpc-0123456789abcdef0"
    error_message = "An existing VPC is used as is."
  }
  assert {
    condition     = aws_ecs_service.server.network_configuration[0].subnets == toset(["subnet-0ccc", "subnet-0ddd"]) && aws_lb.server.subnets == toset(["subnet-0aaa", "subnet-0bbb"])
    error_message = "Tasks in the given private subnets, the load balancer in the public ones."
  }
  assert {
    condition     = length(aws_route53_record.validation) == 1 && aws_route53_record.server[0].alias[0].name == "openpurr-123.us-east-1.elb.amazonaws.com"
    error_message = "With a hosted zone, the module adds the validation and alias records."
  }
  assert {
    condition     = toset([for s in jsondecode(aws_ecs_task_definition.server.container_definitions)[1].secrets : s.name]) == toset(["APPLE_IAP_KEY", "GOOGLE_SERVICE_ACCOUNT", "OPERATOR_SECRET", "PGPASSWORD", "PGUSER"])
    error_message = "Each named secret is an environment variable."
  }
  assert {
    condition     = aws_secretsmanager_secret.store["APPLE_IAP_KEY"].name == "openpurr/APPLE_IAP_KEY" && length(aws_secretsmanager_secret_version.operator_secret) == 0
    error_message = "Named secrets, and OPERATOR_SECRET left for you to fill."
  }
  assert {
    condition     = toset(output.secrets_to_fill) == toset(["openpurr/APPLE_IAP_KEY", "openpurr/GOOGLE_SERVICE_ACCOUNT", "openpurr/OPERATOR_SECRET"])
    error_message = "The secrets to fill are listed."
  }
  assert {
    condition = (
      jsondecode(aws_ecs_task_definition.server.container_definitions)[0].name == "config" &&
      jsondecode(aws_ecs_task_definition.server.container_definitions)[1].dependsOn == [{ containerName = "config", condition = "SUCCESS" }] &&
      contains(jsondecode(aws_ecs_task_definition.server.container_definitions)[1].environment, { name = "OPENPURR_CONFIG", value = "/etc/openpurr/openpurr.config.yaml" }) &&
      contains(jsondecode(aws_ecs_task_definition.server.container_definitions)[1].environment, { name = "LOG_LEVEL", value = "debug" })
    )
    error_message = "The config is written to a shared volume before the server starts."
  }
  assert {
    condition     = length(jsondecode(aws_iam_role_policy.execution.policy).Statement) == 3 && length(jsondecode(aws_iam_role_policy.execution.policy).Statement[1].Resource) == 5
    error_message = "ECR permissions for an ECR image; the named secrets and the config are readable."
  }
}

run "bad_secret_name" {
  command = plan

  variables {
    secrets = ["apple-key"]
  }

  expect_failures = [var.secrets]
}

run "reserved_secret_name" {
  command = plan

  variables {
    secrets = ["PGPASSWORD"]
  }

  expect_failures = [var.secrets]
}

run "existing_vpc_needs_subnets" {
  command = plan

  variables {
    vpc_id            = "vpc-0123456789abcdef0"
    public_subnet_ids = ["subnet-0aaa"]
  }

  expect_failures = [aws_security_group.alb]
}

run "max_below_min" {
  command = plan

  variables {
    min_tasks = 3
    max_tasks = 2
  }

  expect_failures = [var.max_tasks]
}
