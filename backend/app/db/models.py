from sqlalchemy import Column, Integer, String, ForeignKey, TIMESTAMP, func, JSON, Boolean, Text
from sqlalchemy.orm import relationship
from backend.app.db.database import Base

# Organization Model
class Organization(Base):
    __tablename__ = "organization"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    email = Column(String, nullable=True)  # For email verification
    email_verified = Column(Boolean, default=False)  # Email verification status
    verified_domains = Column(JSON, default=list)  # List of verified domains for payload matching
    trust_level = Column(String, default="UNVERIFIED")  # Trust hierarchy level
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    users = relationship("User", back_populates="organization")
    certificates = relationship("Certificate", back_populates="organization")

# User Model
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False)
    org_id = Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False)
    organization = relationship("Organization", back_populates="users")

# Certificate Model (Issuer Verification)
class Certificate(Base):
    __tablename__ = "certificate"
    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False)
    issuer_name = Column(String, nullable=False)
    public_key = Column(Text, nullable=False)  # Changed to Text for longer keys
    private_key_encrypted = Column(Text, nullable=True)  # Encrypted private key storage
    issued_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())
    expires_at = Column(TIMESTAMP(timezone=True), nullable=True)  # Certificate expiry
    revoked_at = Column(TIMESTAMP(timezone=True), nullable=True)
    organization = relationship("Organization", back_populates="certificates")
    qr_codes = relationship("QRCode", back_populates="certificate")

# QR Code Model
class QRCode(Base):
    __tablename__ = "qrcode"
    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False)
    certificate_id = Column(Integer, ForeignKey("certificate.id", ondelete="CASCADE"), nullable=False)  # Certificate reference
    nonce = Column(String, unique=True, nullable=False, index=True)  # Unique nonce for replay prevention
    payload = Column(String, nullable=False)
    qr_metadata = Column(JSON)  # Renamed from `metadata`
    signature = Column(Text, nullable=False)  # Changed to Text for longer signatures
    validity = Column(TIMESTAMP(timezone=True), nullable=False)  # QR code expiry timestamp
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    organization = relationship("Organization")
    certificate = relationship("Certificate", back_populates="qr_codes")

# Certificate Revocation List (CRL) Model
class CRL(Base):
    __tablename__ = "crl"
    id = Column(Integer, primary_key=True, index=True)
    certificate_id = Column(Integer, ForeignKey("certificate.id", ondelete="CASCADE"), nullable=False)
    revoked_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())
    reason = Column(String, nullable=True)
    certificate = relationship("Certificate")

# Blockchain CRL Hash Model
class BlockchainCRLHash(Base):
    __tablename__ = "blockchain_crl_hash"
    id = Column(Integer, primary_key=True, index=True)
    crl_hash = Column(String, nullable=False)
    timestamp = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())
