import { Console, Effect } from "effect"

import {
  demoDestinationPolicyProjection,
  demoIssuerProjection,
  evaluateDomainProofBoundary,
  type DestinationPolicyProjection,
  type DomainProofRecord,
  type IssuerEnrollmentProjection,
} from "../index.js"

const observedAt = new Date("2026-05-20T00:00:00Z")

const activeIssuer: IssuerEnrollmentProjection = {
  namespace: demoIssuerProjection.namespace,
  issuer_display_name: demoIssuerProjection.issuer_display_name,
  assurance_tier: demoIssuerProjection.assurance_tier,
  enrollment_status: "active",
}

const verifiedAcmeProof: DomainProofRecord = {
  namespace: demoIssuerProjection.namespace,
  domain: "acme.example",
  proof_method: "dns_txt",
  verification_status: "verified",
  verified_at: "2026-05-01T00:00:00Z",
  expires_at: "2026-12-31T23:59:59Z",
  evidence_ref: "evidence://domain/acme.example/dns-txt",
}

const program = Effect.gen(function* () {
  const exactDomain = evaluateDomainProofBoundary({
    issuer: activeIssuer,
    destination_policy: demoDestinationPolicyProjection,
    domain_proofs: [verifiedAcmeProof],
    destination_url: new URL("https://acme.example/pay"),
    observed_at: observedAt,
  })

  const inactiveIssuer = evaluateDomainProofBoundary({
    issuer: {
      ...activeIssuer,
      enrollment_status: "suspended",
    },
    destination_policy: demoDestinationPolicyProjection,
    domain_proofs: [verifiedAcmeProof],
    destination_url: new URL("https://acme.example/pay"),
    observed_at: observedAt,
  })

  const pendingProof = evaluateDomainProofBoundary({
    issuer: activeIssuer,
    destination_policy: demoDestinationPolicyProjection,
    domain_proofs: [
      {
        ...verifiedAcmeProof,
        verification_status: "pending",
        expires_at: "2026-12-31T23:59:59Z",
      },
    ],
    destination_url: new URL("https://acme.example/pay"),
    observed_at: observedAt,
  })

  const expiredProof = evaluateDomainProofBoundary({
    issuer: activeIssuer,
    destination_policy: demoDestinationPolicyProjection,
    domain_proofs: [
      {
        ...verifiedAcmeProof,
        expires_at: "2026-05-01T00:00:00Z",
      },
    ],
    destination_url: new URL("https://acme.example/pay"),
    observed_at: observedAt,
  })

  const strictSubdomain = evaluateDomainProofBoundary({
    issuer: activeIssuer,
    destination_policy: demoDestinationPolicyProjection,
    domain_proofs: [verifiedAcmeProof],
    destination_url: new URL("https://checkout.acme.example/pay"),
    observed_at: observedAt,
  })

  const allowedSubdomain = evaluateDomainProofBoundary({
    issuer: activeIssuer,
    destination_policy: allowSubdomains(demoDestinationPolicyProjection),
    domain_proofs: [verifiedAcmeProof],
    destination_url: new URL("https://checkout.acme.example/pay"),
    observed_at: observedAt,
  })

  const unapprovedHost = evaluateDomainProofBoundary({
    issuer: activeIssuer,
    destination_policy: demoDestinationPolicyProjection,
    domain_proofs: [verifiedAcmeProof],
    destination_url: new URL("https://evil.example/pay"),
    observed_at: observedAt,
  })

  yield* assertSmoke(
    exactDomain.destination_binding_support === "supports_binding" &&
      exactDomain.domain_control === "verified" &&
      exactDomain.issuer_identity_supported_by_domain_control === false &&
      exactDomain.reason_codes.includes("domain_control_not_identity"),
    "verified domain proof should support destination binding without proving identity",
  )
  yield* assertSmoke(
    inactiveIssuer.destination_binding_support === "does_not_support_binding" &&
      inactiveIssuer.issuer_legitimacy === "not_active" &&
      inactiveIssuer.domain_control === "not_evaluated",
    "verified domain proof must not override inactive issuer legitimacy",
  )
  yield* assertSmoke(
    pendingProof.destination_binding_support === "does_not_support_binding" &&
      pendingProof.domain_control === "pending",
    "pending domain proof must not support destination binding",
  )
  yield* assertSmoke(
    expiredProof.destination_binding_support === "does_not_support_binding" &&
      expiredProof.domain_control === "expired",
    "expired verified proof must not support destination binding",
  )
  yield* assertSmoke(
    strictSubdomain.destination_binding_support === "does_not_support_binding" &&
      strictSubdomain.reason_codes.includes("domain_proof_missing"),
    "base-domain proof must not authorize subdomain unless policy says so",
  )
  yield* assertSmoke(
    allowedSubdomain.destination_binding_support === "supports_binding" &&
      allowedSubdomain.matched_domain === "acme.example",
    "base-domain proof may support subdomain binding only when policy allows subdomains",
  )
  yield* assertSmoke(
    unapprovedHost.destination_binding_support === "does_not_support_binding" &&
      unapprovedHost.reason_codes.includes("destination_policy_host_not_approved"),
    "domain proof must not rescue a host outside destination policy",
  )

  yield* Console.log(
    JSON.stringify(
      {
        exact_domain: exactDomain,
        inactive_issuer: inactiveIssuer,
        pending_proof: pendingProof,
        expired_proof: expiredProof,
        strict_subdomain: strictSubdomain,
        allowed_subdomain: allowedSubdomain,
        unapproved_host: unapprovedHost,
      },
      null,
      2,
    ),
  )
})

const allowSubdomains = (
  policy: DestinationPolicyProjection,
): DestinationPolicyProjection => ({
  ...policy,
  approved_destinations: policy.approved_destinations.map((destination) => ({
    ...destination,
    allow_subdomains: true,
  })),
  allow_subdomains: true,
})

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Domain proof smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
