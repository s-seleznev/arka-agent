#!/usr/bin/env bash

set -euo pipefail
source "$(dirname "$0")/db-env.sh"

mkdir -p "$ARKA_PGSOCKET" "$(dirname "$ARKA_PGLOG")"

if [[ ! -f "$ARKA_PGDATA/PG_VERSION" ]]; then
  mkdir -p "$ARKA_PGDATA"
  "$ARKA_POSTGRES_BIN/initdb" \
    -D "$ARKA_PGDATA" \
    -U "$ARKA_PGUSER" \
    -A trust \
    --encoding=UTF8 \
    --locale=C >/dev/null
fi

if ! "$ARKA_POSTGRES_BIN/pg_ctl" -D "$ARKA_PGDATA" status >/dev/null 2>&1; then
  "$ARKA_POSTGRES_BIN/pg_ctl" \
    -D "$ARKA_PGDATA" \
    -l "$ARKA_PGLOG" \
    -o "-p $ARKA_PGPORT -k '$ARKA_PGSOCKET' -h 127.0.0.1" \
    -w start >/dev/null
fi

if ! "$ARKA_POSTGRES_BIN/psql" -d postgres -Atqc \
  "SELECT 1 FROM pg_database WHERE datname = '$ARKA_DBNAME'" | grep -qx 1; then
  "$ARKA_POSTGRES_BIN/createdb" "$ARKA_DBNAME"
fi

echo "PostgreSQL ready: $ARKA_DBNAME on 127.0.0.1:$ARKA_PGPORT"

