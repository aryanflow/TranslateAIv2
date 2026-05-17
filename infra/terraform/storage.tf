resource "aws_ecr_repository" "api" {
  name                 = "${local.prefix}/api"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "${local.prefix}-ecr-api"
  }
}

resource "aws_ecr_repository" "batch_worker" {
  name                 = "${local.prefix}/batch-worker"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "${local.prefix}-ecr-batch-worker"
  }
}

resource "aws_ecr_repository" "web" {
  name                 = "${local.prefix}/web"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "${local.prefix}-ecr-web"
  }
}

resource "aws_s3_bucket" "uploads" {
  bucket = "${local.prefix}-uploads-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name = "${local.prefix}-uploads"
  }
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

data "aws_iam_policy_document" "uploads_rw" {
  statement {
    sid = "ListBucket"
    actions = [
      "s3:ListBucket",
      "s3:GetBucketLocation",
    ]
    resources = [aws_s3_bucket.uploads.arn]
  }

  statement {
    sid = "ObjectRW"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:AbortMultipartUpload",
    ]
    resources = ["${aws_s3_bucket.uploads.arn}/*"]
  }
}

resource "aws_iam_policy" "uploads_rw" {
  name        = "${local.prefix}-s3-uploads"
  description = "Read/write app upload bucket"
  policy      = data.aws_iam_policy_document.uploads_rw.json

  tags = {
    Name = "${local.prefix}-policy-s3-uploads"
  }
}
