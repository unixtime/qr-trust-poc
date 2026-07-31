import { Console, Effect } from "effect"

import {
  demoDestinationPolicyProjection,
  demoIssuerProjection,
  makeArtifactPublicationService,
  makeDestinationPolicyPublicationService,
  makeInMemoryArtifactStore,
  makeInMemoryEventBus,
  type DestinationPolicyProjection,
  type DestinationPolicyPublicationGateDecision,
  type DomainProofRecord,
  type IssuerEnrollmentProjection,
  type NetworkError,
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

const verifiedCheckoutProof: DomainProofRecord = {
  ...verifiedAcmeProof,
  domain: "checkout.acme.example",
  evidence_ref: "evidence://domain/checkout.acme.example/dns-txt",
}

const program = Effect.gen(function* () {
  const artifactStore = makeInMemoryArtifactStore()
  const eventBus = makeInMemoryEventBus()
  const artifactPublisher = makeArtifactPublicationService(artifactStore, eventBus)
  const policyPublisher =
    makeDestinationPolicyPublicationService(artifactPublisher)

  const published = yield* policyPublisher.publishDestinationPolicy({
    issuer: activeIssuer,
    destination_policy: policyForHosts([
      "acme.example",
      "checkout.acme.example",
    ]),
    domain_proofs: [verifiedAcmeProof, verifiedCheckoutProof],
    artifact_id: "art_policy_acme_guarded_v1",
    version: 1,
    occurredAt: observedAt,
    reason: "guarded destination policy smoke publication",
  })

  const storedArtifact = yield* artifactStore.get("art_policy_acme_guarded_v1")
  const eventsAfterSuccess = yield* eventBus.recent()

  const blockedMissingProof = yield* Effect.either(
    policyPublisher.publishDestinationPolicy({
      issuer: activeIssuer,
      destination_policy: policyForHosts([
        "acme.example",
        "checkout.acme.example",
      ]),
      domain_proofs: [verifiedAcmeProof],
      artifact_id: "art_policy_missing_checkout_proof_v1",
      version: 1,
      occurredAt: observedAt,
    }),
  )
  const blockedMissingProofGate = gateFromPolicyPublicationFailure(
    blockedMissingProof,
  )

  const blockedNamespaceMismatch = yield* Effect.either(
    policyPublisher.publishDestinationPolicy({
      issuer: activeIssuer,
      destination_policy: {
        ...policyForHosts(["acme.example"]),
        namespace: {
          ...demoIssuerProjection.namespace,
          issuer_id: "issuer:other-demo",
        },
      },
      domain_proofs: [verifiedAcmeProof],
      artifact_id: "art_policy_namespace_mismatch_v1",
      version: 1,
      occurredAt: observedAt,
    }),
  )
  const blockedNamespaceMismatchGate = gateFromPolicyPublicationFailure(
    blockedNamespaceMismatch,
  )

  const blockedHttpDestination = yield* Effect.either(
    policyPublisher.publishDestinationPolicy({
      issuer: activeIssuer,
      destination_policy: {
        ...policyForHosts(["acme.example"]),
        approved_destinations: [
          {
            ...demoDestinationPolicyProjection.approved_destinations[0]!,
            expected_final_url: "http://acme.example/pay",
            allowed_hosts: ["acme.example"],
            allow_subdomains: false,
          },
        ],
      },
      domain_proofs: [verifiedAcmeProof],
      artifact_id: "art_policy_http_destination_v1",
      version: 1,
      occurredAt: observedAt,
    }),
  )

  const blockedBadAllowedHost = yield* Effect.either(
    policyPublisher.publishDestinationPolicy({
      issuer: activeIssuer,
      destination_policy: {
        ...policyForHosts(["acme.example"]),
        approved_destinations: [
          {
            ...demoDestinationPolicyProjection.approved_destinations[0]!,
            expected_final_url: "https://acme.example/pay",
            allowed_hosts: ["acme.example/pay"],
            allow_subdomains: false,
          },
        ],
      },
      domain_proofs: [verifiedAcmeProof],
      artifact_id: "art_policy_bad_allowed_host_v1",
      version: 1,
      occurredAt: observedAt,
    }),
  )

  const missingProofArtifact = yield* artifactStore.get(
    "art_policy_missing_checkout_proof_v1",
  )
  const namespaceMismatchArtifact = yield* artifactStore.get(
    "art_policy_namespace_mismatch_v1",
  )
  const httpDestinationArtifact = yield* artifactStore.get(
    "art_policy_http_destination_v1",
  )
  const badAllowedHostArtifact = yield* artifactStore.get(
    "art_policy_bad_allowed_host_v1",
  )
  const eventsAfterFailures = yield* eventBus.recent()

  yield* assertSmoke(
    published.gate.publishable &&
      published.gate.verified_hosts.includes("checkout.acme.example"),
    "verified policy did not pass the publication gate",
  )
  yield* assertSmoke(
    storedArtifact?.artifact_type === "destination_policy" &&
      storedArtifact.artifact_id === "art_policy_acme_guarded_v1",
    "publishable policy did not write a destination-policy artifact",
  )
  yield* assertSmoke(
    eventsAfterSuccess.length === 1 &&
      eventsAfterSuccess[0]?.envelope.type === "destination.policy.published",
    "publishable policy did not emit the destination-policy publication event",
  )
  yield* assertSmoke(
    blockedMissingProof._tag === "Left" &&
      blockedMissingProof.left._tag === "PolicyPublicationError" &&
      blockedMissingProofGate?.blocked_hosts.includes("checkout.acme.example") ===
        true,
    "missing host proof should fail before artifact publication",
  )
  yield* assertSmoke(
    blockedNamespaceMismatch._tag === "Left" &&
      blockedNamespaceMismatch.left._tag === "PolicyPublicationError" &&
      blockedNamespaceMismatchGate?.reason_codes.includes(
        "destination_policy_issuer_namespace_mismatch",
      ) === true,
    "issuer and destination-policy namespace mismatch should fail closed",
  )
  yield* assertSmoke(
    blockedHttpDestination._tag === "Left" &&
      blockedHttpDestination.left._tag === "ContractValidationError",
    "non-HTTPS expected final URL should fail before artifact publication",
  )
  yield* assertSmoke(
    blockedBadAllowedHost._tag === "Left" &&
      blockedBadAllowedHost.left._tag === "ContractValidationError",
    "malformed allowed host should fail before artifact publication",
  )
  yield* assertSmoke(
    !missingProofArtifact &&
      !namespaceMismatchArtifact &&
      !httpDestinationArtifact &&
      !badAllowedHostArtifact &&
      eventsAfterFailures.length === eventsAfterSuccess.length,
    "blocked policy publication wrote an artifact or event",
  )

  yield* Console.log(
    JSON.stringify(
      {
        published: {
          artifact_id: published.publication.artifact.artifact_id,
          event_id: published.publication.event.envelope.event_id,
          verified_hosts: published.gate.verified_hosts,
        },
        missing_proof_block: blockedMissingProofGate
          ? summary(blockedMissingProofGate)
          : "unexpected_success",
        namespace_mismatch_block: blockedNamespaceMismatchGate
          ? summary(blockedNamespaceMismatchGate)
          : "unexpected_success",
        event_count: eventsAfterFailures.length,
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

const gateFromPolicyPublicationFailure = (
  result: { readonly _tag: "Left"; readonly left: NetworkError } | { readonly _tag: "Right" },
): DestinationPolicyPublicationGateDecision | undefined =>
  result._tag === "Left" && result.left._tag === "PolicyPublicationError"
    ? (result.left.cause as DestinationPolicyPublicationGateDecision)
    : undefined

const summary = (gate: DestinationPolicyPublicationGateDecision) => ({
  publication_status: gate.publication_status,
  verified_hosts: gate.verified_hosts,
  blocked_hosts: gate.blocked_hosts,
  reason_codes: gate.reason_codes,
})

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Destination policy publication smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
