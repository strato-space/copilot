#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DEFAULT_ENV_FILE="$ROOT_DIR/backend/.env.production"

usage() {
  cat <<'EOF'
Usage: ./scripts/voice-notify-healthcheck.sh [--env-file <path>] [--timeout-sec <n>] [--url <notify_url>] [--token <bearer>]

Performs a synthetic probe call to VOICE_BOT_NOTIFIES_URL and returns machine-readable JSON.
Exit codes:
  0 = healthy (HTTP 2xx)
  1 = usage/configuration error
  2 = endpoint responded non-2xx
  3 = transport-level curl failure
EOF
}

ENV_FILE="$DEFAULT_ENV_FILE"
TIMEOUT_SEC="10"
OVERRIDE_URL=""
OVERRIDE_TOKEN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      [[ $# -lt 2 ]] && { usage; exit 1; }
      ENV_FILE="$2"
      shift 2
      ;;
    --timeout-sec)
      [[ $# -lt 2 ]] && { usage; exit 1; }
      TIMEOUT_SEC="$2"
      shift 2
      ;;
    --url)
      [[ $# -lt 2 ]] && { usage; exit 1; }
      OVERRIDE_URL="$2"
      shift 2
      ;;
    --token)
      [[ $# -lt 2 ]] && { usage; exit 1; }
      OVERRIDE_TOKEN="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 1
      ;;
  esac
done

if [[ ! "$TIMEOUT_SEC" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  printf '{"ok":false,"error":{"code":"invalid_timeout","message":"timeout must be numeric"}}\n'
  exit 1
fi

env_file_url=""
env_file_token=""
if [[ -f "$ENV_FILE" ]]; then
  while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
    line="${raw_line#"${raw_line%%[![:space:]]*}"}"
    [[ -z "$line" ]] && continue
    [[ "$line" == \#* ]] && continue
    [[ "$line" != *=* ]] && continue

    key="${line%%=*}"
    value="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"

    if [[ "$value" == \"*\" && "$value" == *\" ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
      value="${value:1:${#value}-2}"
    fi

    case "$key" in
      VOICE_BOT_NOTIFIES_URL) env_file_url="$value" ;;
      VOICE_BOT_NOTIFIES_BEARER_TOKEN) env_file_token="$value" ;;
    esac
  done < "$ENV_FILE"
fi

notify_url="${OVERRIDE_URL:-${VOICE_BOT_NOTIFIES_URL:-$env_file_url}}"
notify_token="${OVERRIDE_TOKEN:-${VOICE_BOT_NOTIFIES_BEARER_TOKEN:-$env_file_token}}"

if [[ -z "$notify_url" ]]; then
  printf '{"ok":false,"error":{"code":"notify_url_missing","message":"VOICE_BOT_NOTIFIES_URL is empty"}}\n'
  exit 1
fi

if [[ -z "$notify_token" ]]; then
  printf '{"ok":false,"error":{"code":"notify_token_missing","message":"VOICE_BOT_NOTIFIES_BEARER_TOKEN is empty"}}\n'
  exit 1
fi

body_file="$(mktemp)"
cleanup() {
  rm -f "$body_file"
}
trap cleanup EXIT

payload="$(python3 - <<'PY'
import json
from datetime import datetime, timezone

now = datetime.now(timezone.utc).isoformat()
print(json.dumps({
    "event": "health_probe",
    "session_id": "voice-notify-healthcheck",
    "probe_only": True,
    "sent_at": now,
    "payload": {
        "reason": "ops_health_probe",
        "source": "copilot_voice_notify_healthcheck",
    },
}, ensure_ascii=False))
PY
)"

curl_out_file="$(mktemp)"
trap 'cleanup; rm -f "$curl_out_file"' EXIT

set +e
curl \
  --silent \
  --show-error \
  --output "$body_file" \
  --write-out "%{http_code} %{time_total}" \
  --request POST \
  --header "Content-Type: application/json" \
  --header "Authorization: Bearer ${notify_token}" \
  --max-time "$TIMEOUT_SEC" \
  --data "$payload" \
  "$notify_url" >"$curl_out_file"
curl_rc=$?
set -e

curl_meta="$(cat "$curl_out_file" 2>/dev/null || true)"
rm -f "$curl_out_file"

if [[ $curl_rc -ne 0 ]]; then
  printf '{'
  printf '"ok":false,'
  printf '"url":%s,' "$(python3 - <<'PY' "$notify_url"
import json,sys
print(json.dumps(sys.argv[1], ensure_ascii=False))
PY
)"
  printf '"curl_exit":%d,' "$curl_rc"
  printf '"error":{"code":"curl_failed","message":"notify probe transport failed"}'
  printf '}\n'
  exit 3
fi

http_status="${curl_meta%% *}"
time_total="${curl_meta#* }"
if [[ -z "$http_status" || ! "$http_status" =~ ^[0-9]{3}$ ]]; then
  http_status="000"
fi
if [[ -z "$time_total" || "$time_total" == "$curl_meta" ]]; then
  time_total="0"
fi

body_preview="$(python3 - <<'PY' "$body_file"
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
if not path.exists():
    print("")
    raise SystemExit(0)
raw = path.read_bytes()
text = raw.decode("utf-8", errors="replace").strip()
if len(text) > 400:
    text = text[:400]
print(text)
PY
)"

body_class="$(python3 - <<'PY' "$body_file"
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
if not path.exists():
    print("empty")
    raise SystemExit(0)
text = path.read_bytes().decode("utf-8", errors="replace").strip()
if text == "":
    print("empty")
elif text.startswith("{"):
    print("json_object")
elif text.startswith("["):
    print("json_array")
elif text.startswith("<"):
    print("html")
else:
    print("text")
PY
)"

escaped_url="$(python3 - <<'PY' "$notify_url"
import json,sys
print(json.dumps(sys.argv[1], ensure_ascii=False))
PY
)"

escaped_body_preview="$(python3 - <<'PY' "$body_preview"
import json,sys
print(json.dumps(sys.argv[1], ensure_ascii=False))
PY
)"

status_ok="false"
exit_code=2
if (( http_status >= 200 && http_status < 300 )); then
  status_ok="true"
  exit_code=0
fi

time_total_ms="$(python3 - <<'PY' "$time_total"
import sys
try:
    total = float(sys.argv[1])
except Exception:
    total = 0.0
print(int(round(total * 1000)))
PY
)"

printf '{'
printf '"ok":%s,' "$status_ok"
printf '"url":%s,' "$escaped_url"
printf '"http_status":%d,' "$http_status"
printf '"time_total_ms":%s,' "$time_total_ms"
printf '"body_class":"%s",' "$body_class"
printf '"body_preview":%s,' "$escaped_body_preview"
printf '"error":null'
printf '}\n'

exit "$exit_code"
