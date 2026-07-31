from datetime import datetime
from typing import Dict

from pydantic import BaseModel, ConfigDict

class QRCodeCreate(BaseModel):
    """Schema for creating a QR code."""
    org_id: int  # Ensures the QR code belongs to an organization
    payload: str
    validity_minutes: int

class QRCodeResponse(BaseModel):
    """Schema for the response after generating a QR code."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    payload: str
    metadata: Dict
    signature: str
    validity: datetime

class QRCodeVerify(BaseModel):
    """Schema for verifying a QR code."""
    qr_id: int

class QRCodeVerifyResponse(BaseModel):
    """Schema for the QR code verification response."""
    status: str
