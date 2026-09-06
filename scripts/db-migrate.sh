#!/usr/bin/env bash

set -euo pipefail
source "$(dirname "$0")/db-env.sh"

"$ARKA_PROJECT_ROOT/scripts/db-start.sh" >/dev/null

"$ARKA_POSTGRES_BIN/psql" -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
SQL

for migration in "$ARKA_PROJECT_ROOT"/db/migrations/*.sql; do
  migration_name="$(basename "$migration")"
  applied="$($ARKA_POSTGRES_BIN/psql -Atqc \
    "SELECT 1 FROM schema_migrations WHERE name = '$migration_name'")"
  if [[ "$applied" == "1" ]]; then
    continue
  fi

  "$ARKA_POSTGRES_BIN/psql" \
    -v ON_ERROR_STOP=1 \
    -1 \
    -f "$migration" \
    -c "INSERT INTO schema_migrations(name) VALUES ('$migration_name');" >/dev/null
  echo "applied: $migration_name"
done
