"""
Demonstrate verifier-side payload revalidation behavior.

Usage:
    python3 backend/scripts/payload_revalidation_poc_demo.py
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.app.services.payload_revalidation_poc import (  # noqa: E402
    match_payload_to_verified_domains,
)


CASES = [
    {
        "label": "Exact match",
        "payload": "https://acme.example/pay",
        "verified_domains": ["acme.example"],
        "allow_subdomains": False,
    },
    {
        "label": "WWW normalization",
        "payload": "https://www.acme.example/menu",
        "verified_domains": ["acme.example"],
        "allow_subdomains": False,
    },
    {
        "label": "Subdomain blocked by exact-only policy",
        "payload": "https://login.acme.example/sign-in",
        "verified_domains": ["acme.example"],
        "allow_subdomains": False,
    },
    {
        "label": "Subdomain allowed by policy",
        "payload": "https://login.acme.example/sign-in",
        "verified_domains": ["acme.example"],
        "allow_subdomains": True,
    },
    {
        "label": "Phishing mismatch",
        "payload": "https://evil.example/redirect?target=acme.example",
        "verified_domains": ["acme.example"],
        "allow_subdomains": False,
    },
    {
        "label": "Credential removed after issuance",
        "payload": "https://acme.example/pay",
        "verified_domains": [],
        "allow_subdomains": False,
    },
]


STATE_CHANGE_SCENARIOS = [
    {
        "label": "Issuer rotates verified payment host after issuance",
        "payload": "https://acme.example/pay",
        "steps": [
            {
                "state_label": "Initial issuer state",
                "verified_domains": ["acme.example"],
                "allow_subdomains": False,
            },
            {
                "state_label": "Issuer state after host rotation",
                "verified_domains": ["pay.acme.example"],
                "allow_subdomains": False,
            },
            {
                "state_label": "Issuer state after restoring original host",
                "verified_domains": ["acme.example"],
                "allow_subdomains": False,
            },
        ],
    },
    {
        "label": "Issuer tightens subdomain policy after issuance",
        "payload": "https://login.acme.example/sign-in",
        "steps": [
            {
                "state_label": "Initial issuer state with subdomains allowed",
                "verified_domains": ["acme.example"],
                "allow_subdomains": True,
            },
            {
                "state_label": "Issuer state after subdomain policy tightened",
                "verified_domains": ["acme.example"],
                "allow_subdomains": False,
            },
        ],
    },
    {
        "label": "Issuer removes credential record and later re-approves it",
        "payload": "https://merchant.acme.example/redeem",
        "steps": [
            {
                "state_label": "Initial issuer state",
                "verified_domains": ["acme.example"],
                "allow_subdomains": True,
            },
            {
                "state_label": "Issuer state after record removal",
                "verified_domains": [],
                "allow_subdomains": True,
            },
            {
                "state_label": "Issuer state after re-approval",
                "verified_domains": ["acme.example"],
                "allow_subdomains": True,
            },
        ],
    },
]


def main() -> None:
    print("Payload Revalidation PoC")
    print("========================")
    for case in CASES:
        decision = match_payload_to_verified_domains(
            case["payload"],
            case["verified_domains"],
            allow_subdomains=case["allow_subdomains"],
        )
        print(f"{case['label']}: {'ALLOW' if decision.allowed else 'BLOCK'}")
        print(f"  payload: {case['payload']}")
        print(f"  reason: {decision.reason}")

    print()
    print("Issuer-state change scenarios")
    print("=============================")
    for scenario in STATE_CHANGE_SCENARIOS:
        print(scenario["label"])
        print(f"  payload: {scenario['payload']}")
        for step in scenario["steps"]:
            decision = match_payload_to_verified_domains(
                scenario["payload"],
                step["verified_domains"],
                allow_subdomains=step["allow_subdomains"],
            )
            print(
                f"  {step['state_label']}:"
                f" {'ALLOW' if decision.allowed else 'BLOCK'}"
            )
            print(f"    verified_domains: {step['verified_domains']}")
            print(f"    allow_subdomains: {step['allow_subdomains']}")
            print(f"    reason: {decision.reason}")


if __name__ == "__main__":
    main()
