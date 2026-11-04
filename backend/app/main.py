import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.browser_sessions import SessionStore
from app.config import Settings, get_settings
from app.crypto import Vault, load_master_key
from app.db import make_engine, make_session_factory
from app.errors import install_error_handlers
from app.events import EventStore
from app.executors.fake import FakeExecutor
from app.live_login import LiveLoginManager
from app.ratelimit import RateLimiter
from app.relay import Relay
from app.routes import conversations, tasks, users
from app.routes import vault as vault_routes
from app.runner import Executor, TaskRunner
from app.vault import CredentialStore


def build_executor(settings: Settings) -> Executor:
    if settings.executor == "fake":
        return FakeExecutor(step_delay=settings.fake_step_delay)
    if settings.executor == "orchestrator":
        from app.executors.browser import build_browser
        from app.executors.orchestrator import Orchestrator
        from app.llm import ClaudeLLM

        return Orchestrator(ClaudeLLM(settings), build_browser(settings), settings)
    raise ValueError(f"unknown executor: {settings.executor}")


def create_app(settings: Settings | None = None, executor: Executor | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = make_engine(settings.database_url)
        session_factory = make_session_factory(engine)
        relay = Relay()
        store = EventStore(session_factory, relay)
        vault = Vault(load_master_key(settings.vault_master_key))
        runner = TaskRunner(store, executor or build_executor(settings), settings, vault=vault)

        app.state.settings = settings
        app.state.session_factory = session_factory
        app.state.relay = relay
        app.state.store = store
        app.state.runner = runner
        app.state.vault = vault
        app.state.credentials = CredentialStore(session_factory, vault)
        app.state.live_logins = LiveLoginManager(settings, SessionStore(session_factory, vault))
        app.state.message_limiter = RateLimiter(settings.messages_per_minute)

        await runner.startup()
        try:
            yield
        finally:
            await runner.shutdown()
            await app.state.live_logins.shutdown()
            await engine.dispose()

    app = FastAPI(title="Browser Agent API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_url],
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "Last-Event-ID"],
    )
    install_error_handlers(app)
    for module in (users, conversations, tasks, vault_routes):
        app.include_router(module.router, prefix="/v1")
    return app


logging.basicConfig(level=logging.INFO)
app = create_app()
