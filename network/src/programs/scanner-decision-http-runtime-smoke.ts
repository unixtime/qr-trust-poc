import {
  makeClearRuntimeSafetyProvider,
  makeDemoVerifierCache,
  makeInMemoryEventBus,
  makeScannerDecisionService,
  startScannerDecisionHttpRuntime,
} from "../index.js"

const assertSmoke = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(`Scanner decision HTTP runtime smoke failed: ${message}`)
  }
}

const main = async (): Promise<void> => {
  const scanner = makeScannerDecisionService(
    makeDemoVerifierCache(),
    makeInMemoryEventBus(),
    makeClearRuntimeSafetyProvider(),
  )
  const runtime = await startScannerDecisionHttpRuntime({
    scanner,
    verifierId: "verifier:http-runtime-smoke",
    host: "127.0.0.1",
    port: 0,
  })

  try {
    const health = await getJson(`${runtime.url}/healthz`)
    assertSmoke(
      health.status === 200
      && isRecord(health.body)
      && health.body.service === "qrtrust-scanner-decision-runtime",
      "health endpoint should identify the runtime",
    )

    const green = await postJson(`${runtime.url}/scanner/decisions`, {
      payload: "https://acme.example/pay",
      issuer_hint_host: "acme.example",
      observed_at: "2026-05-20T18:02:00.000Z",
    })
    assertSmoke(green.status === 200, "recognized payload should return 200")
    assertSmoke(
      isRecord(green.body) && green.body.decision_color === "green",
      "recognized payload should produce a green scanner decision",
    )
    assertSmoke(
      isRecord(green.body) && isRecord(green.body.governance),
      "recognized payload should include governance projection",
    )

    const invalidPayload = await postJson(`${runtime.url}/scanner/decisions`, {
      payload: "not a url",
      observed_at: "2026-05-20T18:02:00.000Z",
    })
    assertSmoke(
      invalidPayload.status === 422,
      "malformed destination should return 422",
    )

    const invalidJson = await fetch(`${runtime.url}/scanner/decisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    })
    assertSmoke(
      invalidJson.status === 400,
      "invalid JSON should return 400",
    )

    console.log(
      JSON.stringify(
        {
          status: "ok",
          health: "/healthz",
          decisions_endpoint: "/scanner/decisions",
        },
        null,
        2,
      ),
    )
  } finally {
    await runtime.close()
  }
}

interface JsonResponse {
  readonly status: number
  readonly body: unknown
}

const getJson = async (url: string): Promise<JsonResponse> => {
  const response = await fetch(url)
  return {
    status: response.status,
    body: await response.json(),
  }
}

const postJson = async (
  url: string,
  body: unknown,
): Promise<JsonResponse> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

  return {
    status: response.status,
    body: await response.json(),
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
