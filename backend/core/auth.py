"""Argon2 password hashing + opaque server-side sessions signed in a cookie.

We store a Session row server-side and put only the signed session id in the
cookie. This gives us: (a) instant revocation by deleting the row, (b) no PII
in the cookie, (c) a place to hang user_agent and expires_at.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated
from uuid import UUID

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError
from fastapi import Cookie, Depends, HTTPException, Request, Response, status
from itsdangerous import BadSignature, URLSafeSerializer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .database import get_session
from ..models import Session as SessionModel, User


_hasher = PasswordHasher()
_signer = URLSafeSerializer(settings.session_secret, salt="vlm-session")


# ── Passwords ────────────────────────────────────────────────────────────────

def hash_password(plain: str) -> str:
    return _hasher.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _hasher.verify(hashed, plain)
    except (VerifyMismatchError, InvalidHashError):
        return False


# ── Session lifecycle ────────────────────────────────────────────────────────

async def create_session(db: AsyncSession, *, user: User, user_agent: str = "") -> str:
    """Insert a session row, return the signed cookie value."""
    expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.session_lifetime_hours)
    session = SessionModel(
        user_id=user.id,
        expires_at=expires_at,
        user_agent=user_agent[:512],
    )
    db.add(session)
    await db.flush()  # populate session.id
    return _signer.dumps(str(session.id))


def attach_cookie(response: Response, signed_value: str) -> None:
    response.set_cookie(
        key=settings.session_cookie_name,
        value=signed_value,
        httponly=True,
        secure=False,         # set to True behind HTTPS in prod
        samesite="lax",
        max_age=settings.session_lifetime_hours * 3600,
        path="/",
    )


def clear_cookie(response: Response) -> None:
    response.delete_cookie(settings.session_cookie_name, path="/")


async def destroy_session(db: AsyncSession, session_id: UUID) -> None:
    s = await db.get(SessionModel, session_id)
    if s is not None:
        await db.delete(s)


# ── Request → user dependency ────────────────────────────────────────────────

CookieValue = Annotated[str | None, Cookie(alias=settings.session_cookie_name)]


async def _user_from_cookie(
    cookie: str | None,
    db: AsyncSession,
) -> User | None:
    if not cookie:
        return None
    try:
        session_id = UUID(_signer.loads(cookie))
    except (BadSignature, ValueError):
        return None

    session = await db.get(SessionModel, session_id)
    if session is None:
        return None
    if session.expires_at < datetime.now(timezone.utc):
        await db.delete(session)
        return None

    return await db.get(User, session.user_id)


async def _bypass_user(db: AsyncSession) -> User | None:
    """When AUTH_DISABLED is set, dependencies resolve to the admin user (or
    the first user if no admin exists)."""
    from sqlalchemy import select
    admin = (await db.execute(
        select(User).where(User.is_admin.is_(True)).limit(1)
    )).scalar_one_or_none()
    if admin is not None:
        return admin
    return (await db.execute(select(User).limit(1))).scalar_one_or_none()


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_session),
) -> User:
    """FastAPI dep — raises 401 if no valid session.

    Honors `AUTH_DISABLED=true` for solo/dev deployments by returning the
    admin user without checking the session cookie.
    """
    if settings.auth_disabled:
        user = await _bypass_user(db)
        if user is None:
            raise HTTPException(
                status_code=503,
                detail="AUTH_DISABLED is set but no user exists yet — set ADMIN_EMAIL/ADMIN_PASSWORD and restart",
            )
        return user

    cookie = request.cookies.get(settings.session_cookie_name)
    user = await _user_from_cookie(cookie, db)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="not authenticated")
    return user


async def get_current_user_optional(
    request: Request,
    db: AsyncSession = Depends(get_session),
) -> User | None:
    if settings.auth_disabled:
        return await _bypass_user(db)
    cookie = request.cookies.get(settings.session_cookie_name)
    return await _user_from_cookie(cookie, db)


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin only")
    return user


# ── Admin bootstrap ──────────────────────────────────────────────────────────

async def seed_admin_if_empty(db: AsyncSession) -> None:
    """Called from the app lifespan. If no users exist and ADMIN_* env vars
    are set, create the admin. Otherwise no-op."""
    if not settings.admin_email or not settings.admin_password:
        return
    has_users = (await db.execute(select(User.id).limit(1))).first()
    if has_users:
        return
    admin = User(
        email=settings.admin_email.lower().strip(),
        password_hash=hash_password(settings.admin_password),
        display_name="Admin",
        is_admin=True,
    )
    db.add(admin)
    await db.commit()
