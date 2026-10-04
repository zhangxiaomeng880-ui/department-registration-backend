#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.runtime}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.runtime.yml}"

fail() {
  echo "VPS_PREFLIGHT_FAIL: $*" >&2
  exit 1
}

command -v git >/dev/null 2>&1 || fail "git is required"
command -v docker >/dev/null 2>&1 || fail "docker is required"
command -v curl >/dev/null 2>&1 || fail "curl is required"
docker compose version >/dev/null 2>&1 || fail "docker compose plugin is required"

cd "$ROOT_DIR"
git diff --quiet || fail "tracked working tree has uncommitted changes"
git diff --cached --quiet || fail "index has uncommitted changes"

test -f "$ENV_FILE" || fail "missing $ENV_FILE"
test -f "$COMPOSE_FILE" || fail "missing $COMPOSE_FILE"

required_vars=(
  MYSQL_DATABASE
  MYSQL_USER
  MYSQL_PASSWORD
  MYSQL_ROOT_PASSWORD
  RUNTIME_API_TOKEN
)

for key in "${required_vars[@]}"; do
  value="$(grep -E "^${key}=" "$ENV_FILE" | tail -n1 | cut -d= -f2- || true)"
  test -n "$value" || fail "$key is missing from $ENV_FILE"
  case "$value" in
    CHANGE_ME*|changeme*|example*|EXAMPLE*)
      fail "$key still contains a placeholder"
      ;;
  esac
done

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config >/dev/null

if ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq '(^|:)3306$'; then
  echo "VPS_PREFLIGHT_NOTE: host port 3306 is already listening; deployment compose itself does not publish MySQL."
fi

echo "VPS_PREFLIGHT_PASS"
