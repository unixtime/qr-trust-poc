#!/usr/bin/env sh
set -eu

# Two audit roles, explicitly separated:
#   - Private pre-publication audit: run in the maintainer workspace,
#     identified by the tracked-but-never-shipped release tooling
#     (release/export_public_repo.sh). Every section applies, including
#     the personal-pattern scans that read the untracked pattern file
#     below. A missing or empty pattern file is a FAILURE here
#     (fail-closed).
#   - Public CI audit: run in a public clone (no release/ tooling).
#     Maintainer-only sections emit NOTE lines instead — notes are neither
#     warnings nor failures, so `make release-audit` passes in a clean
#     clone even with STRICT_RELEASE_AUDIT=true.
# The role is NOT keyed on the local/ directory: shipped commands such as
# `make release-readiness-report` create local/ as a normal output
# directory in a public clone, so its presence proves nothing about who is
# running the audit. Set RELEASE_AUDIT_ROLE=maintainer|public to override
# the detection explicitly.

failures=0
warnings=0
strict_release_audit="${STRICT_RELEASE_AUDIT:-false}"

case "${RELEASE_AUDIT_ROLE:-auto}" in
  maintainer) audit_role='maintainer' ;;
  public) audit_role='public' ;;
  auto)
    if [ -f release/export_public_repo.sh ]; then
      audit_role='maintainer'
    else
      audit_role='public'
    fi
    ;;
  *)
    printf "FAIL: RELEASE_AUDIT_ROLE must be 'maintainer' or 'public' (got '%s')\n" "${RELEASE_AUDIT_ROLE}" >&2
    exit 2
    ;;
esac

# Filenames of material excluded from the public cut. Split with "" so the
# public-export tooling's excluded-reference scan never matches this
# script's own text when it ships.
patent_note="PATENT_POS""ITION.md"
generated_readme="docs/public/gen""erated/README.md"
generated_check_script="scripts/gen""erated_artifacts_check.sh"
generated_check_target="check-gen""erated-artifacts"

# Contract-check scripts are stdlib-only; prefer the repo venv when present
# (maintainer workspace) and fall back to python3 (clean clone / CI).
if [ -x backend/.venv/bin/python ]; then
  audit_python="backend/.venv/bin/python"
else
  audit_python="python3"
fi

# Personal and filing-only strings are read from an untracked pattern file
# (one extended-regex alternative per line; blank lines and # comments are
# ignored) so this public script never embeds the strings it scans for.
sensitive_pattern_file="${RELEASE_AUDIT_PRIVATE_PATTERNS_FILE:-local/release_audit_private_patterns.txt}"
sensitive_pattern=''
if [ -f "$sensitive_pattern_file" ]; then
  # The producer grep runs alone with its status captured: piped straight
  # into paste, a grep that failed after emitting only some alternatives
  # would yield a truncated pattern that still compiles — and every scan
  # below would silently test less than the file specifies.
  pattern_lines_status=0
  sensitive_pattern_lines="$(grep -Ev '^[[:space:]]*(#|$)' "$sensitive_pattern_file")" || pattern_lines_status=$?
  if [ "$pattern_lines_status" -gt 1 ]; then
    sensitive_scan_state='unreadable-pattern-file'
  else
    sensitive_pattern_body="$(printf '%s\n' "$sensitive_pattern_lines" | paste -s -d '|' - || true)"
    if [ -n "$sensitive_pattern_body" ]; then
      sensitive_pattern="($sensitive_pattern_body)"
      # rg exits 2 on a pattern it cannot compile; on empty input a valid
      # pattern can only exit 1 (there are no lines to match). Anything but 1
      # means the scans below would silently test nothing, so record a failure
      # state instead of failing open.
      pattern_compile_status=0
      printf '' | rg "$sensitive_pattern" >/dev/null 2>&1 || pattern_compile_status=$?
      if [ "$pattern_compile_status" -eq 1 ]; then
        sensitive_scan_state='ready'
      else
        sensitive_scan_state='invalid-pattern-file'
      fi
    else
      # An empty alternation would become "()" and match every line scanned.
      sensitive_scan_state='empty-pattern-file'
    fi
  fi
elif [ "$audit_role" = maintainer ]; then
  sensitive_scan_state='maintainer-missing-patterns'
else
  sensitive_scan_state='public-clone'
fi
# The last alternative is split with '' so this scanned script never
# matches its own pattern definition.
local_workspace_pattern='(/Users/[A-Za-z0-9._-]+/[A-Za-z0-9._/-]*qrcode_poc|file:///(Users|private|var|tmp)/|file:/''/localhost/)'

heading() {
  printf "\n== %s ==\n" "$1"
}

pass() {
  printf "PASS: %s\n" "$1"
}

warn() {
  warnings=$((warnings + 1))
  printf "WARN: %s\n" "$1"
}

# Informational only: counts toward neither failures nor warnings, so a
# NOTE never breaks strict mode. Used for maintainer-only sections that do
# not apply to a public clone.
note() {
  printf "NOTE: %s\n" "$1"
}

