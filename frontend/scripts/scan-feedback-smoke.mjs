// Pins the QR scan-feedback presentation: what the frame shows before and
// after a scan. Run with: node --experimental-strip-types scripts/scan-feedback-smoke.mjs
//
// Two things a build must not quietly regress:
//
// 1. Before a scan the QR shows nothing but the code. The old "Waiting for a
//    phone scan" pill assumed the scanner is a phone (tablets, laptops and the
//    browser lab all scan too) and it read as an instruction rather than a
//    state. Only a real verdict, or an honest "cannot answer" from the
//    evidence store, may put anything on the image.
// 2. A verdict colours the frame itself: the glow tone follows the scanner's
//    `decision_color` and the message follows the glow. Both the sealed card
//    and the full-screen view go through the same frame component, so the
//    source check below is what keeps the modal from drifting.
// 3. The glow is a pulse, not a border. It runs a couple of times when a
//    scan lands and then settles to the bracket tint, so a code that was
//    scanned an hour ago is not still wearing a green ring. Every new scan
//    pulses again, which is what `scanPulseKey` exists for.

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import {
  scanFeedbackPresentation,
  scanFeedbackStateFor,
  scanPulseKey,
} from "../src/routes/lab/scan-feedback-state.ts"
import { en } from "../src/i18n/catalog/en.ts"
import { es } from "../src/i18n/catalog/es.ts"

const repoFile = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

const observable = (overrides = {}) => ({
  persistence_state: "observable",
  scan_count: 0,
  latest: null,
  replay_guard: { applies: false, state: "not_applicable" },
  ...overrides,
})

// --- state machine ---------------------------------------------------------

assert.equal(scanFeedbackStateFor(null, null), "checking")
assert.equal(scanFeedbackStateFor(null, "fetch failed"), "offline")
assert.equal(
  scanFeedbackStateFor(observable({ persistence_state: "unavailable" }), null),
  "unavailable",
)
assert.equal(scanFeedbackStateFor(observable(), null), "waiting")
for (const color of ["green", "orange", "red"]) {
  assert.equal(
    scanFeedbackStateFor(
      observable({ scan_count: 1, latest: { decision_color: color } }),
      null,
    ),
    color,
  )
}

// --- presentation ----------------------------------------------------------

// Nothing on the image until there is something true to say.
assert.deepEqual(scanFeedbackPresentation("waiting"), { tone: null, pill: false })
assert.deepEqual(scanFeedbackPresentation("checking"), { tone: null, pill: false })
// "Cannot answer" is a real state and keeps its pill, but never a verdict glow.
assert.deepEqual(scanFeedbackPresentation("offline"), { tone: null, pill: true })
assert.deepEqual(scanFeedbackPresentation("unavailable"), { tone: null, pill: true })
// A verdict glows in its own colour and then shows the message.
assert.deepEqual(scanFeedbackPresentation("green"), { tone: "green", pill: true })
assert.deepEqual(scanFeedbackPresentation("orange"), { tone: "amber", pill: true })
assert.deepEqual(scanFeedbackPresentation("red"), { tone: "red", pill: true })

// --- pulse: once per scan, never before one ---------------------------------

// No verdict, no pulse: the frame must not flash on mount or on an error.
assert.equal(scanPulseKey(null), null)
assert.equal(scanPulseKey(observable()), null)
assert.equal(scanPulseKey(observable({ persistence_state: "unavailable" })), null)
const firstScan = observable({
  scan_count: 1,
  last_scanned_at: "2026-08-26T10:00:00Z",
  latest: { decision_color: "green" },
})
const firstKey = scanPulseKey(firstScan)
assert.ok(typeof firstKey === "string" && firstKey.length > 0, "a verdict has a pulse key")
// Polling the same scan again must not re-pulse.
assert.equal(scanPulseKey({ ...firstScan }), firstKey)
// A later scan (more scans, later timestamp) pulses again, whatever its colour.
const secondScan = observable({
  scan_count: 2,
  last_scanned_at: "2026-08-26T10:05:00Z",
  latest: { decision_color: "red" },
})
assert.notEqual(scanPulseKey(secondScan), firstKey)

// The frame animates the pulse and no longer carries a persistent ring.
const frameSource = repoFile("src/routes/lab/components/ScanFeedback.tsx")
assert.ok(
  !/shadow-\[0_0_0_2px/.test(frameSource),
  "ScanFeedback.tsx: no persistent verdict ring on the frame",
)
assert.ok(
  /animate-\[scan-pulse_[^\]]*_2\]/.test(frameSource),
  "ScanFeedback.tsx: the pulse runs the scan-pulse keyframes twice",
)
assert.ok(frameSource.includes("scanPulseKey("), "ScanFeedback.tsx: keys the pulse per scan")
assert.ok(
  repoFile("src/index.css").includes("@keyframes scan-pulse"),
  "index.css: defines the scan-pulse keyframes",
)

// --- catalogue: device-neutral wording, no waiting message -----------------

const deviceWords = /\b(phone|m[oó]vil|tel[eé]fono|smartphone)\b/i
for (const [name, catalog] of [["en", en], ["es", es]]) {
  assert.ok(
    !("lab.scanFeedback.waiting" in catalog),
    `${name}: lab.scanFeedback.waiting must be gone`,
  )
  for (const [key, value] of Object.entries(catalog)) {
    if (!key.startsWith("lab.scanFeedback.")) continue
    // Platform labels name what the scanner actually reported itself as
    // ("iPhone app"), which is a fact about the scan, not an assumption.
    if (key.startsWith("lab.scanFeedback.platform.")) continue
    assert.ok(
      !deviceWords.test(value),
      `${name}: ${key} names a device: ${JSON.stringify(value)}`,
    )
  }
}

// --- both QR mounts share the frame ----------------------------------------

for (const path of [
  "src/routes/lab/steps/GenerateStep.tsx",
  "src/routes/lab/components/QrDisplayModal.tsx",
]) {
  const source = repoFile(path)
  assert.ok(source.includes("<ScanFeedbackFrame"), `${path}: uses ScanFeedbackFrame`)
  assert.ok(
    !source.includes("<ScanFeedbackOverlay"),
    `${path}: must not mount the overlay outside the frame`,
  )
}

console.log("scan-feedback smoke ok")
