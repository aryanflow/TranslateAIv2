# -----------------------------------------------------------------------------
# ECS Fargate + dual ALB (API + Web) — public HTTP URLs without custom DNS.
# Push images to ECR before services stabilize (see infra/terraform/README.md).
# -----------------------------------------------------------------------------

locals {
  api_database_url = format(
    "postgresql://%s:%s@%s/%s",
    var.postgres_master_username,
    urlencode(random_password.db_master.result),
    aws_db_instance.this.endpoint,
    var.postgres_database_name,
  )
  api_redis_url = "redis://${aws_elasticache_replication_group.redis.primary_endpoint_address}:6379"
}

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_security_group" "alb_api" {
  name        = "${local.prefix}-alb-api"
  description = "Internet-facing ALB to API targets"
  vpc_id      = aws_vpc.this.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.prefix}-alb-api-sg"
  }
}

resource "aws_security_group" "alb_web" {
  name        = "${local.prefix}-alb-web"
  description = "Internet-facing ALB to Next.js targets"
  vpc_id      = aws_vpc.this.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.prefix}-alb-web-sg"
  }
}

resource "aws_security_group" "ecs_api_from_alb" {
  name        = "${local.prefix}-ecs-api-from-alb"
  description = "Nest API containers - listener traffic from API ALB only"
  vpc_id      = aws_vpc.this.id

  ingress {
    description     = "ALB to Nest"
    from_port       = 3001
    to_port         = 3001
    protocol        = "tcp"
    security_groups = [aws_security_group.alb_api.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.prefix}-ecs-api-from-alb-sg"
  }
}

resource "aws_security_group" "ecs_web_from_alb" {
  name        = "${local.prefix}-ecs-web-from-alb"
  description = "Next.js containers - listener traffic from Web ALB only"
  vpc_id      = aws_vpc.this.id

  ingress {
    description     = "ALB to Next"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb_web.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.prefix}-ecs-web-from-alb-sg"
  }
}

resource "aws_lb" "api" {
  name                       = substr("${replace(local.prefix, "_", "-")}-api", 0, 32)
  internal                   = false
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.alb_api.id]
  subnets                    = aws_subnet.public[*].id
  drop_invalid_header_fields = true

  tags = {
    Name = "${local.prefix}-alb-api"
  }

  depends_on = [aws_internet_gateway.this]
}

resource "aws_lb" "web" {
  name                       = substr("${replace(local.prefix, "_", "-")}-web", 0, 32)
  internal                   = false
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.alb_web.id]
  subnets                    = aws_subnet.public[*].id
  drop_invalid_header_fields = true

  tags = {
    Name = "${local.prefix}-alb-web"
  }

  depends_on = [aws_internet_gateway.this]
}

resource "aws_lb_target_group" "api" {
  name        = substr("${replace(local.prefix, "_", "-")}-api-tg", 0, 32)
  port        = 3001
  protocol    = "HTTP"
  vpc_id      = aws_vpc.this.id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    path                = "/health/live"
    matcher             = "200"
    protocol            = "HTTP"
    port                = "traffic-port"
  }

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "${local.prefix}-api-tg"
  }
}

resource "aws_lb_target_group" "web" {
  name        = substr("${replace(local.prefix, "_", "-")}-web-tg", 0, 32)
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.this.id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    # "/" redirects to /translate (307); ALB matcher 200 would never pass.
    path     = "/health"
    matcher  = "200"
    protocol = "HTTP"
    port     = "traffic-port"
  }

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "${local.prefix}-web-tg"
  }
}

