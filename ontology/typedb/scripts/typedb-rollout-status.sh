#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/typedb-rollout-lib.sh"

if [ ! -f "$STATE_FILE" ]; then
  echo '{"status":"idle","note":"no rollout state file"}'
  exit 0
fi

RUN_ID="$(sed -n 's/.*"run_id": "\([^"]*\)".*/\1/p' "$STATE_FILE" | head -n1)"
STATUS="$(sed -n 's/.*"status": "\([^"]*\)".*/\1/p' "$STATE_FILE" | head -n1)"
PHASE="$(sed -n 's/.*"phase": "\([^"]*\)".*/\1/p' "$STATE_FILE" | head -n1)"
SESSION_NAME="$(sed -n 's/.*"session": "\([^"]*\)".*/\1/p' "$STATE_FILE" | head -n1)"
CLEANUP_LOG="$(sed -n 's/.*"cleanup_log": "\([^"]*\)".*/\1/p' "$STATE_FILE" | head -n1)"
BACKFILL_LOG="$(sed -n 's/.*"backfill_log": "\([^"]*\)".*/\1/p' "$STATE_FILE" | head -n1)"
UPDATED_AT="$(sed -n 's/.*"updated_at_utc": "\([^"]*\)".*/\1/p' "$STATE_FILE" | head -n1)"
TMUX_LIVE=false
PROC_PIDS="$(active_ingest_pids | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g' | sed 's/^ //; s/ $//')"
if [ -n "$SESSION_NAME" ] && tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  TMUX_LIVE=true
fi
cat <<EOF
{
  "run_id": "${RUN_ID}",
  "status": "${STATUS}",
  "phase": "${PHASE}",
  "session": "${SESSION_NAME}",
  "tmux_live": ${TMUX_LIVE},
  "ingest_pids": "${PROC_PIDS}",
  "cleanup_log": "${CLEANUP_LOG}",
  "backfill_log": "${BACKFILL_LOG}",
  "updated_at_utc": "${UPDATED_AT}"
}
EOF
