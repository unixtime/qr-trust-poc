import { Effect } from "effect"

export type RuntimeSafetyStatus =
  | "clear"
  | "risky"
  | "blocked"
  | "unavailable"

export interface RuntimeSafetyInput {
  readonly destinationUrl: URL
  readonly resolverUrl?: string
  readonly finalUrl?: string
  readonly observedRedirectHops?: number
  readonly observedAt: Date
}

export interface RuntimeSafetyVerdict {
  readonly status: RuntimeSafetyStatus
  readonly provider: string
  readonly observed_at: string
  readonly effective_url: string
  readonly risk_score_delta: number
  readonly reason_codes: ReadonlyArray<string>
  readonly message: string
}

export interface RuntimeSafetyProviderShape {
  readonly inspect: (
    input: RuntimeSafetyInput,
  ) => Effect.Effect<RuntimeSafetyVerdict>
}

export interface RuntimeSafetySignal {
  readonly status: RuntimeSafetyStatus
  readonly provider: string
  readonly risk_score_delta: number
  readonly reason_codes: ReadonlyArray<string>
  readonly message: string
}

export interface RuntimeRedirectInspectorShape {
  readonly inspectRedirect: (
    input: RuntimeSafetyInput,
  ) => Effect.Effect<RuntimeSafetySignal>
}

export interface RuntimeReputationProviderShape {
  readonly inspectReputation: (
    input: RuntimeSafetyInput,
  ) => Effect.Effect<RuntimeSafetySignal>
}

export interface DeterministicRuntimeSafetyOptions {
  readonly riskyHosts?: ReadonlyArray<string>
  readonly blockedHosts?: ReadonlyArray<string>
  readonly unavailableHosts?: ReadonlyArray<string>
}

export interface CompositeRuntimeSafetyOptions {
  readonly providerName?: string
  readonly redirectInspector?: RuntimeRedirectInspectorShape
  readonly reputationProvider?: RuntimeReputationProviderShape
}

export interface DeterministicRedirectInspectorOptions {
  readonly providerName?: string
  readonly maxRedirectHops?: number
  readonly riskyResolverHosts?: ReadonlyArray<string>
  readonly blockedResolverHosts?: ReadonlyArray<string>
  readonly unavailableResolverHosts?: ReadonlyArray<string>
}

export interface DeterministicReputationProviderOptions {
  readonly providerName?: string
  readonly riskyHosts?: ReadonlyArray<string>
  readonly blockedHosts?: ReadonlyArray<string>
  readonly unavailableHosts?: ReadonlyArray<string>
  readonly newlyRegisteredHosts?: ReadonlyArray<string>
  readonly suspiciousTlds?: ReadonlyArray<string>
}

export const makeClearRuntimeSafetyProvider =
  (): RuntimeSafetyProviderShape => ({
    inspect: (input) =>
      Effect.succeed(
        makeVerdict(input, "clear", {
          riskScoreDelta: 0,
          reasonCodes: ["runtime_clear"],
          message: "Runtime provider did not report current destination risk.",
        }),
      ),
  })

export const makeDeterministicRuntimeSafetyProvider = (
  options: DeterministicRuntimeSafetyOptions = {},
): RuntimeSafetyProviderShape => ({
  inspect: (input) =>
    Effect.sync(() => {
      const effectiveUrl = parseEffectiveUrl(input)
      const mode = runtimeMode(effectiveUrl)
      const host = effectiveUrl.hostname.toLowerCase()

      if (
        mode === "blocked" ||
        includesHost(options.blockedHosts, host)
      ) {
        return makeVerdict(input, "blocked", {
          riskScoreDelta: 70,
          reasonCodes: ["runtime_destination_blocked"],
          message:
            "Runtime provider reports that this destination should not be opened right now.",
        })
      }

      if (
        mode === "unavailable" ||
        includesHost(options.unavailableHosts, host)
      ) {
        return makeVerdict(input, "unavailable", {
          riskScoreDelta: 30,
          reasonCodes: ["runtime_provider_unavailable"],
          message:
            "Runtime provider is unavailable, so present-time destination safety could not be checked.",
        })
      }

      if (mode === "risky" || includesHost(options.riskyHosts, host)) {
        return makeVerdict(input, "risky", {
          riskScoreDelta: 45,
          reasonCodes: ["runtime_destination_risky"],
          message:
            "Runtime provider reports elevated destination risk at scan time.",
        })
      }

      return makeVerdict(input, "clear", {
        riskScoreDelta: 0,
        reasonCodes: ["runtime_clear"],
        message: "Runtime provider did not report current destination risk.",
      })
    }),
})

