import {
  connectNatsJs,
  ensureQrTrustJetStreamStreams,
  hashJson,
  jetStreamMessageFromEvent,
  makeInMemoryArtifactStore,
  makeInMemoryEventBus,
  makeInMemoryVerifierCache,
  makeVerifierSyncService,
  persistenceError,
  runNatsGovernanceSubscriber,
  type NetworkEvent,
  type SignatureVerifierShape,
  type VerifierCacheWriterShape,
} from "../index.js"
import { Effect } from "effect"
import { DeliverPolicy, StringCodec, headers } from "nats"

const publisherUrl =
  process.env.QRTRUST_NETWORK_NATS_PUBLISHER_URL ??
  process.env.QRTRUST_NETWORK_NATS_URL ??
  "nats://127.0.0.1:4222"
const publisherUser =
  process.env.QRTRUST_NETWORK_NATS_PUBLISHER_USER ?? "qrtrust_outbox_worker"
const publisherPassword =
  process.env.QRTRUST_NETWORK_NATS_PUBLISHER_PASSWORD ??
  "qrtrust_outbox_worker_dev"
const subscriberUrl =
  process.env.QRTRUST_NETWORK_NATS_URL ?? "nats://127.0.0.1:4222"
const subscriberUser =
  process.env.QRTRUST_NETWORK_NATS_USER ?? "qrtrust_governance_subscriber"
const subscriberPassword =
  process.env.QRTRUST_NETWORK_NATS_PASSWORD ??
  "qrtrust_governance_subscriber_dev"

const codec = StringCodec()

async function main(): Promise<void> {
  const suffix = `${Date.now()}-${process.pid}`
  const durableName = `qrtrust_governance_subscriber_smoke_${suffix}`.replace(
    /[^A-Za-z0-9_-]/g,
    "_",
  )
  const artifactBody = {
    artifact_type: "destination_policy",
    root_program_id: "root:qrtrust-demo:2026",
    delegated_authority_id: "authority:qrtrust-demo:merchant-web",
    issuer_id: "issuer:acme-demo",
    destination_policy_id: "policy:acme-demo:web-payments:v1",
    approved_destinations: [
      {
        destination_id: "dest:acme-demo:pay",
        expected_final_url: "https://acme.example/pay",
        allowed_hosts: ["acme.example"],
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
    publication: {
      published_at: "2026-05-25T00:00:00Z",
      valid_until: "2026-12-31T23:59:59Z",
    },
    signed_by: "key:smoke",
    signature_status: "ed25519-signed",
    signature_algorithm_id: "ed25519",
    signature_input: "canonical-json-excluding-signature",
    signature: "smoke-signature",
  }
  const artifactHash = `sha256:${hashJson(artifactBody)}`
  const artifactId = `artifact:governance-subscriber-smoke:${suffix}`
  const envelope = {
    event_id: `evt_governance_subscriber_smoke_${suffix}`,
    type: "destination.policy.published",
    occurred_at: "2026-05-25T00:00:00Z",
    root_program_id: "root:qrtrust-demo:2026",
    delegated_authority_id: "authority:qrtrust-demo:merchant-web",
    issuer_id: "issuer:acme-demo",
    destination_policy_id: "policy:acme-demo:web-payments:v1",
    artifact_id: artifactId,
    artifact_hash: artifactHash,
    artifact_ref: `memory://${artifactId}`,
    version: 1,
  }
  const event: NetworkEvent = { envelope }
  const message = await Effect.runPromise(jetStreamMessageFromEvent(event))
  const messageHeaders = headers()
  for (const [key, value] of Object.entries(message.headers)) {
    messageHeaders.set(key, value)
  }

  const publisher = await Effect.runPromise(
    connectNatsJs({
      servers: publisherUrl,
      name: "qrtrust-governance-subscriber-smoke-publisher",
      user: publisherUser,
      pass: publisherPassword,
      timeout_ms: 2_000,
    }),
  )
  const subscriber = await Effect.runPromise(
    connectNatsJs({
      servers: subscriberUrl,
      name: "qrtrust-governance-subscriber-smoke-subscriber",
      user: subscriberUser,
      pass: subscriberPassword,
      timeout_ms: 2_000,
    }),
  )

  try {
    const manager = await publisher.jetstreamManager()
    await Effect.runPromise(ensureQrTrustJetStreamStreams(manager))

    await publisher.jetstream().publish(
      message.subject,
      codec.encode(message.payload),
      {
        msgID: envelope.event_id,
        expect: { streamName: message.stream },
        headers: messageHeaders,
        timeout: 2_000,
      },
    )

    const eventBus = makeInMemoryEventBus()
    const cache = makeCountingVerifierCache()
    const syncService = makeVerifierSyncService(
      makeInMemoryArtifactStore([
        {
          artifact_id: artifactId,
          artifact_hash: artifactHash,
          artifact_type: "destination_policy",
          version: 1,
          body: artifactBody,
        },
      ]),
      eventBus,
      cache,
      acceptingSignatureVerifier,
    )

    const report = await Effect.runPromise(
      runNatsGovernanceSubscriber(
        subscriber,
        {
          durable_name: durableName,
          filter_subject: message.subject,
          max_messages: 1,
          expires_ms: 2_000,
          deliver_policy: DeliverPolicy.Last,
          delete_consumer_on_stop: true,
        },
        {
          syncReference: (event: NetworkEvent) => {
            if (event.envelope.artifact_id !== artifactId) {
              return Effect.fail(
                persistenceError(
                  "Subscriber consumed the wrong governance reference.",
                  event.envelope,
                ),
              )
            }

            return eventBus
              .publish(event)
              .pipe(Effect.flatMap(() => syncService.syncRecent()))
          },
        },
      ),
    )

    assertSmoke(report.consumed_messages === 1, "expected one consumed message")
    assertSmoke(report.sync_runs === 1, "expected one sync run")
    assertSmoke(
      report.last_sync_report?.fetched_artifacts === 1,
      "expected sync to fetch the referenced artifact",
    )
    assertSmoke(
      cache.destination_policy_upserts === 1,
      "expected sync to materialize the referenced destination policy",
    )

    console.log(
      JSON.stringify(
        {
          nats_governance_subscriber_smoke: "passed",
          subject: message.subject,
          durable_name: durableName,
          report,
          destination_policy_upserts: cache.destination_policy_upserts,
        },
        null,
        2,
      ),
    )
  } finally {
    await drainQuietly(publisher)
    await drainQuietly(subscriber)
  }
}

const acceptingSignatureVerifier: SignatureVerifierShape = {
  verifyTrustArtifact: (artifact) =>
    Effect.succeed({
      accepted: true,
      signer: artifact.signed_by,
      reason: "signature_verified",
    }),
}

const makeCountingVerifierCache = (): VerifierCacheWriterShape & {
  readonly destination_policy_upserts: number
} => {
  const cache = makeInMemoryVerifierCache()
  let destinationPolicyUpserts = 0

  return {
    ...cache,
    upsertDestinationPolicy: (projection) =>
      cache.upsertDestinationPolicy(projection).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            destinationPolicyUpserts += 1
          }),
        ),
      ),
    get destination_policy_upserts() {
      return destinationPolicyUpserts
    },
  }
}

async function drainQuietly(connection: {
  drain: () => Promise<void>
}): Promise<void> {
  try {
    await connection.drain()
  } catch {
    // The smoke should report the first authorization or delivery failure.
  }
}

function assertSmoke(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`NATS governance subscriber smoke failed: ${message}`)
  }
}

await main().catch((cause: unknown) => {
  console.error(cause)
  process.exitCode = 1
})
