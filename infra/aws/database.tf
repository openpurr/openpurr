# RDS for PostgreSQL in the private subnets, reachable only from the tasks' security group, with
# TLS required, storage encrypted, automated backups with point-in-time recovery and deletion
# protection.
#
# RDS generates the password and keeps it in Secrets Manager (manage_master_user_password), so it
# never passes through OpenTofu or its state. The tasks get the user name and password from that
# secret as PGUSER and PGPASSWORD, which pgx reads when DATABASE_URL leaves them out (see
# service.tf), so the password isn't put in a URL and needs no escaping.

resource "aws_db_subnet_group" "db" {
  name       = var.name
  subnet_ids = local.private_subnet_ids
}

resource "aws_db_parameter_group" "db" {
  name_prefix = "${var.name}-pg${var.db_engine_version}-"
  family      = "postgres${var.db_engine_version}"
  description = "openpurr: TLS required"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_instance" "db" {
  identifier     = var.name
  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class
  multi_az       = var.db_multi_az

  db_name                     = "openpurr"
  username                    = "openpurr"
  manage_master_user_password = true

  storage_type          = "gp3"
  allocated_storage     = var.db_storage_gb
  max_allocated_storage = var.db_max_storage_gb
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.db.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  parameter_group_name   = aws_db_parameter_group.db.name

  # Daily snapshots plus transaction logs: restore to any second within the retention period.
  backup_retention_period = var.db_backup_retention
  backup_window           = "03:00-03:30"         # UTC
  maintenance_window      = "sun:04:00-sun:04:30" # UTC
  copy_tags_to_snapshot   = true

  auto_minor_version_upgrade = true
  deletion_protection        = var.deletion_protection
  # A last snapshot on delete, and the automated backups are kept for their retention period.
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name}-final"
  delete_automated_backups  = false

  # Changes such as the instance class wait for the maintenance window; apply them sooner from the
  # console or with `aws rds modify-db-instance --apply-immediately`.
  apply_immediately = false
}
