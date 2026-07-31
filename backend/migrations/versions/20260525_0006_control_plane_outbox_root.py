"""Use a control-plane subject root for rootless management events.

Revision ID: 20260525_0006
Revises: 20260525_0005
Create Date: 2026-05-25 00:06:00.000000
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260525_0006"
down_revision: Union[str, None] = "20260525_0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    _execute_sql_script(
        """
        update qr_trust.event_outbox
        set payload = jsonb_set(
          payload,
          '{envelope,root_program_id}',
          '"control-plane"'::jsonb,
          false
        )
        where root_program_id is null
          and event_type in (
            'runtime_provider.upserted',
            'nats.subscriber.authorization.changed'
          )
          and payload #>> '{envelope,root_program_id}' = 'root:qrtrust-demo:2026';
        """
    )


def downgrade() -> None:
    pass


def _execute_sql_script(sql: str) -> None:
    for statement in (part.strip() for part in sql.split(";")):
        if statement:
            op.execute(statement)
