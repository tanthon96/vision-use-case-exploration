"""Workspace + chat aware benchmark endpoint.

Lifecycle of a single POST /api/benchmark/run:
  1. Resolve workspace / chat (create chat if missing).
  2. Fetch each image's bytes from S3 (parallel).
  3. Snapshot the active skill (if any) into skill_snapshots.
  4. Insert the user message row + message_image rows with annotations frozen.
  5. Stream tokens from the provider; the response goes into the assistant
     message row when the stream completes.
  6. Emit a final SSE event with chat_id + message_id so the frontend can update
     its history without a refetch.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import AsyncIterator
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.audit import audit, _truncate
from ...core.auth import get_current_user
from ...core.config import settings
from ...core.csv_detect import extract_csv_blocks
from ...core.database import SessionLocal, get_session
from ...core.json_to_csv import json_array_to_csv
from ...core.postprocess import run_postprocess
from ...core.storage import file_object_key, get_image_bytes, put_file
from ...graph.nodes import build_prompt as graph_build_prompt
from ...models import (
    Chat, Image, Message, MessageImage, Skill, SkillSnapshot, User, WorkspaceFile,
)
from ...providers import (
    BedrockProvider, ClaudeProvider, GeminiProvider, OllamaProvider,
)
from ...providers.base import VLMProvider
from .workspaces import get_workspace_for_user

router = APIRouter(prefix="/api/benchmark", tags=["benchmark"])

_PROVIDER_MAP = {
    "anthropic": ClaudeProvider,
    "gemini": GeminiProvider,
    "bedrock": BedrockProvider,
    "ollama": OllamaProvider,
}


# ── Request schema ───────────────────────────────────────────────────────────

class ImageRef(BaseModel):
    image_id: str
    """Per-image annotations baked at send time. Stored in message_images."""
    annotations: list = Field(default_factory=list)


class BenchmarkRequest(BaseModel):
    workspace_id: str
    chat_id: str | None = None     # null → create a new chat
    provider: str
    model_id: str
    skill_id: str | None = None
    user_instruction: str = ""
    images: list[ImageRef] = Field(default_factory=list)
    # Claude thinking models only: low/medium/high/max, or "off". Empty → "low".
    thinking_effort: str = ""
    # Per-request key overrides; never persisted server-side.
    api_key: str = ""
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = ""
    ollama_base_url: str = ""


def _build_provider(req: BenchmarkRequest) -> VLMProvider:
    cls = _PROVIDER_MAP.get(req.provider)
    if cls is None:
        raise ValueError(f"unknown provider: {req.provider}")
    if req.provider == "anthropic":
        return cls(
            model_id=req.model_id,
            api_key=req.api_key or None,
            thinking_effort=req.thinking_effort or None,
        )
    if req.provider == "gemini":
        return cls(model_id=req.model_id, api_key=req.api_key or None)
    if req.provider == "bedrock":
        return cls(
            model_id=req.model_id,
            aws_access_key_id=req.aws_access_key_id or None,
            aws_secret_access_key=req.aws_secret_access_key or None,
            region=req.aws_region or None,
        )
    return cls(model_id=req.model_id, base_url=req.ollama_base_url or None)


def _truncate_title(text: str) -> str:
    s = text.strip().splitlines()[0] if text.strip() else "Untitled"
    return s[:60] + ("…" if len(s) > 60 else "")


def _compose_system_prompt(skill: Skill) -> str:
    """System prompt for a run: the skill body plus any bundled reference docs
    appended under a `# References` section so they reach the model at run time."""
    prompt = skill.system_prompt or ""
    refs = list(skill.references_json or [])
    if refs:
        blocks = [
            f"## {ref.get('name', 'reference')}\n{ref.get('content', '')}".rstrip()
            for ref in refs
        ]
        prompt = f"{prompt}\n\n# References\n\n" + "\n\n".join(blocks)
    return prompt


# ── Endpoint ─────────────────────────────────────────────────────────────────

@router.post("/run")
async def run_benchmark(
    req: BenchmarkRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    workspace = await get_workspace_for_user(UUID(req.workspace_id), user, db)

    # Resolve or create chat
    if req.chat_id:
        chat = await db.get(Chat, UUID(req.chat_id))
        if chat is None or chat.workspace_id != workspace.id:
            raise HTTPException(404, "chat not found")
    else:
        chat = Chat(
            workspace_id=workspace.id,
            title=_truncate_title(req.user_instruction or "New chat"),
            created_by_user_id=user.id,
        )
        db.add(chat)
        await db.flush()

    # Resolve images (must all belong to the same workspace)
    image_rows: list[Image] = []
    if req.images:
        img_ids = [UUID(r.image_id) for r in req.images]
        image_rows = list((
            await db.execute(
                select(Image).where(
                    Image.id.in_(img_ids),
                    Image.workspace_id == workspace.id,
                )
            )
        ).scalars())
        # Compare by set, not count: the same image_id may legitimately appear
        # more than once in req.images (e.g. a canvas image also @-picked), and
        # SQL IN(...) dedupes rows — a count check would false-404 those.
        found_ids = {row.id for row in image_rows}
        missing = [str(i) for i in img_ids if i not in found_ids]
        if missing:
            raise HTTPException(
                404, f"images not found in workspace: {', '.join(sorted(set(missing)))}"
            )

    # Preserve request order via the supplied list
    by_id = {row.id: row for row in image_rows}
    ordered_pairs = [(by_id[UUID(r.image_id)], r) for r in req.images]

    # Snapshot the active skill (if any)
    snapshot_id: UUID | None = None
    skill_row: Skill | None = None
    if req.skill_id:
        skill_row = await db.get(Skill, UUID(req.skill_id))
        if skill_row is None or skill_row.workspace_id != workspace.id:
            raise HTTPException(404, "skill not found")
        snap = SkillSnapshot(
            workspace_id=workspace.id,
            skill_id=skill_row.id,
            name=skill_row.name,
            system_prompt=skill_row.system_prompt,
            task_template=skill_row.task_template,
            few_shot_examples_json=list(skill_row.few_shot_examples_json or []),
            references_json=list(skill_row.references_json or []),
            postprocess_json=dict(skill_row.postprocess_json or {}),
        )
        db.add(snap)
        await db.flush()
        snapshot_id = snap.id

    # Determine next sequence_no for both rows
    last_seq = (await db.execute(
        select(func.coalesce(func.max(Message.sequence_no), 0))
        .where(Message.chat_id == chat.id)
    )).scalar_one()

    # Insert user message
    user_msg = Message(
        chat_id=chat.id,
        sequence_no=last_seq + 1,
        role="user",
        content_md=req.user_instruction,
        skill_snapshot_id=snapshot_id,
        model_provider=req.provider,
        model_id=req.model_id,
    )
    db.add(user_msg)
    await db.flush()

    # message_image rows, in submitted order
    for pos, (img, ref) in enumerate(ordered_pairs):
        db.add(MessageImage(
            message_id=user_msg.id,
            image_id=img.id,
            position=pos,
            annotations_json=list(ref.annotations or []),
        ))

    # Fetch image bytes in parallel for the LangGraph prompt
    image_bytes: list[tuple[Image, bytes]] = []
    if image_rows:
        results = await asyncio.gather(*[get_image_bytes(img.object_key) for img in image_rows])
        image_bytes = list(zip(image_rows, results))
    by_id_bytes = {img.id: data for img, data in image_bytes}

    # Build the LangGraph state. The graph's `build_prompt` expects base64.
    import base64
    raw_images = [
        {
            "data": base64.b64encode(by_id_bytes[img.id]).decode(),
            "name": img.original_name or img.sha256[:12],
        }
        for img, _ in ordered_pairs
    ]
    # Re-use existing preprocess in nodes.py for resize + hash, then build_prompt.
    from ...graph.nodes import preprocess_image as graph_preprocess
    state = graph_preprocess({"raw_images": raw_images})
    # Inject the snapshotted skill if present — build_prompt takes the name and
    # looks it up via skills_loader (which is YAML-based). Until we wire it up
    # to use the snapshot directly, we pass the system prompt + template manually.
    state = graph_build_prompt({
        **state,
        "skill_name": "",     # bypass file loader
        "user_instruction": req.user_instruction,
    })
    # Override with the snapshotted skill (if any) — overwrites the default
    # produced by build_prompt with snapshot fidelity.
    if snapshot_id and skill_row is not None:
        from jinja2 import Template
        state["system_prompt"] = _compose_system_prompt(skill_row)
        rendered_text = Template(skill_row.task_template).render(
            user_instruction=req.user_instruction
        )
        # Replace the LAST text part (the task prompt) with the rendered skill
        # template. Must be the last one: build_prompt prepends an
        # "Image filename: …" text part before each image, and clobbering those
        # would strip the filenames the model needs for the Source Photo column
        # (it would otherwise fall back to a placeholder like "1.png").
        if state["messages"]:
            last = state["messages"][-1]
            if isinstance(last.get("content"), list):
                for part in reversed(last["content"]):
                    if part.get("type") == "text":
                        part["text"] = rendered_text
                        break

    # Commit the user row + images so they're visible while streaming.
    await db.commit()

    provider = _build_provider(req)

    audit(
        "run_start",
        workspace=str(workspace.id),
        chat=str(chat.id),
        user=str(user.id),
        provider=req.provider,
        model=req.model_id,
        skill=skill_row.name if skill_row is not None else "none",
        images=len(ordered_pairs),
        image_ids=",".join(str(img.id) for img, _ in ordered_pairs) or "none",
        instruction=_truncate(req.user_instruction, 200),
    )

    async def event_stream() -> AsyncIterator[str]:
        # Use a fresh session for the streaming task so the dependency's
        # session can close cleanly when the route function returns.
        async with SessionLocal() as task_db:
            # Re-load chat for the assistant insert at the end.
            chat_id = chat.id

            full_text = ""
            full_thinking = ""
            prompt_tokens = 0
            completion_tokens = 0
            error_msg: str | None = None
            start = time.time()

            yield f"data: {json.dumps({'type': 'start', 'chat_id': str(chat_id), 'user_message_id': str(user_msg.id), 'batch_size': len(ordered_pairs)})}\n\n"

            # Surface the execution steps to the client so the bubble shows what
            # ran instead of a blank indicator.
            if skill_row is not None:
                yield f"data: {json.dumps({'type': 'step', 'kind': 'skill', 'label': f'Skill: {skill_row.name}'})}\n\n"
            yield f"data: {json.dumps({'type': 'step', 'kind': 'model', 'label': f'Model: {req.provider} · {req.model_id}'})}\n\n"

            # The model invocation is this app's "tool call".
            audit("model_call", chat=str(chat_id), provider=req.provider, model=req.model_id)

            try:
                async for chunk in provider.astream_vision(
                    system_prompt=state["system_prompt"],
                    messages=state["messages"],
                ):
                    if chunk.thinking:
                        full_thinking += chunk.thinking
                        yield f"data: {json.dumps({'type': 'thinking', 'content': chunk.thinking})}\n\n"
                    if chunk.content:
                        full_text += chunk.content
                        yield f"data: {json.dumps({'type': 'token', 'content': chunk.content})}\n\n"
                    if chunk.prompt_tokens:
                        prompt_tokens = chunk.prompt_tokens
                    if chunk.completion_tokens:
                        completion_tokens = chunk.completion_tokens
                    if chunk.finish_reason == "done":
                        break
            except Exception as e:
                error_msg = str(e)
                yield f"data: {json.dumps({'type': 'error', 'message': error_msg})}\n\n"

            latency_ms = (time.time() - start) * 1000

            # Skills that emit JSON rows (opt-in via postprocess.transform) get
            # their CSV built here rather than by the model — model-authored CSV
            # mis-quotes commas inside values and shifts columns. Converting the
            # JSON ourselves guarantees aligned, correctly-quoted output. We swap
            # the streamed JSON for the CSV via a `replace_content` event.
            transform = (skill_row.postprocess_json or {}).get("transform") if skill_row is not None else None
            if not error_msg and transform == "json_to_csv" and full_text.strip():
                csv_text = json_array_to_csv(full_text)
                if csv_text:
                    full_text = csv_text
                    yield f"data: {json.dumps({'type': 'replace_content', 'content': csv_text})}\n\n"
                    audit("transform", chat=str(chat_id), kind="json_to_csv",
                          rows=csv_text.count(chr(10)))

            # Post-process the output with the skill's script, if enabled. The
            # script's report is streamed to the client and appended to the
            # persisted message; the model's own text is preserved.
            script = (skill_row.postprocess_json or {}) if skill_row is not None else {}
            if (
                not error_msg
                and settings.skill_scripts_enabled
                and script.get("script_source")
                and full_text.strip()
            ):
                result = await run_postprocess(script["script_source"], full_text)
                audit(
                    "postprocess",
                    chat=str(chat_id),
                    script=script.get("script_name", "script"),
                    ok=result.ok,
                    report=_truncate(json.dumps(result.report), 300),
                )
                yield f"data: {json.dumps({'type': 'postprocess', 'ok': result.ok, 'report': result.report})}\n\n"
                full_text = (
                    f"{full_text}\n\n"
                    f"<!-- postprocess:{script.get('script_name', 'script')} "
                    f"ok={result.ok} -->\n"
                    f"```json\n{json.dumps(result.report, indent=2)}\n```"
                )

            # Record the reasoning effort actually applied (Claude only), so runs
            # can be compared by thinking depth. "off" when a thinking-capable
            # model ran without thinking; "" for models that can't think.
            effort_used = ""
            if req.provider == "anthropic":
                resolved = ClaudeProvider.resolve_effort(req.model_id, req.thinking_effort or None)
                effort_used = resolved or ("off" if ClaudeProvider.supports_thinking(req.model_id) else "")

            # Persist assistant message
            asst = Message(
                chat_id=chat_id,
                sequence_no=last_seq + 2,
                role="assistant",
                content_md=full_text,
                thinking_md=full_thinking,
                thinking_effort=effort_used,
                model_provider=req.provider,
                model_id=req.model_id,
                skill_snapshot_id=snapshot_id,
                latency_ms=latency_ms,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                error=error_msg or "",
            )
            task_db.add(asst)
            # Bump chat.updated_at so it floats to the top of the list
            chat_row = await task_db.get(Chat, chat_id)
            if chat_row is not None:
                from datetime import datetime, timezone
                chat_row.updated_at = datetime.now(timezone.utc)
            await task_db.commit()

            audit(
                "response",
                chat=str(chat_id),
                message=str(asst.id),
                provider=req.provider,
                model=req.model_id,
                latency_ms=round(latency_ms, 1),
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                error=error_msg,
                text=_truncate(full_text, 500),
            )

            # Auto-save any CSV the model produced as downloadable workspace
            # files (the "model creates files" capability). Uses the same
            # detection as the chat UI so JSON/prose isn't persisted as CSV.
            if not error_msg and full_text.strip():
                from datetime import datetime, timezone
                blocks = extract_csv_blocks(full_text)
                stem = (skill_row.name if skill_row is not None else "extract")
                ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
                saved: list[dict] = []
                for idx, block in enumerate(blocks):
                    suffix = "" if len(blocks) == 1 else f"-{idx + 1}"
                    fname = f"{stem}-{ts}{suffix}.csv"
                    file_id = uuid4()
                    key = file_object_key(workspace.id, file_id, fname)
                    data = block.encode("utf-8")
                    await put_file(key=key, data=data, mime_type="text/csv")
                    task_db.add(WorkspaceFile(
                        id=file_id,
                        workspace_id=workspace.id,
                        name=fname,
                        mime_type="text/csv",
                        size_bytes=len(data),
                        object_key=key,
                        source="model",
                        created_by_message_id=asst.id,
                    ))
                    saved.append({"id": str(file_id), "name": fname})
                    audit("file_created", chat=str(chat_id), file=fname,
                          bytes=len(data), source="model")
                if saved:
                    await task_db.commit()
                    yield f"data: {json.dumps({'type': 'files_saved', 'files': saved})}\n\n"

            if not error_msg:
                yield f"data: {json.dumps({'type': 'metrics', 'latency_ms': round(latency_ms, 1), 'prompt_tokens': prompt_tokens, 'completion_tokens': completion_tokens})}\n\n"
            yield f"data: {json.dumps({'type': 'done', 'assistant_message_id': str(asst.id)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
