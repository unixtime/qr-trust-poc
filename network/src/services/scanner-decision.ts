import { randomUUID } from "node:crypto"

import { Effect } from "effect"

import {
  decodeScannerDecision,
  destinationFromUrl,
  type ScannerDecision,
} from "../contracts.js"
import {
  contractValidationError,
  destinationParseError,
  type NetworkError,
} from "../errors.js"
import { hashJson } from "../hash.js"
import type { EventBusShape } from "./event-bus.js"
import {
  makeClearRuntimeSafetyProvider,
  type RuntimeSafetyProviderShape,
  type RuntimeSafetyVerdict,
} from "./runtime-safety.js"
import type {
  DestinationResolution,
  VerifierCacheShape,
} from "./verifier-cache.js"

type CacheFreshnessCheckStatus = Exclude<
  ScannerDecision["cache_freshness"]["status"],
  "not_applicable"
>

export interface ScannerDecisionInput {
  readonly payload: string
  readonly issuerHintHost?: string
  readonly observedAt: Date
}

export interface ScannerDecisionServiceShape {
  readonly decide: (
    input: ScannerDecisionInput,
  ) => Effect.Effect<ScannerDecision, NetworkError>
}

export const makeScannerDecisionService = (
  cache: VerifierCacheShape,
  eventBus: EventBusShape,
  runtimeSafety: RuntimeSafetyProviderShape = makeClearRuntimeSafetyProvider(),
): ScannerDecisionServiceShape => ({
  decide: (input) =>
    Effect.gen(function* () {
      const destinationUrl = yield* parseDestinationUrl(input.payload)
      const destination = destinationFromUrl(destinationUrl)
      const resolution = yield* cache.resolveByDestination(
        destinationUrl,
        input.issuerHintHost,
      )
      const decision = yield* makeDecisionFromResolution(
        input,
        destinationUrl,
        destination,
        resolution,
        runtimeSafety,
      )

      const validated = yield* decodeScannerDecision(decision).pipe(
        Effect.mapError((cause) =>
          contractValidationError("Scanner decision failed contract validation.", cause),
        ),
      )

      if (validated.governance) {
        yield* eventBus.publish({
          envelope: {
            event_id: `evt_${validated.decision_id}`,
            type: "scanner.decision.recorded",
            occurred_at: validated.decided_at,
            root_program_id: validated.governance.root_program_id,
            delegated_authority_id:
              validated.governance.delegated_authority_id,
            issuer_id: validated.governance.issuer_id,
            destination_policy_id: validated.governance.destination_policy_id,
            artifact_id: validated.decision_id,
            artifact_hash: `sha256:${hashJson(validated)}`,
            version: 1,
            reason: validated.reason_codes.join(","),
          },
          body: validated,
        })
      }

      return validated
    }),
})

const makeDecisionFromResolution = (
  input: ScannerDecisionInput,
  destinationUrl: URL,
  destination: ScannerDecision["destination"],
  resolution: DestinationResolution | undefined,
  runtimeSafety: RuntimeSafetyProviderShape,
): Effect.Effect<ScannerDecision> => {
  if (!resolution) {
    return Effect.succeed(makeOrangeUnrecognizedDecision(input, destination))
  }

  if (resolution.binding_status !== "bound") {
    return Effect.succeed(
      makeRedDestinationMismatchDecision(input, destination, resolution),
    )
  }

  const freshnessStatus = cacheFreshnessStatus(resolution, input.observedAt)
  if (freshnessStatus !== "fresh") {
    return Effect.succeed(
      makeOrangeCacheRefreshDecision(
        input,
        destination,
        resolution,
        freshnessStatus,
      ),
    )
  }

  return runtimeSafety
    .inspect({
      destinationUrl,
      observedAt: input.observedAt,
      ...(resolution.resolver_url ? { resolverUrl: resolution.resolver_url } : {}),
      ...(resolution.final_url ? { finalUrl: resolution.final_url } : {}),
      ...(resolution.observed_redirect_hops !== undefined
        ? { observedRedirectHops: resolution.observed_redirect_hops }
        : {}),
    })
    .pipe(
      Effect.map((runtimeVerdict) =>
        makeRuntimeAwareBoundDecision(
          input,
          destination,
          resolution,
          runtimeVerdict,
        ),
      ),
    )
}

const parseDestinationUrl = (payload: string) =>
  Effect.try({
    try: () => new URL(payload),
    catch: () => destinationParseError(payload),
  })

