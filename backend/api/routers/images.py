"""Image upload + library.

Upload flow:
  1. Multipart POST to /api/workspaces/{ws_id}/images
  2. We compute sha256 of the bytes
  3. If (workspace_id, sha256) row exists → return existing image_id (dedupe)
  4. Else stream bytes to S3 at workspaces/{ws_id}/images/aa/bb/<sha>.ext,
     insert images row, return id + presigned read URL
"""

from __future__ import annotations

import hashlib
import io
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from PIL import Image as PILImage
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.auth import get_current_user
from ...core.database import get_session
from ...core.storage import object_key, put_image, presigned_url
from ...models import Image, User
from .workspaces import get_workspace_for_user

router = APIRouter(prefix="/api/workspaces/{workspace_id}/images", tags=["images"])

ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"}
MAX_BYTES = 20 * 1024 * 1024  # 20 MB per image


class ImageOut(BaseModel):
    id: str
    original_name: str
    mime_type: str
    sha256: str
    width: int | None
    height: int | None
    size_bytes: int
    source: str
    presigned_url: str
    deduped: bool = False


def _row_to_out(row: Image, presigned: str, deduped: bool = False) -> ImageOut:
    return ImageOut(
        id=str(row.id),
        original_name=row.original_name,
        mime_type=row.mime_type,
        sha256=row.sha256,
        width=row.width,
        height=row.height,
        size_bytes=row.size_bytes,
        source=row.source,
        presigned_url=presigned,
        deduped=deduped,
    )


@router.get("", response_model=list[ImageOut])
async def list_workspace_images(
    workspace_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
    limit: int = 100,
):
    await get_workspace_for_user(workspace_id, user, db)
    rows = list((
        await db.execute(
            select(Image)
            .where(Image.workspace_id == workspace_id)
            .order_by(desc(Image.created_at))
            .limit(limit)
        )
    ).scalars())
    out: list[ImageOut] = []
    for row in rows:
        url = await presigned_url(row.object_key)
        out.append(_row_to_out(row, url))
    return out


@router.post("", response_model=ImageOut, status_code=201)
async def upload_image(
    workspace_id: UUID,
    file: UploadFile = File(...),
    source: str = "upload",
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    await get_workspace_for_user(workspace_id, user, db)

    # Sanity checks
    mime = file.content_type or "application/octet-stream"
    if mime not in ALLOWED_MIME:
        raise HTTPException(415, f"unsupported media type: {mime}")
    if source not in ("upload", "webcam", "screen"):
        raise HTTPException(400, "invalid source")

    raw = await file.read()
    if len(raw) == 0:
        raise HTTPException(400, "empty file")
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, f"file too large (max {MAX_BYTES // 1024 // 1024} MB)")

    sha = hashlib.sha256(raw).hexdigest()

    # Dedupe by content
    existing = (
        await db.execute(
            select(Image).where(
                Image.workspace_id == workspace_id,
                Image.sha256 == sha,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        url = await presigned_url(existing.object_key)
        return _row_to_out(existing, url, deduped=True)

    # Probe dimensions cheaply
    width = height = None
    try:
        with PILImage.open(io.BytesIO(raw)) as img:
            width, height = img.size
    except Exception:
        pass  # Don't fail upload just because PIL can't read it

    key = object_key(workspace_id, sha, mime)
    await put_image(key=key, data=raw, mime_type=mime)

    row = Image(
        workspace_id=workspace_id,
        object_key=key,
        original_name=(file.filename or "")[:256],
        mime_type=mime,
        sha256=sha,
        width=width,
        height=height,
        size_bytes=len(raw),
        source=source,
        created_by_user_id=user.id,
    )
    db.add(row)
    await db.flush()
    url = await presigned_url(row.object_key)
    return _row_to_out(row, url)


@router.get("/{image_id}", response_model=ImageOut)
async def get_image(
    workspace_id: UUID,
    image_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    await get_workspace_for_user(workspace_id, user, db)
    row = await db.get(Image, image_id)
    if row is None or row.workspace_id != workspace_id:
        raise HTTPException(404, "image not found")
    url = await presigned_url(row.object_key)
    return _row_to_out(row, url)


@router.delete("/{image_id}", status_code=204)
async def delete_image(
    workspace_id: UUID,
    image_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    await get_workspace_for_user(workspace_id, user, db)
    row = await db.get(Image, image_id)
    if row is None or row.workspace_id != workspace_id:
        raise HTTPException(404, "image not found")
    # NOTE: we leave the S3 object in place — future cleanup script can sweep
    # orphaned content-addressed keys whose row no longer exists.
    await db.delete(row)
