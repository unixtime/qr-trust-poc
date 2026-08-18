from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
from collections.abc import Iterator
from contextlib import contextmanager
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
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
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


DB_USER = "qr_admin"
DB_PASSWORD = "qr_dev_password"
DB_NAME = "qr_db"

# The demo stack publishes Postgres on 5432. Over an SSH tunnel it is usually
# 15432, so the port is the one piece that varies by host.
DEMO_DB_PORT = int(os.environ.get("QRTRUST_TEST_DB_PORT", "5432"))


def _demo_database_reachable() -> bool:
    """True when the demo Postgres is up and accepting these credentials.

    A bare TCP probe is not enough: something else listening on 5432 would
    pass it and then fail the test with a confusing asyncpg error deep inside
    a request handler. Connecting for real is the only answer that maps
    cleanly onto run-or-skip.
    """
    import asyncio

    import asyncpg

    async def _probe() -> bool:
        try:
            connection = await asyncpg.connect(
                user=DB_USER,
                password=DB_PASSWORD,
                database=DB_NAME,
                host="127.0.0.1",
                port=DEMO_DB_PORT,
                timeout=2,
            )
        except Exception:
            return False
        try:
            await connection.execute("select 1")
        finally:
            await connection.close()
        return True

    return asyncio.run(_probe())


@contextmanager
def _running_verifier_server(db_port: int) -> Iterator[LiveVerifierServer]:
    """Run the app under uvicorn with its management DB aimed at `db_port`."""
    try:
        port = _pick_unused_port()
        # An ephemeral port can land on `db_port` itself, which would aim the
        # app's management DSN at its own uvicorn socket -- a rare collision
        # that fails in a thoroughly confusing way when it does happen.
        while port == db_port:
            port = _pick_unused_port()
    except PermissionError:
        pytest.skip(
            "Socket binding is not permitted in this environment. "
            "Use backend/scripts/verifier_live_http_smoke.py against docker compose."
        )

    base_url = f"http://127.0.0.1:{port}"
    admin_token = "live-http-admin"
    verifier_key = "live-http-verifier-key"
    env = os.environ.copy()
    env.update(
        {
            "SECRET_KEY": "live-http-secret-change-me",
            "DB_USER": DB_USER,
            "DB_PASSWORD": DB_PASSWORD,
            "DB_NAME": DB_NAME,
            "DB_HOST": "127.0.0.1",
            "DB_PORT": str(db_port),
            # Both halves of the verifier-key feature must agree on where the
            # management state lives, and they resolve it differently:
            # `management.py` falls back to `config.sync_database_url` (which
            # is built from the DB_* parts above), while
            # `verifier_api_key_service` reads the raw `DATABASE_URL` field and
            # treats "unset" as "no dynamic key store at all". Setting only the
            # DB_* parts therefore let the admin endpoint issue a key that the
            # verifier endpoints then rejected with 403 "Invalid verifier API
            # key". compose.yml sets this variable on every service that
            # touches management state, so setting it here is what makes the
            # fixture match a real deployment.
            "QRTRUST_NETWORK_DATABASE_URL": (
                f"postgresql://{DB_USER}:{DB_PASSWORD}@127.0.0.1:{db_port}/{DB_NAME}"
            ),
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
def live_verifier_server() -> Iterator[LiveVerifierServer]:
    """A live server with no management database, guaranteed.

    The DB port is one nothing is listening on, deliberately. The admin
    API-key endpoints answer 503 "management persistence unavailable" when
    asyncpg cannot connect, and the live HTTP test asserts that 503. The
    assertion used to hold only because CI happens to run no Postgres -- an
    unstated precondition. Locally the demo stack publishes qr_admin/qr_db on
    5432, which is exactly the credentials this fixture uses, so the connect
    succeeded, a key was genuinely issued, and the test failed on a 200
    against anyone who had run `make up-https-admin-nats` first. Pinning the
    DSN at a closed port makes unavailability something this fixture
    guarantees rather than something the host is trusted to lack.

    Tests that need persistence to *work* want `live_verifier_server_with_db`.
    """
    with _running_verifier_server(_pick_unused_port()) as server:
        yield server


@pytest.fixture
def live_verifier_server_with_db() -> Iterator[LiveVerifierServer]:
    """A live server wired to the demo Postgres, or a skip if it is not up.

    The mirror image of `live_verifier_server`: same app, same tokens, but the
    management endpoints actually persist. Skipping rather than failing keeps
    `pytest` green on a machine with no Docker -- every other test in this
    suite runs against in-process fakes, and one test silently demanding an
    external service would make a clean checkout look broken.
    """
    if not _demo_database_reachable():
        pytest.skip(
            f"Demo Postgres is not reachable on 127.0.0.1:{DEMO_DB_PORT}. "
            "Run `make up-https-admin-nats`, or set QRTRUST_TEST_DB_PORT."
        )
    with _running_verifier_server(DEMO_DB_PORT) as server:
        yield server


@pytest.fixture
def live_http_client(live_verifier_server: LiveVerifierServer) -> Iterator[httpx.Client]:
    with httpx.Client(base_url=live_verifier_server.base_url, timeout=10.0) as client:
        yield client
