#!/bin/sh
set -eu

script_dir="$(dirname "$0")"
repo_root="$(cd "$script_dir/.." && pwd)"

cd "$repo_root/network"

run_npm_script() {
  printf "\n==> npm run %s\n" "$1"
  npm run "$1"
}

run_before_runtime() {
  for script_name in \
    typecheck \
    contract:smoke \
    governance:publication-plan-smoke \
    postgres:governance-publication-source-smoke \
    authority:publication-service-smoke \
    authority:publication-outbox-handoff-smoke \
    domain-proof:smoke \
    destination-policy:publication-gate-smoke \
    destination-policy:publication-smoke \
    destination-policy:queue-publication-smoke \
    deployment:readiness-smoke \
    deployment:readiness-bundle-smoke \
    reference-network:adoption-stage-smoke
  do
    run_npm_script "$script_name"
  done
}

run_after_runtime() {
  for script_name in \
    scanner-fleet:evidence-smoke \
    cross-surface:evidence-smoke \
    worker-operations:evidence-smoke \
    restore-automation:evidence-smoke \
    packaged-deployment:evidence-smoke \
    operator-evidence:index-smoke \
    production-evidence:requirements-smoke \
    production-evidence:collection-template-smoke \
    production-evidence:closure-bundle-smoke \
    production-evidence:gap-report-smoke \
    production-evidence:intake-smoke \
    production-evidence:private-workflow-smoke \
    reference-network:handoff-bundle-smoke \
    verifier-profile:distribution-smoke \
    artifact-publication:queue-worker-smoke \
    artifact-publication:queue-supervisor-smoke \
    verifier-cache:materialization-smoke \
    verifier-cache:read-model-worker-smoke \
    verifier-cache:read-model-queue-worker-smoke \
    verifier-cache:work-item-authorization-smoke \
    verifier-cache:read-model-queue-supervisor-smoke \
    event-outbox:smoke \
    event-outbox:worker-smoke \
    event-outbox:supervisor-smoke \
    event-outbox:metrics-smoke \
    key-material:smoke \
    signing-custody:smoke \
    signing-custody:audit-export-smoke \
    signing-custody:publication-audit-smoke \
    signer-recovery:smoke \
    key-rotation:smoke \
    postgres:artifact-store-smoke \
    postgres:destination-policy-context-smoke \
    postgres:domain-proof-store-smoke \
    postgres:driver-smoke \
    postgres:migrations-plan-smoke \
    postgres:persistence-smoke \
    postgres:trust-key-smoke \
    nats:propagation-smoke \
    nats:live-publisher-smoke \
    runtime:safety-smoke \
    runtime:observation-report-smoke \
    signature:smoke
  do
    run_npm_script "$script_name"
  done
}

run_runtime() {
  run_npm_script scanner-decision:http-runtime-smoke
}

case "${1:-full}" in
  offline)
    run_before_runtime
    run_after_runtime
    ;;
  runtime)
    run_runtime
    ;;
  full)
    run_before_runtime
    run_runtime
    run_after_runtime
    ;;
  *)
    printf "Usage: %s [offline|runtime|full]\n" "$0" >&2
    exit 2
    ;;
esac
