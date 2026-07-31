import {
  makeClearRuntimeSafetyProvider,
  makePgPool,
  makePostgresExecutorFromClient,
  makePostgresPersistenceService,
  makePostgresVerifierCache,
  makeScannerDecisionPersistenceEventBus,
  makeScannerDecisionService,
  startScannerDecisionHttpRuntime,
} from "../index.js"

const DEFAULT_HOST = "127.0.0.1"
const DEFAULT_PORT = 8090
const DEFAULT_VERIFIER_ID = "verifier:reference-http-runtime"
const DEFAULT_ACCEPTED_ROOT_PROGRAM_IDS = ["root:qrtrust-demo:2026"]

const main = async (): Promise<void> => {
  const databaseUrl = process.env.QRTRUST_NETWORK_DATABASE_URL
  if (!databaseUrl) {
    throw new Error(
      "Set QRTRUST_NETWORK_DATABASE_URL before starting the scanner-decision runtime.",
    )
  }

  const host = process.env.QRTRUST_SCANNER_DECISION_HOST ?? DEFAULT_HOST
  const port = parsePort(
    process.env.QRTRUST_SCANNER_DECISION_PORT,
    DEFAULT_PORT,
  )
  const verifierId =
    process.env.QRTRUST_SCANNER_VERIFIER_ID ?? DEFAULT_VERIFIER_ID
  const acceptedRootProgramIds = stringListEnv(
    "QRTRUST_ACCEPTED_ROOT_PROGRAM_IDS",
    DEFAULT_ACCEPTED_ROOT_PROGRAM_IDS,
  )

  const pool = makePgPool(databaseUrl)
  const persistence = makePostgresPersistenceService(
    makePostgresExecutorFromClient(pool),
  )
  const scanner = makeScannerDecisionService(
    makePostgresVerifierCache(pool, {
      verifier_id: verifierId,
      accepted_root_program_ids: acceptedRootProgramIds,
    }),
    makeScannerDecisionPersistenceEventBus(persistence, verifierId),
    makeClearRuntimeSafetyProvider(),
  )

  const runtime = await startScannerDecisionHttpRuntime({
    scanner,
    verifierId,
    host,
    port,
  })

  console.log(
    JSON.stringify(
      {
        service: "qrtrust-scanner-decision-runtime",
        status: "listening",
        verifier_id: verifierId,
        accepted_root_program_ids: acceptedRootProgramIds,
        url: runtime.url,
        decisions_endpoint: `${runtime.url}/scanner/decisions`,
      },
      null,
      2,
    ),
  )

  const shutdown = async (): Promise<void> => {
    await runtime.close()
    await pool.end()
  }

  process.once("SIGINT", () => {
    void shutdown().then(() => process.exit(0))
  })
  process.once("SIGTERM", () => {
    void shutdown().then(() => process.exit(0))
  })
}

const parsePort = (input: string | undefined, fallback: number): number => {
  if (!input) {
    return fallback
  }

  const port = Number.parseInt(input, 10)
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid QRTRUST_SCANNER_DECISION_PORT: ${input}`)
  }

  return port
}

const stringListEnv = (
  key: string,
  fallback: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const value = process.env[key]
  if (!value) {
    return fallback
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
