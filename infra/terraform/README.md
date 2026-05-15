# Terraform (cloud-agnostic scaffold)

This folder holds **variables, outputs, and module stubs** so you can plug in AWS, GCP, or Azure without committing to one provider here.

## What you wire per environment

| Concern | Maps to app env |
|--------|------------------|
| PostgreSQL 16 | `DATABASE_URL` |
| Redis 7 | `REDIS_URL` |
| Object storage (S3 / GCS / Azure Blob) | `S3_*` or adapter vars in `.env` |
| Secrets (Gemini / Langdock, DB password) | Runtime secret store → inject into API/worker |
| Compute (ECS, Cloud Run, AKS, EC2) | Container images built from [`docker/Dockerfile.api`](../../docker/Dockerfile.api) and [`docker/Dockerfile.web`](../../docker/Dockerfile.web) |

## Provider choice

1. Pick a cloud and Terraform AWS/GCP/Azure provider.
2. Implement the stubs under `modules/` for that provider (see each `README.md`).
3. Set `terraform.tfvars` from `variables.tf` — no secrets in git.

## Local parity

Use root [`docker-compose.yaml`](../../docker-compose.yaml): `docker compose --profile full up --build` after creating the MinIO bucket used by `S3_BUCKET`.
