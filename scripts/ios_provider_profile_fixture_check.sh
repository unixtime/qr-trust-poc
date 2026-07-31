#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/generate_ios_provider_profile_fixture.swift"
VERIFY_SCRIPT="$ROOT_DIR/scripts/check_ios_provider_profile_fixture.swift"
FIXTURE="$ROOT_DIR/docs/public/fixtures/ios/signed-provider-profile.demo.json"
VIEW_MODEL="$ROOT_DIR/ios/VerifierLabApp/VerifierLabApp/VerifierLabViewModel.swift"
EXPECTED_PUBLIC_KEY="ebVWLo/mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ="
EXPECTED_KEY_ID="qrtrust-demo-provider-2026"

failures=0

fail() {
  failures=$((failures + 1))
  printf "FAIL: %s\n" "$1"
}

pass() {
  printf "PASS: %s\n" "$1"
}

printf "iOS signed provider-profile fixture check\n"

if [ ! -f "$SCRIPT" ]; then
  fail "missing generator script: $SCRIPT"
elif [ ! -f "$VERIFY_SCRIPT" ]; then
  fail "missing verifier script: $VERIFY_SCRIPT"
elif [ ! -f "$FIXTURE" ]; then
  fail "missing signed fixture: $FIXTURE"
else
  tmp="$(mktemp "${TMPDIR:-/tmp}/qrtrust-provider-fixture.XXXXXX.json")"
  trap 'rm -f "$tmp"' EXIT
  mkdir -p "$ROOT_DIR/.build/swift-module-cache"
  swift -module-cache-path "$ROOT_DIR/.build/swift-module-cache" "$SCRIPT" "$tmp" >/tmp/qrtrust-provider-fixture-check.log

  if swift -module-cache-path "$ROOT_DIR/.build/swift-module-cache" "$VERIFY_SCRIPT" "$FIXTURE" >/tmp/qrtrust-provider-fixture-verify.log; then
    pass "tracked fixture has a valid trusted signature"
  else
    fail "tracked fixture signature verification failed"
  fi

  if swift -module-cache-path "$ROOT_DIR/.build/swift-module-cache" "$VERIFY_SCRIPT" "$tmp" >/tmp/qrtrust-provider-fixture-generated-verify.log; then
    pass "generator emits a valid trusted signature"
  else
    fail "generator emitted an invalid signed fixture"
  fi
fi

if grep -Fq "$EXPECTED_PUBLIC_KEY" "$VIEW_MODEL"; then
  pass "iOS trusted fixture public key is present"
else
  fail "iOS trusted fixture public key is missing from VerifierLabViewModel.swift"
fi

if grep -Fq "$EXPECTED_KEY_ID" "$VIEW_MODEL"; then
  pass "iOS trusted fixture key id is present"
else
  fail "iOS trusted fixture key id is missing from VerifierLabViewModel.swift"
fi

if [ -f "$FIXTURE" ]; then
  if grep -Fq "\"algorithm\" : \"ed25519\"" "$FIXTURE"; then
    pass "fixture declares ed25519 signature"
  else
    fail "fixture does not declare ed25519 signature"
  fi

  if grep -Fq "\"key_id\" : \"$EXPECTED_KEY_ID\"" "$FIXTURE"; then
    pass "fixture declares trusted key id"
  else
    fail "fixture does not declare trusted key id"
  fi
fi

if [ "$failures" -gt 0 ]; then
  printf "iOS signed provider-profile fixture check failed: %s issue(s).\n" "$failures"
  exit 1
fi

printf "iOS signed provider-profile fixture check passed.\n"
