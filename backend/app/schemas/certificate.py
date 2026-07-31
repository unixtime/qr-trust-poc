from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict

class CertificateCreate(BaseModel):
    issuer_name: str
    issued_at: Optional[datetime] = None  # Auto-set if not provided
    org_id: Optional[int] = None  # Auto-created from issuer_name if not provided

class CertificateResponse(BaseModel):
    """Schema for the response after issuing a certificate."""
    model_config = ConfigDict(from_attributes=True)

    org_id: int
    issuer_name: str
    issued_at: str
    public_key: str
    private_key: str  # ✅ Add this field
