from __future__ import annotations

import pytest

from backend.app.services.redis_service import redis_service
from backend.app.services.request_rate_limiter import RequestRateLimiter


class FakeRedisClient:
    def __init__(self) -> None:
        self._counts: dict[str, int] = {}
        self._ttls: dict[str, int] = {}

    async def incr(self, key: str) -> int:
        value = self._counts.get(key, 0) + 1
        self._counts[key] = value
        return value

    async def expire(self, key: str, ttl: int) -> bool:
        self._ttls[key] = ttl
        return True

    async def ttl(self, key: str) -> int:
        return self._ttls.get(key, -1)


@pytest.mark.asyncio
async def test_request_rate_limiter_uses_redis_when_available(monkeypatch: pytest.MonkeyPatch) -> None:
    limiter = RequestRateLimiter()
    fake_redis = FakeRedisClient()
    monkeypatch.setattr(redis_service, "redis_client", fake_redis)

    first = await limiter.check("verify:127.0.0.1", limit=1, window_seconds=60)
    second = await limiter.check("verify:127.0.0.1", limit=1, window_seconds=60)

    assert first.allowed is True
    assert second.allowed is False
    assert second.retry_after_seconds == 61


@pytest.mark.asyncio
async def test_request_rate_limiter_falls_back_without_redis(monkeypatch: pytest.MonkeyPatch) -> None:
    limiter = RequestRateLimiter()
    monkeypatch.setattr(redis_service, "redis_client", None)

    first = await limiter.check("verify:127.0.0.1", limit=1, window_seconds=60)
    second = await limiter.check("verify:127.0.0.1", limit=1, window_seconds=60)

    assert first.allowed is True
    assert second.allowed is False
    assert second.retry_after_seconds is not None
