"""Thin wrapper around the Anthropic SDK so the orchestrator can be tested offline.

The orchestrator only sees plain dicts (`LLMResponse.content`), which are also
what gets stored in the task checkpoint and sent back on the next call.
"""

from dataclasses import dataclass, field
from typing import Any, Protocol

import anthropic

from app.config import Settings

# USD per million tokens: (input, output, cache write, cache read).
PRICES: dict[str, tuple[float, float, float, float]] = {
    "claude-sonnet-5-5": (2.00, 10.00, 2.50, 0.20),
    "claude-sonnet-5": (2.00, 10.00, 2.50, 0.20),
    "claude-opus-5-5": (4.00, 20.00, 5.00, 0.20),
    "claude-haiku-5-5": (0.10, 0.50, 0.125, 0.01),
}


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0

    def cost_usd(self, model: str) -> float:
        inp, out, write, read = PRICES.get(model, PRICES["claude-opus-5-5"])
        return (
            self.input_tokens * inp
            + self.output_tokens * out
            + self.cache_creation_input_tokens * write
            + self.cache_read_input_tokens * read
        ) / 1_000_000


@dataclass
class LLMResponse:
    content: list[dict[str, Any]]
    stop_reason: str | None
    usage: Usage = field(default_factory=Usage)
    model: str = ""
    refusal_category: str | None = None


class LLM(Protocol):
    model: str

    async def create(
        self, *, system: str, messages: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> LLMResponse: ...


class ClaudeLLM:
    def __init__(self, settings: Settings) -> None:
        if not settings.anthropic_api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set (see .env.example)")
        self.client = anthropic.AsyncAnthropic(
            api_key=settings.anthropic_api_key, timeout=120.0, max_retries=4
        )
        self.model = settings.llm_model
        self.effort = settings.llm_effort
        self.max_tokens = settings.llm_max_tokens
        self.fallbacks = settings.llm_fallbacks

    async def create(
        self, *, system: str, messages: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> LLMResponse:
        extra: dict[str, Any] = {}
        if self.fallbacks:
            extra = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}
        response = await self.client.beta.messages.create(
            model=self.model,
            max_tokens=self.max_tokens,
            system=system,
            messages=messages,
            tools=tools,
            output_config={"effort": self.effort},
            cache_control={"type": "ephemeral"},  # cache the stable prefix across steps
            **extra,
        )
        usage = response.usage
        category = None
        if response.stop_reason == "refusal" and response.stop_details:
            category = response.stop_details.category
        return LLMResponse(
            content=[block.to_dict() for block in response.content],
            stop_reason=response.stop_reason,
            usage=Usage(
                input_tokens=usage.input_tokens or 0,
                output_tokens=usage.output_tokens or 0,
                cache_creation_input_tokens=usage.cache_creation_input_tokens or 0,
                cache_read_input_tokens=usage.cache_read_input_tokens or 0,
            ),
            model=response.model,
            refusal_category=category,
        )
