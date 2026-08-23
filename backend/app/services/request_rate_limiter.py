from __future__ import annotations

import asyncio
import logging
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from math import ceil

from backend.app.services.redis_service import redis_service


logger = logging.getLogger("qrcode_api")


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    retry_after_seconds: int | None = None


class InMemoryRequestRateLimiter:
    """
    Small in-memory fixed-window limiter for local PoC protection.

    This is process-local on purpose. It is enough to keep the public verifier
    surface from being trivially abused during local demos and small test
    deployments without adding external dependencies.
    """

    def __init__(self) -> None:
        self._records: dict[str, deque[float]] = defaultdict(deque)
        self._lock = asyncio.Lock()

    async def check(
        self,
        key: str,
        *,
        limit: int,
        window_seconds: int,
    ) -> RateLimitDecision:
        if limit <= 0:
            return RateLimitDecision(allowed=False, retry_after_seconds=window_seconds)

        now = time.monotonic()
        cutoff = now - window_seconds

        async with self._lock:
            bucket = self._records[key]
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()

            if len(bucket) >= limit:
                retry_after = max(1, ceil(window_seconds - (now - bucket[0])))
                return RateLimitDecision(
                    allowed=False,
                    retry_after_seconds=retry_after,
                )

            bucket.append(now)
            return RateLimitDecision(allowed=True)

    async def reset(self) -> None:
        async with self._lock:
            self._records.clear()


class RequestRateLimiter:
    """
    Fixed-window limiter with Redis-backed coordination when Redis is available.

    Behavior:
    - use Redis for cross-process coordination when connected
    - fall back to in-memory limits when Redis is unavailable
    """

    def __init__(self) -> None:
        self._fallback = InMemoryRequestRateLimiter()
        # Backwards-compatible access used in tests.
        self._records = self._fallback._records

    async def check(
        self,
        key: str,
        *,
        limit: int,
        window_seconds: int,
    ) -> RateLimitDecision:
        if redis_service.redis_client is None:
            return await self._fallback.check(
                key,
                limit=limit,
                window_seconds=window_seconds,
            )

        try:
            return await self._check_redis(
                key,
                limit=limit,
                window_seconds=window_seconds,
            )
        except Exception as exc:
            logger.warning(
                "Redis-backed rate limiting unavailable, falling back to in-memory limiter: %s",
                exc,
            )
            return await self._fallback.check(
                key,
                limit=limit,
                window_seconds=window_seconds,
            )

    async def _check_redis(
        self,
        key: str,
        *,
        limit: int,
        window_seconds: int,
    ) -> RateLimitDecision:
        if limit <= 0:
            return RateLimitDecision(allowed=False, retry_after_seconds=window_seconds)

        now = int(time.time())
        window_id = now // window_seconds
        window_key = f"rate_limit:{key}:{window_id}"
        client = redis_service.redis_client
        # B101 is right that `python -O` strips this, but not that it matters:
        # the caller wraps this method in `except Exception` and falls back to
        # the in-memory limiter, so a None client raises AttributeError one line
        # down and lands in the same fallback. The limiter does not fail open
        # either way -- the assert only makes the failure legible.
        assert client is not None  # nosec B101

        current_count = await client.incr(window_key)
        if current_count == 1:
            await client.expire(window_key, window_seconds + 1)

        if current_count <= limit:
            return RateLimitDecision(allowed=True)

        ttl = await client.ttl(window_key)
        retry_after = ttl if isinstance(ttl, int) and ttl > 0 else window_seconds
        return RateLimitDecision(
            allowed=False,
            retry_after_seconds=retry_after,
        )

    async def reset(self) -> None:
        await self._fallback.reset()
