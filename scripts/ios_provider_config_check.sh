#!/usr/bin/env sh
set -eu

DEFAULTS_FILE="ios/VerifierLabApp/VerifierLabApp/LocalProvider.defaults.xcconfig"
LOCAL_FILE="ios/VerifierLabApp/LocalProvider.xcconfig"

failures=0

fail() {
  failures=$((failures + 1))
  printf "FAIL: %s\n" "$1"
}

pass() {
  printf "PASS: %s\n" "$1"
}

note() {
  printf "NOTE: %s\n" "$1"
}

extract_provider_value() {
  file="$1"
  line="$(grep -E '^QRTRUST_VERIFIER_BASE_URLS[[:space:]]*=' "$file" | tail -n 1 || true)"
  printf "%s\n" "$line" | sed 's/^[^=]*=[[:space:]]*//; s/[[:space:]]*$//'
}

validate_xcconfig_candidate() {
  candidate="$1"

  if printf "%s\n" "$candidate" | grep -Eq '^https:/\$\(\)/[A-Za-z0-9._-]+:8443$'; then
    return 0
  fi

  return 1
}

printf "iOS provider config check\n"

if [ ! -f "$DEFAULTS_FILE" ]; then
  fail "missing tracked provider defaults: ${DEFAULTS_FILE}"
else
  pass "tracked provider defaults exist"

  if grep -Fq "QRTRUST_VERIFIER_BASE_URLS =" "$DEFAULTS_FILE"; then
    pass "defaults declare QRTRUST_VERIFIER_BASE_URLS"
  else
    fail "defaults do not declare QRTRUST_VERIFIER_BASE_URLS"
  fi

  if grep -Fq "QRTRUST_VERIFIER_PROFILE_STATE" "$DEFAULTS_FILE"; then
    fail "defaults must not bake QRTRUST_VERIFIER_PROFILE_STATE"
  else
    pass "defaults do not bake verifier profile state"
  fi

  if grep -Fq '#include? "../LocalProvider.xcconfig"' "$DEFAULTS_FILE"; then
    pass "defaults include optional local provider override"
  else
    fail "defaults do not include optional local provider override"
  fi

  defaults_value="$(extract_provider_value "$DEFAULTS_FILE")"
  if [ -z "$defaults_value" ]; then
    pass "tracked defaults do not embed a local verifier endpoint"
  else
    fail "tracked defaults must not embed local verifier endpoint: ${defaults_value}"
  fi

fi

if [ ! -f "$LOCAL_FILE" ]; then
  note "ignored local provider config is absent; run: make ios-provider-config"
else
  if git ls-files --error-unmatch "$LOCAL_FILE" >/dev/null 2>&1; then
    fail "local provider override is tracked; it must stay ignored: ${LOCAL_FILE}"
  else
    pass "local provider override is ignored by Git"
  fi

  local_value="$(extract_provider_value "$LOCAL_FILE")"
  if [ -z "$local_value" ]; then
    fail "local provider override has an empty QRTRUST_VERIFIER_BASE_URLS value"
  elif printf "%s\n" "$local_value" | grep -Eq 'https?://'; then
    fail "local provider override uses raw //; use scripts/write_ios_local_provider_config.sh so xcconfig comments do not truncate the URL"
  else
    old_ifs="$IFS"
    # Splitting the comma-separated candidate list is the whole point of the
    # loop below. The previous IFS is saved on the line above and restored
    # immediately after `done`, so the change never escapes this branch.
    # nosemgrep: bash.lang.security.ifs-tampering.ifs-tampering
    IFS=','
    for candidate in $local_value; do
      trimmed="$(printf "%s\n" "$candidate" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
      if validate_xcconfig_candidate "$trimmed"; then
        resolved="$(printf "%s\n" "$trimmed" | sed 's#https:/\$()/#https://#')"
        pass "valid provider candidate ${resolved}"
      else
        fail "invalid provider candidate ${trimmed}; expected https:/$()/host:8443"
      fi
    done
    # The restore half of the save-set-restore pair opened above: the rule is
    # flagging the very line that undoes what it objects to.
    # nosemgrep: bash.lang.security.ifs-tampering.ifs-tampering
    IFS="$old_ifs"
  fi

  if grep -Fq "QRTRUST_VERIFIER_PROFILE_STATE" "$LOCAL_FILE"; then
    fail "local provider override must not bake QRTRUST_VERIFIER_PROFILE_STATE"
  else
    pass "local provider override does not bake verifier profile state"
  fi
fi

if [ "$failures" -gt 0 ]; then
  printf "iOS provider config check failed: %s issue(s).\n" "$failures"
  exit 1
fi

printf "iOS provider config check passed.\n"