const makeGreenDecision = (
  input: ScannerDecisionInput,
  destination: ScannerDecision["destination"],
  resolution: DestinationResolution,
  runtimeVerdict: RuntimeSafetyVerdict,
): ScannerDecision => ({
  decision_id: `decision_${randomUUID()}`,
  decided_at: input.observedAt.toISOString(),
  decision_color: "green",
  decision_state: "verified_issuer",
  reason_codes: [
    "issuer_recognized",
    "destination_bound",
    ...runtimeVerdict.reason_codes,
    "cache_fresh",
  ],
  risk_score: runtimeVerdict.risk_score_delta,
  destination: {
    ...destination,
    final_url: resolution.final_url ?? destination.url,
    ...(resolution.resolver_url ? { resolver_url: resolution.resolver_url } : {}),
  },
  trust_path: {
    issuer_legitimacy: {
      status: "recognized",
      label: "Issuer recognized",
      message: "Issuer record resolved in verifier trust state.",
    },
    destination_binding: {
      status: "bound",
      label: "Destination bound",
      message: "Destination matches issuer policy.",
    },
    runtime_safety: {
      status: "clear",
      label: "Runtime clear",
      message: runtimeVerdict.message,
      reason_codes: Array.from(runtimeVerdict.reason_codes),
    },
    scanner_decision: {
      status: "green",
      label: "Looks safe",
      message: "This QR is approved for this use.",
    },
  },
  hold_to_open: {
    required: false,
    duration_ms: 0,
    reason_codes: [],
  },
  cache_freshness: {
    status: "fresh",
    cache_generated_at: resolution.issuer.cache_generated_at,
    cache_expires_at: resolution.issuer.cache_expires_at,
  },
  governance: {
    root_program_id: resolution.issuer.namespace.root_program_id,
    delegated_authority_id: resolution.issuer.namespace.delegated_authority_id,
    issuer_id: resolution.issuer.namespace.issuer_id,
    destination_policy_id: resolution.issuer.destination_policy_id,
  },
})

const makeRuntimeAwareBoundDecision = (
  input: ScannerDecisionInput,
  destination: ScannerDecision["destination"],
  resolution: DestinationResolution,
  runtimeVerdict: RuntimeSafetyVerdict,
): ScannerDecision => {
  if (runtimeVerdict.status === "blocked") {
    return makeRedRuntimeBlockedDecision(
      input,
      destination,
      resolution,
      runtimeVerdict,
    )
  }

  if (
    runtimeVerdict.status === "risky" ||
    runtimeVerdict.status === "unavailable"
  ) {
    return makeOrangeRuntimeCautionDecision(
      input,
      destination,
      resolution,
      runtimeVerdict,
    )
  }

  return makeGreenDecision(input, destination, resolution, runtimeVerdict)
}

const makeOrangeRuntimeCautionDecision = (
  input: ScannerDecisionInput,
  destination: ScannerDecision["destination"],
  resolution: DestinationResolution,
  runtimeVerdict: RuntimeSafetyVerdict,
): ScannerDecision => ({
  decision_id: `decision_${randomUUID()}`,
  decided_at: input.observedAt.toISOString(),
  decision_color: "orange",
  decision_state:
    runtimeVerdict.status === "unavailable"
      ? "verified_issuer_runtime_unavailable"
      : "verified_issuer_destination_risky",
  reason_codes: [
    "issuer_recognized",
    "destination_bound",
    ...runtimeVerdict.reason_codes,
    "cache_fresh",
  ],
  risk_score: Math.max(30, runtimeVerdict.risk_score_delta),
  destination: {
    ...destination,
    final_url: resolution.final_url ?? destination.url,
    ...(resolution.resolver_url ? { resolver_url: resolution.resolver_url } : {}),
  },
  trust_path: {
    issuer_legitimacy: {
      status: "recognized",
      label: "Issuer recognized",
      message: "Issuer record resolved in verifier trust state.",
    },
    destination_binding: {
      status: "bound",
      label: "Destination bound",
      message: "Destination matches issuer policy.",
    },
    runtime_safety: {
      status: runtimeVerdict.status,
      label:
        runtimeVerdict.status === "unavailable"
          ? "Runtime unavailable"
          : "Runtime risk",
      message: runtimeVerdict.message,
      reason_codes: Array.from(runtimeVerdict.reason_codes),
    },
    scanner_decision: {
      status: "orange",
      label: "Use caution",
      message:
        runtimeVerdict.status === "unavailable"
          ? "The issuer and destination are verified, but present-time safety could not be checked."
          : "Verified issuer, but destination risk was detected at scan time.",
    },
  },
  hold_to_open: {
    required: true,
    duration_ms: 800,
    reason_codes: Array.from(runtimeVerdict.reason_codes),
  },
  cache_freshness: {
    status: "fresh",
    cache_generated_at: resolution.issuer.cache_generated_at,
    cache_expires_at: resolution.issuer.cache_expires_at,
  },
  governance: {
    root_program_id: resolution.issuer.namespace.root_program_id,
    delegated_authority_id: resolution.issuer.namespace.delegated_authority_id,
    issuer_id: resolution.issuer.namespace.issuer_id,
    destination_policy_id: resolution.issuer.destination_policy_id,
  },
})

