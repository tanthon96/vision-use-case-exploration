"""Generic workspace files — list / create / delete + a presigned download URL.

Distinct from images (which are content-addressed and rendered on the canvas).
Used for model-generated artifacts like CSVs.
"""
from __future__ import annotations

from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.auth import get_current_user
from ...core.database import get_session
from ...core.storage import file_object_key, put_file, presigned_url
from ...models import User, WorkspaceFile
from .workspaces import get_workspace_for_user

router = APIRouter(prefix="/api/workspaces/{workspace_id}/files", tags=["files"])

MAX_BYTES = 10 * 1024 * 1024  # 10 MB per file


class FileOut(BaseModel):
    id: str
    name: str
    mime_type: str
    size_bytes: int
    source: str
    presigned_url: str
    created_at: str


async def _to_out(row: WorkspaceFile) -> FileOut:
    return FileOut(
        id=str(row.id),
        name=row.name,
        mime_type=row.mime_type,
        size_bytes=row.size_bytes,
        source=row.source,
        presigned_url=await presigned_url(row.object_key),
        created_at=row.created_at.isoformat(),
    )


class FileCreate(BaseModel):
    name: str = Field(min_length=1, max_length=256)
    content: str
    mime_type: str = "text/csv"
    source: str = "upload"


@router.get("", response_model=list[FileOut])
async def list_files(
    workspace_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    await get_workspace_for_user(workspace_id, user, db)
    rows = list((
        await db.execute(
            select(WorkspaceFile)
            .where(WorkspaceFile.workspace_id == workspace_id)
            .order_by(desc(WorkspaceFile.created_at))
        )
    ).scalars())
    return [await _to_out(r) for r in rows]


@router.post("", response_model=FileOut, status_code=201)
async def create_file(
    workspace_id: UUID,
    payload: FileCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    await get_workspace_for_user(workspace_id, user, db)
    data = payload.content.encode("utf-8")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, f"file too large (max {MAX_BYTES // 1024 // 1024} MB)")

    file_id = uuid4()
    key = file_object_key(workspace_id, file_id, payload.name)
    await put_file(key=key, data=data, mime_type=payload.mime_type)

    row = WorkspaceFile(
        id=file_id,
        workspace_id=workspace_id,
        name=payload.name,
        mime_type=payload.mime_type,
        size_bytes=len(data),
        object_key=key,
        source=payload.source if payload.source in ("model", "upload") else "upload",
    )
    db.add(row)
    await db.flush()
    return await _to_out(row)


@router.delete("/{file_id}", status_code=204)
async def delete_file(
    workspace_id: UUID,
    file_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    await get_workspace_for_user(workspace_id, user, db)
    row = await db.get(WorkspaceFile, file_id)
    if row is None or row.workspace_id != workspace_id:
        raise HTTPException(404, "file not found")
    # Leave the S3 object (matches images); a sweep can reclaim orphans later.
    await db.delete(row)
