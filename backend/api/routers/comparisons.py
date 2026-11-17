"""Comparison endpoint — hydrate N messages by id for the side-by-side view.

This is the "across time / models / skills" lens: you pick 2-4 saved messages
(possibly from different chats) and we return them with their images and skill
snapshots resolved so the UI can render them in columns.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.auth import get_current_user
from ...core.database import get_session
from ...core.storage import presigned_url
from ...models import (
    Chat, Image, Message, MessageImage, SkillSnapshot, User, Workspace,
)

router = APIRouter(prefix="/api/comparisons", tags=["comparisons"])


class ImageRef(BaseModel):
    image_id: str
    presigned_url: str
    annotations: list
    original_name: str
    sha256: str


class ComparisonItem(BaseModel):
    message_id: str
    chat_id: str
    chat_title: str
    workspace_id: str
    role: str
    content_md: str
    model_provider: str | None
    model_id: str | None
    skill_name: str | None
    skill_system_prompt: str | None
    skill_task_template: str | None
    latency_ms: float | None
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float
    error: str
    created_at: str
    images: list[ImageRef]


@router.get("", response_model=list[ComparisonItem])
async def compare_messages(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
    message_ids: Annotated[list[UUID], Query(min_length=1, max_length=8)] = [],
):
    """Return N messages with their image refs + skill snapshots hydrated.

    Only messages from workspaces owned by the requesting user are returned.
    Order matches the input `message_ids` order so the UI columns stay stable.
    """
    if not message_ids:
        raise HTTPException(400, "no message_ids provided")

    # Fetch messages + parent chat + workspace in one shot, then filter to
    # workspaces this user actually owns.
    rows = list((
        await db.execute(
            select(Message, Chat, Workspace)
            .join(Chat, Chat.id == Message.chat_id)
            .join(Workspace, Workspace.id == Chat.workspace_id)
            .where(
                Message.id.in_(message_ids),
                Workspace.owner_user_id == user.id,
            )
        )
    ).all())
    by_id = {m.id: (m, c, w) for m, c, w in rows}

    if len(by_id) != len(message_ids):
        # Don't leak which specific id failed — could be missing OR not owned.
        raise HTTPException(404, "one or more messages not found")

    # Snapshot lookup
    snap_ids = [m.skill_snapshot_id for m, _, _ in rows if m.skill_snapshot_id]
    snaps: dict[UUID, SkillSnapshot] = {}
    if snap_ids:
        for s in (
            await db.execute(select(SkillSnapshot).where(SkillSnapshot.id.in_(snap_ids)))
        ).scalars():
            snaps[s.id] = s

    # All message_images rows for the requested set
    mi_rows = list((
        await db.execute(
            select(MessageImage, Image)
            .join(Image, Image.id == MessageImage.image_id)
            .where(MessageImage.message_id.in_([m.id for m, _, _ in rows]))
            .order_by(MessageImage.position)
        )
    ).all())
    by_msg: dict[UUID, list[tuple[MessageImage, Image]]] = {m.id: [] for m, _, _ in rows}
    presign_cache: dict[UUID, str] = {}
    for mi, img in mi_rows:
        by_msg[mi.message_id].append((mi, img))
        if img.id not in presign_cache:
            presign_cache[img.id] = await presigned_url(img.object_key)

    # Build response in REQUEST ORDER (preserve the user's intent for columns).
    out: list[ComparisonItem] = []
    for mid in message_ids:
        m, c, w = by_id[mid]
        snap = snaps.get(m.skill_snapshot_id) if m.skill_snapshot_id else None
        out.append(ComparisonItem(
            message_id=str(m.id),
            chat_id=str(c.id),
            chat_title=c.title or "Untitled",
            workspace_id=str(w.id),
            role=m.role,
            content_md=m.content_md,
            model_provider=m.model_provider,
            model_id=m.model_id,
            skill_name=snap.name if snap else None,
            skill_system_prompt=snap.system_prompt if snap else None,
            skill_task_template=snap.task_template if snap else None,
            latency_ms=m.latency_ms,
            prompt_tokens=m.prompt_tokens,
            completion_tokens=m.completion_tokens,
            cost_usd=m.cost_usd,
            error=m.error,
            created_at=m.created_at.isoformat(),
            images=[
                ImageRef(
                    image_id=str(img.id),
                    presigned_url=presign_cache[img.id],
                    annotations=list(mi.annotations_json or []),
                    original_name=img.original_name,
                    sha256=img.sha256,
                )
                for mi, img in by_msg.get(m.id, [])
            ],
        ))
    return out
