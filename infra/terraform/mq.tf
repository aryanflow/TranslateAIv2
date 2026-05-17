resource "random_password" "mq_admin" {
  length  = 32
  special = false
}

resource "aws_security_group" "mq" {
  name        = "${local.prefix}-mq"
  description = "Amazon MQ (RabbitMQ)"
  vpc_id      = aws_vpc.this.id

  ingress {
    description     = "AMQP(S) from app/worker/Batch"
    from_port       = 5671
    to_port         = 5672
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
    Name = "${local.prefix}-mq-sg"
  }
}

resource "aws_mq_broker" "rabbit" {
  broker_name                = replace("${local.prefix}-rabbit", "_", "-")
  engine_type                = "RabbitMQ"
  engine_version             = var.mq_engine_version
  host_instance_type         = var.mq_host_instance_type
  deployment_mode            = "SINGLE_INSTANCE"
  storage_type               = "ebs"
  auto_minor_version_upgrade = true

  subnet_ids          = [aws_subnet.private[0].id]
  security_groups     = [aws_security_group.mq.id]
  publicly_accessible = false

  user {
    username       = var.mq_admin_username
    password       = random_password.mq_admin.result
    console_access = true
  }

  logs {
    general = true
  }

  maintenance_window_start_time {
    day_of_week = "SUNDAY"
    time_of_day = "05:00"
    time_zone   = "UTC"
  }

  tags = {
    Name = "${local.prefix}-rabbitmq"
  }
}
