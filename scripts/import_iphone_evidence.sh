#!/usr/bin/env sh
set -eu

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SOURCE_DIR="${1:-${IPHONE_EVIDENCE_SOURCE_DIR:-}}"
PACKET_PATH="${QRTRUST_SCANNER_FLEET_EVIDENCE_PACKET:-docs/public/network-contracts/examples/scanner-fleet-evidence-reference.json}"
MIN_IMAGE_BYTES="${IPHONE_EVIDENCE_MIN_IMAGE_BYTES:-1000}"
MIN_TEXT_BYTES="${IPHONE_EVIDENCE_MIN_TEXT_BYTES:-20}"
OVERWRITE="${IPHONE_EVIDENCE_OVERWRITE:-false}"
ALLOW_PARTIAL="${IPHONE_EVIDENCE_ALLOW_PARTIAL:-false}"
SKIP_EXISTING="${IPHONE_EVIDENCE_SKIP_EXISTING:-false}"
PREFER_NEWEST="${QRTRUST_EVIDENCE_IMPORT_PREFER_NEWEST:-false}"
failures=0
imports=0
skips=0

case "$PACKET_PATH" in
  /*) PACKET_ABS="$PACKET_PATH" ;;
  *) PACKET_ABS="${REPO_ROOT}/${PACKET_PATH}" ;;
esac

usage() {
  cat <<'EOF'
Usage:
  sh scripts/import_iphone_evidence.sh /path/to/exported-iphone-evidence

The source directory must contain the exact artifact basenames referenced by:
  docs/public/network-contracts/examples/scanner-fleet-evidence-reference.json

Examples:
  accepted.png
  history-accepted.png
  accessibility-accepted.txt

Set IPHONE_EVIDENCE_OVERWRITE=true to replace existing destination artifacts.
Set IPHONE_EVIDENCE_ALLOW_PARTIAL=true to import only artifacts present in the source.
Set IPHONE_EVIDENCE_SKIP_EXISTING=true to leave existing destination artifacts unchanged.
macOS duplicate-export names such as accepted 2.png are accepted.
Set QRTRUST_EVIDENCE_IMPORT_PREFER_NEWEST=true to choose the newest matching
artifact when exact and duplicate export names are both present.
EOF
}

fail() {
  failures=$((failures + 1))
  printf "FAIL: %s\n" "$1"
}

pass() {
  imports=$((imports + 1))
  printf "PASS: %s\n" "$1"
}

skip() {
  skips=$((skips + 1))
  printf "SKIP: %s\n" "$1"
}

artifact_list() {
  node -e '
const fs = require("node:fs")
const packet = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))

for (const row of packet.evidence_rows) {
  const refs = [
    ["screenshot", row.screenshot_ref],
    ["history_entry", row.history_entry_ref],
    ["accessibility", row.accessibility_ref],
  ]

  for (const [kind, refPath] of refs) {
    console.log([kind, row.fixture_id, row.decision_id, row.decision_color, row.decision_state, refPath].join("\t"))
  }
}
' "$PACKET_ABS"
}

resolve_source_artifact() {
  expected_filename="$1"
  exact_path="${SOURCE_DIR}/${expected_filename}"

  case "$expected_filename" in
    *.*)
      artifact_base="${expected_filename%.*}"
      artifact_ext=".${expected_filename##*.}"
      ;;
    *)
      artifact_base="$expected_filename"
      artifact_ext=""
      ;;
  esac

  if [ "$PREFER_NEWEST" = "true" ]; then
    node - "$SOURCE_DIR" "$expected_filename" <<'NODE'
const fs = require("node:fs")
const path = require("node:path")

const [sourceDir, expectedFilename] = process.argv.slice(2)
const artifactExt = path.extname(expectedFilename)
const artifactBase = expectedFilename.slice(0, expectedFilename.length - artifactExt.length)
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const duplicatePattern = new RegExp(
  `^${escapeRegExp(artifactBase)}(?: [0-9]+| \\([0-9]+\\))${escapeRegExp(artifactExt)}$`,
)

let candidates = []
try {
  candidates = fs
    .readdirSync(sourceDir)
    .filter((name) => name === expectedFilename || duplicatePattern.test(name))
    .map((name) => {
      const filePath = path.join(sourceDir, name)
      const stat = fs.statSync(filePath)
      return stat.isFile() ? { filePath, mtimeMs: stat.mtimeMs, name } : undefined
    })
    .filter(Boolean)
} catch {
  process.exit(0)
}

candidates.sort((left, right) => (
  right.mtimeMs - left.mtimeMs ||
  right.name.localeCompare(left.name)
))

if (candidates[0]) {
  process.stdout.write(`${candidates[0].filePath}\n`)
}
NODE
    return
  fi

  if [ -f "$exact_path" ]; then
    printf "%s\n" "$exact_path"
    return
  fi

  find "$SOURCE_DIR" -maxdepth 1 -type f \
    \( -name "${artifact_base} [0-9]*${artifact_ext}" -o -name "${artifact_base} ([0-9]*)${artifact_ext}" \) \
    -print |
    sort |
    tail -n 1
}

check_source_artifact() {
  artifact="$1"
  kind="$2"
  fixture_id="$3"
  decision_color="$4"
  decision_state="$5"

  size_bytes="$(wc -c < "$artifact" | tr -d '[:space:]')"
  case "$kind" in
    accessibility)
      if [ "$size_bytes" -lt "$MIN_TEXT_BYTES" ]; then
        fail "${artifact} is too small to be useful accessibility evidence (${size_bytes} bytes)"
        return 1
      fi

      if ! validate_accessibility_trace "$artifact" "$fixture_id" "$decision_color" "$decision_state"; then
        fail "${artifact} does not match ${fixture_id} (${decision_color}/${decision_state}) accessibility trace requirements"
        return 1
      fi
      ;;
    screenshot|history_entry)
      if [ "$size_bytes" -lt "$MIN_IMAGE_BYTES" ]; then
        fail "${artifact} is too small to be useful image evidence (${size_bytes} bytes)"
        return 1
      fi

      if ! is_png_file "$artifact"; then
        fail "${artifact} is not a PNG file"
        return 1
      fi

      if command -v file >/dev/null 2>&1; then
        mime_type="$(file -b --mime-type "$artifact")"
        case "$mime_type" in
          image/png) ;;
          *)
            fail "${artifact} has unexpected MIME type ${mime_type}; expected image/png"
            return 1
            ;;
        esac
      else
        printf "WARN: file command unavailable; MIME type not checked for %s\n" "$artifact"
      fi
      ;;
    *)
      fail "unknown artifact kind: ${kind}"
      return 1
      ;;
  esac

  return 0
}

is_png_file() {
  node - "$1" <<'NODE'
const fs = require("node:fs")
const artifact = process.argv[2]
const bytes = fs.readFileSync(artifact)
const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
process.exit(signature.every((byte, index) => bytes[index] === byte) ? 0 : 1)
NODE
}

validate_accessibility_trace() {
  node - "$1" "$2" "$3" "$4" <<'NODE'
const fs = require("node:fs")
const [artifact, fixtureId, decisionColor, decisionState] = process.argv.slice(2)
const text = fs.readFileSync(artifact, "utf8")

const fail = (message) => {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const normalize = (value) => value.trim().replace(/\s+/g, " ").toLowerCase()
const fieldValue = (name) => {
  const pattern = new RegExp(`^\\s*${escapeRegExp(name)}\\s*:\\s*(.+?)\\s*$`, "im")
  return text.match(pattern)?.[1]?.trim()
}
const fieldEquals = (name, expected) => {
  const actual = fieldValue(name)
  return actual !== undefined && normalize(actual) === normalize(expected)
}

if (/\b(TODO|PLACEHOLDER|REPLACE (THIS|WITH))\b|\.\.\./i.test(text)) {
  fail("accessibility trace still contains placeholder text")
}

if (!fieldEquals("fixture_id", fixtureId)) {
  fail(`missing fixture_id: ${fixtureId}`)
}

if (!fieldEquals("decision_state", decisionState)) {
  fail(`missing decision_state: ${decisionState}`)
}

const status = fieldValue("status")
if (
  !fieldEquals("decision_color", decisionColor) &&
  (status === undefined || !normalize(status).includes(normalize(decisionColor)))
) {
  fail(`missing decision_color: ${decisionColor}`)
}

if (fieldValue("title") === undefined) {
  fail("missing title field")
}

if (fieldValue("message") === undefined) {
  fail("missing message field")
}
NODE
}

import_artifact() {
  kind="$1"
  fixture_id="$2"
  decision_id="$3"
  decision_color="$4"
  decision_state="$5"
  ref_path="$6"
  source_name="$(basename "$ref_path")"
  source_artifact="$(resolve_source_artifact "$source_name")"
  expected_source_artifact="${SOURCE_DIR}/${source_name}"
  destination="${REPO_ROOT}/${ref_path}"

  if [ -z "$source_artifact" ] || [ ! -f "$source_artifact" ]; then
    if [ "$ALLOW_PARTIAL" = "true" ]; then
      skip "missing source artifact for ${fixture_id}/${kind}; expected ${expected_source_artifact}"
    else
      fail "missing source artifact for ${fixture_id}/${kind}; expected ${expected_source_artifact}"
    fi
    return
  fi

  if [ -e "$destination" ] && [ "$OVERWRITE" != "true" ]; then
    if [ "$SKIP_EXISTING" = "true" ]; then
      skip "${destination} already exists; set IPHONE_EVIDENCE_OVERWRITE=true to replace it"
    else
      fail "${destination} already exists; set IPHONE_EVIDENCE_OVERWRITE=true to replace it"
    fi
    return
  fi

  if ! check_source_artifact "$source_artifact" "$kind" "$fixture_id" "$decision_color" "$decision_state"; then
    return
  fi

  mkdir -p "$(dirname "$destination")"
  cp "$source_artifact" "$destination"
  pass "imported ${fixture_id}/${kind} (${decision_id}) to ${ref_path}"
}

if [ -z "$SOURCE_DIR" ]; then
  usage
  exit 2
fi

if [ ! -d "$SOURCE_DIR" ]; then
  fail "source directory does not exist: ${SOURCE_DIR}"
  usage
  exit 1
fi

if [ ! -f "$PACKET_ABS" ]; then
  fail "scanner-fleet evidence packet does not exist: ${PACKET_ABS}"
  exit 1
fi

ARTIFACT_LIST="$(mktemp "${TMPDIR:-/tmp}/qrtrust-iphone-artifacts.XXXXXX")"
trap 'rm -f "$ARTIFACT_LIST"' EXIT
artifact_list > "$ARTIFACT_LIST"

printf "Importing native scanner-fleet evidence from %s\n" "$SOURCE_DIR"
printf "Using packet: %s\n" "$PACKET_ABS"

while IFS="$(printf '\t')" read -r kind fixture_id decision_id decision_color decision_state ref_path; do
  import_artifact "$kind" "$fixture_id" "$decision_id" "$decision_color" "$decision_state" "$ref_path"
done < "$ARTIFACT_LIST"

if [ "$failures" -gt 0 ]; then
  printf "Native iPhone scanner-fleet evidence import failed: %s failure(s).\n" "$failures"
  exit 1
fi

printf "Native iPhone scanner-fleet evidence import passed.\n"
printf "Imported artifacts: %s\n" "$imports"
printf "Skipped artifacts: %s\n" "$skips"
printf "Next steps:\n"
printf "  git add docs/public/evidence/iphone\n"
printf "  make check-iphone-evidence\n"
printf "  make release-audit\n"
