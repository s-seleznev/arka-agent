#!/usr/bin/env bash

set -euo pipefail
source "$(dirname "$0")/db-env.sh"

if [[ ! -f "$ARKA_PGDATA/PG_VERSION" ]]; then
  echo "PostgreSQL cluster is not initialized"
  exit 0
fi

if "$ARKA_POSTGRES_BIN/pg_ctl" -D "$ARKA_PGDATA" status >/dev/null 2>&1; then
  "$ARKA_POSTGRES_BIN/pg_ctl" -D "$ARKA_PGDATA" -w stop >/dev/null
fi

echo "PostgreSQL stopped"

