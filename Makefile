.PHONY: help up up-admin up-lan up-lan-admin up-https-admin ensure-shared-infra-db check-shared-infra-network apply-backend-migrations check-backend-migrations apply-network-reference-schema apply-network-migrations check-network-migrations check-network-stack-ready check-network-worker-drill up-nats up-network-outbox-worker logs-network-outbox-worker up-network-governance-subscriber-worker logs-network-governance-subscriber-worker up-network-runtime-subscriber-worker logs-network-runtime-subscriber-worker qrtrustctl-container-help up-secondary-verifier-node up-secondary-verifier-node-shared-infra logs-secondary-verifier-node up-network-artifact-publication-worker logs-network-artifact-publication-worker up-network-verifier-cache-worker logs-network-verifier-cache-worker down-nats up-https-admin-shared-infra up-https-admin-shared-infra-nats down logs status smoke-compose smoke-compose-https dev-frontend dev-frontend-https check-route-navigation check-frontend-vite-config check-frontend-trust-tone check-frontend-scanner-contract check-frontend-scanner-open-contract check-python-verifier-lab-stability capture-browser-evidence check-browser-evidence smoke-ios ios-provider-config check-ios-provider-config check-ios-swift-parse ios-provider-profile-fixture check-ios-provider-profile-fixture ios-provider-profile-evidence-packet ios-provider-profile-evidence-status import-ios-provider-profile-evidence check-ios-provider-profile-evidence iphone-evidence-preflight iphone-evidence-packet iphone-evidence-status import-iphone-evidence check-iphone-evidence scanner-release-evidence-packet scanner-release-evidence-export-status scanner-release-evidence-downloads-status import-scanner-release-evidence-export import-scanner-release-evidence-downloads scanner-release-evidence-status check-trust-residuals-evaluation check-governance-fixtures check-network-contracts check-network-services check-network-services-offline check-network-services-runtime check-network-signing-custody-audit-export check-network-signing-custody-publication-audit check-network-artifact-publication-supervisor check-network-outbox-supervisor check-network-runtime-observations check-network-verifier-cache-supervisor check-network-verifier-cache-read-model check-network-scanner-decision-http-runtime check-network-scanner-fleet-evidence check-network-cross-surface-evidence check-network-worker-operations-evidence check-network-restore-automation-evidence check-network-packaged-deployment-approval-evidence check-network-operator-evidence-index check-network-production-evidence-requirements check-network-production-evidence-collection-template check-network-production-evidence-closure-bundle check-network-production-evidence-gap-report check-network-production-evidence-intake check-network-production-evidence-private-index check-network-adoption-stage check-network-reference-handoff-bundle scanner-fleet-evidence-artifacts-status scanner-fleet-capture-drill check-network-scanner-fleet-evidence-artifacts check-network-verifier-profile network-verifier-profile-distribution-report network-production-evidence-collection-template network-production-evidence-gap-report network-production-evidence-intake network-production-evidence-closure-bundle network-production-evidence-private-template check-network-live-postgres check-network-live-outbox-metrics check-network-live-nats check-network-live-outbox-worker check-network-live-authority-outbox check-network-live-outbox-retry check-network-live-verifier-cache check-network-live-scanner-decision network-adoption-stage-report network-adoption-stage-production-drill network-readiness-report network-readiness-bundle network-readiness-report-production network-readiness-report-production-drill network-readiness-bundle-production-drill network-reference-handoff-bundle network-reference-handoff-production-drill network-deployed-scanner-readiness-report release-readiness-report check-release-readiness-report release-audit release-audit-strict docs-build docs-serve test-backend build-frontend lint-frontend build-ios
.PHONY: generate-trust-residuals-fixtures
.PHONY: up-https-admin-nats demo-bootstrap check-stack-settled

VERIFIER_ADMIN_TOKENS ?= ["local-lab-admin"]
VERIFIER_SMOKE_ADMIN_TOKEN ?= local-lab-admin
API_PUBLISH_HOST ?= 127.0.0.1
API_PUBLISH_PORT ?= 8000
SECONDARY_API_PUBLISH_HOST ?= 127.0.0.1
SECONDARY_API_PUBLISH_PORT ?= 8001
SECONDARY_VERIFIER_ID ?= verifier:reference-http-runtime-b
SECONDARY_VERIFIER_PROVIDER_PROFILE_STATE ?= stale
SECONDARY_VERIFIER_REDIS_DB ?= 6
SECONDARY_VERIFIER_PUBLIC_BASE_URL ?= http://127.0.0.1:$(SECONDARY_API_PUBLISH_PORT)
FRONTEND_PUBLISH_HOST ?= 127.0.0.1
FRONTEND_PUBLISH_PORT ?= 5173
FRONTEND_DEV_HOST ?= 127.0.0.1
FRONTEND_DEV_PORT ?= 5173
DOCS_HOST ?= 127.0.0.1
DOCS_PORT ?= 8088
# The social plugin's cairosvg loads libcairo through ctypes, which on macOS
# does not search Homebrew's prefix. Empty on Linux/CI, where dyld is absent
# and the loader ignores DYLD_* anyway.
DOCS_CAIRO_ENV ?= $(shell for d in /opt/homebrew/lib /usr/local/lib; do if [ -f "$$d/libcairo.2.dylib" ]; then printf 'DYLD_FALLBACK_LIBRARY_PATH=%s' "$$d"; break; fi; done)
HTTPS_API_PUBLISH_PORT ?= 8443
HTTPS_FRONTEND_PUBLISH_PORT ?= 5174
# Advertised in provider profiles served by the HTTPS stack; must match the
# hostname iOS clients dial (see scripts/write_ios_local_provider_config.sh).
# Empty (no LocalHostName) falls back to the backend's request-Host echo.
HTTPS_VERIFIER_PUBLIC_BASE_URL ?= $(shell h=$$(scutil --get LocalHostName 2>/dev/null); if [ -n "$$h" ]; then printf 'https://%s.local:$(HTTPS_API_PUBLISH_PORT)' "$$h"; fi)
ROUTE_SMOKE_FRONTEND_BASE_URL ?= http://$(FRONTEND_DEV_HOST):$(FRONTEND_DEV_PORT)
POSTGRES_PUBLISH_HOST ?= 127.0.0.1
POSTGRES_PUBLISH_PORT ?= 5432
REDIS_PUBLISH_HOST ?= 127.0.0.1
REDIS_PUBLISH_PORT ?= 6379
# "External" means "not started by this overlay" -- it does not mean "not a
# container". These now default to the stack's own postgres service, so a bare
# `make check-network-stack-ready` works from a clean clone.
#
# They previously said publisher/publisher/qr_trust_poc, describing a Homebrew
# server that no longer exists: every postgresql@N formula is uninstalled and
# Postgres runs only in Docker here. That made an unqualified
# `make ensure-shared-infra-db` die with "password authentication failed for
# user publisher" -- which reads like a stale password rather than a server
# that was never running.
#
# SETUP_HOST is the address from the host (psql, in
# scripts/ensure_external_database.sh); HOST is the address from inside a
# container. Both reach the same postgres service.
EXTERNAL_DB_HOST ?= host.docker.internal
EXTERNAL_DB_SETUP_HOST ?= 127.0.0.1
EXTERNAL_DB_PORT ?= 5432
EXTERNAL_DB_USER ?= qr_admin
EXTERNAL_DB_PASSWORD ?= qr_dev_password
EXTERNAL_DB_NAME ?= qr_db
EXTERNAL_REDIS_HOSTNAME ?= host.docker.internal
EXTERNAL_REDIS_SETUP_HOST ?= 127.0.0.1
EXTERNAL_REDIS_PORT ?= 6379
EXTERNAL_REDIS_DB ?= 5
NATS_PUBLISH_HOST ?= 127.0.0.1
NATS_PUBLISH_PORT ?= 4222
NATS_MONITOR_PUBLISH_HOST ?= 127.0.0.1
NATS_MONITOR_PUBLISH_PORT ?= 8222
QRTRUST_NETWORK_NATS_URL ?= nats://127.0.0.1:4222
QRTRUST_NETWORK_NATS_USER ?= qrtrust_outbox_worker
QRTRUST_NETWORK_NATS_PASSWORD ?= qrtrust_outbox_worker_dev
QRTRUST_OUTBOX_NATS_USER ?= qrtrust_outbox_worker
QRTRUST_OUTBOX_NATS_PASSWORD ?= qrtrust_outbox_worker_dev
QRTRUST_OUTBOX_WORKER_ID ?= qrtrust-local-outbox-worker
QRTRUST_OUTBOX_BATCH_SIZE ?= 100
QRTRUST_OUTBOX_POLL_INTERVAL_MS ?= 1000
QRTRUST_OUTBOX_IDLE_POLL_INTERVAL_MS ?= 5000
QRTRUST_OUTBOX_IDLE_ITERATION_LIMIT ?= unbounded
QRTRUST_GOVERNANCE_SUBSCRIBER_NATS_USER ?= qrtrust_governance_subscriber
QRTRUST_GOVERNANCE_SUBSCRIBER_NATS_PASSWORD ?= qrtrust_governance_subscriber_dev
QRTRUST_ACCEPTED_ROOT_PROGRAM_IDS ?= root:qrtrust-demo:2026
QRTRUST_GOVERNANCE_SUBSCRIBER_ID ?= subscriber:reference-governance
QRTRUST_GOVERNANCE_SUBSCRIBER_WORKER_ID ?= qrtrust-local-governance-subscriber-worker
QRTRUST_GOVERNANCE_SUBSCRIBER_DURABLE ?= qrtrust_governance_subscriber_worker
QRTRUST_GOVERNANCE_SUBSCRIBER_VERIFIER_ID ?= verifier:reference-network
QRTRUST_GOVERNANCE_SUBSCRIBER_MAX_MESSAGES ?= unbounded
QRTRUST_GOVERNANCE_SUBSCRIBER_EXPIRES_MS ?= 2000
QRTRUST_RUNTIME_SUBSCRIBER_NATS_USER ?= qrtrust_runtime_subscriber
QRTRUST_RUNTIME_SUBSCRIBER_NATS_PASSWORD ?= qrtrust_runtime_subscriber_dev
QRTRUST_RUNTIME_SUBSCRIBER_ID ?= subscriber:runtime-observations
QRTRUST_RUNTIME_SUBSCRIBER_WORKER_ID ?= qrtrust-local-runtime-subscriber-worker
QRTRUST_RUNTIME_SUBSCRIBER_DURABLE ?= qrtrust_runtime_subscriber_worker
QRTRUST_RUNTIME_SUBSCRIBER_MAX_MESSAGES ?= unbounded
QRTRUST_RUNTIME_SUBSCRIBER_EXPIRES_MS ?= 2000
QRTRUST_ARTIFACT_PUBLICATION_WORKER_ID ?= qrtrust-local-artifact-publication-worker
QRTRUST_ARTIFACT_PUBLICATION_BATCH_SIZE ?= 50
QRTRUST_ARTIFACT_PUBLICATION_POLL_INTERVAL_MS ?= 1000
QRTRUST_ARTIFACT_PUBLICATION_IDLE_POLL_INTERVAL_MS ?= 5000
QRTRUST_ARTIFACT_PUBLICATION_IDLE_ITERATION_LIMIT ?= unbounded
QRTRUST_VERIFIER_CACHE_WORKER_ID ?= qrtrust-local-verifier-cache-worker
QRTRUST_VERIFIER_CACHE_BATCH_SIZE ?= 50
QRTRUST_VERIFIER_CACHE_POLL_INTERVAL_MS ?= 1000
QRTRUST_VERIFIER_CACHE_IDLE_POLL_INTERVAL_MS ?= 5000
QRTRUST_VERIFIER_CACHE_IDLE_ITERATION_LIMIT ?= unbounded
IOS_SMOKE_SKIP_BUILD ?= false
IPHONE_EVIDENCE_SOURCE_DIR ?=
IOS_PROVIDER_PROFILE_EVIDENCE_SOURCE_DIR ?=
SCANNER_RELEASE_EVIDENCE_SOURCE_DIR ?=
SCANNER_RELEASE_EVIDENCE_DOWNLOADS_DIR ?= $(HOME)/Downloads

