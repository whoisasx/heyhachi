"""Fake executor for phase 4.1: exercises states, events, checkpoints and cards.

Replaced by the real orchestrator in phase 4.2. Trigger words in the message:
- "confirm": asks for a Confirm card before finishing
- "fail":    raises an error after the first step
- "pick":    asks a multiple-choice question
- "login":   shows a Connect card (log in yourself, or give details)
- "otp":     asks for a one-time code
- "live":    shows a live browser beside the chat while it works
- "rich":    replies with a table, a labelled link and a bare link
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

        if "live" in text:
            await ctx.emit("live_view", {"url": "https://example.com", "site": "example.com"})
            await ctx.progress("Opening example.com in the browser")
            await asyncio.sleep(self.step_delay * 6)
        if "pick" in text and "picked" not in checkpoint:
            answer = await ctx.ask(
                "question",
                {"title": "Which size do you want?", "choices": ["Small", "Medium", "Large"]},
            )
            checkpoint["picked"] = answer.get("text", "")
            await ctx.save_checkpoint(checkpoint)
        if "login" in text and not checkpoint.get("logged_in"):
            await ctx.progress("Waiting for you to connect swiggy.com")
            await ctx.ask(
                "credential",
                {
                    "kind": "connect",
                    "site": "swiggy.com",
                    "title": "Connect swiggy.com",
                    "body": "I need you to log in to Swiggy so I can place the order.",
                    "access": "browser_login",
                    "fields": [
                        {"name": "username", "label": "Phone or email", "type": "text"},
                        {"name": "password", "label": "Password (optional)", "type": "password"},
                    ],
                },
            )
            checkpoint["logged_in"] = True
            await ctx.save_checkpoint(checkpoint)
        if "otp" in text and not checkpoint.get("otp"):
            await ctx.ask("otp", {"site": "swiggy.com", "title": "Enter the code", "body": "Swiggy sent a 6-digit code to your phone."})
            checkpoint["otp"] = True
            await ctx.save_checkpoint(checkpoint)

        await ctx.set_status("verifying")
        await ctx.progress("Checking the result")
        await asyncio.sleep(self.step_delay)
        reply = f"Done (fake task): {ctx.request_text}"
        if checkpoint.get("picked"):
            reply += f"\n\nYou picked **{checkpoint['picked']}**."
        if "rich" in text:
            reply = (
                "Here's what I found on **whoisasx/heyhachi**:\n\n"
                "| Metric | Value |\n|---|---|\n| Stars | 128 |\n| Forks | 14 |\n| Open issues | 3 |\n\n"
                "- Last commit 2 hours ago\n- Main language: TypeScript\n\n"
                "[Open the repo](https://github.com/whoisasx/heyhachi)\n\n"
                "https://github.com/whoisasx/heyhachi/stargazers?tab=stars&utm_source=hachi&very_long_query=abcdefghijklmnopqrstuvwxyz0123456789"
            )
        await ctx.finish(reply, {"fake": True})
