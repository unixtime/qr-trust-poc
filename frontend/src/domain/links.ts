import type { ScenarioKey } from "./scenarios"

// The lab is the root route, so the link is a query string on `/`.
export function buildLabLink(
  scenario: ScenarioKey,
  extras: Record<string, string> = {}
) {
  const params = new URLSearchParams({
    scenario,
    autogenerate: "1",
    ...extras,
  })
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
  } = {}
) {
  const params = new URLSearchParams()
  if (options.focus) params.set("focus", options.focus)
  if (options.scenario) params.set("scenario", options.scenario)
  if (options.compareScenario) params.set("compare", options.compareScenario)
  const search = params.toString()
  return `/operator${search ? `?${search}` : ""}`
}
