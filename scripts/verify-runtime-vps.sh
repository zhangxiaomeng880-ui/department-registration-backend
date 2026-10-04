#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.runtime}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.runtime.yml}"

read_env() {
  local key="$1"
  local value
  value="$(grep -E "^${key}=" "$ENV_FILE" | tail -n1 | cut -d= -f2- || true)"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

runtime_host_port="$(read_env RUNTIME_HOST_PORT)"
runtime_host_port="${runtime_host_port:-3100}"
runtime_api_token="$(read_env RUNTIME_API_TOKEN)"
test -n "$runtime_api_token"

base_url="http://127.0.0.1:${runtime_host_port}"

curl --fail --silent "$base_url/health" >/dev/null
ready="$(curl --fail --silent "$base_url/ready")"

printf '%s' "$ready" | grep -Eq '"status":"(ready|degraded)"'
printf '%s' "$ready" | grep -q '"database":{"ready":true}'
printf '%s' "$ready" | grep -Eq '"runtimeAuth":\{"required":true,"ready":true'

unauth_status="$(curl -s -o /tmp/runtime-unauth.json -w '%{http_code}'   -H 'content-type: application/json'   -d '{"projectKey":"verify-unauth","name":"verify","projectType":"AIGC_CONTENT"}'   "$base_url/api/runtime/projects")"
test "$unauth_status" = "401"

auth_status="$(curl -s -o /tmp/runtime-auth.json -w '%{http_code}'   -H 'content-type: application/json'   -H "authorization: Bearer $runtime_api_token"   -d '{"projectKey":"verify-'$(date +%s)'","name":"VPS Verify","projectType":"AIGC_CONTENT"}'   "$base_url/api/runtime/projects")"
test "$auth_status" = "201"

mysql_port="$(docker inspect ai-native-mysql --format '{{with index .NetworkSettings.Ports "3306/tcp"}}{{json .}}{{end}}')"
test -z "$mysql_port"

runtime_host_ip="$(docker inspect ai-native-runtime --format '{{(index (index .NetworkSettings.Ports "3100/tcp") 0).HostIp}}')"
test "$runtime_host_ip" = "127.0.0.1"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

echo "RUNTIME_VPS_VERIFY_PASS"
