import { resolveBackendTarget } from "../vite.backend-target.mjs"

const cases = [
  {
    name: "bare dev defaults use the HTTPS compose API",
    env: {},
    expected: "https://127.0.0.1:8443",
  },
  {
    name: "explicit backend target wins",
    env: { VITE_BACKEND_TARGET: "http://api:8000" },
    expected: "http://api:8000",
  },
  {
    name: "explicit non-TLS backend uses port 8000",
    env: { VERIFIER_TLS_ENABLED: "false" },
    expected: "http://127.0.0.1:8000",
  },
  {
    name: "published wildcard host becomes localhost",
    env: { API_PUBLISH_HOST: "0.0.0.0" },
    expected: "https://127.0.0.1:8443",
  },
  {
    name: "nonstandard published API port implies non-TLS unless TLS is explicit",
    env: { API_PUBLISH_PORT: "8010" },
    expected: "http://127.0.0.1:8010",
  },
  {
    name: "explicit TLS keeps HTTPS with custom host and port",
    env: {
      VERIFIER_TLS_ENABLED: "true",
      API_PUBLISH_HOST: "localhost",
      API_PUBLISH_PORT: "8443",
    },
    expected: "https://localhost:8443",
  },
]

for (const testCase of cases) {
  const actual = resolveBackendTarget(testCase.env)
  if (actual !== testCase.expected) {
    throw new Error(
      `${testCase.name}: expected ${testCase.expected}, got ${actual}`,
    )
  }
}

console.log(
  JSON.stringify(
    {
      status: "ok",
      checked_cases: cases.length,
      default_target: resolveBackendTarget({}),
    },
    null,
    2,
  ),
)
