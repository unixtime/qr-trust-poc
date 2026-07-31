# backend/app/services/qrcode_service.py
import json
import uuid
import logging
from urllib.parse import urlparse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from backend.app.db.models import QRCode, Certificate, CRL, Organization
from backend.app.schemas.qrcode import QRCodeCreate
from datetime import datetime, timezone, timedelta
from backend.app.core.security import sign_payload, verify_signature
from backend.app.services.redis_service import redis_service

logger = logging.getLogger("qrcode_api")


def extract_domain_from_payload(payload: str) -> str:
    """
    Extract domain from QR code payload.

    Handles various payload formats:
    - Full URLs: https://acme-corp.test/promo → acme-corp.test
    - Domains: acme-corp.test → acme-corp.test
    - Subdomains: www.acme-corp.test → acme-corp.test (strips www)

    Args:
        payload: QR code payload (URL or domain)

    Returns:
        str: Extracted domain

    Raises:
        ValueError: If domain cannot be extracted
    """
    payload = payload.strip()

    # Try parsing as URL
    if payload.startswith(('http://', 'https://')):
        parsed = urlparse(payload)
        domain = parsed.netloc
    else:
        # Assume it's a domain
        domain = payload.split('/')[0]  # Remove any path

    if not domain:
        raise ValueError(f"Cannot extract domain from payload: {payload}")

    # Strip www. prefix for matching
    if domain.startswith('www.'):
        domain = domain[4:]

    # Remove port if present
    if ':' in domain:
        domain = domain.split(':')[0]

    logger.debug(f"Extracted domain '{domain}' from payload '{payload}'")
    return domain


async def generate_qr_code(request: QRCodeCreate, certificate_id: int, db: AsyncSession):
    """
    Generate a signed QR code with nonce for replay prevention.

    Args:
        request: QR code creation request
        certificate_id: ID of the certificate to use for signing
        db: Database session

    Returns:
        dict: QR code data including nonce and signature

    Raises:
        ValueError: If domain verification fails
    """
    logger.info(f"Generating QR code for org_id={request.org_id}, certificate_id={certificate_id}")

    # Fetch certificate with private key
    result = await db.execute(select(Certificate).where(Certificate.id == certificate_id))
    certificate = result.scalars().first()

    if not certificate:
        raise ValueError(f"Certificate {certificate_id} not found")

    if certificate.revoked_at:
        raise ValueError(f"Certificate {certificate_id} has been revoked")

    # Fetch organization to check verified domains
    org_result = await db.execute(select(Organization).where(Organization.id == request.org_id))
    organization = org_result.scalars().first()

    if not organization:
        raise ValueError(f"Organization {request.org_id} not found")

    # Extract domain from payload
    try:
        payload_domain = extract_domain_from_payload(request.payload)
    except ValueError as e:
        logger.error(f"Failed to extract domain from payload: {str(e)}")
        raise ValueError(f"Invalid payload format: {str(e)}")

    # Check if domain is verified
    verified_domains = organization.verified_domains or []

    if payload_domain not in verified_domains:
        logger.warning(
            f"Domain mismatch! Payload domain '{payload_domain}' not in verified domains: {verified_domains}"
        )
        raise ValueError(
            f"Domain '{payload_domain}' is not verified for organization '{organization.name}'. "
            f"Verified domains: {verified_domains}. "
            f"Please verify domain ownership first via POST /organizations/{request.org_id}/domains/initiate"
        )

    logger.info(f"✓ Domain verification passed: '{payload_domain}' matches verified domains")

    # Generate unique nonce (UUID v4) for replay prevention
    nonce = str(uuid.uuid4())
    logger.debug(f"Generated nonce: {nonce}")

    # Calculate validity timestamp
    validity = datetime.now(timezone.utc) + timedelta(minutes=request.validity_minutes)

    # Prepare metadata (includes nonce in signature)
    qr_metadata = {
        "version": "1.0",
        "certificate_id": certificate_id,
        "issuer": certificate.issuer_name,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "payload": request.payload,
        "nonce": nonce,  # Nonce included in signature
        "expiry": validity.isoformat()
    }

    # Sign the complete metadata (including nonce)
    qr_metadata_str = json.dumps(qr_metadata, sort_keys=True)

    # TODO: In production, retrieve encrypted private key from certificate.private_key_encrypted
    # and decrypt it using the key encryption plugin. For now, use global key.
    signature = sign_payload(qr_metadata_str)  # Uses default private key

    # Create QR code record
    new_qr_code = QRCode(
        org_id=request.org_id,
        certificate_id=certificate_id,  # Certificate reference
        nonce=nonce,  # Unique nonce
        payload=request.payload,
        qr_metadata=qr_metadata,
        signature=signature,
        validity=validity
    )

    db.add(new_qr_code)
    await db.commit()
    await db.refresh(new_qr_code)

    logger.info(f"QR code generated successfully: id={new_qr_code.id}, nonce={nonce}")

    return {
        "id": new_qr_code.id,
        "certificate_id": certificate_id,
        "nonce": nonce,
        "payload": new_qr_code.payload,
        "metadata": new_qr_code.qr_metadata,
        "signature": new_qr_code.signature,
        "validity": new_qr_code.validity.isoformat()
    }


