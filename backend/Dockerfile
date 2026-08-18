FROM python:3.13-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Pinned by digest, not by tag. `COPY --from=<image>` resolves the reference
# against the registry on every build, so a floating `:latest` made `make
# up-https-admin-nats` fail outright on a transient DNS blip with
# "failed to resolve source metadata for ghcr.io/astral-sh/uv:latest" — even
# though the layers were already local. A digest is content-addressed, so
# BuildKit serves it from cache and the build no longer needs the network.
# The tag stays for readability; the digest is what binds.
# Bump both together:
#   docker buildx imagetools inspect ghcr.io/astral-sh/uv:<new-version>
# and take the top-level (OCI index) digest so amd64 CI and arm64 laptops
# both resolve.
COPY --from=ghcr.io/astral-sh/uv:0.12.5@sha256:e85be844203885286c60ffad8a858d48afb6c5a5c237ca0e67f12e74b8f174b1 /uv /uvx /bin/

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev

COPY docs/public/fixtures/governance /app/docs/public/fixtures/governance
COPY backend /app/backend

ENV PATH="/app/backend/.venv/bin:$PATH" \
    PYTHONPATH="/app"

EXPOSE 8000

CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
