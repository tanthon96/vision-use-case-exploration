from fastapi import APIRouter
from pydantic import BaseModel

from ...providers import GeminiProvider, ClaudeProvider, BedrockProvider, OllamaProvider

router = APIRouter(prefix="/api/models", tags=["models"])


class ModelInfo(BaseModel):
    provider: str
    model_id: str
    display_name: str
    supports_vision: bool
    context_window: int
    supports_thinking: bool


@router.get("", response_model=list[ModelInfo])
async def list_models():
    models = []
    for cls in (ClaudeProvider, GeminiProvider, BedrockProvider, OllamaProvider):
        for info in cls.list_models():
            models.append(ModelInfo(
                provider=info.provider,
                model_id=info.model_id,
                display_name=info.display_name,
                supports_vision=info.supports_vision,
                context_window=info.context_window,
                supports_thinking=info.supports_thinking,
            ))
    return models
