from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.schemas.qrcode import QRCodeCreate
from backend.app.db.database import get_db
from backend.app.services.qrcode_service import generate_qr_code, verify_qr_code

router = APIRouter()


@router.post("/generate")
async def generate_qr_code_endpoint(
    request: QRCodeCreate,
    certificate_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    Generate a signed QR code with domain verification.

    Args:
        request: QR code creation request with payload
        certificate_id: Certificate ID to use for signing
        db: Database session

    Returns:
        dict: Generated QR code with nonce and signature

    Raises:
        HTTPException 400: If domain is not verified
        HTTPException 404: If certificate not found
    """
    try:
        qr_code = await generate_qr_code(request, certificate_id, db)
        return {
            "message": "QR code generated successfully",
            "qr_code": qr_code
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/verify/{qr_id}")
async def verify_qr_code_endpoint(qr_id: int, db: AsyncSession = Depends(get_db)):
    """
    Verify a QR code using four-layer verification.
    1. Replay attack check (nonce in Redis)
    2. Certificate validity check
    3. QR expiry validation
    4. Signature verification

    Args:
        qr_id: QR code ID to verify

    Returns:
        dict: Verification result with status and UI guidance
    """
    result = await verify_qr_code(qr_id, db)
    return result
