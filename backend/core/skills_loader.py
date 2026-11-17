from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

import yaml

from .config import settings


def _load_yaml(path: Path) -> dict[str, Any]:
    with open(path, "r") as f:
        return yaml.safe_load(f) or {}


def _split_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    """Split a SKILL.md into (frontmatter dict, markdown body).

    Frontmatter is a leading YAML block delimited by lines of `---`. If absent,
    the whole file is treated as the body.
    """
    if text.startswith("---"):
        # Drop the opening `---` line, then split on the closing `---` line.
        after_open = text[3:].lstrip("\n")
        fm_str, sep, body = after_open.partition("\n---")
        if sep:
            fm = yaml.safe_load(fm_str) or {}
            # `body` still holds the remainder of the closing `---` line; drop it.
            body = body.split("\n", 1)[1] if "\n" in body else ""
            return fm, body.lstrip("\n")
    return {}, text


def _load_skill_md(md_path: Path) -> dict[str, Any]:
    """Load a directory-based skill bundle whose entrypoint is SKILL.md.

    The markdown body becomes `system_prompt`. Files listed under `references`
    are read into `[{name, content}]`. A `postprocess.script` (relative path)
    is read into `{script_name, script_source}` so it travels with the skill.
    """
    bundle = md_path.parent
    fm, body = _split_frontmatter(md_path.read_text())

    references: list[dict[str, str]] = []
    for rel in fm.get("references", []) or []:
        ref_path = bundle / rel
        if ref_path.exists():
            references.append({"name": ref_path.name, "content": ref_path.read_text()})

    postprocess: dict[str, str] = {}
    pp_fm = fm.get("postprocess") or {}
    script_rel = pp_fm.get("script")
    if script_rel:
        script_path = bundle / script_rel
        if script_path.exists():
            postprocess = {
                "script_name": script_path.name,
                "script_source": script_path.read_text(),
            }
    # Declarative, always-on output transform (no subprocess). Currently only
    # `json_to_csv` — the model emits JSON rows and we render the CSV.
    if pp_fm.get("transform"):
        postprocess["transform"] = pp_fm["transform"]

    return {
        "name": fm.get("name", bundle.name),
        "description": fm.get("description", ""),
        "system_prompt": body.strip(),
        "task_template": fm.get("task_template", "{{ user_instruction }}"),
        "metrics": fm.get("metrics", ["latency", "token_count"]),
        "few_shot_examples": fm.get("few_shot_examples", []),
        "references": references,
        "postprocess": postprocess,
    }


def list_skills() -> list[dict[str, Any]]:
    """Return all skills merged from bundled + user directories.

    Two on-disk formats are supported side by side:
      - legacy flat `<name>.yaml`
      - directory bundles `<name>/SKILL.md` (+ optional references/ and scripts/)
    """
    skills: dict[str, dict] = {}

    for skill_dir in (settings.skills_dir, settings.user_skills_dir):
        if not skill_dir.exists():
            continue
        for path in sorted(skill_dir.glob("*.yaml")):
            data = _load_yaml(path)
            data.setdefault("references", [])
            data.setdefault("postprocess", {})
            name = data.get("name", path.stem)
            data["_source"] = "user" if skill_dir == settings.user_skills_dir else "bundled"
            data["_path"] = str(path)
            skills[name] = data
        for md_path in sorted(skill_dir.glob("*/SKILL.md")):
            data = _load_skill_md(md_path)
            data["_source"] = "user" if skill_dir == settings.user_skills_dir else "bundled"
            data["_path"] = str(md_path.parent)
            skills[data["name"]] = data

    return list(skills.values())


def get_skill(name: str) -> dict[str, Any] | None:
    for skill in list_skills():
        if skill.get("name") == name:
            return skill
    return None


def save_skill(data: dict[str, Any]) -> dict[str, Any]:
    """Persist a skill to the user skills directory."""
    name = data.get("name", "").strip()
    if not name:
        raise ValueError("Skill must have a name")

    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in name)
    settings.user_skills_dir.mkdir(parents=True, exist_ok=True)
    path = settings.user_skills_dir / f"{safe_name}.yaml"

    with open(path, "w") as f:
        yaml.dump(data, f, allow_unicode=True, default_flow_style=False)

    data["_source"] = "user"
    data["_path"] = str(path)
    return data


def delete_skill(name: str) -> bool:
    """Delete a user skill; bundled skills cannot be deleted."""
    skill = get_skill(name)
    if not skill:
        return False
    if skill.get("_source") != "user":
        raise PermissionError("Bundled skills cannot be deleted")
    Path(skill["_path"]).unlink(missing_ok=True)
    return True
