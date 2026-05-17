output "environment" {
  value       = var.environment
  description = "Logical environment name."
}

output "region" {
  value       = var.aws_region
  description = "Deployed AWS region."
}

output "vpc_id" {
  value       = aws_vpc.this.id
  description = "VPC containing ALB, ECS, RDS, Redis, MQ, Batch."
}

output "private_subnet_ids" {
  value       = aws_subnet.private[*].id
  description = "Private subnets (NAT egress) — Batch, RDS, Redis, MQ."
}

output "public_subnet_ids" {
  value       = aws_subnet.public[*].id
  description = "Public subnets — ALB, NAT."
}

output "internal_security_group_id" {
  value       = aws_security_group.internal_app.id
  description = "Attach to ECS tasks, Lambda ENIs, or other workers that need DB/Redis/MQ/S3."
}

output "database_url" {
  value = format(
    "postgresql://%s:%s@%s/%s",
    var.postgres_master_username,
    urlencode(random_password.db_master.result),
    aws_db_instance.this.endpoint,
    var.postgres_database_name,
  )
  sensitive   = true
  description = "Prisma DATABASE_URL for RDS (password is URL-encoded)."
}

output "redis_url" {
  value       = "redis://${aws_elasticache_replication_group.redis.primary_endpoint_address}:6379"
  sensitive   = true
  description = "REDIS_URL for existing BullMQ pipeline."
}

output "s3_bucket" {
  value       = aws_s3_bucket.uploads.id
  description = "Uploads bucket (set S3_BUCKET / omit S3_ENDPOINT for real AWS S3)."
}

output "public_api_url" {
  value       = "http://${aws_lb.api.dns_name}"
  description = "Public HTTP URL for the Nest API (ALB)."
}

output "public_web_url" {
  value       = "http://${aws_lb.web.dns_name}"
  description = "Public HTTP URL for the Next.js UI (ALB)."
}

output "ecs_cluster_name" {
  value       = aws_ecs_cluster.this.name
  description = "ECS cluster hosting API + Web services."
}

output "ecs_service_api_name" {
  value       = aws_ecs_service.api.name
  description = "ECS service name for the Nest API."
}

output "ecs_service_web_name" {
  value       = aws_ecs_service.web.name
  description = "ECS service name for Next.js."
}

output "ecr_web_repository_url" {
  value       = aws_ecr_repository.web.repository_url
  description = "Push the Next.js image: docker/Dockerfile.web"
}

output "ecr_api_repository_url" {
  value       = aws_ecr_repository.api.repository_url
  description = "Push the Nest API image: docker/Dockerfile.api"
}

output "ecr_batch_worker_repository_url" {
  value       = aws_ecr_repository.batch_worker.repository_url
  description = "Push the Batch worker image referenced by the job definition."
}

output "amazon_mq_rabbit_primary_amqps" {
  value       = "amqps://${var.mq_admin_username}:${urlencode(random_password.mq_admin.result)}@${aws_mq_broker.rabbit.instances[0].endpoints[0]}:5671"
  sensitive   = true
  description = "RabbitMQ AMQPS URL (console user; use Secrets Manager in production)."
}

output "amazon_mq_console_url" {
  # AWS occasionally returns console_url already prefixed with https://; normalize duplicates.
  value = replace(
    aws_mq_broker.rabbit.instances[0].console_url,
    "https://https://",
    "https://",
  )
  sensitive   = false
  description = "RabbitMQ management UI (within VPC or over VPN / bastion)."
}

output "batch_job_queue_arn" {
  value       = aws_batch_job_queue.translate.arn
  description = "Submit translation Batch jobs to this queue."
}

output "batch_job_queue_name" {
  value       = aws_batch_job_queue.translate.name
  description = "Name for aws batch submit-job --job-queue"
}

output "batch_job_definition_arn" {
  value       = aws_batch_job_definition.translate_worker.arn
  description = "Job definition ARN for aws batch submit-job --job-definition"
}

output "bedrock_invoke_policy_arn" {
  value       = aws_iam_policy.bedrock_invoke.arn
  description = "Attached to ECS API task role and Batch job role."
}

output "hints" {
  value = {
    bullmq_uses_redis          = true
    amazon_mq_for_amqp         = true
    batch_runs_in_private_subs = true
    next_steps                 = "terraform output public_web_url / public_api_url — push api + web images to ECR (scripts/push-ecr-aws.sh), run prisma migrate + seed against RDS."
  }
  description = "Quick orientation."
}
