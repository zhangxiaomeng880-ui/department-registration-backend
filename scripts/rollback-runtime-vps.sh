#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.runtime}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.runtime.yml}"
STATE_DIR="${STATE_DIR:-$ROOT_DIR/.runtime-deploy}"
PREVIOUS_REF_FILE="$STATE_DIR/previous_ref"

test -f "$PREVIOUS_REF_FILE" || {
  echo "RUNTIME_ROLLBACK_FAIL: previous_ref not found" >&2
  exit 1
}

previous_ref="$(cat "$PREVIOUS_REF_FILE")"
test -n "$previous_ref" || {
  echo "RUNTIME_ROLLBACK_FAIL: previous_ref is empty" >&2
  exit 1
}

cd "$ROOT_DIR"
git checkout --detach "$previous_ref"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build

for i in $(seq 1 60); do
  if curl --fail --silent http://127.0.0.1:3100/ready >/dev/null 2>&1; then
    echo "RUNTIME_ROLLBACK_PASS commit=$previous_ref"
    exit 0
  fi
  sleep 3
done

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
echo "RUNTIME_ROLLBACK_FAIL: runtime did not become ready" >&2
exit 1
