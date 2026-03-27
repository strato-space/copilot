#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

usage() {
  cat <<'EOF'
Usage: ./scripts/pm2-runtime-readiness.sh <dev|prod|local>

Checks that mandatory PM2 runtimes are online for the selected environment.
Outputs machine-readable JSON diagnostics and exits non-zero if any runtime is missing.
EOF
}

if [[ ${#} -ne 1 ]]; then
  usage
  exit 1
fi

MODE="$1"
case "$MODE" in
  dev|prod|local) ;;
  *)
    usage
    exit 1
    ;;
esac

required_names=()
case "$MODE" in
  prod)
    required_names=(
      "copilot-backend-prod"
      "copilot-miniapp-backend-prod"
      "copilot-agent-services"
      "copilot-voicebot-workers-prod"
      "copilot-voicebot-tgbot-prod"
    )
    ;;
  dev)
    required_names=(
      "copilot-backend-dev"
      "copilot-miniapp-backend-dev"
      "copilot-agent-services"
    )
    ;;
  local)
    required_names=(
      "copilot-backend-local"
      "copilot-miniapp-backend-local"
      "copilot-agent-services"
    )
    ;;
esac

escape_json() {
  python3 - "$1" <<'PY'
import json, sys
print(json.dumps(sys.argv[1], ensure_ascii=False))
PY
}

output_error_json_and_exit() {
  local code="$1"
  local message="$2"
  printf '{'
  printf '"mode":%s,' "$(escape_json "$MODE")"
  printf '"ok":false,'
  printf '"required_count":%d,' "${#required_names[@]}"
  printf '"online_count":0,'
  printf '"missing_count":%d,' "${#required_names[@]}"
  printf '"required":['
  for idx in "${!required_names[@]}"; do
    [[ $idx -gt 0 ]] && printf ','
    printf '%s' "$(escape_json "${required_names[$idx]}")"
  done
  printf '],'
  printf '"online":[],'
  printf '"missing":['
  for idx in "${!required_names[@]}"; do
    [[ $idx -gt 0 ]] && printf ','
    printf '%s' "$(escape_json "${required_names[$idx]}")"
  done
  printf '],'
  printf '"remediation":[],'
  printf '"error":{"code":%s,"message":%s}' "$(escape_json "$code")" "$(escape_json "$message")"
  printf '}\n'
  exit 3
}

if ! command -v pm2 >/dev/null 2>&1; then
  output_error_json_and_exit "pm2_not_found" "pm2 command is not available in PATH"
fi

collect_online_names_once() {
  local raw_jlist="$1"
  python3 -c '
import json
import sys

try:
    payload = json.load(sys.stdin)
except Exception:
    sys.exit(2)

if not isinstance(payload, list):
    sys.exit(2)

for item in payload:
    if not isinstance(item, dict):
        continue
    name = str(item.get("name") or "").strip()
    if not name:
        continue
    pid = item.get("pid")
    try:
        pid_int = int(pid)
    except Exception:
        pid_int = 0
    status = ""
    pm2_env = item.get("pm2_env")
    if isinstance(pm2_env, dict):
        status = str(pm2_env.get("status") or "").strip().lower()
    if status == "online" and pid_int > 0:
        print(name)
' <<<"$raw_jlist"
}

STABILITY_ATTEMPTS=3
STABILITY_INTERVAL_SEC="0.5"

declare -A stable_hits=()
for name in "${required_names[@]}"; do
  stable_hits["$name"]=0
done

attempt=1
while (( attempt <= STABILITY_ATTEMPTS )); do
  jlist_output="$(pm2 jlist 2>/dev/null || true)"
  if [[ -z "$jlist_output" ]]; then
    output_error_json_and_exit "pm2_jlist_empty" "pm2 jlist returned an empty payload"
  fi

  if ! online_names="$(collect_online_names_once "$jlist_output")"; then
    output_error_json_and_exit "pm2_jlist_parse_failed" "pm2 jlist payload could not be parsed"
  fi

  for name in "${required_names[@]}"; do
    if grep -Fxq "$name" <<<"$online_names"; then
      stable_hits["$name"]=$(( stable_hits["$name"] + 1 ))
    else
      stable_hits["$name"]=0
    fi
  done

  if (( attempt < STABILITY_ATTEMPTS )); then
    sleep "$STABILITY_INTERVAL_SEC"
  fi
  attempt=$(( attempt + 1 ))
done

remediation_for() {
  local name="$1"
  case "$name" in
    copilot-backend-prod|copilot-miniapp-backend-prod|copilot-backend-dev|copilot-miniapp-backend-dev|copilot-backend-local|copilot-miniapp-backend-local)
      printf 'cd %s && pm2 start scripts/pm2-backend.ecosystem.config.js --only %s --update-env' "$ROOT_DIR" "$name"
      ;;
    copilot-voicebot-workers-prod|copilot-voicebot-tgbot-prod)
      printf 'cd %s && pm2 start scripts/pm2-voicebot-cutover.ecosystem.config.js --only %s --update-env' "$ROOT_DIR" "$name"
      ;;
    copilot-agent-services)
      printf 'cd %s/agents && ./pm2-agents.sh start' "$ROOT_DIR"
      ;;
    *)
      printf 'pm2 start <ecosystem> --only %s --update-env' "$name"
      ;;
  esac
}

ok_entries=()
missing_entries=()

for name in "${required_names[@]}"; do
  if (( stable_hits["$name"] >= STABILITY_ATTEMPTS )); then
    ok_entries+=("$name")
  else
    missing_entries+=("$name")
  fi
done

printf '{'
printf '"mode":%s,' "$(escape_json "$MODE")"
printf '"ok":%s,' "$([[ ${#missing_entries[@]} -eq 0 ]] && echo "true" || echo "false")"
printf '"required_count":%d,' "${#required_names[@]}"
printf '"online_count":%d,' "${#ok_entries[@]}"
printf '"missing_count":%d,' "${#missing_entries[@]}"
printf '"required":['
for idx in "${!required_names[@]}"; do
  [[ $idx -gt 0 ]] && printf ','
  printf '%s' "$(escape_json "${required_names[$idx]}")"
done
printf '],'
printf '"online":['
for idx in "${!ok_entries[@]}"; do
  [[ $idx -gt 0 ]] && printf ','
  printf '%s' "$(escape_json "${ok_entries[$idx]}")"
done
printf '],'
printf '"missing":['
for idx in "${!missing_entries[@]}"; do
  [[ $idx -gt 0 ]] && printf ','
  printf '%s' "$(escape_json "${missing_entries[$idx]}")"
done
printf '],'
printf '"remediation":['
for idx in "${!missing_entries[@]}"; do
  [[ $idx -gt 0 ]] && printf ','
  cmd="$(remediation_for "${missing_entries[$idx]}")"
  printf '{"service":%s,"command":%s}' \
    "$(escape_json "${missing_entries[$idx]}")" \
    "$(escape_json "$cmd")"
done
printf ']'
printf ',"error":null'
printf '}\n'

if [[ ${#missing_entries[@]} -gt 0 ]]; then
  exit 2
fi
