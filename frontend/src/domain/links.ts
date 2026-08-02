import type { NonceMode, ScenarioKey } from "./scenarios"

export function buildLabLink(
  scenario: ScenarioKey,
  nonceMode: NonceMode = "fixed",
  usagePolicy: string = "reusable_public",
  extras: { compare?: ScenarioKey; autogenerate?: boolean } = {}
) {
  const params = new URLSearchParams({
    scenario,
    nonce: nonceMode,
    usage: usagePolicy,
    autogenerate: extras.autogenerate === false ? "0" : "1",
  })
  if (extras.compare) {
    params.set("compare", extras.compare)
  }
  return `/?${params.toString()}`
}

export function buildOperatorLink(
  options: {
    focus?: "access" | "management" | "runtime"
    // Accepted so existing call sites keep compiling; never emitted (spec
    // removes the learn-era source= param from all URLs).
    source?: string
    scenario?: ScenarioKey
    compareScenario?: ScenarioKey
    nonceMode?: NonceMode
  } = {}
) {
  const params = new URLSearchParams()
  if (options.focus) params.set("focus", options.focus)
  if (options.scenario) params.set("scenario", options.scenario)
  if (options.compareScenario) params.set("compare", options.compareScenario)
  if (options.nonceMode) params.set("nonce", options.nonceMode)
  const search = params.toString()
  return `/operator${search ? `?${search}` : ""}`
}
