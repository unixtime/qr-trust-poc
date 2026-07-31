from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.db.database import get_db
from backend.app.services.domain_verification_service import domain_verification_service
from pydantic import BaseModel

router = APIRouter()


class DomainVerificationRequest(BaseModel):
    """Request model for initiating domain verification."""
    domain: str


@router.post("/{org_id}/domains/initiate")
async def initiate_domain_verification(
    org_id: int,
    request: DomainVerificationRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Initiate domain verification process.

    TEST MODE: Auto-approves whitelisted domains
    PRODUCTION: Returns DNS TXT and HTTP file verification instructions

    Args:
        org_id: Organization ID
        request: Domain to verify (e.g., "acme-corp.test")
        db: Database session

    Returns:
        dict: Verification status and instructions

    Example (TEST MODE):
        POST /organizations/1/domains/initiate
        {
            "domain": "acme-corp.test"
        }

        Response:
        {
            "status": "verified",
            "method": "test_mode",
            "domain": "acme-corp.test",
            "token": "..."
        }

    Example (PRODUCTION):
        Response:
        {
            "status": "pending",
            "domain": "acme-corp.com",
            "token": "abc123...",
            "instructions": {
                "dns_txt": {
                    "record_name": "_qr-verification.acme-corp.com",
                    "record_value": "abc123..."
                },
                "http_file": {
                    "file_path": "https://acme-corp.com/.well-known/qr-verification.txt",
                    "file_content": "abc123..."
                }
            },
            "next_steps": "After setup, call POST /organizations/1/domains/acme-corp.com/verify"
        }
    """
    try:
        result = await domain_verification_service.initiate_verification(
            request.domain,
            org_id,
            db
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{org_id}/domains/{domain}/verify")
async def verify_domain(
    org_id: int,
    domain: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Check domain verification status.

    TEST MODE: Checks against whitelist
    PRODUCTION: Performs DNS TXT or HTTP file verification

    Args:
        org_id: Organization ID
        domain: Domain to check
        db: Database session

    Returns:
        dict: Verification result

    Example:
        POST /organizations/1/domains/acme-corp.test/verify

        Response (verified):
        {
            "status": "verified",
            "method": "dns_txt",  # or "http_file" or "test_mode"
            "domain": "acme-corp.test"
        }

        Response (not verified):
        {
            "status": "not_verified",
            "message": "Domain verification not found. Please ensure DNS TXT record or HTTP file is set up correctly."
        }
    """
    try:
        result = await domain_verification_service.check_verification(
            domain,
            org_id,
            db
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{org_id}/domains")
async def list_verified_domains(
    org_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    List all verified domains for an organization.

    Args:
        org_id: Organization ID
        db: Database session

    Returns:
        dict: List of verified domains

    Example:
        GET /organizations/1/domains

        Response:
        {
            "org_id": 1,
            "verified_domains": [
                "acme-corp.test",
                "secure-bank.test"
            ]
        }
    """
    try:
        domains = await domain_verification_service.get_verified_domains(org_id, db)
        return {
            "org_id": org_id,
            "verified_domains": domains
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
