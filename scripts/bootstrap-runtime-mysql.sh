#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.mysql.yml}"
ENV_FILE="${ENV_FILE:-.env.runtime}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy .env.runtime.example and set strong passwords." >&2
  exit 1
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d mysql

echo "Waiting for MySQL health..."
for _ in $(seq 1 30); do
  status="$(docker inspect --format='{{.State.Health.Status}}' ai-native-mysql 2>/dev/null || true)"
  if [[ "$status" == "healthy" ]]; then
    break
  fi
  sleep 2
done

status="$(docker inspect --format='{{.State.Health.Status}}' ai-native-mysql 2>/dev/null || true)"
if [[ "$status" != "healthy" ]]; then
  echo "MySQL did not become healthy. Current status: $status" >&2
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=100 mysql
  exit 1
fi

echo "MySQL is healthy."

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T mysql   sh -lc 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e "
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
    ORDER BY table_name;
  "'

echo "Runtime persistence bootstrap completed."
