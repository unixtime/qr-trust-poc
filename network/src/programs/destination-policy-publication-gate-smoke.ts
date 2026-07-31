import { Console, Effect } from "effect"

import {
  demoDestinationPolicyProjection,
  demoIssuerProjection,
  evaluateDestinationPolicyPublicationGate,
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
  const exactHost = evaluateDestinationPolicyPublicationGate({
    issuer: activeIssuer,
    destination_policy: policyForHosts(["acme.example"]),
    domain_proofs: [verifiedAcmeProof],
    observed_at: observedAt,
  })

  const unprovenOperationalHost = evaluateDestinationPolicyPublicationGate({
    issuer: activeIssuer,
    destination_policy: policyForHosts(["acme.example", "checkout.acme.example"]),
    domain_proofs: [verifiedAcmeProof],
    observed_at: observedAt,
  })

  const explicitSubdomainPolicy = evaluateDestinationPolicyPublicationGate({
    issuer: activeIssuer,
    destination_policy: {
      ...policyForHosts(["acme.example"]),
      approved_destinations: [
        {
          ...demoDestinationPolicyProjection.approved_destinations[0]!,
          expected_final_url: "https://checkout.acme.example/pay",
          allowed_hosts: ["acme.example"],
          allow_subdomains: true,
        },
      ],
      allowed_hosts: ["acme.example"],
      allow_subdomains: true,
    },
    domain_proofs: [verifiedAcmeProof],
    observed_at: observedAt,
  })

  const pendingProof = evaluateDestinationPolicyPublicationGate({
    issuer: activeIssuer,
    destination_policy: policyForHosts(["acme.example"]),
    domain_proofs: [
      {
        ...verifiedAcmeProof,
        verification_status: "pending",
      },
    ],
    observed_at: observedAt,
  })

  const inactiveIssuer = evaluateDestinationPolicyPublicationGate({
    issuer: {
      ...activeIssuer,
      enrollment_status: "suspended",
    },
    destination_policy: policyForHosts(["acme.example"]),
    domain_proofs: [verifiedAcmeProof],
    observed_at: observedAt,
  })

  const emptyPolicy = evaluateDestinationPolicyPublicationGate({
    issuer: activeIssuer,
    destination_policy: {
      ...demoDestinationPolicyProjection,
      approved_destinations: [],
      allowed_hosts: [],
    },
    domain_proofs: [verifiedAcmeProof],
    observed_at: observedAt,
  })

  const invalidPolicy = evaluateDestinationPolicyPublicationGate({
    issuer: activeIssuer,
    destination_policy: {
      ...policyForHosts(["acme.example"]),
      approved_destinations: [
        {
          ...demoDestinationPolicyProjection.approved_destinations[0]!,
          expected_final_url: "not a url",
          allowed_hosts: ["acme.example"],
        },
      ],
    },
    domain_proofs: [verifiedAcmeProof],
    observed_at: observedAt,
  })

  const nonHttpsPolicy = evaluateDestinationPolicyPublicationGate({
    issuer: activeIssuer,
    destination_policy: {
      ...policyForHosts(["acme.example"]),
      approved_destinations: [
        {
          ...demoDestinationPolicyProjection.approved_destinations[0]!,
          expected_final_url: "http://acme.example/pay",
          allowed_hosts: ["acme.example"],
        },
      ],
    },
    domain_proofs: [verifiedAcmeProof],
    observed_at: observedAt,
  })

  const invalidAllowedHostPolicy = evaluateDestinationPolicyPublicationGate({
    issuer: activeIssuer,
    destination_policy: {
      ...policyForHosts(["acme.example"]),
      approved_destinations: [
        {
          ...demoDestinationPolicyProjection.approved_destinations[0]!,
          expected_final_url: "https://acme.example/pay",
          allowed_hosts: ["acme.example/pay"],
        },
      ],
    },
    domain_proofs: [verifiedAcmeProof],
    observed_at: observedAt,
  })

  yield* assertSmoke(
    exactHost.publishable &&
      exactHost.verified_hosts.includes("acme.example") &&
      exactHost.reason_codes.includes("destination_policy_rule_publishable"),
    "verified exact host should allow destination policy publication",
  )
  yield* assertSmoke(
    !unprovenOperationalHost.publishable &&
      unprovenOperationalHost.blocked_hosts.includes("checkout.acme.example") &&
      unprovenOperationalHost.reason_codes.includes("domain_proof_missing"),
    "each named destination host must be proven before publication",
  )
  yield* assertSmoke(
    explicitSubdomainPolicy.publishable &&
      explicitSubdomainPolicy.verified_hosts.includes("checkout.acme.example"),
    "base-domain proof should support subdomain publication only under explicit policy",
  )
  yield* assertSmoke(
    !pendingProof.publishable &&
      pendingProof.reason_codes.includes("domain_proof_pending"),
    "pending proof must block destination policy publication",
  )
  yield* assertSmoke(
    !inactiveIssuer.publishable &&
      inactiveIssuer.reason_codes.includes("issuer_not_active"),
    "domain proof must not rescue inactive issuer enrollment",
  )
  yield* assertSmoke(
    !emptyPolicy.publishable &&
      emptyPolicy.reason_codes.includes("destination_policy_has_no_destinations"),
    "empty destination policy must not be publishable",
  )
  yield* assertSmoke(
    !invalidPolicy.publishable &&
      invalidPolicy.reason_codes.includes("destination_policy_expected_url_invalid"),
    "invalid expected destination URL must block publication",
  )
  yield* assertSmoke(
    !nonHttpsPolicy.publishable &&
      nonHttpsPolicy.reason_codes.includes(
        "destination_policy_expected_url_invalid",
      ),
    "non-HTTPS expected destination URL must block publication",
  )
  yield* assertSmoke(
    !invalidAllowedHostPolicy.publishable &&
      invalidAllowedHostPolicy.reason_codes.includes(
        "destination_policy_host_invalid",
      ),
    "malformed allowed host must block publication",
  )

  yield* Console.log(
    JSON.stringify(
      {
        exact_host: summary(exactHost),
        unproven_operational_host: summary(unprovenOperationalHost),
        explicit_subdomain_policy: summary(explicitSubdomainPolicy),
        pending_proof: summary(pendingProof),
        inactive_issuer: summary(inactiveIssuer),
        empty_policy: summary(emptyPolicy),
        invalid_policy: summary(invalidPolicy),
        non_https_policy: summary(nonHttpsPolicy),
        invalid_allowed_host_policy: summary(invalidAllowedHostPolicy),
      },
      null,
      2,
    ),
  )
})

const policyForHosts = (
  hosts: ReadonlyArray<string>,
): DestinationPolicyProjection => ({
  ...demoDestinationPolicyProjection,
  approved_destinations: [
    {
      ...demoDestinationPolicyProjection.approved_destinations[0]!,
      expected_final_url: `https://${hosts[0] ?? "acme.example"}/pay`,
      allowed_hosts: hosts,
      allow_subdomains: false,
    },
  ],
  allowed_hosts: hosts,
  allow_subdomains: false,
})

const summary = (decision: ReturnType<typeof evaluateDestinationPolicyPublicationGate>) => ({
  publication_status: decision.publication_status,
  verified_hosts: decision.verified_hosts,
  blocked_hosts: decision.blocked_hosts,
  reason_codes: decision.reason_codes,
})

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Destination policy publication gate smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
