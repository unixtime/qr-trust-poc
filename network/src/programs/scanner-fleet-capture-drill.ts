import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  type ScannerFleetEvidencePacket,
  type ScannerFleetEvidenceRow,
  type ScannerFleetRequiredFixtureId,
} from "../index.js"

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url))
const DEFAULT_PACKET_PATH = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/scanner-fleet-evidence-reference.json",
    import.meta.url,
  ),
)
const DEFAULT_JSON_OUTPUT = fileURLToPath(
  new URL("../../../local/scanner-fleet-capture-drill.json", import.meta.url),
)
const DEFAULT_MARKDOWN_OUTPUT = fileURLToPath(
  new URL("../../../local/scanner-fleet-capture-drill.md", import.meta.url),
)
const DEFAULT_LAB_BASE_URL = "https://127.0.0.1:8443/lab"

type UsagePolicy = "one_time" | "reusable_public"
type NonceMode = "fixed" | "timestamped"

interface LabSetup {
  readonly scenario: string
  readonly usage: UsagePolicy
  readonly nonce: NonceMode
}

interface CapturePlan {
  readonly fixtureId: ScannerFleetRequiredFixtureId
  readonly title: string
  readonly operatorGoal: string
  readonly labSetup?: LabSetup
  readonly specialSetup?: ReadonlyArray<string>
  readonly captureSteps: ReadonlyArray<string>
  readonly cautions: ReadonlyArray<string>
}

interface CaptureDrillFixture {
  readonly fixture_id: ScannerFleetRequiredFixtureId
  readonly title: string
  readonly expected_color: ScannerFleetEvidenceRow["decision_color"]
  readonly expected_state: string
  readonly reason_codes: ReadonlyArray<string>
  readonly lab_url?: string
  readonly operator_goal: string
  readonly special_setup: ReadonlyArray<string>
  readonly capture_steps: ReadonlyArray<string>
  readonly cautions: ReadonlyArray<string>
  readonly artifacts: {
    readonly screenshot: string
    readonly history_entry: string
    readonly accessibility_trace: string
  }
}

interface CaptureDrill {
  readonly artifact_type: "scanner_fleet_capture_drill"
  readonly schema_version: "2026-05-22"
  readonly generated_at: string
  readonly packet_id: string
  readonly packet_path: string
  readonly lab_base_url: string
  readonly output_markdown: string
  readonly fixtures: ReadonlyArray<CaptureDrillFixture>
  readonly global_cautions: ReadonlyArray<string>
}

