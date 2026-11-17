from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import AsyncIterator


def content_to_text(content: object) -> str:
    """Flatten a LangChain message chunk's `content` to plain text.

    Newer models (Gemini 3, Claude with extended thinking, some Bedrock models)
    stream `content` as a list of content blocks — e.g.
    `[{"type": "text", "text": "..."}]` plus reasoning/thinking blocks — rather
    than a bare string. Callers concatenate tokens into one response string, so a
    list here raises `can only concatenate str (not "list") to str`. Keep only the
    text blocks and drop reasoning/other block types.
    """
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
        return "".join(parts)
    return str(content)


def content_to_thinking(content: object) -> str:
    """The inverse of `content_to_text`: keep only the reasoning/thinking blocks
    and drop the visible answer.

    Providers label reasoning differently — Anthropic streams
    `{"type": "thinking", "thinking": "..."}`, LangChain's standardized blocks
    use `{"type": "reasoning", ...}`, and Gemini marks thought parts with a
    truthy `thought` flag — so we check several shapes. A bare string or `None`
    carries no reasoning, so it yields "".
    """
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for block in content:
        if not isinstance(block, dict):
            continue
        if block.get("type") in ("thinking", "reasoning", "reasoning_content"):
            val = (
                block.get("thinking")
                or block.get("reasoning")
                or block.get("text")
                or ""
            )
        elif block.get("thought"):  # Gemini flags thought parts on a text block
            val = block.get("text", "")
        else:
            continue
        if isinstance(val, str):
            parts.append(val)
    return "".join(parts)


@dataclass
class ProviderInfo:
    provider: str
    model_id: str
    display_name: str
    supports_vision: bool = True
    context_window: int = 128_000
    # Ceiling for a single response's output tokens. Distinct from
    # `context_window` (input + output). Providers that don't set an explicit cap
    # fall back to the client/service default, which can be surprisingly low.
    max_output_tokens: int = 4096
    # True when the model can emit an extended-thinking trace. Drives the
    # Claude-only effort selector in the UI.
    supports_thinking: bool = False


@dataclass
class StreamChunk:
    content: str = ""
    thinking: str = ""
    finish_reason: str | None = None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0


class VLMProvider(ABC):
    """Common interface for all VLM providers."""

    @classmethod
    @abstractmethod
    def list_models(cls) -> list[ProviderInfo]:
        ...

    @abstractmethod
    async def astream_vision(
        self,
        *,
        system_prompt: str,
        messages: list[dict],  # [{role, content: str | list}]
    ) -> AsyncIterator[StreamChunk]:
        ...
