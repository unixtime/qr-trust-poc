#!/usr/bin/env sh
set -eu

OUTPUT_FILE="${RELEASE_READINESS_REPORT:-local/release-readiness-report.md}"
OUTPUT_DIR="$(dirname "$OUTPUT_FILE")"

mkdir -p "$OUTPUT_DIR"
summary_file="$(mktemp)"
blockers_file="$(mktemp)"
details_file="$(mktemp)"
blocked=0
closure_json="${QRTRUST_PRODUCTION_EVIDENCE_CLOSURE_JSON:-local/production-evidence-closure-bundle.json}"
closure_md="${QRTRUST_PRODUCTION_EVIDENCE_CLOSURE_MD:-local/production-evidence-closure-bundle.md}"
production_reference_status="UNKNOWN"
production_closure_status="not_generated"
production_refs_missing="unknown"
production_intake_blockers="unknown"
production_closure_items="unknown"

cleanup() {
  rm -f "$summary_file" "$blockers_file" "$details_file"
}

trap cleanup EXIT HUP INT TERM

run_check() {
  title="$1"
  command="$2"

  printf "\n## %s\n\n" "$title" >> "$details_file"
  printf "\`\`\`bash\n%s\n\`\`\`\n\n" "$command" >> "$details_file"

  if output="$(sh -c "$command" 2>&1)"; then
    printf "Status: PASS\n\n" >> "$details_file"
    printf "| %s | PASS | \`%s\` |\n" "$title" "$command" >> "$summary_file"
  else
    printf "Status: FAIL\n\n" >> "$details_file"
    printf "| %s | FAIL | \`%s\` |\n" "$title" "$command" >> "$summary_file"
    blocked=1
    printf -- "- %s failed. Run \`%s\` for details.\n" "$title" "$command" >> "$blockers_file"
  fi

  printf "\`\`\`text\n%s\n\`\`\`\n" "$output" >> "$details_file"
}

load_production_closure_status() {
  if [ ! -f "$closure_json" ]; then
    production_reference_status="UNKNOWN"
    production_closure_status="missing_closure_bundle"
    return
  fi

  if production_summary="$(
    node -e '
const fs = require("fs")
const bundle = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
const summary = bundle.summary || {}
const closureItems = Array.isArray(bundle.closure_items) ? bundle.closure_items.length : "unknown"
console.log([
  bundle.status || "unknown",
  summary.refs_missing !== undefined ? summary.refs_missing : "unknown",
  summary.intake_blockers !== undefined ? summary.intake_blockers : "unknown",
  closureItems,
].join(" "))
' "$closure_json"
  )"; then
    set -- $production_summary
    production_closure_status="$1"
    production_refs_missing="$2"
    production_intake_blockers="$3"
    production_closure_items="$4"
  else
    production_reference_status="UNKNOWN"
    production_closure_status="unreadable_closure_bundle"
    return
  fi

  case "$production_closure_status" in
    ready_for_human_review)
      production_reference_status="READY_FOR_HUMAN_REVIEW"
      ;;
    blocked_until_operator_refs_complete)
      production_reference_status="BLOCKED_FOR_PRODUCTION"
      ;;
    *)
      production_reference_status="UNKNOWN"
      ;;
  esac
}

timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
branch="$(git rev-parse --abbrev-ref HEAD)"
commit="$(git rev-parse --short HEAD)"
status="$(git status --short)"
scanner_evidence="$(
  git ls-files \
    'docs/public/evidence/iphone/accepted.*' \
    'docs/public/evidence/iphone/payload-mismatch.*' \
    | grep -E '\.(png|mov|mp4)$' \
    || true
)"
provider_profile_evidence="$(
  git ls-files \
    'docs/public/evidence/iphone/provider-profile-*.png' \
    'docs/public/evidence/iphone/accessibility-provider-profile-*.txt' \
    || true
)"

if [ -n "$status" ]; then
  blocked=1
  printf -- "- Working tree has uncommitted changes.\n" >> "$blockers_file"
fi

if [ -z "$scanner_evidence" ]; then
  blocked=1
  printf -- "- Native iPhone scanner evidence artifacts are not tracked yet: accepted and payload-mismatch.\n" >> "$blockers_file"
fi

