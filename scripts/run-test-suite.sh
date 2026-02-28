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
INDEX=0

for item in "${ITEMS[@]}"; do
  INDEX=$((INDEX + 1))
  id="$(jq -r '.id' <<<"${item}")"
  platform="$(jq -r '.platform' <<<"${item}")"
  workdir="$(jq -r '.workdir' <<<"${item}")"
  command="$(jq -r '.command' <<<"${item}")"

  mapfile -t env_kv < <(jq -r '.env // {} | to_entries[] | "\(.key)=\(.value|tostring)"' <<<"${item}")

  echo "[${INDEX}/${#ITEMS[@]}] ${id} (${platform})"
  echo "  cd ${workdir} && ${command}"

  set +e
  (
    cd "${ROOT_DIR}/${workdir}"
    env "${env_kv[@]}" bash -lc "${command}"
  )
  status=$?
  set -e

  if [[ ${status} -eq 0 ]]; then
    SUMMARY+=("PASS|${id}|${platform}|${workdir}|${command}")
    echo "  -> PASS"
  else
    SUMMARY+=("FAIL|${id}|${platform}|${workdir}|${command}")
    echo "  -> FAIL (exit ${status})"
    FAILED=$((FAILED + 1))
    if [[ "${FAIL_FAST}" == "1" ]]; then
      break
    fi
  fi
  echo
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
