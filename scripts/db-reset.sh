#!/usr/bin/env bash

set -euo pipefail
source "$(dirname "$0")/db-env.sh"

if [[ "$ARKA_DBNAME" != "arka_test" ]]; then
  echo "Refusing to reset unexpected database: $ARKA_DBNAME" >&2
  exit 2
fi

"$ARKA_PROJECT_ROOT/scripts/db-start.sh" >/dev/null

"$ARKA_POSTGRES_BIN/psql" -d postgres -v ON_ERROR_STOP=1 -q \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$ARKA_DBNAME' AND pid <> pg_backend_pid();" \
  -c "DROP DATABASE IF EXISTS $ARKA_DBNAME;" \
  -c "CREATE DATABASE $ARKA_DBNAME;"

"$ARKA_PROJECT_ROOT/scripts/db-migrate.sh"
"$ARKA_PROJECT_ROOT/scripts/db-seed.sh"

echo "reset: $ARKA_DBNAME"

