#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$(cd "$ROOT_DIR/../.." && pwd)/backend"
LOG_DIR="$ROOT_DIR/logs"
DEFAULT_SYNC_STATE="$LOG_DIR/typedb-ontology-sync-state.json"
RUN_ID="${RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"

ensure_log_dir() {
  mkdir -p "$LOG_DIR"
}

contains_arg() {
  local needle="$1"
  shift
  for arg in "$@"; do
    if [[ "$arg" == "$needle" ]]; then
      return 0
    fi
  done
  return 1
}

main() {
  local mode="${1:-apply}"
  shift || true

  if contains_arg "--sync-state" "$@"; then
    echo "typedb-sync-chain.sh manages --sync-state internally" >&2
    exit 1
  fi
  if contains_arg "--projection-scope" "$@"; then
    echo "typedb-sync-chain.sh manages --projection-scope internally" >&2
    exit 1
  fi
  if contains_arg "--skip-sync-state-write" "$@"; then
    echo "typedb-sync-chain.sh manages --skip-sync-state-write internally" >&2
    exit 1
  fi

  ensure_log_dir
  local sync_state_tmp="$LOG_DIR/typedb-sync-chain-${RUN_ID}.sync-state.json"
  local core_deadletter="$LOG_DIR/typedb-sync-core-${RUN_ID}.ndjson"
  local enrich_deadletter="$LOG_DIR/typedb-sync-enrich-${RUN_ID}.ndjson"
  local apply_flag=()
  if [[ "$mode" == "apply" ]]; then
    apply_flag=(--apply)
  elif [[ "$mode" != "dry" ]]; then
    echo "Usage: $(basename "$0") [apply|dry] [typedb ingest args...]" >&2
    exit 1
  fi

  if [[ -f "$DEFAULT_SYNC_STATE" ]]; then
    cp "$DEFAULT_SYNC_STATE" "$sync_state_tmp"
  else
    printf '{\n  "collections": {}\n}\n' >"$sync_state_tmp"
  fi

  cd "$BACKEND_DIR"

  PYTHONUNBUFFERED=1 bash ../ontology/typedb/scripts/run-typedb-python.sh \
    ../ontology/typedb/scripts/typedb-ontology-ingest.py \
    "${apply_flag[@]}" \
    --sync-mode incremental \
    --projection-scope core \
    --run-id "$RUN_ID" \
    --deadletter "$core_deadletter" \
    --sync-state "$sync_state_tmp" \
    --skip-sync-state-write \
    --collections automation_projects,automation_tasks,automation_voice_bot_sessions,automation_voice_bot_messages \
    "$@"

  PYTHONUNBUFFERED=1 bash ../ontology/typedb/scripts/run-typedb-python.sh \
    ../ontology/typedb/scripts/typedb-ontology-ingest.py \
    "${apply_flag[@]}" \
    --sync-mode incremental \
    --projection-scope derived \
    --run-id "$RUN_ID" \
    --deadletter "$enrich_deadletter" \
    --sync-state "$sync_state_tmp" \
    --collections automation_voice_bot_sessions,automation_voice_bot_messages \
    "$@"

  if [[ "$mode" == "apply" ]]; then
    cp "$sync_state_tmp" "$DEFAULT_SYNC_STATE"
    printf '[typedb-sync-chain] sync_state=%s\n' "$DEFAULT_SYNC_STATE"
  fi
}

main "$@"
