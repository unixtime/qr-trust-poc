from __future__ import annotations

from urllib.parse import ParseResult, urlparse


def asyncpg_dsn(dsn: str) -> str:
    if dsn.startswith("postgresql+asyncpg://"):
        return dsn.replace("postgresql+asyncpg://", "postgresql://", 1)
    return dsn


def database_dsn_label(dsn: str) -> str:
    parsed = urlparse(asyncpg_dsn(dsn))
    host = parsed.hostname or "unknown-host"
    port = _parsed_port(parsed)
    port_label = f":{port}" if port is not None else ""
    database = parsed.path.lstrip("/") or "unknown-db"
    return f"{host}{port_label}/{database}"


def _parsed_port(parsed: ParseResult) -> int | None:
    try:
        return parsed.port
    except ValueError:
        return None
