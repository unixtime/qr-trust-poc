#!/usr/bin/env sh
set -eu

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

(
  cd "${REPO_ROOT}/network"
  npm run ios-provider-profile:evidence-artifacts-check
)
