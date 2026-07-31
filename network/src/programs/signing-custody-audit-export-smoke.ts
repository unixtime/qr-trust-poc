import { Console, Effect } from "effect"

import {
  assertSigningCustodyAuditExport,
  makeSigningCustodyAuditExport,
  renderSigningCustodyAuditJsonl,
  type SigningCustodyAuditEntry,
  type SigningCustodyAuditExport,
} from "../index.js"

const program = Effect.gen(function* () {
  const exportArtifact = makeReferenceAuditExport()
  assertSigningCustodyAuditExport(exportArtifact)

  const jsonl = renderSigningCustodyAuditJsonl(exportArtifact)
  const jsonlLines = jsonl.split("\n")

  yield* assertSmoke(
    exportArtifact.artifact_type === "signing_custody_audit_export",
    "artifact type should be stable",
  )
  yield* assertSmoke(
    exportArtifact.redaction_status === "public_safe",
    "audit export should be marked public safe",
  )
  yield* assertSmoke(
    exportArtifact.summary.entry_count === exportArtifact.entries.length,
    "summary should count entries",
  )
  yield* assertSmoke(
    exportArtifact.summary.published === 1
      && exportArtifact.summary.rejected === 1,
    "summary should count publication outcomes",
  )
  yield* assertSmoke(
    exportArtifact.summary.provider_refs.length === 2,
    "summary should expose managed provider refs without secrets",
  )
  yield* assertSmoke(
    jsonlLines.length === exportArtifact.entries.length,
    "JSONL should render one line per audit entry",
  )
  yield* assertSmoke(
    jsonlLines.every((line) => JSON.parse(line).audit_event_id),
    "JSONL lines should be parseable audit entries",
  )
  yield* assertSmoke(
    !jsonl.includes("BEGIN PRIVATE KEY") && !jsonl.includes("pem://"),
    "audit JSONL should not expose private key material",
  )
  yield* assertSmoke(
    throwsFixtureMaterialRef(),
    "audit export should reject fixture/private material refs",
  )
  yield* assertSmoke(
    throwsPrivateMaterialLeak(),
    "audit export should reject private material leak markers",
  )
  yield* assertSmoke(
    throwsSummaryMismatch(),
    "audit export should reject mismatched summary counts",
  )
  yield* assertSmoke(
    throwsDuplicateAuditEvent(),
    "audit export should reject duplicate audit event IDs",
  )

  yield* Console.log(
    JSON.stringify(
      {
        signing_custody_audit_export_smoke: "passed",
        export_id: exportArtifact.export_id,
        entries: exportArtifact.entries.length,
        provider_refs: exportArtifact.summary.provider_refs.length,
        rejected: exportArtifact.summary.rejected,
      },
      null,
      2,
    ),
  )
})

const makeReferenceAuditExport = (): SigningCustodyAuditExport =>
  makeSigningCustodyAuditExport({
    exportId: "signing-custody-audit:reference:2026-05-21",
    generatedAt: "2026-05-21T00:00:00.000Z",
    scope: {
      root_program_id: "root:qrtrust-demo:2026",
      delegated_authority_id: "authority:qrtrust-demo:merchant-web",
    },
    entries: [
      makeAuditEntry({
        audit_event_id: "audit:signing-custody:issuer-record:001",
        artifact_id: "issuer-record:acme-demo:v1",
        artifact_type: "issuer_record",
        artifact_hash: `sha256:${"a".repeat(64)}`,
        custody_provider_ref:
          "kms://qrtrust-reference/us-west-1/authority/merchant-web",
        provider_audit_id: "kms-audit-issuer-record-001",
        publication_result: "published",
      }),
      makeAuditEntry({
        audit_event_id: "audit:signing-custody:destination-policy:002",
        artifact_id: "destination-policy:acme-demo:v2",
        artifact_type: "destination_policy",
        artifact_hash: `sha256:${"b".repeat(64)}`,
        custody_provider_ref:
          "hsm://qrtrust-reference/partition-a/authority/merchant-web",
        provider_audit_id: "hsm-audit-destination-policy-002",
        publication_result: "rejected",
        reason_codes: ["local_signature_verification_failed"],
      }),
    ],
  })

const makeAuditEntry = (
  overrides: Partial<SigningCustodyAuditEntry>,
): SigningCustodyAuditEntry => ({
  audit_event_id: "audit:signing-custody:default",
  artifact_id: "artifact:default",
  artifact_type: "issuer_record",
  artifact_version: 1,
  artifact_hash: `sha256:${"c".repeat(64)}`,
  root_program_id: "root:qrtrust-demo:2026",
  delegated_authority_id: "authority:qrtrust-demo:merchant-web",
  issuer_id: "issuer:acme-demo",
  signer_id: "signer:authority:qrtrust-demo:merchant-web",
  key_id: "key:authority:qrtrust-demo:merchant-web:ed25519:managed",
  algorithm_id: "ed25519",
  custody_provider_ref:
    "managed://qrtrust-reference/authority/merchant-web/default",
  provider_audit_id: "provider-audit-default",
  automation_identity: "artifact-publication-worker/reference",
  requested_at: "2026-05-21T00:00:00.000Z",
  publication_result: "published",
  ...overrides,
})

const throwsFixtureMaterialRef = (): boolean => {
  try {
    makeSigningCustodyAuditExport({
      exportId: "signing-custody-audit:bad-fixture",
      generatedAt: "2026-05-21T00:00:00.000Z",
      scope: {
        root_program_id: "root:qrtrust-demo:2026",
      },
      entries: [
        makeAuditEntry({
          custody_provider_ref:
            "pem://fixture/private/authority/qrtrust-demo-merchant-web",
        }),
      ],
    })
    return false
  } catch (error) {
    return isExpectedError(error, "managed custody provider refs")
  }
}

const throwsPrivateMaterialLeak = (): boolean => {
  try {
    makeSigningCustodyAuditExport({
      exportId: "signing-custody-audit:bad-private-material",
      generatedAt: "2026-05-21T00:00:00.000Z",
      scope: {
        root_program_id: "root:qrtrust-demo:2026",
      },
      entries: [
        makeAuditEntry({
          provider_audit_id: "-----BEGIN PRIVATE KEY-----",
        }),
      ],
    })
    return false
  } catch (error) {
    return isExpectedError(error, "private material marker")
  }
}

const throwsSummaryMismatch = (): boolean => {
  const exportArtifact = makeReferenceAuditExport()
  try {
    assertSigningCustodyAuditExport({
      ...exportArtifact,
      summary: {
        ...exportArtifact.summary,
        rejected: 0,
      },
    })
    return false
  } catch (error) {
    return isExpectedError(error, "summary rejected")
  }
}

const throwsDuplicateAuditEvent = (): boolean => {
  const entry = makeAuditEntry({
    audit_event_id: "audit:signing-custody:duplicate",
  })
  try {
    makeSigningCustodyAuditExport({
      exportId: "signing-custody-audit:bad-duplicate",
      generatedAt: "2026-05-21T00:00:00.000Z",
      scope: {
        root_program_id: "root:qrtrust-demo:2026",
      },
      entries: [entry, entry],
    })
    return false
  } catch (error) {
    return isExpectedError(error, "duplicates event")
  }
}

const assertSmoke = (
  condition: boolean,
  message: string,
): Effect.Effect<void, Error> =>
  condition ? Effect.void : Effect.fail(new Error(message))

const isExpectedError = (error: unknown, expectedMessage: string): boolean =>
  error instanceof Error && error.message.includes(expectedMessage)

Effect.runPromise(program).catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
