import type {
  DestinationPolicyProjection,
  DestinationPolicyRule,
  IssuerNamespace,
} from "./verifier-cache.js"

export type DomainProofMethod =
  | "dns_txt"
  | "https_well_known"
  | "payment_processor"
  | "enterprise_directory"
  | "manual_review"

export type DomainProofVerificationStatus =
  | "pending"
  | "verified"
  | "failed"
  | "expired"
  | "revoked"

export type IssuerEnrollmentStatus =
  | "pending"
  | "active"
  | "suspended"
  | "revoked"
  | "expired"

export type DomainControlStatus =
  | "verified"
  | "pending"
  | "failed"
  | "expired"
  | "revoked"
  | "missing"
  | "not_evaluated"

export type DestinationBindingSupport =
  | "supports_binding"
  | "does_not_support_binding"

export type DomainProofReasonCode =
  | "issuer_active"
  | "issuer_not_active"
  | "destination_policy_host_approved"
  | "destination_policy_host_not_approved"
  | "domain_proof_verified"
  | "domain_proof_pending"
  | "domain_proof_failed"
  | "domain_proof_expired"
  | "domain_proof_revoked"
  | "domain_proof_missing"
  | "domain_control_not_identity"
  | "subdomain_requires_explicit_policy"

export interface IssuerEnrollmentProjection {
  readonly namespace: IssuerNamespace
  readonly issuer_display_name: string
  readonly assurance_tier: string
  readonly enrollment_status: IssuerEnrollmentStatus
}

export interface DomainProofRecord {
  readonly namespace: IssuerNamespace
  readonly domain: string
  readonly proof_method: DomainProofMethod
  readonly verification_status: DomainProofVerificationStatus
  readonly verified_at?: string
  readonly expires_at?: string
  readonly evidence_ref?: string
}

export interface DomainProofBoundaryInput {
  readonly issuer: IssuerEnrollmentProjection
  readonly destination_policy: DestinationPolicyProjection
  readonly domain_proofs: ReadonlyArray<DomainProofRecord>
  readonly destination_url: URL
  readonly observed_at: Date
}

export interface DomainProofBoundaryDecision {
  readonly issuer_legitimacy: "active" | "not_active"
  readonly domain_control: DomainControlStatus
  readonly destination_binding_support: DestinationBindingSupport
  readonly issuer_identity_supported_by_domain_control: false
  readonly reason_codes: ReadonlyArray<DomainProofReasonCode>
  readonly matched_domain?: string
  readonly proof_method?: DomainProofMethod
  readonly proof_expires_at?: string
}

export const evaluateDomainProofBoundary = (
  input: DomainProofBoundaryInput,
): DomainProofBoundaryDecision => {
  const reasonCodes: DomainProofReasonCode[] = ["domain_control_not_identity"]
  const issuerActive = input.issuer.enrollment_status === "active"
  reasonCodes.push(issuerActive ? "issuer_active" : "issuer_not_active")

  if (!issuerActive) {
    return {
      issuer_legitimacy: "not_active",
      domain_control: "not_evaluated",
      destination_binding_support: "does_not_support_binding",
      issuer_identity_supported_by_domain_control: false,
      reason_codes: reasonCodes,
    }
  }

  const destinationHost = normalizeDomain(input.destination_url.hostname)
  const rule = matchingDestinationRule(
    input.destination_policy.approved_destinations,
    destinationHost,
  )
  if (!rule) {
    reasonCodes.push("destination_policy_host_not_approved")
    return {
      issuer_legitimacy: "active",
      domain_control: "not_evaluated",
      destination_binding_support: "does_not_support_binding",
      issuer_identity_supported_by_domain_control: false,
      reason_codes: reasonCodes,
    }
  }

  reasonCodes.push("destination_policy_host_approved")
  const matchingProof = mostSpecificDomainProof(input, rule, destinationHost)
  if (!matchingProof) {
    if (isSubdomainOfAnyAllowedHost(rule, destinationHost) && !rule.allow_subdomains) {
      reasonCodes.push("subdomain_requires_explicit_policy")
    }
    reasonCodes.push("domain_proof_missing")
    return {
      issuer_legitimacy: "active",
      domain_control: "missing",
      destination_binding_support: "does_not_support_binding",
      issuer_identity_supported_by_domain_control: false,
      reason_codes: reasonCodes,
    }
  }

  const domainControl = effectiveDomainControlStatus(
    matchingProof,
    input.observed_at,
  )
  reasonCodes.push(reasonCodeForProofStatus(domainControl))

  const base = {
    issuer_legitimacy: "active" as const,
    domain_control: domainControl,
    issuer_identity_supported_by_domain_control: false as const,
    reason_codes: reasonCodes,
    matched_domain: normalizeDomain(matchingProof.domain),
    proof_method: matchingProof.proof_method,
    ...(matchingProof.expires_at
      ? { proof_expires_at: matchingProof.expires_at }
      : {}),
  }

  return domainControl === "verified"
    ? {
        ...base,
        destination_binding_support: "supports_binding",
      }
    : {
        ...base,
        destination_binding_support: "does_not_support_binding",
      }
}

