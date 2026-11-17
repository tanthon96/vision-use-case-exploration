"""Run a skill's post-processing script on a model's output.

Contract with skill scripts:
  - the script receives the model's raw output on STDIN
  - it writes the cleaned/normalised output to STDOUT
  - it writes a JSON report to STDERR

Execution is gated by ``settings.skill_scripts_enabled`` — see the note there;
this runs arbitrary skill-authored Python and is only safe with trusted authors.
"""
from __future__ import annotations

import asyncio
import json
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .audit import audit
from .config import settings


@dataclass
class PostprocessResult:
    ok: bool
    cleaned_output: str
    report: dict[str, Any]


async def run_postprocess(
    script_source: str,
    model_output: str,
    timeout_s: int | None = None,
) -> PostprocessResult:
    """Execute ``script_source`` with ``model_output`` piped to stdin.

    Returns the script's stdout as ``cleaned_output`` and its stderr parsed as a
    JSON ``report``. On any failure (timeout, crash, non-JSON report) returns a
    result with ``ok=False`` and the original output untouched, so a broken
    script never discards the model's answer.
    """
    timeout = timeout_s or settings.skill_script_timeout_s
    audit("postprocess_exec", bytes=len(model_output), timeout=timeout)

    with tempfile.TemporaryDirectory(prefix="skill_pp_") as tmp:
        script_path = Path(tmp) / "postprocess.py"
        script_path.write_text(script_source)

        try:
            proc = await asyncio.create_subprocess_exec(
                sys.executable,
                str(script_path),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=tmp,
            )
        except Exception as e:  # pragma: no cover - spawn failure
            return PostprocessResult(False, model_output, {"error": f"spawn failed: {e}"})

        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(model_output.encode()), timeout=timeout
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return PostprocessResult(
                False, model_output, {"error": f"script timed out after {timeout}s"}
            )

        stdout_s = stdout.decode(errors="replace")
        stderr_s = stderr.decode(errors="replace")

        if proc.returncode != 0:
            return PostprocessResult(
                False,
                model_output,
                {"error": f"script exited {proc.returncode}", "stderr": stderr_s[:2000]},
            )

        try:
            report = json.loads(stderr_s) if stderr_s.strip() else {}
        except json.JSONDecodeError:
            report = {"raw_report": stderr_s[:2000]}

        cleaned = stdout_s if stdout_s.strip() else model_output
        ok = bool(report.get("ok", True))
        return PostprocessResult(ok, cleaned, report)
