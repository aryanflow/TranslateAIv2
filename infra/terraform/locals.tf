locals {
  prefix             = "${var.project_name}-${var.environment}"
  availability_zones = slice(data.aws_availability_zones.this.names, 0, var.az_count)
  project_label      = coalesce(var.project_tag, var.project_name)
}
