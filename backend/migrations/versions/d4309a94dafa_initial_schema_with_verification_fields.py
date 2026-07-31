"""Initial schema with verification fields

Revision ID: d4309a94dafa
Revises:
Create Date: 2025-01-22 14:30:00.000000

This migration creates the initial tables for the QR Code Verification System,
including:
- certificate-to-code linkage
- nonce-based replay prevention support
- domain verification state
- trust-level storage

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'd4309a94dafa'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create organization table
    op.create_table('organization',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('email', sa.String(), nullable=True),
        sa.Column('email_verified', sa.Boolean(), nullable=True, server_default='false'),
        sa.Column('verified_domains', postgresql.JSON(astext_type=sa.Text()), nullable=True, server_default='[]'),
        sa.Column('trust_level', sa.String(), nullable=True, server_default="'UNVERIFIED'"),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name')
    )
    op.create_index(op.f('ix_organization_id'), 'organization', ['id'], unique=False)

    # Create users table
    op.create_table('users',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('username', sa.String(), nullable=False),
        sa.Column('org_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['org_id'], ['organization.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('username')
    )
    op.create_index(op.f('ix_users_id'), 'users', ['id'], unique=False)

    # Create certificate table
    op.create_table('certificate',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('org_id', sa.Integer(), nullable=False),
        sa.Column('issuer_name', sa.String(), nullable=False),
        sa.Column('public_key', sa.Text(), nullable=False),
        sa.Column('private_key_encrypted', sa.Text(), nullable=True),
        sa.Column('issued_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('expires_at', sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column('revoked_at', sa.TIMESTAMP(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['org_id'], ['organization.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_certificate_id'), 'certificate', ['id'], unique=False)

    # Create qrcode table with verification fields
    op.create_table('qrcode',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('org_id', sa.Integer(), nullable=False),
        sa.Column('certificate_id', sa.Integer(), nullable=False),  # Certificate reference
        sa.Column('nonce', sa.String(), nullable=False),  # Unique nonce for replay prevention
        sa.Column('payload', sa.String(), nullable=False),
        sa.Column('qr_metadata', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('signature', sa.Text(), nullable=False),
        sa.Column('validity', sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['certificate_id'], ['certificate.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['org_id'], ['organization.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('nonce')  # Ensure nonce uniqueness for replay prevention
    )
    op.create_index(op.f('ix_qrcode_id'), 'qrcode', ['id'], unique=False)
    op.create_index(op.f('ix_qrcode_nonce'), 'qrcode', ['nonce'], unique=True)  # Index for fast nonce lookup

    # Create CRL table
    op.create_table('crl',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('certificate_id', sa.Integer(), nullable=False),
        sa.Column('revoked_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('reason', sa.String(), nullable=True),
        sa.ForeignKeyConstraint(['certificate_id'], ['certificate.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_crl_id'), 'crl', ['id'], unique=False)

    # Create blockchain_crl_hash table
    op.create_table('blockchain_crl_hash',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('crl_hash', sa.String(), nullable=False),
        sa.Column('timestamp', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_blockchain_crl_hash_id'), 'blockchain_crl_hash', ['id'], unique=False)


def downgrade() -> None:
    # Drop tables in reverse order
    op.drop_index(op.f('ix_blockchain_crl_hash_id'), table_name='blockchain_crl_hash')
    op.drop_table('blockchain_crl_hash')

    op.drop_index(op.f('ix_crl_id'), table_name='crl')
    op.drop_table('crl')

    op.drop_index(op.f('ix_qrcode_nonce'), table_name='qrcode')
    op.drop_index(op.f('ix_qrcode_id'), table_name='qrcode')
    op.drop_table('qrcode')

    op.drop_index(op.f('ix_certificate_id'), table_name='certificate')
    op.drop_table('certificate')

    op.drop_index(op.f('ix_users_id'), table_name='users')
    op.drop_table('users')

    op.drop_index(op.f('ix_organization_id'), table_name='organization')
    op.drop_table('organization')
