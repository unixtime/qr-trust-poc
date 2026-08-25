/**
 * Pins the trust-row colour map against the services that emit its inputs.
 *
 * `src/routes/lab/trust-tone.ts` is the only place the wire vocabularies get a
 * colour. Nothing upstream constrains them: the Node contract types
 * `TrustStepSchema.status` as a bare `Schema.String`, and the Python verifier
 * emits `signals[].state` / `decision_state` as plain strings. So a new status
 * added to either service silently falls through to the amber default and
 * nobody notices.
 *
 * This check scrapes the emitted literals straight out of every service that
 * emits one and fails when any is unmapped, which turns "a new state renders
 * amber" from a
 * silent regression into a build failure. It also pins the specific mappings a
 * substring classifier used to get wrong — `block` and `failed` are hard
 * failures that contain no "red" keyword, and `recognized` / `bound` / `clear`
 * / `clean` are passes that contain no "green" keyword.
 */

import { readFileSync } from "node:fs"

const repoFile = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")

const TONES = new Set(["green", "amber", "red"])

const failures = []

function check(condition, message) {
  if (!condition) {
    failures.push(message)
  }
}

/** Parse one `const NAME: Record<string, TrustTone> = { ... }` table. */
function parseToneTable(source, name) {
  const start = source.indexOf(`const ${name}`)
  if (start === -1) {
    throw new Error(`trust-tone.ts no longer declares ${name}`)
  }
  const open = source.indexOf("= {", start)
  const close = source.indexOf("\n}", open)
  if (open === -1 || close === -1) {
    throw new Error(`could not find the object literal for ${name}`)
  }
  const body = source.slice(open, close)

  const table = new Map()
  for (const match of body.matchAll(/^\s*([a-z_]+):\s*"([a-z]+)"/gm)) {
    const [, key, tone] = match
    check(
      TONES.has(tone),
      `${name}.${key} maps to "${tone}", which is not a TrustTone`,
    )
    table.set(key, tone)
  }
  check(table.size > 0, `${name} parsed as empty — the table format changed`)
  return table
}

const trustToneSource = repoFile("frontend/src/routes/lab/trust-tone.ts")
const statusTones = parseToneTable(trustToneSource, "TRUST_STATUS_TONES")
const decisionTones = parseToneTable(trustToneSource, "DECISION_STATE_TONES")

// An unmapped status must degrade to "needs a look", never to a pass.
check(
  /\?\?\s*"amber"/.test(trustToneSource),
  "trust-tone.ts lost its amber fallback — an unmapped status could fail open",
)

const literals = (source, pattern) =>
  new Set([...source.matchAll(pattern)].map((match) => match[1]))

// The one-time replay guard (`GET /verifier/scan-activity`) reports its own
// lifecycle — not_applicable / unused / reserved / consumed — through a
// `state=` kwarg too, but that vocabulary never reaches a trust row: the lab's
// scan-feedback pill maps it separately. Drop those constructions before
// scraping so the guard cannot masquerade as an unmapped trust status.
const verifier = repoFile("backend/app/api/endpoints/verifier.py").replace(
  /ScanActivityReplayGuardResponse\([^)]*\)/g,
  "",
)
const scannerDecision = repoFile("network/src/services/scanner-decision.ts")
const runtimeSafety = repoFile("network/src/services/runtime-safety.ts")

const runtimeSafetyUnion = runtimeSafety.slice(
  runtimeSafety.indexOf("export type RuntimeSafetyStatus"),
  runtimeSafety.indexOf("export interface RuntimeSafetyInput"),
)

const emittedStatuses = [
  // Python verifier: ScannerDecisionSignal(layer=..., state="...").
  // The leading \b is load-bearing: verifier.py also carries `decision_state=`,
  // `supervisor_state=`, `persistence_state=` and `observation_state=` kwargs
  // whose values never reach a trust row. `_` is a word character, so \b does
  // not match inside `_state` and those suffixed kwargs stay out.
  { source: "verifier.py signals[].state", values: literals(verifier, /\bstate="([a-z_]+)"/g) },
  // Node scanner service: contract.trust_path.*.status
  { source: "scanner-decision.ts trust_path status", values: literals(scannerDecision, /status:\s*"([a-z_]+)"/g) },
  // Node runtime verdict, spread into the runtime_safety step verbatim
  { source: "runtime-safety.ts RuntimeSafetyStatus", values: literals(runtimeSafetyUnion, /"([a-z_]+)"/g) },
]

