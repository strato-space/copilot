#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
FRONT_DIR="$ROOT_DIR/app"
MINI_DIR="$ROOT_DIR/miniapp"
BACK_DIR="$ROOT_DIR/backend"

usage() {
  cat <<'EOF'
Usage: ./scripts/pm2-backend.sh <dev|prod|local>

Builds app, miniapp, and backend, then starts the backend and agents with PM2.
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
PM2_ECOSYSTEM="$ROOT_DIR/scripts/pm2-backend.ecosystem.config.js"

if [[ "$MODE" == "dev" ]]; then
  APP_BUILD_SCRIPT="build-dev"
  MINI_BUILD_SCRIPT="build-dev"
  PM2_NAME="copilot-backend-dev"
fi

if [[ "$MODE" == "local" ]]; then
  APP_BUILD_SCRIPT="build-local"
  MINI_BUILD_SCRIPT="build-dev"
  PM2_NAME="copilot-backend-local"
fi

if [[ ! -f "$PM2_ECOSYSTEM" ]]; then
  echo "PM2 ecosystem file not found: $PM2_ECOSYSTEM" >&2
  exit 1
fi

AGENTS_SCRIPT="$ROOT_DIR/agents/pm2-agents.sh"

( cd "$FRONT_DIR" && npm run "$APP_BUILD_SCRIPT" )
( cd "$MINI_DIR" && npm run "$MINI_BUILD_SCRIPT" )
( cd "$BACK_DIR" && npm run build )

if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_ECOSYSTEM" --only "$PM2_NAME" --update-env
else
  pm2 start "$PM2_ECOSYSTEM" --only "$PM2_NAME" --update-env
fi

if [[ -f "$AGENTS_SCRIPT" ]]; then
  ( cd "$ROOT_DIR/agents" && "$AGENTS_SCRIPT" start )
else
  echo "Agents script not found: $AGENTS_SCRIPT" >&2
fi
