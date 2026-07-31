from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from fastapi import HTTPException
from backend.app.db.models import Certificate, Organization
from backend.app.schemas.certificate import CertificateCreate
from backend.app.core.security import generate_key_pair
from datetime import datetime, timezone
import logging

# Get logger
logger = logging.getLogger("qrcode_api")

async def issue_certificate(request: CertificateCreate, db: AsyncSession):
    """
    Issue a new certificate for a trusted entity.
    
    Args:
        request: The certificate creation request with issuer details
        db: Database session for persistence
        
    Returns:
        dict: Certificate details including the generated private key
        
    Raises:
        HTTPException: If a valid certificate already exists for the issuer
    """
    logger.info(f"Issuing new certificate for issuer: {request.issuer_name}")
    
    try:
        # 1️⃣ Check if the organization exists
        org_result = await db.execute(select(Organization).where(Organization.name == request.issuer_name))
        organization = org_result.scalars().first()

        if not organization:
            # 2️⃣ If organization does not exist, create it
            logger.debug(f"Creating new organization: {request.issuer_name}")
            new_org = Organization(name=request.issuer_name)
            db.add(new_org)
            await db.commit()
            await db.refresh(new_org)
            org_id = new_org.id
        else:
            # 3️⃣ Use existing org_id
            logger.debug(f"Using existing organization ID: {organization.id}")
            org_id = organization.id

        # 4️⃣ Check if a valid (non-revoked) certificate exists for the issuer
        result = await db.execute(select(Certificate).where(
            Certificate.issuer_name == request.issuer_name,
            Certificate.revoked_at == None
        ))
        existing_certificate = result.scalars().first()

        if existing_certificate:
            logger.warning(f"Attempted to issue certificate for issuer with existing valid certificate: {request.issuer_name}")
            raise HTTPException(status_code=400, detail="A valid certificate already exists for this issuer")

        # 5️⃣ Generate new key pair
        logger.debug("Generating new key pair")
        private_key, public_key = generate_key_pair()

        # 6️⃣ Issue the certificate
        new_certificate = Certificate(
            org_id=org_id,
            issuer_name=request.issuer_name,
            public_key=public_key,
            issued_at=datetime.now(timezone.utc),
            revoked_at=None
        )

        db.add(new_certificate)
        await db.commit()
        await db.refresh(new_certificate)
        
        logger.info(f"Certificate issued successfully for {request.issuer_name} with ID: {new_certificate.id}")

        return {
            "org_id": org_id,
            "issuer_name": new_certificate.issuer_name,
            "issued_at": new_certificate.issued_at.isoformat(),
            "public_key": new_certificate.public_key,
            "private_key": private_key  # ✅ Return the private key
        }
    except Exception as e:
        # Log unexpected errors but don't expose details in response
        logger.error(f"Error issuing certificate: {str(e)}", exc_info=True)
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=500, detail="An error occurred while issuing the certificate")
