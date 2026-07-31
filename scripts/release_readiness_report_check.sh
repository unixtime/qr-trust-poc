#!/usr/bin/env sh
set -eu

report_file="$(mktemp "${TMPDIR:-/tmp}/qrtrust-release-readiness.XXXXXX.md")"
output_file="$(mktemp "${TMPDIR:-/tmp}/qrtrust-release-readiness-output.XXXXXX")"

cleanup() {
  rm -f "$report_file" "$output_file"
}

trap cleanup EXIT HUP INT TERM

RELEASE_READINESS_REPORT="$report_file" sh ./scripts/release_readiness_report.sh >"$output_file"

require_report_text() {
  pattern="$1"
  description="$2"

  if grep -Fq "$pattern" "$report_file"; then
    printf "PASS: %s\n" "$description"
  else
    printf "FAIL: %s\n" "$description" >&2
    printf "Expected to find: %s\n" "$pattern" >&2
    printf "Report: %s\n" "$report_file" >&2
    sed -n '1,180p' "$report_file" >&2
    exit 1
  fi
}

require_report_text "## Production Reference Evidence" "production evidence section exists"
require_report_text "Status: BLOCKED_FOR_PRODUCTION" "blocked production verdict is visible"
require_report_text "Closure bundle: \`blocked_until_operator_refs_complete\`" "closure status is reported"
require_report_text "Remaining operator refs: \`13\`" "missing operator refs are reported"
require_report_text "local/production-evidence-closure-bundle.md" "operator closure handoff path is reported"

printf "Release readiness report check passed.\n"
