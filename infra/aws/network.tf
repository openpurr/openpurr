# The network: without vpc_id, a VPC with a public and a private subnet in each of two Availability
# Zones, an internet gateway and (unless tasks_in_public_subnets) one NAT gateway. Then three
# security groups, each admitting only the one before it: the internet to the load balancer, the
# load balancer to the tasks, the tasks to the database.

locals {
  create_vpc = var.vpc_id == ""
  vpc_id     = local.create_vpc ? aws_vpc.this[0].id : var.vpc_id

  public_subnet_ids  = local.create_vpc ? aws_subnet.public[*].id : var.public_subnet_ids
  private_subnet_ids = local.create_vpc ? aws_subnet.private[*].id : var.private_subnet_ids

  # Where the tasks (the server and the admin task) run.
  task_subnet_ids = var.tasks_in_public_subnets ? local.public_subnet_ids : local.private_subnet_ids

  # One NAT gateway, not one per zone: if its zone fails, tasks in the other zone lose their way
  # out until it's back. That trade is fine at this size; add a second for more.
  create_nat = local.create_vpc && !var.tasks_in_public_subnets

  azs = slice(data.aws_availability_zones.available.names, 0, 2)
}

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "this" {
  count                = local.create_vpc ? 1 : 0
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = var.name }

  lifecycle {
    precondition {
      condition     = length(data.aws_availability_zones.available.names) >= 2
      error_message = "The region needs two Availability Zones."
    }
  }
}

resource "aws_subnet" "public" {
  count             = local.create_vpc ? 2 : 0
  vpc_id            = aws_vpc.this[0].id
  availability_zone = local.azs[count.index]
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index)
  # Only tasks get public addresses, and only with tasks_in_public_subnets (set on the service).
  map_public_ip_on_launch = false
  tags                    = { Name = "${var.name}-public-${local.azs[count.index]}" }
}

resource "aws_subnet" "private" {
  count             = local.create_vpc ? 2 : 0
  vpc_id            = aws_vpc.this[0].id
  availability_zone = local.azs[count.index]
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, 10 + count.index)
  tags              = { Name = "${var.name}-private-${local.azs[count.index]}" }
}

resource "aws_internet_gateway" "this" {
  count  = local.create_vpc ? 1 : 0
  vpc_id = aws_vpc.this[0].id
  tags   = { Name = var.name }
}

resource "aws_route_table" "public" {
  count  = local.create_vpc ? 1 : 0
  vpc_id = aws_vpc.this[0].id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this[0].id
  }
  tags = { Name = "${var.name}-public" }
}

resource "aws_route_table_association" "public" {
  count          = local.create_vpc ? 2 : 0
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public[0].id
}

resource "aws_eip" "nat" {
  count  = local.create_nat ? 1 : 0
  domain = "vpc"
  tags   = { Name = "${var.name}-nat" }
}

resource "aws_nat_gateway" "this" {
  count         = local.create_nat ? 1 : 0
  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public[0].id
  tags          = { Name = var.name }
  depends_on    = [aws_internet_gateway.this]
}

# Without a NAT gateway the private subnets have no way out, which the database doesn't need.
resource "aws_route_table" "private" {
  count  = local.create_vpc ? 1 : 0
  vpc_id = aws_vpc.this[0].id
  dynamic "route" {
    for_each = local.create_nat ? [1] : []
    content {
      cidr_block     = "0.0.0.0/0"
      nat_gateway_id = aws_nat_gateway.this[0].id
    }
  }
  tags = { Name = "${var.name}-private" }
}

resource "aws_route_table_association" "private" {
  count          = local.create_vpc ? 2 : 0
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[0].id
}

# --- Security groups -------------------------------------------------------------------------------

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "openpurr load balancer: HTTP and HTTPS from anywhere"
  vpc_id      = local.vpc_id

  lifecycle {
    precondition {
      condition     = local.create_vpc || (length(var.public_subnet_ids) >= 2 && length(var.private_subnet_ids) >= 2)
      error_message = "With vpc_id, set public_subnet_ids and private_subnet_ids (two or more each, in different Availability Zones)."
    }
  }
}

resource "aws_vpc_security_group_ingress_rule" "alb" {
  for_each          = { for r in setproduct([80, 443], ["0.0.0.0/0", "::/0"]) : "${r[0]}-${r[1]}" => r }
  security_group_id = aws_security_group.alb.id
  ip_protocol       = "tcp"
  from_port         = each.value[0]
  to_port           = each.value[0]
  cidr_ipv4         = strcontains(each.value[1], ":") ? null : each.value[1]
  cidr_ipv6         = strcontains(each.value[1], ":") ? each.value[1] : null
}

resource "aws_vpc_security_group_egress_rule" "alb_to_tasks" {
  security_group_id            = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = local.port
  to_port                      = local.port
  referenced_security_group_id = aws_security_group.tasks.id
}

resource "aws_security_group" "tasks" {
  name        = "${var.name}-tasks"
  description = "openpurr tasks: the server's port from the load balancer only"
  vpc_id      = local.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "tasks_from_alb" {
  security_group_id            = aws_security_group.tasks.id
  ip_protocol                  = "tcp"
  from_port                    = local.port
  to_port                      = local.port
  referenced_security_group_id = aws_security_group.alb.id
}

# Out to the stores, ghcr.io, AWS's APIs (Secrets Manager, CloudWatch Logs) and webhook endpoints.
# DNS goes to the VPC's resolver, which security groups don't filter.
resource "aws_vpc_security_group_egress_rule" "tasks_out" {
  for_each          = toset([for p in var.egress_ports : tostring(p)])
  security_group_id = aws_security_group.tasks.id
  ip_protocol       = "tcp"
  from_port         = tonumber(each.value)
  to_port           = tonumber(each.value)
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "tasks_to_db" {
  security_group_id            = aws_security_group.tasks.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.db.id
}

# No egress rules: the database answers connections, it doesn't open any.
resource "aws_security_group" "db" {
  name        = "${var.name}-db"
  description = "openpurr database: Postgres from the tasks only"
  vpc_id      = local.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "db_from_tasks" {
  security_group_id            = aws_security_group.db.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.tasks.id
}
