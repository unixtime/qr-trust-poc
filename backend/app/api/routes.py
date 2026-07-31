from fastapi import APIRouter
from backend.app.api.endpoints import (
    certificates,
    management,
    organizations,
    qrcodes,
    verifier,
)
from backend.app.core.config import config

router = APIRouter()

router.include_router(verifier.router, prefix="/verifier", tags=["Verifier"])
router.include_router(verifier.scanner_router, prefix="/scanner", tags=["Scanner"])
router.include_router(management.router, prefix="/admin", tags=["Management"])

if config.ENABLE_LEGACY_EXPERIMENTAL_API:
    router.include_router(certificates.router, prefix="/certificates", tags=["Certificates"])
    router.include_router(qrcodes.router, prefix="/qrcodes", tags=["QR Codes"])
    router.include_router(organizations.router, prefix="/organizations", tags=["Organizations"])
