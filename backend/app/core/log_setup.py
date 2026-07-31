import logging
import sys
from backend.app.core.config import config


def setup_logging():
    """
    Configure logging for the application.

    Sets up structured logging with appropriate log levels based on environment.
    """
    # Determine log level from config
    log_level = logging.DEBUG if config.DEBUG else logging.INFO

    # Create formatter
    formatter = logging.Formatter(
        fmt='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )

    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)

    # Remove existing handlers to avoid duplicates
    root_logger.handlers.clear()

    # Console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(log_level)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)

    # Configure specific loggers
    # Application logger
    app_logger = logging.getLogger("qrcode_api")
    app_logger.setLevel(log_level)

    # Reduce noise from third-party libraries
    logging.getLogger("uvicorn").setLevel(logging.INFO)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING if not config.DEBUG else logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("PIL").setLevel(logging.WARNING)

    app_logger.info(f"Logging configured with level: {logging.getLevelName(log_level)}")

    return app_logger
