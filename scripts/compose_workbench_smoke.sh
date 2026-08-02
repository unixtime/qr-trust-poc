#!/usr/bin/env sh
set -eu

API_INTERNAL_URL="${API_INTERNAL_URL:-http://127.0.0.1:8000}"
FRONTEND_INTERNAL_URL="${FRONTEND_INTERNAL_URL:-http://127.0.0.1:5173}"
FRONTEND_PUBLIC_URL="${FRONTEND_PUBLIC_URL:-http://127.0.0.1:${FRONTEND_PUBLISH_PORT:-5173}}"
LAB_SMOKE_PATH="${LAB_SMOKE_PATH:-/?scenario=payload-mismatch&nonce=fixed&autogenerate=1&compare=valid}"
VERIFIER_SMOKE_ADMIN_TOKEN="${VERIFIER_SMOKE_ADMIN_TOKEN:-local-lab-admin}"
VERIFIER_SMOKE_INSECURE_TLS="${VERIFIER_SMOKE_INSECURE_TLS:-false}"
FRONTEND_SMOKE_INSECURE_TLS="${FRONTEND_SMOKE_INSECURE_TLS:-$VERIFIER_SMOKE_INSECURE_TLS}"

node_tls_reject_unauthorized=1
case "$FRONTEND_SMOKE_INSECURE_TLS" in
  1 | true | TRUE | yes | YES)
    node_tls_reject_unauthorized=0
    ;;
esac

printf "Compose services\n"
docker compose ps

printf "\nBackend verifier smoke\n"
docker compose exec -T api \
  env VERIFIER_BASE_URL="$API_INTERNAL_URL" VERIFIER_SMOKE_ADMIN_TOKEN="$VERIFIER_SMOKE_ADMIN_TOKEN" VERIFIER_SMOKE_INSECURE_TLS="$VERIFIER_SMOKE_INSECURE_TLS" \
  /app/backend/.venv/bin/python /app/backend/scripts/verifier_live_http_smoke.py

printf "\nFrontend route smoke\n"
docker compose exec -T frontend env NODE_TLS_REJECT_UNAUTHORIZED="$node_tls_reject_unauthorized" node -e '
const [baseUrl, labPath] = process.argv.slice(1);

async function check(name, url) {
  const response = await fetch(url);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${name} failed: ${response.status} ${text.slice(0, 200)}`);
  }
  if (!text.includes("id=\"root\"")) {
    throw new Error(`${name} did not return the React shell`);
  }

  console.log(`${name} ${response.status}`);
}

(async () => {
  await check("frontend root", `${baseUrl}/`);
  await check("frontend lab comparison route", new URL(labPath, baseUrl).toString());
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
' "$FRONTEND_INTERNAL_URL" "$LAB_SMOKE_PATH"

printf "\nWorkbench smoke passed\n"
printf "Open: %s\n" "$FRONTEND_PUBLIC_URL"
printf "Lab:  %s%s\n" "$FRONTEND_PUBLIC_URL" "$LAB_SMOKE_PATH"
