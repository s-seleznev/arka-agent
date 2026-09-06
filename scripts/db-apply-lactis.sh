#!/usr/bin/env bash

set -euo pipefail

# Explicit opt-in apply for the already generated, guarded artifact. No reset,
# farm discovery, or multi-farm generation is performed here.
source "$(dirname "$0")/db-env.sh"
sql_file="${1:?usage: db-apply-lactis.sh /absolute/path/to/fixture.sql}"
farm_id="2911f095-dd8c-5878-a8f3-2e027513ad6a"

python3 "$(dirname "$0")/db-generate-check.py" "$sql_file" --farm-id "$farm_id"
other_farms_before="$($ARKA_POSTGRES_BIN/psql -v ON_ERROR_STOP=1 -Atqc \
  "SELECT count(*) FROM animal WHERE farm_id <> '$farm_id'::uuid")"
other_events_before="$($ARKA_POSTGRES_BIN/psql -v ON_ERROR_STOP=1 -Atqc \
  "SELECT count(*) FROM animal_event WHERE farm_id <> '$farm_id'::uuid")"
"$ARKA_POSTGRES_BIN/psql" -v ON_ERROR_STOP=1 -1 -f "$sql_file"
other_farms_after="$($ARKA_POSTGRES_BIN/psql -v ON_ERROR_STOP=1 -Atqc \
  "SELECT count(*) FROM animal WHERE farm_id <> '$farm_id'::uuid")"
other_events_after="$($ARKA_POSTGRES_BIN/psql -v ON_ERROR_STOP=1 -Atqc \
  "SELECT count(*) FROM animal_event WHERE farm_id <> '$farm_id'::uuid")"
if [[ "$other_farms_before" != "$other_farms_after" || "$other_events_before" != "$other_events_after" ]]; then
  echo "scope check failed: other-farm rows changed" >&2
  exit 1
fi
echo "applied guarded fixture: farm=$farm_id sql=$sql_file"
