from __future__ import annotations

import os
import sys
from typing import NoReturn

import httpx


DEFAULT_BASE_URL = "http://127.0.0.1:8000"
DEFAULT_ADMIN_TOKEN = "local-lab-admin"


# `NoReturn`, not `None`: this always raises, and saying so lets a type checker
# see that the code after a `_fail` in an except branch is unreachable rather
# than flagging every later use of the value that branch failed to produce.
def _fail(message: str) -> NoReturn:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    base_url = os.environ.get("VERIFIER_BASE_URL", DEFAULT_BASE_URL).rstrip("/")
    admin_token = os.environ.get("VERIFIER_SMOKE_ADMIN_TOKEN", DEFAULT_ADMIN_TOKEN)
    insecure_tls = os.environ.get("VERIFIER_SMOKE_INSECURE_TLS", "").lower() in {
        "1",
        "true",
        "yes",
    }

    with httpx.Client(base_url=base_url, timeout=15.0, verify=not insecure_tls) as client:
        # The first request is where a misdirected smoke actually surfaces, and
        # httpx reports the two ways to misdirect it as bare transport errors:
        # aimed at the wrong protocol it disconnects, aimed at a dead port it
        # refuses. Untranslated, either arrives as a ~90-line traceback that
        # names neither the URL it tried nor the target that would have worked.
        try:
            status_response = client.get("/verifier/status")
        except httpx.RemoteProtocolError as exc:
            # A TLS listener drops a plaintext request before writing any bytes,
            # so there is no response to report -- this exact error, every time.
            hint = (
                " The compose API serves TLS when VERIFIER_TLS_ENABLED=true;"
                " run `make smoke-compose-https` against that stack."
                if base_url.startswith("http://")
                else ""
            )
            # httpx's own message ends in a period; strip it so appending the
            # hint does not read as an ellipsis.
            detail = str(exc).rstrip(".")
            _fail(f"status request to {base_url} disconnected without a response: {detail}.{hint}")
        except httpx.ConnectError as exc:
            _fail(f"status request to {base_url} could not connect: {exc}. Is the stack up?")

        if status_response.status_code != 200:
            _fail(f"status request failed: {status_response.status_code} {status_response.text}")

        status_payload = status_response.json()
        print("status", status_payload)
        admin_header = status_payload.get("admin_header") or "X-Admin-Token"
        api_key_header = status_payload.get("api_key_header") or "X-API-Key"

        issue_response = client.post(
            "/admin/verifier-clients/api-keys/issue",
            json={"label": "smoke-client"},
            headers={admin_header: admin_token},
        )
        if issue_response.status_code != 200:
            _fail(
                "failed to issue verifier API key. "
                "Set VERIFIER_ADMIN_TOKENS, VERIFIER_BOOTSTRAP_ADMIN_TOKENS_ENABLED=true, "
                "and VERIFIER_SMOKE_ADMIN_TOKEN to the same value.\n"
                f"{issue_response.status_code} {issue_response.text}"
            )

        api_key = issue_response.json()["plaintext_key"]

        demo_response = client.post(
            "/verifier/demo-materials",
            json={"nonce": "smoke-live-http-001", "usage_policy": "one_time"},
            headers={api_key_header: api_key},
        )
        if demo_response.status_code != 200:
            _fail(f"demo-materials request failed: {demo_response.status_code} {demo_response.text}")

        demo_payload = demo_response.json()
        verify_body = {
            "qr_payload": demo_payload["qr_payload"],
            "certificate": demo_payload["certificate"],
            "issuer_state": demo_payload["issuer_state"],
        }

        first_verify = client.post(
            "/verifier/verify-scanned",
            json=verify_body,
            headers={api_key_header: api_key},
        )
        second_verify = client.post(
            "/verifier/verify-scanned",
            json=verify_body,
            headers={api_key_header: api_key},
        )

        if first_verify.status_code != 200:
            _fail(f"first verify failed: {first_verify.status_code} {first_verify.text}")
        if second_verify.status_code != 200:
            _fail(f"second verify failed: {second_verify.status_code} {second_verify.text}")

        first_payload = first_verify.json()
        second_payload = second_verify.json()

        if first_payload["stage"] != "accepted":
            _fail(f"expected first verify to be accepted, got {first_payload}")
        if second_payload["stage"] != "replay_guard":
            _fail(f"expected second verify to be replay_guard, got {second_payload}")

        print("first_verify", first_payload)
        print("second_verify", second_payload)
        print("live HTTP smoke passed")


if __name__ == "__main__":
    main()
