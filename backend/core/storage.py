"""S3-compatible object storage helpers (works with MinIO, AWS S3, R2, etc.).

The backend stores image bytes here, never in Postgres. Object keys are
content-addressed so retries and duplicate uploads coalesce naturally.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator
from uuid import UUID

import aioboto3
from botocore.config import Config as BotoConfig

from .config import settings

_MIME_TO_EXT = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/bmp": "bmp",
}


def object_key(workspace_id: UUID, sha256: str, mime_type: str) -> str:
    """Content-addressed key. The same image content always lands at the
    same key, so duplicate uploads (e.g. retry after a network blip) are
    idempotent at the storage layer too."""
    ext = _MIME_TO_EXT.get(mime_type, "bin")
    # /aa/bb/<full-hash>.ext — split prevents huge flat directories.
    return f"workspaces/{workspace_id}/images/{sha256[:2]}/{sha256[2:4]}/{sha256}.{ext}"


def file_object_key(workspace_id: UUID, file_id: UUID, name: str) -> str:
    """Key for a generic workspace file. Not content-addressed (files with the
    same name/content are distinct records), so we namespace by file id."""
    return f"workspaces/{workspace_id}/files/{file_id}/{name}"


_session = aioboto3.Session()


def _client_kwargs(public: bool = False) -> dict:
    return dict(
        service_name="s3",
        endpoint_url=settings.s3_public_endpoint_url if public else settings.s3_endpoint_url,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
        config=BotoConfig(signature_version="s3v4"),
    )


@asynccontextmanager
async def s3_client(public: bool = False):
    """Yields an aioboto3 S3 client. `public=True` uses the BROWSER-facing
    endpoint (so presigned URLs work from the user's browser, not the
    internal docker network hostname)."""
    async with _session.client(**_client_kwargs(public=public)) as client:
        yield client


async def put_image(*, key: str, data: bytes, mime_type: str) -> None:
    """Idempotent put — overwriting a content-addressed key with identical
    bytes is a no-op as far as users are concerned."""
    async with s3_client() as s3:
        await s3.put_object(
            Bucket=settings.s3_bucket,
            Key=key,
            Body=data,
            ContentType=mime_type,
        )


# Files store arbitrary bytes the same way images do — the helper is generic.
put_file = put_image


async def get_image_bytes(key: str) -> bytes:
    async with s3_client() as s3:
        resp = await s3.get_object(Bucket=settings.s3_bucket, Key=key)
        async with resp["Body"] as stream:
            return await stream.read()


async def presigned_url(key: str, expires: int = 3600) -> str:
    """Browser-usable temporary read URL."""
    async with s3_client(public=True) as s3:
        return await s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.s3_bucket, "Key": key},
            ExpiresIn=expires,
        )


async def ensure_bucket() -> None:
    """Idempotent. Used by the boot lifespan and by tests."""
    async with s3_client() as s3:
        try:
            await s3.head_bucket(Bucket=settings.s3_bucket)
        except Exception:
            await s3.create_bucket(Bucket=settings.s3_bucket)


async def iter_objects(prefix: str = "") -> AsyncIterator[dict]:
    """Lightweight pagination — yields each object's metadata dict."""
    async with s3_client() as s3:
        paginator = s3.get_paginator("list_objects_v2")
        async for page in paginator.paginate(Bucket=settings.s3_bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                yield obj
