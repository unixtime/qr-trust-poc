#!/usr/bin/env sh
set -eu

EVIDENCE_DIR="${BROWSER_EVIDENCE_DIR:-docs/public/evidence/browser}"
EXPECTED_WIDTH="${BROWSER_EVIDENCE_WIDTH:-1440}"
MIN_HEIGHT="${BROWSER_EVIDENCE_MIN_HEIGHT:-1000}"
MIN_SIZE_BYTES="${BROWSER_EVIDENCE_MIN_SIZE_BYTES:-102400}"
failures=0

fail() {
  failures=$((failures + 1))
  printf "FAIL: %s\n" "$1"
}

pass() {
  printf "PASS: %s\n" "$1"
}

check_png_dimensions() {
  artifact="$1"

  if ! command -v file >/dev/null 2>&1; then
    printf "WARN: file command unavailable; PNG dimensions were not checked for %s\n" "$artifact"
    return
  fi

  file_output="$(file -b "$artifact")"
  dimensions="$(
    printf "%s\n" "$file_output" |
      sed -n 's/.*PNG image data, \([0-9][0-9]*\) x \([0-9][0-9]*\).*/\1 \2/p'
  )"

  if [ -z "$dimensions" ]; then
    fail "${artifact} dimensions could not be parsed from: ${file_output}"
    return
  fi

  width="$(printf "%s\n" "$dimensions" | awk '{print $1}')"
  height="$(printf "%s\n" "$dimensions" | awk '{print $2}')"

  if [ "$width" -ne "$EXPECTED_WIDTH" ]; then
    fail "${artifact} has width ${width}px; expected ${EXPECTED_WIDTH}px"
  else
    pass "${artifact} has expected width ${width}px"
  fi

  if [ "$height" -lt "$MIN_HEIGHT" ]; then
    fail "${artifact} height ${height}px is below minimum ${MIN_HEIGHT}px"
  else
    pass "${artifact} has useful full-page height ${height}px"
  fi
}

check_artifact() {
  slug="$1"
  stage="$2"
  artifact="${EVIDENCE_DIR}/${slug}.png"

  if [ ! -f "$artifact" ]; then
    fail "missing browser evidence for ${slug}; expected ${artifact}"
    return
  fi

  if ! git ls-files --error-unmatch "$artifact" >/dev/null 2>&1; then
    fail "${artifact} exists but is not tracked by git"
  else
    pass "${artifact} is tracked"
  fi

  size_bytes="$(wc -c < "$artifact" | tr -d ' ')"
  if [ "$size_bytes" -lt "$MIN_SIZE_BYTES" ]; then
    fail "${artifact} is too small to be useful evidence (${size_bytes} bytes)"
  else
    pass "${artifact} has non-trivial size (${size_bytes} bytes)"
  fi

  if command -v file >/dev/null 2>&1; then
    mime_type="$(file -b --mime-type "$artifact")"
    if [ "$mime_type" = "image/png" ]; then
      pass "${artifact} has expected MIME type ${mime_type}"
    else
      fail "${artifact} has unexpected MIME type ${mime_type}"
    fi
  else
    printf "WARN: file command unavailable; MIME type not checked for %s\n" "$artifact"
  fi

  check_png_dimensions "$artifact"

  case "$slug:$stage" in
    accepted:accepted|replay-guard:replay_guard|payload-mismatch:payload_revalidation)
      pass "${slug} documents expected verifier stage ${stage}"
      ;;
    runtime-risky:runtime_safety|stale-cache:governance_cache)
      pass "${slug} documents expected scanner stage ${stage}"
      ;;
    *)
      fail "internal evidence check mapping error for ${slug}/${stage}"
      ;;
  esac
}

printf "Checking browser evidence in %s\n" "$EVIDENCE_DIR"

check_artifact "accepted" "accepted"
check_artifact "replay-guard" "replay_guard"
check_artifact "payload-mismatch" "payload_revalidation"
check_artifact "runtime-risky" "runtime_safety"
check_artifact "stale-cache" "governance_cache"

if [ "$failures" -gt 0 ]; then
  printf "Browser evidence check failed: %s failure(s).\n" "$failures"
  exit 1
fi

printf "Browser evidence check passed.\n"
