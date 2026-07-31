import { Console, Effect } from "effect"

import {
  EventBus,
  InMemoryEventBusLive,
  decodePostgresArtifactPublicationWorkItemRows,
  destinationPolicyArtifactBody,
  makeArtifactPublicationQueueWorker,
  makeArtifactPublicationService,
  makeDestinationPolicyAwareArtifactPublicationService,
  makeInMemoryArtifactStore,
  makePostgresArtifactPublicationQueueStore,
  makePostgresDestinationPolicyPublicationContextResolver,
  makeRecordingPostgresDestinationPolicyPublicationContextExecutor,
  referenceRootManifestBody,
  type DestinationPolicyProjection,
  type IssuerNamespace,
  type PostgresArtifactPublicationQueueExecutorShape,
  type PostgresDestinationPolicyIssuerRow,
  type PostgresDomainProofRow,
  type SqlCommand,
} from "../index.js"

const observedAt = new Date("2026-05-17T00:00:00Z")
const rootProgramId = "root:qrtrust-demo:2026"
const namespace = {
  root_program_id: rootProgramId,
  delegated_authority_id: "authority:qrtrust-demo:merchant-web",
  issuer_id: "issuer:acme-demo",
}
const blockedNamespace = {
  ...namespace,
  issuer_id: "issuer:acme-demo-incomplete-domain-proof",
}

const program = Effect.gen(function* () {
  const eventBus = yield* EventBus
  const artifactStore = makeInMemoryArtifactStore()
  const basePublisher = makeArtifactPublicationService(artifactStore, eventBus)
  const contextExecutor =
    makeRecordingPostgresDestinationPolicyPublicationContextExecutor(
      [issuerRow(namespace), issuerRow(blockedNamespace)],
      [
        domainProofRow(namespace, "acme.example"),
        domainProofRow(namespace, "checkout.acme.example"),
        domainProofRow(blockedNamespace, "acme.example"),
      ],
    )
  const policyPublisher = makeDestinationPolicyAwareArtifactPublicationService(
    basePublisher,
    makePostgresDestinationPolicyPublicationContextResolver(contextExecutor),
  )

  const executor = makeRecordingQueueExecutor([
    rootManifestRow(),
    destinationPolicyRow(
      "22222222-2222-4222-8222-222222222222",
      "art_policy_queue_guarded_v1",
    ),
    destinationPolicyRow(
      "33333333-3333-4333-8333-333333333333",
      "art_policy_queue_blocked_v1",
      blockedNamespace,
    ),
  ])
  const queueWorker = makeArtifactPublicationQueueWorker(
    makePostgresArtifactPublicationQueueStore(executor),
    policyPublisher,
    {
      worker_id: "worker:destination-policy-queue-smoke",
      batch_size: 3,
      now: () => observedAt,
    },
  )

  const report = yield* queueWorker.processOnce()
  const events = yield* eventBus.recent()
  const rootArtifact = yield* artifactStore.get("art_root_queue_guarded_v1")
  const policyArtifact = yield* artifactStore.get("art_policy_queue_guarded_v1")
  const blockedArtifact = yield* artifactStore.get("art_policy_queue_blocked_v1")

  yield* assertSmoke(
    report.claimed === 3 && report.completed === 2 && report.failed === 1,
    "queue worker did not split generic success, guarded policy success, and guarded policy failure",
  )
  yield* assertSmoke(
    rootArtifact?.artifact_type === "root_manifest" &&
      policyArtifact?.artifact_type === "destination_policy",
    "successful queue items did not publish root and destination-policy artifacts",
  )
  yield* assertSmoke(
    blockedArtifact === undefined && events.length === 2,
    "blocked destination-policy queue item wrote an artifact or emitted an event",
  )
  yield* assertSmoke(
    events.some((event) => event.envelope.type === "destination.policy.published"),
    "guarded destination-policy queue item did not emit the canonical publication event",
  )
  yield* assertSmoke(
    report.failures[0]?.reason.includes(
      "Destination policy publication blocked by domain-control gate.",
    ) === true,
    "guarded destination-policy failure did not preserve the gate reason",
  )

  yield* Console.log(
    JSON.stringify(
      {
        destination_policy_queue_publication_smoke: "passed",
        claimed: report.claimed,
        completed: report.completed,
        failed: report.failed,
        successes: report.successes.map((success) => ({
          work_item_id: success.work_item_id,
          artifact_id: success.artifact_id,
          event_id: success.event_id,
        })),
        failures: report.failures,
        event_types: events.map((event) => event.envelope.type),
        queue_command_names: executor
          .recorded()
          .map((command) => command.name),
        context_command_names: contextExecutor
          .recorded()
          .map((command) => command.name),
      },
      null,
      2,
    ),
  )
}).pipe(Effect.provide(InMemoryEventBusLive))

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
  issuerNamespace: IssuerNamespace,
  domain: string,
): PostgresDomainProofRow => ({
  domain_proof_id: `proof-${issuerNamespace.issuer_id}-${domain}`,
  root_program_id: issuerNamespace.root_program_id,
  delegated_authority_id: issuerNamespace.delegated_authority_id,
  issuer_id: issuerNamespace.issuer_id,
  domain,
  proof_method: "dns_txt",
  verification_status: "verified",
  verified_at: "2026-05-17T00:00:00Z",
  expires_at: "2026-12-31T23:59:59Z",
  evidence_ref: `proof:${domain}`,
})

const policy = (issuerNamespace: IssuerNamespace): DestinationPolicyProjection => ({
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
  cache_generated_at: "2026-05-17T00:00:00Z",
  cache_expires_at: "2026-12-31T23:59:59Z",
})

const rootManifestRow = (): Record<string, unknown> => ({
  work_item_id: "11111111-1111-4111-8111-111111111111",
  artifact_type: "root_manifest",
  artifact_id: "art_root_queue_guarded_v1",
  version: 1,
  root_program_id: rootProgramId,
  canonical_json: JSON.stringify(referenceRootManifestBody()),
  occurred_at: observedAt.toISOString(),
  event_type: "root.manifest.published",
  reason: "generic queue item should bypass destination-policy gate",
})

const destinationPolicyRow = (
  workItemId: string,
  artifactId: string,
  issuerNamespace: IssuerNamespace = namespace,
): Record<string, unknown> => ({
  work_item_id: workItemId,
  artifact_type: "destination_policy",
  artifact_id: artifactId,
  version: 1,
  root_program_id: issuerNamespace.root_program_id,
  delegated_authority_id: issuerNamespace.delegated_authority_id,
  issuer_id: issuerNamespace.issuer_id,
  destination_policy_id: "policy:acme-demo:web-payments:v1",
  canonical_json: JSON.stringify(
    destinationPolicyArtifactBody(policy(issuerNamespace)),
  ),
  occurred_at: observedAt.toISOString(),
  event_type: "destination.policy.published",
  reason: "destination policy queue publication after proof gate",
})

const makeRecordingQueueExecutor = (
  rows: ReadonlyArray<Record<string, unknown>>,
): PostgresArtifactPublicationQueueExecutorShape => {
  const commands: SqlCommand[] = []

  return {
    execute: (command) =>
      Effect.sync(() => {
        commands.push(command)
        return command
      }),
    queryArtifactPublicationWorkItems: (command) =>
      Effect.gen(function* () {
        commands.push(command)
        return yield* decodePostgresArtifactPublicationWorkItemRows(rows)
      }),
    recorded: () => [...commands],
  }
}

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(
        `Destination policy queue publication smoke failed: ${message}`,
      )
    }
  })

Effect.runPromise(program)
