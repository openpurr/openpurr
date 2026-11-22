# openpurr Standard on AWS: ECS on Fargate running the server, RDS for PostgreSQL, Secrets Manager
# for its secrets, and an Application Load Balancer with an ACM certificate on your domain. See
# docs/standard-on-aws.md.

locals {
  port     = 8080
  base_url = "https://${var.domain}"

  # ECR images need the execution role's ECR permissions; ghcr.io and other public images don't.
  from_ecr = can(regex("^[0-9]{12}\\.dkr\\.ecr\\.", var.image))
}

resource "aws_ecs_cluster" "this" {
  name = var.name
}

# The server's and the admin task's logs: JSON lines (LOG_FORMAT=json), so CloudWatch Logs
# Insights reads the level and message fields.
resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${var.name}"
  retention_in_days = var.log_retention_days
}

# The execution role is what ECS itself uses to start a task: pull the image, write its logs and
# read its secrets (only this deployment's). The tasks get no role at all: the server calls no AWS
# API, so it holds no AWS credentials.
resource "aws_iam_role" "execution" {
  name = "${var.name}-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "execution" {
  name = "start-openpurr-tasks"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [
        {
          Sid      = "Logs"
          Effect   = "Allow"
          Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
          Resource = "${aws_cloudwatch_log_group.this.arn}:*"
        },
        {
          # Secrets encrypted with the default aws/secretsmanager key need no KMS permission here.
          Sid      = "Secrets"
          Effect   = "Allow"
          Action   = "secretsmanager:GetSecretValue"
          Resource = local.readable_secret_arns
        },
      ],
      local.from_ecr ? [{
        Sid      = "ECR"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken", "ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"]
        Resource = "*"
      }] : [],
    )
  })
}