help:
	@printf "Targets:\n"
	@printf "  make up             Start compose stack with default local-only bindings.\n"
	@printf "  make up-admin       Start compose stack with verifier admin tokens enabled.\n"
	@printf "  make up-lan         Start compose stack on LAN for phone/device testing.\n"
	@printf "  make up-lan-admin   Start compose stack on LAN with verifier admin tokens enabled.\n"
	@printf "  make up-https-admin Start compose stack with API/frontend HTTPS and verifier admin tokens enabled.\n"
	@printf "  make up-https-admin-shared-infra Start HTTPS stack using existing Postgres/Redis.\n"
	@printf "  make check-shared-infra-network Check shared Postgres, Redis DB 5, and optional NATS readiness.\n"
	@printf "  make apply-backend-migrations Apply backend Alembic QR trust migrations to shared Postgres.\n"
	@printf "  make check-backend-migrations Show backend Alembic migration state for shared Postgres.\n"
	@printf "  make apply-network-reference-schema Run local TypeScript reference-schema helper for drift/smoke checks.\n"
	@printf "  make apply-network-migrations Alias to backend Alembic migration owner.\n"
	@printf "  make check-network-migrations Alias to backend Alembic migration state.\n"
	@printf "  make check-network-stack-ready Verify shared infra plus live NATS propagation readiness.\n"
	@printf "  make check-network-worker-drill Run reset-guarded Postgres-to-NATS worker drill.\n"
	@printf "  make up-nats        Start optional local NATS JetStream broker.\n"
	@printf "  make up-network-outbox-worker Start supervised Postgres-to-NATS outbox worker.\n"
	@printf "  make logs-network-outbox-worker Tail supervised outbox worker logs.\n"
	@printf "  make up-network-governance-subscriber-worker Start DB-authorized governance subscriber worker.\n"
	@printf "  make logs-network-governance-subscriber-worker Tail governance subscriber worker logs.\n"
	@printf "  make up-network-runtime-subscriber-worker Start DB-authorized runtime observation subscriber worker.\n"
	@printf "  make logs-network-runtime-subscriber-worker Tail runtime subscriber worker logs.\n"
	@printf "  make qrtrustctl-container-help Show the optional containerized management CLI surface.\n"
	@printf "  make up-secondary-verifier-node Start optional second verifier node for federation/stale-cache demos.\n"
	@printf "  make logs-secondary-verifier-node Tail optional second verifier node logs.\n"
	@printf "  make up-network-artifact-publication-worker Start supervised artifact publication queue worker.\n"
	@printf "  make logs-network-artifact-publication-worker Tail artifact publication worker logs.\n"
	@printf "  make up-network-verifier-cache-worker Start supervised verifier-cache read-model worker.\n"
	@printf "  make logs-network-verifier-cache-worker Tail verifier-cache read-model worker logs.\n"
	@printf "  make up-https-admin-shared-infra-nats Start HTTPS stack using existing Postgres/Redis plus local NATS.\n"
	@printf "  make down-nats      Stop optional local NATS JetStream broker.\n"
	@printf "  make down           Stop the compose stack.\n"
	@printf "  make logs           Tail compose logs.\n"
	@printf "  make status         Show compose service status.\n"
	@printf "  make smoke-compose  Run API and frontend smoke checks against the compose stack.\n"
	@printf "  make smoke-compose-https Run API and frontend smoke checks against the HTTPS compose stack.\n"
	@printf "  make dev-frontend   Run the React dev server against the published compose API.\n"
	@printf "  make dev-frontend-https Run the React dev server against the HTTPS API on port 8443.\n"
	@printf "  make check-route-navigation Validate React same-route query navigation.\n"
	@printf "  make check-frontend-vite-config Validate React dev proxy defaults.\n"
	@printf "  make check-frontend-trust-tone Validate React trust-row colour mapping.\n"
	@printf "  make check-frontend-scanner-contract Validate React scanner endpoint separation.\n"
	@printf "  make check-frontend-scanner-open-contract Validate React scanner open/hold UX contract.\n"
	@printf "  make check-python-verifier-lab-stability Run the fast Python lab stability gate.\n"
	@printf "  make capture-browser-evidence Capture accepted/replay/mismatch browser screenshots.\n"
	@printf "  make check-browser-evidence Validate tracked browser evidence screenshots.\n"
	@printf "  make smoke-ios      Check the iPhone scanner contract and build the simulator app.\n"
	@printf "  make ios-provider-config Generate ignored local iOS verifier-provider config.\n"
	@printf "  make check-ios-provider-config Validate tracked/default and ignored local iOS provider config.\n"
	@printf "  make ios-provider-profile-fixture Regenerate the signed iOS provider-profile fixture.\n"
	@printf "  make check-ios-provider-profile-fixture Validate the signed iOS provider-profile fixture.\n"
	@printf "  make ios-provider-profile-evidence-packet Create a local iOS provider-profile evidence capture packet.\n"
	@printf "  make ios-provider-profile-evidence-status Report native iOS provider-profile evidence progress.\n"
	@printf "  make import-ios-provider-profile-evidence Import exported native iOS provider-profile evidence artifacts.\n"
	@printf "  make check-ios-provider-profile-evidence Strictly validate native iOS provider-profile evidence.\n"
	@printf "  make iphone-evidence-preflight Check HTTPS, LAN URL, and physical iPhone readiness.\n"
	@printf "  make iphone-evidence-packet Create a local native-device evidence capture packet.\n"
	@printf "  make iphone-evidence-status Report local native-device evidence progress.\n"
	@printf "  make import-iphone-evidence Import exported native iPhone evidence artifacts.\n"
	@printf "  make check-iphone-evidence Validate tracked native iPhone evidence artifacts.\n"
	@printf "  make scanner-release-evidence-packet Create one local scanner release evidence handoff packet.\n"
	@printf "  make scanner-release-evidence-export-status Check one exported iOS evidence folder.\n"
	@printf "  make scanner-release-evidence-downloads-status Check whether ~/Downloads has importable iOS evidence.\n"
	@printf "  make import-scanner-release-evidence-export Import any matching files from one native export folder.\n"
	@printf "  make import-scanner-release-evidence-downloads Import matching evidence files from ~/Downloads.\n"
	@printf "  make scanner-release-evidence-todo Show the remaining scanner/provider evidence capture plan.\n"
	@printf "  make scanner-release-evidence-status Show native scanner, provider-profile, and deployed-scanner evidence status.\n"
	@printf "  make generate-trust-residuals-fixtures Regenerate artifact-integrity corpus fixtures.\n"
	@printf "  make check-trust-residuals-evaluation Regenerate and validate the public trust-residuals corpus report.\n"
	@printf "  make check-governance-fixtures Validate machine-readable governance fixtures.\n"
	@printf "  make check-network-contracts Validate draft QR trust network contracts.\n"
	@printf "  make check-network-services Typecheck and smoke-test the draft TypeScript network services, including localhost HTTP runtime.\n"
	@printf "  make check-network-services-offline Run sandbox-safe network service checks without opening a localhost HTTP socket.\n"
	@printf "  make check-network-services-runtime Run only the scanner-decision localhost HTTP runtime smoke.\n"
	@printf "  make check-network-signing-custody-audit-export Smoke-test public-safe signing custody audit export.\n"
	@printf "  make check-network-signing-custody-publication-audit Smoke-test publication-worker custody audit export.\n"
	@printf "  make check-network-artifact-publication-supervisor Smoke-test artifact-publication queue supervisor reports.\n"
	@printf "  make check-network-outbox-supervisor Smoke-test supervised outbox polling reports.\n"
	@printf "  make check-network-runtime-observations Smoke-test runtime observations and backend status bridge.\n"
	@printf "  make check-network-verifier-cache-supervisor Smoke-test verifier-cache queue supervisor reports.\n"
	@printf "  make check-network-verifier-cache-read-model Smoke-test verifier-cache materialization and persisted freshness.\n"
	@printf "  make check-network-scanner-decision-http-runtime Smoke-test scanner-decision HTTP runtime.\n"
	@printf "  make check-network-scanner-fleet-evidence Smoke-test scanner-fleet evidence packet rules.\n"
	@printf "  make scanner-fleet-capture-drill Write local iPhone capture drill URLs and artifact checklist.\n"
	@printf "  make check-network-cross-surface-evidence Smoke-test cross-surface QR evidence packet rules.\n"
	@printf "  make check-network-worker-operations-evidence Smoke-test worker-operations evidence packet rules.\n"
	@printf "  make check-network-restore-automation-evidence Smoke-test restore automation evidence packet rules.\n"
	@printf "  make check-network-packaged-deployment-approval-evidence Smoke-test packaged deployment approval evidence packet rules.\n"
	@printf "  make check-network-operator-evidence-index Smoke-test operator evidence index rules.\n"
	@printf "  make check-network-production-evidence-requirements Smoke-test production evidence requirements rules.\n"
	@printf "  make check-network-production-evidence-collection-template Smoke-test production evidence collection template rules.\n"
	@printf "  make check-network-production-evidence-closure-bundle Smoke-test production evidence closure bundle rules.\n"
	@printf "  make check-network-production-evidence-gap-report Smoke-test production evidence gap report rules.\n"
	@printf "  make check-network-production-evidence-intake Smoke-test production evidence intake gate rules.\n"
	@printf "  make check-network-production-evidence-private-index Validate a private operator evidence index without printing refs.\n"
	@printf "  make check-network-adoption-stage Smoke-test reference-network adoption stage claims.\n"
	@printf "  make check-network-reference-handoff-bundle Smoke-test stage-plus-readiness handoff consistency failures.\n"
	@printf "  make scanner-fleet-evidence-artifacts-status Report missing native scanner-fleet evidence files.\n"
	@printf "  make check-network-scanner-fleet-evidence-artifacts Strictly check native scanner-fleet evidence files.\n"
	@printf "  make check-network-verifier-profile Smoke-test verifier-profile distribution rules.\n"
	@printf "  make network-verifier-profile-distribution-report Write verifier-profile distribution JSON/Markdown report.\n"
	@printf "  make network-production-evidence-collection-template Write operator-facing production evidence collection template JSON/Markdown.\n"
	@printf "  make network-production-evidence-gap-report Write production evidence gap JSON/Markdown report.\n"
	@printf "  make network-production-evidence-intake Write production evidence intake JSON/Markdown report.\n"
	@printf "  make network-production-evidence-closure-bundle Write production evidence closure JSON/Markdown bundle.\n"
	@printf "  make network-production-evidence-private-template Write ignored private evidence starter JSON/Markdown.\n"
	@printf "  make check-network-live-postgres Optionally run the QR trust schema against a scratch Postgres database.\n"
	@printf "  make check-network-live-outbox-metrics Optionally run event-outbox metrics against scratch Postgres.\n"
	@printf "  make check-network-live-nats Run QR trust propagation against local NATS JetStream.\n"
	@printf "  make check-network-live-outbox-worker Run Postgres event-outbox worker against local NATS.\n"
	@printf "  make check-network-live-authority-outbox Run live Postgres authority publication through NATS.\n"
	@printf "  make check-network-live-outbox-retry Run live outbox failure and NATS recovery drill.\n"
	@printf "  make check-network-live-verifier-cache Run live Postgres verifier-cache read-model drill.\n"
	@printf "  make check-network-live-scanner-decision Run live scanner-decision cache and HTTP runtime drill.\n"
	@printf "  make network-adoption-stage-report Write local reference-network adoption JSON/Markdown.\n"
	@printf "  make network-adoption-stage-production-drill Write evidence-backed adoption production-candidate JSON/Markdown.\n"
	@printf "  make network-readiness-report Write local QR trust network readiness JSON/Markdown.\n"
	@printf "  make network-readiness-bundle Write a fingerprinted readiness handoff manifest.\n"
	@printf "  make network-readiness-report-production Write local production-mode readiness JSON/Markdown.\n"
	@printf "  make network-readiness-report-production-drill Write evidence-backed production drill JSON/Markdown.\n"
	@printf "  make network-readiness-bundle-production-drill Write an evidence-backed production drill handoff bundle.\n"
	@printf "  make network-reference-handoff-bundle Write a stage-plus-readiness reviewer handoff bundle.\n"
	@printf "  make network-reference-handoff-production-drill Write a production-drill stage-plus-readiness handoff bundle.\n"
	@printf "  make network-deployed-scanner-readiness-report Write scanner profile plus native evidence readiness JSON/Markdown.\n"
	@printf "  make release-readiness-report Write a local release readiness report.\n"
	@printf "  make check-release-readiness-report Validate production evidence visibility in the release report.\n"
	@printf "  make release-audit  Run the public release boundary and evidence audit.\n"
	@printf "  make release-audit-strict Fail the public release audit on any warning.\n"
	@printf "  make docs-build     Build the filtered MkDocs site with strict link validation.\n"
	@printf "  make docs-serve     Build and serve the filtered documentation on 127.0.0.1:8088.\n"
	@printf "  make test-backend   Run backend pytest suite.\n"
	@printf "  make build-frontend Build the React frontend.\n"
	@printf "  make lint-frontend  Lint the React frontend.\n"
	@printf "  make build-ios      Build the native iPhone scanner app for iOS Simulator.\n"

