from __future__ import annotations

from typing import AsyncIterator

from langchain_ollama import ChatOllama
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage

from .base import VLMProvider, ProviderInfo, StreamChunk, content_to_text
from ..core.config import settings

# Common open-weight vision models available via Ollama
_DEFAULT_MODELS = [
    ProviderInfo("ollama", "llava:latest", "LLaVA (latest)", context_window=4096),
    ProviderInfo("ollama", "llava:13b", "LLaVA 13B", context_window=4096),
    ProviderInfo("ollama", "llava:34b", "LLaVA 34B", context_window=4096),
    ProviderInfo("ollama", "llava-llama3:latest", "LLaVA Llama3", context_window=8192),
    ProviderInfo("ollama", "moondream:latest", "Moondream 2", context_window=2048),
    ProviderInfo("ollama", "minicpm-v:latest", "MiniCPM-V", context_window=8192),
    ProviderInfo("ollama", "qwen2-vl:latest", "Qwen2 VL", context_window=32768),
    ProviderInfo("ollama", "internvl2:latest", "InternVL2", context_window=8192),
]


class OllamaProvider(VLMProvider):
    def __init__(self, model_id: str = "llava:latest", base_url: str | None = None):
        self.model_id = model_id
        self._client = ChatOllama(
            model=model_id,
            base_url=base_url or settings.ollama_base_url,
        )

    @classmethod
    def list_models(cls) -> list[ProviderInfo]:
        return _DEFAULT_MODELS

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
            token = content_to_text(chunk.content)
            yield StreamChunk(content=token)

        yield StreamChunk(finish_reason="done")
