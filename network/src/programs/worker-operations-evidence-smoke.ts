import { Console, Effect } from "effect"

import {
  WORKER_OPERATIONS_REQUIRED_COMPONENTS,
  WORKER_OPERATIONS_REQUIRED_SIGNALS,
  assertWorkerOperationsEvidencePacket,
  collectWorkerOperationsEvidenceRefs,
  makeWorkerOperationsEvidencePacket,
  type WorkerOperationsComponent,
  type WorkerOperationsEvidencePacket,
  type WorkerOperationsReplayRecoveryDrill,
  type WorkerOperationsSignalEvidence,
} from "../index.js"

const program = Effect.gen(function* () {
  const packet = makeReferencePacket()
  assertWorkerOperationsEvidencePacket(packet)
  const refs = collectWorkerOperationsEvidenceRefs(packet)

  yield* assertSmoke(
    packet.artifact_type === "worker_operations_evidence_packet",
    "artifact type should be stable",
  )
  yield* assertSmoke(
    packet.components.map((component) => component.component_id).join(",")
      === WORKER_OPERATIONS_REQUIRED_COMPONENTS.join(","),
    "packet should use canonical worker component order",
  )
  yield* assertSmoke(
    packet.monitoring.signals.map((signal) => signal.signal_id).join(",")
      === WORKER_OPERATIONS_REQUIRED_SIGNALS.join(","),
    "packet should use canonical monitoring signal order",
  )
  yield* assertSmoke(
    packet.components.every(
      (component) => component.operational_status === "reference_ready",
    ),
    "reference packet should keep workers reference-ready",
  )
  yield* assertSmoke(
    refs.every((ref) => ref.startsWith("docs/public/") || ref.startsWith("npm run ")),
    "evidence refs should be public docs or npm smoke commands",
  )
  yield* assertSmoke(
    throwsMissingComponent(),
    "packet should fail closed when a required worker component is missing",
  )
  yield* assertSmoke(
    throwsWrongBoundary(),
    "packet should fail closed when a worker claims the wrong authority boundary",
  )
  yield* assertSmoke(
    throwsBlockedReferenceWorker(),
    "reference drill should fail closed on blocked workers",
  )
  yield* assertSmoke(
    throwsProductionCandidateWithoutProductionWorkers(),
    "production candidates should require production-ready workers",
  )
  yield* assertSmoke(
    throwsMissingDrill(),
    "packet should fail closed when a component lacks replay/recovery evidence",
  )
  yield* assertSmoke(
    throwsUnsafeEvidenceRef(),
    "packet should fail closed when evidence refs leave public repo paths",
  )
  yield* assertSmoke(
    throwsMissingMonitoring(),
    "packet should fail closed when monitoring thresholds are missing",
  )
  yield* assertSmoke(
    throwsMissingMonitoringSignal(),
    "packet should fail closed when a monitoring signal is missing",
  )
  yield* assertSmoke(
    throwsWrongSignalComponent(),
    "packet should fail closed when a signal is bound to the wrong component",
  )
  yield* assertSmoke(
    throwsUnsafeSignalAlertRef(),
    "packet should fail closed when alert refs leave public repo paths",
  )
  yield* assertSmoke(
    throwsPrivateMaterial(),
    "packet should fail closed when private material markers appear",
  )
  yield* assertSmoke(
    throwsMalformedReviewerReviewDate(),
    "packet should fail closed when reviewer review date is malformed",
  )

  yield* Console.log(
    JSON.stringify(
      {
        status: "ok",
        packet_id: packet.packet_id,
        components: packet.components.length,
        replay_recovery_drills: packet.replay_recovery_drills.length,
        refs: refs.length,
      },
      null,
      2,
    ),
  )
})

