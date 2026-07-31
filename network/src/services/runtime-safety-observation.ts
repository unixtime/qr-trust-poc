import {
  fingerprintHost,
  type GovernanceProjection,
  type RuntimeSafetyObservation,
} from "../contracts.js"
import { hashJson } from "../hash.js"
import type {
  RuntimeSafetyInput,
  RuntimeSafetyStatus,
  RuntimeSafetyVerdict,
} from "./runtime-safety.js"

export interface RuntimeSafetyObservationInput {
  readonly runtime_input: RuntimeSafetyInput
  readonly verdict: RuntimeSafetyVerdict
  readonly observation_id?: string
  readonly provider_kind?: RuntimeSafetyObservation["provider"]["provider_kind"]
  readonly provider_version?: string
  readonly response_status?: RuntimeSafetyObservation["provider"]["response_status"]
  readonly checked_at?: string
  readonly expires_at?: string
  readonly ttl_seconds?: number
  readonly governance?: GovernanceProjection
  readonly privacy?: Partial<RuntimeSafetyObservation["privacy"]>
}

export const makeRuntimeSafetyObservation = (
  input: RuntimeSafetyObservationInput,
): RuntimeSafetyObservation => {
  const finalUrl = parseUrl(input.runtime_input.finalUrl ?? input.verdict.effective_url)
  const destinationHost = input.runtime_input.destinationUrl.hostname.toLowerCase()
  const observedAt = input.verdict.observed_at
  const expiresAt =
    input.expires_at ?? expiresAtFromTtl(observedAt, input.ttl_seconds)

  return {
    artifact_type: "runtime_safety_observation",
    schema_version: "0.1",
    observation_id: input.observation_id ?? observationId(input),
    observed_at: observedAt,
    ...(expiresAt ? { expires_at: expiresAt } : {}),
    provider: {
      provider_id: input.verdict.provider,
      provider_kind: input.provider_kind ?? providerKind(input.verdict.provider),
      provider_version: input.provider_version ?? "deterministic-0.1",
      response_status:
        input.response_status ?? responseStatus(input.verdict.status),
      checked_at: input.checked_at ?? observedAt,
    },
    destination: {
      destination_host: destinationHost,
      destination_url: input.runtime_input.destinationUrl.toString(),
      fingerprint: fingerprintHost(destinationHost),
      ...(input.runtime_input.resolverUrl
        ? { resolver_url: input.runtime_input.resolverUrl }
        : {}),
      ...(finalUrl ? { final_url: finalUrl.toString() } : {}),
      ...(finalUrl ? { final_host: finalUrl.hostname.toLowerCase() } : {}),
      observed_redirect_hops: input.runtime_input.observedRedirectHops ?? 0,
      https_status: httpsStatus(input.runtime_input.destinationUrl),
    },
    verdict: input.verdict.status,
    risk_score: clampRiskScore(input.verdict.risk_score_delta),
    reason_codes: [...input.verdict.reason_codes],
    privacy: {
      payload_disclosure: input.privacy?.payload_disclosure ?? "normalized_url",
      user_data_disclosure: input.privacy?.user_data_disclosure ?? "none",
      raw_provider_payload_retained:
        input.privacy?.raw_provider_payload_retained ?? false,
    },
    decision_role: {
      source_of_truth: false,
      scanner_visible_impact: scannerVisibleImpact(input.verdict.status),
      operator_note:
        "Runtime observations can downgrade or block scanner-visible decisions, but cannot establish issuer legitimacy or destination binding by themselves.",
    },
    ...(input.governance ? { governance: input.governance } : {}),
  }
}

const observationId = (input: RuntimeSafetyObservationInput): string =>
  `runtime_observation_${hashJson({
    provider: input.verdict.provider,
    destination_url: input.runtime_input.destinationUrl.toString(),
    final_url: input.runtime_input.finalUrl ?? input.verdict.effective_url,
    observed_at: input.verdict.observed_at,
    verdict: input.verdict.status,
    reason_codes: input.verdict.reason_codes,
  }).slice(0, 24)}`

const providerKind = (
  provider: string,
): RuntimeSafetyObservation["provider"]["provider_kind"] => {
  const normalized = provider.toLowerCase()
  if (normalized.includes("redirect")) {
    return "redirect_inspector"
  }
  if (normalized.includes("reputation")) {
    return "reputation_provider"
  }
  if (normalized.includes("tls") || normalized.includes("https")) {
    return "tls_https_inspector"
  }

  return "composite_runtime_safety"
}

const responseStatus = (
  status: RuntimeSafetyStatus,
): RuntimeSafetyObservation["provider"]["response_status"] =>
  status === "unavailable" ? "unavailable" : "usable"

const scannerVisibleImpact = (
  status: RuntimeSafetyStatus,
): RuntimeSafetyObservation["decision_role"]["scanner_visible_impact"] => {
  if (status === "blocked") {
    return "may_block_to_red"
  }
  if (status === "clear") {
    return "may_support_green_when_prior_layers_pass"
  }

  return "may_downgrade_to_orange"
}

const httpsStatus = (
  url: URL,
): RuntimeSafetyObservation["destination"]["https_status"] => {
  if (url.protocol === "https:") {
    return "valid"
  }
  if (url.protocol === "http:") {
    return "absent"
  }

  return "not_checked"
}

const expiresAtFromTtl = (
  observedAt: string,
  ttlSeconds: number | undefined,
): string | undefined => {
  if (!ttlSeconds) {
    return undefined
  }

  return new Date(new Date(observedAt).getTime() + ttlSeconds * 1000).toISOString()
}

const parseUrl = (value: string): URL | undefined => {
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

const clampRiskScore = (score: number): number =>
  Math.max(0, Math.min(100, Math.round(score)))
