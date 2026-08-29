"""Rename scanner_decisions.nonce_fingerprint to envelope_fingerprint.

The verifier no longer issues nonces; scan activity is keyed by the envelope
identity (sha256 of canonical claims + signature). The nullable
``usage_policy`` column is intentionally left in place (the recorder stops
writing it) so the governance schema in 20260525_0002 stays untouched.

Revision ID: 20260826_0008
Revises: 20260825_0007
Create Date: 2026-08-26 00:08:00.000000
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260826_0008"
down_revision: Union[str, None] = "20260825_0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_UPGRADE_SQL = """
alter table qr_trust.scanner_decisions rename column nonce_fingerprint to envelope_fingerprint;
alter index if exists qr_trust.scanner_decisions_nonce_created_idx rename to scanner_decisions_envelope_created_idx
"""

_DOWNGRADE_SQL = """
alter index if exists qr_trust.scanner_decisions_envelope_created_idx rename to scanner_decisions_nonce_created_idx;
alter table qr_trust.scanner_decisions rename column envelope_fingerprint to nonce_fingerprint
"""


def upgrade() -> None:
    _execute_sql_script(_UPGRADE_SQL)


def downgrade() -> None:
    _execute_sql_script(_DOWNGRADE_SQL)


def _execute_sql_script(sql: str) -> None:
    for statement in (part.strip() for part in sql.split(";")):
        if statement:
            op.execute(statement)
