"""Browser agent interface used by the orchestrator's `run_browser_task` tool.

Phase 4.3 plugs in browser-use (local Chrome in development, a cloud browser in
production). Until then, the stub honestly reports that no browser is available.
"""

from typing import Any, Protocol

from app.runner import TaskContext


class BrowserAgent(Protocol):
    async def run(self, ctx: TaskContext, *, site: str, instruction: str) -> dict[str, Any]:
        """Do `instruction` on `site`. Returns {"ok": bool, ...} with a short summary."""
        ...


class UnavailableBrowser:
    async def run(self, ctx: TaskContext, *, site: str, instruction: str) -> dict[str, Any]:
        return {
            "ok": False,
            "error": "browser_unavailable",
            "message": (
                "Browser automation isn't connected in this build yet. Nothing was done on "
                f"{site}. Tell the user plainly; do not claim the task was completed."
            ),
        }
