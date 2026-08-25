"""Add per-QR scan-activity columns to scanner decisions.

Revision ID: 20260825_0007
Revises: 20260525_0006
Create Date: 2026-08-25 00:07:00.000000

``nonce_fingerprint`` is a truncated SHA-256 digest of the scanned QR's nonce
(never the raw nonce), so the workbench can answer "was *this* QR scanned, and
how many times?" without a nonce lookup table. ``client_platform`` records which
scanner produced the decision (``ios``, ``web`` ...). Both are nullable: unsigned
or unreadable payloads still record a decision without them.
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260825_0007"
down_revision: Union[str, None] = "20260525_0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_UPGRADE_SQL = """
alter table qr_trust.scanner_decisions
  add column if not exists nonce_fingerprint text;
alter table qr_trust.scanner_decisions
  add column if not exists client_platform text;
create index if not exists scanner_decisions_nonce_created_idx
  on qr_trust.scanner_decisions (nonce_fingerprint, created_at desc)
  where nonce_fingerprint is not null
"""

_DOWNGRADE_SQL = """
drop index if exists qr_trust.scanner_decisions_nonce_created_idx;
alter table qr_trust.scanner_decisions
  drop column if exists client_platform;
alter table qr_trust.scanner_decisions
  drop column if exists nonce_fingerprint
"""


def upgrade() -> None:
    _execute_sql_script(_UPGRADE_SQL)


def downgrade() -> None:
    _execute_sql_script(_DOWNGRADE_SQL)


def _execute_sql_script(sql: str) -> None:
    for statement in (part.strip() for part in sql.split(";")):
        if statement:
            op.execute(statement)
