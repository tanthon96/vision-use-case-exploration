"""Workspace-scoped skills CRUD against the `skills` table.

The bundled YAML files are seed source only — once a workspace is created,
its skills live in Postgres and can be freely edited.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, asc
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.auth import get_current_user
from ...core.database import get_session
from ...models import Skill, User
from .workspaces import get_workspace_for_user

router = APIRouter(prefix="/api/workspaces/{workspace_id}/skills", tags=["skills"])


class SkillOut(BaseModel):
    id: str
    workspace_id: str
    name: str
    description: str
    system_prompt: str
    task_template: str
    metrics: list[str]
    few_shot_examples: list[dict]
    references: list[dict]
    postprocess: dict
    created_at: str
    updated_at: str

    @classmethod
    def from_row(cls, s: Skill) -> "SkillOut":
        return cls(
            id=str(s.id),
            workspace_id=str(s.workspace_id),
            name=s.name,
            description=s.description,
            system_prompt=s.system_prompt,
            task_template=s.task_template,
            metrics=list(s.metrics_json or []),
            few_shot_examples=list(s.few_shot_examples_json or []),
            references=list(s.references_json or []),
            postprocess=dict(s.postprocess_json or {}),
            created_at=s.created_at.isoformat(),
            updated_at=s.updated_at.isoformat(),
        )


class SkillUpsert(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    system_prompt: str = ""
    task_template: str = "{{ user_instruction }}"
    metrics: list[str] = Field(default_factory=lambda: ["latency", "token_count"])
    few_shot_examples: list[dict] = Field(default_factory=list)
    # [{name, content}] docs composed into the prompt at run time.
    references: list[dict] = Field(default_factory=list)
    # {script_name, script_source} run on the model output after generation.
    postprocess: dict = Field(default_factory=dict)


@router.get("", response_model=list[SkillOut])
async def list_skills(
    workspace_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    await get_workspace_for_user(workspace_id, user, db)
    rows = list((
        await db.execute(
            select(Skill)
            .where(Skill.workspace_id == workspace_id, Skill.deleted_at.is_(None))
            .order_by(asc(Skill.name))
        )
    ).scalars())
    return [SkillOut.from_row(r) for r in rows]


@router.get("/{skill_id}", response_model=SkillOut)
async def get_skill(
    workspace_id: UUID,
    skill_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    await get_workspace_for_user(workspace_id, user, db)
    row = await db.get(Skill, skill_id)
    if row is None or row.workspace_id != workspace_id or row.deleted_at is not None:
        raise HTTPException(404, "skill not found")
    return SkillOut.from_row(row)


@router.post("", response_model=SkillOut, status_code=201)
async def create_skill(
    workspace_id: UUID,
    payload: SkillUpsert,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    await get_workspace_for_user(workspace_id, user, db)
    existing = (
        await db.execute(
            select(Skill.id).where(
                Skill.workspace_id == workspace_id,
                Skill.name == payload.name,
                Skill.deleted_at.is_(None),
            )
        )
    ).first()
    if existing:
        raise HTTPException(409, f"skill '{payload.name}' already exists")
    row = Skill(
        workspace_id=workspace_id,
        name=payload.name,
        description=payload.description,
        system_prompt=payload.system_prompt,
        task_template=payload.task_template,
        metrics_json=payload.metrics,
        few_shot_examples_json=payload.few_shot_examples,
        references_json=payload.references,
        postprocess_json=payload.postprocess,
    )
    db.add(row)
    await db.flush()
    return SkillOut.from_row(row)


@router.put("/{skill_id}", response_model=SkillOut)
async def update_skill(
    workspace_id: UUID,
    skill_id: UUID,
    payload: SkillUpsert,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    await get_workspace_for_user(workspace_id, user, db)
    row = await db.get(Skill, skill_id)
    if row is None or row.workspace_id != workspace_id or row.deleted_at is not None:
        raise HTTPException(404, "skill not found")
    row.name = payload.name
    row.description = payload.description
    row.system_prompt = payload.system_prompt
    row.task_template = payload.task_template
    row.metrics_json = payload.metrics
    row.few_shot_examples_json = payload.few_shot_examples
    row.references_json = payload.references
    row.postprocess_json = payload.postprocess
    row.updated_at = datetime.now(timezone.utc)
    await db.flush()
    return SkillOut.from_row(row)


@router.delete("/{skill_id}", status_code=204)
async def delete_skill(
    workspace_id: UUID,
    skill_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    await get_workspace_for_user(workspace_id, user, db)
    row = await db.get(Skill, skill_id)
    if row is None or row.workspace_id != workspace_id:
        raise HTTPException(404, "skill not found")
    # Soft-delete so existing skill_snapshots stay readable.
    row.deleted_at = datetime.now(timezone.utc)
