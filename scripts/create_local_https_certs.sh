#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CERT_DIR="${ROOT_DIR}/local/https"
CERT_FILE="${CERT_DIR}/verifier-lab.pem"
KEY_FILE="${CERT_DIR}/verifier-lab-key.pem"

if ! command -v mkcert >/dev/null 2>&1; then
  echo "mkcert is not installed. Install it first." >&2
  exit 1
fi

LAN_IP="${1:-}"
if [[ -z "${LAN_IP}" ]]; then
  LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
fi
if [[ -z "${LAN_IP}" ]]; then
  LAN_IP="$(ipconfig getifaddr en1 2>/dev/null || true)"
fi
if [[ -z "${LAN_IP}" ]]; then
  echo "Could not detect a LAN IP. Pass it explicitly: scripts/create_local_https_certs.sh 192.168.x.x" >&2
  exit 1
fi

LOCAL_HOSTNAME="$(scutil --get LocalHostName 2>/dev/null || hostname -s 2>/dev/null || true)"
LOCAL_DNS=""
if [[ -n "${LOCAL_HOSTNAME}" ]]; then
  LOCAL_DNS="${LOCAL_HOSTNAME%.local}.local"
fi

mkdir -p "${CERT_DIR}"

CERT_NAMES=(localhost 127.0.0.1 ::1 "${LAN_IP}")
if [[ -n "${LOCAL_DNS}" ]]; then
  CERT_NAMES+=("${LOCAL_DNS}")
fi

mkcert \
  -cert-file "${CERT_FILE}" \
  -key-file "${KEY_FILE}" \
  "${CERT_NAMES[@]}"

cp "$(mkcert -CAROOT)/rootCA.pem" "${CERT_DIR}/mkcert-rootCA.pem"

cat <<EOF
Created local HTTPS material:
  cert: ${CERT_FILE}
  key:  ${KEY_FILE}
  ca:   ${CERT_DIR}/mkcert-rootCA.pem

LAN IP included in certificate:
  ${LAN_IP}
EOF

if [[ -n "${LOCAL_DNS}" ]]; then
  cat <<EOF
Stable local hostname included in certificate:
  ${LOCAL_DNS}
EOF
fi

cat <<EOF
Next steps:
1. Install and trust mkcert-rootCA.pem on the iPhone.
2. Start the stack with:
   make up-https-admin
   If another local stack owns default host ports, use:
   make up-https-admin POSTGRES_PUBLISH_PORT=55432 REDIS_PUBLISH_PORT=6385 FRONTEND_PUBLISH_PORT=5174
   If reusing an existing Postgres/Redis stack, use:
   make up-https-admin-shared-infra FRONTEND_PUBLISH_PORT=5174
3. Generate the iOS provider profile before rebuilding the app:
   make ios-provider-config
4. Open:
EOF

if [[ -n "${LOCAL_DNS}" ]]; then
  cat <<EOF
   https://${LOCAL_DNS}:8443/
EOF
else
  cat <<EOF
   https://${LAN_IP}:8443/
EOF
fi