fail() {
  failures=$((failures + 1))
  printf "FAIL: %s\n" "$1"
}

# Every leak scan below asks the same question -- "does this string appear in
# anything that ships?" -- so they must agree on what ships. They used to carry
# three hand-copied glob lists with nothing keeping them in sync, and the lists
# drifted: a tree listed in the allowlist's [exclude] section never reaches the
# public cut, but the workspace-path scan still read it and failed the audit
# over maintainer paths in planning notes that cannot leak.
#
# release/public_release_allowlist.txt's [exclude] section is the authority for
# what does not ship. These globs mirror the entries of it that exist in the
# maintainer workspace; a public clone simply has no such paths to skip.
# Exit status is rg's own, so callers keep inspecting it: 0 = matched,
# 1 = clean, >1 = the scan itself failed and must never read as clean.
#
# --hidden is required (.gitlab-ci.yml and .github/ ship), which is also why
# .git/** has to be excluded by hand: none of it is published -- the exported
# repo is built fresh -- and COMMIT_EDITMSG, the reflog and ORIG_HEAD diffs
# all quote content that no longer exists in the tree. Without this glob a
# commit message describing a leak reads as the leak itself.
scan_shipping_tree() {
  rg --hidden \
    --glob '!.git/**' \
    --glob '!archive/**' \
    --glob '!private/**' \
    --glob '!local/**' \
    --glob '!.claude/**' \
    --glob '!backend/.venv/**' \
    --glob '!backend/.env' \
    --glob '!ietf/**' \
    --glob 'ietf/draft-*' \
    "$@" \
    .
}

# Report every occurrence of a personal-artifact pattern in the shipping tree.
# These scans are the half of the sensitive boundary that runs in every role:
# their vocabulary is closed, so unlike the private-pattern scan they need no
# gitignored input and survive the trip to a CI runner.
#
# Callers pass a label, an rg pattern, a hint naming the fix, and optionally an
# allowlist alternation of legitimate whole tokens. scan_shipping_tree is used
# with -n -o, so each line is ./path:LINE:TOKEN and the allowlist anchors on
# ":token" at end of line.
#
# Write patterns escaped (\. rather than .) even where a bare dot would match:
# an escaped pattern cannot match its own source text, which is what lets this
# script hold the very literals it bans without flagging itself.
scan_for_personal_artifact() {
  scan_label="$1"
  scan_pattern="$2"
  scan_hint="$3"
  scan_allowlist="${4:-}"

  scan_status=0
  scan_matches="$(scan_shipping_tree -n -o "$scan_pattern")" || scan_status=$?

  # rg's own status decides first: 0 = matches, 1 = clean, anything higher means
  # the scan itself failed, and a failed scan must never be reported as clean.
  if [ "$scan_status" -gt 1 ]; then
    fail "$scan_label scan failed (rg exit $scan_status); refusing to fail open"
    return
  fi

  if [ -n "$scan_allowlist" ]; then
    scan_matches="$(
      printf '%s\n' "$scan_matches" | grep -Ev ":($scan_allowlist)\$" || true
    )"
  fi
  scan_matches="$(printf '%s\n' "$scan_matches" | grep -v '^$' || true)"

  if [ -n "$scan_matches" ]; then
    fail "$scan_label ($scan_hint):"
    printf "%s\n" "$scan_matches"
  else
    pass "no $scan_label in the shipping tree"
  fi
}

require_file() {
  if [ -f "$1" ]; then
    pass "found $1"
  else
    fail "missing $1"
  fi
}

require_tracked_file() {
  if git ls-files --error-unmatch "$1" >/dev/null 2>&1; then
    pass "tracked $1"
  else
    fail "not tracked $1"
  fi
}

require_pattern() {
  pattern="$1"
  file="$2"
  description="$3"

  if grep -Eq "$pattern" "$file"; then
    pass "$description"
  else
    fail "$description is missing"
  fi
}

