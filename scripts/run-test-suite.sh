#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLATFORMS_FILE="${ROOT_DIR}/platforms.json"

usage() {
  cat <<'EOF'
Usage:
  scripts/run-test-suite.sh [baseline|voice|full] [--fail-fast]

Examples:
  scripts/run-test-suite.sh baseline
  scripts/run-test-suite.sh voice
  scripts/run-test-suite.sh full --fail-fast
EOF
}

if [[ ! -f "${PLATFORMS_FILE}" ]]; then
  echo "platforms.json not found at ${PLATFORMS_FILE}" >&2
  exit 2
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to run this script" >&2
  exit 2
fi

SUITE="${1:-full}"
FAIL_FAST="0"

if [[ "${SUITE}" == "--help" || "${SUITE}" == "-h" ]]; then
  usage
  exit 0
fi

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --fail-fast)
      FAIL_FAST="1"
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
  shift
done

if ! jq -e --arg suite "${SUITE}" '.suites[$suite]' "${PLATFORMS_FILE}" >/dev/null; then
  echo "Unknown suite: ${SUITE}" >&2
  jq -r '.suites | keys[]' "${PLATFORMS_FILE}" | sed 's/^/- /'
  exit 2
fi

mapfile -t ITEMS < <(jq -c --arg suite "${SUITE}" '.suites[$suite][]' "${PLATFORMS_FILE}")

if [[ ${#ITEMS[@]} -eq 0 ]]; then
  echo "Suite '${SUITE}' has no commands."
  exit 0
fi

echo "== Copilot test suite: ${SUITE} =="
echo "Using ${PLATFORMS_FILE}"
echo

declare -a SUMMARY=()
FAILED=0
TOTAL_ITEMS=${#ITEMS[@]}
RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/copilot-test-suite.XXXXXX")"
trap 'rm -rf "${RUN_DIR}"' EXIT

declare -a ITEM_ID=()
declare -a ITEM_PLATFORM=()
declare -a ITEM_WORKDIR=()
declare -a ITEM_COMMAND=()
declare -a ITEM_STAGE=()
declare -A STAGE_SEEN=()
declare -a STAGES=()

for idx in "${!ITEMS[@]}"; do
  item="${ITEMS[$idx]}"
  id="$(jq -r '.id' <<<"${item}")"
  platform="$(jq -r '.platform' <<<"${item}")"
  workdir="$(jq -r '.workdir' <<<"${item}")"
  command="$(jq -r '.command' <<<"${item}")"
  stage="$(jq -r '.stage // empty' <<<"${item}")"

  if [[ -z "${stage}" ]]; then
    stage="$((idx + 1))"
  fi

  ITEM_ID[$idx]="${id}"
  ITEM_PLATFORM[$idx]="${platform}"
  ITEM_WORKDIR[$idx]="${workdir}"
  ITEM_COMMAND[$idx]="${command}"
  ITEM_STAGE[$idx]="${stage}"

  if [[ -z "${STAGE_SEEN[${stage}]:-}" ]]; then
    STAGE_SEEN["${stage}"]=1
    STAGES+=("${stage}")
  fi
done

mapfile -t STAGES_SORTED < <(printf '%s\n' "${STAGES[@]}" | sort -n)

INDEX=0
ABORT_REMAINING_STAGES=0

for stage in "${STAGES_SORTED[@]}"; do
  if [[ ${ABORT_REMAINING_STAGES} -eq 1 ]]; then
    break
  fi

  echo "== Stage ${stage} =="

  declare -A PID_TO_IDX=()
  declare -A PID_TO_LOG=()
  declare -a RUNNING_PIDS=()

  for idx in "${!ITEMS[@]}"; do
    if [[ "${ITEM_STAGE[$idx]}" != "${stage}" ]]; then
      continue
    fi

    INDEX=$((INDEX + 1))
    id="${ITEM_ID[$idx]}"
    platform="${ITEM_PLATFORM[$idx]}"
    workdir="${ITEM_WORKDIR[$idx]}"
    command="${ITEM_COMMAND[$idx]}"
    log_file="${RUN_DIR}/${INDEX}-${id//[^a-zA-Z0-9._-]/_}.log"

    echo "[${INDEX}/${TOTAL_ITEMS}] ${id} (${platform})"
    echo "  cd ${workdir} && ${command}"

    (
      set +e
      mapfile -t env_kv < <(jq -r '.env // {} | to_entries[] | "\(.key)=\(.value|tostring)"' <<<"${ITEMS[$idx]}")
      (
        cd "${ROOT_DIR}/${workdir}"
        env "${env_kv[@]}" bash -lc "${command}"
      ) >"${log_file}" 2>&1
      exit $?
    ) &

    pid=$!
    RUNNING_PIDS+=("${pid}")
    PID_TO_IDX["${pid}"]="${idx}"
    PID_TO_LOG["${pid}"]="${log_file}"
  done

  stage_failed=0
  cancel_sent=0

  while [[ ${#RUNNING_PIDS[@]} -gt 0 ]]; do
    declare -a REMAINING_PIDS=()

    for pid in "${RUNNING_PIDS[@]}"; do
      if kill -0 "${pid}" 2>/dev/null; then
        REMAINING_PIDS+=("${pid}")
        continue
      fi

      set +e
      wait "${pid}"
      status=$?
      set -e

      idx="${PID_TO_IDX[$pid]}"
      id="${ITEM_ID[$idx]}"
      platform="${ITEM_PLATFORM[$idx]}"
      workdir="${ITEM_WORKDIR[$idx]}"
      command="${ITEM_COMMAND[$idx]}"
      log_file="${PID_TO_LOG[$pid]}"

      if [[ -f "${log_file}" ]]; then
        cat "${log_file}"
      fi

      if [[ ${status} -eq 0 ]]; then
        SUMMARY+=("PASS|${id}|${platform}|${workdir}|${command}")
        echo "  -> PASS"
      else
        SUMMARY+=("FAIL|${id}|${platform}|${workdir}|${command}")
        echo "  -> FAIL (exit ${status})"
        FAILED=$((FAILED + 1))
        stage_failed=1

        if [[ "${FAIL_FAST}" == "1" && ${cancel_sent} -eq 0 ]]; then
          cancel_sent=1
          for remaining_pid in "${REMAINING_PIDS[@]}"; do
            kill "${remaining_pid}" 2>/dev/null || true
          done
        fi
      fi

      echo
    done

    RUNNING_PIDS=("${REMAINING_PIDS[@]}")
    if [[ ${#RUNNING_PIDS[@]} -gt 0 ]]; then
      sleep 0.1
    fi
  done

  if [[ "${FAIL_FAST}" == "1" && ${stage_failed} -eq 1 ]]; then
    ABORT_REMAINING_STAGES=1
    echo "Fail-fast: aborting remaining stages after stage ${stage}."
    echo
  fi
done

echo "== Summary =="
for row in "${SUMMARY[@]}"; do
  IFS='|' read -r result id platform workdir command <<<"${row}"
  echo "- ${result}: ${id} (${platform}) :: cd ${workdir} && ${command}"
done
echo

if [[ ${FAILED} -gt 0 ]]; then
  echo "Suite '${SUITE}' finished with ${FAILED} failing command(s)." >&2
  exit 1
fi

echo "Suite '${SUITE}' passed."
