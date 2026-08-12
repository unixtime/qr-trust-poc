#!/usr/bin/env sh
set -eu

# Fails until every container in the compose project is both up and staying up.
#
# `docker compose up -d` exits 0 once containers have been *started*, which is
# not the same as working. A worker that boots, fails its authorization check
# and exits(1) still leaves the bring-up target green; with
# `restart: unless-stopped` it then crash-loops silently. That is how the stack
# came to report success while the governance and runtime subscribers were
# dying on "NATS subscriber is not active or authorized".
#
# So this checks two different things, in order:
#
#   readiness  -- every container reports running, and every container that
#                 declares a healthcheck reports healthy.
#   stability  -- nothing restarts during a settle window afterwards.
#
# Readiness alone is not enough: a crash-looping container passes it every time
# it comes back up. Watching RestartCount over a window is what separates
# "started" from "working", because a container that dies and is restarted
# increments it whether or not we happen to poll while it is down.
#
# Usage: wait_for_stack_settled.sh -f compose.yml -f compose.nats.yml
# Env:   STACK_READY_TIMEOUT (default 120s), STACK_SETTLE_SECONDS (default 12s)

READY_TIMEOUT="${STACK_READY_TIMEOUT:-120}"
SETTLE_SECONDS="${STACK_SETTLE_SECONDS:-12}"

if [ "$#" -eq 0 ]; then
  set -- -f compose.yml
fi

fail() {
  printf 'Stack did not settle: %s\n' "$1" >&2
  exit 1
}

# Container name, minus the project and replica decoration compose adds, so
# messages read like the service names a developer actually typed.
name_of() {
  docker inspect -f '{{.Name}}' "$1" 2>/dev/null | sed 's|^/||'
}

state_of() {
  docker inspect -f '{{.State.Status}}' "$1" 2>/dev/null || echo missing
}

# Prints "none" for containers without a healthcheck. Go's template engine
# errors on a nil .State.Health rather than rendering empty, hence the guard.
health_of() {
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$1" 2>/dev/null || echo none
}

restarts_of() {
  docker inspect -f '{{.RestartCount}}' "$1" 2>/dev/null || echo 0
}

# Enough of the container's own output to identify the failure without making
# the caller go digging. Crash-loop causes are almost always in the last lines.
#
# One cause is common enough to name outright, in the spirit of
# explain_psql_failure() in ensure_external_database.sh: an unseeded database.
# The governance and runtime subscriber workers refuse to start until
# demo-bootstrap has written qr_trust.nats_subscribers, so on a fresh clone this
# check fails on the very first bring-up -- correctly, because the stack really
# is not working, but the raw log reads like a broken deployment rather than a
# missing setup step.
report_failure() {
  cid="$1"
  reason="$2"
  cname="$(name_of "$cid")"
  logs="$(docker logs --tail 15 "$cid" 2>&1 || true)"

  printf '\n--- %s: %s ---\n' "$cname" "$reason" >&2
  printf '%s\n' "$logs" | sed 's/^/    /' >&2

  case "$logs" in
    *"NATS subscriber is not active or authorized"*)
      printf '\nThis database has no NATS subscriber allowlist yet. The containers\n' >&2
      printf 'are up -- seed it, and they will stop restarting:\n\n' >&2
      printf '  make demo-bootstrap\n\n' >&2
      ;;
  esac

  fail "$cname $reason"
}

# `ps -q` lists running containers only. Two consequences, both wanted here:
# a service a target deliberately stopped (up-https-admin-shared-infra stops
# postgres and redis) is invisible rather than a false failure, and the one-shot
# management-cli container from a `compose run` is not mistaken for a crash.
#
# The blind spot is a container that exits and stays exited -- it would not be
# listed at all. Every long-running service in compose.yml and compose.nats.yml
# carries `restart: unless-stopped`, so a crashed one is always running or
# restarting and always listed; management-cli is the only service without that
# policy, and it is meant to exit. A new service added without a restart policy
# would slip past this check.
cids="$(docker compose "$@" ps -q)"
[ -n "$cids" ] || fail "no containers are running for this compose project"

printf 'Waiting for containers to report ready (timeout %ss)...\n' "$READY_TIMEOUT"

elapsed=0
while :; do
  pending=""
  for cid in $cids; do
    state="$(state_of "$cid")"
    health="$(health_of "$cid")"

    # An exited container is terminal: waiting cannot improve it. Report at once
    # rather than burning the whole timeout on something already dead.
    if [ "$state" = exited ]; then
      code="$(docker inspect -f '{{.State.ExitCode}}' "$cid" 2>/dev/null || echo '?')"
      report_failure "$cid" "exited with code $code"
    fi

    case "$state:$health" in
      running:healthy|running:none) ;;
      *) pending="$pending $(name_of "$cid")($state${health:+/$health})" ;;
    esac
  done

  [ -n "$pending" ] || break

  if [ "$elapsed" -ge "$READY_TIMEOUT" ]; then
    fail "still not ready after ${READY_TIMEOUT}s:$pending"
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done

printf 'All containers ready. Watching %ss for restarts...\n' "$SETTLE_SECONDS"

# Snapshot before the window, compare after. A container that crash-looped in
# between shows a higher count even if it is running again by the time we look.
before=""
for cid in $cids; do
  before="$before $cid:$(restarts_of "$cid")"
done

sleep "$SETTLE_SECONDS"

for entry in $before; do
  cid="${entry%%:*}"
  was="${entry##*:}"
  now="$(restarts_of "$cid")"
  state="$(state_of "$cid")"

  if [ "$now" -gt "$was" ]; then
    report_failure "$cid" "restarted $((now - was)) time(s) during the ${SETTLE_SECONDS}s settle window"
  fi
  if [ "$state" != running ]; then
    report_failure "$cid" "left the running state (now: $state)"
  fi
done

printf 'Stack settled: %s containers up and stable.\n' "$(printf '%s\n' $cids | wc -l | tr -d ' ')"
