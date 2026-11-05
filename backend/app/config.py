from functools import lru_cache
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]
DEV_JWT_SECRET = "dev-only-insecure-secret-change-me"


def to_asyncpg_url(url: str) -> str:
    """Turn a standard Postgres URL (e.g. from Neon) into one asyncpg accepts.

    - postgres:// or postgresql:// -> postgresql+asyncpg://
    - sslmode=require -> ssl=require
    - drops channel_binding (libpq-only option)
    """
    parts = urlsplit(url)
    scheme = parts.scheme
    if scheme in ("postgres", "postgresql"):
        scheme = "postgresql+asyncpg"
    query = []
    for key, value in parse_qsl(parts.query):
        if key == "sslmode":
            query.append(("ssl", value))
        elif key == "channel_binding":
            continue
        else:
            query.append((key, value))
    return urlunsplit((scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(REPO_ROOT / ".env", ".env"), extra="ignore")

    environment: str = "development"
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5433/browser_agent"
    backend_jwt_secret: str = DEV_JWT_SECRET
    jwt_audience: str = "browser-agent-api"
    frontend_url: str = "http://localhost:3000"

    # Which task executor runs tasks: "orchestrator" (Claude) or "fake" (tests, offline dev).
    executor: str = "orchestrator"
    fake_step_delay: float = 1.0

    # LLM. Sonnet by default: the cheapest model that handles this work well.
    anthropic_api_key: str | None = None
    llm_model: str = "claude-sonnet-5-5"
    llm_effort: str = "medium"
    llm_max_tokens: int = 8000
    llm_fallbacks: bool = True  # server-side refusal fallback (Claude API only)
    orchestrator_max_steps: int = 15
    max_cost_per_task_usd: float = 1.0

    # Browser. "local": browser-use drives Chrome on this machine (dev);
    # "cloud": Browser Use Cloud (production, live view).
    # "unavailable": the browser tool reports it isn't connected (offline dev, tests).
    browser_backend: str = "local"
    browser_headless: bool = False  # dev: the visible window doubles as the live view
    browser_max_steps: int = 40
    browser_llm_model: str = "claude-sonnet-5"  # see executors/browser.py: forced tool choice
    # "cloud": Browser Use Cloud (production). Needs BROWSER_USE_API_KEY.
    browser_use_api_key: str | None = None
    # Proxy country for sites that need a local IP, as "site:country,...".
    # Subdomains match too. Other sites use BROWSER_PROXY_COUNTRY (default: none).
    browser_proxy_sites: str = "swiggy.com:in"
    browser_proxy_country: str | None = None
    browser_cloud_timeout_minutes: int = 15  # free plan maximum

    # Phone verification (Firebase Phone Auth). Unset: the feature is off.
    firebase_project_id: str | None = None

    vault_master_key: str | None = None  # base64 of 32 random bytes

    heartbeat_interval: float = 10.0
    waiting_timeout: float = 600.0
    max_attempts: int = 3
    max_task_seconds: float = 600.0  # working time; waiting for the user isn't counted
    watchdog_interval: float = 5.0
    max_active_tasks_per_user: int = 3
    messages_per_minute: int = 10
    sse_ping_interval: float = 15.0

    @field_validator("database_url")
    @classmethod
    def _asyncpg_url(cls, value: str) -> str:
        return to_asyncpg_url(value)

    @model_validator(mode="after")
    def _no_dev_secret_in_production(self) -> "Settings":
        if self.environment != "production":
            return self
        if self.backend_jwt_secret == DEV_JWT_SECRET:
            raise ValueError("BACKEND_JWT_SECRET must be set in production")
        missing = [
            name
            for name, value in (
                ("VAULT_MASTER_KEY", self.vault_master_key),
                ("ANTHROPIC_API_KEY", self.anthropic_api_key),
                (
                    "BROWSER_USE_API_KEY",
                    self.browser_backend != "cloud" or self.browser_use_api_key,
                ),
            )
            if not value
        ]
        if missing:
            raise ValueError(f"missing in production: {', '.join(missing)}")
        return self

    def proxy_country_for(self, site: str | None) -> str | None:
        """The proxy country for a site: its own entry, else the default."""
        host = (site or "").lower().strip(".")
        for entry in self.browser_proxy_sites.split(","):
            name, _, country = entry.strip().partition(":")
            name = name.strip().lower()
            if name and country.strip() and (host == name or host.endswith("." + name)):
                return country.strip().lower()
        return self.browser_proxy_country or None


@lru_cache
def get_settings() -> Settings:
    return Settings()