if [ -z "$provider_profile_evidence" ]; then
  blocked=1
  printf -- "- Native iOS provider-profile evidence artifacts are not tracked yet: import, active, stale, revoked, rejected, and local-reviewer states.\n" >> "$blockers_file"
fi

run_check "Native iPhone Evidence Status" "make iphone-evidence-status"
run_check "Native iOS Provider Profile Evidence Status" "make ios-provider-profile-evidence-status"
run_check "Deployed Scanner Readiness Report" "make network-deployed-scanner-readiness-report"
run_check "Production Evidence Closure Bundle" "make network-production-evidence-closure-bundle"
run_check "Browser Evidence Check" "make check-browser-evidence"
run_check "Public Release Audit" "make release-audit"
run_check "Strict Public Release Audit" "make release-audit-strict"
load_production_closure_status

cat > "$OUTPUT_FILE" <<EOF
# QR Trust PoC Release Readiness Report

Generated: ${timestamp}

This report is local-only and is written under \`local/\`. It summarizes the
current public-release gates without adding evidence artifacts or modifying the
tracked release state.

## Repository State

- Branch: \`${branch}\`
- Commit: \`${commit}\`

EOF

if [ -n "$status" ]; then
  cat >> "$OUTPUT_FILE" <<EOF
Working tree:

\`\`\`text
${status}
\`\`\`

EOF
else
  cat >> "$OUTPUT_FILE" <<'EOF'
Working tree: clean

EOF
fi

if [ "$blocked" -eq 0 ]; then
  cat >> "$OUTPUT_FILE" <<'EOF'
## Readiness Verdict

Status: READY

No blocking items were detected by the local readiness report.

EOF
else
  cat >> "$OUTPUT_FILE" <<'EOF'
## Readiness Verdict

Status: BLOCKED

Blocking items:

EOF
  cat "$blockers_file" >> "$OUTPUT_FILE"
  printf "\n" >> "$OUTPUT_FILE"
fi

cat >> "$OUTPUT_FILE" <<'EOF'
## Production Reference Evidence

EOF

cat >> "$OUTPUT_FILE" <<EOF
Status: ${production_reference_status}

- Closure bundle: \`${production_closure_status}\`
- Remaining operator refs: \`${production_refs_missing}\`
- Intake blockers: \`${production_intake_blockers}\`
- Closure items: \`${production_closure_items}\`
- JSON handoff: \`${closure_json}\`
- Markdown handoff: \`${closure_md}\`

EOF

cat >> "$OUTPUT_FILE" <<'EOF'
This section is separate from the public-release verdict. A public release can
pass while production evidence remains blocked, but a production-ready claim
requires the operator-owned closure bundle to reach human review with real
`ops://qrtrust/` evidence refs.

EOF

cat >> "$OUTPUT_FILE" <<'EOF'
## Check Summary

| Check | Status | Command |
| --- | --- | --- |
EOF

cat "$summary_file" >> "$OUTPUT_FILE"
cat "$details_file" >> "$OUTPUT_FILE"

cat >> "$OUTPUT_FILE" <<'EOF'

## Interpretation

- `make release-audit` is the CI-friendly gate.
- `make release-audit-strict` is the final public-cut gate.
- The production-reference evidence section is the production-readiness
  boundary. `BLOCKED_FOR_PRODUCTION` means public release may still be possible,
  but production readiness is not claimable.
- If strict audit fails only because native scanner evidence is missing, capture
  and import `accepted` and `payload-mismatch` with the native
  iPhone app, then regenerate this report.
- If strict audit fails only because provider-profile evidence is missing,
  capture and import the signed, stale, revoked, rejected, and local-reviewer
  provider-profile states, then regenerate this report.
- `make network-deployed-scanner-readiness-report` combines the active verifier
  profile, scanner-fleet evidence, and provider-profile evidence into one
  deployed-scanner verdict. `native_evidence_incomplete` is expected until the
  physical scanner-fleet and provider-profile captures are tracked.
EOF

printf "Release readiness report written to %s\n" "$OUTPUT_FILE"
if [ "$blocked" -eq 0 ]; then
  printf "Release readiness verdict: READY\n"
else
  printf "Release readiness verdict: BLOCKED\n"
fi
