#!/usr/bin/env bash

set -euo pipefail
source "$(dirname "$0")/db-env.sh"

"$ARKA_PROJECT_ROOT/scripts/db-migrate.sh" >/dev/null

for seed_file in "$ARKA_PROJECT_ROOT"/db/seeds/*.sql; do
  "$ARKA_POSTGRES_BIN/psql" -v ON_ERROR_STOP=1 -1 -f "$seed_file" >/dev/null
  echo "seeded: $(basename "$seed_file")"
done

