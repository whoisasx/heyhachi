"""Backend API calls with a saved API key (the `call_api` tool).

The model picks the endpoint and body; the backend adds the user's key from the
vault. The key never enters the model's input or output: it is only put in the
request header, and scrubbed from the response just in case.

Only allowlisted API bases can be called, so a saved key is never sent anywhere
but its own service.
"""

import json
import logging
from typing import Any

import httpx

from app.config import Settings
from app.crypto import Vault, load_master_key
from app.runner import TaskContext
from app.vault import CredentialStore

log = logging.getLogger(__name__)

# site -> API base URL. The key saved for the site only ever goes to this base.
API_BASES: dict[str, str] = {
    "openrouter.ai": "https://openrouter.ai/api/v1",
}

MAX_BODY_CHARS = 4000  # keep tool results small for the model


class ApiCaller:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.settings = settings
        self.transport = transport  # tests swap in a mock
        self._vault: Vault | None = None

    def _store(self, ctx: TaskContext) -> CredentialStore:
        if self._vault is None:
            self._vault = Vault(load_master_key(self.settings.vault_master_key))
        return CredentialStore(ctx.session_factory, self._vault)

    async def call(
        self, ctx: TaskContext, *, site: str, method: str, path: str, body: Any
    ) -> dict[str, Any]:
        base = API_BASES.get(site)
        if base is None:
            return {
                "ok": False,
                "error": "no_api_support",
                "message": f"No API support for {site}. Use run_browser_task instead. "
                f"Supported: {sorted(API_BASES)}.",
            }
        method = method.upper()
        if method not in ("GET", "POST"):
            return {"ok": False, "error": "bad_request", "message": "method must be GET or POST"}
        url = httpx.URL(base + path)
        if (
            not path.startswith("/")
            or any(bad in path for bad in ("//", "..", "\\", "@"))
            or url.host != httpx.URL(base).host
            or not url.path.startswith(httpx.URL(base).path + "/")
        ):
            return {
                "ok": False,
                "error": "bad_request",
                "message": "path must be a path under the API base, e.g. /chat/completions",
            }

        ctx.use_site(site)  # revoking the site now stops the task
        key = await self._store(ctx).api_key(ctx.user_id, site, ctx.task_id)
        if key is None:
            return {
                "ok": False,
                "error": "no_api_key",
                "message": f"No API key saved for {site}. Ask the user with "
                "request_access (kind api_key), then retry.",
            }

        await ctx.progress(f"Calling the {site} API: {method} {path}")
        try:
            async with httpx.AsyncClient(transport=self.transport, timeout=90) as client:
                resp = await client.request(
                    method,
                    url,
                    headers={"Authorization": f"Bearer {key}"},
                    json=body if method == "POST" else None,
                )
        except httpx.HTTPError as exc:
            log.warning("API call to %s failed: %s", site, type(exc).__name__)
            return {"ok": False, "error": "network_error", "message": f"Couldn't reach {site}."}

        text = resp.text.replace(key, "[redacted]")
        try:
            data: Any = json.loads(text)
            text = json.dumps(data)[:MAX_BODY_CHARS]
        except ValueError:
            text = text[:MAX_BODY_CHARS]
        return {"ok": resp.is_success, "status": resp.status_code, "body": text}
