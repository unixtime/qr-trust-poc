/**
 * The source catalogue and the single source of truth for UI copy.
 *
 * Keys are flat and namespaced `area.component.slot`. Flat beats nested here:
 * the key union stays a plain string literal type, lookups need no path
 * walking, and `scripts/translate-catalog.mjs` can round-trip the whole file
 * without reasoning about structure.
 *
 * Not in this catalogue, deliberately:
 *  - the "QR Trust PoC" wordmark, which is a name rather than copy
 *  - `data-testid` values and scenario keys, which are selectors and API
 *    identifiers — translating them would break the harness and the backend
 *  - scenario behaviour (payloads, offsets, revocation flags), which lives on
 *    beside its copy in `routes/lab/content.ts`
 *
 * Run `npm run i18n:translate` after editing to regenerate `es.ts`.
 */
export const en = {
  // ── Shell ────────────────────────────────────────────────────────────────
  "shell.nav.label": "Primary",
  "shell.nav.workflow": "Workflow",
  "shell.nav.operator": "Operator",
  "shell.nav.about": "About",
  "shell.nav.menu": "Menu",
  "shell.language.label": "Language",
  "shell.language.en": "English",
  "shell.language.es": "Español",
  "shell.language.enShort": "EN",
  "shell.language.esShort": "ES",
  "shell.microbar.protocol": "Signed QR protocol",
  "shell.microbar.build": "Proof-of-concept build",
  "shell.footer.tagline": "Every scan is a signed decision",
  "shell.status.operational": "Operational",
  "shell.status.offline": "Offline",
  "shell.status.checking": "Checking",

  // ── App-level routes ─────────────────────────────────────────────────────
  "app.notFound.eyebrow": "Route not found",
  "app.notFound.title": "There is no page at this address.",
  "app.notFound.body":
    "The guided workflow lives at {workflow}, the operator console at {operator}, and the project overview at {about}.",
  "app.notFound.cta": "Go to the workflow",
  "app.loading.eyebrow": "Loading",
  "app.loading.title": "Preparing this page.",
  "app.loading.body":
    "Each route loads as its own chunk, so the first visit to a page can take a moment.",

  // ── About ────────────────────────────────────────────────────────────────
  "about.title": "How it works",
  "about.subtitle":
    "A proof of concept for QR codes a scanner can actually verify.",
  "about.check.issuer.label": "Issuer legitimacy",
  "about.check.issuer.detail": "Is the QR signed by a registered issuer key?",
  "about.check.destination.label": "Destination binding",
  "about.check.destination.detail":
    "Does the destination match the issuer's approved set?",
  "about.check.runtime.label": "Runtime safety",
  "about.check.runtime.detail": "Is the destination safe to visit right now?",
  "about.check.decision.label": "Scanner decision",
  "about.check.decision.detail":
    "Open, hold-to-open, or block — with the evidence attached.",
  "about.body.problem":
    "An ordinary QR code is an opaque instruction: the scanner decodes a URL and opens it, trusting whoever printed the sticker. This proof of concept adds a verification step in between. Every demo QR carries a signed envelope, and the scanner asks a verifier to check that envelope before anything opens.",
  "about.body.checks":
    "The verifier walks the four checks above in order. Each check either passes, fails, or leaves a residual — a condition the cryptography alone cannot settle, such as an issuer policy that expired or a destination whose runtime reputation degraded after the code was printed.",
  "about.body.verdicts":
    "Verdicts keep those residuals visible instead of rounding them up to green: emerald means accepted, red means rejected or tampered, and amber means policy-gated or runtime-degraded. An amber verdict is never a positive result — it is the verifier telling you exactly which trust question remains open.",
  "about.body.tour":
    "The workflow on the landing page walks one scenario end to end: pick a scenario, generate its QR, scan it, and read the verdict evidence. The operator console manages the other side — issuer keys, policy, and runtime posture — so you can change the rules and watch the same QR produce a different decision.",
  "about.cta.workflow": "Open the workflow",
  "about.link.readme": "Repository README",
  "about.link.runGuide": "Run guide",

  // ── Lab: flow stepper ────────────────────────────────────────────────────
  "lab.stepper.label": "Workflow steps",
  "lab.stepper.step1": "Pick scenario",
  "lab.stepper.step2": "Generate QR",
  "lab.stepper.step3": "Scan",
  "lab.stepper.step4": "Verdict & evidence",

  // ── Lab: usage policy ────────────────────────────────────────────────────
  // The wire values (`reusable_public`, …) go to the verifier untranslated;
  // these are only what a reader sees.
  "lab.usagePolicy.reusablePublic": "Reusable public",
  "lab.usagePolicy.oneTime": "One-time",
  "lab.usagePolicy.timeLimited": "Time-limited",

  // ── Lab: scenario picker ─────────────────────────────────────────────────
  "lab.scenarioStep.eyebrow": "Scenario library",
  "lab.scenarioStep.eyebrowDetail": "Signed demo set · {count} envelopes",
  "lab.scenarioStep.titleLead": "{count} scenarios.",
  "lab.scenarioStep.titleAccent": "One honest verdict.",
  "lab.scenarioStep.subtitle":
    "Each scenario issues a QR whose trust evidence passes or fails one specific check.",
  "lab.scenarioStep.filter.all": "All",
  "lab.scenarioStep.compare.show": "Compare against a second scenario",
  "lab.scenarioStep.compare.hide": "Hide comparison",
  "lab.scenarioStep.compare.none": "None",
  "lab.scenarioStep.compare.eyebrow": "Optional · A/B comparison",
  "lab.scenarioStep.compare.purpose": "Pick a second scenario that differs from the current one by a single trust layer. The workbench names that layer and lets you run both cases back to back, so any change in the verdict is attributable to one cause.",
  "lab.scenarioStep.active": "Active",
  "lab.scenarioStep.next": "Next: Generate QR",

  // ── Lab: scenario groups ─────────────────────────────────────────────────
  "lab.group.valid": "Valid",
  "lab.group.tampered": "Tampered",
  "lab.group.policyBlocked": "Policy-blocked",
  "lab.group.runtimeDegraded": "Runtime-degraded",

  // ── Lab: scenarios ───────────────────────────────────────────────────────
  // One label per scenario, shared by the picker, the flow header, and the
  // history log. The scenario key itself (`valid`, `subdomain-allowed`, …) is
  // an API identifier and stays out of the catalogue.
  "lab.scenario.valid.label": "Valid first scan",
  "lab.scenario.valid.note":
    "Clean envelope, live certificate, matching payload, and policy-dependent reuse behavior.",
  "lab.scenario.expired.label": "Expired",
  "lab.scenario.expired.note":
    "The verifier should reject this envelope at the time-window gate.",
  "lab.scenario.revoked.label": "Revoked certificate",
  "lab.scenario.revoked.note":
    "The verifier should block before replay reservation when the issuer state marks the certificate revoked.",
  "lab.scenario.subdomainAllowed.label": "Subdomain allowed",
  "lab.scenario.subdomainAllowed.note":
    "A subdomain payload should pass when the issuer policy explicitly allows subdomains.",
  "lab.scenario.subdomainBlocked.label": "Subdomain blocked",
  "lab.scenario.subdomainBlocked.note":
    "The same subdomain should fail when the issuer policy only trusts the exact registered domain.",
  "lab.scenario.payloadMismatch.label": "Payload mismatch",
  "lab.scenario.payloadMismatch.note":
    "The envelope is signed correctly, but the payload falls outside the issuer-approved destination set.",
  "lab.scenario.redirectApproved.label": "Approved resolver flow",
  "lab.scenario.redirectApproved.note":
    "The QR points to an enrolled resolver and the resolved final destination remains issuer-approved.",
  "lab.scenario.redirectFinalMismatch.label": "Resolver final mismatch",
  "lab.scenario.redirectFinalMismatch.note":
    "The resolver itself is enrolled, but the final destination leaves the issuer-approved redirect policy.",
  "lab.scenario.redirectTooManyHops.label": "Too many redirect hops",
  "lab.scenario.redirectTooManyHops.note":
    "The resolver reaches the expected destination, but the redirect chain exceeds the issuer policy.",
  "lab.scenario.redirectNestedShortener.label": "Nested shortener",
  "lab.scenario.redirectNestedShortener.note":
    "The resolver flow includes an intermediate shortener that the issuer policy does not allow.",
  "lab.scenario.runtimeRisky.label": "Verified issuer, destination risky",
  "lab.scenario.runtimeRisky.note":
    "Issuer and destination binding pass, then the runtime safety layer downgrades the final scanner state to caution.",
  "lab.scenario.runtimeBlocked.label": "Runtime safety blocked",
  "lab.scenario.runtimeBlocked.note":
    "Issuer and destination binding pass, then the runtime safety layer reports a high-confidence block condition.",
  "lab.scenario.staleCache.label": "Stale verifier cache",
  "lab.scenario.staleCache.note":
    "Issuer and destination would otherwise pass, but the verifier's synchronized trust cache is too stale for a positive trust state.",
  "lab.scenario.unknownIssuer.label": "Signed, unknown issuer",
  "lab.scenario.unknownIssuer.note":
    "The envelope is correctly signed, but its certificate is not enrolled in this scanner's trust records, so issuer legitimacy cannot be established.",
  "lab.scenario.artifactQuietZone.label": "Tampered print: missing quiet zone",
  "lab.scenario.artifactQuietZone.note":
    "The signed payload is valid, but the printed QR was rendered without its quiet zone, so artifact inspection reports a visual tampering indicator.",
  "lab.scenario.artifactMismatch.label": "Tampered print: payload mismatch",
  "lab.scenario.artifactMismatch.note":
    "The printed QR encodes an attacker destination instead of the signed payload, standing in for a sticker pasted over a legitimate print.",

  // ── Lab: generate + history messages ─────────────────────────────────────
  // Whole sentences with named slots. Assembling these from fragments would
  // lock in English word order; Spanish puts the nonce clause elsewhere.
  "lab.generate.ready.title": "Demo QR ready",
  "lab.generate.ready.body":
    "Generated {scenario} as {policy} with nonce {nonce}.",
  "lab.history.generated.title": "QR generated",
  "lab.history.generated.body": "{scenario}. Usage {policy}. Nonce {nonce}.",
  "lab.history.directVerify.label": "{scenario} direct verify",

  // ── Lab: shared step chrome ──────────────────────────────────────────────
  "lab.common.back": "Back",

  // ── Lab: generate step ───────────────────────────────────────────────────
  "lab.generate.title": "Generate the demo QR",
  "lab.generate.scenarioLine": "Scenario: {scenario}",
  "lab.generate.keyRequired":
    "The verifier requires an API key. Issue a local demo key first.",
  "lab.generate.issueKey": "Issue local lab key",
  "lab.generate.issuingKey": "Issuing key…",
  "lab.generate.generate": "Generate demo QR",
  "lab.generate.generating": "Generating…",
  "lab.generate.verifyCurrent": "Verify current QR",
  "lab.generate.verifying": "Verifying…",
  "lab.generate.qrAlt": "Generated verifier QR",
  "lab.generate.fullscreen": "View full screen",
  "lab.generate.sealed.badge": "Signed",
  "lab.generate.sealed.nonce": "Nonce",
  "lab.generate.sealed.policy": "Policy",
  "lab.generate.sealed.issued": "Issued",
  "lab.generate.verifierReason": "Verifier reason:",
  "lab.scanFeedback.checking": "Checking for phone scans",
  "lab.scanFeedback.waiting": "Waiting for a phone scan",
  "lab.scanFeedback.unavailable": "Scan feedback unavailable",
  "lab.scanFeedback.offline": "Scan feedback offline",
  "lab.scanFeedback.scanned.green": "Scanned · verified {time}",
  "lab.scanFeedback.scanned.orange": "Scanned · needs review {time}",
  "lab.scanFeedback.scanned.red": "Scanned · blocked {time}",
  "lab.scanFeedback.consumedStamp": "Used",
  "lab.scanFeedback.note.unconfigured":
    "Phone scans are verified but not reported back here: this verifier has no evidence store (QRTRUST_NETWORK_DATABASE_URL).",
  "lab.scanFeedback.note.unavailable":
    "The evidence store is not answering, so phone scans cannot be reported back here right now. {error}",
  "lab.scanFeedback.note.offline": "Scan feedback could not be loaded: {error}",
  "lab.scanFeedback.rows.status": "Feedback",
  "lab.scanFeedback.rows.scans": "Scans",
  "lab.scanFeedback.rows.lastScan": "Last scan",
  "lab.scanFeedback.rows.scanner": "Scanner",
  "lab.scanFeedback.rows.oneTime": "One-time",
  "lab.scanFeedback.value.unavailable": "Unavailable",
  "lab.scanFeedback.value.none": "None yet",
  "lab.scanFeedback.count.verified": "{count} verified",
  "lab.scanFeedback.count.review": "{count} review",
  "lab.scanFeedback.count.blocked": "{count} blocked",
  "lab.scanFeedback.platform.ios": "iPhone app",
  "lab.scanFeedback.platform.android": "Android app",
  "lab.scanFeedback.platform.browser_lab": "Web lab (simulated)",
  "lab.scanFeedback.platform.unknown": "Unknown scanner",
  "lab.scanFeedback.oneTime.unused": "Unused",
  "lab.scanFeedback.oneTime.reserved": "Reserved · verifying",
  "lab.scanFeedback.oneTime.consumed": "Used · replay blocked",
  "lab.scanFeedback.oneTime.until": "{state} until {time}",
  "lab.scanFeedback.rows.firstScan": "First scan",
  "lab.scanFeedback.rows.verdict": "Verdict",
  "lab.scanFeedback.rows.destination": "Destination",
  "lab.scanFeedback.rows.vouchedBy": "Vouched by",
  "lab.scanFeedback.rows.throttle": "Throttle",
  "lab.scanFeedback.throttle.value":
    "{cached} cached · {remaining} of {limit} scans left per {window}",
  "lab.scanFeedback.throttle.windowMinute": "minute",
  "lab.scanFeedback.throttle.windowSeconds": "{seconds} s",
  "lab.scanFeedback.rows.expires": "Expires",
  "lab.scanFeedback.verdict.risk": "risk {score}/100",
  "lab.scanFeedback.verdict.hold": "hold to open",
  "lab.scanFeedback.destination.opened": "Opened on the phone",
  "lab.scanFeedback.destination.cancelled": "Cancelled on the phone",
  "lab.scanFeedback.destination.held": "Hold completed, not opened",
  "lab.scanFeedback.destination.previewed": "Previewed, not opened",
  "lab.scanFeedback.destination.unreported": "Not reported by the scanner",
  "lab.scanFeedback.oneTime.usedAt": "Used {time} · will not verify again",
  "lab.scanFeedback.oneTime.usedAtBlocked": "Used {time} · replay blocked ×{count}",
  "lab.scanFeedback.expires.in": "in {duration}",
  "lab.scanFeedback.expires.ago": "expired {duration} ago",
  "lab.generate.advanced": "Advanced options",
  "lab.generate.nonceMode": "Nonce mode",
  "lab.generate.nonce.fixed": "Fixed nonce",
  "lab.generate.nonce.timestamped": "Timestamped nonce",
  "lab.generate.usagePolicyLegend": "Usage policy",
  "lab.generate.lifetime.fresh":
    "The sealed QR will stay valid for {minutes} min after generation; the verifier rejects it after that whatever the policy says.",
  "lab.generate.lifetime.expired":
    "This scenario seals a QR that has already expired, so every scan is rejected at the freshness check.",
  "lab.generate.next": "Next: Scan",

  // ── Lab: scan step ───────────────────────────────────────────────────────
  "lab.scan.title": "Scan",
  "lab.scan.subtitle":
    "Upload a QR image, paste a decoded payload, or run the scanner pipeline directly against the QR from step 2. A live camera scan is available for second-screen demos.",
  "lab.scan.simulated.title": "Simulated scan",
  "lab.scan.simulated.description":
    "Runs the full scanner decision against the current demo QR — no camera required.",
  "lab.scan.checkDecision": "Check scanner decision",
  "lab.scan.checkingDecision": "Checking scanner decision…",
  "lab.scan.needsQr": "Generate a QR in step 2 first.",
  "lab.scan.next": "Next: Verdict & evidence",

  // ── Lab: verdict step ────────────────────────────────────────────────────
  "lab.verdict.eyebrow": "Verdict console",
  "lab.verdict.title": "Verdict & evidence",
  "lab.verdict.subtitle":
    "Every trust check the scanner ran, with its raw evidence.",
  "lab.verdict.crypto.title": "Cryptographic verification",
  "lab.verdict.crypto.description":
    "Result of verifying the current QR payload against the verifier API.",
  "lab.verdict.accepted": "accepted",
  "lab.verdict.rejected": "rejected",
  "lab.verdict.stage": "stage: {stage}",
  "lab.verdict.usagePolicy": "usage policy: {policy}",
  "lab.verdict.empty.title": "No scanner decision yet",
  // `{action}` is the scan step's button label, interpolated rather than
  // repeated so the two cannot drift apart in translation.
  "lab.verdict.empty.body":
    'Scan the QR with the camera in step 3, or use the simulated scan ("{action}") there.',
  "lab.verdict.empty.cta": "Back to Scan",
  "lab.verdict.rawEvidence": "Raw evidence",
  "lab.verdict.gates.label": "Trust gates",
  // Screen-reader text for the gates ring; the visible ring shows only the
  // bare `{passed}/{total}` figure.
  "lab.verdict.gates.aria": "{passed} of {total} trust gates passed",
  // Visible sibling of the aria string: the pass-count chip in the trust-path
  // card header, echoing the ring's figure in words.
  "lab.verdict.gates.chip": "{passed}/{total} passed",
  // Eyebrow meta line: the wire decision id and its timestamp.
  "lab.verdict.eyebrowDetail": "Decision {id} · {time}",
  "lab.verdict.crypto.claimsHash": "Claims SHA-256",
  "lab.verdict.crypto.matchedRule": "Matched rule",
  "lab.verdict.crypto.reservationState": "Reservation state",
  "lab.verdict.destination.title": "Destination",
  "lab.verdict.destination.description":
    "Where this code points, resolved by the verifier.",
  "lab.verdict.destination.display": "Displayed URL",
  "lab.verdict.destination.host": "Host",
  "lab.verdict.destination.binding": "Binding",
  "lab.verdict.destination.resolver": "Resolver URL",
  "lab.verdict.destination.final": "Final URL",
  "lab.verdict.destination.redirects": "Redirect hops",
  "lab.verdict.destination.redirectPolicy": "Redirect policy",
  "lab.verdict.destination.fingerprint": "Fingerprint",
  // Hero CTAs: the open button only renders when the verifier itself allowed
  // the open, so the copy can state the action plainly.
  "lab.verdict.cta.open": "Open destination",
  "lab.verdict.cta.inspect": "Inspect evidence",
  // Under the gates ring — says where the number comes from, nothing more.
  "lab.verdict.ring.caption": "Computed from the trust gates below",
  "lab.verdict.sealed.title": "Sealed artifact",
  "lab.verdict.destination.footnote":
    "Resolved by the verifier from the signed envelope.",

  // ── Lab: A/B comparison
  "lab.compare.eyebrow": "A/B comparison",
  "lab.compare.title": "Same verifier, one layer changed.",
  "lab.compare.purpose": "Every trust layer below matches between A and B except the highlighted one. Run both and whatever moves in the verdict is caused by that layer alone: evidence, not a claim.",
  "lab.compare.current": "A · Current",
  "lab.compare.paired": "B · Paired",
  "lab.compare.changedLayer": "Changed layer",
  "lab.compare.identical.title": "Identical evidence",
  "lab.compare.identical.body": "These two scenarios exercise the same trust layers, so a comparison proves nothing. Pick a different pair.",
  "lab.compare.load": "Load B: {scenario}",
  "lab.compare.loadHint": "Generates the paired QR and swaps A and B, so you can flip between the two cases from the verdict.",
  "lab.compare.nudge.body": "Want to prove which layer caused this verdict? Pair it with a scenario that differs by one layer.",
  "lab.compare.nudge.action": "Choose a paired scenario",
  "lab.compare.layer.issuer": "Issuer legitimacy",
  "lab.compare.layer.destination": "Destination binding",
  "lab.compare.layer.redirect": "Redirect policy",
  "lab.compare.layer.freshness": "Freshness and replay",
  "lab.compare.layer.runtime": "Runtime safety",
  "lab.compare.layer.cache": "Verifier cache",
  "lab.compare.layer.artifact": "Artifact integrity",
  "lab.compare.layer.decision": "Expected verdict",
  "lab.compare.value.issuer.active": "Enrolled issuer, active certificate",
  "lab.compare.value.issuer.revoked": "Certificate revoked",
  "lab.compare.value.issuer.unenrolled": "Not traceable to an enrolled issuer",
  "lab.compare.value.destination.exact": "Bound to the exact host",
  "lab.compare.value.destination.subdomain": "Allowed by subdomain policy",
  "lab.compare.value.destination.outside": "Outside the approved set",
  "lab.compare.value.redirect.none": "No resolver involved",
  "lab.compare.value.redirect.approved": "Approved resolver, one hop",
  "lab.compare.value.redirect.nestedShortener": "Nested shortener",
  "lab.compare.value.redirect.tooManyHops": "Too many hops",
  "lab.compare.value.redirect.finalMismatch": "Final destination differs",
  "lab.compare.value.freshness.fresh": "Inside the time window",
  "lab.compare.value.freshness.expired": "Time window expired",
  "lab.compare.value.runtime.clean": "No risk signal",
  "lab.compare.value.runtime.risky": "Risk signal",
  "lab.compare.value.runtime.blocked": "Block signal",
  "lab.compare.value.cache.fresh": "Shared state fresh",
  "lab.compare.value.cache.stale": "Shared state stale",
  "lab.compare.value.cache.expired": "Shared state expired",
  "lab.compare.value.artifact.clean": "Printed cleanly",
  "lab.compare.value.artifact.lowQuietZone": "Quiet zone too small",
  "lab.compare.value.artifact.payloadMismatch": "Printed payload differs from the signed one",
  "lab.compare.value.decision.green": "Accept",
  "lab.compare.value.decision.amber": "Use caution",
  "lab.compare.value.decision.red": "Block",

  // ── Lab: fullscreen QR display ───────────────────────────────────────────
  "lab.qrModal.eyebrow": "Fullscreen QR display",
  "lab.qrModal.subtitle":
    "Use this as the display surface only. Scan it from a second device running the verifier workbench.",
  "lab.qrModal.close": "Close",
  "lab.qrModal.qrAlt": "Fullscreen verifier QR",
  "lab.qrModal.meta.scenario": "Scenario",
  "lab.qrModal.meta.nonce": "Nonce",
  "lab.qrModal.meta.payload": "Payload",
  "lab.qrModal.controls.title": "Display controls",
  "lab.qrModal.controls.description":
    "Reduce noise and push the QR container into fullscreen when the browser allows it.",
  "lab.qrModal.controls.hideMetadata": "Hide metadata",
  "lab.qrModal.controls.showMetadata": "Show metadata",
  "lab.qrModal.controls.disableHighContrast": "Disable high contrast",
  "lab.qrModal.controls.enableHighContrast": "Enable high contrast",
  "lab.qrModal.controls.enterFullscreen": "Enter fullscreen",
  "lab.qrModal.controls.failed": "Fullscreen request failed",
  "lab.qrModal.secondScreen.title": "Second-screen rule",
  "lab.qrModal.secondScreen.description":
    "This overlay only displays the QR. The verifier still runs in the main workbench on the other device.",

  // ── Lab: history ─────────────────────────────────────────────────────────
  "lab.history.title": "Recent verifier history",
  "lab.history.description":
    "The latest generate, accept, block, and admin events stay visible here.",
  "lab.history.empty": "No events yet.",

  // ── Lab: decision + status panels ────────────────────────────────────────
  "lab.decision.eyebrow": "Verification result",
  "lab.decision.accepted": "Accepted",
  "lab.decision.blocked": "Blocked",
  "lab.decision.pending": "Verification Result",
  "lab.decision.pendingBody": "Run a verifier action to inspect the latest result.",
  "lab.decision.matchedRule": "Matched rule: {rule}",
  "lab.status.waiting": "Waiting",
  "lab.status.noEvent": "No event has been recorded yet.",

  // ── Operator: page chrome ────────────────────────────────────────────────
  "operator.title": "Operator console",
  "operator.subtitle":
    "Runtime posture, access control, and management workflows — the facts an engineer inspects before trusting workflow results.",
  "operator.backToWorkflow": "Back to workflow",
  "operator.metric.verifierAuth": "Verifier auth",
  "operator.metric.adminFlow": "Admin flow",
  "operator.metric.sharedLabKey": "Shared lab key",
  // Metric values, not statuses from the API — the runtime status endpoint
  // returns booleans and the console decides how to say them.
  "operator.value.enabled": "enabled",
  "operator.value.disabled": "disabled",
  "operator.value.loading": "loading",
  "operator.value.present": "present",
  "operator.value.empty": "empty",
  "operator.read.title": "Current operator read",
  "operator.refresh": "Refresh runtime posture",
  "operator.refreshing": "Refreshing runtime…",
  "operator.tabs.label": "Operator sections",
  "operator.tabs.access": "Access",
  "operator.tabs.management": "Management",
  "operator.tabs.runtime": "Runtime",

  // ── Lab: camera lifecycle ────────────────────────────────────────────────
  // Why a camera cannot be used is a fact about the browser, so the reason is
  // held as a code and only turned into a sentence here, at the display edge.
  "lab.camera.blocked.serverRendering":
    "Camera capture is not available during server rendering.",
  "lab.camera.blocked.insecureContext":
    "Camera capture is unavailable because this page is not running in a secure context. Use HTTPS or localhost, or fall back to image upload.",
  "lab.camera.blocked.noMediaDevices":
    "Camera capture is unavailable because navigator.mediaDevices is not exposed in this browser.",
  "lab.camera.blocked.noGetUserMedia":
    "Camera capture is unavailable because getUserMedia is not exposed in this browser.",
  "lab.camera.unsupported.title": "Camera unsupported",
  "lab.camera.idle.title": "Camera idle",
  "lab.camera.idle.body": "No QR captured yet.",
  "lab.camera.overlay.idle":
    "Camera idle. Point the lens at a generated, printed, or external QR code.",
  "lab.camera.overlay.generated":
    "Point the lens at the generated QR. Active decoder: {decoder}.",
  "lab.camera.overlay.active":
    "Point the camera at a QR code. Active decoder: {decoder}.",
  "lab.camera.ready.title": "Camera ready",
  "lab.camera.ready.body":
    "Point the camera at the generated QR on another screen. Active decoder: {decoder}.",
  "lab.camera.active.title": "Camera active",
  "lab.camera.active.body":
    "Waiting for a QR on another screen or on paper. Decoder: {decoder}.",
  "lab.camera.captured.title": "QR captured",
  "lab.camera.captured.body":
    "The live camera decoded a QR payload using the {decoder}.",
  "lab.camera.checked.title": "Camera scan checked",
  "lab.camera.accepted.title": "Camera scan accepted",
  "lab.camera.rejected.title": "Camera scan blocked",
  "lab.camera.paused.title": "Camera scan paused",
  "lab.camera.paused.body":
    "Decode rate limit reached. The client will retry in {seconds}s.",
  "lab.camera.scanFailed.title": "Camera scan failed",
  "lab.camera.accessFailed.title": "Camera access failed",
  "lab.camera.notMounted": "Camera preview is not mounted.",
  // Decoder names name a mechanism, not a brand — they are prose inside the
  // camera sentences above, so they belong in the catalogue too.
  "lab.decoder.native": "native browser decoder",
  "lab.decoder.fallback": "bundled verifier fallback",

  // ── Lab: scanner-side messages ───────────────────────────────────────────
  "lab.scan.decisionReady.title": "Scanner decision ready",
  "lab.scan.captured.title": "Camera scan captured",
  "lab.scan.captured.body":
    "Decoded payload from the live camera using the {decoder}.",
  "lab.scan.accepted.title": "Verifier accepted payload",
  "lab.scan.rejected.title": "Verifier blocked payload",
  "lab.scan.imageDecoded.title": "Image decoded",
  "lab.scan.imageDecoded.body":
    "The QR payload was decoded from the uploaded image using the {decoder}. The scanner decision is running now.",
  "lab.scan.imageChecking.title": "QR image decoded; checking",
  "lab.scan.imageChecking.body":
    "Decoded with the {decoder}. The scanner-visible decision endpoint is evaluating the payload now.",
  "lab.scan.imageCheckFailed.title": "Image check failed",
  "lab.scan.imageDecodeFailed.title": "Image decode failed",
  "lab.scan.decisionFailed.title": "Scanner decision failed",
  "lab.scan.qrDecodeFailed.title": "QR decode failed",
  "lab.scan.noPayloadInImage":
    "No QR payload could be decoded from the selected image.",
  "lab.scan.payloadMissing.title": "Scanned payload missing",
  "lab.scan.payloadMissing.body":
    "Upload, capture, or paste a QR payload before verifying it.",

  // ── Lab: history entries ─────────────────────────────────────────────────
  // History titles name what a run did. `{source}` is one of the lab.source.*
  // labels below, so word order stays the translator's decision.
  "lab.history.initial.title": "Waiting",
  "lab.history.initial.body":
    "Issue a key, generate a QR, and the verifier decisions will appear here.",
  "lab.history.scannerDecision": "{source} scanner decision",
  "lab.history.accepted": "{source} accepted",
  "lab.history.rejected": "{source} blocked",
  "lab.history.openSelected": "Scanner open selected",
  "lab.history.openCancelled": "Scanner open cancelled",
  "lab.source.generatedQr": "Generated QR",
  "lab.source.cameraScan": "Camera scan",
  "lab.source.scannedQr": "Scanned QR",
  "lab.source.uploadedQr": "Uploaded QR",

  // ── Lab: destination open ────────────────────────────────────────────────
  "lab.open.noDestination.title": "No destination to open",
  "lab.open.noDestination.body":
    "The scanner decision did not expose a destination URL.",
  "lab.open.blocked.title": "Open was blocked by the browser",
  "lab.open.blocked.body":
    "The open did not complete. Allow popups or copy the destination if you need to continue.",
  "lab.open.cancelled.title": "Scanner open cancelled",
  "lab.open.cancelled.body":
    "The result stayed in the lab and no destination was opened.",
  // Fallback when the scanner decision omits a primary action label.
  "lab.open.defaultAction": "Open destination",

  // ── Lab: guards and failures ─────────────────────────────────────────────
  "lab.noDemo.title": "No demo QR",
  "lab.noDemo.scannerDecision":
    "Generate a demo QR before asking the scanner decision endpoint to evaluate it.",
  "lab.noDemo.verifyPayload":
    "Generate a demo QR before asking the verifier to evaluate a payload.",
  "lab.noDemo.verifyCurrent":
    "Generate a demo QR before asking the verifier to evaluate the current payload.",
  "lab.runtimeStatus.failed.title": "Runtime status failed",
  "lab.generate.failed.title": "Demo generation failed",
  "lab.verify.staleKey.title": "Stored verifier key rejected",
  "lab.verify.signedFailed.title": "Signed-verifier proof failed",
  "lab.camera.canvasUnavailable": "Camera canvas is not available.",
  "lab.camera.canvasNoContext": "Camera canvas could not create a 2D context.",
  "lab.error.requestFailed": "The verifier request failed.",
  "lab.error.signedProofOnly":
    "The signed-verifier proof only accepts generated QR Trust envelopes. Use the scanner-decision check for ordinary web links, camera scans, and user-facing safety results.",
  "lab.error.staleStoredKey":
    "The verifier rejected the API key saved in this browser, which happens when the key store is rebuilt. The stale key was cleared. Issue a new lab key, then try again.",

  // ── Lab: clipboard + local lab key ───────────────────────────────────────
  "lab.copy.copied.title": "Payload copied",
  "lab.copy.copied.qr": "The generated QR payload is in your clipboard.",
  "lab.copy.copied.decoded": "The decoded payload is in your clipboard.",
  "lab.copy.blocked.title": "Clipboard blocked",
  "lab.copy.blocked.body":
    "The browser denied clipboard access. Copy the payload manually from the text field.",
  "lab.labKey.issued.title": "Local lab key issued",
  "lab.labKey.issued.body":
    "The key is stored in browser storage for this local verifier workbench.",
  "lab.labKey.issued.history":
    "The lab can now generate demo QR material against the protected verifier API.",
  "lab.labKey.failed.title": "Local lab key failed",
  "lab.labKey.failed.body":
    "{error} Open operator mode if this runtime does not use the local compose admin token.",

  // ── Lab: payload edits, telemetry, fullscreen ────────────────────────────
  "lab.payload.changed.title": "Payload changed",
  "lab.payload.changed.body":
    "The previous result was cleared. Check the scanned QR to refresh the scanner-visible decision.",
  "lab.payload.cleared.title": "Payload cleared",
  "lab.payload.cleared.body":
    "Capture, upload, or paste a QR payload before checking it.",
  "lab.uxEvent.notRecorded": "Scanner UX event was not recorded",
  "lab.qrDisplay.fullscreenBlocked": "The browser blocked fullscreen mode.",

  // ── Operator: runtime posture summary ─────────────────────────────────────
  "operator.summary.loading": "Loading live verifier posture.",
  "operator.summary.authDisabled":
    "Verifier auth is disabled on this runtime. The lab can operate without a client key.",
  "operator.summary.adminDisabled":
    "Verifier auth is enabled, but admin key issuance is disabled. Engineers must paste an existing client key into the lab.",
  "operator.summary.ready":
    "Verifier auth and admin key issuance are both enabled. Issue a key here, then return to the lab with a shared browser-side key.",
  "operator.error.requestFailed": "The verifier request failed.",
  "operator.status.failed.title": "Runtime status failed",

  // ── Operator: admin credential guards ─────────────────────────────────────
  "operator.adminToken.missing.title": "Admin token missing",
  "operator.adminToken.missing.refreshKeys":
    "Provide the verifier admin token before refreshing the dynamic key inventory.",
  "operator.adminToken.missing.refreshManagementKeys":
    "Provide a management credential before refreshing management keys.",
  "operator.adminToken.missing.managementEvidence":
    "Provide the verifier admin token before loading management evidence.",
  "operator.adminToken.missing.issueKey":
    "Provide the verifier admin token before issuing a client key.",
  "operator.adminToken.missing.issueManagementKey":
    "Provide a management credential before issuing a management key.",
  "operator.adminToken.missing.runWorkflow":
    "Provide a management credential before running operator workflows.",
  "operator.adminToken.missing.revokeManagementKey":
    "Provide a management credential before revoking a management key.",

  // ── Operator: verifier client keys ────────────────────────────────────────
  "operator.keys.refreshed.title": "Key inventory refreshed",
  "operator.keys.refreshed.body":
    "Loaded {count} DB-backed verifier client key records from the management API.",
  "operator.keys.refreshFailed.title": "Key refresh failed",
  "operator.keys.issued.title": "Verifier key issued",
  "operator.keys.issued.body":
    "Key {label} is active. It has been stored in the browser so the lab can reuse it immediately.",
  "operator.keys.issueFailed.title": "Key issue failed",

  // ── Operator: management keys ─────────────────────────────────────────────
  "operator.managementKeys.refreshed.title": "Management keys refreshed",
  "operator.managementKeys.refreshed.body":
    "Loaded {count} DB-backed management key records.",
  "operator.managementKeys.refreshFailed.title": "Management key refresh failed",
  "operator.managementKeys.issued.title": "Management key issued",
  "operator.managementKeys.issued.body":
    "Copy this key now. The plaintext value is not returned by list or audit views.",
  "operator.managementKeys.issueFailed.title": "Management key issue failed",
  "operator.managementKeys.revoked.title": "Management key revoked",
  "operator.managementKeys.revoked.body":
    "{label} is no longer accepted by the management API.",
  "operator.managementKeys.revokeFailed.title": "Management key revoke failed",
  "operator.scopes.missing.title": "Management scopes missing",
  "operator.scopes.missing.body":
    "Add at least one scope before issuing a management key.",

  // ── Operator: clipboard and shared lab key ────────────────────────────────
  "operator.copy.noValue": "There is no key value to copy yet.",
  "operator.copy.clipboardUnavailable":
    "Clipboard access is unavailable in this browser.",
  "operator.copy.failed.title": "Copy failed",
  "operator.copy.key.title": "Key copied",
  "operator.copy.key.body": "The current verifier key is now in your clipboard.",
  "operator.copy.managementKey.title": "Management key copied",
  "operator.copy.managementKey.body":
    "The one-time plaintext management key is now in your clipboard.",
  "operator.sharedKey.cleared.title": "Shared key cleared",
  "operator.sharedKey.cleared.body":
    "The lab will no longer preload a verifier API key from browser storage.",
  "operator.sharedKey.clearedWithIssued.title": "Shared lab key cleared",
  "operator.sharedKey.clearedWithIssued.body":
    "The latest issued key still appears below for inspection, but it will no longer preload into the lab.",

  // ── Operator: management workflow results ─────────────────────────────────
  // `{subject}`, `{status}`, and `{event}` carry verifier wire values and stay
  // exactly as the backend spells them — only the sentence around them moves.
  "operator.workflow.accepted": "The management mutation was accepted.",
  "operator.workflow.queued": "{subject} is {status}; {event} was queued.",
  "operator.workflow.queuedNow": "{subject} is now {status}; {event} was queued.",
  "operator.workflow.statusSet": "{event} set {status}.",
  "operator.workflow.authorityRecorded":
    "{rootEvent} and {authorityEvent} were recorded.",
  "operator.workflow.policyHosts":
    "{subject} is {status}; required hosts: {hosts}.",
  "operator.workflow.subscriberRules":
    "{subject} is {status}; {count} subject rule(s) are approved.",
  "operator.workflow.outboxAttempts":
    "{subject} is now {status}; attempts {attempts}.",
  "operator.workflow.readOnly": "This management workflow is read-only.",
  "operator.workflow.recorded.title": "Management workflow recorded",
  "operator.workflow.failed.title": "Management workflow failed",
  "operator.evidence.partial.title": "Management evidence partially unavailable",

  // ── Operator: management workflow form chrome ─────────────────────────────
  "operator.workflow.recording": "Recording...",
  "operator.workflow.refreshEvidence": "Refresh evidence",

  // ── Operator: management workflow headings ────────────────────────────────
  // One {title, description, submit} triple per form; the audit panel is
  // read-only and has no submit label.
  "operator.workflow.authority.title": "Authority setup",
  "operator.workflow.authority.description":
    "Create or update the root program and delegated authority that issuer enrollment depends on.",
  "operator.workflow.authority.submit": "Record authority setup",
  "operator.workflow.trustKey.title": "Trust keys",
  "operator.workflow.trustKey.description":
    "Publish signer-key metadata into Postgres so NATS projections and verifiers receive the same authority state.",
  "operator.workflow.trustKey.submit": "Record trust key",
  "operator.workflow.issuerEnrollment.title": "Issuer enrollment",
  "operator.workflow.issuerEnrollment.description":
    "Create a pending issuer under the selected root and authority.",
  "operator.workflow.issuerEnrollment.submit": "Record issuer enrollment",
  "operator.workflow.issuerStatus.title": "Issuer status",
  "operator.workflow.issuerStatus.description":
    "Move an issuer between active, suspended, revoked, or expired state.",
  "operator.workflow.issuerStatus.submit": "Record issuer status",
  "operator.workflow.domainProof.title": "Domain proof",
  "operator.workflow.domainProof.description":
    "Attach verified domain-control evidence to an issuer before policy approval.",
  "operator.workflow.domainProof.submit": "Record domain proof",
  "operator.workflow.destinationPolicy.title": "Destination policy",
  "operator.workflow.destinationPolicy.description":
    "Approve exact final destinations after issuer and domain preconditions are satisfied.",
  "operator.workflow.destinationPolicy.submit": "Record destination policy",
  "operator.workflow.policyStatus.title": "Policy status",
  "operator.workflow.policyStatus.description":
    "Change an existing destination-policy lifecycle state.",
  "operator.workflow.policyStatus.submit": "Record policy status",
  "operator.workflow.natsSubscriber.title": "NATS subscriber authorization",
  "operator.workflow.natsSubscriber.description":
    "Approve a subscriber identity and the NATS subject families it can consume.",
  "operator.workflow.natsSubscriber.submit": "Authorize subscriber",
  "operator.workflow.runtimeProvider.title": "Runtime provider",
  "operator.workflow.runtimeProvider.description":
    "Register the runtime safety provider used by destination policies and verifier posture checks.",
  "operator.workflow.runtimeProvider.submit": "Record runtime provider",
  "operator.workflow.outboxRemediation.title": "Outbox remediation",
  "operator.workflow.outboxRemediation.description":
    "Retry a remediated outbox row or quarantine an unsafe row without direct SQL.",
  "operator.workflow.outboxRemediation.submit": "Record outbox remediation",
  "operator.workflow.auditReview.title": "Audit review",
  "operator.workflow.auditReview.description":
    "Review recent governance audit rows and verify the source-state mutation trail.",

  // ── Operator: management workflow field labels ────────────────────────────
  // Terse noun phrases with no sentence around them — these are the labels
  // most likely to need an `es.overrides.json` entry after translation.
  "operator.workflow.field.rootProgram": "Root program",
  "operator.workflow.field.delegatedAuthority": "Delegated authority",
  "operator.workflow.field.issuerId": "Issuer ID",
  "operator.workflow.field.rootName": "Root name",
  "operator.workflow.field.programScope": "Program scope",
  "operator.workflow.field.acceptedAlgorithms": "Accepted algorithms",
  "operator.workflow.field.authorityName": "Authority name",
  "operator.workflow.field.authorityType": "Authority type",
  "operator.workflow.field.keyId": "Key ID",
  "operator.workflow.field.scope": "Scope",
  "operator.workflow.field.signerId": "Signer ID",
  "operator.workflow.field.algorithm": "Algorithm",
  "operator.workflow.field.publicKeyRef": "Public key material ref",
  "operator.workflow.field.keyStatus": "Key status",
  "operator.workflow.field.optionalStatusEvent": "Optional status event",
  "operator.workflow.field.notBefore": "Not before",
  "operator.workflow.field.notAfter": "Not after",
  "operator.workflow.field.publicKeyPem": "Public key PEM",
  "operator.workflow.field.displayName": "Display name",
  "operator.workflow.field.issuerClass": "Issuer class",
  "operator.workflow.field.assuranceTier": "Assurance tier",
  "operator.workflow.field.status": "Status",
  "operator.workflow.field.domain": "Domain",
  "operator.workflow.field.proofMethod": "Proof method",
  "operator.workflow.field.verificationStatus": "Verification status",
  "operator.workflow.field.evidenceRef": "Evidence ref",
  "operator.workflow.field.destinationPolicyId": "Destination policy ID",
  "operator.workflow.field.usagePolicy": "Usage policy",
  "operator.workflow.field.destinationId": "Destination ID",
  "operator.workflow.field.expectedFinalUrl": "Expected final URL",
  "operator.workflow.field.allowedHosts": "Allowed hosts",
  "operator.workflow.field.pathPrefixes": "Path prefixes",
  "operator.workflow.field.queryPolicy": "Query policy",
  "operator.workflow.field.maxRedirectHops": "Max redirect hops",
  "operator.workflow.field.runtimeSafetyProvider": "Runtime safety provider",
  "operator.workflow.field.allowSubdomains": "Allow subdomains",
  "operator.workflow.field.subscriberId": "Subscriber ID",
  "operator.workflow.field.durableName": "Durable name",
  "operator.workflow.field.description": "Description",
  "operator.workflow.field.subjects": "Subjects",
  "operator.workflow.field.providerId": "Provider ID",
  "operator.workflow.field.baseUrl": "Base URL",
  "operator.workflow.field.verdictTtlSeconds": "Verdict TTL seconds",
  "operator.workflow.field.staleBehavior": "Stale behavior",
  "operator.workflow.field.unavailableBehavior": "Unavailable behavior",
  "operator.workflow.field.outboxEventId": "Outbox event ID",
  "operator.workflow.field.action": "Action",
  "operator.workflow.field.reason": "Reason",

  // ── Operator: management workflow field hints ─────────────────────────────
  "operator.workflow.hint.commaAlgorithms":
    "Comma-separated algorithm identifiers.",
  "operator.workflow.hint.publicKeyRef":
    "Use a managed reference by default; paste PEM only for local test keys.",
  "operator.workflow.hint.hostnames": "Comma- or newline-separated hostnames.",
  "operator.workflow.hint.pathPrefixes":
    "Comma-separated; leave empty for no path gate.",
  "operator.workflow.hint.subjects":
    "Comma- or newline-separated subject patterns.",
  "operator.workflow.hint.baseUrl":
    "Leave empty for the local deterministic provider.",

  // ── Lab: scan console chrome ──────────────────────────────────────────────
  "lab.workbench.eyebrow": "Capture and verify",
  "lab.workbench.title": "Scan console",
  "lab.workbench.description":
    "Upload an image or paste a payload — the result panel is the source of truth for the scan. A live camera scan is available as a secondary path for second-screen demos.",
  "lab.workbench.decoderLabel": "Decoder:",
  "lab.workbench.secureContext.title":
    "HTTPS is required for Safari camera capture",
  "lab.workbench.secureContext.body":
    "This browser is not giving the workbench a secure context for `getUserMedia`. Use the upload path, direct verify, or run the frontend with local HTTPS and a trusted mkcert certificate.",
  "lab.workbench.upload.action": "Upload and check QR",
  "lab.workbench.upload.checking": "Checking…",
  "lab.workbench.upload.note":
    "Uploaded screenshots and photos are decoded and checked automatically.",
  "lab.workbench.payload.label": "Decoded QR payload",
  "lab.workbench.payload.placeholder":
    "The decoded QR payload will appear here after upload or live capture.",
  "lab.workbench.payload.description":
    "Camera captures and uploaded images are checked automatically. Paste a payload here only when testing manually, then use Check scanned QR.",
  "lab.workbench.check.action": "Check scanned QR",
  "lab.workbench.check.checking": "Checking…",
  "lab.workbench.copyPayload": "Copy decoded payload",
  "lab.workbench.cameraPanel.show": "Try a live camera scan",
  "lab.workbench.cameraPanel.hide": "Hide live camera scan",
  "lab.workbench.cameraPanel.note":
    "Secondary path for second-screen demos: show the QR on one device and scan it here from another.",
  "lab.workbench.camera.start": "Start camera scan",
  "lab.workbench.camera.starting": "Starting…",
  "lab.workbench.camera.stop": "Stop camera",
  "lab.workbench.camera.refresh": "Refresh cameras",
  "lab.workbench.camera.refreshing": "Refreshing…",
  "lab.workbench.cameraSource.label": "Camera source",
  "lab.workbench.cameraSource.default": "Environment-facing camera",
  "lab.workbench.cameraSource.unavailable": "Camera capture unavailable",
  "lab.workbench.decoderMode.label": "Decoder mode",
  "lab.workbench.decoderMode.native":
    "Native browser decode is active. The backend fallback is available if capture moves to upload.",
  "lab.workbench.decoderMode.fallback":
    "The browser has no native QR detector, so the backend fallback will decode uploads and camera frames.",
  "lab.workbench.cameraState": "Camera capture state",
  "lab.workbench.scanStatus": "Scan status",
  "lab.workbench.secondScreen.title": "Second-screen rule",
  "lab.workbench.secondScreen.body":
    "Use the fullscreen QR on one device and the camera on another. Native phone camera apps still open the embedded URL directly and bypass verifier behavior.",

  // ── Lab: scanner preview panel ────────────────────────────────────────────
  // `{ms}` is a hold duration in milliseconds and `{index}` a 1-based trust
  // layer number — both are numbers the caller substitutes, not prose.
  "lab.scanner.preview": "Scanner preview",
  "lab.scanner.verdict.verified": "Verified QR",
  "lab.scanner.verdict.blocked": "Blocked QR",
  "lab.scanner.verdict.caution": "Use caution",
  "lab.scanner.risk.low": "Low risk",
  "lab.scanner.risk.medium": "Medium risk",
  "lab.scanner.risk.high": "High risk",
  "lab.scanner.riskStripe.label": "{level} scanner risk stripe",
  "lab.scanner.noDestination": "No destination",
  "lab.scanner.fingerprint": "Domain fingerprint",
  "lab.scanner.fingerprint.note":
    "The scanner shows a short destination identity first. The full URL stays available below, but it is not the default decision surface.",
  "lab.scanner.showFullUrl": "Show full destination URL",
  "lab.scanner.whyThisResult": "Why this result",
  "lab.scanner.trustPath": "Trust path",
  "lab.scanner.trustPath.note": "first weak layer explains result",
  "lab.scanner.layer": "Layer {index}",
  "lab.scanner.userAction": "User action",
  "lab.scanner.action.openAvailable": "Opening is available",
  "lab.scanner.action.openNotAdvised": "Opening is not advised",
  "lab.scanner.hold.required": "Requires {ms} ms hold before opening.",
  "lab.scanner.hold.notRequired": "No hold gate required for this scan.",
  "lab.scanner.hold.prompt": "Hold {ms} ms to open",
  "lab.scanner.hold.inProgress": "Keep holding…",
  "lab.scanner.openDestination": "Open destination",
  "lab.scanner.dismiss": "Dismiss result",
  "lab.scanner.technicalDetails": "Technical verifier details",
  "lab.scanner.field.decisionState": "Decision state:",
  "lab.scanner.field.verifierStage": "Verifier stage:",
  "lab.scanner.field.verifierReason": "Verifier reason:",
  "lab.scanner.field.requestId": "Request ID:",
  "lab.scanner.summary.verified":
    "The issuer and destination checks line up, so this QR can be opened from the scanner preview.",
  "lab.scanner.summary.oneTimeUsed":
    "This one-time QR appears to have already been used. Ask for a fresh QR before continuing.",
  "lab.scanner.summary.destinationMismatch":
    "The destination no longer matches the issuer-approved policy. Do not open it from this scan.",
  "lab.scanner.summary.blocked":
    "The verifier found a blocking condition. Do not open this QR from the scanner preview.",
  "lab.scanner.summary.plainUrl":
    "This is a normal link QR without a recognized trust signal. Continue only if you trust where it came from.",

  // ── Lab: verifier reason codes ────────────────────────────────────────────
  // Each pair explains one verifier reason code to a scanner user. The wire
  // codes themselves stay in English in `ScanWorkbenchSection`; only these
  // labels and details move.
  "lab.reason.captionDomainMismatch.label": "Caption mismatch",
  "lab.reason.captionDomainMismatch.detail":
    "The visible text names a different domain than the QR destination.",
  "lab.reason.destinationMismatch.label": "Destination changed",
  "lab.reason.destinationMismatch.detail":
    "The QR points outside the destination policy approved by the issuer.",
  "lab.reason.embeddedCredentials.label": "Embedded credentials",
  "lab.reason.embeddedCredentials.detail":
    "The URL includes account-like text before the host, which can hide the real destination.",
  "lab.reason.httpsAbsent.label": "No HTTPS",
  "lab.reason.httpsAbsent.detail":
    "The destination is not using HTTPS, so transport protection is absent.",
  "lab.reason.issuerUnknown.label": "Unknown issuer",
  "lab.reason.issuerUnknown.detail":
    "A signed QR was found, but this verifier does not recognize the issuer.",
  "lab.reason.knownBadDomain.label": "Known-bad domain",
  "lab.reason.knownBadDomain.detail":
    "The destination matched a local or provider-supplied bad-domain hint.",
  "lab.reason.netNewDomain.label": "New destination",
  "lab.reason.netNewDomain.detail":
    "This domain has not been seen on this device during the current demo.",
  "lab.reason.newlyRegisteredDomain.label": "New domain",
  "lab.reason.newlyRegisteredDomain.detail":
    "The destination matched a new-domain hint or a very recent domain age.",
  "lab.reason.oneTimeUsed.label": "One-time QR used",
  "lab.reason.oneTimeUsed.detail":
    "This QR appears to be a one-time code that has already been consumed.",
  "lab.reason.plainUrl.label": "Normal link",
  "lab.reason.plainUrl.detail":
    "The QR contains a plain URL without a recognized QR Trust envelope.",
  "lab.reason.redirectChain.label": "Redirect chain",
  "lab.reason.redirectChain.detail":
    "The QR uses more than one redirect hop before the final destination.",
  "lab.reason.redirectPolicyBlock.label": "Redirect policy block",
  "lab.reason.redirectPolicyBlock.detail":
    "The final redirect target is outside the issuer-approved policy.",
  "lab.reason.runtimeBlocked.label": "Runtime block",
  "lab.reason.runtimeBlocked.detail":
    "Present-time safety checks blocked this destination.",
  "lab.reason.runtimeRisky.label": "Runtime risk",
  "lab.reason.runtimeRisky.detail":
    "The issuer is recognized, but current safety checks reported risk.",
  "lab.reason.signatureInvalid.label": "Signature failed",
  "lab.reason.signatureInvalid.detail":
    "The signed QR envelope could not be verified as authentic.",
  "lab.reason.staleTrustState.label": "Stale trust state",
  "lab.reason.staleTrustState.detail":
    "The verifier cache is too old for a confident decision.",
  "lab.reason.suspiciousTld.label": "Suspicious domain ending",
  "lab.reason.suspiciousTld.detail":
    "The domain uses an ending commonly abused in QR phishing demos.",
  "lab.reason.trustCacheUnavailable.label": "Trust cache unavailable",
  "lab.reason.trustCacheUnavailable.detail":
    "The verifier could not use its local issuer trust state.",
  "lab.reason.unreadablePayload.label": "Unreadable QR",
  "lab.reason.unreadablePayload.detail":
    "The payload could not be interpreted as a URL or QR Trust envelope.",
  "lab.reason.unknown.detail":
    "This condition contributed to the scanner-visible result.",

  // ── Operator: access control chrome ───────────────────────────────────────
  "operator.access.title": "Access control",
  "operator.access.description":
    "Issue, inspect, and hand off scoped credentials without mixing them into scanning.",
  "operator.access.adminFlow.enabled": "admin flow enabled",
  "operator.access.adminFlow.disabled": "admin flow disabled",
  // `{writeScope}` and `{readScope}` are `<code>` spans holding literal scope
  // names — the placeholders move with the sentence, the scopes never change.
  "operator.access.adminDisabled.title":
    "Server-side verifier key management is disabled",
  "operator.access.adminDisabled.body":
    "This API instance was started without local bootstrap admin tokens enabled, so local token issuance is unavailable. DB-backed management keys may still issue or refresh verifier client keys when the token has {writeScope} or {readScope}.",
  "operator.access.adminDisabled.authOn":
    "Paste an existing verifier API key into the lab, or restart local compose with make up-admin.",
  "operator.access.adminDisabled.authOff":
    "Verifier auth is off, so the lab can still operate without issuing a key.",

  // ── Operator: credential fields and verifier client controls ──────────────
  "operator.access.adminToken.label": "Admin token",
  "operator.access.adminToken.placeholder": "Verifier admin token",
  // `{header}` is a `<code>` span holding the runtime's HTTP header name.
  "operator.access.adminToken.description":
    "Uses the runtime’s advertised admin header: {header}.",
  "operator.access.keyLabel.label": "New verifier key label",
  "operator.access.issueKey": "Issue verifier key",
  "operator.access.issuing": "Issuing…",
  "operator.access.refreshKeys": "Refresh key list",
  "operator.access.refreshing": "Refreshing…",
  "operator.access.copyKey": "Copy current key",
  "operator.access.copying": "Copying…",
  "operator.access.clearSharedKey": "Clear shared lab key",
  "operator.access.metric.activeKeys": "Active dynamic keys",
  "operator.access.metric.configuredAuth": "Configured auth",
  "operator.access.metric.labPreload": "Lab preload",
  "operator.value.ready": "ready",
  "operator.value.notLoaded": "not loaded",

  // ── Operator: lab handoff ─────────────────────────────────────────────────
  "operator.access.handoff.title": "Lab handoff",
  "operator.access.handoff.body":
    "The latest verifier key can be stored in browser storage so the lab route can reuse it immediately without exposing it in the URL.",
  "operator.access.handoff.staged":
    "A verifier API key is already staged for the lab. Return to /lab and keep the scan flow moving.",
  "operator.access.handoff.notStaged":
    "No verifier API key is staged for the lab yet. Issue a key or paste one into the lab manually if auth is enabled.",
  "operator.access.handoff.open": "Open lab with current browser key",
  "operator.access.handoff.stagedKey": "Staged lab key",
  "operator.access.handoff.browserOnly": "browser only",
  "operator.access.handoff.stagedKeyNote":
    "Full value stays in browser storage. Use “Copy current key” above when you need it.",

  // ── Operator: verifier key inventory ──────────────────────────────────────
  "operator.access.inventory.unavailable":
    "Dynamic key inventory is unavailable because the server is not exposing verifier key management on this runtime.",
  "operator.access.inventory.empty":
    "No dynamic keys loaded yet. Issue or refresh to populate the verifier key inventory.",
  // `{createdAt}` is a backend timestamp rendered verbatim.
  "operator.access.keyRow.source": "Postgres management · {createdAt}",

  // ── Operator: management API keys ─────────────────────────────────────────
  "operator.access.management.title": "Management API keys",
  "operator.access.management.body":
    "Issue scoped operator credentials for the management API. These keys are audited, revocable, and separate from lab verifier keys.",
  "operator.access.management.badge": "Postgres authority",
  "operator.access.management.labelField": "Management key label",
  "operator.access.management.scopesField": "Scopes",
  "operator.access.management.scopesDescription":
    "Comma-separated. Verifier client scope is intentionally rejected.",
  "operator.access.management.issue": "Issue management key",
  "operator.access.management.refresh": "Refresh management keys",
  "operator.access.management.copy": "Copy issued management key",
  "operator.access.management.inventoryEmpty":
    "No management keys loaded yet. Issue or refresh to inspect scoped operator credentials.",
  "operator.access.management.revoke": "Revoke",
  "operator.access.management.revoking": "Revoking…",
  "operator.access.plaintext.title": "One-time plaintext",
  "operator.access.plaintext.badge": "copy now",
  "operator.access.plaintext.note":
    "This value is not shown again by management-key list or audit views.",

  // ── Management plane: section chrome ──────────────────────────────────────
  "operator.management.plane": "Management plane",
  "operator.management.headline":
    "Govern the trust network from one operator surface.",
  "operator.management.lede":
    "Production-like workflows write source state to Postgres, append audit evidence, and enqueue propagation events before NATS subscribers see any update.",
  "operator.management.refresh": "Refresh management evidence",
  "operator.management.refreshing": "Refreshing…",
  "operator.management.selected": "Selected workflow",
  "operator.management.state.ready": "ready",
  "operator.management.state.planned": "planned",

  // ── Management plane: workflow registry ───────────────────────────────────
  // Each card pairs a title with a one-line description. The HTTP endpoint and
  // the Postgres/outbox record names beside them are wire vocabulary and stay
  // in English.
  "operator.management.workflow.authoritySetup.title": "Authority setup",
  "operator.management.workflow.authoritySetup.description":
    "Create the root program and delegated authority that issuer workflows depend on.",
  "operator.management.workflow.trustKeys.title": "Trust keys",
  "operator.management.workflow.trustKeys.description":
    "Manage root and delegated-authority signer keys used to verify governance events.",
  "operator.management.workflow.issuerEnrollment.title": "Issuer enrollment",
  "operator.management.workflow.issuerEnrollment.description":
    "Create a pending issuer record under an accepted root and delegated authority.",
  "operator.management.workflow.domainProof.title": "Domain proof",
  "operator.management.workflow.domainProof.description":
    "Bind issuer identity to DNS, well-known, directory, or manual-review evidence.",
  "operator.management.workflow.destinationPolicy.title": "Destination policy",
  "operator.management.workflow.destinationPolicy.description":
    "Approve exact destinations, redirect limits, and runtime-safety policy.",
  "operator.management.workflow.issuerStatus.title": "Issuer status",
  "operator.management.workflow.issuerStatus.description":
    "Suspend, revoke, expire, or reactivate issuer enrollment state.",
  "operator.management.workflow.policyStatus.title": "Policy status",
  "operator.management.workflow.policyStatus.description":
    "Suspend, revoke, expire, or reactivate destination-policy state.",
  "operator.management.workflow.runtimeProviders.title": "Runtime providers",
  "operator.management.workflow.runtimeProviders.description":
    "Register provider status, TTL, and fail behavior for runtime safety checks.",
  "operator.management.workflow.natsSubscribers.title": "NATS subscribers",
  "operator.management.workflow.natsSubscribers.description":
    "Approve subscriber identities and constrain subject families from Postgres.",
  "operator.management.workflow.outboxHealth.title": "Outbox health",
  "operator.management.workflow.outboxHealth.description":
    "Inspect pending, failed, and published governance propagation events.",
  "operator.management.workflow.auditLog.title": "Audit log",
  "operator.management.workflow.auditLog.description":
    "Review who changed governance state, when, and which outbox event followed.",

  // ── Management plane: evidence panels ─────────────────────────────────────
  "operator.management.empty.title": "No management evidence loaded",
  "operator.management.empty.body":
    "Load the current Postgres outbox and audit rows before reviewing this runtime as a production-style operator surface.",
  "operator.management.empty.action": "Load evidence",
  "operator.management.notPublished": "not published",
  // `{attempts}` is the outbox row’s retry counter.
  "operator.management.attempts": "attempts {attempts}",
  "operator.management.outbox.recent": "Recent outbox events",
  "operator.management.outbox.empty":
    "No outbox rows were returned for this management window.",
  "operator.management.audit.recent": "Recent audit rows",
  "operator.management.audit.unknownActor": "unknown actor",
  // `{key}` is an opaque idempotency key; “idem” is its short field label.
  "operator.management.audit.idempotency": "idem {key}",
  "operator.management.audit.empty":
    "No governance audit rows were returned for this management window.",
  "operator.management.providers.title": "Runtime provider registry",
  "operator.management.providers.empty":
    "No runtime providers were returned for this management window.",
  // `{seconds}` is a verdict cache lifetime; the trailing “s” is the unit.
  "operator.management.providers.ttl": "ttl {seconds}s",
  // `{stale}` and `{unavailable}` are backend behavior enums rendered verbatim.
  "operator.management.providers.behavior":
    "stale {stale}; unavailable {unavailable}",
  "operator.management.providers.local": "local provider",

  // ── Operator · runtime posture ───────────────────────────────────────────
  "operator.runtime.title": "Runtime posture",
  "operator.runtime.subtitle": "What the backend is enforcing right now.",
  "operator.runtime.refresh": "Refresh runtime",

  // Lowercase on purpose — these render inside status pills beside a metric,
  // not as sentences.
  "operator.runtime.status.healthy": "healthy",
  "operator.runtime.status.degraded": "degraded",
  "operator.runtime.status.blocked": "blocked",
  "operator.runtime.status.unavailable": "unavailable",
  "operator.value.unavailable": "unavailable",
  "operator.value.configured": "configured",
  "operator.value.notConfigured": "not configured",
  "operator.value.none": "none",

  "operator.runtime.metric.redis": "Redis",
  "operator.runtime.metric.distributedLimiter": "Distributed limiter",
  "operator.runtime.metric.decodeLimit": "Decode limit",
  "operator.runtime.metric.verifyLimit": "Verify limit",
  "operator.runtime.metric.cameraFallback": "Camera fallback",
  "operator.runtime.metric.apiKeyHeader": "API key header",
  "operator.runtime.metric.adminHeader": "Admin header",
  "operator.runtime.metric.supervisor": "Supervisor",
  "operator.runtime.metric.networkDb": "Network DB",
  "operator.runtime.metric.pending": "Pending",
  "operator.runtime.metric.published": "Published",
  "operator.runtime.metric.failed": "Failed",
  "operator.runtime.metric.quarantined": "Quarantined",
  "operator.runtime.metric.oldestLag": "Oldest lag",
  "operator.runtime.metric.persistenceState": "Persistence state",
  "operator.runtime.metric.evidenceWindow": "Evidence window",
  "operator.runtime.metric.totalDecisions": "Total decisions",
  // The three scanner-visible decision colors, in fixed order.
  "operator.runtime.metric.decisionColors": "Green / orange / red",
  "operator.runtime.metric.holdToOpen": "Hold-to-open",
  "operator.runtime.metric.highestRisk": "Highest risk",
  "operator.runtime.metric.observationState": "Observation state",
  "operator.runtime.metric.totalObservations": "Total observations",
  "operator.runtime.metric.blocked": "Blocked",
  "operator.runtime.metric.risky": "Risky",
  "operator.runtime.metric.unknown": "Unknown",

  "operator.runtime.interpretation.healthy":
    "Runtime-safety evidence is available and no active risky or blocked destination evidence is present.",
  "operator.runtime.interpretation.degraded":
    "Runtime-safety evidence exists, but an operator should review the warning before treating this as a clear scan-time signal.",
  "operator.runtime.interpretation.blocked":
    "At least one observed destination is actively blocked. Scanner decisions should surface this as a red or explicit caution state.",
  "operator.runtime.interpretation.unavailable":
    "The provider-evidence bridge cannot be read. Scanner decisions should not claim that runtime safety was evaluated.",

  "operator.runtime.outbox.eyebrow": "Network propagation",
  "operator.runtime.outbox.loading": "Loading outbox supervisor status.",
  "operator.runtime.outbox.title": "Event outbox supervisor",

  "operator.runtime.decisions.eyebrow": "Scanner decisions",
  "operator.runtime.decisions.loading": "Loading persisted decision evidence.",
  "operator.runtime.decisions.title": "Persisted scanner-visible outcomes",
  "operator.runtime.decisions.whyTitle": "Why this matters",
  "operator.runtime.decisions.whyBody":
    "This is the evidence that the scanner-visible green, orange, or red decision was persisted as a reviewable network artifact.",
  "operator.runtime.decisions.empty.eyebrow": "Decision evidence",
  "operator.runtime.decisions.empty.title":
    "No scanner decisions were found in this evidence window.",
  "operator.runtime.decisions.empty.body":
    "Generate and check a scenario from the lab to populate this panel with the latest persisted scanner-visible outcomes.",
  "operator.runtime.decisions.recent": "Recent scanner-visible outcomes",
  // `{ms}` is a hold-to-open duration; the trailing “ms” is the unit.
  "operator.runtime.decisions.hold": "hold {ms}ms",

  "operator.runtime.observations.eyebrow": "Runtime observations",
  "operator.runtime.observations.loading": "Loading provider evidence status.",
  "operator.runtime.observations.title": "Provider evidence report",
  "operator.runtime.observations.interpretation": "Operator interpretation",
  "operator.runtime.observations.empty.eyebrow": "Destination evidence",
  "operator.runtime.observations.empty.title":
    "No destination observations were found in this evidence window.",
  "operator.runtime.observations.empty.body":
    "This is expected in a fresh local environment. Once runtime providers report clear, risky, unavailable, or blocked host evidence, the highest-risk destinations will appear here.",
  "operator.runtime.observations.topHosts": "Highest-risk destinations",
  "operator.runtime.observations.providerCoverage": "Provider coverage",
  // `{time}` is an already-formatted local timestamp.
  "operator.runtime.observations.lastObserved": "Last observed {time}",
  // The four `{count}` phrases below elide the noun “observations”, so the
  // adjective must agree with it rather than with the bare number.
  "operator.runtime.observations.providerReports": "{count} reports",
  "operator.runtime.observations.providerRisky": "{count} risky",
  "operator.runtime.observations.providerBlocked": "{count} blocked",
  "operator.runtime.observations.providerUnavailable": "{count} unavailable",

  "operator.runtime.evidence.eyebrow": "Evidence focus",
  "operator.runtime.evidence.title": "Review one evidence lane at a time",
  "operator.runtime.evidence.body":
    "Scanner decisions show what users saw. Runtime observations show provider destination evidence.",
  "operator.runtime.evidence.tablist": "Operator evidence lanes",
  "operator.runtime.evidence.scanner.label": "Scanner decisions",
  "operator.runtime.evidence.scanner.body":
    "User-visible green, orange, or red outcomes persisted for review.",
  "operator.runtime.evidence.runtime.label": "Runtime observations",
  "operator.runtime.evidence.runtime.body":
    "Provider destination evidence and runtime safety observations.",

  // ── Operator · runtime posture action notes ──────────────────────────────
  "operator.runtime.note.outboxUnavailable.eyebrow": "Infrastructure check",
  "operator.runtime.note.outboxUnavailable.title":
    "Network propagation cannot be inspected",
  "operator.runtime.note.outboxUnavailable.body":
    "The operator could not read the outbox database. Keep scanner results local until the persistence path is reachable.",
  "operator.runtime.note.outboxUnavailable.action":
    "Check database connectivity",
  "operator.runtime.note.outboxQuarantined.eyebrow": "Operator action",
  "operator.runtime.note.outboxQuarantined.title":
    "Some trust events are quarantined",
  "operator.runtime.note.outboxQuarantined.body":
    "Quarantined rows are intentionally held out of NATS propagation. Review the management outbox, then retry only after the stale or malformed source event has been corrected.",
  "operator.runtime.note.outboxFailed.eyebrow": "Operator action",
  "operator.runtime.note.outboxFailed.title":
    "Some trust events failed publication",
  "operator.runtime.note.outboxFailed.body":
    "The scanner can still evaluate local verifier state, but network subscribers may not see the latest trust-state changes until failed rows are retried or repaired.",
  "operator.runtime.note.outboxPending.eyebrow": "Local stack gap",
  "operator.runtime.note.outboxPending.title":
    "Outbox worker is not publishing yet",
  "operator.runtime.note.outboxPending.body":
    "The API is writing trust events, but propagation is queued. In the local shared-infra run this usually means NATS and the outbox worker are not active.",
  "operator.runtime.note.outboxPending.action": "Then run the worker drill",
  "operator.runtime.note.outboxReady.eyebrow": "Propagation ready",
  "operator.runtime.note.outboxReady.title": "Trust events are publishable",
  "operator.runtime.note.outboxReady.body":
    "Network subscribers can receive verifier-state updates from the outbox path. Continue watching pending and failed counts during scanner tests.",
  "operator.runtime.note.outboxReady.action":
    "Run a lab scan to produce fresh events",

  "operator.runtime.note.decisionsUnavailable.eyebrow": "Persistence check",
  "operator.runtime.note.decisionsUnavailable.title":
    "Scanner decision storage is unavailable",
  "operator.runtime.note.decisionsUnavailable.body":
    "The scanner can still show a live result, but the operator cannot prove that green, orange, or red decisions were stored as reviewable evidence.",
  "operator.runtime.note.decisionsUnavailable.action":
    "Check scanner-decision database path",
  "operator.runtime.note.decisionsEmpty.eyebrow": "Evidence setup",
  "operator.runtime.note.decisionsEmpty.title":
    "No scanner-visible decisions have been recorded",
  "operator.runtime.note.decisionsEmpty.body":
    "This is expected before a lab or iPhone scan. Generate a QR, then use Check scanner decision or scan it from the iOS app to populate this evidence panel.",
  "operator.runtime.note.decisionsEmpty.action":
    "Lab -> Check scanner decision",
  "operator.runtime.note.decisionsReady.eyebrow": "Evidence ready",
  "operator.runtime.note.decisionsReady.title":
    "Scanner decisions are being persisted",
  "operator.runtime.note.decisionsReady.body":
    "The operator can review recent green, orange, and red outcomes with risk scores, hold-to-open flags, and reason codes.",
  "operator.runtime.note.decisionsReady.action": "Review recent outcomes below",

  "operator.runtime.note.observationsUnavailable.eyebrow":
    "Provider evidence check",
  "operator.runtime.note.observationsUnavailable.title":
    "Runtime-safety evidence cannot be read",
  "operator.runtime.note.observationsUnavailable.body":
    "Scanner decisions should not claim present-time destination safety until provider observations are reachable.",
  "operator.runtime.note.observationsUnavailable.action":
    "Check runtime observation storage",
  "operator.runtime.note.observationsEmpty.eyebrow": "Evidence setup",
  "operator.runtime.note.observationsEmpty.title":
    "No runtime-safety observations are in the current window",
  "operator.runtime.note.observationsEmpty.body":
    "Issuer legitimacy and destination binding can still be proven, but runtime safety remains review-needed until a provider emits destination observations.",
  "operator.runtime.note.observationsEmpty.action":
    "Emit or import provider observations",
  "operator.runtime.note.observationsBlocked.eyebrow": "Runtime block",
  "operator.runtime.note.observationsBlocked.title":
    "At least one destination is actively blocked",
  "operator.runtime.note.observationsBlocked.body":
    "Scanner-visible decisions should turn red or show explicit caution when these observations match a scanned destination.",
  "operator.runtime.note.observationsBlocked.action":
    "Review highest-risk destinations",
  "operator.runtime.note.observationsReady.eyebrow": "Runtime feed ready",
  "operator.runtime.note.observationsReady.title":
    "Destination observations are current",
  "operator.runtime.note.observationsReady.body":
    "The provider evidence feed can support scan-time safety decisions. Continue reviewing high-risk hosts and provider coverage.",
  "operator.runtime.note.observationsReady.action": "Review provider coverage",
} satisfies Record<string, string>

export type MessageKey = keyof typeof en
