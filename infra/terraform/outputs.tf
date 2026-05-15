output "environment" {
  value       = var.environment
  description = "Echo of logical environment name."
}

output "hints" {
  value = {
    database_url_set      = var.database_url != ""
    redis_url_set         = var.redis_url != ""
    bucket_set            = var.object_storage_bucket != ""
    api_image_set         = var.api_container_image != ""
    web_image_set         = var.web_container_image != ""
    public_api_hostname   = var.public_api_hostname
  }
  description = "Non-secret checklist for wiring (populate tfvars / CI)."
}
