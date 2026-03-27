#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
FRONT_DIR="$ROOT_DIR/app"
MINI_DIR="$ROOT_DIR/miniapp"
BACK_DIR="$ROOT_DIR/backend"

usage() {
  cat <<'EOF'
Usage: ./scripts/pm2-backend.sh <dev|prod|local>

Builds app, miniapp, and backend, then starts the backend and miniapp backend with PM2.
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

if [[ ! -d "$FRONT_DIR" ]]; then
  echo "Frontend directory not found: $FRONT_DIR" >&2
  exit 1
fi

if [[ ! -d "$MINI_DIR" ]]; then
  echo "Miniapp directory not found: $MINI_DIR" >&2
  exit 1
fi

if [[ ! -d "$BACK_DIR" ]]; then
  echo "Backend directory not found: $BACK_DIR" >&2
  exit 1
fi

APP_BUILD_SCRIPT="build"
MINI_BUILD_SCRIPT="build"
PM2_NAME="copilot-backend-prod"
PM2_MINI_NAME="copilot-miniapp-backend-prod"
PM2_ECOSYSTEM="$ROOT_DIR/scripts/pm2-backend.ecosystem.config.js"
VOICEBOT_PM2_ECOSYSTEM="$ROOT_DIR/scripts/pm2-voicebot-cutover.ecosystem.config.js"
RUNTIME_READINESS_SCRIPT="$ROOT_DIR/scripts/pm2-runtime-readiness.sh"
PROD_VOICEBOT_PM2_NAMES=(copilot-voicebot-workers-prod copilot-voicebot-tgbot-prod)

if [[ "$MODE" == "dev" ]]; then
  APP_BUILD_SCRIPT="build-dev"
  MINI_BUILD_SCRIPT="build-dev"
  PM2_NAME="copilot-backend-dev"
  PM2_MINI_NAME="copilot-miniapp-backend-dev"
fi

if [[ "$MODE" == "local" ]]; then
  APP_BUILD_SCRIPT="build-local"
  MINI_BUILD_SCRIPT="build-dev"
  PM2_NAME="copilot-backend-local"
  PM2_MINI_NAME="copilot-miniapp-backend-local"
fi

if [[ ! -f "$PM2_ECOSYSTEM" ]]; then
  echo "PM2 ecosystem file not found: $PM2_ECOSYSTEM" >&2
  exit 1
fi

AGENTS_SCRIPT="$ROOT_DIR/agents/pm2-agents.sh"

ensure_pm2_process() {
  local ecosystem_file="$1"
  local pm2_name="$2"

  if pm2 describe "$pm2_name" >/dev/null 2>&1; then
    pm2 restart "$ecosystem_file" --only "$pm2_name" --update-env
  else
    pm2 start "$ecosystem_file" --only "$pm2_name" --update-env
  fi
}

assert_pm2_online() {
  local pm2_name="$1"
  local pid_output
  local token

  pid_output="$(pm2 pid "$pm2_name" 2>/dev/null || true)"
  for token in $pid_output; do
    if [[ "$token" =~ ^[0-9]+$ ]] && (( token > 0 )); then
      return 0
    fi
  done

  echo "PM2 process is not online after bootstrap: $pm2_name" >&2
  pm2 describe "$pm2_name" || true
  return 1
}

( cd "$FRONT_DIR" && npm run "$APP_BUILD_SCRIPT" )
( cd "$MINI_DIR" && npm run "$MINI_BUILD_SCRIPT" )
( cd "$BACK_DIR" && npm run build )

ensure_pm2_process "$PM2_ECOSYSTEM" "$PM2_NAME"
ensure_pm2_process "$PM2_ECOSYSTEM" "$PM2_MINI_NAME"

if [[ -f "$AGENTS_SCRIPT" ]]; then
  ( cd "$ROOT_DIR/agents" && "$AGENTS_SCRIPT" start )
else
  echo "Agents script not found: $AGENTS_SCRIPT" >&2
fi

if [[ "$MODE" == "prod" ]]; then
  if [[ ! -f "$VOICEBOT_PM2_ECOSYSTEM" ]]; then
    echo "VoiceBot PM2 ecosystem file not found: $VOICEBOT_PM2_ECOSYSTEM" >&2
    exit 1
  fi

  for VOICEBOT_PM2_NAME in "${PROD_VOICEBOT_PM2_NAMES[@]}"; do
    ensure_pm2_process "$VOICEBOT_PM2_ECOSYSTEM" "$VOICEBOT_PM2_NAME"
    assert_pm2_online "$VOICEBOT_PM2_NAME"
  done

  if [[ ! -x "$RUNTIME_READINESS_SCRIPT" ]]; then
    echo "Runtime readiness script is missing or not executable: $RUNTIME_READINESS_SCRIPT" >&2
    exit 1
  fi

  "$RUNTIME_READINESS_SCRIPT" "$MODE"
fi
