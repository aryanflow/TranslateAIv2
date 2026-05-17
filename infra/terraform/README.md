# AWS infrastructure (Terraform)

This stack provisions a **practical baseline** for TranslateAI on AWS:

| Layer | AWS service | Role |
|--------|-------------|------|
| Network | VPC, public/private subnets, single NAT | Private workloads with outbound internet |
| App data | RDS PostgreSQL | Prisma `DATABASE_URL` |
| Queues (current code) | ElastiCache Redis | BullMQ `REDIS_URL` (same as local/docker-compose) |
| Messaging (AMQP) | **Amazon MQ (RabbitMQ)** | Broker for AMQP-based consumers (optional next step vs BullMQ-only) |
| Object storage | S3 | Uploads / artifacts (`S3_*` without `S3_ENDPOINT`) |
| Containers | ECR + **ECS Fargate** | Nest API + Next.js (see `ecs.tf`) |
| Ingress | **2× Application Load Balancers** (HTTP 80) | `terraform output public_web_url` / `public_api_url` |
| Heavy jobs | **AWS Batch** (Fargate) | Long-running translation or preprocessing jobs |
| LLM | **Bedrock** (IAM) | Policy attached to **ECS API task role** and Batch job role |

**Bedrock** access is IAM-only (`bedrock:InvokeModel`). The stack attaches the policy to the ECS API task role automatically.

## Public URLs (all-AWS)

After `terraform apply`, open:

- **`terraform output -raw public_web_url`** — Next.js UI (browser talks to the API via same-origin `/api/upstream` → `API_PROXY_TARGET` → API ALB).
- **`terraform output -raw public_api_url`** — Nest REST API directly.

Push images **before** or **immediately after** apply (services recover once tasks pull):

```bash
chmod +x scripts/push-ecr-aws.sh
./scripts/push-ecr-aws.sh
```

Run **Prisma** against RDS once (from a machine that can reach the DB, or an ECS one-off task):

```bash
DATABASE_URL="$(terraform output -raw database_url)" pnpm --filter api exec prisma db push
DATABASE_URL="$(terraform output -raw database_url)" pnpm --filter api run db:seed
```

## Prerequisites

- Terraform `>= 1.5`, AWS CLI configured (`aws sts get-caller-identity`)
- Defaults use **us-east-1**; pick a region where your Bedrock models are available

## One-shot infra + env file (Terraform → API `.env`)

From the repo root (after `terraform.tfvars` exists):

```bash
chmod +x scripts/deploy-stack.sh
AUTO_APPROVE=1 DEPLOY_TFVARS=infra/terraform/terraform.tfvars ./scripts/deploy-stack.sh
```

This applies Terraform and writes `apps/api/.env.deploy.generated` with `DATABASE_URL`, `REDIS_URL`, S3 bucket/region, and Bedrock model IDs (override with env vars before running). Merge into `apps/api/.env` and ensure the runtime has `bedrock:InvokeModel` permission.

## Quick start

From the repo root:

```bash
chmod +x scripts/deploy-aws.sh
./scripts/deploy-aws.sh init
cp infra/terraform/terraform.tfvars.example infra/terraform/terraform.tfvars
# edit tfvars (region, names, sizes)
DEPLOY_TFVARS=infra/terraform/terraform.tfvars ./scripts/deploy-aws.sh plan
DEPLOY_TFVARS=infra/terraform/terraform.tfvars ./scripts/deploy-aws.sh apply
```

Read sensitive outputs (DB URL, Redis, MQ):

```bash
DEPLOY_TFVARS=infra/terraform/terraform.tfvars ./scripts/deploy-aws.sh output -json
```

## Application wiring

1. **Prisma**: map `database_url` output → `DATABASE_URL`.
2. **BullMQ (unchanged)**: map `redis_url` → `REDIS_URL`.
3. **S3**: set `S3_BUCKET`, `S3_REGION`, use real IAM credentials (task/instance role). **Unset** `S3_ENDPOINT` and `S3_FORCE_PATH_STYLE` for native AWS S3.
4. **LLM**: Enable **Google Gemma** and **OpenAI GPT-OSS** in Bedrock model access (or override via `ecs_bedrock_*` tfvars). The ECS API task role already has `bedrock_invoke_policy_arn`.
5. **RabbitMQ**: use `amazon_mq_rabbit_primary_amqps` once you add AMQP consumers or bridge events from Redis to MQ.
6. **Batch**: build and push a worker image to `ecr_batch_worker_repository_url`, then `aws batch submit-job` using `batch_job_queue_name` and `batch_job_definition_arn`.

## Cost / ops notes

- NAT Gateway, RDS, ElastiCache, and Amazon MQ are **ongoing cost**; use smaller classes for dev and tear down when idle (`destroy`).
- First time using AWS Batch in an account, AWS may auto-create a service-linked role when you create the compute environment; if apply errors, follow the message from AWS for that region/account.
- `postgres_skip_final_snapshot = true` is the default for easier teardown — **set false** for production DBs.

## State backend (recommended for teams)

Use remote state (S3 + DynamoDB lock). Add a `backend "s3" {}` block in your own `backend.tf` or use `-backend-config`; keep bucket/table names out of git unless they are non-secret.
