import { Console, Effect } from "effect"

import {
  issuerEnrollmentByNamespaceCommand,
  makePostgresArtifactLookupCommand,
  makePostgresArtifactStore,
  makePostgresExecutorFromClient,
  makePostgresTransactionRunner,
  type PostgresQueryResultShape,
  type PostgresTransactionClientShape,
} from "../index.js"

const artifactFixture = {
  artifact_id: "art_root_qrtrust_demo_2026_v1",
  artifact_hash: "sha256:driver-smoke-root",
  artifact_type: "root_manifest",
  version: 1,
  canonical_json: {
    artifact_type: "root_manifest",
    root_program_id: "root:qrtrust-demo:2026",
  },
}

const issuerFixture = {
  root_program_id: "root:qrtrust-demo:2026",
  delegated_authority_id: "authority:qrtrust-demo:merchant-web",
  issuer_id: "issuer:acme-demo",
  display_name: "ACME Demo",
  assurance_tier: "verified_business",
  enrollment_status: "active",
}

const program = Effect.gen(function* () {
  const client = new FakePostgresClient(
    [[artifactFixture.artifact_id, artifactFixture]],
    [issuerFixture],
  )
  const executor = makePostgresExecutorFromClient(client)
  const artifactStore = makePostgresArtifactStore(executor)

  const artifact = yield* artifactStore.get(artifactFixture.artifact_id)
  const missing = yield* artifactStore.get("art_missing")
  const directLookup = yield* executor.queryOne(
    makePostgresArtifactLookupCommand(artifactFixture.artifact_id),
  )
  const issuerRows = yield* executor.queryIssuerEnrollment(
    issuerEnrollmentByNamespaceCommand({
      root_program_id: issuerFixture.root_program_id,
      delegated_authority_id: issuerFixture.delegated_authority_id,
      issuer_id: issuerFixture.issuer_id,
    }),
  )
  const missingIssuerRows = yield* executor.queryIssuerEnrollment(
    issuerEnrollmentByNamespaceCommand({
      root_program_id: issuerFixture.root_program_id,
      delegated_authority_id: issuerFixture.delegated_authority_id,
      issuer_id: "issuer:missing",
    }),
  )

  const foundArtifact = yield* requireValue(
    artifact,
    "artifact store did not decode a published artifact from a pg-style row",
  )
  yield* assertSmoke(
    isRecord(foundArtifact.body) &&
      foundArtifact.body.root_program_id === "root:qrtrust-demo:2026",
    "artifact canonical JSON body was not preserved",
  )
  yield* assertSmoke(
    missing === undefined,
    "artifact lookup must return undefined when no row exists",
  )
  yield* assertSmoke(
    directLookup?.artifact_id === artifactFixture.artifact_id,
    "direct artifact lookup command did not map to a row",
  )
  yield* assertSmoke(
    issuerRows.length === 1 &&
      issuerRows[0]?.issuer_id === issuerFixture.issuer_id &&
      issuerRows[0]?.enrollment_status === "active",
    "issuer enrollment lookup command did not decode the namespace row",
  )
  yield* assertSmoke(
    missingIssuerRows.length === 0,
    "issuer enrollment lookup must return an empty array for a missing namespace",
  )

  const transactionClient = new FakePostgresClient()
  const transactionPool = new FakePostgresPool(transactionClient)
  const transactionRunner = makePostgresTransactionRunner(transactionPool)
  const transactionResult = yield* transactionRunner.transact((tx) =>
    tx
      .execute({
        name: "fixture.write",
        text: "insert into fixture values ($1)",
        values: ["ok"],
      })
      .pipe(Effect.as("committed")),
  )

  yield* assertSmoke(
    transactionResult === "committed",
    "transaction runner did not return the successful transaction result",
  )
  yield* assertSmoke(
    transactionClient.released,
    "transaction client was not released after commit",
  )
  yield* assertSmoke(
    transactionClient.queryLog.map((query) => query.text).join(" -> ") ===
      "begin -> insert into fixture values ($1) -> commit",
    "transaction runner did not issue begin/write/commit in order",
  )

  const failingClient = new FakePostgresClient()
  failingClient.failText = "insert into fixture_fail values ($1)"
  const failingPool = new FakePostgresPool(failingClient)
  const failingRunner = makePostgresTransactionRunner(failingPool)
  const failed = yield* failingRunner
    .transact((tx) =>
      tx.execute({
        name: "fixture.fail",
        text: "insert into fixture_fail values ($1)",
        values: ["bad"],
      }),
    )
    .pipe(
      Effect.as(false),
      Effect.catchAll(() => Effect.succeed(true)),
    )

  yield* assertSmoke(failed, "failing transaction unexpectedly succeeded")
  yield* assertSmoke(
    failingClient.released,
    "transaction client was not released after rollback",
  )
  yield* assertSmoke(
    failingClient.queryLog.map((query) => query.text).join(" -> ") ===
      "begin -> insert into fixture_fail values ($1) -> rollback",
    "transaction runner did not issue begin/write/rollback in order",
  )

  yield* Console.log(
    JSON.stringify(
      {
        artifact_lookup: {
          id: foundArtifact.artifact_id,
          type: foundArtifact.artifact_type,
          hash: foundArtifact.artifact_hash,
        },
        issuer_lookup: {
          issuer_id: issuerRows[0]?.issuer_id,
          enrollment_status: issuerRows[0]?.enrollment_status,
        },
        committed_transaction: transactionClient.queryLog.map(
          (query) => query.name,
        ),
        rolled_back_transaction: failingClient.queryLog.map(
          (query) => query.name,
        ),
      },
      null,
      2,
    ),
  )
})

