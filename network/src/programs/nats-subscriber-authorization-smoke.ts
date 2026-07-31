import { Effect } from "effect"

import {
  loadNatsSubscriberAuthorization,
  natsGovernanceConsumerFilterConfig,
  natsSubscriberMaterializationSubjectsForStream,
  natsSubscriberSubjectMatchesStream,
  natsSubscriberSubjectAllowed,
  natsSubscriberSubjectsForStream,
} from "../index.js"

const queryCalls: Array<{
  readonly text: string
  readonly values?: ReadonlyArray<unknown>
}> = []

const executor = {
  query: async (text: string, values?: ReadonlyArray<unknown>) => {
    queryCalls.push(values ? { text, values } : { text })
    return {
      rows: [
        {
          subscriber_id: "subscriber:verifier-node-a",
          durable_name: "verifier_node_a",
          subjects: [
            "qrtrust.*.issuer.>",
            "qrtrust.*.destination.>",
            "qrtrust.*.runtime.>",
            "qrtrust.*.scanner.>",
          ],
        },
      ],
    }
  },
}

const broadSubjectExecutor = {
  query: async () => ({
    rows: [
      {
        subscriber_id: "subscriber:too-broad",
        durable_name: "too_broad",
        subjects: ["qrtrust.>"],
      },
    ],
  }),
}

const malformedSubjectExecutors = [
  {
    subject: "qrtrust.bad root.issuer.record.v1",
    executor: {
      query: async () => ({
        rows: [
          {
            subscriber_id: "subscriber:malformed",
            durable_name: "malformed",
            subjects: ["qrtrust.bad root.issuer.record.v1"],
          },
        ],
      }),
    },
  },
  {
    subject: "qrtrust.root:qrtrust-demo:2026.issuer.record.v1",
    executor: {
      query: async () => ({
        rows: [
          {
            subscriber_id: "subscriber:malformed",
            durable_name: "malformed",
            subjects: ["qrtrust.root:qrtrust-demo:2026.issuer.record.v1"],
          },
        ],
      }),
    },
  },
  {
    subject: "qrtrust.root-a.issuer.v1",
    executor: {
      query: async () => ({
        rows: [
          {
            subscriber_id: "subscriber:malformed",
            durable_name: "malformed",
            subjects: ["qrtrust.root-a.issuer.v1"],
          },
        ],
      }),
    },
  },
  {
    subject: "qrtrust.control-plane.issuer.record.published.v1",
    executor: {
      query: async () => ({
        rows: [
          {
            subscriber_id: "subscriber:malformed",
            durable_name: "malformed",
            subjects: ["qrtrust.control-plane.issuer.record.published.v1"],
          },
        ],
      }),
    },
  },
  {
    subject: "qrtrust.control-plane.runtime.>",
    executor: {
      query: async () => ({
        rows: [
          {
            subscriber_id: "subscriber:malformed",
            durable_name: "malformed",
            subjects: ["qrtrust.control-plane.runtime.>"],
          },
        ],
      }),
    },
  },
]

const exactRootAuthorization = {
  subscriber_id: "subscriber:root-a-runtime",
  durable_name: "root_a_runtime",
  subjects: ["qrtrust.root-a.runtime.>"],
}

const controlPlaneExecutor = {
  query: async () => ({
    rows: [
      {
        subscriber_id: "subscriber:control-plane-audit",
        durable_name: "control_plane_audit",
        subjects: [
          "qrtrust.control-plane.authority.nats-subscriber.authorization.changed.v1",
          "qrtrust.control-plane.runtime.provider.upserted.v1",
        ],
      },
    ],
  }),
}

