import { Console, Effect } from "effect"

import {
  decodePostgresRuntimeSafetyObservationReportRows,
  makePostgresRuntimeSafetyObservationReportStore,
  runtimeSafetyObservationReportCommand,
  summarizeRuntimeSafetyObservationHealth,
  type PostgresRuntimeSafetyObservationReportExecutorShape,
  type RuntimeSafetyObservationReport,
  type SqlCommand,
} from "../index.js"

const observedAt = new Date("2026-05-18T12:00:00Z")

const reportFixture: RuntimeSafetyObservationReport = {
  observed_at: observedAt.toISOString(),
  lookback_seconds: 3600,
  total_count: 4,
  clear_count: 1,
  risky_count: 1,
  blocked_count: 1,
  unavailable_count: 1,
  unknown_count: 0,
  expired_count: 1,
  highest_risk_score: 95,
  provider_reports: [
    {
      provider_id: "deterministic-reputation-provider",
      total_count: 3,
      risky_count: 1,
      blocked_count: 1,
      unavailable_count: 0,
      last_observed_at: "2026-05-18T11:59:00.000Z",
    },
    {
      provider_id: "redirect-inspection-provider",
      total_count: 1,
      risky_count: 0,
      blocked_count: 0,
      unavailable_count: 1,
      last_observed_at: "2026-05-18T11:58:00.000Z",
    },
  ],
  top_hosts: [
    {
      destination_host: "evil.example",
      verdict: "blocked",
      risk_score: 95,
      reason_codes: ["runtime_reputation_blocked"],
      observed_at: "2026-05-18T11:59:00.000Z",
      final_url: "https://evil.example/pay",
    },
    {
      destination_host: "slow-provider.example",
      verdict: "unavailable",
      risk_score: 0,
      reason_codes: ["provider_timeout"],
      observed_at: "2026-05-18T11:58:00.000Z",
      final_url: undefined,
    },
  ],
}

const program = Effect.gen(function* () {
  const command = runtimeSafetyObservationReportCommand({
    observed_at: observedAt,
    lookback_seconds: 1800,
    host_limit: 7,
  })

  yield* assertSmoke(
    command.name === "runtime_observations.report",
    "report command should be explicit for operator logs",
  )
  yield* assertSmoke(
    command.text.includes("qr_trust.runtime_observations"),
    "report query should read persisted runtime provider evidence",
  )
  yield* assertSmoke(
    command.text.includes("provider_rollup"),
    "report query should expose per-provider health",
  )
  yield* assertSmoke(
    command.text.includes("top_hosts"),
    "report query should expose highest-risk destinations",
  )
  yield* assertSmoke(
    command.text.includes("case top_hosts.verdict") &&
      command.text.includes("top_hosts.risk_score desc"),
    "top-host report payload should preserve risk-first ordering",
  )
  yield* assertSmoke(
    command.text.includes("expired_count"),
    "report query should preserve observation freshness posture",
  )
  yield* assertSmoke(
    command.text.includes("unknown_count"),
    "report query should preserve unknown or stale runtime posture",
  )
  yield* assertSmoke(
    command.values[1] === 1800 && command.values[2] === 7,
    "report command should carry lookback and host limit",
  )

  const decoded = yield* decodePostgresRuntimeSafetyObservationReportRows([
    {
      ...reportFixture,
      total_count: "4",
      clear_count: "1",
      risky_count: "1",
      blocked_count: "1",
      unavailable_count: "1",
      unknown_count: "0",
      expired_count: "1",
      highest_risk_score: "95",
      provider_reports: JSON.stringify(reportFixture.provider_reports),
      top_hosts: JSON.stringify(reportFixture.top_hosts),
    },
  ])
  const health = summarizeRuntimeSafetyObservationHealth(decoded)

  yield* assertSmoke(
    decoded.provider_reports[0]?.provider_id ===
      "deterministic-reputation-provider",
    "decoder should preserve provider report rows",
  )
  yield* assertSmoke(
    decoded.top_hosts[0]?.reason_codes.includes("runtime_reputation_blocked") ??
      false,
    "decoder should preserve top-host reason codes",
  )
  yield* assertSmoke(
    health.status === "blocked",
    "blocked runtime evidence should block runtime observation health",
  )
  yield* assertSmoke(
    health.reasons.includes("runtime_blocks_present") &&
      health.reasons.includes("provider_unavailable") &&
      health.reasons.includes("expired_runtime_observations"),
    "health summary should explain the operator-visible runtime posture",
  )

  const staleRuntimeHealth = summarizeRuntimeSafetyObservationHealth({
    ...reportFixture,
    total_count: 1,
    clear_count: 0,
    risky_count: 0,
    blocked_count: 0,
    unavailable_count: 0,
    expired_count: 0,
    unknown_count: 1,
    highest_risk_score: 30,
    provider_reports: [
      {
        provider_id: "deterministic-runtime-safety",
        total_count: 1,
        risky_count: 0,
        blocked_count: 0,
        unavailable_count: 0,
        last_observed_at: "2026-05-18T11:59:00.000Z",
      },
    ],
    top_hosts: [
      {
        destination_host: "acme.example",
        verdict: "unknown",
        risk_score: 30,
        reason_codes: ["runtime_stale"],
        observed_at: "2026-05-18T11:59:00.000Z",
        final_url: "https://acme.example/pay?runtime=stale",
      },
    ],
  })

  yield* assertSmoke(
    staleRuntimeHealth.status === "degraded" &&
      staleRuntimeHealth.reasons.includes("runtime_status_unknown"),
    "unknown or stale runtime evidence should degrade operator health",
  )

  const executor = new FakeRuntimeSafetyObservationReportExecutor(reportFixture)
  const store = makePostgresRuntimeSafetyObservationReportStore(executor)
  const loaded = yield* store.loadReport({
    observed_at: observedAt,
    host_limit: 3,
  })

  yield* assertSmoke(
    loaded.highest_risk_score === 95,
    "report store should return the executor report",
  )
  yield* assertSmoke(
    executor.commands[0]?.name === "runtime_observations.report",
    "report store should use the Postgres report command",
  )

  yield* Console.log(
    JSON.stringify(
      {
        runtime_observation_report: {
          total_count: loaded.total_count,
          blocked_count: loaded.blocked_count,
          unavailable_count: loaded.unavailable_count,
          unknown_count: loaded.unknown_count,
          expired_count: loaded.expired_count,
          highest_risk_score: loaded.highest_risk_score,
        },
        health,
        command: {
          name: command.name,
          lookback_seconds: command.values[1],
          host_limit: command.values[2],
        },
      },
      null,
      2,
    ),
  )
})

class FakeRuntimeSafetyObservationReportExecutor
  implements PostgresRuntimeSafetyObservationReportExecutorShape
{
  readonly commands: SqlCommand[] = []

  constructor(private readonly report: RuntimeSafetyObservationReport) {}

  queryRuntimeSafetyObservationReport(command: SqlCommand) {
    return Effect.sync(() => {
      this.commands.push(command)
      return this.report
    })
  }
}

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Runtime safety observation report smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
