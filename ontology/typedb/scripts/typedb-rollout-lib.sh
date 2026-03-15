#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COPILOT_ROOT="$(cd "$ROOT_DIR/../.." && pwd)"
BACKEND_DIR="$COPILOT_ROOT/backend"
LOG_DIR="$ROOT_DIR/logs"
STATE_FILE="$LOG_DIR/typedb-rollout-state.json"
LOCK_FILE="$LOG_DIR/typedb-rollout.lock"

run_id_utc() {
  date -u +%Y%m%dT%H%M%SZ
}

session_name_for_run() {
  printf 'typedb-rollout-%s\n' "$1"
}

cleanup_log_for_run() {
  printf '%s/typedb-8wn1-cleanup-%s.log\n' "$LOG_DIR" "$1"
}

cleanup_deadletter_for_run() {
  printf '%s/typedb-8wn1-cleanup-deadletter-%s.ndjson\n' "$LOG_DIR" "$1"
}

backfill_log_for_run() {
  printf '%s/typedb-6zjr-backfill-%s.log\n' "$LOG_DIR" "$1"
}

backfill_deadletter_for_run() {
  printf '%s/typedb-6zjr-backfill-deadletter-%s.ndjson\n' "$LOG_DIR" "$1"
}

ensure_log_dir() {
  mkdir -p "$LOG_DIR"
}

write_rollout_state() {
  ensure_log_dir
  local run_id="$1"
  local status="$2"
  local phase="$3"
  local session_name="$4"
  local cleanup_log="$5"
  local cleanup_deadletter="$6"
  local backfill_log="$7"
  local backfill_deadletter="$8"
  local note="${9:-}"
  python3 - "$STATE_FILE" "$run_id" "$status" "$phase" "$session_name" "$cleanup_log" "$cleanup_deadletter" "$backfill_log" "$backfill_deadletter" "$note" <<'PY'
import json
import sys
from datetime import datetime, timezone

path, run_id, status, phase, session_name, cleanup_log, cleanup_deadletter, backfill_log, backfill_deadletter, note = sys.argv[1:]
payload = {
    "run_id": run_id,
    "status": status,
    "phase": phase,
    "session": session_name,
    "cleanup_log": cleanup_log,
    "cleanup_deadletter": cleanup_deadletter,
    "backfill_log": backfill_log,
    "backfill_deadletter": backfill_deadletter,
    "updated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "note": note,
}
with open(path, "w", encoding="utf-8") as fp:
    json.dump(payload, fp, ensure_ascii=False, indent=2)
    fp.write("\n")
PY
}

active_ingest_pids() {
  pgrep -f 'typedb-ontology-ingest.py --apply' || true
}

rollout_running() {
  local session_name="$1"
  if tmux has-session -t "$session_name" 2>/dev/null; then
    return 0
  fi
  if [ -n "$(active_ingest_pids)" ]; then
    return 0
  fi
  return 1
}

clear_rollout_logs() {
  ensure_log_dir
  find "$LOG_DIR" -maxdepth 1 -type f \( \
    -name 'typedb-*-cleanup-*.log' -o \
    -name 'typedb-*-backfill-*.log' -o \
    -name 'typedb-*-deadletter-*.ndjson' -o \
    -name 'typedb-historical-backfill-*.log' -o \
    -name 'typedb-historical-backfill-*.pid' -o \
    -name 'typedb-ontology-historical-backfill*.log' -o \
    -name 'typedb-ontology-historical-backfill*.pid' -o \
    -name 'typedb-ontology-ingest-deadletter.ndjson' -o \
    -name 'test-*.log' -o \
    -name 'test-*.pid' -o \
    -name 'typedb-rollout-state.json' \
  \) -print -delete
}
