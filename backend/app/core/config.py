from typing import Any, Dict, List, Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


# B105 reads this as a hardcoded credential. It is the opposite: a named
# sentinel whose only consumer is the startup check in app/main.py, which
# compares SECRET_KEY against it to detect an unconfigured deployment. The
# string is meant to be recognisable, not secret.
DEFAULT_SECRET_KEY = "local-dev-secret-change-me"  # nosec B105


class Settings(BaseSettings):
    """
    Application settings class to load configuration from environment variables.
    
    Attributes:
        PROJECT_NAME: Name of the application
        SECRET_KEY: Secret key for security features
        ALGORITHM: Algorithm used for JWT
        ACCESS_TOKEN_EXPIRE_MINUTES: JWT token expiration time
        DATABASE_URL: PostgreSQL connection string
        DB_USER: Database username
        DB_PASSWORD: Database password
        DB_NAME: Database name
        DB_HOST: Database host
        DB_PORT: Database port
        PRIVATE_KEY: Default RSA private key for signing
        PUBLIC_KEY: Default RSA public key for verification
        DEBUG: Debug mode flag
        CORS_ORIGINS: List of allowed CORS origins
    """
    PROJECT_NAME: str = "QR Code Verification API"
    SECRET_KEY: str = DEFAULT_SECRET_KEY
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    
    # Database settings
    DATABASE_URL: Optional[str] = None
    DB_USER: str = "qr_admin"
    DB_PASSWORD: str = "qr_dev_password"
    DB_NAME: str = "qr_db"
    DB_HOST: str = "localhost"
    DB_PORT: str = "5432"
    
    # If DATABASE_URL is not provided, build it from components
    @property
    def sync_database_url(self) -> str:
        """Build synchronous database URL."""
        if self.DATABASE_URL:
            return self.DATABASE_URL
        return f"postgresql://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
    
    @property
    def async_database_url(self) -> str:
        """Build asynchronous database URL."""
        if self.DATABASE_URL:
            if self.DATABASE_URL.startswith("postgresql://"):
                return self.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")
            return self.DATABASE_URL
        return f"postgresql+asyncpg://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
    
    # RSA Keys for signature verification
    PRIVATE_KEY: str = ""  # Set in production
    PUBLIC_KEY: str = ""   # Set in production
    
    # Debug mode
    DEBUG: bool = False
    
    # CORS
    CORS_ORIGINS: List[str] = []
    CORS_ALLOW_CREDENTIALS: bool = False

    # Redis Configuration
    REDIS_HOSTNAME: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0
    REDIS_PASSWORD: Optional[str] = None
    REDIS_STARTUP_ENABLED: bool = True

    # Route exposure
    VERIFIER_API_KEYS: List[str] = []
    VERIFIER_STATIC_API_KEYS_ENABLED: bool = False
    VERIFIER_API_KEY_HEADER: str = "X-API-Key"
    VERIFIER_ADMIN_TOKENS: List[str] = []
    VERIFIER_BOOTSTRAP_ADMIN_TOKENS_ENABLED: bool = False
    VERIFIER_ADMIN_HEADER: str = "X-Admin-Token"
    VERIFIER_PROVIDER_PROFILE_STATE: str = "active"
    VERIFIER_PUBLIC_BASE_URL: Optional[str] = None
    QRTRUST_NETWORK_DATABASE_URL: Optional[str] = None
    QRTRUST_SCANNER_VERIFIER_ID: str = "verifier:reference-http-runtime"

    # PoC guardrails
    MAX_QR_PAYLOAD_CHARS: int = 8192
    MAX_DECODE_IMAGE_BYTES: int = 5 * 1024 * 1024
    MAX_DECODE_IMAGE_PIXELS: int = 4096 * 4096
    MAX_PDF_RENDER_PAGES: int = 5
    PDF_RENDER_SCALE: float = 2.0
    VERIFIER_RATE_LIMIT_WINDOW_SECONDS: int = 60
    VERIFIER_RATE_LIMIT_MAX_REQUESTS: int = 60
    VERIFIER_DECODE_RATE_LIMIT_MAX_REQUESTS: int = 120

    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=True,
        extra="allow",
    )

# Create global config object
config = Settings()

# Log settings at startup (excluding sensitive values)
def log_settings() -> Dict[str, Any]:
    """
    Returns a dictionary of settings for logging.
    Obscures sensitive settings.
    """
    settings_dict = config.model_dump()
    # Hide sensitive values
    for key in ['SECRET_KEY', 'DB_PASSWORD', 'PRIVATE_KEY']:
        if key in settings_dict and settings_dict[key]:
            settings_dict[key] = "**********"
    return settings_dict
