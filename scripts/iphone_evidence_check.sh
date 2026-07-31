#!/usr/bin/env sh
set -eu

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

printf "Checking native iPhone scanner-fleet evidence\n"
printf "This strict check follows docs/public/network-contracts/examples/scanner-fleet-evidence-reference.json.\n\n"

(
  cd "${REPO_ROOT}/network"
  npm run scanner-fleet:evidence-artifacts-check -- --text
)