check_xcode_tracked_swift_sources() {
  project_file="ios/VerifierLabApp/VerifierLabApp.xcodeproj/project.pbxproj"
  app_dir="ios/VerifierLabApp/VerifierLabApp"

  if [ ! -f "$project_file" ]; then
    fail "missing iOS project file: $project_file"
    return
  fi

  swift_sources="$(mktemp "${TMPDIR:-/tmp}/qrtrust-ios-swift-sources.XXXXXX")"
  # Both extraction stages run with their status captured: piped straight
  # into sort, a failed sed would produce an empty source list and the loop
  # below would silently verify nothing.
  swift_paths_status=0
  swift_paths_raw="$(sed -n 's/.*path = \([^;]*\.swift\);.*/\1/p' "$project_file")" || swift_paths_status=$?
  if [ "$swift_paths_status" -ne 0 ]; then
    fail "could not extract Swift source paths from $project_file (sed exit $swift_paths_status); refusing to fail open"
    rm -f "$swift_sources"
    return
  fi
  if [ -z "$swift_paths_raw" ]; then
    fail "no Swift sources found in $project_file; an empty extraction would verify nothing"
    rm -f "$swift_sources"
    return
  fi
  swift_paths_clean_status=0
  swift_paths="$(printf '%s\n' "$swift_paths_raw" | sed 's/^"//; s/"$//')" || swift_paths_clean_status=$?
  if [ "$swift_paths_clean_status" -ne 0 ]; then
    fail "could not normalize Swift source paths from $project_file (sed exit $swift_paths_clean_status); refusing to fail open"
    rm -f "$swift_sources"
    return
  fi
  printf '%s\n' "$swift_paths" | sort -u > "$swift_sources"

  while IFS= read -r source_name; do
    [ -n "$source_name" ] || continue

    case "$source_name" in
      /*)
        source_path="$source_name"
        ;;
      */*)
        source_path="ios/VerifierLabApp/$source_name"
        ;;
      *)
        source_path="$app_dir/$source_name"
        ;;
    esac

    if [ ! -f "$source_path" ]; then
      fail "iOS project references missing Swift source: $source_path"
      continue
    fi

    if git ls-files --error-unmatch "$source_path" >/dev/null 2>&1; then
      pass "tracked iOS Swift source $source_path"
    else
      fail "iOS project references untracked Swift source: $source_path"
    fi
  done < "$swift_sources"

  rm -f "$swift_sources"
}

heading "Repo Boundary"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  fail "not running inside a git repository"
else
  pass "inside git repository"
fi

# The enumeration and the filter each run with their status captured: in a
# plain "git | grep || true" pipeline a failed git ls-files or a grep error
# (exit 2) both read as an empty match list — a failed scan reported clean.
tracked_files_status=0
all_tracked_files="$(git ls-files)" || tracked_files_status=$?
boundary_filter_status=0
tracked_boundary_matches=""
if [ "$tracked_files_status" -eq 0 ]; then
  tracked_boundary_matches="$(printf '%s\n' "$all_tracked_files" | grep -E '^(private|archive|\.claude|local|backend/\.venv)/|^backend/\.env$|(^|/)\.env$|\.env\.local$')" || boundary_filter_status=$?
fi

if [ "$tracked_files_status" -ne 0 ]; then
  fail "could not enumerate tracked files (git ls-files exit $tracked_files_status); refusing to fail open"
elif [ "$boundary_filter_status" -gt 1 ]; then
  fail "tracked-path boundary filter failed (grep exit $boundary_filter_status); refusing to fail open"
elif [ -n "$tracked_boundary_matches" ]; then
  fail "private/local/environment paths are tracked:"
  printf "%s\n" "$tracked_boundary_matches"
else
  pass "no private/archive/local/env paths are tracked"
fi

# rg's own status must be inspected, not discarded: 0 = matches (fail),
# 1 = clean, anything higher = the scan itself failed and a failed scan
# must never be reported as clean.
local_workspace_scan_status=0
local_workspace_matches="$(
  scan_shipping_tree -n "$local_workspace_pattern"
)" || local_workspace_scan_status=$?

if [ "$local_workspace_scan_status" -gt 1 ]; then
  fail "local workspace-path scan failed (rg exit $local_workspace_scan_status); refusing to fail open"
elif [ -n "$local_workspace_matches" ]; then
  fail "local workspace links or file URIs remain:"
  printf "%s\n" "$local_workspace_matches"
else
  pass "no local workspace links or file URIs are present"
fi

# Same status discipline: a failed rg must fail the audit, not read as
# "no stale wording found".
stale_wording_scan_status=0
stale_native_evidence_matches="$(
  rg -n \
    'remaining iPhone evidence blocker|native iPhone evidence blocker|native scanner evidence is still not tracked|remaining public evidence blocker|close the native iPhone evidence blocker|capture and track native iPhone evidence for accepted|run `make release-audit-strict` after native evidence is tracked|track the unified scanner-release evidence packet before the strict public cut' \
    README.md docs .github \
)" || stale_wording_scan_status=$?

if [ "$stale_wording_scan_status" -gt 1 ]; then
  fail "stale native-evidence wording scan failed (rg exit $stale_wording_scan_status); refusing to fail open"
elif [ -n "$stale_native_evidence_matches" ]; then
  fail "stale native evidence blocker wording is present:"
  printf "%s\n" "$stale_native_evidence_matches"
else
  pass "no stale native evidence blocker wording is present"
fi

# Inside "[ -n ... ]" a failed git status would read as an empty string and
# report a clean tree, silently suppressing the warning strict mode escalates.
worktree_status_rc=0
worktree_status_short="$(git status --short)" || worktree_status_rc=$?
if [ "$worktree_status_rc" -ne 0 ]; then
  fail "could not read working-tree status (git status exit $worktree_status_rc); refusing to fail open"
elif [ -n "$worktree_status_short" ]; then
  warn "working tree has uncommitted changes"
