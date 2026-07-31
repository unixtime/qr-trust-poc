#!/usr/bin/env sh
set -eu

failures=0

fail() {
  failures=$((failures + 1))
  printf "FAIL: %s\n" "$1"
}

pass() {
  printf "PASS: %s\n" "$1"
}

note() {
  printf "NOTE: %s\n" "$1"
}

detect_lan_ip() {
  if command -v networksetup >/dev/null 2>&1; then
    networksetup -getinfo Wi-Fi 2>/dev/null \
      | awk -F': ' '/^IP address: / && $2 != "" && $2 != "none" { print $2; exit }'
  fi

  for iface in en0 en1; do
    ifconfig "$iface" 2>/dev/null \
      | awk '/[[:space:]]inet[[:space:]]/ && $2 != "127.0.0.1" { print $2; exit }'
  done
}

detect_local_hostname() {
  if command -v scutil >/dev/null 2>&1; then
    scutil --get LocalHostName 2>/dev/null \
      | awk 'NF { sub(/\.local$/, "", $0); print $0 ".local"; exit }'
  fi

  hostname -s 2>/dev/null \
    | awk 'NF { sub(/\.local$/, "", $0); print $0 ".local"; exit }'
}

first_physical_iphone_id() {
  awk '
    /iPhone/ && $0 !~ /Simulator/ {
      for (i = 1; i <= NF; i++) {
        if ($i ~ /^[A-Fa-f0-9-]{36}$/) {
          print $i
          exit
        }
      }
    }
  '
}

local_status_url="${IPHONE_LOCAL_STATUS_URL:-https://127.0.0.1:8443/verifier/status}"
lan_ip="${IPHONE_LAN_IP:-$(detect_lan_ip | head -n 1 || true)}"
local_hostname="$(detect_local_hostname | head -n 1 || true)"
cert_file="${IPHONE_TLS_CERT_FILE:-local/https/verifier-lab.pem}"

if [ -n "${IPHONE_VERIFIER_BASE_URL:-}" ]; then
  verifier_base_url="$IPHONE_VERIFIER_BASE_URL"
elif [ -n "$local_hostname" ]; then
  verifier_base_url="https://${local_hostname}:8443"
elif [ -n "$lan_ip" ]; then
  verifier_base_url="https://${lan_ip}:8443"
else
  verifier_base_url="https://<your-mac-lan-ip>:8443"
fi

printf "Native iPhone evidence preflight\n"
printf "Local status URL: %s\n" "$local_status_url"
printf "Suggested iPhone base URL: %s\n\n" "$verifier_base_url"
if [ -n "$local_hostname" ]; then
  printf "Stable mDNS verifier URL: https://%s:8443\n\n" "$local_hostname"
fi

provider_config="ios/VerifierLabApp/LocalProvider.xcconfig"
if [ -f "$provider_config" ]; then
  pass "local iOS provider config exists: ${provider_config}"
else
  note "local iOS provider config is missing; run: make ios-provider-config"
fi

if command -v curl >/dev/null 2>&1; then
  if curl -ksf "$local_status_url" >/dev/null 2>&1; then
    pass "local HTTPS verifier status is reachable"
  else
    fail "local HTTPS verifier status is not reachable at ${local_status_url}; start the stack first"
  fi

  case "$verifier_base_url" in
    https://\<your-mac-lan-ip\>*)
      fail "Mac LAN IP could not be detected; set IPHONE_VERIFIER_BASE_URL manually"
      ;;
    *)
      lan_status_url="${verifier_base_url%/}/verifier/status"
      if curl -ksf "$lan_status_url" >/dev/null 2>&1; then
        pass "LAN HTTPS verifier status is reachable from this Mac"
      else
        fail "LAN HTTPS verifier status is not reachable at ${lan_status_url}; check API_PUBLISH_HOST, firewall, or Wi-Fi"
      fi
      ;;
  esac
else
  note "curl is unavailable; verifier reachability was not checked"
fi

if [ -n "$lan_ip" ]; then
  if [ ! -f "$cert_file" ]; then
    fail "local HTTPS certificate is missing at ${cert_file}; run scripts/create_local_https_certs.sh ${lan_ip}"
  elif command -v openssl >/dev/null 2>&1; then
    cert_sans="$(openssl x509 -in "$cert_file" -noout -ext subjectAltName 2>/dev/null || true)"
    if printf "%s\n" "$cert_sans" | grep -Fq "IP Address:${lan_ip}"; then
      pass "local HTTPS certificate includes current LAN IP (${lan_ip})"
    else
      fail "local HTTPS certificate does not include current LAN IP (${lan_ip}); run scripts/create_local_https_certs.sh ${lan_ip} and restart the stack"
      printf "%s\n" "$cert_sans" | sed 's/^/  /'
    fi
    if [ -n "$local_hostname" ]; then
      if printf "%s\n" "$cert_sans" | grep -Fq "DNS:${local_hostname}"; then
        pass "local HTTPS certificate includes stable hostname (${local_hostname})"
      else
        note "local HTTPS certificate does not include stable hostname (${local_hostname}); rerun scripts/create_local_https_certs.sh ${lan_ip}"
      fi
    fi
  else
    note "openssl is unavailable; certificate SANs were not checked"
  fi
fi

if ! command -v xcrun >/dev/null 2>&1; then
  fail "xcrun is unavailable; install Xcode command line tools before native capture"
else
  device_list="$(xcrun devicectl list devices 2>&1 || true)"
  device_id="${IPHONE_DEVICE_ID:-$(printf "%s\n" "$device_list" | first_physical_iphone_id)}"

  if [ -z "$device_id" ]; then
    fail "no paired available physical iPhone was detected by devicectl"
    printf "%s\n" "$device_list" | sed 's/^/  /'
  else
    pass "paired physical iPhone is available (${device_id})"
    details="$(xcrun devicectl device info details --device "$device_id" 2>&1 || true)"

    if printf "%s\n" "$details" | grep -Fq "developerModeStatus: enabled"; then
      pass "Developer Mode is enabled on the iPhone"
    elif printf "%s\n" "$details" | grep -Fq "developerModeStatus: disabled"; then
      fail "Developer Mode is disabled on the iPhone"
      note "On the iPhone, enable Settings > Privacy & Security > Developer Mode, restart, unlock, and trust the Mac."
    else
      fail "could not determine iPhone Developer Mode status"
      printf "%s\n" "$details" | sed 's/^/  /'
    fi
  fi
fi

printf "\nCapture packet command:\n"
printf "  IPHONE_VERIFIER_BASE_URL='%s' make iphone-evidence-packet\n" "$verifier_base_url"
printf "\nXcode local verifier provider profile:\n"
printf "  make ios-provider-config\n"
printf "  make check-ios-provider-config\n"
printf "  Rebuild the app after generating the local provider config.\n"
printf "  Primary local candidate: %s\n" "$verifier_base_url"

if [ "$failures" -gt 0 ]; then
  printf "\nNative iPhone evidence preflight failed: %s issue(s).\n" "$failures"
  exit 1
fi

printf "\nNative iPhone evidence preflight passed.\n"
