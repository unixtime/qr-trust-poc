#!/usr/bin/env sh
set -eu

APP_DIR="ios/VerifierLabApp/VerifierLabApp"
PROJECT_FILE="ios/VerifierLabApp/VerifierLabApp.xcodeproj/project.pbxproj"
SIGNED_PROVIDER_FIXTURE="docs/public/fixtures/ios/signed-provider-profile.demo.json"

fail() {
  printf "iOS scanner smoke failed: %s\n" "$1" >&2
  exit 1
}

assert_file() {
  [ -f "$1" ] || fail "missing $1"
}

assert_contains() {
  file="$1"
  pattern="$2"
  label="$3"
  if ! grep -Fq -- "$pattern" "$file"; then
    fail "$label not found in $file"
  fi
}

assert_not_contains() {
  file="$1"
  pattern="$2"
  label="$3"
  if grep -Fq -- "$pattern" "$file"; then
    fail "$label still present in $file"
  fi
}

assert_file "$PROJECT_FILE"
assert_file "$APP_DIR/ContentView.swift"
assert_file "$APP_DIR/Feedback.swift"
assert_file "$APP_DIR/Models.swift"
assert_file "$APP_DIR/ScannerView.swift"
assert_file "$APP_DIR/VerifierAPI.swift"
assert_file "$APP_DIR/VerifierLabViewModel.swift"
assert_file "$APP_DIR/LocalProvider.defaults.xcconfig"
assert_file "$APP_DIR/Info.plist"
assert_file "$SIGNED_PROVIDER_FIXTURE"

assert_contains "$PROJECT_FILE" "INFOPLIST_KEY_CFBundleDisplayName = \"QR Trust\"" "end-user app display name"
assert_contains "$PROJECT_FILE" "INFOPLIST_FILE = VerifierLabApp/Info.plist" "tracked iOS Info.plist"
assert_contains "$PROJECT_FILE" "INFOPLIST_KEY_NSAppTransportSecurity_NSAllowsLocalNetworking = YES" "local network transport exception"
assert_contains "$PROJECT_FILE" "INFOPLIST_KEY_NSCameraUsageDescription = \"Scan QR codes to show safety guidance before opening a link.\"" "end-user camera permission description"
assert_contains "$PROJECT_FILE" "INFOPLIST_KEY_QRTRUST_VERIFIER_BASE_URLS" "compiled verifier provider profile key"
assert_contains "$PROJECT_FILE" "INFOPLIST_KEY_UILaunchScreen_Generation = YES" "generated launch screen"
assert_contains "$PROJECT_FILE" "TARGETED_DEVICE_FAMILY = 1" "iPhone-only scanner target"
assert_contains "$PROJECT_FILE" "LocalProvider.defaults.xcconfig" "tracked local provider defaults"
assert_not_contains "$PROJECT_FILE" "INFOPLIST_KEY_QRTRUST_VERIFIER_PROFILE_STATE" "compiled verifier profile state key"
assert_not_contains "$PROJECT_FILE" "INFOPLIST_KEY_NSAppTransportSecurity_NSAllowsArbitraryLoads" "arbitrary transport exception"
# The personal-hostname guard that used to sit here now lives in
# scripts/public_release_audit.sh as the unlisted *.local scan. It covers the
# whole shipping tree instead of these two files, and runs in every audit role
# instead of only in this manual job -- so naming the banned host here would
# only cause the audit to flag its own guard. Spell it "*.local" in prose and
# never join a word to it with a hyphen: that scan accepts a hyphen mid-token,
# so a hyphenated phrase reads as a hostname and this comment would fail the
# audit. The word `make` needs the same discipline: the export's Make-target
# scan reads whatever word follows it as a target name, anywhere under
# scripts/ and .github/workflows/, comments included -- so the phrasing that
# used to sit on this line was reported as a missing target called "the".
# Backticks are the escape hatch: the scan requires whitespace right after
# the word, so `make` in prose never reads as an invocation.
# The 192.168.0. assertions stay: they are file-scoped on purpose, because
# RFC1918 literals appear legitimately in prose elsewhere in the tree.
assert_not_contains "$PROJECT_FILE" "192.168.0." "stale physical iPhone verifier target"

