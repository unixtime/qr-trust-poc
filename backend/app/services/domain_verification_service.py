"""
Domain Verification Service - Hybrid Implementation

- TEST MODE: Auto-approves whitelisted domains for lab testing
- PRODUCTION MODE: Actual DNS TXT or HTTP file verification

This dual-mode approach allows:
1. Rapid development and testing in lab environments
2. Real production-ready verification behavior
3. Easy toggle between modes via configuration
"""
import logging
import secrets
import asyncio
import dns.resolver
import httpx
from typing import Optional, Dict, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from backend.app.db.models import Organization
from backend.app.core.config import config
from backend.app.services.redis_service import redis_service

logger = logging.getLogger("qrcode_api")


class DomainVerificationService:
    """
    Service for verifying domain ownership through DNS TXT or HTTP file challenges.

    Supports both TEST MODE (lab) and PRODUCTION MODE (real verification).
    """

    def __init__(self):
        self.dns_resolver = dns.resolver.Resolver()
        self.dns_resolver.timeout = config.DOMAIN_VERIFICATION_TIMEOUT
        self.dns_resolver.lifetime = config.DOMAIN_VERIFICATION_TIMEOUT

        # Configure DNS server if specified (for testing with Docker DNS)
        if config.DNS_SERVER:
            self.dns_resolver.nameservers = [config.DNS_SERVER]
            self.dns_resolver.port = config.DNS_PORT
            logger.info(f"DNS resolver configured: {config.DNS_SERVER}:{config.DNS_PORT}")

    async def initiate_verification(
        self,
        domain: str,
        org_id: int,
        db: AsyncSession
    ) -> Dict:
        """
        Initiate domain verification process.

        TEST MODE: Auto-approves whitelisted domains immediately
        PRODUCTION: Returns token for manual verification setup

        Args:
            domain: Domain to verify (e.g., "acme-corp.com")
            org_id: Organization ID requesting verification
            db: Database session

        Returns:
            dict: Verification status and instructions
        """
        logger.info(f"Initiating domain verification: domain={domain}, org_id={org_id}")

        # Validate domain format
        if not self._is_valid_domain(domain):
            return {
                "status": "error",
                "message": f"Invalid domain format: {domain}"
            }

        # Generate unique verification token
        token = secrets.token_urlsafe(32)

    # TEST MODE: Auto-approve whitelisted domains
        if config.DOMAIN_VERIFICATION_TEST_MODE:
            if domain in config.TEST_VERIFIED_DOMAINS:
                logger.warning(f"TEST MODE: Auto-approving domain {domain}")
                await self._add_verified_domain(org_id, domain, db)
                return {
                    "status": "verified",
                    "method": "test_mode",
                    "domain": domain,
                    "token": token,
                    "message": "Domain auto-verified in TEST MODE"
                }
            else:
                logger.info(f"TEST MODE: Domain {domain} not in whitelist")
                return {
                    "status": "error",
                    "method": "test_mode",
                    "domain": domain,
                    "message": f"Domain not in TEST_VERIFIED_DOMAINS whitelist",
                    "whitelist": config.TEST_VERIFIED_DOMAINS
                }

        # Store token in Redis with TTL (for production mode)
        await self._store_verification_token(domain, org_id, token)

        # PRODUCTION MODE: Return verification instructions
        logger.info(f"PRODUCTION MODE: Domain verification pending for {domain}")
        return {
            "status": "pending",
            "method": "awaiting_verification",
            "domain": domain,
            "token": token,
            "instructions": {
                "dns_txt": {
                    "description": "Add a TXT record to your DNS",
                    "record_name": f"_qr-verification.{domain}",
                    "record_value": token,
                    "example": f"_qr-verification.{domain}. IN TXT \"{token}\""
                },
                "http_file": {
                    "description": "Create a file on your web server",
                    "file_path": f"https://{domain}/.well-known/qr-verification.txt",
                    "file_content": token,
                    "example": f"echo '{token}' > /var/www/html/.well-known/qr-verification.txt"
                }
            },
            "next_steps": f"After setting up verification, call POST /organizations/{{org_id}}/domains/{{domain}}/verify"
        }

    async def check_verification(
        self,
        domain: str,
        org_id: int,
        db: AsyncSession
    ) -> Dict:
        """
        Check if domain verification is complete.

        TEST MODE: Checks against whitelist
        PRODUCTION: Performs actual DNS/HTTP verification

        Args:
            domain: Domain to check
            org_id: Organization ID
            db: Database session

        Returns:
            dict: Verification result
        """
        logger.info(f"Checking domain verification: domain={domain}, org_id={org_id}")

        # Get stored token
        token = await self._get_verification_token(domain, org_id)
        if not token:
            return {
                "status": "error",
                "message": "No verification token found. Please initiate verification first."
            }

        # TEST MODE: Check whitelist
        if config.DOMAIN_VERIFICATION_TEST_MODE:
            if domain in config.TEST_VERIFIED_DOMAINS:
                await self._add_verified_domain(org_id, domain, db)
                return {
                    "status": "verified",
                    "method": "test_mode",
                    "domain": domain
                }
            else:
                return {
                    "status": "not_verified",
                    "method": "test_mode",
                    "message": f"Domain {domain} not in whitelist"
                }

        # PRODUCTION MODE: Try DNS TXT verification
        try:
            if await self._verify_dns_txt(domain, token):
                await self._add_verified_domain(org_id, domain, db)
                logger.info(f"Domain verified via DNS TXT: {domain}")
                return {
                    "status": "verified",
                    "method": "dns_txt",
                    "domain": domain
                }
        except Exception as e:
            logger.debug(f"DNS TXT verification failed for {domain}: {str(e)}")

        # PRODUCTION MODE: Try HTTP file verification
        try:
            if await self._verify_http_file(domain, token):
                await self._add_verified_domain(org_id, domain, db)
                logger.info(f"Domain verified via HTTP file: {domain}")
                return {
                    "status": "verified",
                    "method": "http_file",
                    "domain": domain
                }
        except Exception as e:
            logger.debug(f"HTTP file verification failed for {domain}: {str(e)}")

        # Neither method succeeded
        return {
            "status": "not_verified",
            "message": "Domain verification not found. Please ensure DNS TXT record or HTTP file is set up correctly.",
            "domain": domain
        }

    async def _verify_dns_txt(self, domain: str, expected_token: str) -> bool:
        """
        Verify domain ownership via DNS TXT record.

        Checks for TXT record at: _qr-verification.{domain}

        Args:
            domain: Domain to verify
            expected_token: Expected token value

        Returns:
            bool: True if verification succeeds
        """
        record_name = f"_qr-verification.{domain}"
        logger.debug(f"Checking DNS TXT record: {record_name}")

        try:
            # Query DNS TXT records
            answers = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.dns_resolver.resolve(record_name, 'TXT')
            )

            # Check if any TXT record matches our token
            for rdata in answers:
                txt_value = rdata.to_text().strip('"')
                logger.debug(f"Found TXT record: {txt_value}")
                if txt_value == expected_token:
                    logger.info(f"DNS TXT verification successful for {domain}")
                    return True

            logger.warning(f"DNS TXT record found but token mismatch for {domain}")
            return False

        except dns.resolver.NXDOMAIN:
            logger.debug(f"DNS record not found: {record_name}")
            return False
        except dns.resolver.NoAnswer:
            logger.debug(f"No TXT records found for: {record_name}")
            return False
        except Exception as e:
            logger.error(f"DNS verification error for {domain}: {str(e)}", exc_info=True)
            return False

    async def _verify_http_file(self, domain: str, expected_token: str) -> bool:
        """
        Verify domain ownership via HTTP file.

        Checks for file at: https://{domain}/.well-known/qr-verification.txt
        Fallback to HTTP if HTTPS fails.

        Args:
            domain: Domain to verify
            expected_token: Expected token value

        Returns:
            bool: True if verification succeeds
        """
        urls = [
            f"https://{domain}/.well-known/qr-verification.txt",
            f"http://{domain}/.well-known/qr-verification.txt"  # Fallback
        ]

        async with httpx.AsyncClient(timeout=config.DOMAIN_VERIFICATION_TIMEOUT) as client:
            for url in urls:
                try:
                    logger.debug(f"Checking HTTP file: {url}")
                    response = await client.get(url, follow_redirects=True)

                    if response.status_code == 200:
                        content = response.text.strip()
                        logger.debug(f"HTTP file content: {content}")

                        if content == expected_token:
                            logger.info(f"HTTP file verification successful for {domain}")
                            return True
                        else:
                            logger.warning(f"HTTP file found but token mismatch for {domain}")
                            return False

                except httpx.HTTPError as e:
                    logger.debug(f"HTTP request failed for {url}: {str(e)}")
                    continue
                except Exception as e:
                    logger.error(f"HTTP verification error for {url}: {str(e)}", exc_info=True)
                    continue

        return False

    async def _store_verification_token(self, domain: str, org_id: int, token: str):
        """Store verification token in Redis with TTL."""
        key = f"domain_verification:{org_id}:{domain}"
        if redis_service.redis_client:
            await redis_service.redis_client.setex(
                key,
                config.VERIFICATION_TOKEN_TTL,
                token
            )
            logger.debug(f"Stored verification token for {domain}")

    async def _get_verification_token(self, domain: str, org_id: int) -> Optional[str]:
        """Retrieve verification token from Redis."""
        key = f"domain_verification:{org_id}:{domain}"
        if redis_service.redis_client:
            token = await redis_service.redis_client.get(key)
            return token
        return None

    async def _add_verified_domain(self, org_id: int, domain: str, db: AsyncSession):
        """
        Add domain to organization's verified_domains list.

        Args:
            org_id: Organization ID
            domain: Verified domain
            db: Database session
        """
        result = await db.execute(
            select(Organization).where(Organization.id == org_id)
        )
        org = result.scalars().first()

        if not org:
            raise ValueError(f"Organization {org_id} not found")

        # Get current verified domains
        verified_domains = org.verified_domains or []

        # Add domain if not already present
        if domain not in verified_domains:
            verified_domains.append(domain)
            org.verified_domains = verified_domains
            await db.commit()
            logger.info(f"Added verified domain {domain} to organization {org_id}")

    def _is_valid_domain(self, domain: str) -> bool:
        """
        Basic domain validation.

        Args:
            domain: Domain to validate

        Returns:
            bool: True if domain format is valid
        """
        import re
        # Simple regex for domain validation
        pattern = r'^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$|^localhost$'
        return re.match(pattern, domain) is not None

    async def get_verified_domains(self, org_id: int, db: AsyncSession) -> List[str]:
        """
        Get list of verified domains for an organization.

        Args:
            org_id: Organization ID
            db: Database session

        Returns:
            List[str]: List of verified domains
        """
        result = await db.execute(
            select(Organization).where(Organization.id == org_id)
        )
        org = result.scalars().first()

        if not org:
            return []

        return org.verified_domains or []


# Global service instance
domain_verification_service = DomainVerificationService()