else
  pass "working tree is clean"
fi

heading "Required Public Files"

for file in \
  LICENSE \
  NOTICE \
  CITATION.cff \
  CONTRIBUTING.md \
  README.md \
  ROADMAP.md \
  mkdocs.yml \
  docs/public/assets/javascripts/diagram-explorer.js \
  docs/public/assets/stylesheets/diagram-explorer.css \
  backend/scripts/mkdocs_source_pages.py \
  SECURITY.md \
  SUPPORT.md \
  compose.shared-infra.yml \
  .github/PULL_REQUEST_TEMPLATE.md \
  .github/ISSUE_TEMPLATE/bug_report.yml \
  .github/ISSUE_TEMPLATE/config.yml \
  .github/ISSUE_TEMPLATE/research_or_vector.yml \
  .github/workflows/ci.yml \
  .github/workflows/native-ios.yml \
  docs/README.md \
  docs/public/CITING.md \
  docs/public/OPEN_SOURCE_DIRECTION.md \
  docs/public/PUBLIC_RELEASE_CHECKLIST.md \
  docs/public/PROJECT_OVERVIEW.md \
  docs/public/RELEASE_CANDIDATE_STATUS.md \
  docs/public/RUN_GUIDE.md \
  docs/public/VERIFIER_PROFILE.md \
  docs/public/TEST_VECTORS.md \
  docs/public/BROWSER_TEST_MATRIX.md \
  docs/public/evidence/README.md \
  docs/public/evidence/iphone/README.md \
  scripts/browser_evidence_check.sh \
  scripts/compose_workbench_smoke.sh \
  backend/scripts/check_react_route_queries.py \
  scripts/iphone_evidence_packet.sh \
  scripts/iphone_device_preflight.sh \
  scripts/iphone_evidence_status.sh \
  scripts/import_iphone_evidence.sh \
  scripts/iphone_evidence_check.sh \
  scripts/ios_provider_config_check.sh \
  scripts/ios_provider_profile_fixture_check.sh \
  scripts/ios_provider_profile_evidence_packet.sh \
  scripts/ios_provider_profile_evidence_status.sh \
  scripts/import_ios_provider_profile_evidence.sh \
  scripts/ios_provider_profile_evidence_check.sh \
  scripts/scanner_release_evidence_packet.sh \
  scripts/scanner_release_evidence_export_status.sh \
  scripts/import_scanner_release_evidence_export.sh \
  scripts/scanner_release_evidence_todo.sh \
  scripts/ensure_external_database.sh \
  scripts/shared_infra_network_preflight.py \
  scripts/release_readiness_report.sh \
  scripts/ios_harness_smoke.sh \
  scripts/public_release_audit.sh
do
  require_tracked_file "$file"
done

# Maintainer workspace only: the paper workflow and the patent-position
# note stay tracked privately but are not part of the public cut.
if [ "$audit_role" = maintainer ]; then
  require_tracked_file "$patent_note"
  require_tracked_file "$generated_readme"
  require_tracked_file "$generated_check_script"
fi

heading "iOS Project Integrity"

check_xcode_tracked_swift_sources

heading "Evidence Artifacts"

if browser_check_output="$(sh scripts/browser_evidence_check.sh 2>&1)"; then
  pass "browser evidence artifacts are tracked and validated"
else
  fail "browser evidence artifacts are incomplete or invalid:"
  printf "%s\n" "$browser_check_output"
fi

# The native-evidence validators shell into network/ npm scripts that need
# the tsx dev dependency; a clean public clone has no node_modules, so those
# validators are gated the same way as the maintainer-only pattern scans.
if [ -x network/node_modules/.bin/tsx ]; then
  evidence_validator_state='ready'
elif [ "$audit_role" = maintainer ]; then
  evidence_validator_state='maintainer-missing-deps'
else
  evidence_validator_state='public-clone'
fi

# The enumeration's own status must stay visible: were "|| true" to swallow
# a git or grep failure, the empty list would be reported below as "not yet
# tracked" — a failed enumeration read as a mere warning.
iphone_evidence_enum_status=0
iphone_evidence_all="$(git ls-files 'docs/public/evidence/iphone/*')" || iphone_evidence_enum_status=$?
iphone_evidence_filter_status=0
iphone_evidence=""
if [ "$iphone_evidence_enum_status" -eq 0 ]; then
  iphone_evidence="$(printf '%s\n' "$iphone_evidence_all" | grep -E '\.(png|mov|mp4)$')" || iphone_evidence_filter_status=$?
fi

if [ "$iphone_evidence_enum_status" -ne 0 ]; then
  fail "could not enumerate native iPhone evidence (git ls-files exit $iphone_evidence_enum_status); refusing to fail open"
elif [ "$iphone_evidence_filter_status" -gt 1 ]; then
  fail "native iPhone evidence filter failed (grep exit $iphone_evidence_filter_status); refusing to fail open"