up:
	API_PUBLISH_HOST='$(API_PUBLISH_HOST)' \
	API_PUBLISH_PORT='$(API_PUBLISH_PORT)' \
	FRONTEND_PUBLISH_HOST='$(FRONTEND_PUBLISH_HOST)' \
	FRONTEND_PUBLISH_PORT='$(FRONTEND_PUBLISH_PORT)' \
	POSTGRES_PUBLISH_HOST='$(POSTGRES_PUBLISH_HOST)' \
	POSTGRES_PUBLISH_PORT='$(POSTGRES_PUBLISH_PORT)' \
	REDIS_PUBLISH_HOST='$(REDIS_PUBLISH_HOST)' \
	REDIS_PUBLISH_PORT='$(REDIS_PUBLISH_PORT)' \
	docker compose up -d --build

up-admin:
	VERIFIER_ADMIN_TOKENS='$(VERIFIER_ADMIN_TOKENS)' \
	VERIFIER_BOOTSTRAP_ADMIN_TOKENS_ENABLED='true' \
	API_PUBLISH_HOST='$(API_PUBLISH_HOST)' \
	API_PUBLISH_PORT='$(API_PUBLISH_PORT)' \
	FRONTEND_PUBLISH_HOST='$(FRONTEND_PUBLISH_HOST)' \
	FRONTEND_PUBLISH_PORT='$(FRONTEND_PUBLISH_PORT)' \
	POSTGRES_PUBLISH_HOST='$(POSTGRES_PUBLISH_HOST)' \
	POSTGRES_PUBLISH_PORT='$(POSTGRES_PUBLISH_PORT)' \
	REDIS_PUBLISH_HOST='$(REDIS_PUBLISH_HOST)' \
	REDIS_PUBLISH_PORT='$(REDIS_PUBLISH_PORT)' \
	docker compose up -d --build

up-lan:
	API_PUBLISH_HOST='0.0.0.0' \
	API_PUBLISH_PORT='$(API_PUBLISH_PORT)' \
	FRONTEND_PUBLISH_HOST='0.0.0.0' \
	FRONTEND_PUBLISH_PORT='$(FRONTEND_PUBLISH_PORT)' \
	POSTGRES_PUBLISH_HOST='$(POSTGRES_PUBLISH_HOST)' \
	POSTGRES_PUBLISH_PORT='$(POSTGRES_PUBLISH_PORT)' \
	REDIS_PUBLISH_HOST='$(REDIS_PUBLISH_HOST)' \
	REDIS_PUBLISH_PORT='$(REDIS_PUBLISH_PORT)' \
	docker compose up -d --build

up-lan-admin:
	VERIFIER_ADMIN_TOKENS='$(VERIFIER_ADMIN_TOKENS)' \
	VERIFIER_BOOTSTRAP_ADMIN_TOKENS_ENABLED='true' \
	API_PUBLISH_HOST='0.0.0.0' \
	API_PUBLISH_PORT='$(API_PUBLISH_PORT)' \
	FRONTEND_PUBLISH_HOST='0.0.0.0' \
	FRONTEND_PUBLISH_PORT='$(FRONTEND_PUBLISH_PORT)' \
	POSTGRES_PUBLISH_HOST='$(POSTGRES_PUBLISH_HOST)' \
	POSTGRES_PUBLISH_PORT='$(POSTGRES_PUBLISH_PORT)' \
	REDIS_PUBLISH_HOST='$(REDIS_PUBLISH_HOST)' \
	REDIS_PUBLISH_PORT='$(REDIS_PUBLISH_PORT)' \
	docker compose up -d --build

up-https-admin:
	VERIFIER_ADMIN_TOKENS='$(VERIFIER_ADMIN_TOKENS)' \
	VERIFIER_BOOTSTRAP_ADMIN_TOKENS_ENABLED='true' \
	VERIFIER_TLS_ENABLED='true' \
	VERIFIER_PUBLIC_BASE_URL='$(HTTPS_VERIFIER_PUBLIC_BASE_URL)' \
	API_PUBLISH_HOST='0.0.0.0' \
	API_PUBLISH_PORT='$(HTTPS_API_PUBLISH_PORT)' \
	FRONTEND_PUBLISH_HOST='0.0.0.0' \
	FRONTEND_PUBLISH_PORT='$(HTTPS_FRONTEND_PUBLISH_PORT)' \
	POSTGRES_PUBLISH_HOST='$(POSTGRES_PUBLISH_HOST)' \
	POSTGRES_PUBLISH_PORT='$(POSTGRES_PUBLISH_PORT)' \
	REDIS_PUBLISH_HOST='$(REDIS_PUBLISH_HOST)' \
	REDIS_PUBLISH_PORT='$(REDIS_PUBLISH_PORT)' \
	FRONTEND_TLS_ENABLED='true' \
	VITE_BACKEND_TARGET='https://api:8000' \
	docker compose up -d --build
	@$(MAKE) --no-print-directory check-stack-settled

ensure-shared-infra-db:
	@EXTERNAL_DB_HOST='$(EXTERNAL_DB_HOST)' \
	EXTERNAL_DB_SETUP_HOST='$(EXTERNAL_DB_SETUP_HOST)' \
	EXTERNAL_DB_PORT='$(EXTERNAL_DB_PORT)' \
	EXTERNAL_DB_USER='$(EXTERNAL_DB_USER)' \
	EXTERNAL_DB_PASSWORD='$(EXTERNAL_DB_PASSWORD)' \
	EXTERNAL_DB_NAME='$(EXTERNAL_DB_NAME)' \
	sh ./scripts/ensure_external_database.sh

check-shared-infra-network:
	@EXTERNAL_DB_HOST='$(EXTERNAL_DB_HOST)' \
	EXTERNAL_DB_SETUP_HOST='$(EXTERNAL_DB_SETUP_HOST)' \
	EXTERNAL_DB_PORT='$(EXTERNAL_DB_PORT)' \
	EXTERNAL_DB_USER='$(EXTERNAL_DB_USER)' \
	EXTERNAL_DB_PASSWORD='$(EXTERNAL_DB_PASSWORD)' \
	EXTERNAL_DB_NAME='$(EXTERNAL_DB_NAME)' \
	EXTERNAL_REDIS_HOSTNAME='$(EXTERNAL_REDIS_HOSTNAME)' \
	EXTERNAL_REDIS_SETUP_HOST='$(EXTERNAL_REDIS_SETUP_HOST)' \
	EXTERNAL_REDIS_PORT='$(EXTERNAL_REDIS_PORT)' \
	EXTERNAL_REDIS_DB='$(EXTERNAL_REDIS_DB)' \
	NATS_PUBLISH_HOST='$(NATS_PUBLISH_HOST)' \
	NATS_PUBLISH_PORT='$(NATS_PUBLISH_PORT)' \
	NATS_MONITOR_PUBLISH_HOST='$(NATS_MONITOR_PUBLISH_HOST)' \
	NATS_MONITOR_PUBLISH_PORT='$(NATS_MONITOR_PUBLISH_PORT)' \
	./backend/.venv/bin/python scripts/shared_infra_network_preflight.py

apply-backend-migrations: ensure-shared-infra-db
	@cd backend && DB_HOST='$(EXTERNAL_DB_SETUP_HOST)' DB_PORT='$(EXTERNAL_DB_PORT)' DB_USER='$(EXTERNAL_DB_USER)' DB_PASSWORD='$(EXTERNAL_DB_PASSWORD)' DB_NAME='$(EXTERNAL_DB_NAME)' ./.venv/bin/alembic -c alembic.ini upgrade head

check-backend-migrations: ensure-shared-infra-db
	@cd backend && DB_HOST='$(EXTERNAL_DB_SETUP_HOST)' DB_PORT='$(EXTERNAL_DB_PORT)' DB_USER='$(EXTERNAL_DB_USER)' DB_PASSWORD='$(EXTERNAL_DB_PASSWORD)' DB_NAME='$(EXTERNAL_DB_NAME)' ./.venv/bin/alembic -c alembic.ini current

apply-network-reference-schema: ensure-shared-infra-db
	@cd network && QRTRUST_NETWORK_DATABASE_URL='postgres://$(EXTERNAL_DB_USER):$(EXTERNAL_DB_PASSWORD)@$(EXTERNAL_DB_SETUP_HOST):$(EXTERNAL_DB_PORT)/$(EXTERNAL_DB_NAME)' npm run postgres:apply-reference-schema

apply-network-migrations:
	@$(MAKE) apply-backend-migrations

check-network-migrations:
	@$(MAKE) check-backend-migrations

check-network-stack-ready: ensure-shared-infra-db
	@$(MAKE) check-shared-infra-network
	@$(MAKE) check-network-live-nats

check-network-worker-drill: ensure-shared-infra-db
	@$(MAKE) check-shared-infra-network
	@$(MAKE) check-network-live-nats
	@$(MAKE) check-network-live-outbox-worker
	@$(MAKE) check-network-live-authority-outbox
	@$(MAKE) check-network-live-outbox-retry
	@$(MAKE) check-network-live-verifier-cache
	@$(MAKE) check-network-live-scanner-decision

up-nats:
	NATS_PUBLISH_HOST='$(NATS_PUBLISH_HOST)' \
	NATS_PUBLISH_PORT='$(NATS_PUBLISH_PORT)' \
	NATS_MONITOR_PUBLISH_HOST='$(NATS_MONITOR_PUBLISH_HOST)' \
	NATS_MONITOR_PUBLISH_PORT='$(NATS_MONITOR_PUBLISH_PORT)' \
	docker compose -f compose.nats.yml up -d nats

# Every compose.shared-infra.yml invocation below must also name
# compose.nats.yml: the override patches services drawn from both base files,
# and compose merges overrides by service name across the whole project, so
# omitting it leaves the NATS services carrying an environment but no image --
# which invalidates the project even for a target that wants neither.
up-network-outbox-worker: ensure-shared-infra-db
	@QRTRUST_NETWORK_DATABASE_URL='postgres://$(EXTERNAL_DB_USER):$(EXTERNAL_DB_PASSWORD)@$(EXTERNAL_DB_HOST):$(EXTERNAL_DB_PORT)/$(EXTERNAL_DB_NAME)' \
	QRTRUST_NETWORK_NATS_URL='nats://nats:4222' \
	QRTRUST_NETWORK_NATS_USER='$(QRTRUST_OUTBOX_NATS_USER)' \
	QRTRUST_NETWORK_NATS_PASSWORD='$(QRTRUST_OUTBOX_NATS_PASSWORD)' \
	QRTRUST_OUTBOX_WORKER_ID='$(QRTRUST_OUTBOX_WORKER_ID)' \
	QRTRUST_OUTBOX_BATCH_SIZE='$(QRTRUST_OUTBOX_BATCH_SIZE)' \
	QRTRUST_OUTBOX_POLL_INTERVAL_MS='$(QRTRUST_OUTBOX_POLL_INTERVAL_MS)' \
	QRTRUST_OUTBOX_IDLE_POLL_INTERVAL_MS='$(QRTRUST_OUTBOX_IDLE_POLL_INTERVAL_MS)' \
	QRTRUST_OUTBOX_IDLE_ITERATION_LIMIT='$(QRTRUST_OUTBOX_IDLE_ITERATION_LIMIT)' \
	NATS_PUBLISH_HOST='$(NATS_PUBLISH_HOST)' \
	NATS_PUBLISH_PORT='$(NATS_PUBLISH_PORT)' \
	NATS_MONITOR_PUBLISH_HOST='$(NATS_MONITOR_PUBLISH_HOST)' \
	NATS_MONITOR_PUBLISH_PORT='$(NATS_MONITOR_PUBLISH_PORT)' \
	docker compose -f compose.yml -f compose.nats.yml -f compose.shared-infra.yml up -d --build nats network-outbox-worker

