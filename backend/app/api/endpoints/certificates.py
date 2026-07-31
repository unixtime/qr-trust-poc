from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select  # ✅ Fix: Import select
from datetime import datetime, timezone  # ✅ Fix: Import datetime and timezone

from backend.app.schemas.certificate import CertificateCreate
from backend.app.db.database import get_db
from backend.app.db.models import Certificate  # ✅ Fix: Import Certificate model
from backend.app.services.certificate_service import issue_certificate

router = APIRouter()

@router.post("/issue")
async def issue_certificate_endpoint(request: CertificateCreate, db: AsyncSession = Depends(get_db)):
    """API endpoint to issue a new certificate."""
    certificate = await issue_certificate(request, db)
    return {"message": "Certificate issued successfully", "certificate": certificate}


async def revoke_certificate(certificate_id: int, db: AsyncSession):
    """Revoke an existing certificate."""
    result = await db.execute(select(Certificate).where(Certificate.id == certificate_id))
    certificate = result.scalars().first()

    if not certificate:
        return False  # Certificate not found

    certificate.revoked_at = datetime.now(timezone.utc)
    await db.commit()
    return True
