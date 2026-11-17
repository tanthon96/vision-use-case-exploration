from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
import csv
import io

from ...core.database import get_session, Run, Result

router = APIRouter(prefix="/api/results", tags=["results"])


@router.get("")
async def query_results(
    provider: str | None = Query(None),
    skill: str | None = Query(None),
    limit: int = Query(50, le=500),
    db: AsyncSession = Depends(get_session),
):
    stmt = (
        select(Run, Result)
        .join(Result, Run.id == Result.run_id)
        .order_by(desc(Result.created_at))
        .limit(limit)
    )
    if provider:
        stmt = stmt.where(Run.model_provider == provider)
    if skill:
        stmt = stmt.where(Run.skill_name == skill)

    rows = (await db.execute(stmt)).all()

    return [
        {
            "run_id": run.id,
            "provider": run.model_provider,
            "model": run.model_name,
            "skill": run.skill_name,
            "image_name": result.image_name,
            "response": result.response_text,
            "latency_ms": result.latency_ms,
            "prompt_tokens": result.prompt_tokens,
            "completion_tokens": result.completion_tokens,
            "cost_usd": result.cost_usd,
            "error": result.error,
            "created_at": result.created_at.isoformat(),
        }
        for run, result in rows
    ]


@router.get("/export.csv")
async def export_csv(db: AsyncSession = Depends(get_session)):
    rows = await query_results(db=db, limit=500)

    buf = io.StringIO()
    if rows:
        writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=benchmark_results.csv"},
    )