const run = Effect.gen(function* () {
  const authorization = yield* loadNatsSubscriberAuthorization(
    executor,
    "subscriber:verifier-node-a",
  )
  const controlPlaneAuthorization = yield* loadNatsSubscriberAuthorization(
    controlPlaneExecutor,
    "subscriber:control-plane-audit",
  )

  assertSmoke(
    queryCalls[0]?.text.includes("qr_trust.nats_subscribers") === true,
    "authorization did not query subscriber registry",
  )
  assertSmoke(
    queryCalls[0]?.values?.[0] === "subscriber:verifier-node-a",
    "authorization did not bind subscriber id",
  )
  assertSmoke(
    authorization.durable_name === "verifier_node_a",
    "durable name was not decoded",
  )
  assertSmoke(
    natsSubscriberSubjectAllowed(
      authorization,
      "qrtrust.qrtrust-demo.issuer.record.published.v1",
    ),
    "authorized issuer subject was rejected",
  )
  assertSmoke(
    !natsSubscriberSubjectAllowed(
      authorization,
      "qrtrust.qrtrust-demo.issuer",
    ),
    "family wildcard matched a subject with no event tokens",
  )
  assertSmoke(
    !natsSubscriberSubjectAllowed(
      authorization,
      "qrtrust.qrtrust-demo.root.manifest.published.v1",
    ),
    "unauthorized root subject was accepted",
  )
  assertSmoke(
    JSON.stringify(natsGovernanceConsumerFilterConfig(authorization.subjects)) ===
      JSON.stringify({
        filter_subjects: [
          "qrtrust.*.issuer.>",
          "qrtrust.*.destination.>",
          "qrtrust.*.runtime.>",
          "qrtrust.*.scanner.>",
        ],
      }),
    "multi-subject subscriber authorization collapsed to one filter subject",
  )
  assertSmoke(
    JSON.stringify(
      natsSubscriberSubjectsForStream(authorization, "QRTRUST_GOVERNANCE"),
    ) ===
      JSON.stringify([
        "qrtrust.*.issuer.>",
        "qrtrust.*.destination.>",
      ]),
    "governance subscriber stream filter included off-stream subjects",
  )
  assertSmoke(
    JSON.stringify(
      natsSubscriberSubjectsForStream(authorization, "QRTRUST_RUNTIME"),
    ) === JSON.stringify(["qrtrust.*.runtime.>"]),
    "runtime subscriber stream filter included off-stream subjects",
  )
  assertSmoke(
    JSON.stringify(
      natsSubscriberMaterializationSubjectsForStream(
        authorization,
        "QRTRUST_GOVERNANCE",
      ),
    ) ===
      JSON.stringify([
        "qrtrust.*.issuer.record.published.v1",
        "qrtrust.*.issuer.status.changed.v1",
        "qrtrust.*.destination.policy.published.v1",
        "qrtrust.*.destination.policy.revoked.v1",
      ]),
    "governance materializer did not narrow family authorization to artifact-backed subjects",
  )
  assertSmoke(
    JSON.stringify(
      natsSubscriberMaterializationSubjectsForStream(
        authorization,
        "QRTRUST_RUNTIME",
      ),
    ) === JSON.stringify(["qrtrust.*.runtime.verdict.observed.v1"]),
    "runtime materializer did not narrow authorization to runtime verdict subjects",
  )
  assertSmoke(
    JSON.stringify(
      natsSubscriberMaterializationSubjectsForStream(
        exactRootAuthorization,
        "QRTRUST_RUNTIME",
      ),
    ) === JSON.stringify(["qrtrust.root-a.runtime.verdict.observed.v1"]),
    "runtime materializer did not preserve concrete root subject scope",
  )
  assertSmoke(
    natsSubscriberSubjectAllowed(
      controlPlaneAuthorization,
      "qrtrust.control-plane.runtime.provider.upserted.v1",
    ),
    "documented control-plane management subject was rejected",
  )
  assertSmoke(
    !natsSubscriberSubjectAllowed(
      controlPlaneAuthorization,
      "qrtrust.control-plane.runtime.verdict.observed.v1",
    ),
    "control-plane authorization leaked to trust/runtime verdict subjects",
  )
  assertSmoke(
    !natsSubscriberSubjectMatchesStream(
      "QRTRUST_GOVERNANCE",
      "qrtrust.*.runtime.>",
    ),
    "runtime subject matched governance stream",
  )
  assertSmoke(
    !natsSubscriberSubjectMatchesStream(
      "QRTRUST_RUNTIME",
      "qrtrust.root-a.runtime",
    ),
    "malformed runtime subject matched runtime stream",
  )

  const broadSubjectRejected = yield* loadNatsSubscriberAuthorization(
    broadSubjectExecutor,
    "subscriber:too-broad",
  ).pipe(
    Effect.as(false),
    Effect.catchAll(() => Effect.succeed(true)),
  )
  assertSmoke(
    broadSubjectRejected,
    "over-broad subscriber subject was accepted from authorization rows",
  )

  for (const malformed of malformedSubjectExecutors) {
    const malformedSubjectRejected = yield* loadNatsSubscriberAuthorization(
      malformed.executor,
      "subscriber:malformed",
    ).pipe(
      Effect.as(false),
      Effect.catchAll(() => Effect.succeed(true)),
    )
    assertSmoke(
      malformedSubjectRejected,
      `malformed subscriber subject was accepted from authorization rows: ${malformed.subject}`,
    )
  }

  console.log(
    JSON.stringify(
      {
        nats_subscriber_authorization_smoke: "passed",
        subscriber_id: authorization.subscriber_id,
        durable_name: authorization.durable_name,
        subjects: authorization.subjects,
      },
      null,
      2,
    ),
  )
})

function assertSmoke(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`NATS subscriber authorization smoke failed: ${message}`)
  }
}

Effect.runPromise(run).catch((cause) => {
  console.error(cause)
  process.exitCode = 1
})
