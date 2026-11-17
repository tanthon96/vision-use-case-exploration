from __future__ import annotations

from typing import AsyncIterator

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage

from .base import (
    VLMProvider, ProviderInfo, StreamChunk, content_to_text, content_to_thinking,
)
from ..core.config import settings

_MODELS = [
    ProviderInfo("anthropic", "claude-opus-4-7", "Claude Opus 4.7", context_window=200_000, supports_thinking=True),
    ProviderInfo("anthropic", "claude-sonnet-4-6", "Claude Sonnet 4.6", context_window=200_000, supports_thinking=True),
    ProviderInfo("anthropic", "claude-haiku-4-5-20251001", "Claude Haiku 4.5", context_window=200_000),
    ProviderInfo("anthropic", "claude-3-5-sonnet-20241022", "Claude 3.5 Sonnet", context_window=200_000),
    ProviderInfo("anthropic", "claude-3-5-haiku-20241022", "Claude 3.5 Haiku", context_window=200_000),
]

# Effort levels accepted by the per-run thinking selector. "off" disables
# thinking entirely; the rest map to Anthropic's adaptive-thinking effort.
_EFFORTS = {"low", "medium", "high", "max"}

# Models that support extended thinking. These take adaptive thinking only
# (`budget_tokens` 400s), and thinking text is omitted unless `display` is set —
# so we opt into "summarized" to stream a readable trace. The Claude 3.5 line
# doesn't support extended thinking and always runs without it.
_THINKING_MODELS = {"claude-opus-4-7", "claude-sonnet-4-6"}

# Cost per 1M tokens (input / output) in USD
_COST = {
    "claude-opus-4-7": (15.0, 75.0),
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-haiku-4-5-20251001": (0.8, 4.0),
    "claude-3-5-sonnet-20241022": (3.0, 15.0),
    "claude-3-5-haiku-20241022": (0.8, 4.0),
}


class ClaudeProvider(VLMProvider):
    def __init__(
        self,
        model_id: str = "claude-sonnet-4-6",
        api_key: str | None = None,
        thinking_effort: str | None = None,
    ):
        """`thinking_effort` (Claude thinking models only): one of
        low/medium/high/max, "off" to disable thinking, or None to default to
        "low". Ignored for models that don't support thinking."""
        self.model_id = model_id
        effort = self.resolve_effort(model_id, thinking_effort)
        kwargs = dict(
            model=model_id,
            api_key=api_key or settings.anthropic_api_key or None,
            streaming=True,
        )
        if effort:
            # Thinking tokens count toward the output budget. A large extraction
            # plus reasoning easily blows past a small cap — a too-low limit
            # truncates before the answer is emitted, leaving an empty bubble. The
            # cap only bounds output; you're billed for tokens actually produced.
            kwargs["max_tokens"] = 32000
            kwargs["thinking"] = {"type": "adaptive", "display": "summarized"}
            kwargs["effort"] = effort
        else:
            kwargs["max_tokens"] = 4096
        self._client = ChatAnthropic(**kwargs)

    @classmethod
    def supports_thinking(cls, model_id: str) -> bool:
        return model_id in _THINKING_MODELS

    @classmethod
    def resolve_effort(cls, model_id: str, thinking_effort: str | None) -> str | None:
        """The effort actually applied for a run, or None when thinking is off.

        Non-thinking models always return None. For thinking models: "off"
        disables thinking; an empty/None request defaults to "low"; an unknown
        value also falls back to "low"."""
        if not cls.supports_thinking(model_id):
            return None
        choice = (thinking_effort or "").strip().lower()
        if choice == "off":
            return None
        return choice if choice in _EFFORTS else "low"

    @classmethod
    def list_models(cls) -> list[ProviderInfo]:
        return _MODELS

    async def astream_vision(
        self, *, system_prompt: str, messages: list[dict]
    ) -> AsyncIterator[StreamChunk]:
        lc_messages = []
        if system_prompt:
            lc_messages.append(SystemMessage(content=system_prompt))

        for msg in messages:
            role = msg["role"]
            content = msg["content"]
            if role == "user":
                lc_messages.append(HumanMessage(content=content))
            elif role == "assistant":
                lc_messages.append(AIMessage(content=content))

        async for chunk in self._client.astream(lc_messages):
            usage = getattr(chunk, "usage_metadata", None) or {}
            yield StreamChunk(
                content=content_to_text(chunk.content),
                thinking=content_to_thinking(chunk.content),
                finish_reason=chunk.response_metadata.get("stop_reason"),
                prompt_tokens=usage.get("input_tokens", 0),
                completion_tokens=usage.get("output_tokens", 0),
            )

        # Emit final cost chunk
        in_cost, out_cost = _COST.get(self.model_id, (0, 0))
        yield StreamChunk(finish_reason="done", cost_usd=0.0)