const CAPTURE_PLANS = {
  green_reusable_public: {
    fixtureId: "green_reusable_public",
    title: "Reusable public QR remains accepted",
    operatorGoal:
      "Prove a printed or shared QR can remain green when issuer legitimacy, destination binding, runtime safety, and reusable policy all pass.",
    labSetup: {
      scenario: "valid",
      usage: "reusable_public",
      nonce: "timestamped",
    },
    captureSteps: [
      "Open the lab URL and generate the QR.",
      "Scan the QR with the iPhone app.",
      "Capture the green result screen and matching History tab entry.",
      "Scan the same QR again if you need to demonstrate reusable-public behavior; it should remain green.",
    ],
    cautions: [
      "Do not use one-time policy for printed or shared QR evidence.",
      "Do not click the browser lab scanner-decision action before the phone scan.",
    ],
  },
  green_one_time_first_pass: {
    fixtureId: "green_one_time_first_pass",
    title: "One-time QR first pass is accepted",
    operatorGoal:
      "Capture the positive control for login, payment, or ticket-style QR where a nonce should be consumed once.",
    labSetup: {
      scenario: "valid",
      usage: "one_time",
      nonce: "fixed",
    },
    captureSteps: [
      "Open the lab URL and generate the QR once.",
      "Scan the QR with the iPhone app and capture the green first-pass result.",
      "Keep the same browser QR visible for the replay fixture; do not regenerate it.",
    ],
    cautions: [
      "This fixture must be captured immediately before red_one_time_replay.",
      "Any browser-side scanner-decision call can consume the one-time state before the phone scan.",
    ],
  },
  red_one_time_replay: {
    fixtureId: "red_one_time_replay",
    title: "One-time QR second scan is blocked",
    operatorGoal:
      "Show that a one-time QR is not safe to reuse even when the QR content still looks well formed.",
    specialSetup: [
      "Reuse the exact QR generated for green_one_time_first_pass.",
      "Do not refresh, regenerate, or change nonce mode before the second scan.",
    ],
    captureSteps: [
      "Scan the same QR from green_one_time_first_pass a second time.",
      "Capture the red result screen and matching History tab entry.",
    ],
    cautions: [
      "Do not create a new QR for this fixture.",
      "Do not open the destination from a red replay result.",
    ],
  },
  red_expired_qr: {
    fixtureId: "red_expired_qr",
    title: "Expired QR is blocked",
    operatorGoal:
      "Prove the scanner enforces QR validity windows instead of treating signed or recognized QR content as always current.",
    labSetup: {
      scenario: "expired",
      usage: "reusable_public",
      nonce: "fixed",
    },
    captureSteps: [
      "Open the lab URL and generate the expired QR.",
      "Scan the QR with the iPhone app.",
      "Capture the red result screen and matching History tab entry.",
    ],
    cautions: ["Do not substitute profile staleness for QR expiration."],
  },
  red_destination_mismatch: {
    fixtureId: "red_destination_mismatch",
    title: "Payload destination mismatch is blocked",
    operatorGoal:
      "Show destination binding is policy enforcement, not merely successful decoding or signature validation.",
    labSetup: {
      scenario: "payload-mismatch",
      usage: "reusable_public",
      nonce: "timestamped",
    },
    captureSteps: [
      "Open the lab URL and generate the mismatch QR.",
      "Scan the QR with the iPhone app.",
      "Capture the red result screen and matching History tab entry.",
    ],
    cautions: [
      "The expected failure is destination policy mismatch, not generic invalid JSON.",
    ],
  },
  red_resolver_final_target_mismatch: {
    fixtureId: "red_resolver_final_target_mismatch",
    title: "Resolver final target mismatch is blocked",
    operatorGoal:
      "Prove short-link or resolver flows are evaluated as a destination chain, not as a single trusted-looking URL.",
    labSetup: {
      scenario: "redirect-final-mismatch",
      usage: "reusable_public",
      nonce: "timestamped",
    },
    captureSteps: [
      "Open the lab URL and generate the resolver mismatch QR.",
      "Scan the QR with the iPhone app.",
      "Capture the red result screen, History tab entry, and decision path showing the final-target mismatch.",
    ],
    cautions: [
      "The visible resolver can be recognized while the final target is still outside approved policy.",
    ],
  },
  orange_plain_url_unrecognized: {
    fixtureId: "orange_plain_url_unrecognized",
    title: "Plain URL QR is caution, not green trust",
    operatorGoal:
      "Show the scanner can handle ordinary QR codes without falsely claiming managed trust.",
    specialSetup: [
      "Use a QR generated outside QR Trust, such as https://en.m.wikipedia.org/ or http://fr.wikipedia.org/.",
    ],
    captureSteps: [
      "Display or print the external plain URL QR.",
      "Scan it with the iPhone app.",
      "Capture the orange result screen and matching History tab entry.",
    ],
    cautions: [
      "Plain URL QR codes should not be treated as red solely because they are outside this trust network.",
      "Do not use a QR Trust lab fixture for this evidence row.",
    ],
  },
  orange_verifier_unavailable_visible_destination: {
    fixtureId: "orange_verifier_unavailable_visible_destination",
    title: "Verifier unavailable falls back to visible caution",
    operatorGoal:
      "Show the scanner preserves user agency when the destination is readable but the protection service cannot be reached.",
    labSetup: {
      scenario: "valid",
      usage: "reusable_public",
      nonce: "timestamped",
    },
    specialSetup: [
      "Generate the QR while the verifier is reachable.",
      "Before scanning with the phone, make the provider unreachable or point the app profile to an unreachable provider.",
    ],
    captureSteps: [
      "Scan the previously generated QR with the iPhone app while the provider is unreachable.",
      "Capture the orange result screen with visible destination and the matching History tab entry.",
    ],
    cautions: [
      "Do not capture this as a red block; the destination is visible but unverified.",
      "Do not open the destination before capturing evidence.",
    ],
  },
  orange_stale_verifier_profile: {
    fixtureId: "orange_stale_verifier_profile",
    title: "Stale verifier profile warns before trust",
    operatorGoal:
      "Prove scanner-side provider-profile freshness is checked separately from issuer and destination policy.",
    labSetup: {
      scenario: "valid",
      usage: "reusable_public",
      nonce: "timestamped",
    },
    specialSetup: [
      "Run the provider with VERIFIER_PROVIDER_PROFILE_STATE=stale, then open iOS Settings and tap Refresh provider profile.",
      "Scan a QR Trust URL-bearing fixture after the stale profile is installed in app state.",
    ],
    captureSteps: [
      "Generate the valid reusable QR from the lab URL.",
      "Scan it with the stale provider profile installed in app state.",
      "Capture the orange profile-stale result and matching History tab entry.",
    ],
    cautions: [
      "Do not substitute the browser lab stale-cache scenario; that tests cached issuer state, not verifier-profile distribution.",
    ],
  },
  red_revoked_verifier_profile: {
    fixtureId: "red_revoked_verifier_profile",
    title: "Revoked verifier profile blocks trust",
    operatorGoal:
      "Prove scanner-side provider-profile revocation can stop a deployed app from making stale trust claims.",
    labSetup: {
      scenario: "valid",
      usage: "reusable_public",
      nonce: "timestamped",
    },
    specialSetup: [
      "Run the provider with VERIFIER_PROVIDER_PROFILE_STATE=revoked, then open iOS Settings and tap Refresh provider profile.",
      "Scan a QR Trust URL-bearing fixture after the revoked profile is installed in app state.",
    ],
    captureSteps: [
      "Generate the valid reusable QR from the lab URL.",
      "Scan it with the revoked provider profile installed in app state.",
      "Capture the red profile-revoked result and matching History tab entry.",
    ],
    cautions: [
      "Do not substitute the browser lab revoked scenario; issuer-certificate revocation and verifier-profile revocation are separate controls.",
    ],
  },
} satisfies Record<ScannerFleetRequiredFixtureId, CapturePlan>