assert_contains "$APP_DIR/LocalProvider.defaults.xcconfig" "QRTRUST_VERIFIER_BASE_URLS" "local provider defaults key"
assert_contains "$APP_DIR/LocalProvider.defaults.xcconfig" "#include?" "optional local provider override"
assert_not_contains "$APP_DIR/LocalProvider.defaults.xcconfig" "QRTRUST_VERIFIER_PROFILE_STATE" "local provider default profile state"
assert_contains "$APP_DIR/Info.plist" "<key>QRTRUST_VERIFIER_BASE_URLS</key>" "compiled provider profile plist key"
assert_contains "$APP_DIR/Info.plist" '<string>$(QRTRUST_VERIFIER_BASE_URLS)</string>' "compiled provider profile plist value"
assert_not_contains "$APP_DIR/Info.plist" "QRTRUST_VERIFIER_PROFILE_STATE" "compiled verifier profile state plist key"
assert_contains "$APP_DIR/Info.plist" "<key>NSAllowsLocalNetworking</key>" "local networking plist exception"

assert_contains "$APP_DIR/ScannerView.swift" "AVCaptureMetadataOutput" "native metadata scanner"
assert_contains "$APP_DIR/ScannerView.swift" "output.metadataObjectTypes = [.qr]" "QR-only scanner metadata configuration"

assert_contains "$APP_DIR/VerifierAPI.swift" "path: \"/scanner/decisions\"" "scanner decision endpoint client"
assert_contains "$APP_DIR/VerifierAPI.swift" "path: \"/scanner/provider-profile\"" "runtime provider profile endpoint client"
assert_contains "$APP_DIR/VerifierAPI.swift" "QRTRUST_VERIFIER_BASE_URLS" "configured verifier endpoint source"
assert_not_contains "$APP_DIR/VerifierAPI.swift" "QRTRUST_VERIFIER_PROFILE_STATE" "configured verifier profile state source"
assert_contains "$APP_DIR/VerifierAPI.swift" "timeoutIntervalForRequest = requestTimeoutSeconds" "fast verifier request timeout"
assert_contains "$APP_DIR/VerifierAPI.swift" "waitsForConnectivity = false" "no long connectivity wait"
assert_contains "$APP_DIR/VerifierAPI.swift" "http://127.0.0.1:8000" "simulator verifier target"
assert_contains "$APP_DIR/VerifierAPI.swift" "Do not guess a local" "no physical-device hostname guessing"
assert_not_contains "$APP_DIR/VerifierAPI.swift" "https://qrtrust.local:8443" "physical-device hostname fallback"
# Personal-hostname guard moved to the unlisted *.local scan in
# scripts/public_release_audit.sh; see the note above the first
# 192.168.0. assertion.
assert_not_contains "$APP_DIR/VerifierAPI.swift" "192.168.0." "stale physical iPhone verifier target"
assert_not_contains "$APP_DIR/VerifierAPI.swift" "/verifier/admin/api-keys/issue" "developer key issue endpoint"
assert_not_contains "$APP_DIR/VerifierAPI.swift" "/verifier/demo-sessions" "developer demo session endpoint"
assert_not_contains "$APP_DIR/VerifierAPI.swift" "/verifier/verify-scanned" "developer verifier endpoint"

