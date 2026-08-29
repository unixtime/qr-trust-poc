// Residual lattice invariants (spec §4, §7): family order, tier ranking, deciding family, tone.
// Run with: node --experimental-strip-types scripts/residuals-smoke.mjs
import assert from "node:assert/strict"
import {
  decidingFamily,
  residualFamilyOrder,
  residualTierRank,
  residualTone,
  tierRank,
} from "../src/routes/lab/residuals.ts"

assert.deepEqual(residualFamilyOrder, [
  "issuer_chain",
  "destination_policy",
  "redirect_flow",
  "runtime_safety",
  "freshness",
  "artifact_integrity",
])

assert.equal(residualTierRank.pass, 0)
assert.equal(residualTierRank["not-applicable"], 0)
assert.equal(residualTierRank.stale, 2)
assert.equal(residualTierRank.warn, 3)
assert.equal(residualTierRank.fail, 4)
assert.equal(residualTierRank.block, 5)
assert.equal(tierRank("never-seen-tier"), 4)

const entry = (tier, cause = null) => ({ tier, cause })
const allPass = {
  issuer_chain: entry("pass"),
  destination_policy: entry("pass"),
  redirect_flow: entry("not-applicable"),
  runtime_safety: entry("not-checked"),
  freshness: entry("pass"),
  artifact_integrity: entry("pass"),
}
assert.equal(decidingFamily(allPass), "runtime_safety"); // not-checked ranks 1 — it IS a residual
assert.equal(decidingFamily({ ...allPass, runtime_safety: entry("pass") }), null)
assert.equal(decidingFamily({ ...allPass, freshness: entry("block", "object-expired") }), "freshness")
assert.equal(
  decidingFamily({ ...allPass, issuer_chain: entry("revoked-issuer"), freshness: entry("block") }),
  "issuer_chain",
); // tie at rank 5 → first in family order

assert.equal(residualTone("pass"), "green")
assert.equal(residualTone("not-applicable"), "muted")
assert.equal(residualTone("not-checked"), "amber")
assert.equal(residualTone("warn"), "amber")
assert.equal(residualTone("fail"), "red")
assert.equal(residualTone("block"), "red")

// Source pins: the verdict step must actually render the residual surface, and
// must carry none of the vocabulary the papers never declared.
import { readFileSync } from "node:fs"
const verdictSource = readFileSync(new URL("../src/routes/lab/steps/VerdictStep.tsx", import.meta.url), "utf8")
for (const id of ["verdict-model-decision", "verdict-residuals", "residual-${family}"]) {
  assert.ok(verdictSource.includes(id), `VerdictStep must render data-testid ${id}`)
}
assert.equal(/usagePolicy|usage_policy|nonce/.test(verdictSource), false, "VerdictStep still mentions usage policy or nonce")
const enCatalog = readFileSync(new URL("../src/i18n/catalog/en.ts", import.meta.url), "utf8")
for (const family of ["issuer_chain", "destination_policy", "redirect_flow", "runtime_safety", "freshness", "artifact_integrity"]) {
  assert.ok(enCatalog.includes(`"lab.residual.family.${family}"`), `missing family label ${family}`)
  assert.ok(enCatalog.includes(`"lab.residual.question.${family}"`), `missing family question ${family}`)
}
for (const tier of ["pass", "not-applicable", "not-checked", "unknown", "unavailable", "stale", "warn", "fail", "unaccepted-issuer", "invalid-managed-claim", "revoked-issuer", "block"]) {
  assert.ok(enCatalog.includes(`"lab.residual.tier.${tier}"`), `missing tier label ${tier}`)
}
for (const cause of [
  "signature-invalid",
  "issuer-inactive",
  "issuer-revoked",
  "issuer-record-expired",
  "issuer-record-not-yet-valid",
  "key-revoked",
  "key-window-mismatch",
  "destination-mismatch",
  "not-yet-valid",
  "object-expired",
  "redirect-policy-blocked",
  "runtime-risky",
  "runtime-blocked",
  "runtime-expired",
  "runtime-stale",
  "runtime-unavailable",
  "no-signed-envelope",
  "unsupported-envelope",
  "unsupported-claims-version",
]) {
  assert.ok(enCatalog.includes(`"lab.residual.cause.${cause}"`), `missing cause label ${cause}`)
}

// The verdict step's known-cause set is what decides between catalogue copy and a
// raw <code> fallback. Every cycle-2 slug must be in it, or the UI shows the slug.
for (const cause of ["issuer-record-expired", "issuer-record-not-yet-valid", "key-revoked", "key-window-mismatch"]) {
  assert.ok(verdictSource.includes(`"${cause}"`), `VerdictStep knownCauses is missing ${cause}`)
}

console.log("residuals smoke: ok")
