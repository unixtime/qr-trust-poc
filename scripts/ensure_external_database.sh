#!/usr/bin/env sh
set -eu

DB_HOST="${EXTERNAL_DB_SETUP_HOST:-127.0.0.1}"
DB_PORT="${EXTERNAL_DB_PORT:-5432}"
DB_USER="${EXTERNAL_DB_USER:-publisher}"
DB_PASSWORD="${EXTERNAL_DB_PASSWORD:-publisher}"
DB_NAME="${EXTERNAL_DB_NAME:-qr_trust_poc}"
ADMIN_DB="${EXTERNAL_DB_ADMIN_DB:-postgres}"

fail() {
  printf "External database setup failed: %s\n" "$1" >&2
  exit 1
}

case "$DB_NAME" in
  ""|*[!A-Za-z0-9_]*|[0-9]*)
    fail "EXTERNAL_DB_NAME must be a simple PostgreSQL identifier"
    ;;
esac

case "$DB_NAME" in
  publisher)
    fail "EXTERNAL_DB_NAME must not be publisher; that database is reserved for the existing local project"
    ;;
esac

case "$DB_USER" in
  ""|*[!A-Za-z0-9_]*|[0-9]*)
    fail "EXTERNAL_DB_USER must be a simple PostgreSQL identifier"
    ;;
esac

if ! command -v psql >/dev/null 2>&1; then
  fail "psql is required to create or verify the shared-infra database"
fi

if PGPASSWORD="$DB_PASSWORD" psql \
  --host "$DB_HOST" \
  --port "$DB_PORT" \
  --username "$DB_USER" \
  --dbname "$DB_NAME" \
  --no-password \
  --command "select 1" >/dev/null 2>&1; then
  printf "External database %s is available on %s:%s\n" "$DB_NAME" "$DB_HOST" "$DB_PORT"
  exit 0
fi

if ! PGPASSWORD="$DB_PASSWORD" psql \
  --host "$DB_HOST" \
  --port "$DB_PORT" \
  --username "$DB_USER" \
  --dbname "$ADMIN_DB" \
  --no-password \
  --tuples-only \
  --no-align \
  --command "select 1 from pg_database where datname = '${DB_NAME}'" | grep -qx "1"; then
  PGPASSWORD="$DB_PASSWORD" psql \
    --host "$DB_HOST" \
    --port "$DB_PORT" \
    --username "$DB_USER" \
    --dbname "$ADMIN_DB" \
    --set ON_ERROR_STOP=1 \
    --no-password \
    --command "create database \"$DB_NAME\" owner \"$DB_USER\"" >/dev/null
  printf "Created external database %s on %s:%s\n" "$DB_NAME" "$DB_HOST" "$DB_PORT"
else
  printf "External database %s exists on %s:%s\n" "$DB_NAME" "$DB_HOST" "$DB_PORT"
fi
