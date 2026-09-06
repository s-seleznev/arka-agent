#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/db-env.sh"
# Explicit immutable fixture reference date; never resets or replaces animals.
"$ARKA_POSTGRES_BIN/psql" -X -v ON_ERROR_STOP=1 -v fixture_date="${1:-2026-09-04}" -1 -f "$ARKA_PROJECT_ROOT/scripts/rules-test-data.sql" -f "$ARKA_PROJECT_ROOT/scripts/rules-boundary-data.sql"
