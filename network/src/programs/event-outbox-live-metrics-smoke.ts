import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { Console, Effect } from "effect"
import type { Pool } from "pg"

import {
  makePgPool,
  makePostgresEventOutboxMetricsStore,
  makePostgresExecutorFromClient,
  summarizeEventOutboxHealth,
} from "../index.js"
import { persistenceError, type NetworkError } from "../errors.js"
import type { SqlCommand } from "../services/postgres-persistence.js"
import { requireNonProductionReferenceSeedOptIn } from "./postgres-reference-seed.js"

const observedAt = new Date("2026-05-18T12:00:00Z")
const databaseUrl = process.env.QRTRUST_NETWORK_DATABASE_URL
const resetRequested =
  process.env.QRTRUST_NETWORK_LIVE_SMOKE_RESET === "true"

const runLiveMetricsSmoke = (connectionString: string) =>
  withPgPool(connectionString, (pool) =>
    Effect.gen(function* () {
      requireNonProductionReferenceSeedOptIn()
      const schemaSql = readFileSync(referenceSchemaPath(), "utf8")

      yield* runPoolCommand(
        pool,
        "reference_schema.drop",
        "drop schema if exists qr_trust cascade",
      )
      yield* runPoolCommand(pool, "reference_schema.apply", schemaSql)

      for (const command of seedOutboxCommands()) {
        yield* runPoolCommand(pool, command.name, command.text, command.values)
      }

      const metricsStore = makePostgresEventOutboxMetricsStore(
        makePostgresExecutorFromClient(pool),
      )
      const snapshot = yield* metricsStore.loadSnapshot({
        observed_at: observedAt,
        failed_row_limit: 10,
        max_retry_attempts: 4,
      })
      const health = summarizeEventOutboxHealth(snapshot)

      yield* assertSmoke(
        snapshot.pending_count === 1 &&
          snapshot.publishing_count === 1 &&
          snapshot.published_count === 1 &&
          snapshot.failed_count === 2,
        "event outbox status counts did not match seeded live rows",
      )
      yield* assertSmoke(
        snapshot.stale_claim_count === 1 &&
          snapshot.retryable_failed_count === 1,
        "stale claim or retryable-failure metrics were not detected",
      )
      yield* assertSmoke(
        snapshot.oldest_pending_age_ms === 90_000 &&
          snapshot.oldest_failed_age_ms === 180_000 &&
          snapshot.max_attempts === 5,
        "age or attempt metrics did not match deterministic seed data",
      )
      yield* assertSmoke(
        health.status === "blocked" &&
          health.reasons.includes("failed_rows") &&
          health.reasons.includes("stale_claims") &&
          health.reasons.includes("pending_lag") &&
          health.reasons.includes("retry_candidates"),
        "event outbox health summary should block on failed and stale rows",
      )

      yield* Console.log(
        JSON.stringify(
          {
            live_event_outbox_metrics_smoke: "passed",
            reset_schema: "qr_trust",
            metrics: {
              pending_count: snapshot.pending_count,
              publishing_count: snapshot.publishing_count,
              published_count: snapshot.published_count,
              failed_count: snapshot.failed_count,
              stale_claim_count: snapshot.stale_claim_count,
              retryable_failed_count: snapshot.retryable_failed_count,
              oldest_pending_age_ms: snapshot.oldest_pending_age_ms,
              oldest_failed_age_ms: snapshot.oldest_failed_age_ms,
              max_attempts: snapshot.max_attempts,
              failed_rows: snapshot.failed_rows.length,
            },
            health,
          },
          null,
          2,
        ),
      )
    }),
  )

const withPgPool = <A>(
  connectionString: string,
  use: (pool: Pool) => Effect.Effect<A, NetworkError>,
): Effect.Effect<A, NetworkError> =>
  Effect.acquireUseRelease(
    Effect.sync(() => makePgPool({ connectionString, max: 1 })),
    use,
    (pool) =>
      Effect.tryPromise({
        try: () => pool.end(),
        catch: (cause) =>
          persistenceError("Postgres pool shutdown failed.", cause),
      }).pipe(Effect.orDie),
  )

const referenceSchemaPath = (): string =>
  resolve(
    process.cwd(),
    "../docs/public/network-contracts/reference-postgres-schema.sql",
  )

