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
//   6. the pre-generation hint keys exist in both catalogues.
import {
  buildScenarioRequest,
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

if (failures.length > 0) {
  console.error(`lifetime smoke failed (${failures.length}):`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`lifetime smoke ok: ${Object.keys(scenarioMeta).length} scenarios x ${policies.length} policies`)
