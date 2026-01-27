#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
FRONT_DIR="$ROOT_DIR/app"
BACK_DIR="$ROOT_DIR/backend"

if [[ ! -d "$FRONT_DIR" ]]; then
  echo "Frontend directory not found: $FRONT_DIR" >&2
  exit 1
fi

if [[ ! -d "$BACK_DIR" ]]; then
  echo "Backend directory not found: $BACK_DIR" >&2
  exit 1
fi

if [[ ! -d "$FRONT_DIR/node_modules" ]]; then
  (cd "$FRONT_DIR" && npm install)
fi

if [[ ! -d "$BACK_DIR/node_modules" ]]; then
  (cd "$BACK_DIR" && npm install)
fi

( cd "$BACK_DIR" && npm run dev ) &
BACK_PID=$!

( cd "$FRONT_DIR" && npm run dev ) &
FRONT_PID=$!

trap 'kill "$BACK_PID" "$FRONT_PID"' EXIT

wait -n "$BACK_PID" "$FRONT_PID"
