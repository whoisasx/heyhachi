import time
from contextvars import ContextVar

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

# Time spent in SQL during the current request, reported in the Server-Timing header.
db_time: ContextVar[list[float] | None] = ContextVar("db_time", default=None)


def make_engine(url: str) -> AsyncEngine:
    # No pre-ping: it costs a database round trip on every checkout. Recycling
    # connections before Postgres or the proxy drops idle ones covers the same risk.
    engine = create_async_engine(url, pool_recycle=300, pool_size=10, max_overflow=10)

    @event.listens_for(engine.sync_engine, "before_cursor_execute")
    def _start(conn, cursor, statement, parameters, context, executemany):  # noqa: ARG001
        conn.info.setdefault("query_start", []).append(time.perf_counter())

    @event.listens_for(engine.sync_engine, "after_cursor_execute")
    def _stop(conn, cursor, statement, parameters, context, executemany):  # noqa: ARG001
        started = conn.info["query_start"].pop()
        acc = db_time.get()
        if acc is not None:
            acc[0] += time.perf_counter() - started
            acc[1] += 1

    return engine


def make_session_factory(engine: AsyncEngine) -> async_sessionmaker:
    return async_sessionmaker(engine, expire_on_commit=False)
