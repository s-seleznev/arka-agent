#!/usr/bin/env bash

set -euo pipefail
source "$(dirname "$0")/db-env.sh"

seed="${1:-42}"
output="$ARKA_LOCAL_DIR/generated/farm-seed-$seed.sql"
mkdir -p "$(dirname "$output")"

python3 "$ARKA_PROJECT_ROOT/scripts/db-generate.py" \
  --seed "$seed" \
  --farms 2 \
  --animals-per-farm 40 \
  --as-of 2026-08-31 \
  --output "$output"

"$ARKA_POSTGRES_BIN/psql" -v ON_ERROR_STOP=1 -f "$output" >/dev/null
"$ARKA_POSTGRES_BIN/psql" -v ON_ERROR_STOP=1 -Atqc \
  "SELECT refresh_animal_state_query();" >/dev/null
echo "generated: seed=$seed farms=2 animals=80"
