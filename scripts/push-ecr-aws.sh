#!/usr/bin/env bash
# Build and push API + Web images to ECR (after terraform apply created repos).
#
# Usage (from repo root):
#   aws sso login   # or export AWS_* credentials
#   chmod +x scripts/push-ecr-aws.sh
#   ./scripts/push-ecr-aws.sh
#   TAG=v1 ./scripts/push-ecr-aws.sh
# Override platform (default linux/amd64 for ECS Fargate): DOCKER_PLATFORM=linux/arm64 ./scripts/push-ecr-aws.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="$ROOT/infra/terraform"
TAG="${TAG:-latest}"
# ECS Fargate uses linux/amd64 unless you configure ARM - match that when building on Apple Silicon.
PLATFORM="${DOCKER_PLATFORM:-linux/amd64}"

REGION="$(terraform -chdir="$TF_DIR" output -raw region)"
API_REPO="$(terraform -chdir="$TF_DIR" output -raw ecr_api_repository_url)"
WEB_REPO="$(terraform -chdir="$TF_DIR" output -raw ecr_web_repository_url)"
REGISTRY="${API_REPO%%/*}"
CLUSTER="$(terraform -chdir="$TF_DIR" output -raw ecs_cluster_name)"
API_SVC="$(terraform -chdir="$TF_DIR" output -raw ecs_service_api_name)"
WEB_SVC="$(terraform -chdir="$TF_DIR" output -raw ecs_service_web_name)"

echo "Logging in to $REGISTRY ($REGION)..."
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"

echo "Building & pushing API → $API_REPO:$TAG (platform=$PLATFORM)"
docker build --platform "$PLATFORM" -f "$ROOT/docker/Dockerfile.api" -t "$API_REPO:$TAG" "$ROOT"
docker push "$API_REPO:$TAG"

echo "Building & pushing Web → $WEB_REPO:$TAG (platform=$PLATFORM)"
docker build --platform "$PLATFORM" -f "$ROOT/docker/Dockerfile.web" -t "$WEB_REPO:$TAG" "$ROOT"
docker push "$WEB_REPO:$TAG"

echo "Forcing ECS rollout..."
aws ecs update-service --region "$REGION" --cluster "$CLUSTER" --service "$API_SVC" --force-new-deployment >/dev/null
aws ecs update-service --region "$REGION" --cluster "$CLUSTER" --service "$WEB_SVC" --force-new-deployment >/dev/null

echo "Done. Web UI: $(terraform -chdir="$TF_DIR" output -raw public_web_url)"
echo "API:       $(terraform -chdir="$TF_DIR" output -raw public_api_url)"
