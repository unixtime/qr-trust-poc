"""Allow assurance status artifacts.

Revision ID: 20260525_0004
Revises: 20260525_0003
Create Date: 2026-05-25 00:04:00.000000
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260525_0004"
down_revision: Union[str, None] = "20260525_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


ARTIFACT_TYPES_WITH_ASSURANCE = """
(
  'root_manifest',
  'delegated_authority_manifest',
  'issuer_record',
  'destination_policy',
  'revocation_status_event',
  'assurance_status_event',
  'verifier_cache_entry'
)
"""

ARTIFACT_TYPES_WITHOUT_ASSURANCE = """
(
  'root_manifest',
  'delegated_authority_manifest',
  'issuer_record',
  'destination_policy',
  'revocation_status_event',
  'verifier_cache_entry'
)
"""


def upgrade() -> None:
    _replace_artifact_type_constraints(ARTIFACT_TYPES_WITH_ASSURANCE)


def downgrade() -> None:
    _execute_sql_script(
        """
        delete from qr_trust.artifact_publication_work_items
        where artifact_type = 'assurance_status_event';

        delete from qr_trust.published_artifacts
        where artifact_type = 'assurance_status_event';
        """
    )
    _replace_artifact_type_constraints(ARTIFACT_TYPES_WITHOUT_ASSURANCE)


def _replace_artifact_type_constraints(artifact_types_sql: str) -> None:
    _execute_sql_script(
        f"""
        alter table if exists qr_trust.published_artifacts
          drop constraint if exists published_artifacts_artifact_type_check;

        alter table if exists qr_trust.published_artifacts
          add constraint published_artifacts_artifact_type_check
          check (artifact_type in {artifact_types_sql});

        alter table if exists qr_trust.artifact_publication_work_items
          drop constraint if exists artifact_publication_work_items_artifact_type_check;

        alter table if exists qr_trust.artifact_publication_work_items
          add constraint artifact_publication_work_items_artifact_type_check
          check (artifact_type in {artifact_types_sql});
        """
    )


def _execute_sql_script(sql: str) -> None:
    for statement in (part.strip() for part in sql.split(";")):
        if statement:
            op.execute(statement)