const seedOutboxCommands = (): ReadonlyArray<SqlCommand> => [
  insertOutboxCommand({
    event_id: "evt_live_outbox_pending",
    event_type: "issuer.record.published",
    aggregate_type: "issuer",
    aggregate_id: "issuer:acme-demo",
    artifact_id: "art_live_pending",
    artifact_hash: "sha256:live-pending",
    publish_status: "pending",
    attempts: 0,
    created_at: "2026-05-18T11:58:30Z",
  }),
  insertOutboxCommand({
    event_id: "evt_live_outbox_stale_claim",
    event_type: "destination.policy.published",
    aggregate_type: "destination_policy",
    aggregate_id: "policy:acme-demo",
    artifact_id: "art_live_stale_claim",
    artifact_hash: "sha256:live-stale-claim",
    publish_status: "publishing",
    attempts: 1,
    claimed_by: "worker-lost",
    claimed_at: "2026-05-18T11:57:30Z",
    claim_expires_at: "2026-05-18T11:59:50Z",
    created_at: "2026-05-18T11:57:30Z",
  }),
  insertOutboxCommand({
    event_id: "evt_live_outbox_failed_retryable",
    event_type: "issuer.status.changed",
    aggregate_type: "issuer_status",
    aggregate_id: "issuer:acme-demo",
    artifact_id: "art_live_failed_retryable",
    artifact_hash: "sha256:live-failed-retryable",
    publish_status: "failed",
    attempts: 2,
    last_error: "broker unavailable",
    created_at: "2026-05-18T11:57:00Z",
  }),
  insertOutboxCommand({
    event_id: "evt_live_outbox_failed_exhausted",
    event_type: "runtime.verdict.published",
    aggregate_type: "runtime_verdict",
    aggregate_id: "runtime:acme-demo",
    artifact_id: "art_live_failed_exhausted",
    artifact_hash: "sha256:live-failed-exhausted",
    publish_status: "failed",
    attempts: 5,
    last_error: "invalid subject mapping",
    created_at: "2026-05-18T11:58:00Z",
  }),
  insertOutboxCommand({
    event_id: "evt_live_outbox_published",
    event_type: "scanner.decision.recorded",
    aggregate_type: "scanner_decision",
    aggregate_id: "decision:green",
    artifact_id: "art_live_published",
    artifact_hash: "sha256:live-published",
    publish_status: "published",
    attempts: 1,
    created_at: "2026-05-18T11:59:30Z",
    published_at: "2026-05-18T11:59:35Z",
  }),
]

const insertOutboxCommand = (row: {
  readonly event_id: string
  readonly event_type: string
  readonly aggregate_type: string
  readonly aggregate_id: string
  readonly artifact_id: string
  readonly artifact_hash: string
  readonly publish_status: "pending" | "publishing" | "published" | "failed"
  readonly attempts: number
  readonly claimed_by?: string
  readonly claimed_at?: string
  readonly claim_expires_at?: string
  readonly last_error?: string
  readonly created_at: string
  readonly published_at?: string
}): SqlCommand => ({
  name: `event_outbox.live_seed.${row.event_id}`,
  text: `
insert into qr_trust.event_outbox (
  event_id,
  event_type,
  aggregate_type,
  aggregate_id,
  artifact_id,
  artifact_hash,
  root_program_id,
  delegated_authority_id,
  issuer_id,
  destination_policy_id,
  payload,
  publish_status,
  attempts,
  claimed_by,
  claimed_at,
  claim_expires_at,
  last_error,
  created_at,
  published_at
) values (
  $1,
  $2,
  $3,
  $4,
  $5,
  $6,
  'root-qrtrust-demo-2026',
  'qrtrust-demo:merchant-web',
  'acme-demo',
  'policy-acme-demo',
  $7::jsonb,
  $8,
  $9,
  $10,
  $11::timestamptz,
  $12::timestamptz,
  $13,
  $14::timestamptz,
  $15::timestamptz
)
`.trim(),
  values: [
    row.event_id,
    row.event_type,
    row.aggregate_type,
    row.aggregate_id,
    row.artifact_id,
    row.artifact_hash,
    JSON.stringify({
      envelope: {
        event_id: row.event_id,
        event_type: row.event_type,
        observed_at: observedAt.toISOString(),
      },
    }),
    row.publish_status,
    row.attempts,
    row.claimed_by ?? null,
    row.claimed_at ?? null,
    row.claim_expires_at ?? null,
    row.last_error ?? null,
    row.created_at,
    row.published_at ?? null,
  ],
})

const runPoolCommand = (
  pool: Pool,
  name: string,
  text: string,
  values: ReadonlyArray<unknown> = [],
): Effect.Effect<void, NetworkError> =>
  Effect.tryPromise({
    try: () => pool.query(text, [...values]).then(() => undefined),
    catch: (cause) => persistenceError(`Postgres command ${name} failed.`, cause),
  })

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Live event outbox metrics smoke failed: ${message}`)
    }
  })

const skipped = (reason: string): Effect.Effect<void> =>
  Console.log(
    JSON.stringify(
      {
        live_event_outbox_metrics_smoke: "skipped",
        reason,
      },
      null,
      2,
    ),
  )

const program = databaseUrl
  ? resetRequested
    ? runLiveMetricsSmoke(databaseUrl)
    : skipped(
        "QRTRUST_NETWORK_LIVE_SMOKE_RESET=true is required before this smoke resets qr_trust.",
      )
  : skipped(
      "Set QRTRUST_NETWORK_DATABASE_URL to run the optional scratch Postgres metrics smoke.",
    )

Effect.runPromise(program)