elif [ -n "$iphone_evidence" ]; then
  case "$evidence_validator_state" in
    ready)
      if iphone_check_output="$(sh scripts/iphone_evidence_check.sh 2>&1)"; then
        pass "native iPhone evidence artifacts are tracked and validated"
      else
        fail "native iPhone evidence artifacts are incomplete or invalid:"
        printf "%s\n" "$iphone_check_output"
      fi
      ;;
    public-clone)
      note "native iPhone evidence validation needs the network/ dev dependencies installed; it ran during the private pre-publication audit"
      ;;
    *)
      fail "network/ dev dependencies are missing (network/node_modules); run npm install in network/ before the private audit"
      ;;
  esac
else
  warn "native iPhone screenshots or recordings are not yet tracked"
fi

provider_profile_enum_status=0
provider_profile_evidence="$(
  git ls-files \
    'docs/public/evidence/iphone/provider-profile-*.png' \
    'docs/public/evidence/iphone/accessibility-provider-profile-*.txt' \
)" || provider_profile_enum_status=$?

if [ "$provider_profile_enum_status" -ne 0 ]; then
  fail "could not enumerate provider-profile evidence (git ls-files exit $provider_profile_enum_status); refusing to fail open"
elif [ -n "$provider_profile_evidence" ]; then
  case "$evidence_validator_state" in
    ready)
      if provider_profile_check_output="$(sh scripts/ios_provider_profile_evidence_check.sh 2>&1)"; then
        pass "native iOS provider-profile evidence artifacts are tracked and validated"
      else
        fail "native iOS provider-profile evidence artifacts are incomplete or invalid:"
        printf "%s\n" "$provider_profile_check_output"
      fi
      ;;
    public-clone)
      note "native iOS provider-profile evidence validation needs the network/ dev dependencies installed; it ran during the private pre-publication audit"
      ;;
    *)
      fail "network/ dev dependencies are missing (network/node_modules); run npm install in network/ before the private audit"
      ;;
  esac
else
  warn "native iOS provider-profile evidence artifacts are not yet tracked"
fi

heading "Generated Paper Artifacts"

# The paper-artifact workflow exists only in the private repository. Key the
# section off the tracked manifest: tracked (even if deleted on disk) means
# the workflow applies and every piece of it must be intact.
if git ls-files --error-unmatch "$generated_readme" >/dev/null 2>&1; then
  require_tracked_file "$generated_check_script"

  if generated_check_output="$(sh "$generated_check_script" 2>&1)"; then
    pass "generated paper artifacts are tracked and documented"
  else
    fail "generated paper artifacts are incomplete or undocumented:"
    printf "%s\n" "$generated_check_output"
  fi

  if grep -Eq "^${generated_check_target}:" Makefile; then
    pass "make ${generated_check_target} is available"
  else
    fail "make ${generated_check_target} is missing"
  fi
else
  note "no generated-paper manifest is tracked in this tree; the private pre-publication audit covers the paper artifacts"
fi

heading "Frontend Contract Guards"

if frontend_scanner_contract_output="$("$audit_python" scripts/frontend_scanner_contract_check.py 2>&1)"; then
  pass "React lab scanner endpoint contract is enforced"
else
  fail "React lab scanner endpoint contract failed:"
  printf "%s\n" "$frontend_scanner_contract_output"
fi

if frontend_scanner_open_contract_output="$("$audit_python" scripts/frontend_scanner_open_contract_check.py 2>&1)"; then
  pass "React lab scanner open/hold contract is enforced"
else
  fail "React lab scanner open/hold contract failed:"
  printf "%s\n" "$frontend_scanner_open_contract_output"
fi

heading "Sensitive Boundary Scan"

case "$sensitive_scan_state" in
  ready)
    # rg's own status must be inspected, not discarded: 0 = matches (fail),
    # 1 = clean, anything higher = the scan itself failed and a failed scan
    # must never be reported as clean.
    sensitive_scan_status=0
    sensitive_matches="$(
      scan_shipping_tree -n "$sensitive_pattern"
    )" || sensitive_scan_status=$?

    if [ "$sensitive_scan_status" -gt 1 ]; then
      fail "personal-string scan failed (rg exit $sensitive_scan_status); check $sensitive_pattern_file for an invalid pattern"
    elif [ -n "$sensitive_matches" ]; then
      fail "personal or filing-only strings remain:"
      printf "%s\n" "$sensitive_matches"
    else
      pass "no known personal or filing-only strings matched"
    fi
    ;;
  public-clone)
    note "personal-pattern scan is maintainer-only (public audit role, no pattern file); it ran during the private pre-publication audit"
    ;;
  empty-pattern-file)
    fail "private pattern file $sensitive_pattern_file contains no patterns; refusing to run an empty scan"
    ;;
  invalid-pattern-file)
    fail "private pattern file $sensitive_pattern_file contains a pattern rg cannot compile; refusing to fail open"
    ;;
  maintainer-missing-patterns)
    fail "maintainer audit role detected but $sensitive_pattern_file is missing; restore it before auditing"
    ;;
  unreadable-pattern-file)
    fail "private pattern file $sensitive_pattern_file could not be read (grep exit $pattern_lines_status); refusing to fail open"
    ;;
  *)
    fail "unknown sensitive-scan state \"$sensitive_scan_state\"; refusing to fail open"
    ;;