class FakePostgresClient implements PostgresTransactionClientShape {
  readonly queryLog: Array<{
    readonly name: string
    readonly text: string
    readonly values: ReadonlyArray<unknown>
  }> = []
  released = false
  failText: string | undefined
  private readonly artifacts: Map<string, Record<string, unknown>>
  private readonly issuers: ReadonlyArray<Record<string, unknown>>

  constructor(
    artifacts: Iterable<readonly [string, Record<string, unknown>]> = [],
    issuers: ReadonlyArray<Record<string, unknown>> = [],
  ) {
    this.artifacts = new Map(artifacts)
    this.issuers = issuers
  }

  async query(
    text: string,
    values: ReadonlyArray<unknown> = [],
  ): Promise<PostgresQueryResultShape> {
    this.queryLog.push({
      name: queryNameFor(text),
      text,
      values,
    })

    if (text === this.failText) {
      throw new Error("fixture Postgres command failed")
    }

    if (text.includes("from qr_trust.published_artifacts")) {
      const artifactId = values[0]
      const row =
        typeof artifactId === "string"
          ? this.artifacts.get(artifactId)
          : undefined

      return {
        rows: row ? [row] : [],
      }
    }

    if (text.includes("from qr_trust.issuers")) {
      const [rootProgramId, delegatedAuthorityId, issuerId] = values
      return {
        rows: this.issuers.filter(
          (row) =>
            row.root_program_id === rootProgramId &&
            row.delegated_authority_id === delegatedAuthorityId &&
            row.issuer_id === issuerId,
        ),
      }
    }

    return {
      rows: [],
    }
  }

  release(): void {
    this.released = true
  }
}

class FakePostgresPool {
  constructor(private readonly client: FakePostgresClient) {}

  async connect(): Promise<PostgresTransactionClientShape> {
    return this.client
  }

  async query(
    text: string,
    values: ReadonlyArray<unknown> = [],
  ): Promise<PostgresQueryResultShape> {
    return this.client.query(text, values)
  }
}

const queryNameFor = (text: string): string => {
  if (text === "begin") {
    return "transaction.begin"
  }
  if (text === "commit") {
    return "transaction.commit"
  }
  if (text === "rollback") {
    return "transaction.rollback"
  }

  return text
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const requireValue = <A>(
  value: A | undefined,
  message: string,
): Effect.Effect<A> =>
  Effect.sync(() => {
    if (value === undefined) {
      throw new Error(`Postgres driver smoke failed: ${message}`)
    }

    return value
  })

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Postgres driver smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
