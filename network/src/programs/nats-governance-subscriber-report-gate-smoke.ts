import { Effect } from "effect"

import {
  processNatsGovernanceMessage,
  type NatsGovernanceMessageShape,
  type VerifierSyncReport,
} from "../index.js"

const envelope = {
  event_id: "evt_governance_subscriber_report_gate_smoke",
  type: "destination.policy.published",
  occurred_at: "2026-05-25T00:00:00Z",
  root_program_id: "root:qrtrust-demo:2026",
  delegated_authority_id: "authority:qrtrust-demo:merchant-web",
  issuer_id: "issuer:acme-demo",
  destination_policy_id: "policy:acme-demo:web-payments:v1",
  artifact_id: "artifact:governance-subscriber-report-gate-smoke",
  artifact_hash: "sha256:report-gate-smoke",
  version: 1,
}

const missingArtifact = makeMessage(JSON.stringify({ envelope }))
const missingArtifactResult = await processNatsGovernanceMessage(
  missingArtifact.message,
  {
    syncReference: () =>
      Effect.succeed({
        ...baseReport(),
        processed_events: 1,
        missing_artifacts: [envelope.artifact_id],
      }),
  },
)

assertSmoke(
  missingArtifactResult.status === "sync_rejected",
  "missing artifact report was not rejected",
)
assertSmoke(missingArtifact.acks === 0, "missing artifact report was acked")
assertSmoke(missingArtifact.naks === 0, "missing artifact report was nacked")
assertSmoke(
  missingArtifact.terms === 1,
  "missing artifact report was not terminated",
)

const hashMismatch = makeMessage(JSON.stringify({ envelope }))
const hashMismatchResult = await processNatsGovernanceMessage(
  hashMismatch.message,
  {
    syncReference: () =>
      Effect.succeed({
        ...baseReport(),
        processed_events: 1,
        fetched_artifacts: 1,
        artifact_hash_mismatches: [envelope.artifact_id],
      }),
  },
)

assertSmoke(
  hashMismatchResult.status === "sync_rejected",
  "artifact hash mismatch report was not rejected",
)
assertSmoke(hashMismatch.acks === 0, "artifact hash mismatch report was acked")
assertSmoke(hashMismatch.naks === 0, "artifact hash mismatch report was nacked")
assertSmoke(
  hashMismatch.terms === 1,
  "artifact hash mismatch report was not terminated",
)

const rejectedSignature = makeMessage(JSON.stringify({ envelope }))
const rejectedSignatureResult = await processNatsGovernanceMessage(
  rejectedSignature.message,
  {
    syncReference: () =>
      Effect.succeed({
        ...baseReport(),
        processed_events: 1,
        fetched_artifacts: 1,
        rejected_status_events: [`${envelope.artifact_id}:signature_rejected`],
      }),
  },
)

assertSmoke(
  rejectedSignatureResult.status === "sync_rejected",
  "rejected status/signature report was not rejected",
)
assertSmoke(rejectedSignature.acks === 0, "rejected status/signature report was acked")
assertSmoke(
  rejectedSignature.naks === 0,
  "rejected status/signature report was nacked",
)
assertSmoke(
  rejectedSignature.terms === 1,
  "rejected status/signature report was not terminated",
)

const noMutation = makeMessage(JSON.stringify({ envelope }))
const noMutationResult = await processNatsGovernanceMessage(noMutation.message, {
  syncReference: () =>
    Effect.succeed({
      ...baseReport(),
      processed_events: 1,
      fetched_artifacts: 1,
    }),
})

assertSmoke(
  noMutationResult.status === "sync_rejected",
  "cache-materializing governance report without mutation was not rejected",
)
assertSmoke(noMutation.acks === 0, "no-mutation report was acked")
assertSmoke(noMutation.naks === 0, "no-mutation report was nacked")
assertSmoke(noMutation.terms === 1, "no-mutation report was not terminated")

const materialized = makeMessage(JSON.stringify({ envelope }))
const materializedResult = await processNatsGovernanceMessage(
  materialized.message,
  {
    syncReference: () =>
      Effect.succeed({
        ...baseReport(),
        processed_events: 1,
        fetched_artifacts: 1,
        validated_trust_artifacts: 1,
        projected_destination_policies: 1,
      }),
  },
)

assertSmoke(
  materializedResult.status === "synced",
  "materialized governance report was not accepted",
)
assertSmoke(materialized.acks === 1, "materialized report was not acked")
assertSmoke(materialized.naks === 0, "materialized report was nacked")

const certificateStatusEnvelope = {
  ...envelope,
  event_id: "evt_governance_subscriber_certificate_status_report_gate_smoke",
  type: "certificate.status.changed",
  artifact_id: "artifact:governance-subscriber-certificate-status-report-gate-smoke",
  artifact_hash: "sha256:certificate-status-report-gate-smoke",
}
const materializedCertificateStatus = makeMessage(
  JSON.stringify({ envelope: certificateStatusEnvelope }),
)
const materializedCertificateStatusResult = await processNatsGovernanceMessage(
  materializedCertificateStatus.message,
  {
    syncReference: () =>
      Effect.succeed({
        ...baseReport(),
        processed_events: 1,
        fetched_artifacts: 1,
        validated_trust_artifacts: 1,
        applied_status_events: 1,
      }),
  },
)

assertSmoke(
  materializedCertificateStatusResult.status === "synced",
  "materialized certificate status report was not accepted",
)
assertSmoke(
  materializedCertificateStatus.acks === 1,
  "materialized certificate status report was not acked",
)
assertSmoke(
  materializedCertificateStatus.naks === 0,
  "materialized certificate status report was nacked",
)

console.log(
  JSON.stringify(
      {
        nats_governance_subscriber_report_gate_smoke: "passed",
        missing_artifact: missingArtifactResult.status,
        artifact_hash_mismatch: hashMismatchResult.status,
        rejected_status_event: rejectedSignatureResult.status,
        no_mutation: noMutationResult.status,
        materialized: materializedResult.status,
        materialized_certificate_status:
          materializedCertificateStatusResult.status,
      },
    null,
    2,
  ),
)

function baseReport(): VerifierSyncReport {
  return {
    processed_events: 0,
    fetched_artifacts: 0,
    validated_trust_artifacts: 0,
    projected_issuers: 0,
    projected_destination_policies: 0,
    applied_status_events: 0,
    applied_key_status_events: 0,
    missing_artifacts: [],
    artifact_hash_mismatches: [],
    rejected_status_events: [],
  }
}

function makeMessage(payload: string): {
  readonly message: NatsGovernanceMessageShape
  readonly acks: number
  readonly naks: number
  readonly terms: number
} {
  let acks = 0
  let naks = 0
  let terms = 0

  return {
    message: {
      data: new TextEncoder().encode(payload),
      ack: () => {
        acks += 1
      },
      nak: () => {
        naks += 1
      },
      term: () => {
        terms += 1
      },
    },
    get acks() {
      return acks
    },
    get naks() {
      return naks
    },
    get terms() {
      return terms
    },
  }
}

function assertSmoke(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`NATS governance subscriber report gate smoke failed: ${message}`)
  }
}
