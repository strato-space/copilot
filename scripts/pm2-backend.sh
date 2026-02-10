#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
FRONT_DIR="$ROOT_DIR/app"
MINI_DIR="$ROOT_DIR/miniapp"
BACK_DIR="$ROOT_DIR/backend"

usage() {
  cat <<'EOF'
Usage: ./scripts/pm2-backend.sh <dev|prod>

Builds app, miniapp, and backend, then starts the backend with PM2.
EOF
}

if [[ ${#} -ne 1 ]]; then
  usage
  exit 1
fi

MODE="$1"
case "$MODE" in
  dev|prod) ;;
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
BACKEND_NPM_SCRIPT="start"
PM2_NAME="copilot-backend-prod"

if [[ "$MODE" == "dev" ]]; then
  APP_BUILD_SCRIPT="build-dev"
  MINI_BUILD_SCRIPT="build-dev"
  BACKEND_NPM_SCRIPT="dev"
  PM2_NAME="copilot-backend-dev"
fi

( cd "$FRONT_DIR" && npm run "$APP_BUILD_SCRIPT" )
( cd "$MINI_DIR" && npm run "$MINI_BUILD_SCRIPT" )
( cd "$BACK_DIR" && npm run build )

if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_NAME" --update-env
else
  pm2 start npm --name "$PM2_NAME" --cwd "$BACK_DIR" -- run "$BACKEND_NPM_SCRIPT"
fi