resource "aws_lb_listener" "api_http" {
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

resource "aws_lb_listener" "web_http" {
  load_balancer_arn = aws_lb.web.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_cloudwatch_log_group" "ecs_api" {
  name              = "/ecs/${local.prefix}-api"
  retention_in_days = var.log_retention_days

  tags = {
    Name = "${local.prefix}-ecs-api-logs"
  }
}

resource "aws_cloudwatch_log_group" "ecs_web" {
  name              = "/ecs/${local.prefix}-web"
  retention_in_days = var.log_retention_days

  tags = {
    Name = "${local.prefix}-ecs-web-logs"
  }
}

resource "aws_iam_role" "ecs_api_execution" {
  name               = "${local.prefix}-ecs-api-exec"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json

  tags = {
    Name = "${local.prefix}-ecs-api-exec-role"
  }
}

resource "aws_iam_role_policy_attachment" "ecs_api_execution_ecs" {
  role       = aws_iam_role.ecs_api_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy_attachment" "ecs_api_execution_ecr" {
  role       = aws_iam_role.ecs_api_execution.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_role" "ecs_api_task" {
  name               = "${local.prefix}-ecs-api-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json

  tags = {
    Name = "${local.prefix}-ecs-api-task-role"
  }
}

resource "aws_iam_role_policy_attachment" "ecs_api_task_bedrock" {
  role       = aws_iam_role.ecs_api_task.name
  policy_arn = aws_iam_policy.bedrock_invoke.arn
}

resource "aws_iam_role_policy_attachment" "ecs_api_task_s3" {
  role       = aws_iam_role.ecs_api_task.name
  policy_arn = aws_iam_policy.uploads_rw.arn
}

resource "aws_iam_role" "ecs_web_execution" {
  name               = "${local.prefix}-ecs-web-exec"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json

  tags = {
    Name = "${local.prefix}-ecs-web-exec-role"
  }
}

resource "aws_iam_role_policy_attachment" "ecs_web_execution_ecs" {
  role       = aws_iam_role.ecs_web_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy_attachment" "ecs_web_execution_ecr" {
  role       = aws_iam_role.ecs_web_execution.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_ecs_cluster" "this" {
  name = "${local.prefix}-cluster"

  tags = {
    Name = "${local.prefix}-ecs-cluster"
  }
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.prefix}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.ecs_api_cpu)
  memory                   = tostring(var.ecs_api_memory_mb)
  execution_role_arn       = aws_iam_role.ecs_api_execution.arn
  task_role_arn            = aws_iam_role.ecs_api_task.arn

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = "${aws_ecr_repository.api.repository_url}:${var.ecs_image_tag}"
      essential = true
      portMappings = [
        {
          containerPort = 3001
          hostPort      = 3001
          protocol      = "tcp"
        }
      ]
      environment = concat(
        [
          { name = "PORT", value = "3001" },
          { name = "NODE_ENV", value = "production" },
          { name = "DATABASE_URL", value = local.api_database_url },
          { name = "REDIS_URL", value = local.api_redis_url },
          { name = "AWS_REGION", value = var.aws_region },
          { name = "S3_BUCKET", value = aws_s3_bucket.uploads.id },
          { name = "S3_REGION", value = var.aws_region },
          { name = "BEDROCK_TRANSLATION_MODEL_ID", value = var.ecs_bedrock_translation_model_id },
          { name = "BEDROCK_SCORING_MODEL_ID", value = var.ecs_bedrock_scoring_model_id },
        ],
        [
          {
            name = "GIT_SHA"
            value = (
              var.ecs_git_sha_label != "" ? var.ecs_git_sha_label : "terraform"
            )
          },
        ],
      )
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs_api.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "api"
        }
      }
    },
  ])

  tags = {
    Name = "${local.prefix}-ecs-taskdef-api"
  }
}

resource "aws_ecs_task_definition" "web" {
  family                   = "${local.prefix}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.ecs_web_cpu)
  memory                   = tostring(var.ecs_web_memory_mb)
  execution_role_arn       = aws_iam_role.ecs_web_execution.arn

  container_definitions = jsonencode([
    {
      name      = "web"
      image     = "${aws_ecr_repository.web.repository_url}:${var.ecs_image_tag}"
      essential = true
      portMappings = [
        {
          containerPort = 3000
          hostPort      = 3000
          protocol      = "tcp"
        }
      ]
      environment = [
        {
          name  = "NODE_ENV"
          value = "production"
        },
        {
          name  = "API_PROXY_TARGET"
          value = "http://${aws_lb.api.dns_name}"
        },
        {
          name  = "NEXT_PUBLIC_DEV_TENANT_ID"
          value = var.ecs_web_dev_tenant_id
        },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs_web.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "web"
        }
      }
    },
  ])

  tags = {
    Name = "${local.prefix}-ecs-taskdef-web"
  }
}

resource "aws_ecs_service" "api" {
  name            = "${local.prefix}-api"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.ecs_desired_count
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.internal_app.id, aws_security_group.ecs_api_from_alb.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3001
  }

  tags = {
    Name = "${local.prefix}-ecs-service-api"
  }

  lifecycle {
    ignore_changes = [desired_count]
  }

  depends_on = [aws_lb_listener.api_http]
}

resource "aws_ecs_service" "web" {
  name            = "${local.prefix}-web"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = var.ecs_desired_count
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_web_from_alb.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }

  tags = {
    Name = "${local.prefix}-ecs-service-web"
  }

  lifecycle {
    ignore_changes = [desired_count]
  }

  depends_on = [aws_lb_listener.web_http]
}
