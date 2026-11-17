from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── Provider keys ────────────────────────────────────────────────────────
    anthropic_api_key: str = ""
    google_api_key: str = ""
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_default_region: str = "us-east-1"
    ollama_base_url: str = "http://localhost:11434"

    # ── Database ─────────────────────────────────────────────────────────────
    database_url: str = "postgresql+asyncpg://vlm:vlm@localhost:5432/vlm"

    # ── Object storage (S3-compatible) ───────────────────────────────────────
    s3_endpoint_url: str = "http://localhost:9000"
    s3_bucket: str = "vlm-benchmark"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_region: str = "us-east-1"
    # URL the browser uses for presigned image reads; in prod this is the
    # CDN/virtual-host bucket URL, in dev it's localhost:9000.
    s3_public_endpoint_url: str = "http://localhost:9000"

    # ── Auth ─────────────────────────────────────────────────────────────────
    session_secret: str = "change-me"
    session_cookie_name: str = "vlm_session"
    session_lifetime_hours: int = 720
    admin_email: str = ""
    admin_password: str = ""
    # When True, the login page is skipped and every authed endpoint runs as
    # the first user in the DB (the admin if seeded). Useful for local dev or
    # solo deployments where wiring real auth is unnecessary. NEVER set this
    # in a multi-tenant or internet-exposed deployment.
    auth_disabled: bool = False

    # ── App ──────────────────────────────────────────────────────────────────
    skills_dir: Path = Path("./skills")
    # User-authored skills written at runtime (persists via mounted volume).
    user_skills_dir: Path = Path("./data/skills")
    log_level: str = "INFO"
    # When True, a skill's post-processing script runs on the model output after
    # generation. This executes arbitrary Python authored in the skill, so it is
    # opt-in and safe only where skill authors are trusted (local/solo, like
    # auth_disabled). NEVER enable in a multi-tenant or internet-exposed deployment.
    skill_scripts_enabled: bool = False
    # Wall-clock seconds a post-processing script may run before being killed.
    skill_script_timeout_s: int = 10


settings = Settings()
