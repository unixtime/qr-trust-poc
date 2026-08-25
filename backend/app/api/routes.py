from fastapi import APIRouter
from backend.app.api.endpoints import management, verifier

router = APIRouter()

router.include_router(verifier.router, prefix="/verifier", tags=["Verifier"])
router.include_router(verifier.scanner_router, prefix="/scanner", tags=["Scanner"])
router.include_router(management.router, prefix="/admin", tags=["Management"])