export const makeCompositeRuntimeSafetyProvider = (
  options: CompositeRuntimeSafetyOptions,
): RuntimeSafetyProviderShape => ({
  inspect: (input) =>
    Effect.gen(function* () {
      const signals = yield* Effect.all(
        [
          options.redirectInspector?.inspectRedirect(input),
          options.reputationProvider?.inspectReputation(input),
        ].filter((effect): effect is Effect.Effect<RuntimeSafetySignal> =>
          Boolean(effect),
        ),
      )

      return mergeSignals(input, options.providerName ?? "runtime-safety", signals)
    }),
})

export const makeDeterministicRedirectInspector = (
  options: DeterministicRedirectInspectorOptions = {},
): RuntimeRedirectInspectorShape => ({
  inspectRedirect: (input) =>
    Effect.sync(() => {
      const provider = options.providerName ?? "deterministic-redirect-inspector"
      const effectiveUrl = parseEffectiveUrl(input)
      const resolverHost =
        parseOptionalUrl(input.resolverUrl)?.hostname.toLowerCase() ??
        input.destinationUrl.hostname.toLowerCase()
      const observedHops = input.observedRedirectHops ?? 0
      const maxRedirectHops = options.maxRedirectHops ?? 1

      if (includesHost(options.unavailableResolverHosts, resolverHost)) {
        return signal("unavailable", provider, {
          riskScoreDelta: 30,
          reasonCodes: ["runtime_redirect_inspector_unavailable"],
          message:
            "Redirect inspector is unavailable, so the resolver chain could not be checked at scan time.",
        })
      }

      if (includesHost(options.blockedResolverHosts, resolverHost)) {
        return signal("blocked", provider, {
          riskScoreDelta: 70,
          reasonCodes: ["runtime_redirect_resolver_blocked"],
          message:
            "Redirect inspector reports that the resolver should not be used right now.",
        })
      }

      if (
        observedHops > maxRedirectHops ||
        includesHost(options.riskyResolverHosts, resolverHost)
      ) {
        return signal("risky", provider, {
          riskScoreDelta: 35,
          reasonCodes: ["runtime_redirect_chain_risky"],
          message:
            "Redirect inspector reports elevated risk in the resolver chain.",
        })
      }

      if (
        input.finalUrl &&
        !input.resolverUrl &&
        effectiveUrl.hostname.toLowerCase() !==
          input.destinationUrl.hostname.toLowerCase()
      ) {
        return signal("risky", provider, {
          riskScoreDelta: 35,
          reasonCodes: ["runtime_unexpected_redirect"],
          message:
            "A final destination was observed without an approved resolver context.",
        })
      }

      return signal("clear", provider, {
        riskScoreDelta: 0,
        reasonCodes: ["runtime_redirect_clear"],
        message: "Redirect inspection did not report scan-time risk.",
      })
    }),
})

export const makeDeterministicReputationProvider = (
  options: DeterministicReputationProviderOptions = {},
): RuntimeReputationProviderShape => ({
  inspectReputation: (input) =>
    Effect.sync(() => {
      const provider = options.providerName ?? "deterministic-reputation-provider"
      const effectiveUrl = parseEffectiveUrl(input)
      const host = effectiveUrl.hostname.toLowerCase()
      const tld = host.split(".").at(-1) ?? host

      if (includesHost(options.unavailableHosts, host)) {
        return signal("unavailable", provider, {
          riskScoreDelta: 30,
          reasonCodes: ["runtime_reputation_unavailable"],
          message:
            "Reputation provider is unavailable, so present-time destination reputation could not be checked.",
        })
      }

      if (includesHost(options.blockedHosts, host)) {
        return signal("blocked", provider, {
          riskScoreDelta: 70,
          reasonCodes: ["runtime_reputation_blocked"],
          message:
            "Reputation provider reports that this destination should not be opened right now.",
        })
      }

      const reasonCodes: string[] = []
      let riskScoreDelta = 0
      if (includesHost(options.riskyHosts, host)) {
        reasonCodes.push("runtime_reputation_risky")
        riskScoreDelta += 45
      }
      if (includesHost(options.newlyRegisteredHosts, host)) {
        reasonCodes.push("runtime_domain_newly_registered")
        riskScoreDelta += 35
      }
      if (
        options.suspiciousTlds?.some(
          (candidate) => candidate.toLowerCase() === tld,
        ) ?? false
      ) {
        reasonCodes.push("runtime_suspicious_tld")
        riskScoreDelta += 15
      }

      if (riskScoreDelta > 0) {
        return signal("risky", provider, {
          riskScoreDelta,
          reasonCodes,
          message:
            "Reputation provider reports elevated destination risk at scan time.",
        })
      }

      return signal("clear", provider, {
        riskScoreDelta: 0,
        reasonCodes: ["runtime_reputation_clear"],
        message: "Reputation provider did not report scan-time risk.",
      })
    }),
})

