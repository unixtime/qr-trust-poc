"""Short-lived verdict cache for reusable QR codes.

A ``reusable_public`` or ``time_limited`` code that is scanned by a crowd (or
replayed by a flood) yields the same verdict for every identical envelope
until the claims expire. Computing it once per short window and serving the
rest from cache is the single largest cost reduction in the scan-flood design:
a cache hit skips the signature check, the budget spend, and the evidence
write. Hits are counted per nonce fingerprint so the lab card's scan count
stays honest without a row per scan.

Shape mirrors ``RequestRateLimiter``: Redis when the shared client is
connected, a process-local fallback otherwise, and any Redis failure degrades
to the fallback with a warning rather than failing the scan.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from backend.app.services.redis_service import redis_service


logger = logging.getLogger("qrcode_api")

VERDICT_KEY_PREFIX = "verdict:"
VERDICT_HITS_KEY_PREFIX = "verdict_hits:"
_HIT_COLOURS = ("green", "orange", "red")
_LAST_HIT_FIELD = "last_hit_at"


@dataclass(frozen=True)
class VerdictHitSummary:
    """Cached verdicts served for one nonce in the current counting window."""

    total: int = 0
    green: int = 0
    orange: int = 0
    red: int = 0
    last_hit_at: str | None = None


@dataclass
class _InMemoryHits:
    expires_at: float
    counts: dict[str, int] = field(default_factory=dict)
    last_hit_at: str | None = None


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _resolve(value: Any) -> Any:
    """redis-py types hash commands as if synchronous; await them when they are not."""
    if inspect.isawaitable(value):
        return await value
    return value


class InMemoryVerdictCache:
    """Process-local verdict cache; the fallback when Redis is not connected."""

    def __init__(self) -> None:
        self._entries: dict[str, tuple[float, dict[str, Any]]] = {}
        self._hits: dict[str, _InMemoryHits] = {}
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> dict[str, Any] | None:
        async with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return None
            expires_at, payload = entry
            if expires_at <= time.monotonic():
                del self._entries[key]
                return None
            return dict(payload)

    async def set(self, key: str, payload: dict[str, Any], ttl_seconds: int) -> None:
        if ttl_seconds <= 0:
            return
        async with self._lock:
            self._entries[key] = (time.monotonic() + ttl_seconds, dict(payload))

    async def record_hit(self, fingerprint: str, colour: str, *, window_seconds: int) -> None:
        async with self._lock:
            now = time.monotonic()
            hits = self._hits.get(fingerprint)
            if hits is None or hits.expires_at <= now:
                hits = _InMemoryHits(expires_at=now + window_seconds)
                self._hits[fingerprint] = hits
            hits.counts[colour] = hits.counts.get(colour, 0) + 1
            hits.last_hit_at = _utc_now_iso()

    async def hit_summary(self, fingerprint: str) -> VerdictHitSummary:
        async with self._lock:
            hits = self._hits.get(fingerprint)
            if hits is None or hits.expires_at <= time.monotonic():
                return VerdictHitSummary()
            return _summary_from_counts(hits.counts, hits.last_hit_at)

    def clear(self) -> None:
        """Synchronous reset for tests; the endpoint never calls this."""
        self._entries.clear()
        self._hits.clear()


def _summary_from_counts(counts: dict[str, Any], last_hit_at: str | None) -> VerdictHitSummary:
    by_colour = {colour: int(counts.get(colour, 0) or 0) for colour in _HIT_COLOURS}
    return VerdictHitSummary(
        total=sum(by_colour.values()),
        green=by_colour["green"],
        orange=by_colour["orange"],
        red=by_colour["red"],
        last_hit_at=last_hit_at,
    )


class VerdictCache:
    """Redis-backed verdict cache with the in-memory cache as fallback."""

    def __init__(self) -> None:
        self._fallback = InMemoryVerdictCache()

    @property
    def distributed(self) -> bool:
        return redis_service.redis_client is not None

    async def get(self, key: str) -> dict[str, Any] | None:
        client = redis_service.redis_client
        if client is None:
            return await self._fallback.get(key)
        try:
            raw = await client.get(f"{VERDICT_KEY_PREFIX}{key}")
        except Exception as exc:  # pragma: no cover - exercised only with a live Redis
            logger.warning("verdict_cache_redis_get_failed key=%s error=%s", key, exc)
            return await self._fallback.get(key)
        if raw is None:
            return None
        try:
            payload = json.loads(raw)
        except ValueError:
            logger.warning("verdict_cache_redis_payload_invalid key=%s", key)
            return None
        return payload if isinstance(payload, dict) else None

    async def set(self, key: str, payload: dict[str, Any], ttl_seconds: int) -> None:
        if ttl_seconds <= 0:
            return
        client = redis_service.redis_client
        if client is None:
            await self._fallback.set(key, payload, ttl_seconds)
            return
        try:
            await client.set(f"{VERDICT_KEY_PREFIX}{key}", json.dumps(payload), ex=ttl_seconds)
        except Exception as exc:  # pragma: no cover - exercised only with a live Redis
            logger.warning("verdict_cache_redis_set_failed key=%s error=%s", key, exc)
            await self._fallback.set(key, payload, ttl_seconds)

    async def record_hit(self, fingerprint: str, colour: str, *, window_seconds: int) -> None:
        """Count one cached verdict; the counter is a fixed window from its first hit."""
        client = redis_service.redis_client
        if client is None:
            await self._fallback.record_hit(fingerprint, colour, window_seconds=window_seconds)
            return
        hits_key = f"{VERDICT_HITS_KEY_PREFIX}{fingerprint}"
        try:
            count = await _resolve(client.hincrby(hits_key, colour, 1))
            await _resolve(client.hset(hits_key, _LAST_HIT_FIELD, _utc_now_iso()))
            if count == 1 and await client.ttl(hits_key) < 0:
                await client.expire(hits_key, window_seconds)
        except Exception as exc:  # pragma: no cover - exercised only with a live Redis
            logger.warning("verdict_cache_redis_hit_failed key=%s error=%s", hits_key, exc)
            await self._fallback.record_hit(fingerprint, colour, window_seconds=window_seconds)

    async def hit_summary(self, fingerprint: str) -> VerdictHitSummary:
        client = redis_service.redis_client
        if client is None:
            return await self._fallback.hit_summary(fingerprint)
        hits_key = f"{VERDICT_HITS_KEY_PREFIX}{fingerprint}"
        try:
            raw = await _resolve(client.hgetall(hits_key))
        except Exception as exc:  # pragma: no cover - exercised only with a live Redis
            logger.warning("verdict_cache_redis_hits_read_failed key=%s error=%s", hits_key, exc)
            return await self._fallback.hit_summary(fingerprint)
        if not raw:
            return VerdictHitSummary()
        last_hit_at = raw.get(_LAST_HIT_FIELD)
        return _summary_from_counts(raw, str(last_hit_at) if last_hit_at else None)

    def clear(self) -> None:
        """Reset the fallback store (tests run without Redis)."""
        self._fallback.clear()