logs-network-outbox-worker:
	docker compose -f compose.yml -f compose.nats.yml -f compose.shared-infra.yml logs --tail=80 -f network-outbox-worker

up-network-governance-subscriber-worker: ensure-shared-infra-db
	@QRTRUST_NETWORK_DATABASE_URL='postgres://$(EXTERNAL_DB_USER):$(EXTERNAL_DB_PASSWORD)@$(EXTERNAL_DB_HOST):$(EXTERNAL_DB_PORT)/$(EXTERNAL_DB_NAME)' \
	QRTRUST_NETWORK_NATS_URL='nats://nats:4222' \
	QRTRUST_NETWORK_NATS_USER='$(QRTRUST_GOVERNANCE_SUBSCRIBER_NATS_USER)' \
	QRTRUST_NETWORK_NATS_PASSWORD='$(QRTRUST_GOVERNANCE_SUBSCRIBER_NATS_PASSWORD)' \
	QRTRUST_ACCEPTED_ROOT_PROGRAM_IDS='$(QRTRUST_ACCEPTED_ROOT_PROGRAM_IDS)' \
	QRTRUST_GOVERNANCE_SUBSCRIBER_ID='$(QRTRUST_GOVERNANCE_SUBSCRIBER_ID)' \
	QRTRUST_GOVERNANCE_SUBSCRIBER_WORKER_ID='$(QRTRUST_GOVERNANCE_SUBSCRIBER_WORKER_ID)' \
	QRTRUST_GOVERNANCE_SUBSCRIBER_DURABLE='$(QRTRUST_GOVERNANCE_SUBSCRIBER_DURABLE)' \
	QRTRUST_GOVERNANCE_SUBSCRIBER_VERIFIER_ID='$(QRTRUST_GOVERNANCE_SUBSCRIBER_VERIFIER_ID)' \
	QRTRUST_GOVERNANCE_SUBSCRIBER_MAX_MESSAGES='$(QRTRUST_GOVERNANCE_SUBSCRIBER_MAX_MESSAGES)' \
	QRTRUST_GOVERNANCE_SUBSCRIBER_EXPIRES_MS='$(QRTRUST_GOVERNANCE_SUBSCRIBER_EXPIRES_MS)' \
	NATS_PUBLISH_HOST='$(NATS_PUBLISH_HOST)' \
	NATS_PUBLISH_PORT='$(NATS_PUBLISH_PORT)' \
	NATS_MONITOR_PUBLISH_HOST='$(NATS_MONITOR_PUBLISH_HOST)' \
	NATS_MONITOR_PUBLISH_PORT='$(NATS_MONITOR_PUBLISH_PORT)' \
	docker compose -f compose.yml -f compose.nats.yml -f compose.shared-infra.yml up -d --build nats network-governance-subscriber-worker

logs-network-governance-subscriber-worker:
	docker compose -f compose.yml -f compose.nats.yml -f compose.shared-infra.yml logs --tail=80 -f network-governance-subscriber-worker

up-network-runtime-subscriber-worker: ensure-shared-infra-db
	@QRTRUST_NETWORK_DATABASE_URL='postgres://$(EXTERNAL_DB_USER):$(EXTERNAL_DB_PASSWORD)@$(EXTERNAL_DB_HOST):$(EXTERNAL_DB_PORT)/$(EXTERNAL_DB_NAME)' \
	QRTRUST_NETWORK_NATS_URL='nats://nats:4222' \
	QRTRUST_NETWORK_NATS_USER='$(QRTRUST_RUNTIME_SUBSCRIBER_NATS_USER)' \
	QRTRUST_NETWORK_NATS_PASSWORD='$(QRTRUST_RUNTIME_SUBSCRIBER_NATS_PASSWORD)' \
	QRTRUST_RUNTIME_SUBSCRIBER_ID='$(QRTRUST_RUNTIME_SUBSCRIBER_ID)' \
	QRTRUST_RUNTIME_SUBSCRIBER_WORKER_ID='$(QRTRUST_RUNTIME_SUBSCRIBER_WORKER_ID)' \
	QRTRUST_RUNTIME_SUBSCRIBER_DURABLE='$(QRTRUST_RUNTIME_SUBSCRIBER_DURABLE)' \
	QRTRUST_RUNTIME_SUBSCRIBER_MAX_MESSAGES='$(QRTRUST_RUNTIME_SUBSCRIBER_MAX_MESSAGES)' \
	QRTRUST_RUNTIME_SUBSCRIBER_EXPIRES_MS='$(QRTRUST_RUNTIME_SUBSCRIBER_EXPIRES_MS)' \
	NATS_PUBLISH_HOST='$(NATS_PUBLISH_HOST)' \
	NATS_PUBLISH_PORT='$(NATS_PUBLISH_PORT)' \
	NATS_MONITOR_PUBLISH_HOST='$(NATS_MONITOR_PUBLISH_HOST)' \
	NATS_MONITOR_PUBLISH_PORT='$(NATS_MONITOR_PUBLISH_PORT)' \
	docker compose -f compose.yml -f compose.nats.yml -f compose.shared-infra.yml up -d --build nats network-runtime-subscriber-worker

logs-network-runtime-subscriber-worker:
	docker compose -f compose.yml -f compose.nats.yml -f compose.shared-infra.yml logs --tail=80 -f network-runtime-subscriber-worker

qrtrustctl-container-help:
	docker compose --profile management-tools run --rm management-cli --help

up-secondary-verifier-node:
	@SECONDARY_API_PUBLISH_HOST='$(SECONDARY_API_PUBLISH_HOST)' \
	SECONDARY_API_PUBLISH_PORT='$(SECONDARY_API_PUBLISH_PORT)' \
	SECONDARY_VERIFIER_ID='$(SECONDARY_VERIFIER_ID)' \
	SECONDARY_VERIFIER_PROVIDER_PROFILE_STATE='$(SECONDARY_VERIFIER_PROVIDER_PROFILE_STATE)' \
	SECONDARY_VERIFIER_REDIS_DB='$(SECONDARY_VERIFIER_REDIS_DB)' \
	SECONDARY_VERIFIER_PUBLIC_BASE_URL='$(SECONDARY_VERIFIER_PUBLIC_BASE_URL)' \
	docker compose --profile verifier-federation up -d --build api-verifier-b

up-secondary-verifier-node-shared-infra: ensure-shared-infra-db
	@SECONDARY_API_PUBLISH_HOST='$(SECONDARY_API_PUBLISH_HOST)' \
	SECONDARY_API_PUBLISH_PORT='$(SECONDARY_API_PUBLISH_PORT)' \
	SECONDARY_VERIFIER_ID='$(SECONDARY_VERIFIER_ID)' \
	SECONDARY_VERIFIER_PROVIDER_PROFILE_STATE='$(SECONDARY_VERIFIER_PROVIDER_PROFILE_STATE)' \
	SECONDARY_VERIFIER_REDIS_DB='$(SECONDARY_VERIFIER_REDIS_DB)' \
	SECONDARY_VERIFIER_PUBLIC_BASE_URL='$(SECONDARY_VERIFIER_PUBLIC_BASE_URL)' \
	EXTERNAL_DB_HOST='$(EXTERNAL_DB_HOST)' \
	EXTERNAL_DB_SETUP_HOST='$(EXTERNAL_DB_SETUP_HOST)' \
	EXTERNAL_DB_PORT='$(EXTERNAL_DB_PORT)' \
	EXTERNAL_DB_USER='$(EXTERNAL_DB_USER)' \
	EXTERNAL_DB_PASSWORD='$(EXTERNAL_DB_PASSWORD)' \
	EXTERNAL_DB_NAME='$(EXTERNAL_DB_NAME)' \
	EXTERNAL_REDIS_HOSTNAME='$(EXTERNAL_REDIS_HOSTNAME)' \
	EXTERNAL_REDIS_PORT='$(EXTERNAL_REDIS_PORT)' \
	docker compose -f compose.yml -f compose.nats.yml -f compose.shared-infra.yml --profile verifier-federation up -d --build api-verifier-b

logs-secondary-verifier-node:
	docker compose --profile verifier-federation logs --tail=80 -f api-verifier-b

up-network-artifact-publication-worker: ensure-shared-infra-db
	@QRTRUST_NETWORK_DATABASE_URL='postgres://$(EXTERNAL_DB_USER):$(EXTERNAL_DB_PASSWORD)@$(EXTERNAL_DB_HOST):$(EXTERNAL_DB_PORT)/$(EXTERNAL_DB_NAME)' \
	QRTRUST_ARTIFACT_PUBLICATION_WORKER_ID='$(QRTRUST_ARTIFACT_PUBLICATION_WORKER_ID)' \
	QRTRUST_ARTIFACT_PUBLICATION_BATCH_SIZE='$(QRTRUST_ARTIFACT_PUBLICATION_BATCH_SIZE)' \
	QRTRUST_ARTIFACT_PUBLICATION_POLL_INTERVAL_MS='$(QRTRUST_ARTIFACT_PUBLICATION_POLL_INTERVAL_MS)' \
	QRTRUST_ARTIFACT_PUBLICATION_IDLE_POLL_INTERVAL_MS='$(QRTRUST_ARTIFACT_PUBLICATION_IDLE_POLL_INTERVAL_MS)' \
	QRTRUST_ARTIFACT_PUBLICATION_IDLE_ITERATION_LIMIT='$(QRTRUST_ARTIFACT_PUBLICATION_IDLE_ITERATION_LIMIT)' \
	docker compose -f compose.yml -f compose.nats.yml -f compose.shared-infra.yml up -d --build network-artifact-publication-worker

logs-network-artifact-publication-worker:
	docker compose -f compose.yml -f compose.nats.yml -f compose.shared-infra.yml logs --tail=80 -f network-artifact-publication-worker

up-network-verifier-cache-worker: ensure-shared-infra-db
	@QRTRUST_NETWORK_DATABASE_URL='postgres://$(EXTERNAL_DB_USER):$(EXTERNAL_DB_PASSWORD)@$(EXTERNAL_DB_HOST):$(EXTERNAL_DB_PORT)/$(EXTERNAL_DB_NAME)' \
	QRTRUST_VERIFIER_CACHE_WORKER_ID='$(QRTRUST_VERIFIER_CACHE_WORKER_ID)' \
	QRTRUST_VERIFIER_CACHE_BATCH_SIZE='$(QRTRUST_VERIFIER_CACHE_BATCH_SIZE)' \
	QRTRUST_VERIFIER_CACHE_POLL_INTERVAL_MS='$(QRTRUST_VERIFIER_CACHE_POLL_INTERVAL_MS)' \
	QRTRUST_VERIFIER_CACHE_IDLE_POLL_INTERVAL_MS='$(QRTRUST_VERIFIER_CACHE_IDLE_POLL_INTERVAL_MS)' \
	QRTRUST_VERIFIER_CACHE_IDLE_ITERATION_LIMIT='$(QRTRUST_VERIFIER_CACHE_IDLE_ITERATION_LIMIT)' \
	docker compose -f compose.yml -f compose.nats.yml -f compose.shared-infra.yml up -d --build network-verifier-cache-worker

logs-network-verifier-cache-worker:
	docker compose -f compose.yml -f compose.nats.yml -f compose.shared-infra.yml logs --tail=80 -f network-verifier-cache-worker

down-nats:
	docker compose -f compose.nats.yml down

