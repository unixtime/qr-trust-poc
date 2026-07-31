"""Normalize management outbox payload envelopes.

Revision ID: 20260525_0005
Revises: 20260525_0004
Create Date: 2026-05-25 00:05:00.000000
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260525_0005"
down_revision: Union[str, None] = "20260525_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    _execute_sql_script(
        """
        update qr_trust.event_outbox
        set
          payload = jsonb_build_object(
            'envelope',
            jsonb_strip_nulls(
              jsonb_build_object(
                'event_id', event_id,
                'type', event_type,
                'occurred_at', to_char(
                  created_at at time zone 'UTC',
                  'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                ),
                'root_program_id', coalesce(
                  root_program_id,
                  payload #>> '{after,root_program_id}',
                  'root:qrtrust-demo:2026'
                ),
                'delegated_authority_id', delegated_authority_id,
                'issuer_id', issuer_id,
                'destination_policy_id', destination_policy_id,
                'artifact_id', aggregate_id,
                'artifact_hash', artifact_hash,
                'artifact_ref', 'postgres://qr_trust.' || aggregate_type || '/' || aggregate_id,
                'version', 1,
                'reason', payload ->> 'action'
              )
            ),
            'body',
            payload
          ),
          publish_status = case
            when publish_status = 'failed'
              and last_error = 'Outbox payload must contain an event envelope.'
            then 'pending'
            else publish_status
          end,
          attempts = case
            when publish_status = 'failed'
              and last_error = 'Outbox payload must contain an event envelope.'
            then 0
            else attempts
          end,
          claimed_by = null,
          claimed_at = null,
          claim_expires_at = null,
          last_error = case
            when publish_status = 'failed'
              and last_error = 'Outbox payload must contain an event envelope.'
            then null
            else last_error
          end
        where payload ? 'action'
          and not (payload ? 'envelope');
        """
    )


def downgrade() -> None:
    pass


def _execute_sql_script(sql: str) -> None:
    for statement in (part.strip() for part in sql.split(";")):
        if statement:
            op.execute(statement)
