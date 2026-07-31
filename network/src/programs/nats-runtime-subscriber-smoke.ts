import { Effect } from "effect"

import {
  hashJson,
  jetStreamMessageFromEvent,
  makeInMemoryArtifactStore,
  makePostgresPersistenceService,
  makeRecordingPostgresStatementSink,
  makeRuntimeSafetyObservation,
  processNatsRuntimeMessage,
  type NetworkEvent,
} from "../index.js"

const observedAt = new Date("2026-05-26T12:00:00Z")
const observation = makeRuntimeSafetyObservation({
  runtime_input: {
    destinationUrl: new URL("https://acme.example/pay?runtime=risky"),
    finalUrl: "https://acme.example/pay?runtime=risky",
    observedAt,
  },
  verdict: {
    status: "risky",
    provider: "deterministic-runtime-safety",
    observed_at: observedAt.toISOString(),
    effective_url: "https://acme.example/pay?runtime=risky",
    risk_score_delta: 35,
    reason_codes: ["runtime_risky"],
    message: "Runtime provider reported a risky destination.",
  },
  ttl_seconds: 300,
  governance: {
    root_program_id: "root:qrtrust-demo:2026",
    delegated_authority_id: "authority:qrtrust-demo:merchant-web",
    issuer_id: "issuer:acme-demo",
    destination_policy_id: "policy:acme-demo:web-payments:v1",
  },
})
const artifactHash = `sha256:${hashJson(observation)}`
const artifactId = `artifact:runtime-observation:${observation.observation_id}`
const timeoutObservation = {
  artifact_type: "runtime_safety_observation",
  schema_version: "0.1",
  observation_id: "runtime_observation_timeout_contract_valid",
  observed_at: observedAt.toISOString(),
  expires_at: new Date(observedAt.getTime() + 60_000).toISOString(),
  provider: {
    provider_id: "deterministic-redirect-inspector",
    provider_kind: "redirect_inspector",
    provider_version: "deterministic-0.1",
    response_status: "timeout",
    checked_at: observedAt.toISOString(),
  },
  destination: {
    destination_host: "acme.example",
    destination_url: "https://acme.example/pay",
    fingerprint: "acm...ple",
    final_url: "https://acme.example/pay",
    final_host: "acme.example",
    observed_redirect_hops: 0,
    https_status: "not_checked",
  },
  verdict: "unavailable",
  risk_score: 30,
  reason_codes: ["runtime_redirect_inspector_unavailable"],
  privacy: {
    payload_disclosure: "normalized_url",
    user_data_disclosure: "none",
    raw_provider_payload_retained: false,
  },
  decision_role: {
    source_of_truth: false,
    scanner_visible_impact: "may_downgrade_to_orange",
    operator_note: "Provider timeout must not silently produce green.",
  },
  governance: {
    root_program_id: "root:qrtrust-demo:2026",
    delegated_authority_id: "authority:qrtrust-demo:merchant-web",
    issuer_id: "issuer:acme-demo",
    destination_policy_id: "policy:acme-demo:web-payments:v1",
  },
} as const
const timeoutArtifactHash = `sha256:${hashJson(timeoutObservation)}`
const timeoutArtifactId = `artifact:runtime-observation:${timeoutObservation.observation_id}`

const event: NetworkEvent = {
  envelope: {
    event_id: "evt_runtime_subscriber_smoke_risky_observation",
    type: "runtime.verdict.observed",
    occurred_at: observedAt.toISOString(),
    root_program_id: "root:qrtrust-demo:2026",
    delegated_authority_id: "authority:qrtrust-demo:merchant-web",
    issuer_id: "issuer:acme-demo",
    destination_policy_id: "policy:acme-demo:web-payments:v1",
    artifact_id: artifactId,
    artifact_hash: artifactHash,
    artifact_ref: `postgres://${artifactId}`,
    version: 1,
  },
}

const timeoutEvent: NetworkEvent = {
  envelope: {
    ...event.envelope,
    event_id: "evt_runtime_subscriber_smoke_timeout_observation",
    artifact_id: timeoutArtifactId,
    artifact_hash: timeoutArtifactHash,
    artifact_ref: `postgres://${timeoutArtifactId}`,
  },
}