const packetPath = process.env.QRTRUST_SCANNER_FLEET_EVIDENCE_PACKET
  ? resolve(process.cwd(), process.env.QRTRUST_SCANNER_FLEET_EVIDENCE_PACKET)
  : DEFAULT_PACKET_PATH
const jsonOutputPath = process.env.QRTRUST_SCANNER_FLEET_CAPTURE_DRILL_JSON
  ? resolve(process.cwd(), process.env.QRTRUST_SCANNER_FLEET_CAPTURE_DRILL_JSON)
  : DEFAULT_JSON_OUTPUT
const markdownOutputPath = process.env.QRTRUST_SCANNER_FLEET_CAPTURE_DRILL_MD
  ? resolve(
      process.cwd(),
      process.env.QRTRUST_SCANNER_FLEET_CAPTURE_DRILL_MD,
    )
  : DEFAULT_MARKDOWN_OUTPUT
const labBaseUrl =
  process.env.QRTRUST_SCANNER_LAB_BASE_URL ?? DEFAULT_LAB_BASE_URL

const packet = readJson<ScannerFleetEvidencePacket>(packetPath)
const drill = makeCaptureDrill({
  packet,
  packetPath,
  labBaseUrl,
  jsonOutputPath,
  markdownOutputPath,
})

writeFile(jsonOutputPath, `${JSON.stringify(drill, null, 2)}\n`)
writeFile(markdownOutputPath, renderMarkdown(drill))

console.log(
  JSON.stringify(
    {
      status: "written",
      packet: drill.packet_id,
      fixtures: drill.fixtures.length,
      json: jsonOutputPath,
      markdown: markdownOutputPath,
    },
    null,
    2,
  ),
)

interface CaptureDrillConfig {
  readonly packet: ScannerFleetEvidencePacket
  readonly packetPath: string
  readonly labBaseUrl: string
  readonly jsonOutputPath: string
  readonly markdownOutputPath: string
}

function makeCaptureDrill(config: CaptureDrillConfig): CaptureDrill {
  const rowsByFixture = new Map(
    config.packet.evidence_rows.map((row) => [row.fixture_id, row]),
  )
  const fixtures = config.packet.fixture_matrix.map((fixture) => {
    const fixtureId = fixture.fixture_id as ScannerFleetRequiredFixtureId
    const plan: CapturePlan | undefined = CAPTURE_PLANS[fixtureId]
    const row = rowsByFixture.get(fixture.fixture_id)

    if (plan === undefined) {
      throw new Error(`Missing capture plan for fixture: ${fixture.fixture_id}`)
    }
    if (row === undefined) {
      throw new Error(
        `Missing evidence row for capture fixture: ${fixture.fixture_id}`,
      )
    }
    if (row.decision_color !== fixture.expected_color) {
      throw new Error(
        `Fixture ${fixture.fixture_id} color mismatch between matrix and row`,
      )
    }
    if (row.decision_state !== fixture.expected_state) {
      throw new Error(
        `Fixture ${fixture.fixture_id} state mismatch between matrix and row`,
      )
    }

    return {
      fixture_id: plan.fixtureId,
      title: plan.title,
      expected_color: row.decision_color,
      expected_state: row.decision_state,
      reason_codes: row.reason_codes,
      ...(plan.labSetup
        ? { lab_url: makeLabUrl(config.labBaseUrl, plan.labSetup) }
        : {}),
      operator_goal: plan.operatorGoal,
      special_setup: plan.specialSetup ?? [],
      capture_steps: plan.captureSteps,
      cautions: plan.cautions,
      artifacts: {
        screenshot: row.screenshot_ref,
        history_entry: row.history_entry_ref,
        accessibility_trace: row.accessibility_ref,
      },
    } satisfies CaptureDrillFixture
  })

  assertAllPlansUsed(fixtures)

  return {
    artifact_type: "scanner_fleet_capture_drill",
    schema_version: "2026-05-22",
    generated_at: new Date().toISOString(),
    packet_id: config.packet.packet_id,
    packet_path: repoPath(config.packetPath),
    lab_base_url: config.labBaseUrl,
    output_markdown: repoPath(config.markdownOutputPath),
    fixtures,
    global_cautions: [
      "Capture result screenshots, History tab screenshots, and accessibility traces as one set for each fixture.",
      "Do not click the browser lab's scanner-decision action before the phone scan; one-time QR state can be consumed by the browser.",
      "One-time replay evidence must reuse the exact first-pass QR.",
      "Reusable-public evidence should remain green on repeat scans until issuer, destination, runtime, or provider-profile state changes.",
      "Orange outcomes may offer an open-with-caution path, but evidence should show the destination was not opened silently.",
      "Red outcomes must not be opened.",
    ],
  }
}