async def verify_qr_code(qr_id: int, db: AsyncSession):
    """
    Verify a QR code using four-layer verification process.
    1. Replay attack check (nonce in Redis)
    2. Certificate validity check (not revoked, not expired)
    3. QR expiry validation
    4. Signature verification

    Args:
        qr_id: The QR code ID to verify
        db: Database session

    Returns:
        dict: Verification result with status and UI guidance
    """
    logger.info(f"Verifying QR code: id={qr_id}")

    # Fetch QR code with certificate relationship
    result = await db.execute(
        select(QRCode).where(QRCode.id == qr_id)
    )
    qr_code = result.scalars().first()

    if not qr_code:
        logger.warning(f"QR code not found: id={qr_id}")
        return {"status": "not_found"}

    # LAYER 1: Replay Attack Prevention (Check nonce in Redis)
    logger.debug(f"Layer 1: Checking nonce for replay attack: {qr_code.nonce}")
    nonce_seen = await redis_service.check_nonce(qr_code.nonce)

    if nonce_seen:
        logger.warning(f"REPLAY ATTACK DETECTED: QR code {qr_id} with nonce {qr_code.nonce}")
        return {
            "status": "replay_attack",
            "message": "This QR code has been scanned before (cloned/replayed)",
            "ui_guidance": "RED_BADGE",  # Critical security threat
            "recommendation": "DO NOT PROCEED - Potential fraud"
        }

    # LAYER 2: Certificate Validity Check
    logger.debug(f"Layer 2: Checking certificate validity: id={qr_code.certificate_id}")
    cert_result = await db.execute(
        select(Certificate).where(Certificate.id == qr_code.certificate_id)
    )
    certificate = cert_result.scalars().first()

    if not certificate:
        logger.error(f"Certificate not found for QR code {qr_id}")
        return {"status": "invalid_certificate"}

    # Check if certificate is revoked
    crl_result = await db.execute(
        select(CRL).where(CRL.certificate_id == certificate.id)
    )
    crl_entry = crl_result.scalars().first()

    if crl_entry or certificate.revoked_at:
        logger.warning(f"Certificate revoked for QR code {qr_id}")
        return {
            "status": "certificate_revoked",
            "message": "The certificate used to sign this QR code has been revoked",
            "ui_guidance": "RED_BADGE",
            "recommendation": "DO NOT PROCEED"
        }

    # Check if certificate is expired
    if certificate.expires_at and certificate.expires_at < datetime.now(timezone.utc):
        logger.warning(f"Certificate expired for QR code {qr_id}")
        return {
            "status": "certificate_expired",
            "message": "The certificate has expired",
            "ui_guidance": "ORANGE_BADGE"
        }

    # LAYER 3: QR Code Expiry Validation
    logger.debug(f"Layer 3: Checking QR code expiry")
    if qr_code.validity < datetime.now(timezone.utc):
        logger.info(f"QR code expired: id={qr_id}")
        return {
            "status": "expired",
            "message": "This QR code has expired",
            "ui_guidance": "ORANGE_BADGE"
        }

    # LAYER 4: Signature Verification
    logger.debug(f"Layer 4: Verifying cryptographic signature")
    qr_metadata_str = json.dumps(qr_code.qr_metadata, sort_keys=True)

    # TODO: In production, use certificate.public_key instead of global key
    is_valid = verify_signature(qr_metadata_str, qr_code.signature, certificate.public_key)

    if not is_valid:
        logger.warning(f"Invalid signature for QR code {qr_id}")
        return {
            "status": "tampered",
            "message": "QR code signature is invalid (possibly tampered)",
            "ui_guidance": "RED_BADGE",
            "recommendation": "DO NOT PROCEED - Fraud suspected"
        }

    # All checks passed - Mark nonce as used
    ttl_seconds = int((qr_code.validity - datetime.now(timezone.utc)).total_seconds())
    await redis_service.mark_nonce_used(qr_code.nonce, ttl_seconds)

    logger.info(f"QR code verified successfully: id={qr_id}")

    return {
        "status": "valid",
        "message": "QR code is valid",
        "organization": qr_code.organization.name,
        "trust_level": qr_code.organization.trust_level,
        "certificate_id": qr_code.certificate_id,
        "issuer": certificate.issuer_name,
        "payload": qr_code.payload,
        "ui_guidance": "GREEN_BADGE",  # Verified and safe
        "recommendation": "Safe to proceed"
    }
