from __future__ import annotations

import re
from uuid import uuid4


_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")


def safe_request_id(value: str | None) -> str:
    normalized = (value or "").strip()
    if _REQUEST_ID_RE.fullmatch(normalized):
        return normalized
    return f"req_{uuid4().hex}"
