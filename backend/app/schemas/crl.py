from pydantic import BaseModel
from datetime import datetime

class CRLResponse(BaseModel):
    """Schema for fetching revoked certificates."""
    id: int
    certificate_id: int  # Fixed: Changed from qr_id to match database model
    revoked_at: datetime
    reason: str
