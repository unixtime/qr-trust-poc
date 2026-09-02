"""Trust projection governance: version tokens, terminal revocation, projection columns."""

from typing import Sequence, Union

from alembic import op

revision: str = "20260901_0009"
down_revision: Union[str, None] = "20260826_0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        create table qr_trust.governance_versions (
            name text primary key,
            epoch uuid not null default gen_random_uuid(),
            version bigint not null default 1,
            updated_at timestamptz not null default now()
        )
        """
    )
    op.execute(
        "insert into qr_trust.governance_versions (name) values ('trust_state')"
    )
    op.execute(
        """
        create function qr_trust.enforce_terminal_key_status()
        returns trigger
        language plpgsql
        as $$
        begin
            if old.key_status = 'revoked'
               and new.key_status is distinct from 'revoked' then
                raise exception 'revocation is terminal: key_status may not leave revoked';
            end if;
            return new;
        end;
        $$
        """
    )
    op.execute(
        """
        create trigger issuer_certificates_terminal_status
            before update of key_status on qr_trust.issuer_certificates
            for each row execute function qr_trust.enforce_terminal_key_status()
        """
    )
    op.execute(
        """
        create trigger trust_keys_terminal_status
            before update of key_status on qr_trust.trust_keys
            for each row execute function qr_trust.enforce_terminal_key_status()
        """
    )
    op.execute(
        """
        alter table qr_trust.issuer_certificates
            add column public_key_material_pem text,
            add column revoked_at timestamptz,
            add column revocation_reason text,
            alter column not_after drop not null
        """
    )
    op.execute(
        """
        alter table qr_trust.issuers
            add column allow_subdomains boolean not null default false,
            add column expires_at timestamptz
        """
    )
    op.execute(
        "alter table qr_trust.operators add column operator_type text not null default 'person'"
    )
    op.execute(
        """
        alter table qr_trust.management_api_keys
            add column root_program_id text,
            add column delegated_authority_id text,
            add column issuer_id text
        """
    )


def downgrade() -> None:
    op.execute(
        """
        alter table qr_trust.management_api_keys
            drop column issuer_id,
            drop column delegated_authority_id,
            drop column root_program_id
        """
    )
    op.execute("alter table qr_trust.operators drop column operator_type")
    op.execute(
        "alter table qr_trust.issuers drop column expires_at, drop column allow_subdomains"
    )
    op.execute(
        """
        alter table qr_trust.issuer_certificates
            alter column not_after set not null,
            drop column revocation_reason,
            drop column revoked_at,
            drop column public_key_material_pem
        """
    )
    op.execute(
        "drop trigger trust_keys_terminal_status on qr_trust.trust_keys"
    )
    op.execute(
        "drop trigger issuer_certificates_terminal_status on qr_trust.issuer_certificates"
    )
    op.execute("drop function qr_trust.enforce_terminal_key_status()")
    op.execute("drop table qr_trust.governance_versions")
