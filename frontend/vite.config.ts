import fs from "node:fs"
import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { resolveBackendTarget } from "./vite.backend-target.mjs"

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const backendTarget = resolveBackendTarget(env)
  const frontendPort = Number(env.VITE_PORT || 5173)
  const frontendTlsEnabled = env.FRONTEND_TLS_ENABLED === "true"
  const frontendTlsCertFile = env.FRONTEND_TLS_CERT_FILE
  const frontendTlsKeyFile = env.FRONTEND_TLS_KEY_FILE

  const https =
    frontendTlsEnabled && frontendTlsCertFile && frontendTlsKeyFile
      ? {
          cert: fs.readFileSync(frontendTlsCertFile),
          key: fs.readFileSync(frontendTlsKeyFile),
        }
      : undefined

  if (frontendTlsEnabled && !https) {
    throw new Error(
      "FRONTEND_TLS_ENABLED=true requires FRONTEND_TLS_CERT_FILE and FRONTEND_TLS_KEY_FILE."
    )
  }

  const backendProxy = () => ({
    target: backendTarget,
    changeOrigin: true,
    secure: false,
  })

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
    server: {
      host: "0.0.0.0",
      https,
      port: frontendPort,
      strictPort: true,
      proxy: {
        "/admin": backendProxy(),
        "/verifier": backendProxy(),
        "/scanner": backendProxy(),
      },
    },
    preview: {
      host: "0.0.0.0",
      https,
      port: frontendPort,
      strictPort: true,
    },
  }
})
