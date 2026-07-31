from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from backend.app.core.config import config

# Extracted constants
ASYNC_DATABASE_URL = config.async_database_url
DEBUG_MODE = config.DEBUG

# Create async database engine
def create_db_async_engine():
    return create_async_engine(ASYNC_DATABASE_URL, echo=DEBUG_MODE, future=True)

# Create async session factory
def create_async_session_factory(engine):
    return sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False
    )

# Initialize async engine and session factory
async_engine = create_db_async_engine()
async_session_factory = create_async_session_factory(async_engine)

# Base class for models
Base = declarative_base()

# Dependency to get database session
async def get_db():
    async with async_session_factory() as session:
        yield session
