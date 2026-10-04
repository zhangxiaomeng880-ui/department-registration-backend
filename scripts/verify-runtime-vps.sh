#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.runtime}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.runtime.yml}"

set -a
source "$ENV_FILE"
set +a

base_url="http://127.0.0.1:${RUNTIME_HOST_PORT:-3100}"

curl --fail --silent "$base_url/health" >/dev/null
ready="$(curl --fail --silent "$base_url/ready")"

node -e "
const d=JSON.parse(process.argv[1]);
if (!['ready','degraded'].includes(d.status)) process.exit(1);
if (!d.components?.database?.ready) process.exit(2);
if (!d.components?.runtimeAuth?.ready) process.exit(3);
" "$ready"

unauth_status="$(curl -s -o /tmp/runtime-unauth.json -w '%{http_code}'   -H 'content-type: application/json'   -d '{"projectKey":"verify-unauth","name":"verify","projectType":"AIGC_CONTENT"}'   "$base_url/api/runtime/projects")"
test "$unauth_status" = "401"

auth_status="$(curl -s -o /tmp/runtime-auth.json -w '%{http_code}'   -H 'content-type: application/json'   -H "authorization: Bearer $RUNTIME_API_TOKEN"   -d '{"projectKey":"verify-'$(date +%s)'","name":"VPS Verify","projectType":"AIGC_CONTENT"}'   "$base_url/api/runtime/projects")"
test "$auth_status" = "201"

mysql_port="$(docker inspect ai-native-mysql --format '{{with index .NetworkSettings.Ports "3306/tcp"}}{{json .}}{{end}}')"
test -z "$mysql_port"

runtime_host_ip="$(docker inspect ai-native-runtime --format '{{(index (index .NetworkSettings.Ports "3100/tcp") 0).HostIp}}')"
test "$runtime_host_ip" = "127.0.0.1"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

echo "RUNTIME_VPS_VERIFY_PASS"
