#!/usr/bin/env python3
"""Check the shared local infrastructure used by the QR trust network demo."""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    db_host: str
    db_setup_host: str
    db_port: str
    db_user: str
    db_password: str
    db_name: str
    redis_host: str
    redis_setup_host: str
    redis_port: int
    redis_db: int
    nats_host: str
    nats_port: int
    nats_monitor_host: str
    nats_monitor_port: int


def main() -> int:
    config = load_config()
    failures: list[str] = []
    warnings: list[str] = []

    print("QR Trust shared-infra preflight")
    print(f"Postgres: {postgres_label(config)}")
    print(
        f"Redis: redis://{config.redis_setup_host}:{config.redis_port}/{config.redis_db}"
        f" (container host: {config.redis_host})"
    )
    print(f"NATS: nats://{config.nats_host}:{config.nats_port}")
    print(f"NATS monitor: http://{config.nats_monitor_host}:{config.nats_monitor_port}/varz")
    print("")

    if config.db_name == "publisher":
        failures.append(
            "EXTERNAL_DB_NAME is publisher; use the separate qr_trust_poc database."
        )
        print("")
        for failure in failures:
            print(f"FAIL: {failure}", file=sys.stderr)
        return 1
    else:
        check_postgres(config, failures)

    check_redis(config, failures)
    check_nats_monitor(config, warnings)

    if warnings:
        print("")
        for warning in warnings:
            print(f"WARN: {warning}")

    if failures:
        print("")
        for failure in failures:
            print(f"FAIL: {failure}", file=sys.stderr)
        return 1

    print("")
    print("PASS: shared Postgres and Redis are reachable for the QR Trust stack.")
    if not warnings:
        print("PASS: NATS monitor is reachable.")
    return 0


def load_config() -> Config:
    return Config(
        db_host=os.getenv("EXTERNAL_DB_HOST", "host.docker.internal"),
        db_setup_host=os.getenv("EXTERNAL_DB_SETUP_HOST", "127.0.0.1"),
        db_port=os.getenv("EXTERNAL_DB_PORT", "5432"),
        db_user=os.getenv("EXTERNAL_DB_USER", "publisher"),
        db_password=os.getenv("EXTERNAL_DB_PASSWORD", "publisher"),
        db_name=os.getenv("EXTERNAL_DB_NAME", "qr_trust_poc"),
        redis_host=os.getenv("EXTERNAL_REDIS_HOSTNAME", "127.0.0.1"),
        redis_setup_host=os.getenv(
            "EXTERNAL_REDIS_SETUP_HOST",
            os.getenv("EXTERNAL_REDIS_HOSTNAME", "127.0.0.1"),
        ),
        redis_port=int(os.getenv("EXTERNAL_REDIS_PORT", "6379")),
        redis_db=int(os.getenv("EXTERNAL_REDIS_DB", "5")),
        nats_host=os.getenv("NATS_PUBLISH_HOST", "127.0.0.1"),
        nats_port=int(os.getenv("NATS_PUBLISH_PORT", "4222")),
        nats_monitor_host=os.getenv("NATS_MONITOR_PUBLISH_HOST", "127.0.0.1"),
        nats_monitor_port=int(os.getenv("NATS_MONITOR_PUBLISH_PORT", "8222")),
    )


def postgres_label(config: Config) -> str:
    return (
        f"postgres://{config.db_user}:***@"
        f"{config.db_setup_host}:{config.db_port}/{config.db_name}"
    )


def check_postgres(config: Config, failures: list[str]) -> None:
    env = os.environ.copy()
    env["PGPASSWORD"] = config.db_password
    try:
        subprocess.run(
            [
                "psql",
                "--host",
                config.db_setup_host,
                "--port",
                config.db_port,
                "--username",
                config.db_user,
                "--dbname",
                config.db_name,
                "--no-password",
                "--command",
                "select 1",
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
        )
    except FileNotFoundError:
        failures.append("psql is not installed; install libpq or PostgreSQL client tools.")
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.strip() or "connection failed"
        failures.append(
            f"Postgres database {config.db_name} is not reachable on "
            f"{config.db_setup_host}:{config.db_port}: {detail}"
        )
    else:
        print("PASS: Postgres source-of-truth database is reachable.")


def check_redis(config: Config, failures: list[str]) -> None:
    try:
        with socket.create_connection(
            (config.redis_setup_host, config.redis_port),
            timeout=2.0,
        ) as client:
            client.sendall(redis_command("SELECT", str(config.redis_db)))
            select_response = client.recv(128)
            client.sendall(redis_command("PING"))
            ping_response = client.recv(128)
    except OSError as exc:
        failures.append(
            f"Redis DB {config.redis_db} is not reachable on "
            f"{config.redis_setup_host}:{config.redis_port}: {exc}"
        )
        return

    if not select_response.startswith(b"+OK"):
        failures.append(
            f"Redis rejected SELECT {config.redis_db}: {select_response!r}"
        )
        return
    if not ping_response.startswith(b"+PONG"):
        failures.append(f"Redis PING failed: {ping_response!r}")
        return

    print(f"PASS: Redis hot-path DB {config.redis_db} is reachable.")


def check_nats_monitor(config: Config, warnings: list[str]) -> None:
    url = f"http://{config.nats_monitor_host}:{config.nats_monitor_port}/varz"
    try:
        with urllib.request.urlopen(url, timeout=2.0) as response:
            if response.status != 200:
                warnings.append(f"NATS monitor returned HTTP {response.status}; run make up-nats.")
                return
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        warnings.append(f"NATS monitor is not reachable ({exc}); run make up-nats.")
        return

    print("PASS: NATS JetStream monitor is reachable.")


def redis_command(*parts: str) -> bytes:
    encoded = [part.encode("utf-8") for part in parts]
    command = [f"*{len(encoded)}\r\n".encode("ascii")]
    for part in encoded:
        command.append(f"${len(part)}\r\n".encode("ascii"))
        command.append(part)
        command.append(b"\r\n")
    return b"".join(command)


if __name__ == "__main__":
    raise SystemExit(main())
