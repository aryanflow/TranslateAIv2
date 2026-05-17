resource "random_password" "db_master" {
  length  = 32
  special = false
}

resource "aws_security_group" "postgres" {
  name        = "${local.prefix}-postgres"
  description = "PostgreSQL (RDS)"
  vpc_id      = aws_vpc.this.id

  ingress {
    description     = "Postgres from app/worker/Batch"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.internal_app.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.prefix}-postgres-sg"
  }
}

resource "aws_db_subnet_group" "this" {
  name       = "${local.prefix}-db"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name = "${local.prefix}-db-subnets"
  }
}

resource "aws_db_instance" "this" {
  identifier                 = "${local.prefix}-pg"
  engine                     = "postgres"
  engine_version             = var.postgres_engine_version
  instance_class             = var.postgres_instance_class
  allocated_storage          = var.postgres_allocated_storage
  storage_type               = "gp3"
  db_name                    = var.postgres_database_name
  username                   = var.postgres_master_username
  password                   = random_password.db_master.result
  multi_az                   = var.postgres_multi_az
  publicly_accessible        = false
  db_subnet_group_name       = aws_db_subnet_group.this.name
  vpc_security_group_ids     = [aws_security_group.postgres.id]
  backup_retention_period    = var.postgres_backup_retention_days
  skip_final_snapshot        = var.postgres_skip_final_snapshot
  deletion_protection        = var.postgres_deletion_protection
  auto_minor_version_upgrade = true

  tags = {
    Name = "${local.prefix}-postgres"
  }
}

resource "aws_security_group" "redis" {
  name        = "${local.prefix}-redis"
  description = "ElastiCache Redis (BullMQ)"
  vpc_id      = aws_vpc.this.id

  ingress {
    description     = "Redis from app/worker/Batch"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.internal_app.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.prefix}-redis-sg"
  }
}

resource "aws_elasticache_subnet_group" "redis" {
  name       = "${local.prefix}-redis"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name = "${local.prefix}-redis-subnets"
  }
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = substr(replace("${local.prefix}-redis", "_", "-"), 0, 40)
  description                = "BullMQ / SSE Redis"
  engine                     = "redis"
  engine_version             = var.redis_engine_version
  node_type                  = var.redis_node_type
  num_cache_clusters         = 1
  automatic_failover_enabled = false
  multi_az_enabled           = false
  subnet_group_name          = aws_elasticache_subnet_group.redis.name
  security_group_ids         = [aws_security_group.redis.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = false
  parameter_group_name       = "default.redis7"

  tags = {
    Name = "${local.prefix}-redis"
  }
}
