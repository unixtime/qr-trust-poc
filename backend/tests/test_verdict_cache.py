"""Unit tests for the in-memory verdict cache (the no-Redis fallback)."""

from __future__ import annotations

import asyncio

import pytest

from backend.app.services import verdict_cache as verdict_cache_module
from backend.app.services.verdict_cache import InMemoryVerdictCache, VerdictHitSummary


def test_entries_expire_after_ttl(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = [1000.0]
    monkeypatch.setattr(verdict_cache_module.time, "monotonic", lambda: clock[0])
    cache = InMemoryVerdictCache()

    async def scenario() -> tuple[dict | None, dict | None]:
        await cache.set("k", {"allowed": True}, ttl_seconds=30)
        clock[0] += 29
        live = await cache.get("k")
        clock[0] += 2
        return live, await cache.get("k")

    live, expired = asyncio.run(scenario())
    assert live == {"allowed": True}
    assert expired is None


def test_zero_ttl_never_stores() -> None:
    cache = InMemoryVerdictCache()

    async def scenario() -> dict | None:
        await cache.set("k", {"allowed": True}, ttl_seconds=0)
        return await cache.get("k")

    assert asyncio.run(scenario()) is None


def test_hits_count_per_colour_in_a_fixed_window(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = [5000.0]
    monkeypatch.setattr(verdict_cache_module.time, "monotonic", lambda: clock[0])
    cache = InMemoryVerdictCache()

    async def scenario() -> tuple[VerdictHitSummary, VerdictHitSummary]:
        await cache.record_hit("fp", "green", window_seconds=60)
        clock[0] += 10
        await cache.record_hit("fp", "green", window_seconds=60)
        await cache.record_hit("fp", "red", window_seconds=60)
        during = await cache.hit_summary("fp")
        clock[0] += 51  # 61 s after the first hit: the window started then, not at the last hit.
        return during, await cache.hit_summary("fp")

    during, after = asyncio.run(scenario())
    assert (during.total, during.green, during.orange, during.red) == (3, 2, 0, 1)
    assert during.last_hit_at is not None
    assert after == VerdictHitSummary()


def test_cached_scans_are_counted_in_minute_buckets(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = [1_700_000_000.0]
    monkeypatch.setattr(verdict_cache_module.time, "time", lambda: clock[0])
    cache = InMemoryVerdictCache()

    async def scenario() -> tuple[int, int, int, int]:
        await cache.record_cached_scan("fp-a", retain_seconds=3600)
        await cache.record_cached_scan("fp-a", retain_seconds=3600)
        await cache.record_cached_scan("fp-short", retain_seconds=120)
        clock[0] += 600.0
        await cache.record_cached_scan("fp-a", retain_seconds=3600)
        now = clock[0]
        recent = await cache.cached_scan_count("fp-a", since=now - 60, until=now)
        hour = await cache.cached_scan_count("fp-a", since=now - 3600, until=now)
        other = await cache.cached_scan_count("fp-b", since=now - 3600, until=now)
        # fp-short's bucket is inside the hour window but its retention has lapsed.
        expired = await cache.cached_scan_count("fp-short", since=now - 3600, until=now)
        return recent, hour, other, expired

    assert asyncio.run(scenario()) == (1, 3, 0, 0)
