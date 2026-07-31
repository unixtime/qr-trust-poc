import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"

import { Effect } from "effect"

import {
  decodeScannerDecision,
  type ScannerDecision,
} from "../contracts.js"
import {
  contractValidationError,
  type NetworkError,
} from "../errors.js"
import type {
  EventBusShape,
  NetworkEvent,
} from "./event-bus.js"
import type { PostgresPersistenceServiceShape } from "./postgres-persistence.js"
import type {
  ScannerDecisionInput,
  ScannerDecisionServiceShape,
} from "./scanner-decision.js"

const SERVICE_NAME = "qrtrust-scanner-decision-runtime"
const SCANNER_DECISION_EVENT_TYPE = "scanner.decision.recorded"
const JSON_CONTENT_TYPE = "application/json; charset=utf-8"
const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024

export interface ScannerDecisionHttpRuntimeOptions {
  readonly scanner: ScannerDecisionServiceShape
  readonly verifierId: string
  readonly host?: string
  readonly port?: number
  readonly bodyLimitBytes?: number
}

export interface ScannerDecisionHttpRuntimeHandle {
  readonly host: string
  readonly port: number
  readonly url: string
  readonly close: () => Promise<void>
}

export const makeScannerDecisionPersistenceEventBus = (
  persistence: PostgresPersistenceServiceShape,
  verifierId: string,
): EventBusShape => {
  const events: NetworkEvent[] = []

  return {
    publish: (event) =>
      Effect.gen(function* () {
        const decision = yield* scannerDecisionFromEvent(event)
        yield* persistence.persistBatch({
          events: [event],
          ...(decision
            ? {
                scanner_decisions: [
                  {
                    verifier_id: verifierId,
                    decision,
                  },
                ],
              }
            : {}),
        })

        events.push(event)
      }),
    recent: () => Effect.succeed([...events]),
  }
}

export const startScannerDecisionHttpRuntime = async (
  options: ScannerDecisionHttpRuntimeOptions,
): Promise<ScannerDecisionHttpRuntimeHandle> => {
  const host = options.host ?? "127.0.0.1"
  const port = options.port ?? 8090
  const bodyLimitBytes = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES

  const server = createServer((request, response) => {
    void routeRequest(request, response, {
      ...options,
      host,
      port,
      bodyLimitBytes,
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, host, () => {
      server.off("error", reject)
      resolve()
    })
  })

  const address = server.address()
  const boundPort = isAddressInfo(address) ? address.port : port
  const baseUrl = `http://${host}:${boundPort}`

  return {
    host,
    port: boundPort,
    url: baseUrl,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      }),
  }
}

const scannerDecisionFromEvent = (
  event: NetworkEvent,
): Effect.Effect<ScannerDecision | undefined, NetworkError> => {
  if (event.envelope.type !== SCANNER_DECISION_EVENT_TYPE) {
    return Effect.succeed(undefined)
  }

  return decodeScannerDecision(event.body).pipe(
    Effect.mapError((cause) =>
      contractValidationError(
        "Scanner decision event body failed persistence validation.",
        cause,
      ),
    ),
  )
}

const routeRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  options: Required<
    Pick<ScannerDecisionHttpRuntimeOptions, "scanner" | "verifierId">
  > &
    Pick<
      Required<ScannerDecisionHttpRuntimeOptions>,
      "host" | "port" | "bodyLimitBytes"
    >,
): Promise<void> => {
  try {
    if (request.method === "OPTIONS") {
      writeNoContent(response, 204)
      return
    }

    const requestUrl = new URL(request.url ?? "/", `http://${options.host}`)

    if (request.method === "GET" && requestUrl.pathname === "/healthz") {
      writeJson(response, 200, {
        service: SERVICE_NAME,
        status: "ok",
        verifier_id: options.verifierId,
        decisions_endpoint: "/scanner/decisions",
      })
      return
    }

    if (request.method === "POST" && requestUrl.pathname === "/scanner/decisions") {
      const body = await readJsonBody(request, options.bodyLimitBytes)
      const input = parseScannerDecisionRequest(body)
      const result = await Effect.runPromise(
        Effect.either(options.scanner.decide(input)),
      )

      if (result._tag === "Left") {
        throw result.left
      }

      const decision = result.right
      writeJson(response, 200, decision)
      return
    }

    writeJson(response, 404, {
      error: {
        code: "not_found",
        message: "Scanner decision runtime route not found.",
      },
    })
  } catch (error) {
    writeError(response, error)
  }
}