esac

# The scan above reads local/release_audit_private_patterns.txt, so it runs only
# for the maintainer; every CI role takes the public-clone branch, records the
# NOTE, and skips it (release/public_release_checklist.md 6e). The three scans
# below are the half that always runs, in every role. That matters: a developer
# hostname reached main in the iOS shared scheme past a fully green pipeline,
# because no role-independent check existed to see it.

# A blanket ban on the mDNS suffix is impossible -- qrtrust.local is canonical
# across the published network contracts -- but the legitimate set is small and
# closed, so an unlisted host is by construction someone's machine. A new
# legitimate name costs one deliberate line here; a leaked one is never on the
# list.
#
# s.local is the tail of the `https://%s.local:PORT` printf template in the
# Makefile, which resolves the host from `scutil --get LocalHostName` at run
# time. That is the sanctioned way to reach a developer machine, and the reason
# a baked-in hostname is never the answer.
allowed_local_hosts='qrtrust\.local|qrtrust-lab\.local|providers\.local|env\.local|s\.local'

scan_for_personal_artifact \
  'unlisted .local hostnames' \
  '[A-Za-z0-9][A-Za-z0-9-]*\.local\b' \
  'a developer machine, or a new name to add to allowed_local_hosts' \
  "$allowed_local_hosts"

# Private-range literals need no allowlist at all: the tree reaches real hosts
# through the Makefile template above, and prose examples use the RFC 5737
# documentation range. Requiring all four octets is what makes that true --
# a looser pattern matches npm semver ("10.8.0") throughout the lockfile.
scan_for_personal_artifact \
  'private-range IP literals' \
  '\b(10\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])|192\.168)\.[0-9]{1,3}\.[0-9]{1,3}\b' \
  'use the RFC 5737 documentation range in prose, and resolve real hosts at run time'

# An absolute home path names its owner and breaks on every other machine, so
# it is both a privacy leak and a portability bug. Repository-relative paths
# are the fix in every case.
scan_for_personal_artifact \
  'absolute home-directory paths' \
  '/Users/[A-Za-z0-9._-]+' \
  'reference a repository-relative path instead of a developer home directory'

fixture_private_key_file="network/src/fixtures/demo-signing-private-keys.ts"
# rg's own status must be inspected before its output is piped anywhere:
# 0 = files matched, 1 = none, anything higher = the scan itself failed and
# a failed scan must never be reported as clean. Only the already-checked
# match list flows into the sed|sort post-processing.
private_key_scan_status=0
private_key_scan_raw="$(
  scan_shipping_tree -l '^-----BEGIN PRIVATE KEY-----$|^-----END PRIVATE KEY-----$'
)" || private_key_scan_status=$?

if [ "$private_key_scan_status" -gt 1 ]; then
  fail "private-key PEM scan failed (rg exit $private_key_scan_status); refusing to fail open"
else
  tracked_private_key_block_files="$(
    printf '%s\n' "$private_key_scan_raw" | sed 's#^\./##' | grep -v '^$' | sort -u || true
  )"

  unexpected_private_key_block_files="$(
    printf "%s\n" "$tracked_private_key_block_files" |
      grep -v '^$' |
      grep -Fxv "$fixture_private_key_file" || true
  )"

  if [ -n "$unexpected_private_key_block_files" ]; then
    fail "actual private-key PEM blocks are tracked outside the deterministic fixture module:"
    printf "%s\n" "$unexpected_private_key_block_files"
  elif [ -n "$tracked_private_key_block_files" ]; then
    require_pattern 'Public deterministic fixture signing keys' "$fixture_private_key_file" "deterministic signing fixture warning exists"
    require_pattern 'must never be used for production trust programs' "$fixture_private_key_file" "production-use warning exists for signing fixtures"
    pass "actual private-key PEM blocks are limited to deterministic signing fixtures"
  else
    pass "no actual private-key PEM blocks are tracked"
  fi
fi

# Enumerate tracked PDFs with the enumeration's own status visible: were
# "|| true" to swallow a git failure, the empty list would be reported below
# as "no PDF artifacts are tracked" — a failed scan read as clean.
tracked_pdfs_status=0
tracked_pdfs="$(git ls-files '*.pdf')" || tracked_pdfs_status=$?
if [ "$tracked_pdfs_status" -ne 0 ]; then
  fail "could not enumerate tracked PDFs (git ls-files exit $tracked_pdfs_status); refusing to fail open"