const makeRedRuntimeBlockedDecision = (
  input: ScannerDecisionInput,
  destination: ScannerDecision["destination"],
  resolution: DestinationResolution,
  runtimeVerdict: RuntimeSafetyVerdict,
): ScannerDecision => ({
  decision_id: `decision_${randomUUID()}`,
  decided_at: input.observedAt.toISOString(),
  decision_color: "red",
  decision_state: "verified_issuer_runtime_blocked",
  reason_codes: [
    "issuer_recognized",
    "destination_bound",
    ...runtimeVerdict.reason_codes,
    "cache_fresh",
  ],
  risk_score: Math.max(60, runtimeVerdict.risk_score_delta),
  destination: {
    ...destination,
    final_url: resolution.final_url ?? destination.url,
    ...(resolution.resolver_url ? { resolver_url: resolution.resolver_url } : {}),
  },
  trust_path: {
    issuer_legitimacy: {
      status: "recognized",
      label: "Issuer recognized",
      message: "Issuer record resolved in verifier trust state.",
    },
    destination_binding: {
      status: "bound",
      label: "Destination bound",
      message: "Destination matches issuer policy.",
    },
    runtime_safety: {
      status: "blocked",
      label: "Runtime blocked",
      message: runtimeVerdict.message,
      reason_codes: Array.from(runtimeVerdict.reason_codes),
    },
    scanner_decision: {
      status: "red",
      label: "Do not open",
      message:
        "The issuer and destination are verified, but present-time safety policy blocks opening.",
    },
  },
  hold_to_open: {
    required: true,
    duration_ms: 800,
    reason_codes: Array.from(runtimeVerdict.reason_codes),
  },
  cache_freshness: {
    status: "fresh",
    cache_generated_at: resolution.issuer.cache_generated_at,
    cache_expires_at: resolution.issuer.cache_expires_at,
  },
  governance: {
    root_program_id: resolution.issuer.namespace.root_program_id,
    delegated_authority_id: resolution.issuer.namespace.delegated_authority_id,
    issuer_id: resolution.issuer.namespace.issuer_id,
    destination_policy_id: resolution.issuer.destination_policy_id,
  },
})

const makeOrangeCacheRefreshDecision = (
  input: ScannerDecisionInput,
  destination: ScannerDecision["destination"],
  resolution: DestinationResolution,
  freshnessStatus: Exclude<
    CacheFreshnessCheckStatus,
    "fresh"
  >,
): ScannerDecision => ({
  decision_id: `decision_${randomUUID()}`,
  decided_at: input.observedAt.toISOString(),
  decision_color: "orange",
  decision_state: `verified_issuer_cache_${freshnessStatus}`,
  reason_codes: [
    "issuer_recognized",
    "destination_bound",
    `cache_${freshnessStatus}`,
  ],
  risk_score: 40,
  destination: {
    ...destination,
    final_url: resolution.final_url ?? destination.url,
    ...(resolution.resolver_url ? { resolver_url: resolution.resolver_url } : {}),
  },
  trust_path: {
    issuer_legitimacy: {
      status: "recognized",
      label: "Issuer recognized",
      message: "Issuer record resolved in verifier trust state.",
    },
    destination_binding: {
      status: "bound",
      label: "Destination bound",
      message: "Destination matches issuer policy.",
    },
    runtime_safety: {
      status: "not_evaluated",
      label: "Runtime not evaluated",
      message:
        "Runtime safety is not evaluated until the verifier cache refreshes.",
      reason_codes: [`cache_${freshnessStatus}`],
    },
    scanner_decision: {
      status: "orange",
      label: "Refresh needed",
      message:
        "The issuer and destination are recognized, but verifier cache freshness must be restored before this can be green.",
    },
  },
  hold_to_open: {
    required: true,
    duration_ms: 800,
    reason_codes: [`cache_${freshnessStatus}`],
  },
  cache_freshness: {
    status: freshnessStatus,
    cache_generated_at: resolution.issuer.cache_generated_at,
    cache_expires_at: resolution.issuer.cache_expires_at,
  },
  governance: {
    root_program_id: resolution.issuer.namespace.root_program_id,
    delegated_authority_id: resolution.issuer.namespace.delegated_authority_id,
    issuer_id: resolution.issuer.namespace.issuer_id,
    destination_policy_id: resolution.issuer.destination_policy_id,
  },
})