const makeReferencePacket = (
  overrides: Partial<{
    claimMode: "reference_drill" | "production_candidate"
    components: ReadonlyArray<WorkerOperationsComponent>
    replayRecoveryDrills: ReadonlyArray<WorkerOperationsReplayRecoveryDrill>
    monitoringThreshold: number
    monitoringSignals: ReadonlyArray<WorkerOperationsSignalEvidence>
    reviewer: WorkerOperationsEvidencePacket["reviewer"]
  }> = {},
): WorkerOperationsEvidencePacket =>
  makeWorkerOperationsEvidencePacket({
    packetId: "worker-operations-evidence:smoke:reference:2026-05-21",
    generatedAt: "2026-05-21T00:00:00.000Z",
    claimMode: overrides.claimMode ?? "reference_drill",
    components: overrides.components ?? makeComponents(),
    replayRecoveryDrills: overrides.replayRecoveryDrills ?? makeDrills(),
    monitoring: {
      captured_at: "2026-05-21T00:00:00.000Z",
      stale_work_items_threshold_seconds: overrides.monitoringThreshold ?? 300,
      max_publish_lag_seconds: 60,
      metrics_refs: [
        "docs/public/network-contracts/artifact-publication-runbook.md#operator-evidence",
        "docs/public/network-contracts/nats-subjects.md#operator-evidence",
        "docs/public/network-contracts/scan-time-validation-sequence.md#operator-evidence",
        "docs/public/network-contracts/scanner-decision-http-runtime.md#operator-evidence",
      ],
      signals: overrides.monitoringSignals ?? makeSignals(),
    },
    guardrails: {
      postgres_authoritative: true,
      nats_propagation_only: true,
      verifier_cache_derived_only: true,
      no_secret_material: true,
    },
    reviewer: {
      name: "QR Trust reviewer",
      role: "worker operations evidence smoke",
      reviewed_at: "2026-05-21",
      ...overrides.reviewer,
    },
  })

const makeComponents = (): ReadonlyArray<WorkerOperationsComponent> => [
  {
    component_id: "artifact_publication_worker",
    runtime: "Effect TypeScript worker over Postgres artifact publication queue",
    authority_boundary: "postgres_source_of_truth",
    input_refs: ["qr_trust.artifact_publication_work_items"],
    output_refs: ["qr_trust.published_artifacts", "qr_trust.event_outbox"],
    runbook_ref: "docs/public/network-contracts/artifact-publication-runbook.md",
    smoke_script: "npm run artifact-publication:queue-worker-smoke",
    metrics_ref:
      "docs/public/network-contracts/artifact-publication-runbook.md#operator-evidence",
    recovery_ref:
      "docs/public/network-contracts/artifact-publication-runbook.md#recovery",
    operational_status: "reference_ready",
  },
  {
    component_id: "event_outbox_worker",
    runtime: "Effect TypeScript worker over Postgres event outbox and NATS JetStream",
    authority_boundary: "nats_propagation_only",
    input_refs: ["qr_trust.event_outbox"],
    output_refs: ["qrtrust.governance.* NATS subjects"],
    runbook_ref: "docs/public/network-contracts/nats-subjects.md",
    smoke_script: "npm run event-outbox:worker-smoke",
    metrics_ref: "docs/public/network-contracts/nats-subjects.md#operator-evidence",
    recovery_ref: "docs/public/network-contracts/nats-subjects.md#replay",
    operational_status: "reference_ready",
  },
  {
    component_id: "verifier_cache_read_model_worker",
    runtime:
      "Effect TypeScript worker materializing verifier cache from governance artifacts",
    authority_boundary: "derived_read_model",
    input_refs: [
      "qr_trust.verifier_cache_work_items",
      "qrtrust.governance.* NATS subjects",
    ],
    output_refs: ["qr_trust.verifier_cache_entries", "qr_trust.scanner_decisions"],
    runbook_ref: "docs/public/network-contracts/scan-time-validation-sequence.md",
    smoke_script: "npm run verifier-cache:read-model-worker-smoke",
    metrics_ref:
      "docs/public/network-contracts/scan-time-validation-sequence.md#operator-evidence",
    recovery_ref:
      "docs/public/network-contracts/scan-time-validation-sequence.md#recovery",
    operational_status: "reference_ready",
  },
  {
    component_id: "scanner_decision_runtime",
    runtime:
      "HTTP scanner-decision service backed by verifier cache and runtime observations",
    authority_boundary: "scanner_decision_runtime",
    input_refs: ["qr_trust.verifier_cache_entries", "qr_trust.runtime_observations"],
    output_refs: [
      "qr_trust.scanner_decisions",
      "scanner-visible green/orange/red response",
    ],
    runbook_ref: "docs/public/network-contracts/scanner-decision-http-runtime.md",
    smoke_script: "npm run scanner-decision:http-runtime-smoke",
    metrics_ref:
      "docs/public/network-contracts/scanner-decision-http-runtime.md#operator-evidence",
    recovery_ref:
      "docs/public/network-contracts/scanner-decision-http-runtime.md#fail-closed",
    operational_status: "reference_ready",
  },
]

