from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from contextlib import asynccontextmanager
from time import perf_counter
from backend.app.api.routes import router
from backend.app.core.config import config, DEFAULT_SECRET_KEY
from backend.app.core.log_setup import setup_logging
from backend.app.core.request_id import safe_request_id

# Set up logging
logger = setup_logging()

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle startup and shutdown events"""
    # Startup
    logger.info("Application startup")

    # Connect to Redis for replay attack prevention
    from backend.app.services.redis_service import redis_service
    if config.REDIS_STARTUP_ENABLED:
        try:
            await redis_service.connect()
            logger.info("Redis connected successfully")
        except Exception as e:
            logger.error(f"Failed to connect to Redis: {str(e)}")
            logger.warning("Replay attack prevention will not be available")
    else:
        logger.info("Redis startup is disabled; verifier will use local fallback services")
    if redis_service.redis_client is None:
        logger.warning(
            "Verifier rate limits (per client, per QR code, per issuer) are in-memory "
            "and per-process without Redis; budgets do not add up across API replicas"
        )

    yield

    # Shutdown
    logger.info("Application shutdown")
    try:
        await redis_service.disconnect()
        logger.info("Redis disconnected")
    except Exception as e:
        logger.error(f"Error disconnecting from Redis: {str(e)}")

# Create FastAPI application
app = FastAPI(
    title="QR Code Verification API",
    description="API for generating and verifying digitally signed QR codes",
    version="0.1.0",
    lifespan=lifespan
)

if config.SECRET_KEY == DEFAULT_SECRET_KEY:
    logger.warning(
        "Application is using the default SECRET_KEY. Set a unique value before "
        "deploying beyond local development."
    )

# Configure CORS only when explicit origins are provided. The browser lab is
# same-origin by default and does not need wildcard cross-origin access.
if config.CORS_ORIGINS:
    allow_all_origins = "*" in config.CORS_ORIGINS
    # wildcard-cors flags the literal ["*"], and it is right that a wildcard
    # origin is reachable -- but only when an operator writes "*" into
    # CORS_ORIGINS themselves. The combination the rule actually guards against,
    # wildcard origins *with* credentials, cannot be configured: the line below
    # allow_origins forces allow_credentials to False in exactly that case.
    app.add_middleware(
        CORSMiddleware,  # type: ignore
        # nosemgrep: python.fastapi.security.wildcard-cors.wildcard-cors
        allow_origins=["*"] if allow_all_origins else config.CORS_ORIGINS,
        allow_credentials=False if allow_all_origins else config.CORS_ALLOW_CREDENTIALS,
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.middleware("http")
async def add_security_headers(request, call_next):  # type: ignore[no-untyped-def]
    request_id = safe_request_id(request.headers.get("X-Request-ID"))
    request.state.request_id = request_id
    start = perf_counter()
    response = await call_next(request)
    duration_ms = (perf_counter() - start) * 1000
    logger.info(
        "request_id=%s method=%s path=%s status=%s duration_ms=%.2f",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    response.headers["X-Request-ID"] = request_id
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    return response


@app.get("/", include_in_schema=False)
async def get_root_service_descriptor() -> Response:
    return JSONResponse(
        {
            "service": app.title,
            "version": app.version,
            "docs_url": "/docs",
        },
        headers={"Cache-Control": "no-store"},
    )

# Include API routes
app.include_router(router)
