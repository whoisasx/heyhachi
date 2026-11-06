import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import testshop
from app.browser_sessions import SessionStore
from app.config import Settings, get_settings
from app.crypto import Vault, load_master_key
from app.db import db_time, make_engine, make_session_factory
from app.errors import install_error_handlers
from app.events import EventStore
from app.executors.fake import FakeExecutor
from app.live_login import LiveLoginManager
from app.phone import PhoneStore, PhoneVerifier
from app.profile import ProfileStore
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


class ServerTiming:
    """Adds a Server-Timing header (time in the app and in SQL) to every response."""

    def __init__(self, app, allow_origin: str) -> None:
        self.app = app
        self.allow_origin = allow_origin.encode()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        acc = [0.0, 0]
        token = db_time.set(acc)
        started = time.perf_counter()

        async def send_with_timing(message):
            if message["type"] == "http.response.start":
                app_ms = (time.perf_counter() - started) * 1000
                value = f'app;dur={app_ms:.1f}, db;dur={acc[0] * 1000:.1f};desc="{acc[1]} queries"'
                message["headers"] = [
                    *message.get("headers", []),
                    (b"server-timing", value.encode()),
                    (b"timing-allow-origin", self.allow_origin),
                ]
            await send(message)

        try:
            await self.app(scope, receive, send_with_timing)
        finally:
            db_time.reset(token)


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
        app.state.phones = PhoneStore(session_factory, vault)
        app.state.profiles = ProfileStore(session_factory, vault)
        app.state.phone_verifier = (
            PhoneVerifier(settings.firebase_project_id) if settings.firebase_project_id else None
        )

        await runner.startup()
        try:
            yield
        finally:
            await runner.shutdown()
            await app.state.live_logins.shutdown()
            await engine.dispose()

    app = FastAPI(title="Hachi API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.frontend_origins,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "Last-Event-ID"],
        expose_headers=["Server-Timing"],
        max_age=3600,  # fewer preflight requests
    )
    app.add_middleware(ServerTiming, allow_origin=", ".join(settings.frontend_origins))
    install_error_handlers(app)
    for module in (users, conversations, tasks, vault_routes):
        app.include_router(module.router, prefix="/v1")
    if testshop.enabled(settings):  # fake website for vault checks; never in production
        app.include_router(testshop.router)
    return app


logging.basicConfig(level=logging.INFO)
app = create_app()
