#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/db-env.sh"
if [[ $# != 1 ]]; then
  echo 'Usage: rules-541-data.sh <explicit-as-of-ISO-timestamp>' >&2
  exit 2
fi
"$ARKA_POSTGRES_BIN/psql" -X -v ON_ERROR_STOP=1 -v fixture_as_of="$1" -1 \
  -f "$ARKA_PROJECT_ROOT/scripts/rules-541-data.sql" \
  -c 'SELECT refresh_animal_state_query();' \
  -f "$ARKA_PROJECT_ROOT/scripts/rules-541-validate-data.sql"
