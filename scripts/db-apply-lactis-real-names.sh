#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -a
source "$script_dir/../agent-app/.env.local"
set +a
psql "$FARM_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$script_dir/db-lactis-real-names.sql"
