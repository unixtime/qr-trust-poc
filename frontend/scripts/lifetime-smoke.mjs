// Pins the demo QR lifetime to the usage policy the operator picked.
// Run with: node --experimental-strip-types scripts/lifetime-smoke.mjs
//
// Invariants:
//   1. a fresh scenario sealed as `one_time` keeps the short 5-minute window,
//      while `reusable_public` and `time_limited` get the long one;
//   2. the `expired` scenario stays expired whatever the policy says;
//   3. the sign of the lifetime always matches the scenario's own offset, so
//      `comparison.ts`'s freshness row keeps telling the truth;
//   4. single-use codes never outlive public ones;
//   5. `buildScenarioRequest` seals exactly what `lifetimeMinutesFor` says;
//   6. the pre-generation hint keys exist in both catalogues;
//   7. a `time_limited` code takes the expiry the operator picked, other
//      policies ignore it, the expired scenario still wins, and the picker's
//      local value round-trips through the same helper the request uses;
//   8. the Generate step is guided: "Options" (not "Advanced"), with an
//      explanation key per policy and nonce mode, in both catalogues.
import {
  MAX_LIFETIME_MINUTES,
  buildScenarioRequest,
  customExpiryMinutes,
  expiryInputValue,
  expiryValidation,
  lifetimeMinutesFor,
  scenarioMeta,
} from "../src/routes/lab/content.ts"
import { en } from "../src/i18n/catalog/en.ts"
import { es } from "../src/i18n/catalog/es.ts"

const policies = ["one_time", "reusable_public", "time_limited"]
const failures = []
function check(condition, message) {
  if (!condition) failures.push(message)
}

check(lifetimeMinutesFor(scenarioMeta.valid, "one_time") === 5, "valid/one_time must stay at 5 minutes")
check(lifetimeMinutesFor(scenarioMeta.valid, "reusable_public") === 60, "valid/reusable_public must get 60 minutes")
check(lifetimeMinutesFor(scenarioMeta.valid, "time_limited") === 60, "valid/time_limited must get 60 minutes")
for (const policy of policies) {
  check(
    lifetimeMinutesFor(scenarioMeta.expired, policy) === scenarioMeta.expired.expiresOffsetMinutes,
    `expired/${policy} must keep the scenario's negative offset`,
  )
}

for (const [key, meta] of Object.entries(scenarioMeta)) {
  for (const policy of policies) {
    const minutes = lifetimeMinutesFor(meta, policy)
    check(
      Math.sign(minutes) === Math.sign(meta.expiresOffsetMinutes),
      `${key}/${policy}: lifetime sign must match the scenario offset (${minutes} vs ${meta.expiresOffsetMinutes})`,
    )
    check(
      buildScenarioRequest(key, "fixed", policy).expires_offset_minutes === minutes,
      `${key}/${policy}: request must seal the lifetime the hint shows`,
    )
  }
  const oneTime = lifetimeMinutesFor(meta, "one_time")
  for (const policy of policies) {
    check(oneTime <= lifetimeMinutesFor(meta, policy), `${key}: one_time must not outlive ${policy}`)
  }
}

for (const key of ["lab.generate.lifetime.fresh", "lab.generate.lifetime.expired"]) {
  check(typeof en[key] === "string" && en[key].length > 0, `en catalogue must define ${key}`)
  check(typeof es[key] === "string" && es[key].length > 0, `es catalogue must define ${key}`)
}
check(String(en["lab.generate.lifetime.fresh"]).includes("{minutes}"), "fresh hint must interpolate {minutes}")
check(String(es["lab.generate.lifetime.fresh"]).includes("{minutes}"), "es fresh hint must interpolate {minutes}")

// --- 7. operator-picked expiry -----------------------------------------------

const now = Date.parse("2026-08-26T09:00:00")
const minute = 60_000
check(customExpiryMinutes(null, now) === null, "no picker value means no custom expiry")
check(customExpiryMinutes("", now) === null, "an empty picker means no custom expiry")
check(customExpiryMinutes("not a date", now) === null, "garbage in the picker means no custom expiry")
check(
  customExpiryMinutes(expiryInputValue(now + 90 * minute), now) === 90,
  "the picker value round-trips to the minutes the request seals",
)
check(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(expiryInputValue(now)), "picker value is datetime-local shaped")
check(lifetimeMinutesFor(scenarioMeta.valid, "time_limited", 90) === 90, "time_limited seals the picked expiry")
check(lifetimeMinutesFor(scenarioMeta.valid, "one_time", 90) === 5, "one_time ignores the picker")
check(lifetimeMinutesFor(scenarioMeta.valid, "reusable_public", 90) === 60, "reusable_public ignores the picker")
check(lifetimeMinutesFor(scenarioMeta.valid, "time_limited", null) === 60, "no pick keeps the policy default")
check(
  lifetimeMinutesFor(scenarioMeta.expired, "time_limited", 90) === scenarioMeta.expired.expiresOffsetMinutes,
  "the expired scenario wins over the picker",
)
check(
  buildScenarioRequest("valid", "fixed", "time_limited", { customExpiryMinutes: 90 }).expires_offset_minutes === 90,
  "request seals the picked expiry",
)
check(MAX_LIFETIME_MINUTES === 30 * 24 * 60, "lifetime cap is 30 days, matching the server's bound")
check(expiryValidation(null, now) === null, "no pick needs no validation")
check(expiryValidation(expiryInputValue(now + 90 * minute), now) === null, "a future pick inside the cap is valid")
check(expiryValidation(expiryInputValue(now - minute), now) === "past", "a past pick is rejected")
check(expiryValidation(expiryInputValue(now), now) === "past", "a pick at the current minute is rejected")
check(
  expiryValidation(expiryInputValue(now + (MAX_LIFETIME_MINUTES + 1) * minute), now) === "tooFar",
  "a pick past the cap is rejected",
)
check(expiryValidation("not a date", now) === "invalid", "garbage is rejected, not silently defaulted")

// --- 8. guided step wording ------------------------------------------------

const guidedKeys = [
  "lab.generate.configure",
  "lab.generate.options",
  "lab.generate.usagePolicy.help.reusable_public",
  "lab.generate.usagePolicy.help.one_time",
  "lab.generate.usagePolicy.help.time_limited",
  "lab.generate.nonce.help.fixed",
  "lab.generate.nonce.help.timestamped",
  "lab.generate.expiry.label",
  "lab.generate.expiry.help",
  "lab.generate.expiry.error.past",
  "lab.generate.expiry.error.tooFar",
  "lab.generate.expiry.error.invalid",
  "lab.generate.lifetime.until",
  "lab.generate.sealed.details",
]
for (const [name, catalog] of [["en", en], ["es", es]]) {
  for (const key of guidedKeys) {
    check(typeof catalog[key] === "string" && catalog[key].length > 0, `${name} catalogue must define ${key}`)
  }
  check(!("lab.generate.advanced" in catalog), `${name}: lab.generate.advanced must be gone`)
  check(String(catalog["lab.generate.lifetime.until"]).includes("{when}"), `${name}: until hint interpolates {when}`)
  check(String(catalog["lab.generate.expiry.error.tooFar"]).includes("{days}"), `${name}: tooFar names the cap in {days}`)
}

if (failures.length > 0) {
  console.error(`lifetime smoke failed (${failures.length}):`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`lifetime smoke ok: ${Object.keys(scenarioMeta).length} scenarios x ${policies.length} policies`)
