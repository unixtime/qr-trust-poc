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

PSQL_STDERR="$(mktemp)" || fail "could not create a temporary file for psql diagnostics"
trap 'rm -f "$PSQL_STDERR"' EXIT

# Runs psql against $1 with the SQL in $2; any further arguments are passed
# through. stdout is left to the caller, stderr is captured so a failure can be
# explained rather than dumped raw. Every call site passes at least one extra
# flag: /bin/sh here is bash 3.2, which treats an empty "$@" under `set -u` as
# an unbound variable.
run_psql() {
  psql_dbname="$1"
  psql_sql="$2"
  shift 2
  PGPASSWORD="$DB_PASSWORD" psql \
    --host "$DB_HOST" \
    --port "$DB_PORT" \
    --username "$DB_USER" \
    --dbname "$psql_dbname" \
    --no-password \
    "$@" \
    --command "$psql_sql" 2>"$PSQL_STDERR"
}

# psql's own wording misleads in shared-infra mode, because the server this
# target reuses is *external*: when another stack is squatting on
# DB_HOST:DB_PORT the TCP connect still succeeds and the failure surfaces at the
# auth layer, which reads like a stale password rather than "wrong server".
# Classify what psql actually said, and always name the address we dialled.
explain_psql_failure() {
  detail="$(cat "$PSQL_STDERR" 2>/dev/null || true)"

  case "$detail" in
    *"Connection refused"*|*"could not translate host name"*|*"No route to host"*|*"Operation timed out"*|*"Connection timed out"*)
      fail "nothing is listening for PostgreSQL on ${DB_HOST}:${DB_PORT}.
  shared-infra mode reuses an existing external Postgres; it never starts one.
  This machine runs Postgres only in Docker -- there is no Homebrew server to
  start. Bring up the stack's own container and point this target at it:
    make up-https-admin-nats
    make ensure-shared-infra-db EXTERNAL_DB_USER=qr_admin \\
      EXTERNAL_DB_PASSWORD=qr_dev_password EXTERNAL_DB_NAME=qr_db
  Or set EXTERNAL_DB_SETUP_HOST / EXTERNAL_DB_PORT to whichever container
  publishes the server you meant.
${detail}"
      ;;
    *"role \"$DB_USER\" does not exist"*)
      fail "PostgreSQL on ${DB_HOST}:${DB_PORT} has no role named \"${DB_USER}\".
  Create it:  createuser -h ${DB_HOST} -p ${DB_PORT} --createdb ${DB_USER}
${detail}"
      ;;
    *"password authentication failed"*)
      fail "PostgreSQL on ${DB_HOST}:${DB_PORT} rejected the login for role \"${DB_USER}\".
  PostgreSQL sends this same message whether the role is missing or the password
  is wrong -- it deliberately will not say which, so that strangers cannot
  enumerate role names. Check which one you have:
    psql -h ${DB_HOST} -p ${DB_PORT} -d ${ADMIN_DB} -c '\\du'
    createuser -h ${DB_HOST} -p ${DB_PORT} --createdb ${DB_USER}
  Then confirm ${DB_HOST}:${DB_PORT} really is the external server you meant. A
  different stack listening on that port fails in exactly this way.
${detail}"
      ;;
    *"no pg_hba.conf entry"*)
      fail "PostgreSQL on ${DB_HOST}:${DB_PORT} refuses connections from this host for
  role \"${DB_USER}\". Add a matching pg_hba.conf line and reload the server.
${detail}"
      ;;
    *)
      fail "could not reach database \"${DB_NAME}\" on ${DB_HOST}:${DB_PORT}.
${detail}"
      ;;
  esac
}

if run_psql "$DB_NAME" "select 1" --tuples-only --no-align >/dev/null; then
  printf "External database %s is available on %s:%s\n" "$DB_NAME" "$DB_HOST" "$DB_PORT"
  exit 0
fi

# A missing database is the ordinary first-run path, so it falls through to the
# create branch below. Every other cause -- no server, unknown role, no pg_hba
# entry -- would only fail again, more confusingly, against the admin database.
# Stop here while the first and most informative error is still in hand.
case "$(cat "$PSQL_STDERR")" in
  *"database \"$DB_NAME\" does not exist"*) ;;
  *) explain_psql_failure ;;
esac

# Captured rather than piped into grep: a pipeline reports only its last exit
# status, so a psql that never ran would look identical to "no such row" and
# send us on to create a database we cannot reach.
if ! db_exists="$(run_psql "$ADMIN_DB" "select 1 from pg_database where datname = '${DB_NAME}'" --tuples-only --no-align)"; then
  explain_psql_failure
fi

if [ "$db_exists" = "1" ]; then
  printf "External database %s exists on %s:%s\n" "$DB_NAME" "$DB_HOST" "$DB_PORT"
else
  if ! run_psql "$ADMIN_DB" "create database \"$DB_NAME\" owner \"$DB_USER\"" --set ON_ERROR_STOP=1 >/dev/null; then
    explain_psql_failure
  fi
  printf "Created external database %s on %s:%s\n" "$DB_NAME" "$DB_HOST" "$DB_PORT"
fi