const makeSignals = (): ReadonlyArray<WorkerOperationsSignalEvidence> => [
  {
    signal_id: "artifact_publication_lag",
    component_id: "artifact_publication_worker",
    threshold: "alert when oldest unprocessed publication work item is older than 300 seconds",
    metric_ref:
      "docs/public/network-contracts/artifact-publication-runbook.md#artifact-publication-lag",
    alert_ref:
      "docs/public/network-contracts/artifact-publication-runbook.md#artifact-publication-lag-alert",
    replay_or_recovery_ref:
      "docs/public/network-contracts/artifact-publication-runbook.md#blocked-policy-retry",
    owner: "authority publication operator",
  },
  {
    signal_id: "event_outbox_publish_lag",
    component_id: "event_outbox_worker",
    threshold: "alert when committed event outbox rows remain unpublished for more than 60 seconds",
    metric_ref: "docs/public/network-contracts/nats-subjects.md#event-outbox-publish-lag",
    alert_ref: "docs/public/network-contracts/nats-subjects.md#event-outbox-publish-lag-alert",
    replay_or_recovery_ref: "docs/public/network-contracts/nats-subjects.md#replay-drill",
    owner: "propagation operator",
  },
  {
    signal_id: "verifier_cache_staleness",
    component_id: "verifier_cache_read_model_worker",
    threshold: "alert when verifier cache entries exceed the accepted freshness window",
    metric_ref:
      "docs/public/network-contracts/scan-time-validation-sequence.md#verifier-cache-staleness",
    alert_ref:
      "docs/public/network-contracts/scan-time-validation-sequence.md#verifier-cache-staleness-alert",
    replay_or_recovery_ref:
      "docs/public/network-contracts/scan-time-validation-sequence.md#cache-rebuild-drill",
    owner: "verifier cache operator",
  },
  {
    signal_id: "scanner_decision_error_rate",
    component_id: "scanner_decision_runtime",
    threshold: "alert when scanner decision runtime errors exceed the operator threshold",
    metric_ref:
      "docs/public/network-contracts/scanner-decision-http-runtime.md#scanner-decision-error-rate",
    alert_ref:
      "docs/public/network-contracts/scanner-decision-http-runtime.md#scanner-decision-error-rate-alert",
    replay_or_recovery_ref:
      "docs/public/network-contracts/scanner-decision-http-runtime.md#cache-miss-drill",
    owner: "scanner runtime operator",
  },
]

const makeDrills = (): ReadonlyArray<WorkerOperationsReplayRecoveryDrill> => [
  {
    drill_id: "artifact-publication-retry-after-blocked-policy",
    component_id: "artifact_publication_worker",
    trigger: "Destination-policy work item fails publication-gate validation.",
    expected_recovery:
      "Worker records the blocked result and retries after valid issuer proof is published.",
    evidence_ref:
      "docs/public/network-contracts/artifact-publication-runbook.md#blocked-policy-retry",
  },
  {
    drill_id: "event-outbox-replay-after-nats-outage",
    component_id: "event_outbox_worker",
    trigger: "NATS is unavailable after a Postgres outbox row is committed.",
    expected_recovery:
      "Worker preserves the outbox row and republishes the same envelope after broker recovery.",
    evidence_ref: "docs/public/network-contracts/nats-subjects.md#replay-drill",
  },
  {
    drill_id: "verifier-cache-rebuild-from-artifacts",
    component_id: "verifier_cache_read_model_worker",
    trigger: "Verifier cache projection is stale or deleted.",
    expected_recovery:
      "Worker rebuilds derived cache state from accepted source artifacts.",
    evidence_ref:
      "docs/public/network-contracts/scan-time-validation-sequence.md#cache-rebuild-drill",
  },
  {
    drill_id: "scanner-runtime-fail-closed-on-cache-miss",
    component_id: "scanner_decision_runtime",
    trigger: "Scanner runtime receives a QR whose cache entry is missing or stale.",
    expected_recovery:
      "Runtime emits a scanner-visible non-green decision without trusting syntax alone.",
    evidence_ref:
      "docs/public/network-contracts/scanner-decision-http-runtime.md#cache-miss-drill",
  },
]