up-https-admin-shared-infra: ensure-shared-infra-db
	@docker compose stop postgres redis >/dev/null 2>&1 || true
	@VERIFIER_ADMIN_TOKENS='$(VERIFIER_ADMIN_TOKENS)' \
	VERIFIER_BOOTSTRAP_ADMIN_TOKENS_ENABLED='true' \
	VERIFIER_TLS_ENABLED='true' \
	API_PUBLISH_HOST='0.0.0.0' \
	API_PUBLISH_PORT='$(HTTPS_API_PUBLISH_PORT)' \
	FRONTEND_PUBLISH_HOST='0.0.0.0' \
	FRONTEND_PUBLISH_PORT='$(HTTPS_FRONTEND_PUBLISH_PORT)' \
	FRONTEND_TLS_ENABLED='true' \
	VITE_BACKEND_TARGET='https://api:8000' \
	EXTERNAL_DB_HOST='$(EXTERNAL_DB_HOST)' \
	EXTERNAL_DB_SETUP_HOST='$(EXTERNAL_DB_SETUP_HOST)' \
	EXTERNAL_DB_PORT='$(EXTERNAL_DB_PORT)' \
	EXTERNAL_DB_USER='$(EXTERNAL_DB_USER)' \
	EXTERNAL_DB_PASSWORD='$(EXTERNAL_DB_PASSWORD)' \
	EXTERNAL_DB_NAME='$(EXTERNAL_DB_NAME)' \
	EXTERNAL_REDIS_HOSTNAME='$(EXTERNAL_REDIS_HOSTNAME)' \
	EXTERNAL_REDIS_PORT='$(EXTERNAL_REDIS_PORT)' \
	EXTERNAL_REDIS_DB='$(EXTERNAL_REDIS_DB)' \
	docker compose -f compose.yml -f compose.nats.yml -f compose.shared-infra.yml up -d --build --remove-orphans api frontend
	@$(MAKE) --no-print-directory check-stack-settled COMPOSE_STACK_FILES='-f compose.yml -f compose.nats.yml -f compose.shared-infra.yml'

up-https-admin-shared-infra-nats: ensure-shared-infra-db
	@docker compose stop postgres redis >/dev/null 2>&1 || true
	@VERIFIER_ADMIN_TOKENS='$(VERIFIER_ADMIN_TOKENS)' \
	VERIFIER_BOOTSTRAP_ADMIN_TOKENS_ENABLED='true' \
	VERIFIER_TLS_ENABLED='true' \
	API_PUBLISH_HOST='0.0.0.0' \
	API_PUBLISH_PORT='$(HTTPS_API_PUBLISH_PORT)' \
	FRONTEND_PUBLISH_HOST='0.0.0.0' \
	FRONTEND_PUBLISH_PORT='$(HTTPS_FRONTEND_PUBLISH_PORT)' \
	FRONTEND_TLS_ENABLED='true' \
	VITE_BACKEND_TARGET='https://api:8000' \
	EXTERNAL_DB_HOST='$(EXTERNAL_DB_HOST)' \
	EXTERNAL_DB_SETUP_HOST='$(EXTERNAL_DB_SETUP_HOST)' \
	EXTERNAL_DB_PORT='$(EXTERNAL_DB_PORT)' \
	EXTERNAL_DB_USER='$(EXTERNAL_DB_USER)' \
	EXTERNAL_DB_PASSWORD='$(EXTERNAL_DB_PASSWORD)' \
	EXTERNAL_DB_NAME='$(EXTERNAL_DB_NAME)' \
	EXTERNAL_REDIS_HOSTNAME='$(EXTERNAL_REDIS_HOSTNAME)' \
	EXTERNAL_REDIS_PORT='$(EXTERNAL_REDIS_PORT)' \
	EXTERNAL_REDIS_DB='$(EXTERNAL_REDIS_DB)' \
	NATS_PUBLISH_HOST='$(NATS_PUBLISH_HOST)' \
	NATS_PUBLISH_PORT='$(NATS_PUBLISH_PORT)' \
	NATS_MONITOR_PUBLISH_HOST='$(NATS_MONITOR_PUBLISH_HOST)' \
	NATS_MONITOR_PUBLISH_PORT='$(NATS_MONITOR_PUBLISH_PORT)' \
	QRTRUST_NETWORK_DATABASE_URL='postgres://$(EXTERNAL_DB_USER):$(EXTERNAL_DB_PASSWORD)@$(EXTERNAL_DB_HOST):$(EXTERNAL_DB_PORT)/$(EXTERNAL_DB_NAME)' \
	QRTRUST_NETWORK_NATS_URL='nats://nats:4222' \
	QRTRUST_NETWORK_NATS_USER='$(QRTRUST_OUTBOX_NATS_USER)' \
	QRTRUST_NETWORK_NATS_PASSWORD='$(QRTRUST_OUTBOX_NATS_PASSWORD)' \
	QRTRUST_OUTBOX_WORKER_ID='$(QRTRUST_OUTBOX_WORKER_ID)' \
	QRTRUST_OUTBOX_BATCH_SIZE='$(QRTRUST_OUTBOX_BATCH_SIZE)' \
	QRTRUST_OUTBOX_POLL_INTERVAL_MS='$(QRTRUST_OUTBOX_POLL_INTERVAL_MS)' \
	QRTRUST_OUTBOX_IDLE_POLL_INTERVAL_MS='$(QRTRUST_OUTBOX_IDLE_POLL_INTERVAL_MS)' \
	QRTRUST_OUTBOX_IDLE_ITERATION_LIMIT='$(QRTRUST_OUTBOX_IDLE_ITERATION_LIMIT)' \
	QRTRUST_GOVERNANCE_SUBSCRIBER_NATS_USER='$(QRTRUST_GOVERNANCE_SUBSCRIBER_NATS_USER)' \
	QRTRUST_GOVERNANCE_SUBSCRIBER_NATS_PASSWORD='$(QRTRUST_GOVERNANCE_SUBSCRIBER_NATS_PASSWORD)' \
	QRTRUST_ACCEPTED_ROOT_PROGRAM_IDS='$(QRTRUST_ACCEPTED_ROOT_PROGRAM_IDS)' \
	QRTRUST_GOVERNANCE_SUBSCRIBER_ID='$(QRTRUST_GOVERNANCE_SUBSCRIBER_ID)' \
	QRTRUST_GOVERNANCE_SUBSCRIBER_WORKER_ID='$(QRTRUST_GOVERNANCE_SUBSCRIBER_WORKER_ID)' \
	QRTRUST_GOVERNANCE_SUBSCRIBER_DURABLE='$(QRTRUST_GOVERNANCE_SUBSCRIBER_DURABLE)' \
	QRTRUST_GOVERNANCE_SUBSCRIBER_VERIFIER_ID='$(QRTRUST_GOVERNANCE_SUBSCRIBER_VERIFIER_ID)' \
	QRTRUST_GOVERNANCE_SUBSCRIBER_MAX_MESSAGES='$(QRTRUST_GOVERNANCE_SUBSCRIBER_MAX_MESSAGES)' \
	QRTRUST_GOVERNANCE_SUBSCRIBER_EXPIRES_MS='$(QRTRUST_GOVERNANCE_SUBSCRIBER_EXPIRES_MS)' \
	QRTRUST_RUNTIME_SUBSCRIBER_NATS_USER='$(QRTRUST_RUNTIME_SUBSCRIBER_NATS_USER)' \
	QRTRUST_RUNTIME_SUBSCRIBER_NATS_PASSWORD='$(QRTRUST_RUNTIME_SUBSCRIBER_NATS_PASSWORD)' \
	QRTRUST_RUNTIME_SUBSCRIBER_ID='$(QRTRUST_RUNTIME_SUBSCRIBER_ID)' \
	QRTRUST_RUNTIME_SUBSCRIBER_WORKER_ID='$(QRTRUST_RUNTIME_SUBSCRIBER_WORKER_ID)' \
	QRTRUST_RUNTIME_SUBSCRIBER_DURABLE='$(QRTRUST_RUNTIME_SUBSCRIBER_DURABLE)' \
	QRTRUST_RUNTIME_SUBSCRIBER_MAX_MESSAGES='$(QRTRUST_RUNTIME_SUBSCRIBER_MAX_MESSAGES)' \
	QRTRUST_RUNTIME_SUBSCRIBER_EXPIRES_MS='$(QRTRUST_RUNTIME_SUBSCRIBER_EXPIRES_MS)' \
	docker compose -f compose.yml -f compose.nats.yml -f compose.shared-infra.yml up -d --build --remove-orphans api frontend nats network-outbox-worker network-governance-subscriber-worker network-runtime-subscriber-worker
	@$(MAKE) --no-print-directory check-stack-settled COMPOSE_STACK_FILES='-f compose.yml -f compose.nats.yml -f compose.shared-infra.yml'

