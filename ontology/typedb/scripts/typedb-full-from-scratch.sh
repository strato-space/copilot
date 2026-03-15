#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$(cd "$ROOT_DIR/../.." && pwd)/backend"
LOG_DIR="$ROOT_DIR/logs"
DEFAULT_DB="${TYPEDB_BENCH_DATABASE:-str_opsportal_profile_full}"
RUN_ID="${RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"

ensure_log_dir() {
  mkdir -p "$LOG_DIR"
}

main() {
  ensure_log_dir

  if [[ "${1:-}" == "apply" ]]; then
    shift
  fi

  local target_db="$DEFAULT_DB"
  local passthrough=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --typedb-database)
        target_db="$2"
        passthrough+=("$1" "$2")
        shift 2
        ;;
      *)
        passthrough+=("$1")
        shift
        ;;
    esac
  done

  local deadletter="$LOG_DIR/typedb-full-from-scratch-${RUN_ID}.ndjson"
  cd "$BACKEND_DIR"

  PYTHONUNBUFFERED=1 bash ../ontology/typedb/scripts/run-typedb-python.sh - "$target_db" <<'PY'
from dotenv import load_dotenv
from typedb.driver import Credentials, DriverOptions, TypeDB
import os
import sys

target_db = sys.argv[1]
load_dotenv(dotenv_path='/home/strato-space/copilot/backend/.env.production', override=False)
addresses = (os.getenv('TYPEDB_ADDRESSES') or '127.0.0.1:1729').split(',')
address = addresses[0].split('://', 1)[-1].rstrip('/')
username = os.getenv('TYPEDB_USERNAME') or 'admin'
password = os.getenv('TYPEDB_PASSWORD') or 'password'
tls = (os.getenv('TYPEDB_TLS_ENABLED') or '').strip().lower() in {'1', 'true', 'yes', 'on'}

driver = TypeDB.driver(address, Credentials(username, password), DriverOptions(is_tls_enabled=tls))
try:
    if driver.databases.contains(target_db):
        driver.databases.get(target_db).delete()
finally:
    driver.close()
PY

  PYTHONUNBUFFERED=1 bash ../ontology/typedb/scripts/run-typedb-python.sh \
    ../ontology/typedb/scripts/typedb-ontology-ingest.py \
    --apply \
    --init-schema \
    --projection-scope full \
    --assume-empty-db \
    --run-id "$RUN_ID" \
    --typedb-database "$target_db" \
    --deadletter "$deadletter" \
    "${passthrough[@]}"

  PYTHONUNBUFFERED=1 bash ../ontology/typedb/scripts/run-typedb-python.sh \
    ../ontology/typedb/scripts/typedb-ontology-validate.py \
    --typedb-database "$target_db"
}

main "$@"
