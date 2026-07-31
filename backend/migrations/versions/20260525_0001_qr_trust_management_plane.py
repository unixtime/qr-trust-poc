"""Add QR Trust management plane tables.

Revision ID: 20260525_0001
Revises: d4309a94dafa
Create Date: 2026-05-25 00:01:00.000000
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260525_0001"
down_revision: Union[str, None] = "d4309a94dafa"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    _execute_sql_script(
        """
        create extension if not exists pgcrypto;
        create schema if not exists qr_trust;

        create table if not exists qr_trust.operators (
          operator_id uuid primary key default gen_random_uuid(),
          email text not null unique,
          display_name text not null,
          status text not null default 'active'
            check (status in ('active', 'suspended', 'retired')),
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );

        create table if not exists qr_trust.operator_role_assignments (
          assignment_id uuid primary key default gen_random_uuid(),
          operator_id uuid not null references qr_trust.operators(operator_id),
          role text not null
            check (
              role in (
                'root_admin',
                'authority_admin',
                'issuer_admin',
                'auditor',
                'runtime_provider_admin',
                'scanner_client_admin',
                'nats_subscriber_admin'
              )
            ),
          root_program_id text,
          delegated_authority_id text,
          issuer_id text,
          status text not null default 'active'
            check (status in ('active', 'suspended', 'revoked')),
          created_at timestamptz not null default now()
        );

        create index if not exists operator_role_assignments_operator_idx
          on qr_trust.operator_role_assignments (operator_id, status);

        create table if not exists qr_trust.management_api_keys (
          key_id text primary key,
          key_hash text not null unique,
          label text not null,
          operator_id uuid references qr_trust.operators(operator_id),
          scopes text[] not null default '{}',
          status text not null default 'active'
            check (status in ('active', 'revoked', 'expired')),
          not_before timestamptz,
          expires_at timestamptz,
          created_at timestamptz not null default now(),
          revoked_at timestamptz
        );

        create index if not exists management_api_keys_status_idx
          on qr_trust.management_api_keys (status, expires_at);

        create table if not exists qr_trust.idempotency_keys (
          idempotency_key text primary key,
          request_hash text not null,
          response_json jsonb,
          status text not null
            check (status in ('processing', 'completed', 'failed')),
          created_at timestamptz not null default now(),
          expires_at timestamptz not null
        );

        create index if not exists idempotency_keys_expiry_idx
          on qr_trust.idempotency_keys (expires_at);

        create table if not exists qr_trust.governance_audit_log (
          audit_id uuid primary key default gen_random_uuid(),
          actor_operator_id uuid references qr_trust.operators(operator_id),
          actor_key_id text references qr_trust.management_api_keys(key_id),
          action text not null,
          target_type text not null,
          target_id text not null,
          root_program_id text,
          delegated_authority_id text,
          issuer_id text,
          before_json jsonb,
          after_json jsonb,
          request_id text,
          idempotency_key text,
          created_at timestamptz not null default now()
        );

        create index if not exists governance_audit_log_target_idx
          on qr_trust.governance_audit_log (
            target_type,
            target_id,
            created_at desc
          );

        create index if not exists governance_audit_log_scope_idx
          on qr_trust.governance_audit_log (
            root_program_id,
            delegated_authority_id,
            issuer_id,
            created_at desc
          );

        create table if not exists qr_trust.runtime_safety_providers (
          provider_id text primary key,
          display_name text not null,
          base_url text,
          verdict_ttl_seconds integer not null default 300
            check (verdict_ttl_seconds > 0),
          stale_behavior text not null default 'downgrade_to_caution'
            check (stale_behavior in ('downgrade_to_caution', 'block')),
          unavailable_behavior text not null default 'downgrade_to_caution'
            check (unavailable_behavior in ('downgrade_to_caution', 'block')),
          status text not null default 'active'
            check (status in ('active', 'suspended', 'retired')),
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );

        create table if not exists qr_trust.nats_subscribers (
          subscriber_id text primary key,
          display_name text not null,
          durable_name text not null unique,
          description text not null default '',
          status text not null default 'active'
            check (status in ('active', 'suspended', 'revoked')),
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );

        create table if not exists qr_trust.nats_subscriber_subjects (
          subscriber_id text not null
            references qr_trust.nats_subscribers(subscriber_id),
          subject text not null,
          permission text not null default 'subscribe'
            check (permission in ('subscribe')),
          created_at timestamptz not null default now(),
          primary key (subscriber_id, subject)
        );

        alter table if exists qr_trust.root_programs
          add column if not exists version bigint not null default 1,
          add column if not exists created_by uuid
            references qr_trust.operators(operator_id),
          add column if not exists updated_by uuid
            references qr_trust.operators(operator_id);

        alter table if exists qr_trust.delegated_authorities
          add column if not exists version bigint not null default 1,
          add column if not exists created_by uuid
            references qr_trust.operators(operator_id),
          add column if not exists updated_by uuid
            references qr_trust.operators(operator_id);

        alter table if exists qr_trust.issuers
          add column if not exists version bigint not null default 1,
          add column if not exists created_by uuid
            references qr_trust.operators(operator_id),
          add column if not exists updated_by uuid
            references qr_trust.operators(operator_id);

        alter table if exists qr_trust.destination_policies
          add column if not exists created_by uuid
            references qr_trust.operators(operator_id),
          add column if not exists updated_by uuid
            references qr_trust.operators(operator_id);
        """
    )


def downgrade() -> None:
    _execute_sql_script(
        """
        alter table if exists qr_trust.destination_policies
          drop column if exists updated_by,
          drop column if exists created_by;

        alter table if exists qr_trust.issuers
          drop column if exists updated_by,
          drop column if exists created_by,
          drop column if exists version;

        alter table if exists qr_trust.delegated_authorities
          drop column if exists updated_by,
          drop column if exists created_by,
          drop column if exists version;

        alter table if exists qr_trust.root_programs
          drop column if exists updated_by,
          drop column if exists created_by,
          drop column if exists version;

        drop table if exists qr_trust.nats_subscriber_subjects;
        drop table if exists qr_trust.nats_subscribers;
        drop table if exists qr_trust.runtime_safety_providers;
        drop table if exists qr_trust.governance_audit_log;
        drop table if exists qr_trust.idempotency_keys;
        drop table if exists qr_trust.management_api_keys;
        drop table if exists qr_trust.operator_role_assignments;
        drop table if exists qr_trust.operators;
        """
    )


def _execute_sql_script(sql: str) -> None:
    for statement in (part.strip() for part in sql.split(";")):
        if statement:
            op.execute(statement)