const mostSpecificDomainProof = (
  input: DomainProofBoundaryInput,
  rule: DestinationPolicyRule,
  destinationHost: string,
): DomainProofRecord | undefined =>
  input.domain_proofs
    .filter((proof) => namespaceEquals(proof.namespace, input.issuer.namespace))
    .filter((proof) =>
      proofCoversDestination(rule, proof.domain, destinationHost),
    )
    .sort(
      (left, right) =>
        normalizeDomain(right.domain).length - normalizeDomain(left.domain).length,
    )[0]

const matchingDestinationRule = (
  rules: ReadonlyArray<DestinationPolicyRule>,
  destinationHost: string,
): DestinationPolicyRule | undefined =>
  rules.find((rule) =>
    rule.allowed_hosts.some((allowedHost) =>
      hostMatchesAllowedHost(rule, allowedHost, destinationHost),
    ),
  )

const proofCoversDestination = (
  rule: DestinationPolicyRule,
  proofDomain: string,
  destinationHost: string,
): boolean => {
  const normalizedProofDomain = normalizeDomain(proofDomain)
  return (
    destinationHost === normalizedProofDomain ||
    (rule.allow_subdomains &&
      destinationHost.endsWith(`.${normalizedProofDomain}`))
  )
}

const hostMatchesAllowedHost = (
  rule: DestinationPolicyRule,
  allowedHost: string,
  destinationHost: string,
): boolean => {
  const normalizedAllowedHost = normalizeDomain(allowedHost)
  return (
    destinationHost === normalizedAllowedHost ||
    (rule.allow_subdomains &&
      destinationHost.endsWith(`.${normalizedAllowedHost}`))
  )
}

const isSubdomainOfAnyAllowedHost = (
  rule: DestinationPolicyRule,
  destinationHost: string,
): boolean =>
  rule.allowed_hosts.some((allowedHost) =>
    destinationHost.endsWith(`.${normalizeDomain(allowedHost)}`),
  )

const effectiveDomainControlStatus = (
  proof: DomainProofRecord,
  observedAt: Date,
): DomainControlStatus => {
  if (
    proof.verification_status === "verified" &&
    proof.expires_at &&
    proof.expires_at <= observedAt.toISOString()
  ) {
    return "expired"
  }

  return proof.verification_status
}

const reasonCodeForProofStatus = (
  status: DomainControlStatus,
): DomainProofReasonCode => {
  switch (status) {
    case "verified":
      return "domain_proof_verified"
    case "pending":
      return "domain_proof_pending"
    case "failed":
      return "domain_proof_failed"
    case "expired":
      return "domain_proof_expired"
    case "revoked":
      return "domain_proof_revoked"
    case "missing":
    case "not_evaluated":
      return "domain_proof_missing"
  }
}

const namespaceEquals = (
  left: IssuerNamespace,
  right: IssuerNamespace,
): boolean =>
  left.root_program_id === right.root_program_id &&
  left.delegated_authority_id === right.delegated_authority_id &&
  left.issuer_id === right.issuer_id

const normalizeDomain = (domain: string): string =>
  domain.trim().toLowerCase().replace(/\.$/, "")
