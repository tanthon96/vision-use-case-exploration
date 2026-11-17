"""Convert a model's JSON-array output into a correctly-quoted CSV.

Models routinely emit *invalid* CSV — an unquoted comma inside a value like
`Milk 1 Litre (Full Cream, Low Fat)` shifts every later column, and the damage
cascades across large outputs. Asking the model for JSON instead and writing the
CSV ourselves with `csv.writer` makes misalignment impossible: columns map by
key, not by position, and all quoting/escaping is handled here.

Opt in per skill via `postprocess.transform: json_to_csv` (see skills_loader).
"""
from __future__ import annotations

import csv
import io
import json
import re

_FENCE_RE = re.compile(r"```(?:json)?\s*\n(.*?)```", re.DOTALL)


def _extract_json_array(text: str) -> list | None:
    """Pull the first JSON array out of `text`, whether it's fenced in a
    ```json block or bare. Returns the parsed list, or None if none is found."""
    candidates: list[str] = []
    m = _FENCE_RE.search(text)
    if m:
        candidates.append(m.group(1))
    candidates.append(text)

    for cand in candidates:
        start = cand.find("[")
        end = cand.rfind("]")
        if start == -1 or end <= start:
            continue
        try:
            data = json.loads(cand[start : end + 1])
        except json.JSONDecodeError:
            continue
        if isinstance(data, list):
            return data
    return None


def _cell(value: object) -> str:
    """Render one JSON value as a CSV cell. Lists (e.g. the model emitting the
    Promo Mechanic column as `["PO", "SPD"]`) collapse to a comma-joined string,
    matching the sheet's list-column convention. Quoting is the writer's job."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (list, tuple)):
        return ", ".join("" if x is None else str(x) for x in value)
    return str(value)


def json_array_to_csv(text: str) -> str | None:
    """Convert a JSON array of flat objects in `text` to a CSV string.

    The header is the order-preserving union of keys across all rows, so a row
    that omits a field still lines up. Returns None when the payload isn't a
    pure array of objects, so the caller can leave the original output untouched.
    """
    data = _extract_json_array(text)
    if not data:
        return None
    rows = [r for r in data if isinstance(r, dict)]
    if not rows or len(rows) != len(data):
        return None  # not a clean array-of-objects — don't touch it

    header: list[str] = []
    seen: set[str] = set()
    for row in rows:
        for key in row.keys():
            if key not in seen:
                seen.add(key)
                header.append(key)

    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(header)
    for row in rows:
        writer.writerow([_cell(row.get(k)) for k in header])
    return buf.getvalue().rstrip("\n")
