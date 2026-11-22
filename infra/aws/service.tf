# The server as an ECS service on Fargate, and a task definition for one-off `openpurr admin ...`
# runs with the same image and database access (to create the owner and print recovery links; see
# docs/standard-on-aws.md).

locals {
  # No user or password: pgx takes them from PGUSER and PGPASSWORD (secrets.tf). sslmode=require
  # encrypts the connection; the server's image doesn't carry the RDS certificate authority, so it
  # can't verify the certificate, and the security groups are what keep anyone else off the path.
  database_url = "postgres://${aws_db_instance.db.address}:${aws_db_instance.db.port}/${aws_db_instance.db.db_name}?sslmode=require&pool_max_conns=${var.db_pool_size}"

  config_path = "/etc/openpurr/openpurr.config.yaml"

  server_env = merge(
    {
      DATABASE_URL = local.database_url
      PUBLIC_URL   = local.base_url
      # The load balancer appends the client's address to X-Forwarded-For, so the client is the
      # last entry. The tasks only accept connections from the load balancer, so it can't be skipped.
      CLIENT_IP_HEADER = "X-Forwarded-For"
      CLIENT_IP_HOPS   = "1"
      LOG_FORMAT       = "json"
      # Finish in-flight work before ECS's stop timeout kills the container.
      SHUTDOWN_TIMEOUT_SECONDS = tostring(var.stop_timeout - 5)
    },
    var.config_file != "" ? { OPENPURR_CONFIG = local.config_path } : {},
    var.env,
  )

  log_options = {
    "awslogs-group"  = aws_cloudwatch_log_group.this.name
    "awslogs-region" = var.region
  }

  server_container = {
    name                   = "openpurr"
    image                  = var.image
    essential              = true
    readonlyRootFilesystem = true
    portMappings           = [{ containerPort = local.port, protocol = "tcp" }]
    environment            = [for k in sort(keys(local.server_env)) : { name = k, value = local.server_env[k] }]
    secrets                = [for k in sort(keys(local.server_secrets)) : { name = k, valueFrom = local.server_secrets[k] }]
    stopTimeout            = var.stop_timeout
    mountPoints            = var.config_file != "" ? [{ sourceVolume = "config", containerPath = "/etc/openpurr", readOnly = true }] : []
    dependsOn              = var.config_file != "" ? [{ containerName = "config", condition = "SUCCESS" }] : []
    logConfiguration = {
      logDriver = "awslogs"
      options   = merge(local.log_options, { "awslogs-stream-prefix" = "server" })
    }
    # No container health check: the image is distroless (no shell or curl). The load balancer's
    # check on /healthz decides, and ECS replaces a task it marks unhealthy.
  }

  # The image has no shell, so a small init container writes the config from Secrets Manager to a
  # volume the server reads, then exits.
  config_container = {
    name                   = "config"
    image                  = "public.ecr.aws/docker/library/busybox:1.37"
    essential              = false
    readonlyRootFilesystem = true
    command                = ["sh", "-c", "printf '%s' \"$OPENPURR_CONFIG_YAML\" > ${local.config_path}"]
    secrets                = [for s in aws_secretsmanager_secret.config : { name = "OPENPURR_CONFIG_YAML", valueFrom = s.arn }]
    mountPoints            = [{ sourceVolume = "config", containerPath = "/etc/openpurr", readOnly = false }]
    logConfiguration = {
      logDriver = "awslogs"
      options   = merge(local.log_options, { "awslogs-stream-prefix" = "config" })
    }
  }
}

resource "aws_ecs_task_definition" "server" {
  family                   = var.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }

  dynamic "volume" {
    for_each = var.config_file != "" ? [1] : []
    content {
      name = "config"
    }
  }

  container_definitions = jsonencode(concat(
    var.config_file != "" ? [local.config_container] : [],
    [local.server_container],
  ))
}

resource "aws_ecs_service" "server" {
  name            = var.name
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.server.arn
  launch_type     = "FARGATE"
  # Auto scaling (below) keeps the count between min_tasks and max_tasks.
  desired_count = var.min_tasks

  # Rolling deployments: new tasks start and pass the health check before old ones stop. A
  # deployment whose tasks keep failing is rolled back to the last one that worked.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  # Migrations run at startup, before /healthz answers.
  health_check_grace_period_seconds = 120

  network_configuration {
    subnets          = local.task_subnet_ids
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = var.tasks_in_public_subnets
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.server.arn
    container_name   = "openpurr"
    container_port   = local.port
  }

  propagate_tags          = "SERVICE"
  enable_ecs_managed_tags = true

  lifecycle {
    ignore_changes = [desired_count]
  }

  depends_on = [
    aws_lb_listener.https,
    aws_iam_role_policy.execution,
    aws_secretsmanager_secret_version.operator_secret,
    aws_secretsmanager_secret_version.config,
  ]
}

# Always registered, so min_tasks applies even without scaling: raising it starts tasks.
resource "aws_appautoscaling_target" "server" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.server.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.min_tasks
  max_capacity       = var.max_tasks
}

resource "aws_appautoscaling_policy" "cpu" {
  count              = var.max_tasks > var.min_tasks ? 1 : 0
  name               = "${var.name}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.server.service_namespace
  resource_id        = aws_appautoscaling_target.server.resource_id
  scalable_dimension = aws_appautoscaling_target.server.scalable_dimension

  target_tracking_scaling_policy_configuration {
    target_value = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

# `openpurr admin ...` (create, login-link, list, require-totp), run with `aws ecs run-task` (the
# admin_task_command output). Its output (setup and recovery links) is in the admin/ log streams.
resource "aws_ecs_task_definition" "admin" {
  family                   = "${var.name}-admin"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }

  container_definitions = jsonencode([{
    name                   = "openpurr"
    image                  = var.image
    essential              = true
    readonlyRootFilesystem = true
    command                = ["admin", "list"]
    environment = [
      { name = "DATABASE_URL", value = local.database_url },
      { name = "PUBLIC_URL", value = local.base_url },
    ]
    secrets = [
      { name = "PGPASSWORD", valueFrom = local.server_secrets.PGPASSWORD },
      { name = "PGUSER", valueFrom = local.server_secrets.PGUSER },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options   = merge(local.log_options, { "awslogs-stream-prefix" = "admin" })
    }
  }])
}
