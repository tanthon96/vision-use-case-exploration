from __future__ import annotations

from typing import AsyncIterator

from langchain_aws import ChatBedrockConverse
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage

from .base import VLMProvider, ProviderInfo, StreamChunk, content_to_text
from ..core.config import settings

# Only vision-capable models belong here — this workbench streams images through
# `astream_vision`, so text-only models can't serve its purpose. Verified against
# each model's Bedrock model card (Input Modalities → Image).
#
# `max_output_tokens` is the per-model output ceiling. It must be set explicitly:
# the Bedrock default is a low ~2k for some families, which silently truncates
# long responses.
#
# We use the Converse API (`ChatBedrockConverse`) for every model. Converse is a
# unified, provider-agnostic surface, so it covers both the classic first-party
# models (Anthropic/Amazon/Meta) and the newer open-weight models (Moonshot Kimi,
# Qwen) whose `moonshotai.*` / `qwen.*` IDs have no InvokeModel body adapter in
# langchain_aws. All models below expose Converse on the `bedrock-runtime`
# endpoint per their model cards.
#
# Some model IDs are region-prefixed inference-profile IDs (`us.*`) rather than
# bare model IDs. The newer Anthropic (Claude 4.x), Amazon Nova 2, Meta Llama 4,
# and Mistral families are only invocable on-demand through a cross-region
# inference profile, so the bare ID 403s — the `us.` prefix is required. Each ID
# below was verified to invoke against a live account in us-east-1.
_MODELS = [
    # ProviderInfo("bedrock", "anthropic.claude-3-5-sonnet-20241022-v2:0", "Claude 3.5 Sonnet (Bedrock)", context_window=200_000, max_output_tokens=8192),
    ProviderInfo("bedrock", "us.anthropic.claude-sonnet-4-6", "Claude Sonnet 4.6", context_window=200_000, max_output_tokens=8192),
    ProviderInfo("bedrock", "us.anthropic.claude-haiku-4-5-20251001-v1:0", "Claude Haiku 4.5", context_window=200_000, max_output_tokens=64000),
    ProviderInfo("bedrock", "amazon.nova-pro-v1:0", "Amazon Nova Pro", context_window=300_000, max_output_tokens=10000),
    ProviderInfo("bedrock", "amazon.nova-lite-v1:0", "Amazon Nova Lite", context_window=300_000, max_output_tokens=10000),
    ProviderInfo("bedrock", "us.amazon.nova-2-lite-v1:0", "Amazon Nova 2 Lite", context_window=1_000_000, max_output_tokens=65535),
    ProviderInfo("bedrock", "meta.llama3-2-90b-instruct-v1:0", "Llama 3.2 90B Vision", context_window=128_000, max_output_tokens=2048),
    ProviderInfo("bedrock", "us.meta.llama4-maverick-17b-instruct-v1:0", "Llama 4 Maverick 17B", context_window=1_000_000, max_output_tokens=16384),
    ProviderInfo("bedrock", "us.mistral.pixtral-large-2502-v1:0", "Pixtral Large (25.02)", context_window=128_000, max_output_tokens=16384),
    ProviderInfo("bedrock", "google.gemma-3-27b-it", "Gemma 3 27B", context_window=128_000, max_output_tokens=16384),
    ProviderInfo("bedrock", "moonshotai.kimi-k2.5", "Kimi K2.5 (Moonshot)", context_window=256_000, max_output_tokens=16384),
    ProviderInfo("bedrock", "qwen.qwen3-vl-235b-a22b", "Qwen3-VL 235B A22B", context_window=256_000, max_output_tokens=8192),
]

_MAX_OUTPUT_TOKENS = {m.model_id: m.max_output_tokens for m in _MODELS}

# Bedrock on-demand pricing, USD per 1M tokens (input / output), us-east-1.
# Bedrock prices vary by region and change over time — treat as an estimate and
# revisit against the AWS Bedrock pricing page if exactness matters. Models
# omitted here resolve to "pricing unavailable" rather than a fabricated rate
# (Qwen3-VL pricing was not published on its model card at time of writing).
_COST = {
    "anthropic.claude-3-5-sonnet-20241022-v2:0": (3.0, 15.0),
    "us.anthropic.claude-sonnet-4-6": (3.0, 15.0),
    "us.anthropic.claude-haiku-4-5-20251001-v1:0": (1.0, 5.0),
    "amazon.nova-pro-v1:0": (0.8, 3.2),
    "amazon.nova-lite-v1:0": (0.06, 0.24),
    "meta.llama3-2-90b-instruct-v1:0": (0.72, 0.72),
    "moonshotai.kimi-k2.5": (0.6, 3.0),
    # Nova 2 Lite, Llama 4 Maverick, Pixtral Large, and Gemma 3 pricing not
    # confirmed for us-east-1 at time of writing — left out so they resolve to
    # "pricing unavailable" rather than a fabricated rate.
}


class BedrockProvider(VLMProvider):
    def __init__(
        self,
        model_id: str = "anthropic.claude-3-5-sonnet-20241022-v2:0",
        aws_access_key_id: str | None = None,
        aws_secret_access_key: str | None = None,
        region: str | None = None,
    ):
        self.model_id = model_id
        self._client = ChatBedrockConverse(
            model_id=model_id,
            region_name=region or settings.aws_default_region,
            aws_access_key_id=aws_access_key_id or settings.aws_access_key_id or None,
            aws_secret_access_key=aws_secret_access_key or settings.aws_secret_access_key or None,
            max_tokens=_MAX_OUTPUT_TOKENS.get(model_id, 4096),
        )

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
            token = content_to_text(chunk.content)
            usage = getattr(chunk, "usage_metadata", None) or {}
            yield StreamChunk(
                content=token,
                prompt_tokens=usage.get("input_tokens", 0),
                completion_tokens=usage.get("output_tokens", 0),
            )

        yield StreamChunk(finish_reason="done")
