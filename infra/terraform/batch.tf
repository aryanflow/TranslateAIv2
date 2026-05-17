data "aws_iam_policy_document" "batch_service_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["batch.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "batch_service" {
  name               = "${local.prefix}-batch-service"
  assume_role_policy = data.aws_iam_policy_document.batch_service_assume.json

  tags = {
    Name = "${local.prefix}-batch-service-role"
  }
}

resource "aws_iam_role_policy_attachment" "batch_service" {
  role       = aws_iam_role.batch_service.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBatchServiceRole"
}

resource "aws_iam_role" "batch_execution" {
  name               = "${local.prefix}-batch-exec"
  assume_role_policy = data.aws_iam_policy_document.batch_job_trust.json

  tags = {
    Name = "${local.prefix}-batch-exec-role"
  }
}

resource "aws_iam_role_policy_attachment" "batch_execution_ecs" {
  role       = aws_iam_role.batch_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy_attachment" "batch_execution_ecr" {
  role       = aws_iam_role.batch_execution.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_role" "batch_job" {
  name               = "${local.prefix}-batch-job"
  assume_role_policy = data.aws_iam_policy_document.batch_job_trust.json

  tags = {
    Name = "${local.prefix}-batch-job-role"
  }
}

resource "aws_iam_role_policy_attachment" "batch_job_uploads" {
  role       = aws_iam_role.batch_job.name
  policy_arn = aws_iam_policy.uploads_rw.arn
}

data "aws_iam_policy_document" "bedrock_invoke" {
  statement {
    sid    = "BedrockFoundationModels"
    effect = "Allow"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
    ]
    resources = [
      "arn:aws:bedrock:${var.aws_region}::foundation-model/*",
    ]
  }
}

resource "aws_iam_policy" "bedrock_invoke" {
  name        = "${local.prefix}-bedrock-invoke"
  description = "Invoke Amazon Bedrock foundation models in ${var.aws_region}"
  policy      = data.aws_iam_policy_document.bedrock_invoke.json

  tags = {
    Name = "${local.prefix}-policy-bedrock-invoke"
  }
}

resource "aws_iam_role_policy_attachment" "batch_job_bedrock" {
  role       = aws_iam_role.batch_job.name
  policy_arn = aws_iam_policy.bedrock_invoke.arn
}

resource "aws_cloudwatch_log_group" "batch" {
  name              = "/aws/batch/${local.prefix}-translate"
  retention_in_days = var.log_retention_days

  tags = {
    Name = "${local.prefix}-batch-logs"
  }
}

resource "aws_batch_compute_environment" "fargate" {
  compute_environment_name = "${local.prefix}-fargate"
  type                     = "MANAGED"
  state                    = "ENABLED"
  service_role             = aws_iam_role.batch_service.arn

  compute_resources {
    type               = "FARGATE"
    max_vcpus          = var.batch_max_vcpus
    subnets            = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.internal_app.id]
  }

  tags = {
    Name = "${local.prefix}-batch-fargate-ce"
  }

  depends_on = [aws_iam_role_policy_attachment.batch_service]
}

resource "aws_batch_job_queue" "translate" {
  name     = "${local.prefix}-translate"
  state    = "ENABLED"
  priority = 10

  compute_environment_order {
    order               = 1
    compute_environment = aws_batch_compute_environment.fargate.arn
  }

  tags = {
    Name = "${local.prefix}-batch-translate-queue"
  }
}

resource "aws_batch_job_definition" "translate_worker" {
  name = "${local.prefix}-translate-worker"
  type = "container"

  platform_capabilities = ["FARGATE"]

  container_properties = jsonencode({
    image = "${aws_ecr_repository.batch_worker.repository_url}:${var.batch_image_tag}"

    resourceRequirements = [
      { type = "VCPU", value = tostring(var.batch_vcpu) },
      { type = "MEMORY", value = tostring(var.batch_memory_mb) },
    ]

    executionRoleArn = aws_iam_role.batch_execution.arn
    jobRoleArn       = aws_iam_role.batch_job.arn

    networkConfiguration = {
      assignPublicIp = "DISABLED"
    }

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.batch.name
        "awslogs-region"        = data.aws_region.current.name
        "awslogs-stream-prefix" = "translate"
      }
    }

    environment = concat(
      [
        {
          name  = "AWS_REGION"
          value = var.aws_region
        },
        {
          name  = "S3_BUCKET"
          value = aws_s3_bucket.uploads.id
        },
        {
          name  = "S3_REGION"
          value = var.aws_region
        },
      ],
      var.batch_container_environment,
    )
  })

  tags = {
    Name = "${local.prefix}-translate-worker-jd"
  }
}