for (const { source, values } of emittedStatuses) {
  check(values.size > 0, `extracted no statuses from ${source} — the emitter changed shape`)
  for (const status of values) {
    check(
      statusTones.has(status),
      `${source} emits "${status}" but TRUST_STATUS_TONES does not map it (renders amber by default)`,
    )
  }
}

// decision_state reaches the UI as a kwarg, an assignment, a comparison, or the
// else-branch of a ternary. Each form needs its own pattern.
const decisionStatePatterns = [
  /decision_state\s*=?=\s*"([a-z_]+)"/g,
  /decision_state\s*=\s*"[a-z_]+"\s+if\s+[^\n]*?\s+else\s+"([a-z_]+)"/g,
]

const decisionStatesIn = (source) =>
  new Set(decisionStatePatterns.flatMap((pattern) => [...literals(source, pattern)]))

// verifier.py is not the only emitter, and scraping it alone left a hole. Both
// services below construct decision_state themselves and both reach the verdict
// badge — the runtime verdict through `runtime_verdict.decision_state`, the
// fixture through GET /scanner/ux-ab-fixture. Worse, verifier.py never *emits*
// `verified_issuer_destination_risky`; it only compares against it. That state
// was pinned purely because the `==` arm of the first pattern caught the
// comparison, so refactoring one `elif` away would have silently unpinned it.
const emittedDecisionStates = [
  { source: "verifier.py", values: decisionStatesIn(verifier) },
  {
    source: "runtime_safety_poc.py",
    values: decisionStatesIn(repoFile("backend/app/services/runtime_safety_poc.py")),
  },
  {
    source: "scanner_ux_ab_fixture.py",
    values: decisionStatesIn(repoFile("backend/app/services/scanner_ux_ab_fixture.py")),
  },
]

for (const { source, values } of emittedDecisionStates) {
  check(values.size > 0, `extracted no decision states from ${source} — the emitter changed shape`)
  for (const state of values) {
    check(
      decisionTones.has(state),
      `${source} emits decision_state "${state}" but DECISION_STATE_TONES does not map it (renders the verdict badge amber by default)`,
    )
  }
}

// Regressions worth naming: every one of these was mis-coloured by the
// substring classifier this table replaced.
const pinnedStatusTones = {
  block: "red", // artifact_integrity — not a prefix of "blocked"
  failed: "red", // issuer_legitimacy — signature verification failed
  blocked: "red",
  red: "red",
  mismatch: "red",
  recognized: "green",
  bound: "green",
  clear: "green",
  clean: "green",
  pass: "green",
  green: "green",
  risky: "amber", // runtime advisory, not a block
  warn: "amber",
  caution: "amber",
  orange: "amber",
  unverified: "amber", // contains "verified"; must not read as a pass
  revoked: "red", // contains "ok"; must not read as a pass
}

for (const [status, expected] of Object.entries(pinnedStatusTones)) {
  check(
    statusTones.get(status) === expected,
    `status "${status}" should be ${expected}, got ${statusTones.get(status) ?? "unmapped"}`,
  )
}

const pinnedDecisionTones = {
  verified_issuer: "green",
  verified_issuer_destination_risky: "amber", // issuer is fine; only the destination warrants care
  signed_unknown_issuer: "amber",
  unverified: "amber",
  profile_revoked: "red",
  blocked: "red",
}

for (const [state, expected] of Object.entries(pinnedDecisionTones)) {
  check(
    decisionTones.get(state) === expected,
    `decision_state "${state}" should be ${expected}, got ${decisionTones.get(state) ?? "unmapped"}`,
  )
}

if (failures.length > 0) {
  throw new Error(`trust-tone smoke failed:\n  - ${failures.join("\n  - ")}`)
}

console.log(
  JSON.stringify(
    {
      status: "ok",
      mapped_statuses: statusTones.size,
      mapped_decision_states: decisionTones.size,
      emitted_statuses_checked: emittedStatuses.reduce(
        (total, entry) => total + entry.values.size,
        0,
      ),
      emitted_decision_states_checked: emittedDecisionStates.reduce(
        (total, entry) => total + entry.values.size,
        0,
      ),
      pinned_mappings: Object.keys(pinnedStatusTones).length + Object.keys(pinnedDecisionTones).length,
    },
    null,
    2,
  ),
)