const readJsonBody = async (
  request: IncomingMessage,
  limitBytes: number,
): Promise<unknown> => {
  const chunks: Buffer[] = []
  let bytes = 0

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    if (bytes > limitBytes) {
      throw new HttpRequestError(
        413,
        "request_too_large",
        "Scanner decision request body is too large.",
      )
    }
    chunks.push(buffer)
  }

  const rawBody = Buffer.concat(chunks).toString("utf8")
  if (rawBody.trim().length === 0) {
    throw new HttpRequestError(
      400,
      "empty_json_body",
      "Scanner decision request body must be JSON.",
    )
  }

  try {
    return JSON.parse(rawBody)
  } catch (cause) {
    throw new HttpRequestError(
      400,
      "invalid_json_body",
      "Scanner decision request body must be valid JSON.",
      cause,
    )
  }
}

const parseScannerDecisionRequest = (
  body: unknown,
): ScannerDecisionInput => {
  if (!isRecord(body)) {
    throw new HttpRequestError(
      400,
      "invalid_request",
      "Scanner decision request must be a JSON object.",
    )
  }

  const payload = body.payload
  if (typeof payload !== "string" || payload.trim().length === 0) {
    throw new HttpRequestError(
      400,
      "invalid_payload",
      "Scanner decision request requires a non-empty payload string.",
    )
  }

  const observedAtInput = body.observed_at ?? body.observedAt
  const observedAt =
    observedAtInput === undefined ? new Date() : parseObservedAt(observedAtInput)
  const issuerHintHost = optionalString(body.issuer_hint_host ?? body.issuerHintHost)

  return {
    payload,
    observedAt,
    ...(issuerHintHost ? { issuerHintHost } : {}),
  }
}

const parseObservedAt = (value: unknown): Date => {
  if (typeof value !== "string") {
    throw new HttpRequestError(
      400,
      "invalid_observed_at",
      "observed_at must be an ISO-8601 string when provided.",
    )
  }

  const observedAt = new Date(value)
  if (!Number.isFinite(observedAt.getTime())) {
    throw new HttpRequestError(
      400,
      "invalid_observed_at",
      "observed_at must be a valid ISO-8601 timestamp.",
    )
  }

  return observedAt
}

const optionalString = (value: unknown): string | undefined => {
  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value !== "string") {
    throw new HttpRequestError(
      400,
      "invalid_issuer_hint_host",
      "issuer_hint_host must be a string when provided.",
    )
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

const writeError = (response: ServerResponse, error: unknown): void => {
  if (response.headersSent) {
    response.end()
    return
  }

  if (error instanceof HttpRequestError) {
    writeJson(response, error.statusCode, {
      error: {
        code: error.code,
        message: error.message,
      },
    })
    return
  }

  if (isNetworkError(error)) {
    const statusCode = error._tag === "DestinationParseError" ? 422 : 500
    writeJson(response, statusCode, {
      error: {
        code: error._tag,
        message: error.message,
      },
    })
    return
  }

  writeJson(response, 500, {
    error: {
      code: "internal_error",
      message: "Scanner decision runtime failed.",
    },
  })
}

const writeNoContent = (
  response: ServerResponse,
  statusCode: number,
): void => {
  response.writeHead(statusCode, corsHeaders())
  response.end()
}

const writeJson = (
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void => {
  response.writeHead(statusCode, {
    ...corsHeaders(),
    "content-type": JSON_CONTENT_TYPE,
  })
  response.end(`${JSON.stringify(body, null, 2)}\n`)
}

const corsHeaders = (): Record<string, string> => ({
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
})

class HttpRequestError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly cause?: unknown

  constructor(
    statusCode: number,
    code: string,
    message: string,
    cause?: unknown,
  ) {
    super(message)
    this.name = "HttpRequestError"
    this.statusCode = statusCode
    this.code = code
    if (cause !== undefined) {
      this.cause = cause
    }
  }
}

const isNetworkError = (value: unknown): value is NetworkError =>
  isRecord(value)
  && typeof value._tag === "string"
  && typeof value.message === "string"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isAddressInfo = (value: unknown): value is AddressInfo =>
  isRecord(value) && typeof value.port === "number"
