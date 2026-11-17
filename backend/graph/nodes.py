from __future__ import annotations

import base64
import hashlib
import io
import time
from typing import Any

from jinja2 import Template
from PIL import Image

from ..core.skills_loader import get_skill


def preprocess_image(state: dict) -> dict:
    """Resize and base64-encode images; compute a content hash."""
    raw_images: list[dict] = state.get("raw_images", [])
    processed = []

    for img_item in raw_images:
        data_b64: str = img_item.get("data", "")
        name: str = img_item.get("name", "image")

        # Decode, resize to max 1568px on the long edge (Anthropic limit), re-encode
        raw_bytes = base64.b64decode(data_b64)
        img = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
        max_dim = 1568
        if max(img.width, img.height) > max_dim:
            img.thumbnail((max_dim, max_dim), Image.LANCZOS)

        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        encoded = base64.b64encode(buf.getvalue()).decode()
        img_hash = hashlib.sha256(buf.getvalue()).hexdigest()[:16]

        processed.append({"data": encoded, "name": name, "hash": img_hash, "mime": "image/jpeg"})

    return {**state, "processed_images": processed}


def build_prompt(state: dict) -> dict:
    """
    Construct the message list for the model:
      - Apply the active skill's system prompt and task template
      - Prepend few-shot examples (image + expected response pairs)
    """
    skill_name: str = state.get("skill_name", "")
    user_instruction: str = state.get("user_instruction", "")
    processed_images: list[dict] = state.get("processed_images", [])

    skill = get_skill(skill_name) if skill_name else None

    system_prompt = ""
    task_text = user_instruction

    if skill:
        system_prompt = skill.get("system_prompt", "")
        template_str = skill.get("task_template", "{{ user_instruction }}")
        task_text = Template(template_str).render(user_instruction=user_instruction)

    # Build few-shot messages if skill defines them
    messages: list[dict] = []
    if skill:
        for ex in skill.get("few_shot_examples", []):
            ex_text = ex.get("prompt", "")
            ex_expected = ex.get("expected", "")
            # Few-shot: text only (image file path not available at runtime, skip gracefully)
            messages.append({"role": "user", "content": ex_text})
            messages.append({"role": "assistant", "content": ex_expected})

    # Build the actual user turn: interleave images + text. Each image is
    # preceded by its filename so skills that need to reference the source file
    # (e.g. CSV extraction with a "Source Photo" column) can cite it accurately.
    user_content: list[dict] = []
    for img in processed_images:
        user_content.append({
            "type": "text",
            "text": f"Image filename: {img.get('name', 'image')}",
        })
        user_content.append({
            "type": "image_url",
            "image_url": {"url": f"data:{img['mime']};base64,{img['data']}"},
        })
    user_content.append({"type": "text", "text": task_text})

    messages.append({"role": "user", "content": user_content})

    return {**state, "system_prompt": system_prompt, "messages": messages, "start_time": time.time()}


async def invoke_model(state: dict) -> dict:
    """Call the provider and collect all tokens (used in batch mode)."""
    provider = state["provider"]
    system_prompt: str = state.get("system_prompt", "")
    messages: list[dict] = state.get("messages", [])

    tokens: list[str] = []
    prompt_tokens = 0
    completion_tokens = 0

    async for chunk in provider.astream_vision(system_prompt=system_prompt, messages=messages):
        if chunk.content:
            tokens.append(chunk.content)
        if chunk.prompt_tokens:
            prompt_tokens = chunk.prompt_tokens
        if chunk.completion_tokens:
            completion_tokens = chunk.completion_tokens

    elapsed_ms = (time.time() - state.get("start_time", time.time())) * 1000

    return {
        **state,
        "response_text": "".join(tokens),
        "latency_ms": elapsed_ms,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
    }


def record_metrics(state: dict) -> dict:
    """Package metrics for persistence (actual DB write happens in the router)."""
    return {
        **state,
        "metrics": {
            "latency_ms": state.get("latency_ms", 0),
            "prompt_tokens": state.get("prompt_tokens", 0),
            "completion_tokens": state.get("completion_tokens", 0),
            "cost_usd": state.get("cost_usd", 0.0),
        },
    }
