#!/usr/bin/env bash
# Start MinIO and ensure the local upload bucket exists (v2 dev uploads).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

docker compose --profile full up -d minio
sleep 2

CONTAINER="$(docker compose --profile full ps -q minio)"
if [[ -z "$CONTAINER" ]]; then
  echo "MinIO container not found. Is Docker running?" >&2
  exit 1
fi

docker exec "$CONTAINER" mc alias set local http://localhost:9000 minio minio12345 >/dev/null 2>&1 || true
docker exec "$CONTAINER" mc mb local/aptos-translate-uploads --ignore-existing

echo "MinIO ready: API http://127.0.0.1:9000 · console http://127.0.0.1:9001 (minio / minio12345)"
echo "Bucket: aptos-translate-uploads"