elif [ -n "$tracked_pdfs" ]; then
  # A tracked PDF is documented when its basename appears in a README.md or
  # README.txt manifest in the PDF's own directory (e.g. the evaluation
  # fixtures README documents the synthetic overlay fixture).
  undocumented_pdfs=""
  for pdf in $tracked_pdfs; do
    pdf_dir="$(dirname "$pdf")"
    pdf_base="$(basename "$pdf")"
    if { [ -f "$pdf_dir/README.md" ] && grep -Fq "$pdf_base" "$pdf_dir/README.md"; } ||
       { [ -f "$pdf_dir/README.txt" ] && grep -Fq "$pdf_base" "$pdf_dir/README.txt"; }; then
      :
    else
      undocumented_pdfs="$undocumented_pdfs $pdf"
    fi
  done

  if [ -n "$undocumented_pdfs" ]; then
    warn "tracked PDF artifacts lack a manifest entry in their directory's README:"
    printf "%s\n" $undocumented_pdfs
  else
    pass "every tracked PDF artifact is documented by a README manifest in its directory"
  fi

  case "$sensitive_scan_state" in
    ready)
      if command -v pdftotext >/dev/null 2>&1; then
        pdf_sensitive_matches=""
        # The aggregate PASS below asserts "every tracked PDF was scanned
        # clean"; a PDF whose extraction or scan failed already recorded a
        # FAIL, but it must also withhold the PASS — printing both would
        # report the same artifact as clean and unscannable at once.
        pdf_scan_incomplete=false
        for pdf in $tracked_pdfs; do
          # pdftotext runs alone so its own failure stays visible: piped
          # straight into rg, the pipeline would report only rg's status,
          # and a PDF that cannot be extracted would scan as "clean"
          # (empty input, rg exit 1).
          pdf_extract_status=0
          pdf_text="$(pdftotext -layout "$pdf" -)" || pdf_extract_status=$?
          if [ "$pdf_extract_status" -ne 0 ]; then
            fail "pdftotext could not extract $pdf (exit $pdf_extract_status); refusing to fail open"
            pdf_scan_incomplete=true
            continue
          fi
          # Same status discipline as the repo scan: rg exit 1 is the only
          # acceptable "clean" outcome; higher means the scan itself failed.
          pdf_scan_status=0
          matches="$(printf '%s\n' "$pdf_text" | rg -n "$sensitive_pattern")" || pdf_scan_status=$?
          if [ "$pdf_scan_status" -gt 1 ]; then
            fail "PDF personal-string scan failed on $pdf (rg exit $pdf_scan_status); refusing to fail open"
            pdf_scan_incomplete=true
            continue
          fi
          if [ -n "$matches" ]; then
            pdf_sensitive_matches="${pdf_sensitive_matches}
${pdf}
${matches}"
          fi
        done

        if [ -n "$pdf_sensitive_matches" ]; then
          fail "tracked PDF text contains known personal or filing-only strings:"
          printf "%s\n" "$pdf_sensitive_matches"
        elif [ "$pdf_scan_incomplete" = true ]; then
          note "PDF text-layer verdict withheld: at least one tracked PDF could not be extracted or scanned (the failure is recorded above)"
        else
          pass "tracked PDF text layers contain no known personal or filing-only strings"
        fi
      else
        warn "pdftotext is unavailable; tracked PDF text layers were not scanned"
      fi
      ;;
    public-clone)
      note "PDF personal-string scan is maintainer-only; it ran during the private pre-publication audit"
      ;;
    *)
      fail "private pattern file $sensitive_pattern_file is missing, empty, invalid, or unreadable in the maintainer workspace; PDF text scan cannot run"
      ;;
  esac
else
  pass "no PDF artifacts are tracked"
fi

heading "Patent And License Posture"

if grep -Fq "Apache License" LICENSE && grep -Fq "Version 2.0" LICENSE; then
  pass "Apache-2.0 license is present"
else
  fail "Apache-2.0 license wording is missing"
fi

# The patent-position note stays tracked privately; the public cut relies
# on the Apache-2.0 license grant alone.
if git ls-files --error-unmatch "$patent_note" >/dev/null 2>&1; then
  if grep -Fq "Apache-2.0" "$patent_note"; then
    pass "patent-position note references the Apache-2.0 baseline"
  else
    fail "patent-position note should reference the Apache-2.0 baseline"
  fi

  if grep -Fq "not expand, narrow, replace, or reinterpret" "$patent_note"; then
    pass "patent-position note defers to the license text"
  else
    fail "patent-position note should avoid creating a separate patent covenant"
  fi
else
  note "no patent-position note in this tree; the Apache-2.0 LICENSE defines the patent baseline"
fi

heading "Key Lifecycle Evidence"

if key_lifecycle_output="$($audit_python scripts/key_lifecycle_evidence.py --check 2>&1)"; then
  pass "public-safe E1/E2 key-lifecycle evidence is semantically exact"
else
  fail "public-safe E1/E2 key-lifecycle evidence is invalid:"
  printf "%s\n" "$key_lifecycle_output"
fi

heading "Validation Hooks"

