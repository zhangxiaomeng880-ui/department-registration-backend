#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.runtime}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.runtime.yml}"
STATE_DIR="${STATE_DIR:-$ROOT_DIR/.runtime-deploy}"
TARGET_REF="${TARGET_REF:-}"
READY_URL="${READY_URL:-http://127.0.0.1:3100/ready}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3100/health}"
DEPLOY_TIMEOUT_SECONDS="${DEPLOY_TIMEOUT_SECONDS:-180}"

mkdir -p "$STATE_DIR"

bash "$ROOT_DIR/scripts/preflight-runtime-vps.sh"

cd "$ROOT_DIR"

current_ref="$(git rev-parse HEAD)"
printf '%s\n' "$current_ref" > "$STATE_DIR/previous_ref"

git fetch --all --prune

if [ -n "$TARGET_REF" ]; then
  git checkout --detach "$TARGET_REF"
fi

deploy_ref="$(git rev-parse HEAD)"
printf '%s\n' "$deploy_ref" > "$STATE_DIR/current_ref"
date -u +%Y-%m-%dT%H:%M:%SZ > "$STATE_DIR/deployed_at"

echo "Deploying commit: $deploy_ref"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config >/dev/null
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build

deadline=$((SECONDS + DEPLOY_TIMEOUT_SECONDS))
while [ "$SECONDS" -lt "$deadline" ]; do
  if curl --fail --silent "$HEALTH_URL" >/dev/null 2>&1 &&      curl --fail --silent "$READY_URL" >/tmp/ai-native-ready.json 2>/dev/null; then
    break
  fi
  sleep 3
done

curl --fail --silent "$HEALTH_URL" >/dev/null || {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
  echo "RUNTIME_DEPLOY_FAIL: health check failed" >&2
  exit 1
}

curl --fail --silent "$READY_URL" >/tmp/ai-native-ready.json || {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
  echo "RUNTIME_DEPLOY_FAIL: readiness check failed" >&2
  exit 1
}

grep -Eq '"status":"(ready|degraded)"' /tmp/ai-native-ready.json || {
  echo "RUNTIME_DEPLOY_FAIL: unexpected readiness status" >&2
  exit 1
}
grep -q '"database":{"ready":true}' /tmp/ai-native-ready.json || {
  echo "RUNTIME_DEPLOY_FAIL: database is not ready" >&2
  exit 1
}
grep -Eq '"runtimeAuth":\{"required":true,"ready":true' /tmp/ai-native-ready.json || {
  echo "RUNTIME_DEPLOY_FAIL: runtime auth is not ready" >&2
  exit 1
}

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

echo "RUNTIME_DEPLOY_PASS commit=$deploy_ref"
