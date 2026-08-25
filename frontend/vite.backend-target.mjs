export function resolveBackendTarget(env) {
  if (env.VITE_BACKEND_TARGET) {
    return env.VITE_BACKEND_TARGET
  }

  const backendHost =
    env.API_PUBLISH_HOST && env.API_PUBLISH_HOST !== "0.0.0.0"
      ? env.API_PUBLISH_HOST
      : "127.0.0.1"
  const backendProtocol = resolveBackendProtocol(env)
  const backendPort =
    env.API_PUBLISH_PORT || (backendProtocol === "https" ? "8444" : "8000")

  return `${backendProtocol}://${backendHost}:${backendPort}`
}

function resolveBackendProtocol(env) {
  if (env.VERIFIER_TLS_ENABLED === "true") {
    return "https"
  }
  if (env.VERIFIER_TLS_ENABLED === "false") {
    return "http"
  }
  if (env.API_PUBLISH_PORT && env.API_PUBLISH_PORT !== "8444") {
    return "http"
  }
  return "https"
}
