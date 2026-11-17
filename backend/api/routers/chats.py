"""Chat CRUD and message listing — read side only.

The benchmark router owns inserts of user + assistant message rows.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, desc, asc, func
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.auth import get_current_user
from ...core.database import get_session
from ...core.storage import presigned_url
from ...models import (
    Chat, Message, MessageImage, Image, User, SkillSnapshot,
)
from ...providers.pricing import estimate_cost
from .workspaces import get_workspace_for_user

router = APIRouter(prefix="/api/workspaces/{workspace_id}/chats", tags=["chats"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class ChatSummary(BaseModel):
    id: str
    title: str
    message_count: int
    last_model: str | None
    last_skill: str | None
    archived: bool
    created_at: str
    updated_at: str


class ChatCreate(BaseModel):
    title: str = ""


class ChatPatch(BaseModel):
    title: str | None = None
    archived: bool | None = None


class ChatModelStat(BaseModel):
    model_provider: str | None
    model_id: str | None
    input_tokens: int
    output_tokens: int
    estimated_cost: float | None  # None when the model has no pricing data
    message_count: int


class ChatStats(BaseModel):
    chat_id: str
    total_input_tokens: int
    total_output_tokens: int
    estimated_cost: float          # sum over priced models only
    has_unpriced: bool             # true if any model lacked pricing
    by_model: list[ChatModelStat]


class MessageImageOut(BaseModel):
    image_id: str
    presigned_url: str
    position: int
    annotations: list
    original_name: str
    sha256: str


class MessageOut(BaseModel):
    id: str
    chat_id: str
    sequence_no: int
    role: str
    content_md: str
    thinking_md: str
    thinking_effort: str
    model_provider: str | None
    model_id: str | None
    skill_name: str | None
    latency_ms: float | None
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float
    error: str
    created_at: str
    images: list[MessageImageOut]


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _own_chat(workspace_id: UUID, chat_id: UUID, user: User, db: AsyncSession) -> Chat:
    await get_workspace_for_user(workspace_id, user, db)
    chat = await db.get(Chat, chat_id)
    if chat is None or chat.workspace_id != workspace_id:
        raise HTTPException(404, "chat not found")
    return chat


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("", response_model=list[ChatSummary])
async def list_chats(
    workspace_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
    include_archived: bool = False,
):
    await get_workspace_for_user(workspace_id, user, db)

    # Aggregate per chat: count + last assistant message metadata.
    msg_count = func.count(Message.id).label("msg_count")
    last_model = func.max(Message.model_id).label("last_model")
    stmt = (
        select(Chat, msg_count, last_model)
        .outerjoin(Message, Message.chat_id == Chat.id)
        .where(Chat.workspace_id == workspace_id)
        .group_by(Chat.id)
        .order_by(desc(Chat.updated_at))
    )
    if not include_archived:
        stmt = stmt.where(Chat.archived_at.is_(None))
    rows = (await db.execute(stmt)).all()

    summaries: list[ChatSummary] = []
    for chat, count, last in rows:
        # Pick the most recent skill_snapshot name (cheap lookup; OK for v1)
        last_skill = (
            await db.execute(
                select(SkillSnapshot.name)
                .join(Message, Message.skill_snapshot_id == SkillSnapshot.id)
                .where(Message.chat_id == chat.id)
                .order_by(desc(Message.created_at))
                .limit(1)
            )
        ).scalar_one_or_none()
        summaries.append(ChatSummary(
            id=str(chat.id),
            title=chat.title or "Untitled",
            message_count=count or 0,
            last_model=last,
            last_skill=last_skill,
            archived=chat.archived_at is not None,
            created_at=chat.created_at.isoformat(),
            updated_at=chat.updated_at.isoformat(),
        ))
    return summaries


@router.post("", response_model=ChatSummary, status_code=201)
async def create_chat(
    workspace_id: UUID,
    payload: ChatCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    await get_workspace_for_user(workspace_id, user, db)
    chat = Chat(
        workspace_id=workspace_id,
        title=(payload.title or "Untitled").strip()[:200],
        created_by_user_id=user.id,
    )
    db.add(chat)
    await db.flush()
    return ChatSummary(
        id=str(chat.id), title=chat.title, message_count=0,
        last_model=None, last_skill=None, archived=False,
        created_at=chat.created_at.isoformat(),
        updated_at=chat.updated_at.isoformat(),
    )


@router.patch("/{chat_id}", response_model=ChatSummary)
async def patch_chat(
    workspace_id: UUID,
    chat_id: UUID,
    payload: ChatPatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    chat = await _own_chat(workspace_id, chat_id, user, db)
    if payload.title is not None:
        chat.title = payload.title.strip()[:200]
    if payload.archived is not None:
        chat.archived_at = datetime.now(timezone.utc) if payload.archived else None
    chat.updated_at = datetime.now(timezone.utc)
    await db.flush()
    return ChatSummary(
        id=str(chat.id), title=chat.title, message_count=0,
        last_model=None, last_skill=None, archived=chat.archived_at is not None,
        created_at=chat.created_at.isoformat(),
        updated_at=chat.updated_at.isoformat(),
    )


@router.delete("/{chat_id}", status_code=204)
async def delete_chat(
    workspace_id: UUID,
    chat_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    chat = await _own_chat(workspace_id, chat_id, user, db)
    await db.delete(chat)


@router.get("/{chat_id}/stats", response_model=ChatStats)
async def chat_stats(
    workspace_id: UUID,
    chat_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Token totals + estimated cost for one chat, à la Langfuse.

    Tokens live on assistant messages; we group by model so a mixed-model chat
    prices each turn at its own rate, then sum. Cost excludes models we don't
    have pricing for (Ollama/Bedrock) and flags that via `has_unpriced`.
    """
    await _own_chat(workspace_id, chat_id, user, db)

    rows = (
        await db.execute(
            select(
                Message.model_provider,
                Message.model_id,
                func.coalesce(func.sum(Message.prompt_tokens), 0),
                func.coalesce(func.sum(Message.completion_tokens), 0),
                func.count(Message.id),
            )
            .where(Message.chat_id == chat_id, Message.role == "assistant")
            .group_by(Message.model_provider, Message.model_id)
        )
    ).all()

    by_model: list[ChatModelStat] = []
    total_in = total_out = 0
    total_cost = 0.0
    has_unpriced = False
    for provider, model_id, in_tok, out_tok, count in rows:
        in_tok, out_tok = int(in_tok), int(out_tok)
        cost = estimate_cost(provider, model_id, in_tok, out_tok)
        total_in += in_tok
        total_out += out_tok
        if cost is None:
            has_unpriced = True
        else:
            total_cost += cost
        by_model.append(ChatModelStat(
            model_provider=provider,
            model_id=model_id,
            input_tokens=in_tok,
            output_tokens=out_tok,
            estimated_cost=cost,
            message_count=int(count),
        ))

    # Largest spenders first for a readable breakdown.
    by_model.sort(key=lambda m: (m.estimated_cost or 0, m.output_tokens), reverse=True)

    return ChatStats(
        chat_id=str(chat_id),
        total_input_tokens=total_in,
        total_output_tokens=total_out,
        estimated_cost=round(total_cost, 6),
        has_unpriced=has_unpriced,
        by_model=by_model,
    )


