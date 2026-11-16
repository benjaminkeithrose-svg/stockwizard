#!/usr/bin/env bash
# Runs every migration and the security checks on a throwaway local Postgres.
# Needs PostgreSQL 16 installed; run as root (uses the postgres system user).
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
bin=/usr/lib/postgresql/16/bin
dir=$(mktemp -d /tmp/stockwizard-pg.XXXXXX)
chown postgres "$dir"
su postgres -c "$bin/initdb -D $dir/data -A trust >/dev/null && $bin/pg_ctl -D $dir/data -o '-k $dir -p 5498' -l $dir/log -w start >/dev/null"
trap 'su postgres -c "$bin/pg_ctl -D $dir/data -m immediate stop >/dev/null"; rm -rf "$dir"' EXIT
for f in "$here"/tests/supabase_stub.sql "$here"/migrations/*.sql "$here"/tests/rls_test.sql; do
  psql -h "$dir" -p 5498 -U postgres -q -v ON_ERROR_STOP=1 -f "$f" postgres
done
