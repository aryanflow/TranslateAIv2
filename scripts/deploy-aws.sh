#!/usr/bin/env bash
# Deploy / plan AWS infrastructure (Terraform).
# Usage:
#   ./scripts/deploy-aws.sh plan
#   ./scripts/deploy-aws.sh apply
#   DEPLOY_TFVARS=infra/terraform/terraform.tfvars ./scripts/deploy-aws.sh apply
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="${TERRAFORM_DIR:-$ROOT/infra/terraform}"

EXTRA=()
if [[ -n "${DEPLOY_TFVARS:-}" ]]; then
  EXTRA+=( "-var-file=${DEPLOY_TFVARS}" )
fi

cmd="${1:-plan}"
shift || true

case "$cmd" in
  init)
    terraform -chdir="$TF_DIR" init "$@"
    ;;
  plan)
    terraform -chdir="$TF_DIR" plan "${EXTRA[@]}" "$@"
    ;;
  apply)
    terraform -chdir="$TF_DIR" apply "${EXTRA[@]}" "$@"
    ;;
  destroy)
    terraform -chdir="$TF_DIR" destroy "${EXTRA[@]}" "$@"
    ;;
  output)
    terraform -chdir="$TF_DIR" output "${EXTRA[@]}" "$@"
    ;;
  validate)
    terraform -chdir="$TF_DIR" fmt -check -recursive
    terraform -chdir="$TF_DIR" validate
    ;;
  *)
    echo "Usage: $0 {init|plan|apply|destroy|output|validate} [extra terraform args...]" >&2
    echo "Optional: set DEPLOY_TFVARS to a .tfvars file path." >&2
    exit 1
    ;;
esac
