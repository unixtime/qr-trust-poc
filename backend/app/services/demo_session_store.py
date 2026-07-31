from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from backend.app.schemas.poc import DemoMaterialsResponse


@dataclass(slots=True)
class DemoSessionRecord:
    session_id: str
    demo_materials: DemoMaterialsResponse
    created_at: datetime


class InMemoryDemoSessionStore:
    def __init__(self, *, ttl_minutes: int = 30, max_records: int = 128) -> None:
        self._ttl = timedelta(minutes=ttl_minutes)
        self._max_records = max_records
        self._records: dict[str, DemoSessionRecord] = {}

    def create(self, demo_materials: DemoMaterialsResponse) -> DemoSessionRecord:
        self._prune()
        session_id = uuid4().hex
        record = DemoSessionRecord(
            session_id=session_id,
            demo_materials=demo_materials,
            created_at=datetime.now(timezone.utc),
        )
        self._records[session_id] = record
        self._trim_if_needed()
        return record

    def get(self, session_id: str) -> DemoSessionRecord | None:
        self._prune()
        return self._records.get(session_id)

    def _prune(self) -> None:
        now = datetime.now(timezone.utc)
        expired = [
            session_id
            for session_id, record in self._records.items()
            if now - record.created_at > self._ttl
        ]
        for session_id in expired:
            self._records.pop(session_id, None)

    def _trim_if_needed(self) -> None:
        if len(self._records) <= self._max_records:
            return

        ordered = sorted(self._records.values(), key=lambda record: record.created_at)
        overflow = len(self._records) - self._max_records
        for record in ordered[:overflow]:
            self._records.pop(record.session_id, None)