# Self-contained counterpart to up-https-admin-shared-infra-nats: Postgres and
# Redis run as containers from compose.yml (postgres:18-alpine) rather than
# being reused from the developer's machine, so a fresh clone needs no local
# database server at all. This is the demo default; the shared-infra targets
# exist for the case where an external server is already the source of truth.
#
# QRTRUST_NETWORK_DATABASE_URL is deliberately NOT set here. compose.nats.yml
# already defaults every worker to the in-compose postgres service, and
# restating those credentials in the Makefile would let the two drift apart.
#
# No --remove-orphans, unlike the shared-infra sibling: this file set leaves
# api-verifier-b (profile verifier-federation) unselected, and orphan removal
# is what deletes unselected services' containers. Nothing here needs it --
# the target only ever adds services.
up-https-admin-nats:
	@VERIFIER_ADMIN_TOKENS='$(VERIFIER_ADMIN_TOKENS)' \
	VERIFIER_BOOTSTRAP_ADMIN_TOKENS_ENABLED='true' \
	VERIFIER_TLS_ENABLED='true' \
	VERIFIER_PUBLIC_BASE_URL='$(HTTPS_VERIFIER_PUBLIC_BASE_URL)' \
	API_PUBLISH_HOST='0.0.0.0' \
	API_PUBLISH_PORT='$(HTTPS_API_PUBLISH_PORT)' \
	FRONTEND_PUBLISH_HOST='0.0.0.0' \
	FRONTEND_PUBLISH_PORT='$(HTTPS_FRONTEND_PUBLISH_PORT)' \
	FRONTEND_TLS_ENABLED='true' \
	VITE_BACKEND_TARGET='https://api:8000' \
	POSTGRES_PUBLISH_HOST='$(POSTGRES_PUBLISH_HOST)' \
	POSTGRES_PUBLISH_PORT='$(POSTGRES_PUBLISH_PORT)' \
	REDIS_PUBLISH_HOST='$(REDIS_PUBLISH_HOST)' \
	REDIS_PUBLISH_PORT='$(REDIS_PUBLISH_PORT)' \
	NATS_PUBLISH_HOST='$(NATS_PUBLISH_HOST)' \
	NATS_PUBLISH_PORT='$(NATS_PUBLISH_PORT)' \
	NATS_MONITOR_PUBLISH_HOST='$(NATS_MONITOR_PUBLISH_HOST)' \
	NATS_MONITOR_PUBLISH_PORT='$(NATS_MONITOR_PUBLISH_PORT)' \
	QRTRUST_NETWORK_NATS_URL='nats://nats:4222' \
	QRTRUST_NETWORK_NATS_USER='$(QRTRUST_OUTBOX_NATS_USER)' \
	QRTRUST_NETWORK_NATS_PASSWORD='$(QRTRUST_OUTBOX_NATS_PASSWORD)' \
	QRTRUST_OUTBOX_WORKER_ID='$(QRTRUST_OUTBOX_WORKER_ID)' \
	QRTRUST_OUTBOX_BATCH_SIZE='$(QRTRUST_OUTBOX_BATCH_SIZE)' \
	QRTRUST_OUTBOX_POLL_INTERVAL_MS='$(QRTRUST_OUTBOX_POLL_INTERVAL_MS)' \
	QRTRUST_OUTBOX_IDLE_POLL_INTERVAL_MS='$(QRTRUST_OUTBOX_IDLE_POLL_INTERVAL_MS)' \
	QRTRUST_OUTBOX_IDLE_ITERATION_LIMIT='$(QRTRUST_OUTBOX_IDLE_ITERATION_LIMIT)' \
	QRTRUST_GOVERNANCE_SUBSCRIBER_NATS_USER='$(QRTRUST_GOVERNANCE_SUBSCRIBER_NATS_USER)' \
	QRTRUST_GOVERNANCE_SUBSCRIBER_NATS_PASSWORD='$(QRTRUST_GOVERNANCE_SUBSCRIBER_NATS_PASSWORD)' \
	QRTRUST_ACCEPTED_ROOT_PROGRAM_IDS='$(QRTRUST_ACCEPTED_ROOT_PROGRAM_IDS)' \
	QRTRUST_GOVERNANCE_SUBSCRIBER_ID='$(QRTRUST_GOVERNANCE_SUBSCRIBER_ID)' \
	QRTRUST_GOVERNANCE_SUBSCRIBER_WORKER_ID='$(QRTRUST_GOVERNANCE_SUBSCRIBER_WORKER_ID)' \
	QRTRUST_GOVERNANCE_SUBSCRIBER_DURABLE='$(QRTRUST_GOVERNANCE_SUBSCRIBER_DURABLE)' \
	QRTRUST_GOVERNANCE_SUBSCRIBER_VERIFIER_ID='$(QRTRUST_GOVERNANCE_SUBSCRIBER_VERIFIER_ID)' \
	QRTRUST_GOVERNANCE_SUBSCRIBER_MAX_MESSAGES='$(QRTRUST_GOVERNANCE_SUBSCRIBER_MAX_MESSAGES)' \
	QRTRUST_GOVERNANCE_SUBSCRIBER_EXPIRES_MS='$(QRTRUST_GOVERNANCE_SUBSCRIBER_EXPIRES_MS)' \
	QRTRUST_RUNTIME_SUBSCRIBER_NATS_USER='$(QRTRUST_RUNTIME_SUBSCRIBER_NATS_USER)' \
	QRTRUST_RUNTIME_SUBSCRIBER_NATS_PASSWORD='$(QRTRUST_RUNTIME_SUBSCRIBER_NATS_PASSWORD)' \
	QRTRUST_RUNTIME_SUBSCRIBER_ID='$(QRTRUST_RUNTIME_SUBSCRIBER_ID)' \
	QRTRUST_RUNTIME_SUBSCRIBER_WORKER_ID='$(QRTRUST_RUNTIME_SUBSCRIBER_WORKER_ID)' \
	QRTRUST_RUNTIME_SUBSCRIBER_DURABLE='$(QRTRUST_RUNTIME_SUBSCRIBER_DURABLE)' \
	QRTRUST_RUNTIME_SUBSCRIBER_MAX_MESSAGES='$(QRTRUST_RUNTIME_SUBSCRIBER_MAX_MESSAGES)' \
	QRTRUST_RUNTIME_SUBSCRIBER_EXPIRES_MS='$(QRTRUST_RUNTIME_SUBSCRIBER_EXPIRES_MS)' \
	QRTRUST_ARTIFACT_PUBLICATION_WORKER_ID='$(QRTRUST_ARTIFACT_PUBLICATION_WORKER_ID)' \
	QRTRUST_ARTIFACT_PUBLICATION_BATCH_SIZE='$(QRTRUST_ARTIFACT_PUBLICATION_BATCH_SIZE)' \
	QRTRUST_ARTIFACT_PUBLICATION_POLL_INTERVAL_MS='$(QRTRUST_ARTIFACT_PUBLICATION_POLL_INTERVAL_MS)' \
	QRTRUST_ARTIFACT_PUBLICATION_IDLE_POLL_INTERVAL_MS='$(QRTRUST_ARTIFACT_PUBLICATION_IDLE_POLL_INTERVAL_MS)' \
	QRTRUST_ARTIFACT_PUBLICATION_IDLE_ITERATION_LIMIT='$(QRTRUST_ARTIFACT_PUBLICATION_IDLE_ITERATION_LIMIT)' \
	QRTRUST_VERIFIER_CACHE_WORKER_ID='$(QRTRUST_VERIFIER_CACHE_WORKER_ID)' \
	QRTRUST_VERIFIER_CACHE_BATCH_SIZE='$(QRTRUST_VERIFIER_CACHE_BATCH_SIZE)' \
	QRTRUST_VERIFIER_CACHE_POLL_INTERVAL_MS='$(QRTRUST_VERIFIER_CACHE_POLL_INTERVAL_MS)' \
	QRTRUST_VERIFIER_CACHE_IDLE_POLL_INTERVAL_MS='$(QRTRUST_VERIFIER_CACHE_IDLE_POLL_INTERVAL_MS)' \
	QRTRUST_VERIFIER_CACHE_IDLE_ITERATION_LIMIT='$(QRTRUST_VERIFIER_CACHE_IDLE_ITERATION_LIMIT)' \
	docker compose -f compose.yml -f compose.nats.yml up -d --build postgres redis api frontend nats network-outbox-worker network-governance-subscriber-worker network-runtime-subscriber-worker network-artifact-publication-worker network-verifier-cache-worker
	@$(MAKE) --no-print-directory check-stack-settled COMPOSE_STACK_FILES='-f compose.yml -f compose.nats.yml'

# The gate every bring-up target ends with. `docker compose up -d` exits 0 once
# containers have been *started*, so a worker that boots, fails its
# authorization check and exits still leaves the target green -- and then
# crash-loops in the background under `restart: unless-stopped`. That is exactly
# how the stack came to report success while the governance and runtime
# subscribers were dying on "NATS subscriber is not active or authorized",
# which is only discoverable by reading logs nobody thinks to read after a
# successful build.
#
# Pass the same -f set the target brought the stack up with: `compose ps -q`
# resolves the service list from those files, and a narrower set would silently
# skip the very workers most likely to be broken.
COMPOSE_STACK_FILES ?= -f compose.yml
check-stack-settled:
	@sh scripts/wait_for_stack_settled.sh $(COMPOSE_STACK_FILES)

# Every variable the api, postgres and redis services interpolate, carrying the
# same values up-https-admin-nats starts them with.
#
# This block is load-bearing, not decoration. `docker compose run` re-resolves
# the services it touches from the files and environment on its own command
# line, so any variable missing here falls back to its compose default. That
# changes the api service's config hash, and compose then recreates the running
# api -- quietly dropping the TLS and admin tokens the stack was brought up
# with, while the frontend goes on proxying to https://api:8000. Keep it in step
# with up-https-admin-nats.
DEMO_BOOTSTRAP_STACK_ENV = \
	VERIFIER_ADMIN_TOKENS='$(VERIFIER_ADMIN_TOKENS)' \
	VERIFIER_BOOTSTRAP_ADMIN_TOKENS_ENABLED='true' \
	VERIFIER_TLS_ENABLED='true' \
	VERIFIER_PUBLIC_BASE_URL='$(HTTPS_VERIFIER_PUBLIC_BASE_URL)' \
	API_PUBLISH_HOST='0.0.0.0' \
	API_PUBLISH_PORT='$(HTTPS_API_PUBLISH_PORT)' \
	POSTGRES_PUBLISH_HOST='$(POSTGRES_PUBLISH_HOST)' \
	POSTGRES_PUBLISH_PORT='$(POSTGRES_PUBLISH_PORT)' \
	REDIS_PUBLISH_HOST='$(REDIS_PUBLISH_HOST)' \
	REDIS_PUBLISH_PORT='$(REDIS_PUBLISH_PORT)'

# Seeds qr_trust.nats_subscribers and its subject allowlist. Until those rows
# exist the governance and runtime subscriber workers exit fatally with "NATS
# subscriber is not active or authorized", so every fresh database needs this
# before the stack can go green.
#
# The wait is the other half of the fix: management-cli declares depends_on api
# with no health condition, so compose will start the api and run the CLI
# against it in the same breath. Without waiting, the CLI dials the port before
# uvicorn binds it and fails with "Connection refused" -- which reads like a
# broken stack rather than a race.
#
# QRTRUSTCTL_BASE_URL names https because this target's env turns TLS on; the
# certificate is the local self-signed lab pair, hence insecure-tls.
demo-bootstrap:
	@$(DEMO_BOOTSTRAP_STACK_ENV) docker compose -f compose.yml -f compose.nats.yml up -d api
	@printf 'Waiting for the api container to report healthy...\n'
	@cid=$$($(DEMO_BOOTSTRAP_STACK_ENV) docker compose -f compose.yml -f compose.nats.yml ps -q api); \
	for i in $$(seq 1 90); do \
	  health=$$(docker inspect -f '{{.State.Health.Status}}' "$$cid" 2>/dev/null || echo missing); \
	  if [ "$$health" = healthy ]; then exit 0; fi; \
	  sleep 1; \
	done; \
	printf 'api did not report healthy within 90s (last state: %s)\n' "$$health" >&2; \
	exit 1
	@$(DEMO_BOOTSTRAP_STACK_ENV) \
	QRTRUSTCTL_BASE_URL='https://api:8000' \
	QRTRUSTCTL_INSECURE_TLS='true' \
	QRTRUSTCTL_ADMIN_TOKEN='$(VERIFIER_SMOKE_ADMIN_TOKEN)' \
	docker compose -f compose.yml -f compose.nats.yml --profile management-tools run --rm management-cli demo-bootstrap

down:
	docker compose down

logs:
	docker compose logs --tail=80 -f

status:
	docker compose ps

smoke-compose:
	API_INTERNAL_URL='$(API_INTERNAL_URL)' \
	FRONTEND_INTERNAL_URL='$(FRONTEND_INTERNAL_URL)' \
	FRONTEND_PUBLIC_URL='$(FRONTEND_PUBLIC_URL)' \
	VERIFIER_SMOKE_INSECURE_TLS='$(VERIFIER_SMOKE_INSECURE_TLS)' \
	FRONTEND_PUBLISH_PORT='$(FRONTEND_PUBLISH_PORT)' \
	VERIFIER_SMOKE_ADMIN_TOKEN='$(VERIFIER_SMOKE_ADMIN_TOKEN)' \
	./scripts/compose_workbench_smoke.sh

smoke-compose-https:
	@$(MAKE) smoke-compose API_INTERNAL_URL='https://127.0.0.1:8000' FRONTEND_INTERNAL_URL='https://127.0.0.1:5173' FRONTEND_PUBLIC_URL='https://127.0.0.1:$(HTTPS_FRONTEND_PUBLISH_PORT)' FRONTEND_PUBLISH_PORT='$(HTTPS_FRONTEND_PUBLISH_PORT)' VERIFIER_SMOKE_INSECURE_TLS=true

dev-frontend:
	cd frontend && VITE_BACKEND_TARGET='http://$(API_PUBLISH_HOST):$(API_PUBLISH_PORT)' npm run dev -- --host '$(FRONTEND_DEV_HOST)' --port '$(FRONTEND_DEV_PORT)'

dev-frontend-https:
	cd frontend && VITE_BACKEND_TARGET='https://127.0.0.1:$(HTTPS_API_PUBLISH_PORT)' npm run dev -- --host '$(FRONTEND_DEV_HOST)' --port '$(FRONTEND_DEV_PORT)'

check-route-navigation:
	FRONTEND_BASE_URL='$(ROUTE_SMOKE_FRONTEND_BASE_URL)' \
	./backend/.venv/bin/python backend/scripts/check_react_route_queries.py

check-frontend-vite-config:
	cd frontend && npm run vite-config:smoke

check-frontend-trust-tone:
	cd frontend && npm run trust-tone:smoke

check-frontend-scanner-contract:
	./backend/.venv/bin/python scripts/frontend_scanner_contract_check.py

check-frontend-scanner-open-contract:
	./backend/.venv/bin/python scripts/frontend_scanner_open_contract_check.py

check-python-verifier-lab-stability:
	cd backend && PYTHONPATH=.. ./.venv/bin/pytest tests/test_verifier_api.py tests/test_lab_source.py
	@$(MAKE) check-frontend-vite-config
	@$(MAKE) check-frontend-trust-tone
	@$(MAKE) check-frontend-scanner-contract
	@$(MAKE) check-frontend-scanner-open-contract

