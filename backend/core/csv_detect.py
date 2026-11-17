"""Detect CSV regions inside free-form model output.

A Python port of frontend/src/lib/csv.ts so auto-saved workspace files match
exactly what the chat UI renders as a table — and, crucially, share the same
guards against false positives (JSON with commas, prose). Used to auto-save
model-generated CSVs as workspace files.
"""
from __future__ import annotations

import re


def _count_fields(line: str) -> int:
    """Top-level comma count + 1. Commas inside quotes, [...] or {...} don't
    count, so JSON lines like `{box_2d: [1, 2], label: x}` read as one field."""
    count = 1
    in_quotes = False
    depth = 0
    i = 0
    n = len(line)
    while i < n:
        c = line[i]
        if in_quotes:
            if c == '"':
                if i + 1 < n and line[i + 1] == '"':
                    i += 1
                else:
                    in_quotes = False
        elif c == '"':
            in_quotes = True
        elif c in "[{":
            depth += 1
        elif c in "]}":
            if depth > 0:
                depth -= 1
        elif c == "," and depth == 0:
            count += 1
        i += 1
    return count


def _find_csv_run(lines: list[str]) -> tuple[int, int] | None:
    """First run of ≥2 adjacent non-empty lines with the same field count (≥3),
    excluding prose (lines mostly ending in sentence punctuation)."""
    i = 0
    while i < len(lines):
        if lines[i].strip() == "":
            i += 1
            continue
        cols = _count_fields(lines[i])
        if cols >= 3:
            j = i + 1
            while j < len(lines) and lines[j].strip() != "" and _count_fields(lines[j]) == cols:
                j += 1
            rows = lines[i:j]
            sentencey = sum(1 for r in rows if re.search(r"[.!?]$", r.strip()))
            if j - i >= 2 and sentencey <= len(rows) / 2:
                return i, j
            i = j
        else:
            i += 1
    return None


def _split_raw(text: str) -> list[str]:
    lines = text.split("\n")
    run = _find_csv_run(lines)
    if run is None:
        return []
    return ["\n".join(lines[run[0]:run[1]])] + _split_raw("\n".join(lines[run[1]:]))


_FENCE_RE = re.compile(r"```csv[^\n]*\n(.*?)```", re.DOTALL)


def extract_csv_blocks(content: str) -> list[str]:
    """Return each CSV region in `content`: fenced ```csv blocks first, then raw
    CSV tables in the remaining text. Empty list when there's no real CSV."""
    blocks: list[str] = []
    last = 0
    for m in _FENCE_RE.finditer(content):
        if m.start() > last:
            blocks += _split_raw(content[last:m.start()])
        blocks.append(m.group(1).rstrip("\n"))
        last = m.end()
    if last < len(content):
        blocks += _split_raw(content[last:])
    return blocks
