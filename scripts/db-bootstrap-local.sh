#!/usr/bin/env bash
# Local DB: sync Prisma schema, then align migrate history (handles P3005 non-empty DB).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> db:push (sync schema)"
pnpm run db:push

echo "==> migrate deploy"
set +e
DEPLOY_OUT=$(pnpm run db:migrate:deploy 2>&1)
DEPLOY_CODE=$?
set -e
echo "$DEPLOY_OUT"

if [ "$DEPLOY_CODE" -eq 0 ]; then
  echo "==> done"
  exit 0
fi

if echo "$DEPLOY_OUT" | grep -q "P3005"; then
  echo "==> P3005: mark cancelled migration applied (baseline), then deploy again"
  set +e
  RESOLVE_OUT=$(pnpm --filter api exec prisma migrate resolve --applied 20250517120000_job_status_cancelled 2>&1)
  RESOLVE_CODE=$?
  set -e
  echo "$RESOLVE_OUT"
  if [ "$RESOLVE_CODE" -ne 0 ] && ! echo "$RESOLVE_OUT" | grep -q "P3008"; then
    exit "$RESOLVE_CODE"
  fi
  pnpm run db:migrate:deploy
  echo "==> done"
  exit 0
fi

exit "$DEPLOY_CODE"
