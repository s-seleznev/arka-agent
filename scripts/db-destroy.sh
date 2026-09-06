#!/usr/bin/env bash

set -euo pipefail
source "$(dirname "$0")/db-env.sh"

if [[ "${1:-}" != "arka_test" || "${2:-}" != "--yes" ]]; then
  echo "Usage: scripts/db-destroy.sh arka_test --yes" >&2
  exit 2
fi

if [[ "$ARKA_DBNAME" != "arka_test" ]]; then
  echo "Refusing to destroy unexpected database: $ARKA_DBNAME" >&2
  exit 2
fi

"$ARKA_PROJECT_ROOT/scripts/db-start.sh" >/dev/null
"$ARKA_POSTGRES_BIN/dropdb" --if-exists "$ARKA_DBNAME"
"$ARKA_PROJECT_ROOT/scripts/db-stop.sh" >/dev/null
rm -rf "$ARKA_LOCAL_DIR/postgres"

echo "destroyed isolated test database and cluster"

