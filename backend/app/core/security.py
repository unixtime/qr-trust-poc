from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple
import base64
import logging

import bcrypt
from jose import JWTError, jwt

from backend.app.core.config import config
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.backends import default_backend
from cryptography.exceptions import InvalidSignature

# Get logger
logger = logging.getLogger("qrcode_api")


def generate_key_pair() -> Tuple[str, str]:
    """
    Generate an RSA private/public key pair.
    
    Returns:
        Tuple[str, str]: Private key and public key in PEM format
    """
    logger.debug("Generating new RSA key pair")
    
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
        backend=default_backend()
    )

    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    ).decode()

    public_key = private_key.public_key()

    public_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()

    return private_pem, public_pem


def sign_payload(payload: str, private_key_pem: Optional[str] = None) -> str:
    """
    Sign a payload using RSA private key.

    Args:
        payload: The payload string to sign
        private_key_pem: The private key in PEM format, uses config key if not provided

    Returns:
        str: Base64 encoded signature
    """
    logger.debug("Signing payload")

    if not private_key_pem:
        private_key_pem = config.PRIVATE_KEY

    # Validate that private key exists
    if not private_key_pem:
        raise ValueError("Private key not provided and no default key configured")
    
    try:
        private_key = serialization.load_pem_private_key(
            private_key_pem.encode(),
            password=None,
            backend=default_backend()
        )
        
        signature = private_key.sign(
            payload.encode(),
            padding.PSS(
                mgf=padding.MGF1(hashes.SHA256()),
                salt_length=padding.PSS.MAX_LENGTH
            ),
            hashes.SHA256()
        )
        
        return base64.b64encode(signature).decode()
    except Exception as e:
        logger.error(f"Error signing payload: {str(e)}", exc_info=True)
        raise


def verify_signature(payload: str, signature: str, public_key_pem: Optional[str] = None) -> bool:
    """
    Verify the signature using RSA public key.

    Args:
        payload: The payload that was signed
        signature: The base64 encoded signature
        public_key_pem: The public key in PEM format, uses config key if not provided

    Returns:
        bool: True if signature is valid, False otherwise
    """
    logger.debug("Verifying signature")

    if not public_key_pem:
        public_key_pem = config.PUBLIC_KEY

    # Validate that public key exists
    if not public_key_pem:
        raise ValueError("Public key not provided and no default key configured")
    
    try:
        public_key = serialization.load_pem_public_key(
            public_key_pem.encode(),
            backend=default_backend()
        )
        
        signature_bytes = base64.b64decode(signature)
        
        public_key.verify(
            signature_bytes,
            payload.encode(),
            padding.PSS(
                mgf=padding.MGF1(hashes.SHA256()),
                salt_length=padding.PSS.MAX_LENGTH
            ),
            hashes.SHA256()
        )
        
        return True
    except InvalidSignature:
        logger.warning("Invalid signature detected")
        return False
    except Exception as e:
        logger.error(f"Error verifying signature: {str(e)}", exc_info=True)
        return False


def hash_password(password: str) -> str:
    """
    Hash a password using bcrypt.
    
    Args:
        password: Plain text password
        
    Returns:
        str: Hashed password
    """
    password_bytes = password.encode("utf-8")
    hashed = bcrypt.hashpw(password_bytes, bcrypt.gensalt())
    return hashed.decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verify a hashed password.
    
    Args:
        plain_password: Plain text password
        hashed_password: Hashed password to verify against
        
    Returns:
        bool: True if password matches, False otherwise
    """
    return bcrypt.checkpw(
        plain_password.encode("utf-8"),
        hashed_password.encode("utf-8"),
    )


# JWT Token Handling
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """
    Generate a JWT access token.
    
    Args:
        data: Payload data to include in the token
        expires_delta: Token expiration time
        
    Returns:
        str: JWT token
    """
    logger.debug(f"Creating access token for user ID: {data.get('sub')}")
    
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=config.ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, config.SECRET_KEY, algorithm=config.ALGORITHM)
    return encoded_jwt


def verify_access_token(token: str) -> Optional[dict]:
    """
    Decode and verify a JWT token.
    
    Args:
        token: The JWT token to verify
        
    Returns:
        Optional[dict]: Decoded token payload if valid, None otherwise
    """
    try:
        payload = jwt.decode(token, config.SECRET_KEY, algorithms=[config.ALGORITHM])
        return payload
    except JWTError as e:
        logger.warning(f"Invalid JWT token: {str(e)}")
        return None
    except Exception as e:
        logger.error(f"Error verifying token: {str(e)}", exc_info=True)
        return None
