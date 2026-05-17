provider "aws" {
  region = var.aws_region

  default_tags {
    tags = merge(
      {
        Project     = local.project_label
        Environment = var.environment
        ManagedBy   = "terraform"
      },
      var.extra_tags,
    )
  }
}
