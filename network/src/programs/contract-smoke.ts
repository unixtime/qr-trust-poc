import { Console, Effect } from "effect"

import {
  InMemoryEventBusLive,
  EventBus,
  makeArtifactPublicationService,
  makeGovernancePublicationService,
  makeInMemoryArtifactStore,
  makeInMemoryVerifierCache,
  makeScannerDecisionService,
  makeVerifierSyncService,
  makeFixtureTrustArtifactSigner,
} from "../index.js"
import { demoIssuerProjection } from "../services/verifier-cache.js"

const observedAt = new Date("2026-05-17T00:00:00Z")

const program = Effect.gen(function* () {
  const eventBus = yield* EventBus
  const artifactStore = makeInMemoryArtifactStore()
  const cache = makeInMemoryVerifierCache()
  const publisher = makeArtifactPublicationService(artifactStore, eventBus)
  const governancePublisher = makeGovernancePublicationService(publisher)
  const verifierSync = makeVerifierSyncService(artifactStore, eventBus, cache)
  const scanner = makeScannerDecisionService(cache, eventBus)
  const signer = makeFixtureTrustArtifactSigner()

  const publishedGovernance = yield* governancePublisher.publishReferenceBundle(
    observedAt,
  )

  const sync = yield* verifierSync.syncRecent()

  const green = yield* scanner.decide({
    payload: "https://acme.example/pay",
    observedAt,
  })
  const orange = yield* scanner.decide({
    payload: "https://wikipedia.org/wiki/QR_code",
    observedAt,
  })
  const red = yield* scanner.decide({
    payload: "https://evil.example/pay",
    issuerHintHost: "acme.example",
    observedAt,
  })
  const pathMismatch = yield* scanner.decide({
    payload: "https://acme.example/admin",
    observedAt,
  })
  const redirectMismatch = yield* scanner.decide({
    payload:
      "https://qr.acme.example/r/pay?final=https%3A%2F%2Fevil.example%2Fpay&hops=1",
    observedAt,
  })
  const redirectSameHostPathMismatch = yield* scanner.decide({
    payload:
      "https://qr.acme.example/r/pay?final=https%3A%2F%2Facme.example%2Fevil&hops=1",
    observedAt,
  })
  const redirectMalformedHops = yield* scanner.decide({
    payload:
      "https://qr.acme.example/r/pay?final=https%3A%2F%2Facme.example%2Fpay&hops=abc",
    observedAt,
  })

  const publishedIssuerStatus = yield* publisher.publishArtifact({
    artifact_type: "revocation_status_event",
    artifact_id: "art_status_acme_demo_suspended_v1",
    version: 1,
    root_program_id: demoIssuerProjection.namespace.root_program_id,
    delegated_authority_id:
      demoIssuerProjection.namespace.delegated_authority_id,
    issuer_id: demoIssuerProjection.namespace.issuer_id,
    body: (yield* signer.signTrustArtifact({
      body: {
        artifact_type: "revocation_status_event",
        schema_version: "0.1.0",
        status_event_id: "status:acme-demo:suspended:v1",
        root_program_id: demoIssuerProjection.namespace.root_program_id,
        delegated_authority_id:
          demoIssuerProjection.namespace.delegated_authority_id,
        target: {
          target_type: "issuer_record",
          issuer_id: demoIssuerProjection.namespace.issuer_id,
        },
        status: "suspended",
        reason: "signed suspension proves stale active cache is removed",
        effective_at: observedAt.toISOString(),
        signed_by: demoIssuerProjection.namespace.delegated_authority_id,
      },
      signed_by: demoIssuerProjection.namespace.delegated_authority_id,
      root_program_id: demoIssuerProjection.namespace.root_program_id,
      delegated_authority_id:
        demoIssuerProjection.namespace.delegated_authority_id,
    })).body,
    occurredAt: observedAt,
    eventType: "issuer.status.changed",
    reason: "signed suspension for verifier sync smoke path",
  })

  const revocationSync = yield* verifierSync.syncRecent()
  const afterSuspension = yield* scanner.decide({
    payload: "https://acme.example/pay",
    observedAt,
  })

  const events = yield* eventBus.recent()

  yield* assertSmoke(sync.projected_issuers === 1, "issuer artifact was not projected")
  yield* assertSmoke(
    sync.projected_destination_policies === 1,
    "destination policy artifact was not projected",
  )
  yield* assertSmoke(green.decision_color === "green", "expected synced issuer to produce green")
  yield* assertSmoke(
    green.decision_state === "verified_issuer",
    "expected green scanner state to use the paper primary state",
  )
  yield* assertSmoke(
    orange.decision_color === "orange" && orange.hold_to_open.required,
    "expected plain URL to produce orange hold-to-open",
  )
  yield* assertSmoke(
    red.decision_color === "red" && red.hold_to_open.required,
    "expected policy mismatch to produce red hold-to-open",
  )
  yield* assertSmoke(
    pathMismatch.decision_color === "red" &&
      pathMismatch.reason_codes.includes("destination_path_not_approved"),
    "expected disallowed path to produce red destination-policy mismatch",
  )
  yield* assertSmoke(
    redirectMismatch.decision_color === "red" &&
      redirectMismatch.reason_codes.includes(
        "redirect_final_destination_mismatch",
      ),
    "expected resolver final-destination mismatch to produce red",
  )
  yield* assertSmoke(
    redirectSameHostPathMismatch.decision_color === "red" &&
      redirectSameHostPathMismatch.reason_codes.includes(
        "redirect_final_destination_mismatch",
      ),
    "expected same-host resolver final-path mismatch to produce red",
  )
  yield* assertSmoke(
    redirectMalformedHops.decision_color === "red" &&
      redirectMalformedHops.reason_codes.includes(
        "redirect_hop_count_invalid",
      ),
    "expected malformed resolver hop count to produce red",
  )
  yield* assertSmoke(
    revocationSync.applied_status_events === 1,
    "issuer status event was not applied",
  )
  yield* assertSmoke(
    afterSuspension.decision_color !== "green",
    "suspended issuer must not keep producing green",
  )
  yield* assertSmoke(
    events.length === 11,
    "expected five artifact events and six governed scanner events",
  )

  yield* Console.log(
    JSON.stringify(
      {
        green: {
          color: green.decision_color,
          state: green.decision_state,
          host: green.destination.display_host,
        },
        orange: {
          color: orange.decision_color,
          state: orange.decision_state,
          host: orange.destination.display_host,
          hold_to_open: orange.hold_to_open.required,
        },
        red: {
          color: red.decision_color,
          state: red.decision_state,
          host: red.destination.display_host,
          hold_to_open: red.hold_to_open.required,
          reason_codes: red.reason_codes,
        },
        path_mismatch: {
          color: pathMismatch.decision_color,
          state: pathMismatch.decision_state,
          host: pathMismatch.destination.display_host,
          reason_codes: pathMismatch.reason_codes,
        },
        redirect_mismatch: {
          color: redirectMismatch.decision_color,
          state: redirectMismatch.decision_state,
          host: redirectMismatch.destination.display_host,
          final_url: redirectMismatch.destination.final_url,
          reason_codes: redirectMismatch.reason_codes,
        },
        after_suspension: {
          color: afterSuspension.decision_color,
          state: afterSuspension.decision_state,
          host: afterSuspension.destination.display_host,
        },
        published_governance: publishedGovernance,
        published_issuer_status: {
          id: publishedIssuerStatus.artifact.artifact_id,
          type: publishedIssuerStatus.artifact.artifact_type,
          event_type: publishedIssuerStatus.event.envelope.type,
        },
        verifier_sync: {
          processed_events: sync.processed_events,
          fetched_artifacts: sync.fetched_artifacts,
          projected_issuers: sync.projected_issuers,
          projected_destination_policies:
            sync.projected_destination_policies,
          missing_artifacts: sync.missing_artifacts.length,
          artifact_hash_mismatches: sync.artifact_hash_mismatches.length,
        },
        revocation_sync: {
          processed_events: revocationSync.processed_events,
          fetched_artifacts: revocationSync.fetched_artifacts,
          projected_issuers: revocationSync.projected_issuers,
          projected_destination_policies:
            revocationSync.projected_destination_policies,
          applied_status_events: revocationSync.applied_status_events,
          missing_artifacts: revocationSync.missing_artifacts.length,
          artifact_hash_mismatches:
            revocationSync.artifact_hash_mismatches.length,
        },
        published_events: events.length,
      },
      null,
      2,
    ),
  )
}).pipe(Effect.provide(InMemoryEventBusLive))

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Network service smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