assert_contains "$APP_DIR/Models.swift" "enum TrustTone" "end-user trust tone model"
assert_contains "$APP_DIR/Models.swift" "case trusted" "green trust state"
assert_contains "$APP_DIR/Models.swift" "case caution" "orange trust state"
assert_contains "$APP_DIR/Models.swift" "case blocked" "red trust state"
assert_contains "$APP_DIR/Models.swift" "HistoryRetentionProfile" "local history retention model"
assert_contains "$APP_DIR/Models.swift" "ManagedVerifierProfile" "managed verifier profile model"
assert_contains "$APP_DIR/Models.swift" "TrustLayerSignal" "trust layer signal model"

assert_contains "$APP_DIR/VerifierLabViewModel.swift" "handleScannedPayload" "scan-only view model flow"
assert_contains "$APP_DIR/VerifierLabViewModel.swift" "refreshProviderProfile" "runtime provider profile refresh flow"
assert_contains "$APP_DIR/VerifierLabViewModel.swift" "fallbackDestinationURL" "service outage destination fallback"
assert_contains "$APP_DIR/VerifierLabViewModel.swift" "signedEnvelopeDestinationURL" "signed envelope destination fallback"
assert_contains "$APP_DIR/VerifierLabViewModel.swift" "claims[\"payload\"]" "structured QR payload URL extraction"
assert_contains "$APP_DIR/VerifierLabViewModel.swift" "unavailableTrustLayers" "service outage decision path"
assert_contains "$APP_DIR/VerifierLabViewModel.swift" "Looks safe" "green user copy"
assert_contains "$APP_DIR/VerifierLabViewModel.swift" "Use caution" "orange user copy"
assert_contains "$APP_DIR/VerifierLabViewModel.swift" "High-risk QR" "red warning user copy"
assert_contains "$APP_DIR/VerifierLabViewModel.swift" "trustLayers(for:" "decision path trust layer mapping"
assert_contains "$APP_DIR/VerifierLabViewModel.swift" "ebVWLo/mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ=" "deterministic provider-profile fixture public key"
# "Orange outline" rather than "Orange": .unavailable is the one tone drawn as
# a hollow ring, and the label has to carry that shape because it shares the
# orange of .caution. Assert the whole literal -- the "Orange" prefix is the
# point of the check, so a copy edit that drops it must fail here, not pass a
# looser substring.
assert_contains "$APP_DIR/ContentView.swift" "Orange outline, protection service unavailable" "service outage is caution copy"
assert_not_contains "$APP_DIR/VerifierLabViewModel.swift" "adminToken" "developer admin state"
assert_not_contains "$APP_DIR/VerifierLabViewModel.swift" "generateDemo" "developer demo generation"

assert_contains "$APP_DIR/ContentView.swift" "Protected QR Scanner" "scanner product heading"
assert_contains "$APP_DIR/ContentView.swift" "Start scan" "primary scan action"
assert_contains "$APP_DIR/ContentView.swift" "Color guide" "end-user color explanation"
assert_contains "$APP_DIR/ContentView.swift" "Open site" "trusted destination action"
assert_contains "$APP_DIR/ContentView.swift" "Open anyway" "warned destination override action"
assert_contains "$APP_DIR/ContentView.swift" "View decision path" "decision detail action"
assert_contains "$APP_DIR/ContentView.swift" "History retention" "history retention setting"
assert_contains "$APP_DIR/ContentView.swift" "Import provider profile" "managed verifier provider affordance"
assert_contains "$APP_DIR/ContentView.swift" "Refresh provider profile" "runtime provider profile refresh affordance"
assert_contains "$APP_DIR/ContentView.swift" "ResultDetailView" "decision detail sheet"
assert_not_contains "$APP_DIR/ContentView.swift" "Verifier API key" "developer API key UI"
assert_not_contains "$APP_DIR/ContentView.swift" "Admin token" "developer admin UI"
assert_not_contains "$APP_DIR/ContentView.swift" "Demo tools" "developer demo UI"

if [ "${SKIP_IOS_BUILD:-false}" != "true" ]; then
  "${MAKE:-make}" build-ios
fi

printf "iOS scanner smoke passed.\n"
