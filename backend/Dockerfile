# Backend for production: API + task runner in one process.
# The browser runs in Browser Use Cloud (BROWSER_BACKEND=cloud), so no Chrome here.
# Run exactly ONE replica: tasks live in this process (crash recovery handles restarts).
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

ENV PATH="/app/.venv/bin:$PATH" ENVIRONMENT=production BROWSER_BACKEND=cloud BROWSER_HEADLESS=true
EXPOSE 8000
# Migrate, then serve. PORT is set by the host (Railway/Render/Fly).
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
