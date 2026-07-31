import {
  AckPolicy,
  connect,
  DeliverPolicy,
  StringCodec,
  type Msg,
  type NatsConnection,
  type Subscription,
} from "nats"
import { Effect } from "effect"

import { ensureQrTrustJetStreamStreams } from "../index.js"

const natsUrl =
  process.env.QRTRUST_NETWORK_NATS_UNAUTH_URL ?? "nats://127.0.0.1:4222"
const publisherUrl =
  process.env.QRTRUST_NETWORK_NATS_PUBLISHER_URL ??
  "nats://127.0.0.1:4222"
const publisherUser =
  process.env.QRTRUST_NETWORK_NATS_PUBLISHER_USER ?? "qrtrust_outbox_worker"
const publisherPassword =
  process.env.QRTRUST_NETWORK_NATS_PUBLISHER_PASSWORD ??
  "qrtrust_outbox_worker_dev"
const scannerAuditSubscriberUrl =
  process.env.QRTRUST_NETWORK_NATS_SCANNER_AUDIT_SUBSCRIBER_URL ??
  "nats://127.0.0.1:4222"
const scannerAuditSubscriberUser =
  process.env.QRTRUST_NETWORK_NATS_SCANNER_AUDIT_SUBSCRIBER_USER ??
  "qrtrust_scanner_audit_subscriber"
const scannerAuditSubscriberPassword =
  process.env.QRTRUST_NETWORK_NATS_SCANNER_AUDIT_SUBSCRIBER_PASSWORD ??
  "qrtrust_scanner_audit_subscriber_dev"

const subject = "qrtrust.root-qrtrust-demo-2026.scanner.decision.recorded.v1"
const scannerAuditStream = "QRTRUST_SCANNER_AUDIT"
const scannerAuditDurable = "qrtrust_scanner_audit_auth_boundary_smoke"
const codec = StringCodec()

await main().catch((cause: unknown) => {
  console.error(cause)
  process.exitCode = 1
})

async function main(): Promise<void> {
  await assertAnonymousConnectionsAreRejected(natsUrl)

  const subscriber = await connect({
    servers: scannerAuditSubscriberUrl,
    name: "qrtrust-scanner-audit-approved-subscriber-smoke",
    user: scannerAuditSubscriberUser,
    pass: scannerAuditSubscriberPassword,
    timeout: 2_000,
  })
  const publisher = await connect({
    servers: publisherUrl,
    name: "qrtrust-outbox-approved-publisher-smoke",
    user: publisherUser,
    pass: publisherPassword,
    timeout: 2_000,
  })

  try {
    const publisherManager = await publisher.jetstreamManager()
    await Effect.runPromise(ensureQrTrustJetStreamStreams(publisherManager))

    const eventId = `evt_auth_boundary_smoke_${Date.now()}`
    const subscription = subscriber.subscribe(subject)
    await subscriber.flush()
    const received = withTimeout(nextMessage(subscription), 2_000)

    await publisher.jetstream().publish(
      subject,
      codec.encode(
        JSON.stringify({
          envelope: {
            event_id: eventId,
            type: "scanner.decision.recorded",
            root_program_id: "root:qrtrust-demo:2026",
          },
        }),
      ),
      { msgID: eventId },
    )

    const message = await received
    const payload = message ? codec.decode(message.data) : ""
    assertSmoke(
      payload.includes(eventId),
      "approved scanner-audit subscriber did not receive the propagated scanner event",
    )
    subscription.unsubscribe()

    const manager = await subscriber.jetstreamManager()
    await deleteConsumerIfPresent(manager, scannerAuditStream, scannerAuditDurable)
    await manager.consumers.add(scannerAuditStream, {
      durable_name: scannerAuditDurable,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.Last,
      filter_subject: subject,
    })
    const consumer = await subscriber
      .jetstream()
      .consumers.get(scannerAuditStream, scannerAuditDurable)
    const replayed = await consumer.next({ expires: 2_000 })
    const replayedPayload = replayed ? codec.decode(replayed.data) : ""
    replayed?.ack()
    await manager.consumers.delete(scannerAuditStream, scannerAuditDurable)
    assertSmoke(
      replayedPayload.includes(eventId),
      "approved scanner-audit subscriber could not replay the propagated scanner event",
    )
  } finally {
    await drainQuietly(publisher)
    await drainQuietly(subscriber)
  }

  console.log(
    JSON.stringify(
      {
        nats_auth_boundary_smoke: "passed",
        anonymous_connections: "rejected",
        approved_publisher: "accepted",
        approved_scanner_audit_subscriber: "received",
        approved_scanner_audit_durable_replay: "received",
        subject,
      },
      null,
      2,
    ),
  )
}

async function nextMessage(subscription: Subscription): Promise<Msg> {
  for await (const message of subscription) {
    return message
  }

  throw new Error("Subscription closed before a message was received.")
}

async function assertAnonymousConnectionsAreRejected(
  serverUrl: string,
): Promise<void> {
  let connection: NatsConnection | undefined
  try {
    connection = await connect({
      servers: serverUrl,
      name: "qrtrust-anonymous-rejection-smoke",
      timeout: 1_500,
    })
  } catch {
    return
  } finally {
    if (connection) {
      await drainQuietly(connection)
    }
  }

  throw new Error("NATS auth boundary failed: anonymous connection was accepted.")
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Timed out after ${timeoutMs}ms.`)),
          timeoutMs,
        )
      }),
    ])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

async function drainQuietly(connection: NatsConnection): Promise<void> {
  try {
    await connection.drain()
  } catch {
    // The smoke should report the first authorization or delivery failure.
  }
}

async function deleteConsumerIfPresent(
  manager: Awaited<ReturnType<NatsConnection["jetstreamManager"]>>,
  stream: string,
  durable: string,
): Promise<void> {
  try {
    await manager.consumers.delete(stream, durable)
  } catch {
    // A previous failed smoke may not have created the durable yet.
  }
}

function assertSmoke(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`NATS auth boundary smoke failed: ${message}`)
  }
}
