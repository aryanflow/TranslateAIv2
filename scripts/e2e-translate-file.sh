#!/usr/bin/env bash
# End-to-end: upload file → create job → poll until terminal.
set -euo pipefail

FILE="${1:?usage: e2e-translate-file.sh /path/to/file.json}"
API="${API_BASE:-http://localhost:3001}"
TENANT="${TENANT_ID:-00000000-0000-4000-8000-000000000001}"
SOURCE_LANG="${SOURCE_LANG:-american_english}"
TARGET_LANG="${TARGET_LANG:-hindi}"
BATCH_SIZE="${BATCH_SIZE:-50}"
POLL_SEC="${POLL_SEC:-5}"
MAX_WAIT_SEC="${MAX_WAIT_SEC:-900}"

BASENAME="$(basename "$FILE")"
CT="application/json"
[[ "$BASENAME" == *.xml ]] && CT="application/xml"

echo "==> Upload: $FILE ($(wc -c <"$FILE" | tr -d ' ') bytes)"

PRESIGN=$(curl -sS -X POST "$API/files/presigned-url" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TENANT" \
  -d "{\"fileName\":\"$BASENAME\",\"contentType\":\"$CT\"}")

UPLOAD_URL=$(echo "$PRESIGN" | python3 -c "import sys,json; print(json.load(sys.stdin)['uploadUrl'])")
FILE_KEY=$(echo "$PRESIGN" | python3 -c "import sys,json; print(json.load(sys.stdin)['fileKey'])")

curl -sS -X PUT "$UPLOAD_URL" -H "Content-Type: $CT" --data-binary "@$FILE" -o /dev/null -w "PUT upload: HTTP %{http_code}\n"

JOB=$(curl -sS -X POST "$API/jobs" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TENANT" \
  -d "{\"fileKey\":\"$FILE_KEY\",\"sourceLang\":\"$SOURCE_LANG\",\"targetLangs\":[\"$TARGET_LANG\"],\"batchSize\":$BATCH_SIZE,\"maxBatchRetries\":3}")

JOB_ID=$(echo "$JOB" | python3 -c "import sys,json; print(json.load(sys.stdin)['jobId'])")
echo "==> Job: $JOB_ID"

START=$(date +%s)
while true; do
  NOW=$(date +%s)
  ELAPSED=$((NOW - START))
  if (( ELAPSED > MAX_WAIT_SEC )); then
    echo "TIMEOUT after ${MAX_WAIT_SEC}s"
    exit 1
  fi
  J=$(curl -sS "$API/jobs/$JOB_ID" -H "X-Tenant-Id: $TENANT")
  STATUS=$(echo "$J" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
  PROGRESS=$(echo "$J" | python3 -c "import sys,json; print(json.load(sys.stdin).get('progress',0))")
  BATCHES=$(echo "$J" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"{d.get('batchesCompleted',0)}/{d.get('batchTotal','?')}\")")
  echo "[${ELAPSED}s] status=$STATUS progress=${PROGRESS}% batches=$BATCHES"
  if [[ "$STATUS" == "completed" ]]; then
    echo "$J" | python3 -m json.tool
    echo "SUCCESS job=$JOB_ID elapsed=${ELAPSED}s"
    exit 0
  fi
  if [[ "$STATUS" == "failed" || "$STATUS" == "cancelled" ]]; then
    echo "$J" | python3 -m json.tool
    echo "FAILED status=$STATUS elapsed=${ELAPSED}s"
    exit 1
  fi
  sleep "$POLL_SEC"
done
