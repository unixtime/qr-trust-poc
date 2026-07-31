"""
Demonstrate the replay-race problem and the reserve/finalize fix.

Usage:
    python3 backend/scripts/replay_guard_poc_demo.py
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.app.services.replay_guard_poc import InMemoryReplayGuard


class NaiveNonceStore:
    def __init__(self) -> None:
        self._used: set[str] = set()

    async def check_nonce(self, nonce: str) -> bool:
        return nonce in self._used

    async def mark_nonce_used(self, nonce: str) -> None:
        self._used.add(nonce)


class ManualClock:
    def __init__(self, start: datetime | None = None) -> None:
        self._current = start or datetime(2026, 4, 11, 12, 0, tzinfo=timezone.utc)

    def now(self) -> datetime:
        return self._current

    def advance(self, *, seconds: int) -> None:
        self._current += timedelta(seconds=seconds)


async def run_naive_worker(store: NaiveNonceStore, nonce: str, start: asyncio.Event) -> bool:
    await start.wait()
    already_used = await store.check_nonce(nonce)
    if already_used:
        return False

    # Simulate downstream verification work before the nonce is finally stored.
    await asyncio.sleep(0.02)
    await store.mark_nonce_used(nonce)
    return True


async def run_atomic_worker(guard: InMemoryReplayGuard, nonce: str, start: asyncio.Event) -> bool:
    await start.wait()
    owner_token = await guard.try_reserve(nonce, reservation_ttl_seconds=2)
    if not owner_token:
        return False

    await asyncio.sleep(0.02)
    return await guard.finalize(nonce, owner_token, consumed_ttl_seconds=60)


async def simulate(worker_count: int = 20) -> None:
    nonce = "demo-nonce"

    naive_store = NaiveNonceStore()
    naive_start = asyncio.Event()
    naive_tasks = [
        asyncio.create_task(run_naive_worker(naive_store, nonce, naive_start))
        for _ in range(worker_count)
    ]
    naive_start.set()
    naive_results = await asyncio.gather(*naive_tasks)

    atomic_guard = InMemoryReplayGuard()
    atomic_start = asyncio.Event()
    atomic_tasks = [
        asyncio.create_task(run_atomic_worker(atomic_guard, nonce, atomic_start))
        for _ in range(worker_count)
    ]
    atomic_start.set()
    atomic_results = await asyncio.gather(*atomic_tasks)

    lifecycle_clock = ManualClock()
    lifecycle_guard = InMemoryReplayGuard(now_fn=lifecycle_clock.now)
    lifecycle_nonce = "lifecycle-demo-nonce"

    first_owner = await lifecycle_guard.try_reserve(
        lifecycle_nonce,
        reservation_ttl_seconds=2,
    )
    second_owner_while_reserved = await lifecycle_guard.try_reserve(
        lifecycle_nonce,
        reservation_ttl_seconds=2,
    )
    lifecycle_clock.advance(seconds=3)
    finalize_after_expiry = await lifecycle_guard.finalize(
        lifecycle_nonce,
        first_owner or "missing-owner",
        consumed_ttl_seconds=60,
    )
    owner_after_expiry = await lifecycle_guard.try_reserve(
        lifecycle_nonce,
        reservation_ttl_seconds=2,
    )
    wrong_owner_release = await lifecycle_guard.release(
        lifecycle_nonce,
        "wrong-owner-token",
    )
    correct_owner_release = await lifecycle_guard.release(
        lifecycle_nonce,
        owner_after_expiry or "missing-owner",
    )
    owner_after_release = await lifecycle_guard.try_reserve(
        lifecycle_nonce,
        reservation_ttl_seconds=2,
    )
    finalize_after_release_reacquire = await lifecycle_guard.finalize(
        lifecycle_nonce,
        owner_after_release or "missing-owner",
        consumed_ttl_seconds=60,
    )
    consumed_record = await lifecycle_guard.get_record(lifecycle_nonce)

    print("Replay Guard PoC")
    print("================")
    print(f"Concurrent workers: {worker_count}")
    print(f"Naive flow successes: {sum(1 for result in naive_results if result)}")
    print(f"Atomic flow successes: {sum(1 for result in atomic_results if result)}")
    print()
    print("Lifecycle edge cases")
    print(f"Initial reservation acquired: {'PASS' if first_owner else 'FAIL'}")
    print(
        "Second reservation while active is blocked:"
        f" {'PASS' if second_owner_while_reserved is None else 'FAIL'}"
    )
    print(
        "Finalize after reservation expiry fails:"
        f" {'PASS' if not finalize_after_expiry else 'FAIL'}"
    )
    print(
        "Fresh reservation after expiry succeeds:"
        f" {'PASS' if owner_after_expiry else 'FAIL'}"
    )
    print(
        "Release with wrong owner is rejected:"
        f" {'PASS' if not wrong_owner_release else 'FAIL'}"
    )
    print(
        "Release with correct owner succeeds:"
        f" {'PASS' if correct_owner_release else 'FAIL'}"
    )
    print(
        "Reservation can be reacquired after release:"
        f" {'PASS' if owner_after_release else 'FAIL'}"
    )
    print(
        "Finalize after reacquire succeeds:"
        f" {'PASS' if finalize_after_release_reacquire else 'FAIL'}"
    )
    print(
        "Consumed record state is preserved:"
        f" {'PASS' if consumed_record and consumed_record.state == 'consumed' else 'FAIL'}"
    )


if __name__ == "__main__":
    asyncio.run(simulate())
