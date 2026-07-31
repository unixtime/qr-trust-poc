import {
  evaluateDomainProofBoundary,
  type DestinationBindingSupport,
  type DomainControlStatus,
  type DomainProofBoundaryDecision,
  type DomainProofReasonCode,
  type DomainProofRecord,
  type IssuerEnrollmentProjection,
} from "./domain-proof.js"
import type {
  DestinationPolicyProjection,
  DestinationPolicyRule,
} from "./verifier-cache.js"

export type DestinationPolicyPublicationStatus = "publishable" | "blocked"

export type DestinationPolicyPublicationReasonCode =
  | DomainProofReasonCode
  | "destination_policy_has_no_destinations"
  | "destination_policy_expected_url_invalid"
  | "destination_policy_host_invalid"
  | "destination_policy_host_verified"
  | "destination_policy_host_not_verified"
  | "destination_policy_issuer_namespace_mismatch"
  | "destination_policy_rule_publishable"
  | "destination_policy_rule_blocked"

export interface DestinationPolicyPublicationGateInput {
  readonly issuer: IssuerEnrollmentProjection
  readonly destination_policy: DestinationPolicyProjection
  readonly domain_proofs: ReadonlyArray<DomainProofRecord>
  readonly observed_at: Date
}

export interface DestinationPolicyHostPublicationDecision {
  readonly destination_id: string
  readonly host: string
  readonly evaluated_url: string
  readonly domain_control: DomainControlStatus
  readonly destination_binding_support: DestinationBindingSupport
  readonly publishable: boolean
  readonly reason_codes: ReadonlyArray<DestinationPolicyPublicationReasonCode>
  readonly matched_domain?: string
  readonly proof_method?: string
  readonly proof_expires_at?: string
}

export interface DestinationPolicyRulePublicationDecision {
  readonly destination_id: string
  readonly expected_final_url: string
  readonly publishable: boolean
  readonly host_decisions: ReadonlyArray<DestinationPolicyHostPublicationDecision>
  readonly reason_codes: ReadonlyArray<DestinationPolicyPublicationReasonCode>
}

export interface DestinationPolicyPublicationGateDecision {
  readonly publication_status: DestinationPolicyPublicationStatus
  readonly publishable: boolean
  readonly reason_codes: ReadonlyArray<DestinationPolicyPublicationReasonCode>
  readonly rule_decisions: ReadonlyArray<DestinationPolicyRulePublicationDecision>
  readonly verified_hosts: ReadonlyArray<string>
  readonly blocked_hosts: ReadonlyArray<string>
}

export const evaluateDestinationPolicyPublicationGate = (
  input: DestinationPolicyPublicationGateInput,
): DestinationPolicyPublicationGateDecision => {
  if (!namespaceEquals(input.issuer.namespace, input.destination_policy.namespace)) {
    return {
      publication_status: "blocked",
      publishable: false,
      reason_codes: ["destination_policy_issuer_namespace_mismatch"],
      rule_decisions: [],
      verified_hosts: [],
      blocked_hosts: [],
    }
  }

  if (input.destination_policy.approved_destinations.length === 0) {
    return {
      publication_status: "blocked",
      publishable: false,
      reason_codes: ["destination_policy_has_no_destinations"],
      rule_decisions: [],
      verified_hosts: [],
      blocked_hosts: [],
    }
  }

  const ruleDecisions = input.destination_policy.approved_destinations.map(
    (rule) => evaluateRulePublication(input, rule),
  )
  const verifiedHosts = ruleDecisions.flatMap((ruleDecision) =>
    ruleDecision.host_decisions
      .filter((hostDecision) => hostDecision.publishable)
      .map((hostDecision) => hostDecision.host),
  )
  const blockedHosts = ruleDecisions.flatMap((ruleDecision) =>
    ruleDecision.host_decisions
      .filter((hostDecision) => !hostDecision.publishable)
      .map((hostDecision) => hostDecision.host),
  )
  const publishable =
    ruleDecisions.length > 0 &&
    ruleDecisions.every((ruleDecision) => ruleDecision.publishable)

  return {
    publication_status: publishable ? "publishable" : "blocked",
    publishable,
    reason_codes: uniqueReasonCodes(
      ruleDecisions.flatMap((ruleDecision) => ruleDecision.reason_codes),
    ),
    rule_decisions: ruleDecisions,
    verified_hosts: uniqueStrings(verifiedHosts),
    blocked_hosts: uniqueStrings(blockedHosts),
  }
}

