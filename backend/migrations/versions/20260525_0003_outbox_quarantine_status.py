"""Add event outbox quarantine status.

Revision ID: 20260525_0003
Revises: 20260525_0002
Create Date: 2026-05-25 00:03:00.000000
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260525_0003"
down_revision: Union[str, None] = "20260525_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    _execute_sql_script(
        """
        alter table if exists qr_trust.event_outbox
          drop constraint if exists event_outbox_publish_status_check;

        alter table if exists qr_trust.event_outbox
          add constraint event_outbox_publish_status_check
          check (
            publish_status in (
              'pending',
              'publishing',
              'published',
              'failed',
              'quarantined'
            )
          );
        """
    )


def downgrade() -> None:
    _execute_sql_script(
        """
        update qr_trust.event_outbox
        set publish_status = 'failed'
        where publish_status = 'quarantined';

        alter table if exists qr_trust.event_outbox
          drop constraint if exists event_outbox_publish_status_check;

        alter table if exists qr_trust.event_outbox
          add constraint event_outbox_publish_status_check
          check (
            publish_status in (
              'pending',
              'publishing',
              'published',
              'failed'
            )
          );
        """
    )


def _execute_sql_script(sql: str) -> None:
    for statement in (part.strip() for part in sql.split(";")):
        if statement:
            op.execute(statement)