function makeLabUrl(baseUrl: string, setup: LabSetup): string {
  const url = new URL(baseUrl)
  url.searchParams.set("scenario", setup.scenario)
  url.searchParams.set("usage", setup.usage)
  url.searchParams.set("nonce", setup.nonce)
  url.searchParams.set("autogenerate", "1")
  return url.toString()
}

function assertAllPlansUsed(
  fixtures: ReadonlyArray<CaptureDrillFixture>,
): void {
  const fixtureIds = new Set(fixtures.map((fixture) => fixture.fixture_id))
  for (const fixtureId of Object.keys(CAPTURE_PLANS)) {
    if (!fixtureIds.has(fixtureId as ScannerFleetRequiredFixtureId)) {
      throw new Error(`Capture drill did not include fixture: ${fixtureId}`)
    }
  }
}

function renderMarkdown(drill: CaptureDrill): string {
  const lines = [
    "# Scanner Fleet Capture Drill",
    "",
    "This local drill converts the scanner-fleet evidence packet into exact browser-lab setup links, native-app capture steps, and artifact filenames.",
    "",
    "It is written under `local/` and should not be tracked.",
    "",
    "## Inputs",
    "",
    `- Packet: \`${drill.packet_path}\``,
    `- Packet ID: \`${drill.packet_id}\``,
    `- Lab base URL: \`${drill.lab_base_url}\``,
    "",
    "Set `QRTRUST_SCANNER_LAB_BASE_URL` if your browser lab is not on the default local URL.",
    "",
    "```bash",
    "QRTRUST_SCANNER_LAB_BASE_URL=https://<mac-lan-ip>:8443/lab make scanner-fleet-capture-drill",
    "```",
    "",
    "## Global Capture Rules",
    "",
    ...drill.global_cautions.map((caution) => `- ${caution}`),
    "",
    "## Fixture Drill",
    "",
  ]

  for (const fixture of drill.fixtures) {
    lines.push(
      `### ${fixture.fixture_id}`,
      "",
      `**Goal:** ${fixture.operator_goal}`,
      "",
      `- Expected color: \`${fixture.expected_color}\``,
      `- Expected state: \`${fixture.expected_state}\``,
      `- Reason codes: ${fixture.reason_codes.map((code) => `\`${code}\``).join(", ")}`,
    )

    if (fixture.lab_url) {
      lines.push(`- Browser lab URL: ${fixture.lab_url}`)
    }

    if (fixture.special_setup.length > 0) {
      lines.push("", "Special setup:")
      lines.push(...fixture.special_setup.map((step) => `- ${step}`))
    }

    lines.push("", "Capture steps:")
    lines.push(
      ...fixture.capture_steps.map((step, index) => `${index + 1}. ${step}`),
    )

    if (fixture.cautions.length > 0) {
      lines.push("", "Cautions:")
      lines.push(...fixture.cautions.map((caution) => `- ${caution}`))
    }

    lines.push(
      "",
      "Required artifacts:",
      "",
      `- Result screenshot: \`${fixture.artifacts.screenshot}\``,
      `- History screenshot: \`${fixture.artifacts.history_entry}\``,
      `- Accessibility trace: \`${fixture.artifacts.accessibility_trace}\``,
      "",
    )
  }

  lines.push(
    "## Import And Validate",
    "",
    "```bash",
    "make import-iphone-evidence IPHONE_EVIDENCE_SOURCE_DIR=local/iphone-evidence-packet/incoming",
    "make iphone-evidence-status",
    "make check-iphone-evidence",
    "make network-deployed-scanner-readiness-report",
    "```",
    "",
  )

  return `${lines.join("\n")}\n`
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function repoPath(path: string): string {
  return relative(REPO_ROOT, path)
}
