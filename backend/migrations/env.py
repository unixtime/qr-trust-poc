# backend/migrations/env.py
import sys
from pathlib import Path
from logging.config import fileConfig
from alembic import context

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from backend.app.db.database import async_engine, Base
from backend.app.db import models  # Ensure models are imported

# Load Alembic Config
config = context.config
fileConfig(config.config_file_name)

# Set target metadata
target_metadata = Base.metadata

async def run_migrations_online():
    """Run migrations asynchronously."""
    connectable = async_engine

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)


def do_run_migrations(connection):
    """Apply migrations."""
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    context.configure(url=config.get_main_option("sqlalchemy.url"), target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()
else:
    import asyncio
    asyncio.run(run_migrations_online())
