#!/usr/bin/env bash
set -euo pipefail

MODE=${1:-}
ACTION=${2:-start}

if [[ -z "$MODE" ]]; then
  echo "Usage: $0 <dev|prod> [start|restart]"
  exit 1
fi

if [[ "$MODE" != "dev" && "$MODE" != "prod" ]]; then
  echo "Mode must be dev or prod"
  exit 1
fi

if [[ "$ACTION" != "start" && "$ACTION" != "restart" ]]; then
  echo "Action must be start or restart"
  exit 1
fi

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ECOSYSTEM_FILE="$ROOT_DIR/scripts/pm2-figma.ecosystem.config.cjs"

cd "$ROOT_DIR"
npm install
npm run build

SERVICES=(
  "copilot-figma-indexer-$MODE"
  "copilot-figma-webhook-receiver-$MODE"
)

if [[ "$ACTION" == "restart" ]]; then
  for service in "${SERVICES[@]}"; do
    pm2 restart "$service" --update-env || pm2 start "$ECOSYSTEM_FILE" --only "$service" --update-env
  done
else
  for service in "${SERVICES[@]}"; do
    pm2 start "$ECOSYSTEM_FILE" --only "$service" --update-env
  done
fi

pm2 save
