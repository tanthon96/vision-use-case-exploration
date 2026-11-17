"""Seed the bundled YAML skills into a fresh workspace.

Run once per workspace at creation time. Idempotent — duplicates are skipped.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.skills_loader import list_skills
from ..models import Skill, Workspace


async def seed_workspace_skills(db: AsyncSession, workspace_id: UUID) -> int:
    """Insert built-in skills as rows. Returns count actually inserted.

    Uses the shared loader so both flat `*.yaml` and directory `SKILL.md`
    bundles (with references + a post-processing script) seed identically.
    """
    existing = {
        row.name: row
        for row in (
            await db.execute(select(Skill).where(Skill.workspace_id == workspace_id))
        ).scalars()
    }

    inserted = 0
    for data in list_skills():
        name = data.get("name")
        if not name:
            continue
        row = existing.get(name)
        if row is None:
            db.add(Skill(
                workspace_id=workspace_id,
                name=name,
                description=data.get("description", ""),
                system_prompt=data.get("system_prompt", ""),
                task_template=data.get("task_template", "{{ user_instruction }}"),
                metrics_json=data.get("metrics", ["latency", "token_count"]),
                few_shot_examples_json=data.get("few_shot_examples", []),
                references_json=data.get("references", []),
                postprocess_json=data.get("postprocess", {}),
            ))
            inserted += 1
        elif not (row.references_json or row.postprocess_json):
            # Existing bundled skill that predates the bundle columns: fill the
            # two new fields only when both are empty, so no user edit is clobbered.
            row.references_json = data.get("references", [])
            row.postprocess_json = data.get("postprocess", {})

    if inserted:
        await db.flush()
    return inserted


async def backfill_all_workspaces(db: AsyncSession) -> int:
    """Seed newly-added bundled skills into every existing workspace, and fill
    the reference/post-process fields on bundled skills that predate them.

    seed_workspace_skills inserts skills a workspace is missing and refreshes the
    two bundle columns when they're empty; it may also update existing rows, so
    we always commit. Returns total rows inserted.
    """
    workspace_ids = [
        row[0] for row in (await db.execute(select(Workspace.id))).all()
    ]
    total = 0
    for ws_id in workspace_ids:
        total += await seed_workspace_skills(db, ws_id)
    # Commit unconditionally: seed_workspace_skills can dirty rows (bundle-field
    # refresh) without inserting, and those updates must be persisted too.
    await db.commit()
    return total