@router.get("/{chat_id}/messages", response_model=list[MessageOut])
async def list_messages(
    workspace_id: UUID,
    chat_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    await _own_chat(workspace_id, chat_id, user, db)

    messages = list((
        await db.execute(
            select(Message)
            .where(Message.chat_id == chat_id)
            .order_by(asc(Message.sequence_no))
        )
    ).scalars())

    if not messages:
        return []

    # Bulk-fetch all message_images + their image rows in one query each
    msg_ids = [m.id for m in messages]
    mi_rows = list((
        await db.execute(
            select(MessageImage, Image)
            .join(Image, Image.id == MessageImage.image_id)
            .where(MessageImage.message_id.in_(msg_ids))
            .order_by(asc(MessageImage.position))
        )
    ).all())

    # Bucket per-message + presign each unique image once
    by_msg: dict[UUID, list[MessageImageOut]] = {m.id: [] for m in messages}
    presign_cache: dict[UUID, str] = {}
    for mi, img in mi_rows:
        if img.id not in presign_cache:
            presign_cache[img.id] = await presigned_url(img.object_key)
        by_msg[mi.message_id].append(MessageImageOut(
            image_id=str(img.id),
            presigned_url=presign_cache[img.id],
            position=mi.position,
            annotations=list(mi.annotations_json or []),
            original_name=img.original_name,
            sha256=img.sha256,
        ))

    # Pull skill names for assistant messages with snapshots
    snap_ids = [m.skill_snapshot_id for m in messages if m.skill_snapshot_id]
    snap_names: dict[UUID, str] = {}
    if snap_ids:
        for s in (
            await db.execute(select(SkillSnapshot).where(SkillSnapshot.id.in_(snap_ids)))
        ).scalars():
            snap_names[s.id] = s.name

    return [
        MessageOut(
            id=str(m.id),
            chat_id=str(m.chat_id),
            sequence_no=m.sequence_no,
            role=m.role,
            content_md=m.content_md,
            thinking_md=m.thinking_md or "",
            thinking_effort=m.thinking_effort or "",
            model_provider=m.model_provider,
            model_id=m.model_id,
            skill_name=snap_names.get(m.skill_snapshot_id) if m.skill_snapshot_id else None,
            latency_ms=m.latency_ms,
            prompt_tokens=m.prompt_tokens,
            completion_tokens=m.completion_tokens,
            cost_usd=m.cost_usd,
            error=m.error,
            created_at=m.created_at.isoformat(),
            images=by_msg.get(m.id, []),
        )
        for m in messages
    ]
