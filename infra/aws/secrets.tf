# Secrets Manager: OPERATOR_SECRET, generated here and written write-only (it never enters the
# state), the secrets your config names, whose values you add yourself, and the config file. The
# database's credentials are in the secret RDS manages (database.tf).

resource "aws_secretsmanager_secret" "operator_secret" {
  name        = "${var.name}/OPERATOR_SECRET"
  description = "openpurr: the back office's password pepper and authenticator key. Don't change or delete it."
}

ephemeral "random_password" "operator_secret" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret_version" "operator_secret" {
  count            = var.generate_operator_secret ? 1 : 0
  secret_id        = aws_secretsmanager_secret.operator_secret.id
  secret_string_wo = ephemeral.random_password.operator_secret.result
  # Fixed: a new OPERATOR_SECRET invalidates every password and authenticator.
  secret_string_wo_version = 1
}

resource "aws_secretsmanager_secret" "store" {
  for_each    = toset(var.secrets)
  name        = "${var.name}/${each.value}"
  description = "openpurr: ${each.value}, named in the config"
}

resource "aws_secretsmanager_secret" "config" {
  count       = var.config_file != "" ? 1 : 0
  name        = "${var.name}/config"
  description = "openpurr: the config imported on the first start"
}

resource "aws_secretsmanager_secret_version" "config" {
  count         = var.config_file != "" ? 1 : 0
  secret_id     = aws_secretsmanager_secret.config[0].id
  secret_string = file(var.config_file)
}

locals {
  db_secret_arn = aws_db_instance.db.master_user_secret[0].secret_arn

  # Environment variable => Secrets Manager reference, for the server's task definition. A JSON key
  # is selected with <arn>:<key>:: (the RDS secret holds {"username": ..., "password": ...}).
  server_secrets = merge(
    {
      PGUSER          = "${local.db_secret_arn}:username::"
      PGPASSWORD      = "${local.db_secret_arn}:password::"
      OPERATOR_SECRET = aws_secretsmanager_secret.operator_secret.arn
    },
    { for k, s in aws_secretsmanager_secret.store : k => s.arn },
  )

  # The only secrets the execution role may read.
  readable_secret_arns = concat(
    [local.db_secret_arn, aws_secretsmanager_secret.operator_secret.arn],
    [for s in aws_secretsmanager_secret.store : s.arn],
    [for s in aws_secretsmanager_secret.config : s.arn],
  )
}
