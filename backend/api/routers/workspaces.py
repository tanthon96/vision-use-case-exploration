"""Workspace CRUD. On first call, auto-creates a 'Default' workspace and
seeds bundled skills into it.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.auth import get_current_user
from ...core.database import get_session
from ...models import User, Workspace
from ...seed.skills import seed_workspace_skills

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class WorkspaceOut(BaseModel):
    id: str
    name: str
    description: str
    owner_user_id: str
    created_at: str
    updated_at: str

    @classmethod
    def from_row(cls, w: Workspace) -> "WorkspaceOut":
        return cls(
            id=str(w.id),
            name=w.name,
            description=w.description,
            owner_user_id=str(w.owner_user_id),
            created_at=w.created_at.isoformat(),
            updated_at=w.updated_at.isoformat(),
        )


class WorkspaceCreate(BaseModel):
    name: str
    description: str = ""


class WorkspaceUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _user_workspaces(db: AsyncSession, user_id: UUID) -> list[Workspace]:
    return list((
        await db.execute(
            select(Workspace)
            .where(Workspace.owner_user_id == user_id)
            .order_by(desc(Workspace.updated_at))
        )
    ).scalars())


async def ensure_default_workspace(db: AsyncSession, user: User) -> Workspace:
    rows = await _user_workspaces(db, user.id)
    if rows:
        return rows[0]
    workspace = Workspace(owner_user_id=user.id, name="Default", description="")
    db.add(workspace)
    await db.flush()
    await seed_workspace_skills(db, workspace.id)
    await db.commit()
    return workspace


async def get_workspace_for_user(
    workspace_id: UUID, user: User, db: AsyncSession
) -> Workspace:
    w = await db.get(Workspace, workspace_id)
    if w is None or w.owner_user_id != user.id:
        raise HTTPException(status_code=404, detail="workspace not found")
    return w


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("", response_model=list[WorkspaceOut])
async def list_workspaces(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    # Auto-create the default workspace on first call so the UI always has one.
    await ensure_default_workspace(db, user)
    rows = await _user_workspaces(db, user.id)
    return [WorkspaceOut.from_row(w) for w in rows]


@router.get("/current", response_model=WorkspaceOut)
async def current_workspace(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Returns the most recently updated workspace, creating Default if needed."""
    workspace = await ensure_default_workspace(db, user)
    return WorkspaceOut.from_row(workspace)


@router.post("", response_model=WorkspaceOut, status_code=201)
async def create_workspace(
    payload: WorkspaceCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    if not payload.name.strip():
        raise HTTPException(400, "name is required")
    workspace = Workspace(
        owner_user_id=user.id,
        name=payload.name.strip(),
        description=payload.description,
    )
    db.add(workspace)
    await db.flush()
    await seed_workspace_skills(db, workspace.id)
    return WorkspaceOut.from_row(workspace)


@router.patch("/{workspace_id}", response_model=WorkspaceOut)
async def update_workspace(
    workspace_id: UUID,
    payload: WorkspaceUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    workspace = await get_workspace_for_user(workspace_id, user, db)
    if payload.name is not None:
        workspace.name = payload.name.strip()
    if payload.description is not None:
        workspace.description = payload.description
    workspace.updated_at = datetime.now(timezone.utc)
    await db.flush()
    return WorkspaceOut.from_row(workspace)


@router.delete("/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace(
    workspace_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    workspace = await get_workspace_for_user(workspace_id, user, db)
    # Guard: refuse to delete the user's last workspace.
    rows = await _user_workspaces(db, user.id)
    if len(rows) <= 1:
        raise HTTPException(409, "cannot delete your only workspace")
    await db.delete(workspace)
