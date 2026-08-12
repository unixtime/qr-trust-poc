from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient


REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

os.environ.setdefault("SECRET_KEY", "local-dev-secret-change-me")
os.environ.setdefault("DB_USER", "qr_admin")
os.environ.setdefault("DB_PASSWORD", "qr_dev_password")
os.environ.setdefault("DB_NAME", "qr_db")
os.environ.setdefault("VERIFIER_STATIC_API_KEYS_ENABLED", "true")
os.environ.setdefault("VERIFIER_BOOTSTRAP_ADMIN_TOKENS_ENABLED", "true")


@dataclass(frozen=True)
class LiveVerifierServer:
    base_url: str
    admin_token: str
    verifier_key: str


def _pick_unused_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    from backend.app.api.endpoints import verifier as verifier_endpoint
    from backend.app.core.config import config
    from backend.app.main import app
    from backend.app.services.redis_service import redis_service

    async def _noop() -> None:
        return None

    monkeypatch.setattr(redis_service, "connect", _noop)
    monkeypatch.setattr(redis_service, "disconnect", _noop)
    monkeypatch.setattr(redis_service, "redis_client", None)
    monkeypatch.setattr(config, "REDIS_STARTUP_ENABLED", False)
    verifier_endpoint._replay_guard._records.clear()
    verifier_endpoint._scanner_trust_records.clear()
    app.dependency_overrides = {}

    with TestClient(app) as test_client:
        yield test_client

    verifier_endpoint._replay_guard._records.clear()
    verifier_endpoint._request_rate_limiter._records.clear()
    verifier_endpoint._scanner_trust_records.clear()


@pytest.fixture
def live_verifier_server() -> LiveVerifierServer:
    try:
        port = _pick_unused_port()
    except PermissionError:
        pytest.skip(
            "Socket binding is not permitted in this environment. "
            "Use backend/scripts/verifier_live_http_smoke.py against docker compose."
        )

    # A port nothing is listening on, deliberately. This server is supposed to
    # have no management database: the admin API-key endpoints answer 503
    # "management persistence unavailable" when asyncpg cannot connect, and the
    # live HTTP test asserts that 503. The assertion used to hold only because
    # CI happens to run no Postgres -- an unstated precondition. Locally the
    # demo stack publishes qr_admin/qr_db on 5432, which is exactly the
    # credentials below, so the connect succeeded, a key was genuinely issued,
    # and the test failed on a 200 against anyone who had run
    # `make up-https-admin-nats` first. Pinning the DSN at a closed port makes
    # unavailability something this fixture guarantees rather than something
    # the host is trusted to lack.
    db_port = _pick_unused_port()
    while db_port == port:
        db_port = _pick_unused_port()

    base_url = f"http://127.0.0.1:{port}"
    admin_token = "live-http-admin"
    verifier_key = "live-http-verifier-key"
    env = os.environ.copy()
    env.update(
        {
            "SECRET_KEY": "live-http-secret-change-me",
            "DB_USER": "qr_admin",
            "DB_PASSWORD": "qr_dev_password",
            "DB_NAME": "qr_db",
            "DB_HOST": "127.0.0.1",
            "DB_PORT": str(db_port),
            "REDIS_STARTUP_ENABLED": "false",
            "VERIFIER_ADMIN_TOKENS": f'["{admin_token}"]',
            "VERIFIER_BOOTSTRAP_ADMIN_TOKENS_ENABLED": "true",
            "VERIFIER_API_KEYS": f'["{verifier_key}"]',
            "VERIFIER_STATIC_API_KEYS_ENABLED": "true",
        }
    )

    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "backend.app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--log-level",
            "warning",
        ],
        cwd=str(REPO_ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    client = httpx.Client(base_url=base_url, timeout=10.0)
    startup_error = ""

    try:
        deadline = time.time() + 15
        while time.time() < deadline:
            if process.poll() is not None:
                startup_error = process.stdout.read() if process.stdout else ""
                raise RuntimeError(f"Verifier server exited during startup.\n{startup_error}")

            try:
                response = client.get("/verifier/status")
                if response.status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            time.sleep(0.2)
        else:
            startup_error = process.stdout.read() if process.stdout else ""
            raise RuntimeError(f"Verifier server did not become ready.\n{startup_error}")

        yield LiveVerifierServer(
            base_url=base_url,
            admin_token=admin_token,
            verifier_key=verifier_key,
        )
    finally:
        client.close()
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


@pytest.fixture
def live_http_client(live_verifier_server: LiveVerifierServer) -> httpx.Client:
    with httpx.Client(base_url=live_verifier_server.base_url, timeout=10.0) as client:
        yield client
