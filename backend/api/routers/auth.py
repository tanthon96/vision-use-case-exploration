"""Authentication endpoints — login, logout, me, invite, accept-invite."""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.auth import (
    attach_cookie, clear_cookie,
    create_session, destroy_session,
    get_current_user, require_admin,
    hash_password, verify_password,
)
from ...core.config import settings
from ...core.database import get_session
from ...models import Invite, User

router = APIRouter(prefix="/api/auth", tags=["auth"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class LoginPayload(BaseModel):
    # str (not EmailStr) so non-FQDN dev emails like 'admin@local' work too.
    email: str
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    display_name: str
    is_admin: bool

    @classmethod
    def from_user(cls, u: User) -> "UserOut":
        return cls(
            id=str(u.id),
            email=u.email,
            display_name=u.display_name,
            is_admin=u.is_admin,
        )


class InviteRequest(BaseModel):
    email: EmailStr
    expires_in_hours: int = 168     # 7 days default


class InviteOut(BaseModel):
    email: str
    token: str
    expires_at: str
    accept_url: str


class AcceptInvitePayload(BaseModel):
    token: str
    password: str
    display_name: str = ""


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/login", response_model=UserOut)
async def login(
    payload: LoginPayload,
    response: Response,
    request: Request,
    db: AsyncSession = Depends(get_session),
):
    user = (
        await db.execute(
            select(User).where(User.email == payload.email.lower().strip())
        )
    ).scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.password_hash):
        # Constant-ish error to avoid email enumeration
        raise HTTPException(status_code=401, detail="invalid email or password")

    user.last_login_at = datetime.now(timezone.utc)
    signed = await create_session(db, user=user, user_agent=request.headers.get("user-agent", ""))
    attach_cookie(response, signed)
    return UserOut.from_user(user)


@router.post("/logout", status_code=204)
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_session),
):
    # Best-effort: delete the server session if cookie is valid, then clear it.
    from itsdangerous import BadSignature
    from uuid import UUID
    from ...core.auth import _signer  # type: ignore[attr-defined]
    raw = request.cookies.get(settings.session_cookie_name)
    if raw:
        try:
            sid = UUID(_signer.loads(raw))
            await destroy_session(db, sid)
        except (BadSignature, ValueError):
            pass
    clear_cookie(response)


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return UserOut.from_user(user)


# ── Invites (admin only) ─────────────────────────────────────────────────────

@router.post("/invite", response_model=InviteOut)
async def create_invite(
    payload: InviteRequest,
    request: Request,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    # Prevent inviting an existing user
    existing = (
        await db.execute(select(User.id).where(User.email == payload.email.lower().strip()))
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="user with that email already exists")

    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=payload.expires_in_hours)
    invite = Invite(
        email=payload.email.lower().strip(),
        token=token,
        invited_by_user_id=admin.id,
        expires_at=expires_at,
    )
    db.add(invite)
    await db.flush()

    # Build a user-facing accept URL using the request's origin.
    base = str(request.base_url).rstrip("/")
    return InviteOut(
        email=invite.email,
        token=token,
        expires_at=expires_at.isoformat(),
        accept_url=f"{base}/accept-invite?token={token}",
    )


@router.post("/accept-invite", response_model=UserOut)
async def accept_invite(
    payload: AcceptInvitePayload,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_session),
):
    invite = (
        await db.execute(select(Invite).where(Invite.token == payload.token))
    ).scalar_one_or_none()
    if invite is None:
        raise HTTPException(status_code=404, detail="invite not found")
    if invite.accepted_at is not None:
        raise HTTPException(status_code=410, detail="invite already used")
    if invite.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="invite expired")
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="password must be at least 8 characters")

    # Race: ensure email still doesn't have a user.
    existing = (
        await db.execute(select(User.id).where(User.email == invite.email))
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="user already exists")

    user = User(
        email=invite.email,
        password_hash=hash_password(payload.password),
        display_name=payload.display_name or invite.email.split("@")[0],
        is_admin=False,
    )
    db.add(user)
    invite.accepted_at = datetime.now(timezone.utc)
    await db.flush()

    signed = await create_session(
        db, user=user, user_agent=request.headers.get("user-agent", "")
    )
    attach_cookie(response, signed)
    return UserOut.from_user(user)
