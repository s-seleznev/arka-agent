#!/usr/bin/env bash

set -euo pipefail
source "$(dirname "$0")/db-env.sh"

seed="${1:-42}"
farms="${2:-6}"
animals_per_farm="${3:-8500}"
output="$ARKA_LOCAL_DIR/generated/farm-scale-seed-$seed.sql"

"$ARKA_PROJECT_ROOT/scripts/db-reset.sh" >/dev/null
mkdir -p "$(dirname "$output")"

python3 "$ARKA_PROJECT_ROOT/scripts/db-generate.py" \
  --seed "$seed" \
  --farms "$farms" \
  --animals-per-farm "$animals_per_farm" \
  --profile realistic \
  --as-of 2026-08-31 \
  --output "$output"

"$ARKA_POSTGRES_BIN/psql" -v ON_ERROR_STOP=1 -f "$output" >/dev/null
projected_rows="$("$ARKA_POSTGRES_BIN/psql" -v ON_ERROR_STOP=1 -Atqc \
  "SELECT refresh_animal_state_query();")"
echo "generated scale dataset: seed=$seed farms=$farms animals=$((farms * animals_per_farm))"
echo "query projection refreshed: rows=$projected_rows"