capture-browser-evidence:
	FRONTEND_BASE_URL='http://$(FRONTEND_DEV_HOST):$(FRONTEND_DEV_PORT)' \
	./backend/.venv/bin/python backend/scripts/capture_react_lab_evidence.py

check-browser-evidence:
	sh ./scripts/browser_evidence_check.sh

smoke-ios:
	sh ./scripts/ios_provider_config_check.sh
	sh ./scripts/ios_provider_profile_fixture_check.sh
	SKIP_IOS_BUILD='$(IOS_SMOKE_SKIP_BUILD)' sh ./scripts/ios_harness_smoke.sh

ios-provider-config:
	sh ./scripts/write_ios_local_provider_config.sh

check-ios-provider-config:
	sh ./scripts/ios_provider_config_check.sh

# A syntax gate, not a build. -parse stops before name resolution, so it never
# looks for SwiftUI or UIKit and runs on any platform with a Swift toolchain --
# which is what makes it the one part of the iOS target CI can reach without a
# macOS runner. It catches unbalanced braces and malformed declarations; it does
# not catch a missing symbol or a type error. Only build-ios does that.
# -swift-version 5 mirrors SWIFT_VERSION = 5.0 in the pbxproj, so CI parses in
# the same language mode Xcode compiles in rather than the toolchain default.
check-ios-swift-parse:
	swiftc -parse -swift-version 5 ios/VerifierLabApp/VerifierLabApp/*.swift

ios-provider-profile-fixture:
	mkdir -p .build/swift-module-cache
	swift -module-cache-path .build/swift-module-cache scripts/generate_ios_provider_profile_fixture.swift

check-ios-provider-profile-fixture:
	sh ./scripts/ios_provider_profile_fixture_check.sh

ios-provider-profile-evidence-packet:
	sh ./scripts/ios_provider_profile_evidence_packet.sh

ios-provider-profile-evidence-status:
	sh ./scripts/ios_provider_profile_evidence_status.sh

import-ios-provider-profile-evidence:
	sh ./scripts/import_ios_provider_profile_evidence.sh '$(IOS_PROVIDER_PROFILE_EVIDENCE_SOURCE_DIR)'

check-ios-provider-profile-evidence:
	sh ./scripts/ios_provider_profile_evidence_check.sh

iphone-evidence-preflight: ios-provider-config
	sh ./scripts/ios_provider_config_check.sh
	sh ./scripts/iphone_device_preflight.sh

iphone-evidence-packet:
	sh ./scripts/iphone_evidence_packet.sh

iphone-evidence-status:
	sh ./scripts/iphone_evidence_status.sh

import-iphone-evidence:
	sh ./scripts/import_iphone_evidence.sh '$(IPHONE_EVIDENCE_SOURCE_DIR)'

check-iphone-evidence:
	sh ./scripts/iphone_evidence_check.sh

scanner-release-evidence-packet:
	sh ./scripts/scanner_release_evidence_packet.sh

scanner-release-evidence-export-status:
	sh ./scripts/scanner_release_evidence_export_status.sh '$(SCANNER_RELEASE_EVIDENCE_SOURCE_DIR)'

scanner-release-evidence-downloads-status:
	sh ./scripts/scanner_release_evidence_export_status.sh '$(SCANNER_RELEASE_EVIDENCE_DOWNLOADS_DIR)'

import-scanner-release-evidence-export:
	sh ./scripts/import_scanner_release_evidence_export.sh '$(SCANNER_RELEASE_EVIDENCE_SOURCE_DIR)'

import-scanner-release-evidence-downloads:
	sh ./scripts/import_scanner_release_evidence_export.sh '$(SCANNER_RELEASE_EVIDENCE_DOWNLOADS_DIR)'

.PHONY: scanner-release-evidence-todo
scanner-release-evidence-todo:
	sh ./scripts/scanner_release_evidence_todo.sh

scanner-release-evidence-status:
	@printf "Scanner release evidence status\n"
	@printf "\n--- Native scanner evidence ---\n"
	@$(MAKE) --no-print-directory iphone-evidence-status
	@printf "\n--- Native provider-profile evidence ---\n"
	@$(MAKE) --no-print-directory ios-provider-profile-evidence-status
	@printf "\n--- Deployed scanner readiness ---\n"
	@$(MAKE) --no-print-directory network-deployed-scanner-readiness-report
	@printf "\n--- Missing evidence handoff ---\n"
	@$(MAKE) --no-print-directory scanner-release-evidence-todo

check-governance-fixtures:
	./backend/.venv/bin/python scripts/governance_fixtures_check.py

check-network-contracts:
	./backend/.venv/bin/python scripts/network_contracts_check.py

check-network-services:
	sh ./scripts/network_services_check.sh full

check-network-services-offline:
	sh ./scripts/network_services_check.sh offline

check-network-services-runtime:
	sh ./scripts/network_services_check.sh runtime

check-network-signing-custody-audit-export:
	cd network && npm run signing-custody:audit-export-smoke

check-network-signing-custody-publication-audit:
	cd network && npm run signing-custody:publication-audit-smoke

check-network-artifact-publication-supervisor:
	cd network && npm run artifact-publication:queue-supervisor-smoke

check-network-outbox-supervisor:
	cd network && npm run event-outbox:supervisor-smoke

check-network-runtime-observations:
	cd network && npm run runtime:observation-report-smoke
	./backend/.venv/bin/pytest backend/tests/test_runtime_observation_status.py backend/tests/test_scanner_decision_status.py backend/tests/test_verifier_api.py -q

check-network-verifier-cache-supervisor:
	cd network && npm run verifier-cache:read-model-queue-supervisor-smoke

check-network-verifier-cache-read-model:
	cd network && npm run verifier-cache:materialization-smoke
	cd network && npm run verifier-cache:read-model-worker-smoke

check-network-scanner-decision-http-runtime:
	cd network && npm run scanner-decision:http-runtime-smoke

check-network-scanner-fleet-evidence:
	cd network && npm run scanner-fleet:evidence-smoke

check-network-cross-surface-evidence:
	cd network && npm run cross-surface:evidence-smoke

check-network-worker-operations-evidence:
	cd network && npm run worker-operations:evidence-smoke

check-network-restore-automation-evidence:
	cd network && npm run restore-automation:evidence-smoke

check-network-packaged-deployment-approval-evidence:
	cd network && npm run packaged-deployment:evidence-smoke

check-network-operator-evidence-index:
	cd network && npm run operator-evidence:index-smoke

check-network-production-evidence-requirements:
	cd network && npm run production-evidence:requirements-smoke

check-network-production-evidence-collection-template:
	cd network && npm run production-evidence:collection-template-smoke

check-network-production-evidence-closure-bundle:
	cd network && npm run production-evidence:closure-bundle-smoke

check-network-production-evidence-gap-report:
	cd network && npm run production-evidence:gap-report-smoke

check-network-production-evidence-intake:
	cd network && npm run production-evidence:intake-smoke

check-network-production-evidence-private-index:
	cd network && npm run production-evidence:private-index-check && npm run production-evidence:private-workflow-smoke

check-network-adoption-stage:
	cd network && npm run reference-network:adoption-stage-smoke

check-network-reference-handoff-bundle:
	cd network && npm run reference-network:handoff-bundle-smoke

scanner-fleet-evidence-artifacts-status:
	cd network && npm run scanner-fleet:evidence-artifacts-status

scanner-fleet-capture-drill:
	cd network && npm run scanner-fleet:capture-drill

check-network-scanner-fleet-evidence-artifacts:
	cd network && npm run scanner-fleet:evidence-artifacts-check

check-network-verifier-profile:
	cd network && npm run verifier-profile:distribution-smoke

network-verifier-profile-distribution-report:
	cd network && npm run verifier-profile:distribution-report

network-production-evidence-collection-template:
	cd network && npm run production-evidence:collection-template

network-production-evidence-gap-report:
	cd network && npm run production-evidence:gap-report

network-production-evidence-intake: network-production-evidence-collection-template network-production-evidence-gap-report
	cd network && npm run production-evidence:intake

network-production-evidence-closure-bundle: network-production-evidence-intake
	cd network && npm run production-evidence:closure-bundle

network-production-evidence-private-template:
	cd network && npm run production-evidence:private-template

check-network-live-postgres:
	cd network && QRTRUST_NETWORK_DATABASE_URL='postgres://$(EXTERNAL_DB_USER):$(EXTERNAL_DB_PASSWORD)@$(EXTERNAL_DB_SETUP_HOST):$(EXTERNAL_DB_PORT)/$(EXTERNAL_DB_NAME)' QRTRUST_NETWORK_LIVE_SMOKE_RESET=true QRTRUST_ALLOW_NON_PRODUCTION_REFERENCE_SEED=true npm run postgres:live-smoke
	@$(MAKE) apply-backend-migrations

check-network-live-outbox-metrics:
	cd network && QRTRUST_NETWORK_DATABASE_URL='postgres://$(EXTERNAL_DB_USER):$(EXTERNAL_DB_PASSWORD)@$(EXTERNAL_DB_SETUP_HOST):$(EXTERNAL_DB_PORT)/$(EXTERNAL_DB_NAME)' QRTRUST_NETWORK_LIVE_SMOKE_RESET=true QRTRUST_ALLOW_NON_PRODUCTION_REFERENCE_SEED=true npm run event-outbox:live-metrics-smoke
	@$(MAKE) apply-backend-migrations

check-network-live-nats:
	cd network && QRTRUST_NETWORK_NATS_URL='$(QRTRUST_NETWORK_NATS_URL)' QRTRUST_NETWORK_NATS_USER='$(QRTRUST_NETWORK_NATS_USER)' QRTRUST_NETWORK_NATS_PASSWORD='$(QRTRUST_NETWORK_NATS_PASSWORD)' npm run nats:live-broker-smoke

check-network-live-outbox-worker:
	cd network && QRTRUST_NETWORK_DATABASE_URL='postgres://$(EXTERNAL_DB_USER):$(EXTERNAL_DB_PASSWORD)@$(EXTERNAL_DB_SETUP_HOST):$(EXTERNAL_DB_PORT)/$(EXTERNAL_DB_NAME)' QRTRUST_NETWORK_LIVE_SMOKE_RESET=true QRTRUST_ALLOW_NON_PRODUCTION_REFERENCE_SEED=true QRTRUST_NETWORK_NATS_URL='$(QRTRUST_NETWORK_NATS_URL)' QRTRUST_NETWORK_NATS_USER='$(QRTRUST_NETWORK_NATS_USER)' QRTRUST_NETWORK_NATS_PASSWORD='$(QRTRUST_NETWORK_NATS_PASSWORD)' npm run event-outbox:live-worker-smoke
	@$(MAKE) apply-backend-migrations

check-network-live-authority-outbox:
	cd network && QRTRUST_NETWORK_DATABASE_URL='postgres://$(EXTERNAL_DB_USER):$(EXTERNAL_DB_PASSWORD)@$(EXTERNAL_DB_SETUP_HOST):$(EXTERNAL_DB_PORT)/$(EXTERNAL_DB_NAME)' QRTRUST_NETWORK_LIVE_SMOKE_RESET=true QRTRUST_ALLOW_NON_PRODUCTION_REFERENCE_SEED=true QRTRUST_NETWORK_NATS_URL='$(QRTRUST_NETWORK_NATS_URL)' QRTRUST_NETWORK_NATS_USER='$(QRTRUST_NETWORK_NATS_USER)' QRTRUST_NETWORK_NATS_PASSWORD='$(QRTRUST_NETWORK_NATS_PASSWORD)' npm run authority:publication-live-outbox-drill
	@$(MAKE) apply-backend-migrations

check-network-live-outbox-retry:
	cd network && QRTRUST_NETWORK_DATABASE_URL='postgres://$(EXTERNAL_DB_USER):$(EXTERNAL_DB_PASSWORD)@$(EXTERNAL_DB_SETUP_HOST):$(EXTERNAL_DB_PORT)/$(EXTERNAL_DB_NAME)' QRTRUST_NETWORK_LIVE_SMOKE_RESET=true QRTRUST_ALLOW_NON_PRODUCTION_REFERENCE_SEED=true QRTRUST_NETWORK_NATS_URL='$(QRTRUST_NETWORK_NATS_URL)' QRTRUST_NETWORK_NATS_USER='$(QRTRUST_NETWORK_NATS_USER)' QRTRUST_NETWORK_NATS_PASSWORD='$(QRTRUST_NETWORK_NATS_PASSWORD)' npm run event-outbox:live-retry-drill
	@$(MAKE) apply-backend-migrations

check-network-live-verifier-cache:
	cd network && QRTRUST_NETWORK_DATABASE_URL='postgres://$(EXTERNAL_DB_USER):$(EXTERNAL_DB_PASSWORD)@$(EXTERNAL_DB_SETUP_HOST):$(EXTERNAL_DB_PORT)/$(EXTERNAL_DB_NAME)' QRTRUST_NETWORK_LIVE_SMOKE_RESET=true QRTRUST_ALLOW_NON_PRODUCTION_REFERENCE_SEED=true npm run verifier-cache:live-read-model-drill
	@$(MAKE) apply-backend-migrations

check-network-live-scanner-decision:
	cd network && QRTRUST_NETWORK_DATABASE_URL='postgres://$(EXTERNAL_DB_USER):$(EXTERNAL_DB_PASSWORD)@$(EXTERNAL_DB_SETUP_HOST):$(EXTERNAL_DB_PORT)/$(EXTERNAL_DB_NAME)' QRTRUST_NETWORK_LIVE_SMOKE_RESET=true QRTRUST_ALLOW_NON_PRODUCTION_REFERENCE_SEED=true npm run scanner-decision:live-cache-drill
	@$(MAKE) apply-backend-migrations

network-adoption-stage-report:
	cd network && npm run reference-network:adoption-stage

network-adoption-stage-production-drill:
	cd network && QRTRUST_ADOPTION_STAGE=3 QRTRUST_ADOPTION_CLAIM_MODE=production_candidate QRTRUST_ADOPTION_REFERENCE_PRESET=false QRTRUST_ADOPTION_EVIDENCE_JSON=../docs/public/network-contracts/reference-network-adoption.evidence.example.json QRTRUST_ADOPTION_OPERATOR_EVIDENCE_INDEX_JSON=../docs/public/network-contracts/examples/operator-evidence-index-production-candidate.json QRTRUST_ADOPTION_POSTGRES_READY=true QRTRUST_ADOPTION_AUTHORITY_PUBLICATION_READY=true QRTRUST_ADOPTION_NATS_READY=true QRTRUST_ADOPTION_VERIFIER_CACHE_READY=true QRTRUST_ADOPTION_SCANNER_DECISION_READY=true QRTRUST_ADOPTION_SCANNER_FLEET_EVIDENCE_READY=true QRTRUST_ADOPTION_CROSS_SURFACE_EVIDENCE_READY=true QRTRUST_ADOPTION_WORKER_OPERATIONS_EVIDENCE_READY=true QRTRUST_ADOPTION_SIGNING_CUSTODY_AUDIT_EXPORT_READY=true QRTRUST_ADOPTION_SIGNING_CUSTODY_READY=true QRTRUST_ADOPTION_RUNTIME_SAFETY_READY=true QRTRUST_ADOPTION_OPERATOR_RUNBOOKS_READY=true QRTRUST_ADOPTION_BACKUP_RESTORE_READY=true QRTRUST_ADOPTION_EXTERNAL_GOVERNANCE_AUDIT_READY=true QRTRUST_ADOPTION_JSON=../local/reference-network-adoption-production-drill-report.json QRTRUST_ADOPTION_MD=../local/reference-network-adoption-production-drill-report.md npm run reference-network:adoption-stage

network-readiness-report:
	cd network && npm run deployment:readiness-report

network-readiness-bundle:
	cd network && npm run deployment:readiness-bundle

network-readiness-report-production:
	cd network && QRTRUST_DEPLOYMENT_READINESS_MODE=production QRTRUST_DEPLOYMENT_READINESS_JSON=../local/network-readiness-production-report.json QRTRUST_DEPLOYMENT_READINESS_MD=../local/network-readiness-production-report.md npm run deployment:readiness-report

network-readiness-report-production-drill:
	cd network && QRTRUST_DEPLOYMENT_READINESS_MODE=production QRTRUST_DEPLOYMENT_READINESS_EVIDENCE_JSON=../docs/public/network-contracts/deployment-readiness.evidence.example.json QRTRUST_NETWORK_DATABASE_URL=postgres://qrtrust.example/reference QRTRUST_MIGRATION_LEDGER_ENABLED=true QRTRUST_RESTORE_AUTOMATION_DOCUMENTED=true QRTRUST_PACKAGED_DEPLOYMENT_OWNERSHIP_DOCUMENTED=true QRTRUST_NETWORK_NATS_URL=nats://qrtrust.example:4222 QRTRUST_MANAGED_KEY_MATERIAL_PROVIDER=managed://qrtrust/key-material QRTRUST_MANAGED_SIGNING_CUSTODY_PROVIDER=managed://qrtrust/signing-custody QRTRUST_CUSTODY_AUDIT_EXPORT_CONFIGURED=true QRTRUST_RUNTIME_SAFETY_PROVIDER=managed://qrtrust/runtime-safety QRTRUST_SCANNER_DECISION_PERSISTENCE_ENABLED=true QRTRUST_WORKER_OPERATIONS_EVIDENCE_READY=true QRTRUST_OPERATOR_RUNBOOKS_DOCUMENTED=true QRTRUST_DEPLOYMENT_READINESS_JSON=../local/network-readiness-production-drill-report.json QRTRUST_DEPLOYMENT_READINESS_MD=../local/network-readiness-production-drill-report.md npm run deployment:readiness-report

network-readiness-bundle-production-drill: network-readiness-report-production-drill
	cd network && QRTRUST_DEPLOYMENT_READINESS_REPORT_JSON=../local/network-readiness-production-drill-report.json QRTRUST_DEPLOYMENT_READINESS_REPORT_MD=../local/network-readiness-production-drill-report.md QRTRUST_DEPLOYMENT_READINESS_OPERATOR_EVIDENCE_INDEX_PACKET=../docs/public/network-contracts/examples/operator-evidence-index-production-candidate.json QRTRUST_DEPLOYMENT_READINESS_BUNDLE_JSON=../local/network-readiness-production-drill-bundle.json npm run deployment:readiness-bundle

network-reference-handoff-bundle: network-adoption-stage-report network-readiness-report network-readiness-bundle network-production-evidence-intake
	cd network && npm run reference-network:handoff-bundle

network-reference-handoff-production-drill: network-adoption-stage-production-drill network-readiness-bundle-production-drill network-production-evidence-intake
	cd network && QRTRUST_REFERENCE_HANDOFF_ADOPTION_JSON=../local/reference-network-adoption-production-drill-report.json QRTRUST_REFERENCE_HANDOFF_ADOPTION_MD=../local/reference-network-adoption-production-drill-report.md QRTRUST_REFERENCE_HANDOFF_READINESS_BUNDLE_JSON=../local/network-readiness-production-drill-bundle.json QRTRUST_REFERENCE_HANDOFF_READINESS_REPORT_JSON=../local/network-readiness-production-drill-report.json QRTRUST_REFERENCE_HANDOFF_READINESS_REPORT_MD=../local/network-readiness-production-drill-report.md QRTRUST_REFERENCE_HANDOFF_OPERATOR_EVIDENCE_INDEX_PACKET=../docs/public/network-contracts/examples/operator-evidence-index-production-candidate.json QRTRUST_REFERENCE_HANDOFF_PRODUCTION_OPERATOR_EVIDENCE_INDEX_PACKET=../docs/public/network-contracts/examples/operator-evidence-index-production-candidate.json QRTRUST_REFERENCE_HANDOFF_BUNDLE_JSON=../local/reference-network-production-drill-handoff-bundle.json npm run reference-network:handoff-bundle

network-deployed-scanner-readiness-report:
	cd network && npm run deployed-scanner:readiness-report

release-readiness-report:
	sh ./scripts/release_readiness_report.sh

check-release-readiness-report:
	sh ./scripts/release_readiness_report_check.sh

generate-trust-residuals-fixtures:
	./backend/.venv/bin/python scripts/generate_trust_residuals_artifact_fixtures.py

check-trust-residuals-evaluation:
	./backend/.venv/bin/python scripts/trust_residuals_evaluation.py --check

release-audit:
	sh ./scripts/public_release_audit.sh

release-audit-strict:
	STRICT_RELEASE_AUDIT=true sh ./scripts/public_release_audit.sh

docs-build:
	cd backend && uv sync --frozen
# mkdocs-material 9.7.7's optimize plugin races itself on a warm cache: it
# submits _optimize_image to a thread pool and then calls files.remove(file),
# but that worker ends by rewriting file.src_path -- the very key remove()
# looks up. A cache miss makes the worker shell out to pngquant first, so the
# main thread always wins; a cache hit skips to the mutation and often beats
# it, and the build dies with `'.cache/plugin/optimize/...' not in collection`.
# Locally that was 5 failures in 6 runs, a different image losing each time.
#
# Starting cold forces every worker down the slow path, which is what makes
# the ordering reliable rather than lucky. It costs nothing measurable --
# 3s cold against 2.5s warm -- because optimization overlaps the rest of the
# build. Drop this only when the plugin removes before it submits.
	rm -rf .cache/plugin/optimize
	$(DOCS_CAIRO_ENV) ./backend/.venv/bin/mkdocs build --strict --config-file mkdocs.yml
	test -f site/public/TRUST_MODEL_GRAPH/index.html
	test -f site/public/assets/stylesheets/diagram-explorer.css
	test -f site/public/assets/javascripts/diagram-explorer.js
	test -f site/backend/app/services/narrowed_verifier_poc.py/index.html
	rg -q 'Public source file' site/backend/app/services/narrowed_verifier_poc.py/index.html
# <div>, not <pre>: mkdocs-material ships its own mermaid mount whose selector
# is literally pre.mermaid. The <pre> that mermaid2's fence_mermaid_custom emits
# is therefore claimed by the theme, blanked to an empty <div class="mermaid">,
# and never rendered -- with no console error, so the build still looks green.
# Only a browser catches it. Assert both halves so the swap cannot come back.
	rg -q '<div class="mermaid">' site/public/TRUST_MODEL_GRAPH/index.html
	! rg -q '<pre class="mermaid">' site/public/TRUST_MODEL_GRAPH/index.html
# The other failure here is superfences claiming the fence itself and handing
# it to Pygments as an unknown language, which renders the diagram as source.
	! rg -q 'class="language-mermaid"' site/public/TRUST_MODEL_GRAPH/index.html
# Highlighting is invisible in the theme's CSS alone: mkdocs-material always
# ships the Pygments stylesheet, so a page can look styled while every fence is
# a bare <code> with nothing to colour. Assert the token spans themselves.
	rg -q '<div class="language-bash highlight">' site/public/RUN_GUIDE/index.html
	rg -q '<span class="nv">' site/public/RUN_GUIDE/index.html
	rg -q 'assets/stylesheets/diagram-explorer\.css' site/public/TRUST_MODEL_GRAPH/index.html
	rg -q 'assets/javascripts/diagram-explorer\.js' site/public/TRUST_MODEL_GRAPH/index.html
# --strict cannot see the source-view routes the mkdocs_source_pages hook
# generates, because they do not exist until this build has written them.
# Check the finished tree instead, where they do.
	./backend/.venv/bin/python backend/scripts/check_docs_links.py site

docs-serve: docs-build
	./backend/.venv/bin/python -m http.server '$(DOCS_PORT)' --bind '$(DOCS_HOST)' --directory site

test-backend:
	cd backend && PYTHONPATH=.. ./.venv/bin/pytest

build-frontend:
	cd frontend && npm run build

lint-frontend:
	cd frontend && npm run lint

build-ios:
	xcodebuild -project ios/VerifierLabApp/VerifierLabApp.xcodeproj \
		-scheme VerifierLabApp \
		-destination 'generic/platform=iOS Simulator' \
		-derivedDataPath /tmp/VerifierLabDerivedData \
		CODE_SIGNING_ALLOWED=NO build

