"""
Redis service for replay attack prevention via nonce tracking.

- Stores nonce in Redis with TTL matching QR expiry
- Checks for nonce existence to detect cloned/replayed QR codes
- Automatic cleanup via TTL expiration
"""
import logging
from typing import Optional
from datetime import datetime, timezone
import redis.asyncio as redis
from backend.app.core.config import config

logger = logging.getLogger("qrcode_api")


class RedisService:
    """
    Service for managing Redis operations, primarily nonce tracking for replay prevention.
    """

    def __init__(self):
        """Initialize Redis connection pool."""
        self.redis_client: Optional[redis.Redis] = None

    async def connect(self):
        """Establish Redis connection."""
        try:
            self.redis_client = await redis.Redis(
                host=config.REDIS_HOSTNAME,
                port=config.REDIS_PORT,
                db=config.REDIS_DB,
                password=config.REDIS_PASSWORD,
                decode_responses=True,
                socket_connect_timeout=5
            )
            # Test connection
            await self.redis_client.ping()
            logger.info(f"Connected to Redis at {config.REDIS_HOSTNAME}:{config.REDIS_PORT}")
        except Exception as e:
            logger.error(f"Failed to connect to Redis: {str(e)}", exc_info=True)
            raise

    async def disconnect(self):
        """Close Redis connection."""
        if self.redis_client:
            await self.redis_client.aclose()
            logger.info("Disconnected from Redis")

    async def check_nonce(self, nonce: str) -> bool:
        """
        Check if a nonce has been seen before (replay attack detection).

        Args:
            nonce: The unique nonce from the QR code

        Returns:
            bool: True if nonce was previously seen (REPLAY ATTACK), False if first time
        """
        if not self.redis_client:
            raise ConnectionError("Redis client not connected")

        key = f"nonce:{nonce}"
        exists = await self.redis_client.exists(key)

        if exists:
            logger.warning(f"Replay attack detected! Nonce already used: {nonce}")
            return True
        else:
            logger.debug(f"Nonce is unique (first use): {nonce}")
            return False

    async def mark_nonce_used(self, nonce: str, ttl_seconds: int):
        """
        Mark a nonce as used and set TTL for automatic cleanup.

        Args:
            nonce: The unique nonce from the QR code
            ttl_seconds: Time-to-live in seconds (should match QR code expiry)
        """
        if not self.redis_client:
            raise ConnectionError("Redis client not connected")

        key = f"nonce:{nonce}"
        await self.redis_client.setex(key, ttl_seconds, "1")
        logger.debug(f"Marked nonce as used with TTL {ttl_seconds}s: {nonce}")

    async def get_nonce_ttl(self, nonce: str) -> Optional[int]:
        """
        Get the remaining TTL for a nonce.

        Args:
            nonce: The unique nonce to check

        Returns:
            Optional[int]: Remaining TTL in seconds, or None if nonce doesn't exist
        """
        if not self.redis_client:
            raise ConnectionError("Redis client not connected")

        key = f"nonce:{nonce}"
        ttl = await self.redis_client.ttl(key)
        return ttl if ttl > 0 else None


# Global Redis service instance
redis_service = RedisService()
