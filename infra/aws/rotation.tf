# RDS rotates the database password it manages (every 7 days by default). ECS reads secrets only
# when a task starts, so running tasks keep the old password: their open connections still work,
# but new ones fail. When a rotation succeeds, this restarts the service's tasks (a rolling
# deployment, no downtime) so they pick up the new password.
#
# EventBridge sees Secrets Manager's RotationSucceeded event and starts a one-step Step Functions
# state machine that calls ecs:UpdateService with forceNewDeployment. No Lambda code. Should the
# event ever be missed, /healthz fails once the old connections are gone and ECS replaces the
# tasks anyway, with an interruption.

resource "aws_cloudwatch_event_rule" "db_password_rotated" {
  name        = "${var.name}-db-password-rotated"
  description = "openpurr: the database password was rotated; restart the tasks"
  event_pattern = jsonencode({
    source      = ["aws.secretsmanager"]
    detail-type = ["AWS Service Event via CloudTrail"]
    detail = {
      eventSource         = ["secretsmanager.amazonaws.com"]
      eventName           = ["RotationSucceeded"]
      additionalEventData = { SecretId = [local.db_secret_arn] }
    }
  })
}

resource "aws_sfn_state_machine" "redeploy" {
  name     = "${var.name}-redeploy"
  role_arn = aws_iam_role.redeploy.arn
  definition = jsonencode({
    Comment = "Restart openpurr's tasks so they read the rotated database password"
    StartAt = "Redeploy"
    States = {
      Redeploy = {
        Type     = "Task"
        Resource = "arn:aws:states:::aws-sdk:ecs:updateService"
        Parameters = {
          Cluster            = aws_ecs_cluster.this.arn
          Service            = aws_ecs_service.server.name
          ForceNewDeployment = true
        }
        End = true
      }
    }
  })
}

resource "aws_iam_role" "redeploy" {
  name = "${var.name}-redeploy"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "states.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "redeploy" {
  name = "redeploy-openpurr"
  role = aws_iam_role.redeploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "ecs:UpdateService"
      Resource = aws_ecs_service.server.id
    }]
  })
}

resource "aws_iam_role" "events" {
  name = "${var.name}-events"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "events.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "events" {
  name = "start-redeploy"
  role = aws_iam_role.events.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "states:StartExecution"
      Resource = aws_sfn_state_machine.redeploy.arn
    }]
  })
}

resource "aws_cloudwatch_event_target" "redeploy" {
  rule     = aws_cloudwatch_event_rule.db_password_rotated.name
  arn      = aws_sfn_state_machine.redeploy.arn
  role_arn = aws_iam_role.events.arn
}
