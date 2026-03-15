#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/typedb-rollout-lib.sh"

usage() {
  cat <<EOF
Usage:
  $(basename "$0") start
  $(basename "$0") stop
  $(basename "$0") clear-logs
  $(basename "$0") run <run_id>
EOF
}

start_rollout() {
  ensure_log_dir
  local run_id
  run_id="$(run_id_utc)"
  local session_name cleanup_log cleanup_deadletter backfill_log backfill_deadletter
  session_name="$(session_name_for_run "$run_id")"
  cleanup_log="$(cleanup_log_for_run "$run_id")"
  cleanup_deadletter="$(cleanup_deadletter_for_run "$run_id")"
  backfill_log="$(backfill_log_for_run "$run_id")"
  backfill_deadletter="$(backfill_deadletter_for_run "$run_id")"

  if [ -f "$STATE_FILE" ]; then
    local current_session
    current_session="$(sed -n 's/.*"session": "\([^"]*\)".*/\1/p' "$STATE_FILE" | head -n1)"
    if [ -n "$current_session" ] && rollout_running "$current_session"; then
      echo "rollout already running in session: $current_session" >&2
      exit 1
    fi
  fi

  if [ -n "$(active_ingest_pids)" ]; then
    echo "refusing to start: another TypeDB apply process is already running" >&2
    exit 1
  fi

  write_rollout_state "$run_id" "starting" "cleanup_apply" "$session_name" "$cleanup_log" "$cleanup_deadletter" "$backfill_log" "$backfill_deadletter" "launching tmux supervisor"
  tmux new-session -d -s "$session_name" "$SCRIPT_DIR/typedb-rollout-chain.sh run $run_id"
  sleep 1
  if ! tmux has-session -t "$session_name" 2>/dev/null; then
    write_rollout_state "$run_id" "failed" "startup" "$session_name" "$cleanup_log" "$cleanup_deadletter" "$backfill_log" "$backfill_deadletter" "tmux session failed to start"
    echo "failed to start tmux rollout session" >&2
    exit 1
  fi
  write_rollout_state "$run_id" "running" "cleanup_apply" "$session_name" "$cleanup_log" "$cleanup_deadletter" "$backfill_log" "$backfill_deadletter" "tmux supervisor started"
  cat "$STATE_FILE"
}

run_rollout() {
  local run_id="$1"
  local session_name cleanup_log cleanup_deadletter backfill_log backfill_deadletter
  session_name="$(session_name_for_run "$run_id")"
  cleanup_log="$(cleanup_log_for_run "$run_id")"
  cleanup_deadletter="$(cleanup_deadletter_for_run "$run_id")"
  backfill_log="$(backfill_log_for_run "$run_id")"
  backfill_deadletter="$(backfill_deadletter_for_run "$run_id")"

  ensure_log_dir
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    write_rollout_state "$run_id" "failed" "startup" "$session_name" "$cleanup_log" "$cleanup_deadletter" "$backfill_log" "$backfill_deadletter" "lock acquisition failed"
    echo "typedb rollout lock already held" >&2
    exit 1
  fi

  cd "$BACKEND_DIR"

  write_rollout_state "$run_id" "running" "cleanup_apply" "$session_name" "$cleanup_log" "$cleanup_deadletter" "$backfill_log" "$backfill_deadletter" "starting focused cleanup apply"
  {
    echo "[typedb-rollout-chain] run_id=${run_id} phase=8wn1_cleanup start=$(date -u +%FT%TZ)"
    npm run ontology:typedb:ingest:apply -- --run-id "$run_id" --deadletter "$cleanup_deadletter" --skip-session-derived-projections --collections automation_tasks,automation_voice_bot_sessions
  } 2>&1 | tee -a "$cleanup_log"
  local cleanup_exit=${PIPESTATUS[0]}

  write_rollout_state "$run_id" "running" "cleanup_validate" "$session_name" "$cleanup_log" "$cleanup_deadletter" "$backfill_log" "$backfill_deadletter" "starting validate after cleanup apply"
  {
    echo "[typedb-rollout-chain] run_id=${run_id} phase=8wn1_validate start=$(date -u +%FT%TZ)"
    npm run ontology:typedb:validate
  } 2>&1 | tee -a "$cleanup_log"
  local validate_exit=${PIPESTATUS[0]}
  echo "[typedb-rollout-chain] run_id=${run_id} cleanup_exit=${cleanup_exit} validate_exit=${validate_exit} done=$(date -u +%FT%TZ)" | tee -a "$cleanup_log"

  if [ "$cleanup_exit" -ne 0 ] || [ "$validate_exit" -ne 0 ]; then
    write_rollout_state "$run_id" "failed" "cleanup_validate" "$session_name" "$cleanup_log" "$cleanup_deadletter" "$backfill_log" "$backfill_deadletter" "cleanup or validate failed"
    exit 1
  fi

  write_rollout_state "$run_id" "running" "historical_backfill" "$session_name" "$cleanup_log" "$cleanup_deadletter" "$backfill_log" "$backfill_deadletter" "starting historical backfill"
  {
    echo "[typedb-rollout-chain] run_id=${run_id} phase=6zjr_backfill start=$(date -u +%FT%TZ)"
    npm run ontology:typedb:ingest:apply -- --run-id "$run_id" --deadletter "$backfill_deadletter" --collections automation_voice_bot_sessions,automation_voice_bot_messages,automation_google_drive_projects_files
  } 2>&1 | tee -a "$backfill_log"
  local backfill_exit=${PIPESTATUS[0]}
  echo "[typedb-rollout-chain] run_id=${run_id} backfill_exit=${backfill_exit} done=$(date -u +%FT%TZ)" | tee -a "$backfill_log"

  if [ "$backfill_exit" -ne 0 ]; then
    write_rollout_state "$run_id" "failed" "historical_backfill" "$session_name" "$cleanup_log" "$cleanup_deadletter" "$backfill_log" "$backfill_deadletter" "historical backfill failed"
    exit 1
  fi

  write_rollout_state "$run_id" "completed" "done" "$session_name" "$cleanup_log" "$cleanup_deadletter" "$backfill_log" "$backfill_deadletter" "rollout chain completed"
}

stop_rollout() {
  local current_session=""
  if [ -f "$STATE_FILE" ]; then
    current_session="$(sed -n 's/.*"session": "\([^"]*\)".*/\1/p' "$STATE_FILE" | head -n1)"
  fi
  if [ -n "$current_session" ] && tmux has-session -t "$current_session" 2>/dev/null; then
    tmux kill-session -t "$current_session"
  fi
  local active_pids
  active_pids="$(active_ingest_pids)"
  if [ -n "$active_pids" ]; then
    echo "$active_pids" | xargs -r kill -TERM
    sleep 1
  fi
  if [ -f "$STATE_FILE" ]; then
    local run_id cleanup_log cleanup_deadletter backfill_log backfill_deadletter
    run_id="$(sed -n 's/.*"run_id": "\([^"]*\)".*/\1/p' "$STATE_FILE" | head -n1)"
    cleanup_log="$(sed -n 's/.*"cleanup_log": "\([^"]*\)".*/\1/p' "$STATE_FILE" | head -n1)"
    cleanup_deadletter="$(sed -n 's/.*"cleanup_deadletter": "\([^"]*\)".*/\1/p' "$STATE_FILE" | head -n1)"
    backfill_log="$(sed -n 's/.*"backfill_log": "\([^"]*\)".*/\1/p' "$STATE_FILE" | head -n1)"
    backfill_deadletter="$(sed -n 's/.*"backfill_deadletter": "\([^"]*\)".*/\1/p' "$STATE_FILE" | head -n1)"
    write_rollout_state "$run_id" "stopped" "manual_stop" "$current_session" "$cleanup_log" "$cleanup_deadletter" "$backfill_log" "$backfill_deadletter" "manual stop requested"
  fi
}

case "${1:-start}" in
  start)
    start_rollout
    ;;
  run)
    shift
    if [ $# -ne 1 ]; then usage; exit 1; fi
    run_rollout "$1"
    ;;
  stop)
    stop_rollout
    ;;
  clear-logs)
    if [ -f "$STATE_FILE" ]; then
      current_session="$(sed -n 's/.*"session": "\([^"]*\)".*/\1/p' "$STATE_FILE" | head -n1)"
      if [ -n "${current_session:-}" ] && rollout_running "$current_session"; then
        echo "refusing to clear logs while rollout is running: $current_session" >&2
        exit 1
      fi
    fi
    clear_rollout_logs
    ;;
  *)
    usage
    exit 1
    ;;
esac
