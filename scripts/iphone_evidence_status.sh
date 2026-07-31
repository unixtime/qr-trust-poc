#!/usr/bin/env sh
set -eu

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PACKET_DIR="${IPHONE_EVIDENCE_PACKET_DIR:-local/iphone-evidence-packet}"
INCOMING_DIR="${PACKET_DIR}/incoming"
EVIDENCE_DIR="${IPHONE_EVIDENCE_DIR:-docs/public/evidence/iphone}"

printf "Native iPhone evidence status\n"
printf "Packet: %s\n" "$PACKET_DIR"
printf "Incoming: %s\n" "$INCOMING_DIR"
printf "Tracked evidence: %s\n\n" "$EVIDENCE_DIR"

if [ -f "${REPO_ROOT}/${PACKET_DIR}/README.md" ]; then
  printf "PASS: local capture packet exists\n"
else
  printf "TODO: local capture packet is missing; run make iphone-evidence-packet\n"
fi

if [ -d "${REPO_ROOT}/${INCOMING_DIR}" ]; then
  printf "PASS: incoming capture folder exists\n"
else
  printf "TODO: incoming capture folder is missing; run make iphone-evidence-packet\n"
fi

printf "\nScanner-fleet contract status:\n"
(
  cd "${REPO_ROOT}/network"
  npm run scanner-fleet:evidence-artifacts-status -- --text
)

printf "\nImport note:\n"
printf "  Full scanner-fleet evidence now uses the reference packet artifact names.\n"
printf "  Copy exported iPhone files into %s, then run:\n" "$INCOMING_DIR"
printf "  make import-iphone-evidence IPHONE_EVIDENCE_SOURCE_DIR=%s\n" "$INCOMING_DIR"
