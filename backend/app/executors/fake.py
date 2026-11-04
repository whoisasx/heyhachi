"""Fake executor for phase 4.1: exercises states, events, checkpoints and cards.

Replaced by the real orchestrator in phase 4.2. Trigger words in the message:
- "confirm": asks for a Confirm card before finishing
- "fail":    raises an error after the first step
"""

import asyncio

from app.runner import TaskContext

STEPS = ("Understanding your request", "Working on it")


class FakeExecutor:
    def __init__(self, step_delay: float = 1.0) -> None:
        self.step_delay = step_delay

    async def run(self, ctx: TaskContext) -> None:
        text = ctx.request_text.lower()
        checkpoint = dict(ctx.checkpoint)

        for index in range(checkpoint.get("step", 0), len(STEPS)):
            await ctx.progress(STEPS[index])
            await asyncio.sleep(self.step_delay)
            checkpoint["step"] = index + 1
            await ctx.save_checkpoint(checkpoint)
            if "fail" in text:
                raise RuntimeError("simulated failure")

        if "confirm" in text and not checkpoint.get("confirmed"):
            answer = await ctx.ask(
                "confirm",
                {"title": "Go ahead?", "body": f"About to: {ctx.request_text}"},
            )
            if answer.get("decision") != "approve":
                await ctx.finish("Okay, I won't do that.", {"approved": False})
                return
            checkpoint["confirmed"] = True
            await ctx.save_checkpoint(checkpoint)

        await ctx.set_status("verifying")
        await ctx.progress("Checking the result")
        await asyncio.sleep(self.step_delay)
        await ctx.finish(f"Done (fake task): {ctx.request_text}", {"fake": True})
