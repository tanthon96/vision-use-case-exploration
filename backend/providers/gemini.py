from __future__ import annotations

from typing import AsyncIterator

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage

from .base import (
    VLMProvider, ProviderInfo, StreamChunk, content_to_text, content_to_thinking,
)
from ..core.config import settings

_MODELS = [
    ProviderInfo("gemini", "gemini-3.1-pro-preview", "Gemini 3.1 Pro (Preview)", context_window=1_048_576),
    ProviderInfo("gemini", "gemini-3.5-flash", "Gemini 3.5 Flash", context_window=1_048_576),
    ProviderInfo("gemini", "gemini-3-flash-preview", "Gemini 3 Flash (Preview)", context_window=1_048_576),
    ProviderInfo("gemini", "gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite", context_window=1_048_576),
    ProviderInfo("gemini", "gemini-2.5-pro", "Gemini 2.5 Pro", context_window=1_048_576),
    ProviderInfo("gemini", "gemini-2.5-flash", "Gemini 2.5 Flash", context_window=1_048_576),
    ProviderInfo("gemini", "gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite", context_window=1_048_576),
]

# (input, output) USD per 1M tokens, standard non-batch tier. Preview models
# use tiered pricing (≤200k-token prompt rate shown).
_COST = {
    "gemini-3.1-pro-preview": (2.0, 12.0),
    "gemini-3.5-flash": (1.5, 9.0),
    "gemini-3-flash-preview": (0.5, 3.0),
    "gemini-3.1-flash-lite": (0.25, 1.5),
    "gemini-2.5-pro": (1.25, 10.0),
    "gemini-2.5-flash": (0.3, 2.5),
    "gemini-2.5-flash-lite": (0.1, 0.4),
}


# Models to surface a thinking trace for. `thinking_budget=-1` lets Gemini decide
# how much to reason (dynamic thinking); `include_thoughts` returns the thought
# summary so we can stream it. The Flash-Lite tiers are left off — they default
# to no thinking and are meant for latency-sensitive use.
_THINKING_MODELS = {
    "gemini-3.1-pro-preview",
    "gemini-3.5-flash",
    "gemini-3-flash-preview",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
}


class GeminiProvider(VLMProvider):
    def __init__(self, model_id: str = "gemini-2.5-flash", api_key: str | None = None):
        self.model_id = model_id
        kwargs = dict(
            model=model_id,
            google_api_key=api_key or settings.google_api_key or None,
            streaming=True,
        )
        if model_id in _THINKING_MODELS:
            kwargs["thinking_budget"] = -1
            kwargs["include_thoughts"] = True
        self._client = ChatGoogleGenerativeAI(**kwargs)

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

        # Gemini streams usage as per-chunk DELTAS: langchain_google_genai calls
        # subtract_usage() because the Gemini API returns already-accumulated
        # counts on every chunk. They must be SUMMED — keeping only the last
        # chunk's value captures just the final delta and drastically undercounts
        # output tokens. Deltas can dip negative on the final chunk (an input
        # count correction), which the running sum absorbs correctly. Gemini's
        # output_tokens already includes reasoning/thinking tokens. We emit the
        # running total each chunk so the caller's "last value wins" lands on it.
        in_tokens = 0
        out_tokens = 0
        async for chunk in self._client.astream(lc_messages):
            usage = getattr(chunk, "usage_metadata", None) or {}
            in_tokens += usage.get("input_tokens", 0) or 0
            out_tokens += usage.get("output_tokens", 0) or 0
            yield StreamChunk(
                content=content_to_text(chunk.content),
                thinking=content_to_thinking(chunk.content),
                prompt_tokens=in_tokens,
                completion_tokens=out_tokens,
            )

        yield StreamChunk(finish_reason="done")
