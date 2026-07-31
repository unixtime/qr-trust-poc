import { Console, Effect } from "effect"

import {
  decodeRuntimeSafetyObservation,
  demoDestinationPolicyProjection,
  demoIssuerProjection,
  EventBus,
  InMemoryEventBusLive,
  makeArtifactPublicationService,
  makeCompositeRuntimeSafetyProvider,
  makeDeterministicRedirectInspector,
  makeDeterministicReputationProvider,
  makeDeterministicRuntimeSafetyProvider,
  makeGovernancePublicationService,
  makeInMemoryArtifactStore,
  makeInMemoryVerifierCache,
  makeRuntimeSafetyObservation,
  makeScannerDecisionService,
  makeVerifierSyncService,
  type RuntimeSafetyObservation,
} from "../index.js"

const observedAt = new Date("2026-05-18T00:00:00Z")

const program = Effect.gen(function* () {
  const eventBus = yield* EventBus
  const artifactStore = makeInMemoryArtifactStore()
  const cache = makeInMemoryVerifierCache()
  const publisher = makeArtifactPublicationService(artifactStore, eventBus)
  const governancePublisher = makeGovernancePublicationService(publisher)
  const verifierSync = makeVerifierSyncService(artifactStore, eventBus, cache)
  const scanner = makeScannerDecisionService(
    cache,
    eventBus,
    makeDeterministicRuntimeSafetyProvider(),
  )

  yield* governancePublisher.publishReferenceBundle(observedAt)
  yield* verifierSync.syncRecent()

  const clear = yield* scanner.decide({
    payload: "https://acme.example/pay",
    observedAt,
  })
  const risky = yield* scanner.decide({
    payload: "https://acme.example/pay?runtime=risky",
    observedAt,
  })
  const unavailable = yield* scanner.decide({
    payload: "https://acme.example/pay?runtime=unavailable",
    observedAt,
  })
  const blocked = yield* scanner.decide({
    payload: "https://acme.example/pay?runtime=blocked",
    observedAt,
  })
  const bindingMismatchOutranksRuntime = yield* scanner.decide({
    payload: "https://evil.example/pay?runtime=blocked",
    issuerHintHost: "acme.example",
    observedAt,
  })
  const compositeProvider = makeCompositeRuntimeSafetyProvider({
    providerName: "runtime-safety-composite",
    redirectInspector: makeDeterministicRedirectInspector({
      maxRedirectHops: 1,
    }),
    reputationProvider: makeDeterministicReputationProvider({
      riskyHosts: ["acme.example"],
    }),
  })
  const compositeRisk = yield* compositeProvider.inspect({
    destinationUrl: new URL("https://acme.example/pay"),
    observedAt,
  })
  const redirectRisk = yield* makeCompositeRuntimeSafetyProvider({
    redirectInspector: makeDeterministicRedirectInspector({
      maxRedirectHops: 1,
    }),
    reputationProvider: makeDeterministicReputationProvider(),
  }).inspect({
    destinationUrl: new URL(
      "https://qr.acme.example/r/pay?hops=2&final=https%3A%2F%2Facme.example%2Fpay",
    ),
    resolverUrl: "https://qr.acme.example/r/pay",
    finalUrl: "https://acme.example/pay",
    observedRedirectHops: 2,
    observedAt,
  })
  const reputationBlock = yield* makeCompositeRuntimeSafetyProvider({
    reputationProvider: makeDeterministicReputationProvider({
      blockedHosts: ["acme.example"],
    }),
  }).inspect({
    destinationUrl: new URL("https://acme.example/pay"),
    observedAt,
  })
  const clearObservationInput = {
    destinationUrl: new URL("https://acme.example/pay"),
    observedAt,
  }
  const clearObservationVerdict =
    yield* makeDeterministicRuntimeSafetyProvider().inspect(clearObservationInput)
  const unavailableObservationInput = {
    destinationUrl: new URL("https://acme.example/pay?runtime=unavailable"),
    observedAt,
  }
  const unavailableObservationVerdict =
    yield* makeDeterministicRuntimeSafetyProvider().inspect(
      unavailableObservationInput,
    )
  const clearObservation = yield* decodeRuntimeSafetyObservation(
    makeRuntimeSafetyObservation({
      runtime_input: clearObservationInput,
      verdict: clearObservationVerdict,
      ttl_seconds: 300,
      governance: {
        ...demoIssuerProjection.namespace,
        destination_policy_id:
          demoDestinationPolicyProjection.destination_policy_id,
      },
    }),
  )
  const redirectObservation = yield* decodeRuntimeSafetyObservation(
    makeRuntimeSafetyObservation({
      runtime_input: {
        destinationUrl: new URL(
          "https://qr.acme.example/r/pay?hops=2&final=https%3A%2F%2Facme.example%2Fpay",
        ),
        resolverUrl: "https://qr.acme.example/r/pay",
        finalUrl: "https://acme.example/pay",
        observedRedirectHops: 2,
        observedAt,
      },
      verdict: redirectRisk,
      ttl_seconds: 300,
      privacy: { payload_disclosure: "host_only" },
    }),
  )
  const blockedObservation = yield* decodeRuntimeSafetyObservation(
    makeRuntimeSafetyObservation({
      runtime_input: {
        destinationUrl: new URL("https://acme.example/pay"),
        observedAt,
      },
      verdict: reputationBlock,
      ttl_seconds: 300,
    }),
  )
  const unavailableObservation = yield* decodeRuntimeSafetyObservation(
    makeRuntimeSafetyObservation({
      runtime_input: unavailableObservationInput,
      verdict: unavailableObservationVerdict,
      ttl_seconds: 60,
    }),
  )

  yield* assertSmoke(clear.decision_color === "green", "clear runtime should stay green")
  yield* assertSmoke(
    risky.decision_color === "orange" &&
      risky.decision_state === "verified_issuer_destination_risky" &&
      risky.reason_codes.includes("runtime_destination_risky") &&
      risky.hold_to_open.required,
    "runtime risk should downgrade verified issuer to orange hold-to-open",
  )
  yield* assertSmoke(
    unavailable.decision_color === "orange" &&
      unavailable.decision_state === "verified_issuer_runtime_unavailable" &&
      unavailable.reason_codes.includes("runtime_provider_unavailable") &&
      unavailable.hold_to_open.required,
    "runtime unavailable should not produce green",
  )
  yield* assertSmoke(
    blocked.decision_color === "red" &&
      blocked.decision_state === "verified_issuer_runtime_blocked" &&
      blocked.reason_codes.includes("runtime_destination_blocked") &&
      blocked.hold_to_open.required,
    "runtime block should produce red",
  )
  yield* assertSmoke(
    bindingMismatchOutranksRuntime.decision_color === "red" &&
      bindingMismatchOutranksRuntime.decision_state ===
        "destination_policy_mismatch" &&
      bindingMismatchOutranksRuntime.trust_path.runtime_safety.status ===
        "secondary",
    "destination binding failure must outrank runtime safety",
  )
  yield* assertSmoke(
    compositeRisk.status === "risky" &&
      compositeRisk.provider === "runtime-safety-composite" &&
      compositeRisk.reason_codes.includes("runtime_redirect_clear") &&
      compositeRisk.reason_codes.includes("runtime_reputation_risky"),
    "composite provider should combine redirect and reputation signals",
  )
  yield* assertSmoke(
    redirectRisk.status === "risky" &&
      redirectRisk.reason_codes.includes("runtime_redirect_chain_risky"),
    "redirect inspector should expose risky resolver chains",
  )
  yield* assertSmoke(
    reputationBlock.status === "blocked" &&
      reputationBlock.reason_codes.includes("runtime_reputation_blocked"),
    "reputation provider should be able to block current destinations",
  )
  yield* assertSmoke(
    clearObservation.decision_role.source_of_truth === false &&
      clearObservation.decision_role.scanner_visible_impact ===
        "may_support_green_when_prior_layers_pass" &&
      clearObservation.destination.https_status === "valid" &&
      Boolean(clearObservation.governance),
    "clear observation should support green only after prior trust layers pass",
  )
  yield* assertSmoke(
    redirectObservation.provider.provider_kind === "composite_runtime_safety" &&
      redirectObservation.destination.resolver_url ===
        "https://qr.acme.example/r/pay" &&
      redirectObservation.destination.observed_redirect_hops === 2 &&
      redirectObservation.decision_role.scanner_visible_impact ===
        "may_downgrade_to_orange",
    "redirect observation should preserve resolver evidence without becoming source of truth",
  )
  yield* assertSmoke(
    blockedObservation.verdict === "blocked" &&
      blockedObservation.provider.provider_kind ===
        "composite_runtime_safety" &&
      blockedObservation.decision_role.scanner_visible_impact ===
        "may_block_to_red",
    "blocked observation should map to red scanner-visible impact",
  )
  yield* assertSmoke(
    unavailableObservation.provider.response_status === "unavailable" &&
      unavailableObservation.decision_role.scanner_visible_impact ===
        "may_downgrade_to_orange",
    "unavailable observation should downgrade rather than falsely approve",
  )

  yield* Console.log(
    JSON.stringify(
      {
        clear: summarize(clear),
        risky: summarize(risky),
        unavailable: summarize(unavailable),
        blocked: summarize(blocked),
        binding_mismatch_outranks_runtime: summarize(
          bindingMismatchOutranksRuntime,
        ),
        composite_adapter: {
          status: compositeRisk.status,
          provider: compositeRisk.provider,
          reason_codes: compositeRisk.reason_codes,
        },
        redirect_adapter: {
          status: redirectRisk.status,
          reason_codes: redirectRisk.reason_codes,
        },
        reputation_adapter: {
          status: reputationBlock.status,
          reason_codes: reputationBlock.reason_codes,
        },
        runtime_observations: {
          clear: summarizeObservation(clearObservation),
          redirect_risk: summarizeObservation(redirectObservation),
          reputation_block: summarizeObservation(blockedObservation),
          unavailable: summarizeObservation(unavailableObservation),
        },
      },
      null,
      2,
    ),
  )
}).pipe(Effect.provide(InMemoryEventBusLive))

const summarize = (decision: {
  readonly decision_color: string
  readonly decision_state: string
  readonly reason_codes: ReadonlyArray<string>
  readonly hold_to_open: { readonly required: boolean }
}) => ({
  color: decision.decision_color,
  state: decision.decision_state,
  hold_to_open: decision.hold_to_open.required,
  reason_codes: decision.reason_codes,
})

const summarizeObservation = (observation: RuntimeSafetyObservation) => ({
  id: observation.observation_id,
  verdict: observation.verdict,
  risk_score: observation.risk_score,
  provider: observation.provider,
  scanner_visible_impact:
    observation.decision_role.scanner_visible_impact,
  source_of_truth: observation.decision_role.source_of_truth,
  destination: observation.destination,
})

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Runtime safety smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
