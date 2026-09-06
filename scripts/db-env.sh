#!/usr/bin/env bash

set -euo pipefail

ARKA_PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARKA_LOCAL_DIR="$ARKA_PROJECT_ROOT/.local"
ARKA_PGDATA="$ARKA_LOCAL_DIR/postgres/data"
ARKA_PGSOCKET="${ARKA_PGSOCKET:-/tmp/arka-head-product-pg}"
ARKA_PGLOG="$ARKA_LOCAL_DIR/postgres/server.log"
ARKA_PGPORT="${ARKA_PGPORT:-55432}"
ARKA_PGUSER="${ARKA_PGUSER:-arka_admin}"
ARKA_DBNAME="${ARKA_DBNAME:-arka_test}"

ARKA_POSTGRES_BIN="$(dirname "$(command -v postgres)")"

export PGHOST="$ARKA_PGSOCKET"
export PGPORT="$ARKA_PGPORT"
export PGUSER="$ARKA_PGUSER"
export PGDATABASE="$ARKA_DBNAME"