const evaluateRulePublication = (
  input: DestinationPolicyPublicationGateInput,
  rule: DestinationPolicyRule,
): DestinationPolicyRulePublicationDecision => {
  const expectedUrl = parseExpectedFinalUrl(rule.expected_final_url)
  if (!expectedUrl) {
    return {
      destination_id: rule.destination_id,
      expected_final_url: rule.expected_final_url,
      publishable: false,
      host_decisions: [],
      reason_codes: [
        "destination_policy_expected_url_invalid",
        "destination_policy_rule_blocked",
      ],
    }
  }

  const hostCandidates = destinationHostCandidates(rule, expectedUrl)
  if (hostCandidates.some((host) => !isDnsHostname(host))) {
    return {
      destination_id: rule.destination_id,
      expected_final_url: rule.expected_final_url,
      publishable: false,
      host_decisions: [],
      reason_codes: [
        "destination_policy_host_invalid",
        "destination_policy_rule_blocked",
      ],
    }
  }

  const hostUrls = hostCandidates.map((host) => urlForHost(host, expectedUrl.protocol))
  const hostDecisions = hostUrls.map((hostUrl) =>
    evaluateHostPublication(input, rule.destination_id, hostUrl),
  )
  const publishable =
    hostDecisions.length > 0 &&
    hostDecisions.every((hostDecision) => hostDecision.publishable)

  return {
    destination_id: rule.destination_id,
    expected_final_url: rule.expected_final_url,
    publishable,
    host_decisions: hostDecisions,
    reason_codes: uniqueReasonCodes([
      ...hostDecisions.flatMap((hostDecision) => hostDecision.reason_codes),
      publishable
        ? "destination_policy_rule_publishable"
        : "destination_policy_rule_blocked",
    ]),
  }
}

const evaluateHostPublication = (
  input: DestinationPolicyPublicationGateInput,
  destinationId: string,
  destinationUrl: URL,
): DestinationPolicyHostPublicationDecision => {
  const boundary = evaluateDomainProofBoundary({
    issuer: input.issuer,
    destination_policy: input.destination_policy,
    domain_proofs: input.domain_proofs,
    destination_url: destinationUrl,
    observed_at: input.observed_at,
  })
  const publishable =
    boundary.destination_binding_support === "supports_binding" &&
    boundary.domain_control === "verified"

  return {
    destination_id: destinationId,
    host: normalizeDomain(destinationUrl.hostname),
    evaluated_url: destinationUrl.toString(),
    domain_control: boundary.domain_control,
    destination_binding_support: boundary.destination_binding_support,
    publishable,
    reason_codes: uniqueReasonCodes([
      ...boundary.reason_codes,
      publishable
        ? "destination_policy_host_verified"
        : "destination_policy_host_not_verified",
    ]),
    ...optionalBoundaryMetadata(boundary),
  }
}

const optionalBoundaryMetadata = (
  boundary: DomainProofBoundaryDecision,
): Pick<
  DestinationPolicyHostPublicationDecision,
  "matched_domain" | "proof_method" | "proof_expires_at"
> => ({
  ...(boundary.matched_domain ? { matched_domain: boundary.matched_domain } : {}),
  ...(boundary.proof_method ? { proof_method: boundary.proof_method } : {}),
  ...(boundary.proof_expires_at
    ? { proof_expires_at: boundary.proof_expires_at }
    : {}),
})

const destinationHostCandidates = (
  rule: DestinationPolicyRule,
  expectedUrl: URL,
): ReadonlyArray<string> =>
  uniqueStrings([
    expectedUrl.hostname,
    ...rule.allowed_hosts.map((host) => normalizeDomain(host)),
  ])

const parseExpectedFinalUrl = (value: string): URL | undefined => {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.username || url.password) {
      return undefined
    }
    return url
  } catch {
    return undefined
  }
}

const urlForHost = (host: string, protocol: string): URL =>
  new URL(`${protocol}//${host}/`)

const normalizeDomain = (value: string): string =>
  value.trim().replace(/\.$/, "").toLowerCase()

const isDnsHostname = (value: string): boolean => {
  const hostname = normalizeDomain(value)
  if (
    hostname.length === 0 ||
    hostname.length > 253 ||
    hostname.includes("://") ||
    hostname.includes("/") ||
    hostname.includes(":") ||
    /\s/.test(hostname)
  ) {
    return false
  }
  return hostname
    .split(".")
    .every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        !label.startsWith("-") &&
        !label.endsWith("-") &&
        /^[a-z0-9-]+$/.test(label),
    )
}

const namespaceEquals = (
  left: DestinationPolicyProjection["namespace"],
  right: DestinationPolicyProjection["namespace"],
): boolean =>
  left.root_program_id === right.root_program_id &&
  left.delegated_authority_id === right.delegated_authority_id &&
  left.issuer_id === right.issuer_id

const uniqueStrings = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...new Set(values.filter((value) => value.length > 0))]

const uniqueReasonCodes = (
  values: ReadonlyArray<DestinationPolicyPublicationReasonCode>,
): ReadonlyArray<DestinationPolicyPublicationReasonCode> => [...new Set(values)]
