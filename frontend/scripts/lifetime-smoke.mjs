// Validity-window invariants for the lab (spec §3, §7):
// Run with: node --experimental-strip-types scripts/lifetime-smoke.mjs
//
//   1. valid/revoked scenarios default to a 5 minute window (DEFAULT_LIFETIME_MINUTES).
//   2. the expired scenario keeps its negative offset regardless of any custom window.
//   3. a positive custom window replaces the default; a null one falls back.
//   4. expiryValidation rejects past/too-far/invalid input.
//   5. buildScenarioRequest carries no nonce and no usage_policy.
import assert from "node:assert/strict"
import {
  DEFAULT_LIFETIME_MINUTES,
  MAX_LIFETIME_MINUTES,
  buildScenarioRequest,
  customExpiryMinutes,
  expiryInputValue,
  expiryValidation,
  generateToastTitleKey,
  lifetimeMinutesFor,
  scenarioMeta,
} from "../src/routes/lab/content.ts"

// --- 1-3. the validity window -----------------------------------------------

assert.equal(DEFAULT_LIFETIME_MINUTES, 5)
assert.equal(lifetimeMinutesFor(scenarioMeta.valid), 5)
assert.equal(lifetimeMinutesFor(scenarioMeta.revoked), 5)
assert.ok(lifetimeMinutesFor(scenarioMeta.expired) < 0)
assert.ok(lifetimeMinutesFor(scenarioMeta.expired, 30) < 0)
assert.equal(lifetimeMinutesFor(scenarioMeta.valid, 30), 30)
assert.equal(lifetimeMinutesFor(scenarioMeta.valid, null), 5)
assert.equal(lifetimeMinutesFor(scenarioMeta.valid, 0), 5)

// The sign of the sealed window always matches the scenario's own offset, so
// the comparison card's freshness row keeps telling the truth.
for (const [key, meta] of Object.entries(scenarioMeta)) {
  const minutes = lifetimeMinutesFor(meta)
  assert.equal(
    Math.sign(minutes),
    Math.sign(meta.expiresOffsetMinutes),
    `${key}: lifetime sign must match the scenario offset (${minutes} vs ${meta.expiresOffsetMinutes})`,
  )
  assert.equal(
    buildScenarioRequest(key).expires_offset_minutes,
    minutes,
    `${key}: request must seal the lifetime the hint shows`,
  )
}

// --- 5. the request speaks claims v2 only -----------------------------------

const request = buildScenarioRequest("valid", { customExpiryMinutes: 12 })
assert.equal(request.expires_offset_minutes, 12)
assert.equal("nonce" in request, false)
assert.equal("usage_policy" in request, false)
assert.equal(request.payload, scenarioMeta.valid.payload)

// --- 4. the operator-picked expiry ------------------------------------------

const now = Date.UTC(2026, 7, 26, 10, 0, 0)
assert.equal(customExpiryMinutes(null, now), null)
assert.equal(customExpiryMinutes("", now), null)
assert.equal(customExpiryMinutes("not-a-date", now), null)
assert.match(expiryInputValue(now), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
assert.equal(expiryValidation(null, now), null)
assert.equal(expiryValidation(expiryInputValue(now + 5 * 60_000), now), null)
assert.equal(expiryValidation(expiryInputValue(now - 60_000), now), "past")
assert.equal(expiryValidation(expiryInputValue(now), now), "past")
assert.equal(expiryValidation(expiryInputValue(now + (MAX_LIFETIME_MINUTES + 1) * 60_000), now), "tooFar")
assert.equal(expiryValidation("not-a-date", now), "invalid")
assert.equal(customExpiryMinutes(expiryInputValue(now + 7 * 60_000), now), 7)

// The cap matches the server's bound on `expires_offset_minutes`.
assert.equal(MAX_LIFETIME_MINUTES, 30 * 24 * 60)

// --- 6. cycle-2 chips: key-rotated / key-revoked ----------------------------

// Cycle-2 chips: the request builder must say key_state / rotate_key in so many
// words, and the toast title must follow the trust echo, not the scenario name.
const rotated = buildScenarioRequest("key-rotated")
assert.equal(rotated.rotate_key, true)
assert.equal(rotated.key_state, undefined)
assert.equal(rotated.certificate_revoked, false)

const keyRevoked = buildScenarioRequest("key-revoked")
assert.equal(keyRevoked.key_state, "revoked")
assert.equal(keyRevoked.rotate_key, false)
assert.equal(keyRevoked.certificate_revoked, false)
assert.equal(keyRevoked.certificate_revocation_reason, "Issuer revoked this signing key for testing.")

assert.equal(buildScenarioRequest("revoked").key_state, "revoked")
assert.equal(buildScenarioRequest("valid").key_state, undefined)
assert.equal(buildScenarioRequest("valid").rotate_key, false)

const trust = (overrides) => ({
  key_ref: "cert:acme-demo:2026-01",
  key_state: "active",
  issuer_status: "active",
  retired_key_refs: [],
  ...overrides,
})
assert.equal(generateToastTitleKey(scenarioMeta["valid"], trust({})), "lab.generate.ready.title")
assert.equal(
  generateToastTitleKey(scenarioMeta["key-rotated"], trust({ retired_key_refs: ["cert:acme-demo:2026-01"], key_ref: "cert:acme-demo:2026-01-r2" })),
  "lab.generate.rotated.title",
)
assert.equal(
  generateToastTitleKey(scenarioMeta["key-revoked"], trust({ key_state: "revoked" })),
  "lab.generate.keyRevoked.title",
)
assert.equal(
  generateToastTitleKey(scenarioMeta["revoked"], trust({ key_state: "revoked" })),
  "lab.generate.keyRevoked.title",
)
// First generation after a fresh backend: nothing retired yet, so the plain title.
assert.equal(generateToastTitleKey(scenarioMeta["key-rotated"], trust({})), "lab.generate.ready.title")

// The sealed card must surface the trust echo the backend returned.
import { readFileSync } from "node:fs"
const generateSource = readFileSync(
  new URL("../src/routes/lab/steps/GenerateStep.tsx", import.meta.url),
  "utf8",
)
for (const id of ["sealed-key-ref", "sealed-key-state", "sealed-retired-keys"]) {
  assert.ok(generateSource.includes(`data-testid="${id}"`), `GenerateStep must render data-testid ${id}`)
}
assert.ok(generateSource.includes("demo.trust.key_ref"), "GenerateStep must render the key ref from the trust echo")
const enSource = readFileSync(new URL("../src/i18n/catalog/en.ts", import.meta.url), "utf8")
for (const key of [
  "lab.generate.sealed.keyRef",
  "lab.generate.sealed.keyState",
  "lab.generate.sealed.keyState.active",
  "lab.generate.sealed.keyState.retired",
  "lab.generate.sealed.keyState.revoked",
  "lab.generate.sealed.retiredKeys",
  "lab.generate.sealed.retiredKeys.count",
]) {
  assert.ok(enSource.includes(`"${key}"`), `missing catalogue key ${key}`)
}

console.log("lifetime smoke: ok")