const parseEffectiveUrl = (input: RuntimeSafetyInput): URL =>
  input.finalUrl ? new URL(input.finalUrl) : input.destinationUrl

const parseOptionalUrl = (value: string | undefined): URL | undefined => {
  if (!value) {
    return undefined
  }
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

const runtimeMode = (url: URL): RuntimeSafetyStatus | undefined => {
  const mode = (
    url.searchParams.get("runtime") ??
    url.searchParams.get("risk") ??
    ""
  ).toLowerCase()

  if (
    mode === "clear" ||
    mode === "risky" ||
    mode === "blocked" ||
    mode === "unavailable"
  ) {
    return mode
  }

  return undefined
}

const includesHost = (
  hosts: ReadonlyArray<string> | undefined,
  host: string,
): boolean => hosts?.some((candidate) => candidate.toLowerCase() === host) ?? false

const signal = (
  status: RuntimeSafetyStatus,
  provider: string,
  details: {
    readonly riskScoreDelta: number
    readonly reasonCodes: ReadonlyArray<string>
    readonly message: string
  },
): RuntimeSafetySignal => ({
  status,
  provider,
  risk_score_delta: details.riskScoreDelta,
  reason_codes: details.reasonCodes,
  message: details.message,
})

const mergeSignals = (
  input: RuntimeSafetyInput,
  provider: string,
  signals: ReadonlyArray<RuntimeSafetySignal>,
): RuntimeSafetyVerdict => {
  if (signals.length === 0) {
    return makeVerdict(input, "clear", {
      provider,
      riskScoreDelta: 0,
      reasonCodes: ["runtime_clear"],
      message: "No runtime providers reported current destination risk.",
    })
  }

  const status = mergedStatus(signals)
  return makeVerdict(input, status, {
    provider,
    riskScoreDelta: Math.min(
      100,
      signals.reduce((sum, current) => sum + current.risk_score_delta, 0),
    ),
    reasonCodes: unique(signals.flatMap((current) => current.reason_codes)),
    message: mergedMessage(status, signals),
  })
}

const mergedStatus = (
  signals: ReadonlyArray<RuntimeSafetySignal>,
): RuntimeSafetyStatus => {
  if (signals.some((current) => current.status === "blocked")) {
    return "blocked"
  }
  if (signals.some((current) => current.status === "risky")) {
    return "risky"
  }
  if (signals.some((current) => current.status === "unavailable")) {
    return "unavailable"
  }

  return "clear"
}

const mergedMessage = (
  status: RuntimeSafetyStatus,
  signals: ReadonlyArray<RuntimeSafetySignal>,
): string => {
  const decisive = signals.find((current) => current.status === status)
  if (decisive) {
    return decisive.message
  }

  return status === "clear"
    ? "Runtime providers did not report current destination risk."
    : "Runtime providers reported scan-time destination risk."
}

const unique = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
  Array.from(new Set(values))

const makeVerdict = (
  input: RuntimeSafetyInput,
  status: RuntimeSafetyStatus,
  details: {
    readonly provider?: string
    readonly riskScoreDelta: number
    readonly reasonCodes: ReadonlyArray<string>
    readonly message: string
  },
): RuntimeSafetyVerdict => ({
  status,
  provider: details.provider ?? "deterministic-runtime-safety",
  observed_at: input.observedAt.toISOString(),
  effective_url: input.finalUrl ?? input.destinationUrl.toString(),
  risk_score_delta: details.riskScoreDelta,
  reason_codes: details.reasonCodes,
  message: details.message,
})