const makeOrangeUnrecognizedDecision = (
  input: ScannerDecisionInput,
  destination: ScannerDecision["destination"],
): ScannerDecision => ({
  decision_id: `decision_${randomUUID()}`,
  decided_at: input.observedAt.toISOString(),
  decision_color: "orange",
  decision_state: "plain_url_unrecognized",
  reason_codes: ["plain_url_without_trust_signal", "destination_visible_unverified"],
  risk_score: 30,
  destination,
  trust_path: {
    issuer_legitimacy: {
      status: "unknown",
      label: "Issuer unknown",
      message: "No signed trust path was found for this QR.",
    },
    destination_binding: {
      status: "unverified",
      label: "Destination unverified",
      message: "A destination was read from the QR, but it was not checked against issuer policy.",
    },
    runtime_safety: {
      status: "not_evaluated",
      label: "Runtime not evaluated",
      message: "Runtime safety is not evaluated without a trust path.",
    },
    scanner_decision: {
      status: "orange",
      label: "Use caution",
      message: "This QR is a normal link without a recognized trust signal.",
    },
  },
  hold_to_open: {
    required: true,
    duration_ms: 800,
    reason_codes: ["destination_visible_unverified"],
  },
  cache_freshness: {
    status: "not_applicable",
  },
})

const makeRedDestinationMismatchDecision = (
  input: ScannerDecisionInput,
  destination: ScannerDecision["destination"],
  resolution: DestinationResolution,
): ScannerDecision => ({
  decision_id: `decision_${randomUUID()}`,
  decided_at: input.observedAt.toISOString(),
  decision_color: "red",
  decision_state: "destination_policy_mismatch",
  reason_codes: ["issuer_recognized", ...resolution.reason_codes],
  risk_score: 70,
  destination: {
    ...destination,
    ...(resolution.resolver_url ? { resolver_url: resolution.resolver_url } : {}),
    ...(resolution.final_url ? { final_url: resolution.final_url } : {}),
  },
  trust_path: {
    issuer_legitimacy: {
      status: "recognized",
      label: "Issuer recognized",
      message: "Issuer record resolved in verifier trust state.",
    },
    destination_binding: {
      status: "mismatch",
      label: "Destination mismatch",
      message: destinationBindingMessage(resolution.reason_codes),
      reason_codes: Array.from(resolution.reason_codes),
    },
    runtime_safety: {
      status: "secondary",
      label: "Runtime secondary",
      message: "Destination binding failure is terminal before runtime safety can rescue it.",
    },
    scanner_decision: {
      status: "red",
      label: "Do not open",
      message: "This QR points outside the issuer-approved destination set.",
    },
  },
  hold_to_open: {
    required: true,
    duration_ms: 800,
    reason_codes: Array.from(resolution.reason_codes),
  },
  cache_freshness: {
    status: "fresh",
    cache_generated_at: resolution.issuer.cache_generated_at,
    cache_expires_at: resolution.issuer.cache_expires_at,
  },
  governance: {
    root_program_id: resolution.issuer.namespace.root_program_id,
    delegated_authority_id: resolution.issuer.namespace.delegated_authority_id,
    issuer_id: resolution.issuer.namespace.issuer_id,
    destination_policy_id: resolution.issuer.destination_policy_id,
  },
})

const destinationBindingMessage = (
  reasonCodes: ReadonlyArray<string>,
): string => {
  if (reasonCodes.includes("redirect_final_destination_mismatch")) {
    return "The resolver final destination is outside the issuer-approved policy."
  }
  if (reasonCodes.includes("redirect_hop_limit_exceeded")) {
    return "The resolver chain exceeds the issuer-approved hop limit."
  }
  if (reasonCodes.includes("redirect_hop_count_invalid")) {
    return "The resolver did not report a valid redirect hop count."
  }
  if (reasonCodes.includes("destination_path_not_approved")) {
    return "The destination path is outside the issuer-approved policy."
  }
  if (reasonCodes.includes("destination_query_not_approved")) {
    return "The destination query is outside the issuer-approved policy."
  }
  if (reasonCodes.includes("nested_shortener_not_allowed")) {
    return "The destination uses a nested shortener that this issuer policy forbids."
  }

  return "The destination is outside the issuer-approved policy."
}

const cacheFreshnessStatus = (
  resolution: DestinationResolution,
  observedAt: Date,
): CacheFreshnessCheckStatus => {
  const expiresAt = Date.parse(resolution.issuer.cache_expires_at)
  const generatedAt = Date.parse(resolution.issuer.cache_generated_at)

  if (!Number.isFinite(expiresAt) || !Number.isFinite(generatedAt)) {
    return "unavailable"
  }

  if (generatedAt > observedAt.getTime()) {
    return "stale"
  }

  if (expiresAt <= observedAt.getTime()) {
    return "expired"
  }

  return "fresh"
}
