#!/usr/bin/env bash

set -euo pipefail
source "$(dirname "$0")/db-env.sh"

"$ARKA_PROJECT_ROOT/scripts/db-reset.sh" >/dev/null

first="$ARKA_LOCAL_DIR/generated/determinism-a.sql"
second="$ARKA_LOCAL_DIR/generated/determinism-b.sql"
mkdir -p "$(dirname "$first")"

python3 "$ARKA_PROJECT_ROOT/scripts/db-generate.py" \
  --seed 42 --farms 2 --animals-per-farm 40 --as-of 2026-08-31 --output "$first" >/dev/null
python3 "$ARKA_PROJECT_ROOT/scripts/db-generate.py" \
  --seed 42 --farms 2 --animals-per-farm 40 --as-of 2026-08-31 --output "$second" >/dev/null
cmp -s "$first" "$second"
echo "passed: deterministic generator"

"$ARKA_POSTGRES_BIN/psql" -v ON_ERROR_STOP=1 -f "$first" >/dev/null
"$ARKA_POSTGRES_BIN/psql" -v ON_ERROR_STOP=1 -Atqc \
  "SELECT refresh_animal_state_query();" >/dev/null
"$ARKA_POSTGRES_BIN/psql" -v ON_ERROR_STOP=1 -f "$ARKA_PROJECT_ROOT/db/queries/invariants.sql" >/dev/null
echo "passed: invariants and point-in-time correction"

snapshot_revision="$($ARKA_POSTGRES_BIN/psql -Atqc "SELECT revision FROM animal_state_query_snapshot WHERE singleton")"
if [[ ! "$snapshot_revision" =~ ^[0-9]+$ ]] || (( snapshot_revision < 1 )); then
  echo "snapshot failure: expected a positive projection revision, got $snapshot_revision" >&2
  exit 1
fi
echo "passed: query projection snapshot revision"

"$ARKA_POSTGRES_BIN/psql" -v ON_ERROR_STOP=1 -f "$ARKA_PROJECT_ROOT/db/queries/constraints.sql" >/dev/null
echo "passed: tenant, detail, and custom-field constraints"

for query in "$ARKA_PROJECT_ROOT"/db/queries/acceptance/*.sql; do
  "$ARKA_POSTGRES_BIN/psql" -v ON_ERROR_STOP=1 -f "$query" >/dev/null
  echo "passed: $(basename "$query")"
done

farm_id="$($ARKA_POSTGRES_BIN/psql -Atqc "SELECT id FROM farm ORDER BY id LIMIT 1")"
visible="$($ARKA_POSTGRES_BIN/psql -Atqc "SET ROLE arka_reader; SELECT set_config('arka.farm_id','$farm_id',false); SELECT count(*) FROM animal;")"
visible="$(printf '%s\n' "$visible" | tail -n 1)"
if [[ "$visible" != "40" ]]; then
  echo "RLS failure: expected 40 visible animals, got $visible" >&2
  exit 1
fi
echo "passed: farm row-level isolation"

query_plan="$($ARKA_POSTGRES_BIN/psql -Atqc "SET enable_seqscan=off; EXPLAIN (COSTS OFF) SELECT * FROM animal_event WHERE farm_id=(SELECT id FROM farm LIMIT 1) AND animal_id=(SELECT id FROM animal LIMIT 1) ORDER BY occurred_at DESC, recorded_at DESC LIMIT 20;")"
if [[ "$query_plan" != *"animal_event_history_idx"* ]]; then
  echo "query plan failure: animal_event_history_idx is not used" >&2
  exit 1
fi
echo "passed: indexed animal history query"

echo "all checks passed"
