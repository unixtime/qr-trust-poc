import { Console, Effect } from "effect"

import {
  decodePostgresDestinationPolicyIssuerRows,
  makePostgresDestinationPolicyPublicationContextResolver,
  makeRecordingPostgresDestinationPolicyPublicationContextExecutor,
  type ArtifactPublicationInput,
  type DestinationPolicyProjection,
  type IssuerNamespace,
  type PostgresDestinationPolicyIssuerRow,
  type PostgresDomainProofRow,
} from "../index.js"

const observedAt = new Date("2026-05-17T00:00:00Z")
const namespace = {
  root_program_id: "root:qrtrust-demo:2026",
  delegated_authority_id: "authority:qrtrust-demo:merchant-web",
  issuer_id: "issuer:acme-demo",
}

const program = Effect.gen(function* () {
  const executor =
    makeRecordingPostgresDestinationPolicyPublicationContextExecutor(
      [issuerRow(namespace)],
      [
        domainProofRow("11111111-1111-4111-8111-111111111111", namespace, "acme.example"),
        domainProofRow(
          "22222222-2222-4222-8222-222222222222",
          namespace,
          "checkout.acme.example",
        ),
      ],
    )
  const resolver =
    makePostgresDestinationPolicyPublicationContextResolver(executor)

  const context = yield* resolver.resolveDestinationPolicyContext(
    artifactInput(namespace),
    destinationPolicy(namespace),
  )
  const missingIssuer = yield* resolver
    .resolveDestinationPolicyContext(
      artifactInput({ ...namespace, issuer_id: "issuer:missing" }),
      destinationPolicy({ ...namespace, issuer_id: "issuer:missing" }),
    )
    .pipe(Effect.either)
  const decodedRows = yield* decodePostgresDestinationPolicyIssuerRows([
    {
      root_program_id: namespace.root_program_id,
      delegated_authority_id: namespace.delegated_authority_id,
      issuer_id: namespace.issuer_id,
      display_name: "ACME Demo",
      assurance_tier: "verified_business",
      enrollment_status: "active",
    },
  ])

  yield* assertSmoke(
    context.issuer.issuer_display_name === "ACME Demo" &&
      context.domain_proofs.length === 2,
    "resolver did not load issuer enrollment plus issuer domain proofs",
  )
  yield* assertSmoke(
    missingIssuer._tag === "Left" &&
      missingIssuer.left._tag === "PersistenceError",
    "resolver did not fail closed when issuer enrollment was missing",
  )
  yield* assertSmoke(
    decodedRows[0]?.issuer_id === namespace.issuer_id,
    "issuer-row decoder did not preserve issuer namespace",
  )

  yield* Console.log(
    JSON.stringify(
      {
        postgres_destination_policy_context_smoke: "passed",
        issuer: context.issuer,
        domain_proofs: context.domain_proofs.map((proof) => proof.domain),
        missing_issuer_error: missingIssuer._tag,
        command_names: executor.recorded().map((command) => command.name),
      },
      null,
      2,
    ),
  )
})

const issuerRow = (
  issuerNamespace: IssuerNamespace,
): PostgresDestinationPolicyIssuerRow => ({
  root_program_id: issuerNamespace.root_program_id,
  delegated_authority_id: issuerNamespace.delegated_authority_id,
  issuer_id: issuerNamespace.issuer_id,
  display_name: "ACME Demo",
  assurance_tier: "verified_business",
  enrollment_status: "active",
})

const domainProofRow = (
  domainProofId: string,
  issuerNamespace: IssuerNamespace,
  domain: string,
): PostgresDomainProofRow => ({
  domain_proof_id: domainProofId,
  root_program_id: issuerNamespace.root_program_id,
  delegated_authority_id: issuerNamespace.delegated_authority_id,
  issuer_id: issuerNamespace.issuer_id,
  domain,
  proof_method: "dns_txt",
  verification_status: "verified",
  verified_at: observedAt.toISOString(),
  expires_at: "2026-12-31T23:59:59Z",
  evidence_ref: `proof:${domain}`,
})

const artifactInput = (
  issuerNamespace: IssuerNamespace,
): ArtifactPublicationInput => ({
  artifact_type: "destination_policy",
  artifact_id: "art_policy_context_v1",
  version: 1,
  root_program_id: issuerNamespace.root_program_id,
  delegated_authority_id: issuerNamespace.delegated_authority_id,
  issuer_id: issuerNamespace.issuer_id,
  destination_policy_id: "policy:acme-demo:web-payments:v1",
  body: {},
  occurredAt: observedAt,
  eventType: "destination.policy.published",
})

const destinationPolicy = (
  issuerNamespace: IssuerNamespace,
): DestinationPolicyProjection => ({
  namespace: issuerNamespace,
  destination_policy_id: "policy:acme-demo:web-payments:v1",
  approved_destinations: [
    {
      destination_id: "dest:acme-demo:pay",
      expected_final_url: "https://acme.example/pay",
      allowed_hosts: ["acme.example", "checkout.acme.example"],
      allow_subdomains: false,
      path_prefixes: ["/pay"],
      query_policy: "allow_known_payment_query",
    },
  ],
  redirect_policy: {
    resolver_urls: ["https://qr.acme.example/r/pay"],
    expected_final_destinations: ["https://acme.example/pay"],
    allowed_redirect_hosts: ["acme.example"],
    max_redirect_hops: 1,
    nested_shorteners_allowed: false,
    scanner_must_display_resolver_and_final_destination: true,
  },
  allowed_hosts: ["acme.example", "checkout.acme.example"],
  allow_subdomains: false,
  cache_generated_at: observedAt.toISOString(),
  cache_expires_at: "2026-12-31T23:59:59Z",
})

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(
        `Postgres destination-policy context smoke failed: ${message}`,
      )
    }
  })

Effect.runPromise(program)