const program = Effect.gen(function* () {
  const jetStreamMessage = yield* jetStreamMessageFromEvent(event)
  const sink = makeRecordingPostgresStatementSink()
  const artifactStore = makeInMemoryArtifactStore([
    {
      artifact_id: artifactId,
      artifact_hash: artifactHash,
      artifact_type: "runtime_safety_observation",
      version: 1,
      body: observation,
    },
  ])
  const materialized = makeMessage(jetStreamMessage.payload)

  const result = yield* Effect.promise(() =>
    processNatsRuntimeMessage(materialized.message, {
      artifactStore,
      persistence: makePostgresPersistenceService(sink),
    }),
  )

  assertSmoke(result.status === "observed", "runtime observation was not accepted")
  assertSmoke(materialized.acks === 1, "accepted runtime observation was not acked")
  assertSmoke(materialized.naks === 0, "accepted runtime observation was nacked")

  const [command] = sink.recorded()
  assertSmoke(
    command?.name === "runtime_observations.insert",
    "runtime subscriber did not persist a runtime observation",
  )
  assertSmoke(
    command?.values[0] === "deterministic-runtime-safety" &&
      command.values[4] === "risky" &&
      command.values[5] === 35,
    "runtime subscriber did not preserve provider, verdict, and risk score",
  )

  const timeoutJetStreamMessage = yield* jetStreamMessageFromEvent(timeoutEvent)
  const timeoutSink = makeRecordingPostgresStatementSink()
  const timeoutMaterialized = makeMessage(timeoutJetStreamMessage.payload)
  const timeoutResult = yield* Effect.promise(() =>
    processNatsRuntimeMessage(timeoutMaterialized.message, {
      artifactStore: makeInMemoryArtifactStore([
        {
          artifact_id: timeoutArtifactId,
          artifact_hash: timeoutArtifactHash,
          artifact_type: "runtime_safety_observation",
          version: 1,
          body: timeoutObservation,
        },
      ]),
      persistence: makePostgresPersistenceService(timeoutSink),
    }),
  )

  assertSmoke(
    timeoutResult.status === "observed",
    "contract-valid timeout runtime observation was rejected",
  )
  assertSmoke(
    timeoutSink.recorded()[0]?.values[4] === "unavailable" &&
      timeoutSink.recorded()[0]?.values[5] === 30,
    "timeout runtime observation did not persist unavailable verdict and score",
  )

  const missingArtifact = makeMessage(jetStreamMessage.payload)
  const missingArtifactResult = yield* Effect.promise(() =>
    processNatsRuntimeMessage(missingArtifact.message, {
      artifactStore: makeInMemoryArtifactStore(),
      persistence: makePostgresPersistenceService(makeRecordingPostgresStatementSink()),
    }),
  )

  assertSmoke(
    missingArtifactResult.status === "rejected" &&
      missingArtifactResult.reason === "missing_artifact",
    "missing runtime artifact was not rejected",
  )
  assertSmoke(missingArtifact.naks === 0, "missing artifact was nacked")
  assertSmoke(missingArtifact.terms === 1, "missing artifact was not terminated")

  const wrongHash = makeMessage(
    JSON.stringify({
      envelope: {
        ...event.envelope,
        event_id: "evt_runtime_subscriber_smoke_wrong_hash",
        artifact_hash: "sha256:wrong",
      },
    }),
  )
  const wrongHashResult = yield* Effect.promise(() =>
    processNatsRuntimeMessage(wrongHash.message, {
      artifactStore,
      persistence: makePostgresPersistenceService(makeRecordingPostgresStatementSink()),
    }),
  )

  assertSmoke(
    wrongHashResult.status === "rejected" &&
      wrongHashResult.reason === "artifact_hash_mismatch",
    "runtime artifact hash mismatch was not rejected",
  )
  assertSmoke(wrongHash.naks === 0, "hash mismatch was nacked")
  assertSmoke(wrongHash.terms === 1, "hash mismatch was not terminated")

  console.log(
    JSON.stringify(
      {
        nats_runtime_subscriber_smoke: "passed",
        observation_id: observation.observation_id,
        timeout_observation_id: timeoutObservation.observation_id,
        persisted_command: command?.name,
        missing_artifact: missingArtifactResult.status,
        hash_mismatch: wrongHashResult.status,
      },
      null,
      2,
    ),
  )
})

function makeMessage(payload: string): {
  readonly message: {
    readonly data: Uint8Array
    readonly ack: () => void
    readonly nak: (millis?: number) => void
    readonly term: (reason?: string) => void
  }
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
    throw new Error(`NATS runtime subscriber smoke failed: ${message}`)
  }
}

Effect.runPromise(program).catch((cause) => {
  console.error(cause)
  process.exitCode = 1
})
