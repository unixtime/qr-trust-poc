"""
PoC support for concurrency-safe replay prevention.

This module demonstrates a safer shape than the current:
    check nonce -> verify -> mark nonce used

That naive sequence allows concurrent "first" scans to pass at the same time.
The PoC model uses a reserve/finalize/release lifecycle so only one verifier can
own a nonce at a time while still allowing recovery if verification fails.
"""

from __future__ import annotations

import asyncio
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal
from typing import Callable


NonceState = Literal["reserved", "consumed"]


@dataclass
class NonceRecord:
    state: NonceState
    expires_at: datetime
    owner_token: str | None


class InMemoryReplayGuard:
    """
    An in-memory PoC for atomic nonce reservation.

    The implementation is intentionally small and deterministic so we can
    simulate race conditions without external infrastructure.
    """

    def __init__(
        self,
        *,
        now_fn: Callable[[], datetime] | None = None,
    ) -> None:
        self._records: dict[str, NonceRecord] = {}
        self._lock = asyncio.Lock()
        self._now_fn = now_fn or (lambda: datetime.now(timezone.utc))

    def _now(self) -> datetime:
        return self._now_fn()

    def _require_positive_ttl(self, label: str, seconds: int) -> None:
        if seconds <= 0:
            raise ValueError(f"{label} must be greater than zero seconds")

    def _purge_if_expired(self, nonce: str, now: datetime) -> None:
        record = self._records.get(nonce)
        if record and record.expires_at <= now:
            del self._records[nonce]

    async def try_reserve(self, nonce: str, reservation_ttl_seconds: int) -> str | None:
        """
        Try to reserve a nonce for in-flight verification.

        Returns an owner token when the caller wins the reservation, or None
        when another caller already owns or consumed the nonce.
        """
        self._require_positive_ttl("reservation_ttl_seconds", reservation_ttl_seconds)
        now = self._now()
        async with self._lock:
            self._purge_if_expired(nonce, now)
            if nonce in self._records:
                return None

            owner_token = secrets.token_urlsafe(16)
            self._records[nonce] = NonceRecord(
                state="reserved",
                expires_at=now + timedelta(seconds=reservation_ttl_seconds),
                owner_token=owner_token,
            )
            return owner_token

    async def finalize(self, nonce: str, owner_token: str, consumed_ttl_seconds: int) -> bool:
        """
        Finalize a successful verification and convert the reservation into a
        consumed nonce record with the long-lived TTL.
        """
        self._require_positive_ttl("consumed_ttl_seconds", consumed_ttl_seconds)
        now = self._now()
        async with self._lock:
            self._purge_if_expired(nonce, now)
            record = self._records.get(nonce)
            if not record:
                return False
            if record.state != "reserved" or record.owner_token != owner_token:
                return False

            self._records[nonce] = NonceRecord(
                state="consumed",
                expires_at=now + timedelta(seconds=consumed_ttl_seconds),
                owner_token=None,
            )
            return True

    async def release(self, nonce: str, owner_token: str) -> bool:
        """
        Release a reservation when verification fails before finalize().
        """
        now = self._now()
        async with self._lock:
            self._purge_if_expired(nonce, now)
            record = self._records.get(nonce)
            if not record:
                return False
            if record.state != "reserved" or record.owner_token != owner_token:
                return False

            del self._records[nonce]
            return True

    async def get_record(self, nonce: str) -> NonceRecord | None:
        now = self._now()
        async with self._lock:
            self._purge_if_expired(nonce, now)
            return self._records.get(nonce)
