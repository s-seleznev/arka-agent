#!/usr/bin/env bash

set -euo pipefail

# This wrapper only writes a SQL artifact. It never resets or connects to DB.
seed="${1:-42}"
animals="${2:-40}"
as_of="${3:?usage: db-generate-lactis.sh SEED ANIMALS AS_OF_DATE [OUTPUT] }"
output="${4:-/tmp/lactis-prime-8-seed-${seed}-${as_of}.sql}"
farm_id="2911f095-dd8c-5878-a8f3-2e027513ad6a"

python3 "$(dirname "$0")/db-generate.py" \
  --seed "$seed" \
  --farms 1 \
  --animals-per-farm "$animals" \
  --profile realistic \
  --as-of "$as_of" \
  --farm-id "$farm_id" \
  --existing-farm \
  --output "$output"

python3 "$(dirname "$0")/db-generate-check.py" "$output" --farm-id "$farm_id"
echo "generated guarded fixture: farm=$farm_id seed=$seed animals=$animals output=$output"