const throwsMissingComponent = (): boolean =>
  throws(() => makeReferencePacket({ components: makeComponents().slice(0, 3) }))

const throwsWrongBoundary = (): boolean =>
  throws(() =>
    makeReferencePacket({
      components: makeComponents().map((component) =>
        component.component_id === "event_outbox_worker"
          ? { ...component, authority_boundary: "postgres_source_of_truth" }
          : component
      ),
    })
  )

const throwsBlockedReferenceWorker = (): boolean =>
  throws(() =>
    makeReferencePacket({
      components: makeComponents().map((component) =>
        component.component_id === "scanner_decision_runtime"
          ? { ...component, operational_status: "blocked" }
          : component
      ),
    })
  )

const throwsProductionCandidateWithoutProductionWorkers = (): boolean =>
  throws(() => makeReferencePacket({ claimMode: "production_candidate" }))

const throwsMissingDrill = (): boolean =>
  throws(() =>
    makeReferencePacket({
      replayRecoveryDrills: makeDrills().filter(
        (drill) => drill.component_id !== "event_outbox_worker",
      ),
    })
  )

const throwsUnsafeEvidenceRef = (): boolean =>
  throws(() =>
    makeReferencePacket({
      replayRecoveryDrills: makeDrills().map((drill) =>
        drill.component_id === "artifact_publication_worker"
          ? { ...drill, evidence_ref: "../private/local-log.txt" }
          : drill
      ),
    })
  )

const throwsMissingMonitoring = (): boolean =>
  throws(() => makeReferencePacket({ monitoringThreshold: 0 }))

const throwsMissingMonitoringSignal = (): boolean =>
  throws(() =>
    makeReferencePacket({
      monitoringSignals: makeSignals().slice(0, 3),
    })
  )

const throwsWrongSignalComponent = (): boolean =>
  throws(() =>
    makeReferencePacket({
      monitoringSignals: makeSignals().map((signal) =>
        signal.signal_id === "event_outbox_publish_lag"
          ? { ...signal, component_id: "scanner_decision_runtime" }
          : signal
      ),
    })
  )

const throwsUnsafeSignalAlertRef = (): boolean =>
  throws(() =>
    makeReferencePacket({
      monitoringSignals: makeSignals().map((signal) =>
        signal.signal_id === "artifact_publication_lag"
          ? { ...signal, alert_ref: "../private/alerts/artifact-publication-lag.md" }
          : signal
      ),
    })
  )

const throwsPrivateMaterial = (): boolean =>
  throws(() =>
    makeReferencePacket({
      components: makeComponents().map((component) =>
        component.component_id === "artifact_publication_worker"
          ? { ...component, recovery_ref: "docs/public/network-contracts/password.txt" }
          : component
      ),
    })
  )

const throwsMalformedReviewerReviewDate = (): boolean =>
  throws(() =>
    makeReferencePacket({
      reviewer: {
        name: "QR Trust reviewer",
        role: "worker operations evidence smoke",
        reviewed_at: "pending-review",
      },
    })
  )

const throws = (fn: () => unknown): boolean => {
  try {
    fn()
    return false
  } catch {
    return true
  }
}

const assertSmoke = (
  condition: boolean,
  message: string,
): Effect.Effect<void, Error> =>
  condition ? Effect.void : Effect.fail(new Error(message))

Effect.runPromise(program).catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
