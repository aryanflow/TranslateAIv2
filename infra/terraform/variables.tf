variable "environment" {
  type        = string
  description = "Logical name (e.g. staging, prod)."
  default     = "dev"
}

variable "database_url" {
  type        = string
  description = "Postgres connection URL for Prisma (often from managed DB module output)."
  sensitive   = true
  default     = ""
}

variable "redis_url" {
  type        = string
  description = "Redis URL for BullMQ / SSE pub-sub."
  sensitive   = true
  default     = ""
}

variable "object_storage_bucket" {
  type        = string
  description = "Primary uploads/results bucket name."
  default     = ""
}

variable "object_storage_region" {
  type        = string
  description = "Region for object storage API."
  default     = ""
}

variable "api_container_image" {
  type        = string
  description = "Built image for NestJS API (see docker/Dockerfile.api)."
  default     = ""
}

variable "web_container_image" {
  type        = string
  description = "Built image for Next.js web (see docker/Dockerfile.web)."
  default     = ""
}

variable "public_api_hostname" {
  type        = string
  description = "DNS host for API (used by web NEXT_PUBLIC_API_URL in prod)."
  default     = ""
}
