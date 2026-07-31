from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.app.services.replay_guard_poc import InMemoryReplayGuard


class FrozenClock:
    def __init__(self) -> None:
        self.current = datetime(2026, 1, 1, tzinfo=timezone.utc)

    def now(self) -> datetime:
        return self.current

    def advance(self, *, seconds: int) -> None:
        self.current += timedelta(seconds=seconds)


@pytest.mark.asyncio
async def test_replay_guard_finalize_blocks_reuse() -> None:
    guard = InMemoryReplayGuard()

    owner_token = await guard.try_reserve("nonce-001", reservation_ttl_seconds=5)
    assert owner_token is not None

    finalized = await guard.finalize("nonce-001", owner_token, consumed_ttl_seconds=60)
    assert finalized is True

    second_owner = await guard.try_reserve("nonce-001", reservation_ttl_seconds=5)
    assert second_owner is None


@pytest.mark.asyncio
async def test_replay_guard_release_allows_reacquire() -> None:
    guard = InMemoryReplayGuard()

    owner_token = await guard.try_reserve("nonce-002", reservation_ttl_seconds=5)
    assert owner_token is not None

    released = await guard.release("nonce-002", owner_token)
    assert released is True

    second_owner = await guard.try_reserve("nonce-002", reservation_ttl_seconds=5)
    assert second_owner is not None


@pytest.mark.asyncio
async def test_replay_guard_expired_reservation_can_be_reacquired() -> None:
    clock = FrozenClock()
    guard = InMemoryReplayGuard(now_fn=clock.now)

    owner_token = await guard.try_reserve("nonce-003", reservation_ttl_seconds=5)
    assert owner_token is not None

    clock.advance(seconds=6)

    second_owner = await guard.try_reserve("nonce-003", reservation_ttl_seconds=5)
    assert second_owner is not None
    assert second_owner != owner_token


@pytest.mark.asyncio
async def test_replay_guard_rejects_non_positive_ttl() -> None:
    guard = InMemoryReplayGuard()

    with pytest.raises(ValueError):
        await guard.try_reserve("nonce-004", reservation_ttl_seconds=0)