for target in smoke-compose smoke-compose-https check-route-navigation check-frontend-vite-config check-frontend-scanner-contract check-frontend-scanner-open-contract check-python-verifier-lab-stability smoke-ios ios-provider-config check-ios-provider-config ios-provider-profile-fixture check-ios-provider-profile-fixture ios-provider-profile-evidence-packet ios-provider-profile-evidence-status import-ios-provider-profile-evidence check-ios-provider-profile-evidence iphone-evidence-preflight iphone-evidence-packet iphone-evidence-status check-browser-evidence import-iphone-evidence check-iphone-evidence scanner-release-evidence-packet scanner-release-evidence-export-status scanner-release-evidence-downloads-status import-scanner-release-evidence-export import-scanner-release-evidence-downloads scanner-release-evidence-todo scanner-release-evidence-status capture-browser-evidence ensure-shared-infra-db check-shared-infra-network check-network-stack-ready check-network-worker-drill up-https-admin-shared-infra network-deployed-scanner-readiness-report network-production-evidence-private-template check-network-production-evidence-private-index check-key-lifecycle-evidence release-readiness-report check-release-readiness-report release-audit-strict docs-build docs-serve lint-frontend build-frontend test-backend; do
  if grep -Eq "^${target}:" Makefile; then
    pass "make $target is available"
  else
    fail "make $target is missing"
  fi
done

require_pattern '^[[:space:]]*- mermaid2:' mkdocs.yml "MkDocs Mermaid renderer is enabled"
require_pattern 'mkdocs-mermaid2-plugin==1\.2\.2' backend/pyproject.toml "MkDocs Mermaid plugin is pinned"
require_pattern 'backend/scripts/mkdocs_source_pages\.py' mkdocs.yml "MkDocs generates bounded public source views"
require_pattern 'public/assets/stylesheets/diagram-explorer\.css' mkdocs.yml "MkDocs loads the local diagram explorer styles"
require_pattern 'public/assets/javascripts/diagram-explorer\.js' mkdocs.yml "MkDocs loads the local diagram explorer controls"
require_pattern 'dialog\.showModal\(\)' docs/public/assets/javascripts/diagram-explorer.js "diagram explorer uses an accessible modal dialog"
require_pattern 'classDef verified' docs/public/TRUST_MODEL_GRAPH.md "trust-model flow distinguishes the verified outcome"

heading "CI Workflow Gates"

require_pattern '^  release-audit:' .github/workflows/ci.yml "CI release-audit job exists"
require_pattern 'run: make release-audit' .github/workflows/ci.yml "CI runs make release-audit"
require_pattern 'run: make check-release-readiness-report' .github/workflows/ci.yml "CI runs release readiness report check"
require_pattern '^  backend-tests:' .github/workflows/ci.yml "CI backend-tests job exists"
require_pattern 'run: make docs-build' .github/workflows/ci.yml "CI verifies the documentation build"
require_pattern 'run: PYTHONPATH=\.\. \./\.venv/bin/pytest' .github/workflows/ci.yml "CI runs backend pytest"
require_pattern '^  frontend-build:' .github/workflows/ci.yml "CI frontend-build job exists"
require_pattern 'run: npm run lint' .github/workflows/ci.yml "CI runs frontend lint"
require_pattern 'run: npm run build' .github/workflows/ci.yml "CI runs frontend build"
require_pattern '^  compose-workbench-smoke:' .github/workflows/ci.yml "CI compose-workbench-smoke job exists"
require_pattern 'docker compose up -d --build --wait' .github/workflows/ci.yml "CI starts compose stack with wait"
require_pattern 'run: make smoke-compose' .github/workflows/ci.yml "CI runs compose workbench smoke"
require_pattern 'docker compose down -v' .github/workflows/ci.yml "CI cleans compose stack"
require_pattern '^  route-navigation-smoke:' .github/workflows/ci.yml "CI route-navigation-smoke job exists"
require_pattern 'playwright install --with-deps chromium' .github/workflows/ci.yml "CI installs Playwright Chromium"
require_pattern 'run: make check-route-navigation' .github/workflows/ci.yml "CI runs route navigation smoke"
require_pattern '^  workflow_dispatch:' .github/workflows/native-ios.yml "native iOS smoke is manual"
require_pattern 'run: make smoke-ios' .github/workflows/native-ios.yml "native iOS workflow runs smoke-ios"

printf "\n"
if [ "$failures" -gt 0 ]; then
  printf "PUBLIC RELEASE AUDIT FAILED: %s failure(s), %s warning(s).\n" "$failures" "$warnings"
  exit 1
fi

if [ "$warnings" -gt 0 ]; then
  case "$strict_release_audit" in
    1 | true | TRUE | yes | YES)
      printf "PUBLIC RELEASE AUDIT FAILED STRICT MODE: %s warning(s).\n" "$warnings"
      exit 1
      ;;
  esac

  printf "PUBLIC RELEASE AUDIT PASSED WITH WARNINGS: %s warning(s).\n" "$warnings"
else
  printf "PUBLIC RELEASE AUDIT PASSED.\n"
fi
