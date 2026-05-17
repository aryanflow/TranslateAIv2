# -----------------------------------------------------------------------------
# General
# -----------------------------------------------------------------------------

variable "project_name" {
  type        = string
  description = "Prefix for resource names."
  default     = "translate-ai"
}

variable "environment" {
  type        = string
  description = "Logical name (e.g. staging, prod)."
  default     = "dev"
}

variable "aws_region" {
  type        = string
  description = "AWS region (must match Bedrock model availability)."
  default     = "us-east-1"
}

variable "vpc_cidr" {
  type        = string
  description = "VPC IPv4 CIDR."
  default     = "10.42.0.0/16"
}

variable "az_count" {
  type        = number
  description = "Number of availability zones (2 recommended)."
  default     = 2
}

variable "project_tag" {
  type        = string
  default     = null
  nullable    = true
  description = "Tag value for Project on AWS resources (defaults to project_name)."
}

variable "extra_tags" {
  type        = map(string)
  default     = {}
  description = "Additional tags merged into provider default_tags for all supported AWS resources."
}

# -----------------------------------------------------------------------------
# Postgres (RDS)
# -----------------------------------------------------------------------------

variable "postgres_engine_version" {
  type        = string
  description = "RDS Postgres engine version (use major only, e.g. 16, to stay on latest minor AWS offers)."
  default     = "16"
}

variable "postgres_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "postgres_allocated_storage" {
  type    = number
  default = 20
}

variable "postgres_database_name" {
  type    = string
  default = "aptos_translate"
}

variable "postgres_master_username" {
  type    = string
  default = "postgres"
}

variable "postgres_multi_az" {
  type    = bool
  default = false
}

variable "postgres_backup_retention_days" {
  type    = number
  default = 7
}

variable "postgres_skip_final_snapshot" {
  type        = bool
  description = "Set false for production-like DB retention on destroy."
  default     = true
}

variable "postgres_deletion_protection" {
  type    = bool
  default = false
}

# -----------------------------------------------------------------------------
# Redis (ElastiCache — BullMQ in current app)
# -----------------------------------------------------------------------------

variable "redis_engine_version" {
  type    = string
  default = "7.1"
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.micro"
}

# -----------------------------------------------------------------------------
# Amazon MQ (RabbitMQ) — messaging bus (wire app consumers separately)
# -----------------------------------------------------------------------------

variable "mq_engine_version" {
  type        = string
  description = "Amazon MQ RabbitMQ engine version (region-specific; check console / aws mq describe-broker-engine-types)."
  default     = "3.13"
}

variable "mq_host_instance_type" {
  type        = string
  description = "Amazon MQ instance class for RabbitMQ (AWS restricts by engine version; 3.13 often requires Graviton M7g/M5 sizes)."
  default     = "mq.m7g.medium"
}

variable "mq_admin_username" {
  type    = string
  default = "mqadmin"
}

# -----------------------------------------------------------------------------
# AWS Batch (Fargate) — long-running translation / batch work
# -----------------------------------------------------------------------------

variable "batch_max_vcpus" {
  type    = number
  default = 16
}

variable "batch_image_tag" {
  type        = string
  description = "Tag for images pushed to ECR (batch-worker repository)."
  default     = "latest"
}

variable "batch_vcpu" {
  type    = number
  default = 1
}

variable "batch_memory_mb" {
  type    = number
  default = 4096
}

variable "batch_container_environment" {
  type = list(object({
    name  = string
    value = string
  }))
  description = "Extra env vars for the Batch job container (e.g. DATABASE_URL from Secrets Manager)."
  default     = []
}

variable "log_retention_days" {
  type    = number
  default = 14
}

# -----------------------------------------------------------------------------
# Legacy / optional pass-through (for docs or external wiring)
# -----------------------------------------------------------------------------

variable "database_url" {
  type        = string
  description = "Set externally when not using the RDS module (otherwise ignored when RDS is created)."
  sensitive   = true
  default     = ""
}

variable "redis_url" {
  type        = string
  description = "Set externally when not using ElastiCache (otherwise ignored)."
  sensitive   = true
  default     = ""
}

variable "object_storage_bucket" {
  type        = string
  description = "Ignored; Terraform creates S3 bucket for uploads."
  default     = ""
}

variable "object_storage_region" {
  type    = string
  default = ""
}

variable "api_container_image" {
  type        = string
  description = "Optional: ECR image URI for ECS/Fargate API (not provisioned here)."
  default     = ""
}

variable "web_container_image" {
  type        = string
  description = "Optional: ECR image URI for web (not provisioned here)."
  default     = ""
}

variable "public_api_hostname" {
  type    = string
  default = ""
}

# -----------------------------------------------------------------------------
# ECS Fargate + ALB (all-AWS URLs)
# -----------------------------------------------------------------------------

variable "ecs_desired_count" {
  type        = number
  description = "Tasks per service (API + Web)."
  default     = 1
}

variable "ecs_image_tag" {
  type        = string
  description = "Tag pushed to both api and web ECR repos."
  default     = "latest"
}

variable "ecs_api_cpu" {
  type        = number
  description = "Fargate CPU units for API task."
  default     = 512
}

variable "ecs_api_memory_mb" {
  type        = number
  description = "Fargate memory (MiB) for API task."
  default     = 1024
}

variable "ecs_web_cpu" {
  type        = number
  description = "Fargate CPU units for Web task."
  default     = 512
}

variable "ecs_web_memory_mb" {
  type        = number
  description = "Fargate memory (MiB) for Web task."
  default     = 1024
}

variable "ecs_bedrock_translation_model_id" {
  type        = string
  description = "Bedrock model id injected into API containers."
  default     = "google.gemma-3-12b-it"
}

variable "ecs_bedrock_scoring_model_id" {
  type        = string
  description = "Bedrock scoring model id injected into API containers."
  default     = "openai.gpt-oss-120b-1:0"
}

variable "ecs_web_dev_tenant_id" {
  type        = string
  description = "NEXT_PUBLIC_DEV_TENANT_ID for the web UI (must exist in Postgres after seed)."
  default     = "00000000-0000-4000-8000-000000000001"
}

variable "ecs_git_sha_label" {
  type        = string
  description = "Optional GIT_SHA env on API tasks for debugging."
  default     = ""
}
