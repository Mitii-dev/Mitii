#!/usr/bin/env bash
# Read-only SQLite COUNT probe for Mitii api-db-runtime-debug.
# Usage: probe-sqlite-count.sh <db-path> <table>
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <db-path> <table>" >&2
  exit 2
fi

DB="$1"
TABLE="$2"

if [[ ! -f "$DB" ]]; then
  echo "database file not found: $DB" >&2
  exit 1
fi

# Allow only simple table identifiers.
if [[ ! "$TABLE" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  echo "invalid table name: $TABLE" >&2
  exit 1
fi

sqlite3 -readonly "$DB" "SELECT COUNT(*) AS count FROM \"${TABLE}\";"
sqlite3 -readonly "$DB" "SELECT * FROM \"${TABLE}\" LIMIT 5;"
