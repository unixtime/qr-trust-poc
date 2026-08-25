// Pins the A/B comparison summariser to the documented scenario catalogue.
// Run with: node --experimental-strip-types scripts/comparison-smoke.mjs
//
// Invariants:
//   1. every non-valid scenario paired with `valid` changes exactly the layer
//      that `content.ts` documents as `expectedOutcome.layer`;
//   2. the reported layer is the first differing row and is symmetric;
//   3. identical pairs report `layer: null` and no differing rows;
//   4. every key the comparison can emit exists in the English catalogue.
import {
  compareScenarios,
  comparisonLayerLabelKeys,
  comparisonLayers,
  comparisonValueKeys,
  summariseScenario,
} from "../src/routes/lab/comparison.ts"
import { scenarioMeta } from "../src/routes/lab/content.ts"
import { en } from "../src/i18n/catalog/en.ts"

const failures = []
function check(condition, message) {
  if (!condition) failures.push(message)
}

const keys = Object.keys(scenarioMeta)
check(keys.includes("valid"), "scenario catalogue must contain `valid`")

for (const key of keys) {
  if (key === "valid") continue
  const meta = scenarioMeta[key]
  const { layer, rows } = compareScenarios(meta, scenarioMeta.valid)
  check(layer !== null, `${key} vs valid must differ somewhere`)
  const label = layer ? en[comparisonLayerLabelKeys[layer]] : null
  check(
    label === meta.expectedOutcome.layer,
    `${key} vs valid: summariser says "${label}", content.ts documents "${meta.expectedOutcome.layer}"`,
  )
  const evidenceDiffs = rows.filter((row) => row.differs && row.layer !== "decision")
  check(
    evidenceDiffs.length === 1,
    `${key} vs valid: expected exactly one differing evidence layer, got ${evidenceDiffs.map((r) => r.layer).join(",") || "none"}`,
  )
}

for (const a of keys) {
  for (const b of keys) {
    const forward = compareScenarios(scenarioMeta[a], scenarioMeta[b])
    const backward = compareScenarios(scenarioMeta[b], scenarioMeta[a])
    check(forward.layer === backward.layer, `${a}/${b}: layer must be symmetric`)
    check(forward.rows.length === comparisonLayers.length, `${a}/${b}: one row per layer`)
    const firstDiff = forward.rows.find((row) => row.differs)?.layer ?? null
    check(forward.layer === firstDiff, `${a}/${b}: layer must be the first differing row`)
    if (a === b) {
      check(forward.layer === null, `${a} vs itself must report null`)
      check(forward.rows.every((row) => !row.differs), `${a} vs itself must have no differing rows`)
    }
    for (const row of forward.rows) {
      check(typeof en[row.currentKey] === "string" && en[row.currentKey].length > 0, `missing en key ${row.currentKey}`)
      check(typeof en[row.pairedKey] === "string" && en[row.pairedKey].length > 0, `missing en key ${row.pairedKey}`)
    }
  }
}

for (const key of keys) {
  const summary = summariseScenario(scenarioMeta[key])
  check(summary.decision === scenarioMeta[key].expectedOutcome.tone, `${key}: decision token must mirror expectedOutcome.tone`)
  for (const layer of comparisonLayers) {
    check(layer in comparisonValueKeys && summary[layer] in comparisonValueKeys[layer], `${key}: unknown ${layer} token ${String(summary[layer])}`)
  }
}

for (const layer of comparisonLayers) {
  check(typeof en[comparisonLayerLabelKeys[layer]] === "string", `missing en label key for ${layer}`)
  for (const messageKey of Object.values(comparisonValueKeys[layer])) {
    check(typeof en[messageKey] === "string" && en[messageKey].length > 0, `missing en value key ${messageKey}`)
  }
}

if (failures.length > 0) {
  console.error(`comparison-smoke: ${failures.length} failure(s)`)
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
console.log(`comparison-smoke: ok (${keys.length} scenarios, ${keys.length * keys.length} ordered pairs)`)
