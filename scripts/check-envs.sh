#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

required_files=(
  "$ROOT_DIR/backend/.env.development"
  "$ROOT_DIR/backend/.env.production"
  "$ROOT_DIR/app/.env.development"
  "$ROOT_DIR/app/.env.production"
  "$ROOT_DIR/app/.env.localhost"
  "$ROOT_DIR/miniapp/.env.development"
  "$ROOT_DIR/miniapp/.env.production"
)

missing=()

for file_path in "${required_files[@]}"; do
  if [[ ! -f "$file_path" ]]; then
    missing+=("$file_path")
  fi
done

if [[ ${#missing[@]} -eq 0 ]]; then
  echo "All required .env files are present."
else
  echo "Missing .env files:"
  for file_path in "${missing[@]}"; do
    echo "- $file_path"
  done
fi

echo ""
echo "Resolved addresses and ports by mode:"

read_env_value() {
  local file_path="$1"
  local key="$2"

  if [[ ! -f "$file_path" ]]; then
    echo ""
    return 0
  fi

  awk -v k="$key" -F= '
    $0 ~ /^[[:space:]]*#/ { next }
    $1 == k { sub(/^[^=]*=/, ""); print; exit }
  ' "$file_path"
}

print_env_summary() {
  local label="$1"
  local file_path="$2"
  shift 2

  echo "- $label ($file_path)"
  for key in "$@"; do
    local value
    value=$(read_env_value "$file_path" "$key")
    if [[ -n "$value" ]]; then
      echo "  $key=$value"
    else
      echo "  $key=<missing>"
    fi
  done
}

print_env_summary "Backend dev" "$ROOT_DIR/backend/.env.development" \
  "API_PORT" \
  "MINIAPP_BACKEND_PORT"
print_env_summary "Backend prod" "$ROOT_DIR/backend/.env.production" \
  "API_PORT" \
  "MINIAPP_BACKEND_PORT"
print_env_summary "Backend local" "$ROOT_DIR/backend/.env.development" \
  "API_PORT" \
  "MINIAPP_BACKEND_PORT"

print_env_summary "App dev" "$ROOT_DIR/app/.env.development" \
  "VITE_API_BASE_URL" \
  "VITE_CRM_API_URL" \
  "VITE_VOICEBOT_BASE_URL" \
  "VITE_OPEROPS_EMBED_BASE_URL"
print_env_summary "App prod" "$ROOT_DIR/app/.env.production" \
  "VITE_API_BASE_URL" \
  "VITE_CRM_API_URL" \
  "VITE_VOICEBOT_BASE_URL" \
  "VITE_OPEROPS_EMBED_BASE_URL"
print_env_summary "App local" "$ROOT_DIR/app/.env.localhost" \
  "VITE_API_BASE_URL" \
  "VITE_CRM_API_URL" \
  "VITE_VOICEBOT_BASE_URL" \
  "VITE_OPEROPS_EMBED_BASE_URL"

print_env_summary "Miniapp dev" "$ROOT_DIR/miniapp/.env.development" \
  "VITE_API_URL" \
  "VITE_MINIAPP_BACKEND_PORT"
print_env_summary "Miniapp prod" "$ROOT_DIR/miniapp/.env.production" \
  "VITE_API_URL" \
  "VITE_MINIAPP_BACKEND_PORT"
print_env_summary "Miniapp local" "$ROOT_DIR/miniapp/.env.development" \
  "VITE_API_URL" \
  "VITE_MINIAPP_BACKEND_PORT"
