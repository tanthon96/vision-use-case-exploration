"""Audit logging to stdout.

Emits one structured line per event so the chat pipeline can be audited from
stdout (e.g. `docker logs … | grep 'audit event=run_start'`). Model invocations
and post-processing scripts are the app's "tool calls"; those plus the final
chat response are logged.

The logger gets its own stdout handler (the root logger's basicConfig in
main.py defaults to stderr), and `propagate=False` so lines aren't duplicated.
"""
from __future__ import annotations

import logging
import sys
from typing import Any

_logger = logging.getLogger("vlm.audit")
if not _logger.handlers:
    _handler = logging.StreamHandler(sys.stdout)
    _handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    _logger.addHandler(_handler)
    _logger.setLevel(logging.INFO)
    _logger.propagate = False


def _fmt(value: Any) -> str:
    """Render a field value: quote strings with spaces, collapse newlines."""
    s = str(value).replace("\n", "\\n").replace("\r", "")
    if any(c.isspace() for c in s) or "=" in s:
        s = s.replace('"', "'")
        return f'"{s}"'
    return s


def _truncate(text: str, limit: int = 500) -> str:
    text = text or ""
    return text if len(text) <= limit else f"{text[:limit]}…(+{len(text) - limit})"


def audit(event: str, **fields: Any) -> None:
    """Log a single audit record: `audit event=<event> k=v k=v …`."""
    parts = [f"audit event={event}"]
    parts += [f"{k}={_fmt(v)}" for k, v in fields.items() if v is not None]
    _logger.info(" ".join(parts))
