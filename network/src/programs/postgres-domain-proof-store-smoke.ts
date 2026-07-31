import { Console, Effect } from "effect"

import {
  decodePostgresDomainProofRows,
  demoDestinationPolicyProjection,
  demoIssuerProjection,
  evaluateDomainProofBoundary,
  makePostgresDomainProofStore,
  makeRecordingPostgresDomainProofStoreExecutor,
  type DestinationPolicyProjection,
  type IssuerEnrollmentProjection,
  type PostgresDomainProofRow,
} from "../index.js"

const observedAt = new Date("2026-05-20T00:00:00Z")

const activeIssuer: IssuerEnrollmentProjection = {
  namespace: demoIssuerProjection.namespace,
  issuer_display_name: demoIssuerProjection.issuer_display_name,
  assurance_tier: demoIssuerProjection.assurance_tier,
  enrollment_status: "active",
}

const rows: ReadonlyArray<PostgresDomainProofRow> = [
  {
    domain_proof_id: "00000000-0000-4000-8000-000000000001",
    ...demoIssuerProjection.namespace,
    domain: "acme.example",
    proof_method: "dns_txt",
    verification_status: "verified",
    verified_at: "2026-05-01T00:00:00Z",
    expires_at: "2026-12-31T23:59:59Z",
    evidence_ref: "evidence://domain/acme.example/dns-txt",
  },
  {
    domain_proof_id: "00000000-0000-4000-8000-000000000002",
    ...demoIssuerProjection.namespace,
    domain: "checkout.acme.example",
    proof_method: "https_well_known",
    verification_status: "pending",
    verified_at: null,
    expires_at: "2026-12-31T23:59:59Z",
    evidence_ref: "evidence://domain/checkout.acme.example/well-known",
  },
  {
    domain_proof_id: "00000000-0000-4000-8000-000000000003",
    ...demoIssuerProjection.namespace,
    domain: "expired.acme.example",
    proof_method: "manual_review",
    verification_status: "verified",
    verified_at: "2026-01-01T00:00:00Z",
    expires_at: "2026-05-01T00:00:00Z",
    evidence_ref: "evidence://domain/expired.acme.example/manual-review",
  },
  {
    domain_proof_id: "00000000-0000-4000-8000-000000000004",
    root_program_id: demoIssuerProjection.namespace.root_program_id,
    delegated_authority_id:
      demoIssuerProjection.namespace.delegated_authority_id,
    issuer_id: "issuer:other-demo",
    domain: "other.acme.example",
    proof_method: "dns_txt",
    verification_status: "verified",
    verified_at: "2026-05-01T00:00:00Z",
    expires_at: "2026-12-31T23:59:59Z",
    evidence_ref: "evidence://domain/other.acme.example/dns-txt",
  },
]

const program = Effect.gen(function* () {
  const executor = makeRecordingPostgresDomainProofStoreExecutor(rows)
  const store = makePostgresDomainProofStore(executor)
  const proofs = yield* store.loadIssuerDomainProofs(demoIssuerProjection.namespace)
  const decoded = yield* decodePostgresDomainProofRows([
    {
      ...rows[0],
      verified_at: new Date("2026-05-01T00:00:00Z"),
      expires_at: new Date("2026-12-31T23:59:59Z"),
    },
  ])

  const verified = evaluateDomainProofBoundary({
    issuer: activeIssuer,
    destination_policy: demoDestinationPolicyProjection,
    domain_proofs: proofs,
    destination_url: new URL("https://acme.example/pay"),
    observed_at: observedAt,
  })
  const pending = evaluateDomainProofBoundary({
    issuer: activeIssuer,
    destination_policy: demoDestinationPolicyProjection,
    domain_proofs: proofs,
    destination_url: new URL("https://checkout.acme.example/pay"),
    observed_at: observedAt,
  })
  const expired = evaluateDomainProofBoundary({
    issuer: activeIssuer,
    destination_policy: policyForHost("expired.acme.example"),
    domain_proofs: proofs,
    destination_url: new URL("https://expired.acme.example/pay"),
    observed_at: observedAt,
  })

  const recorded = executor.recorded()

  yield* assertSmoke(
    recorded[0]?.name === "issuer_domain_proofs.by_issuer",
    "domain proof store did not issue the scoped lookup command",
  )
  yield* assertSmoke(
    proofs.length === 3,
    "domain proof store did not scope rows to the issuer namespace",
  )
  yield* assertSmoke(
    decoded[0]?.verified_at === "2026-05-01T00:00:00.000Z" &&
      decoded[0]?.expires_at === "2026-12-31T23:59:59.000Z",
    "domain proof decoder did not normalize Postgres timestamps",
  )
  yield* assertSmoke(
    verified.destination_binding_support === "supports_binding" &&
      verified.domain_control === "verified",
    "verified persisted proof did not support destination binding",
  )
  yield* assertSmoke(
    pending.destination_binding_support === "does_not_support_binding" &&
      pending.domain_control === "pending",
    "pending persisted proof incorrectly supported destination binding",
  )
  yield* assertSmoke(
    expired.destination_binding_support === "does_not_support_binding" &&
      expired.domain_control === "expired",
    "expired persisted proof incorrectly supported destination binding",
  )

  yield* Console.log(
    JSON.stringify(
      {
        loaded_proofs: proofs.map((proof) => ({
          domain: proof.domain,
          verification_status: proof.verification_status,
          expires_at: proof.expires_at,
        })),
        decoded_timestamp: decoded[0]?.verified_at,
        verified_domain: verified,
        pending_domain: pending,
        expired_domain: expired,
        command_names: recorded.map((command) => command.name),
      },
      null,
      2,
    ),
  )
})

const policyForHost = (host: string): DestinationPolicyProjection => ({
  ...demoDestinationPolicyProjection,
  approved_destinations: [
    {
      ...demoDestinationPolicyProjection.approved_destinations[0]!,
      expected_final_url: `https://${host}/pay`,
      allowed_hosts: [host],
    },
  ],
  allowed_hosts: [host],
})

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Postgres domain proof store smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
