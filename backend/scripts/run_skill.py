#!/usr/bin/env python
"""Batch-run a skill against a folder of images and write per-image CSVs + cost.json.

This is a thin, standalone re-use of the same building blocks the FastAPI
`/api/benchmark/run` endpoint uses — the graph's `preprocess_image` / `build_prompt`,
the provider `astream_vision` interface, the skill loader, and the `json_to_csv`
transform — but with no database, no S3, and no workspace. It reads images off the
local filesystem, calls one model, and writes results next to a `cost.json` run
manifest.

Usage (run from the backend/ directory so `uv run` finds the venv):

    uv run python scripts/run_skill.py \
        --model claude-sonnet-4-6 \
        --skill promo-price-extraction \
        --input ../images \
        --output ../out \
        --prompt "Focus on the beverages section"          # optional

The provider is auto-detected from --model against every provider's model list;
pass --provider to disambiguate or to run a model that isn't in a built-in list
(e.g. an arbitrary Ollama tag). Pricing is taken from the built-in per-model
tables, or overridden with --input-price / --output-price (USD per 1M tokens);
when no rate is known, dollar costs are left empty in cost.json.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Make `backend` importable regardless of the current working directory.
# backend/scripts/run_skill.py -> parents[2] is the repo root.
_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import backend  # noqa: E402
from backend.core.config import settings  # noqa: E402

# Load skills from the bundled backend/skills (and any runtime data/skills)
# using absolute paths so the loader works no matter where we're invoked from.
_BACKEND_DIR = Path(backend.__file__).resolve().parent
settings.skills_dir = _BACKEND_DIR / "skills"
settings.user_skills_dir = _BACKEND_DIR / "data" / "skills"

from backend.core.json_to_csv import (  # noqa: E402
    _extract_json_array,
    json_array_to_csv,
)
from backend.core.csv_detect import extract_csv_blocks  # noqa: E402
from backend.core.skills_loader import list_skills  # noqa: E402
from backend.graph.nodes import build_prompt, preprocess_image  # noqa: E402
from backend.providers import (  # noqa: E402
    BedrockProvider,
    ClaudeProvider,
    GeminiProvider,
    OllamaProvider,
)
from backend.providers.base import VLMProvider  # noqa: E402
from backend.providers.pricing import cost_rates  # noqa: E402

_PROVIDER_MAP: dict[str, type[VLMProvider]] = {
    "anthropic": ClaudeProvider,
    "gemini": GeminiProvider,
    "bedrock": BedrockProvider,
    "ollama": OllamaProvider,
}

_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}


# ── Resolution helpers ───────────────────────────────────────────────────────

def _norm(s: str) -> str:
    return s.strip().lower().replace("-", "_")


def resolve_skill(name: str) -> dict:
    """Find a skill by name, tolerant of '-' vs '_' and case."""
    skills = list_skills()
    for skill in skills:
        if _norm(skill.get("name", "")) == _norm(name):
            return skill
    available = ", ".join(sorted(s.get("name", "") for s in skills)) or "(none found)"
    raise SystemExit(f"skill '{name}' not found. Available: {available}")


def build_model_registry() -> dict[str, str]:
    """model_id -> provider key, from every provider's built-in model list."""
    registry: dict[str, str] = {}
    for key, cls in _PROVIDER_MAP.items():
        for info in cls.list_models():
            registry.setdefault(info.model_id, key)
    return registry


def print_models() -> None:
    """List every accepted --model ID, grouped by provider, with pricing."""
    for key, cls in _PROVIDER_MAP.items():
        models = cls.list_models()
        print(f"\n{key} ({len(models)} models)")
        for info in models:
            rates = cost_rates(key, info.model_id)
            price = (
                f"${rates[0]}/${rates[1]} per 1M in/out" if rates else "pricing unavailable"
            )
            print(f"  {info.model_id:<45} {info.display_name}  [{price}]")
    print(
        "\nPass any ID above to --model. IDs are unique across providers, so "
        "--provider is only needed for models not listed here (e.g. an Ollama tag).",
        flush=True,
    )


def print_skills() -> None:
    """List every accepted --skill name."""
    print("\nskills")
    for skill in sorted(list_skills(), key=lambda s: s.get("name", "")):
        desc = (skill.get("description") or "").strip().splitlines()
        print(f"  {skill.get('name', ''):<30} {desc[0] if desc else ''}")
    print(flush=True)


def resolve_provider(model_id: str, provider: str | None) -> str:
    registry = build_model_registry()
    if provider:
        if provider not in _PROVIDER_MAP:
            raise SystemExit(
                f"unknown provider '{provider}'. "
                f"Choose from: {', '.join(_PROVIDER_MAP)}"
            )
        return provider
    if model_id in registry:
        return registry[model_id]
    raise SystemExit(
        f"could not infer a provider for model '{model_id}'. "
        f"Pass --provider ({', '.join(_PROVIDER_MAP)})."
    )


# LangChain names the output-token cap differently per client, so we set
# whichever field a given client actually declares.
_MAX_TOKEN_FIELDS = ("max_tokens", "max_output_tokens", "num_predict")


def _apply_max_tokens(provider: VLMProvider, max_tokens: int) -> None:
    """Override the built provider's output-token ceiling in place.

    The providers pick a default cap in their constructors (e.g. Claude uses
    4096 without thinking, Bedrock uses a per-model value); raising it here lets
    long structured outputs — many CSV rows — finish instead of truncating.
    """
    client = getattr(provider, "_client", None)
    if client is None:
        return
    for field in _MAX_TOKEN_FIELDS:
        if hasattr(client, field):
            try:
                setattr(client, field, max_tokens)
            except Exception:
                pass


def _apply_bedrock_timeout(provider: VLMProvider, read_timeout: int) -> None:
    """Raise the Bedrock client's botocore read timeout (and add retries).

    botocore defaults to a 60s read timeout, which a long extraction — many CSV
    rows from a dense image — routinely exceeds, surfacing as
    "Read timeout on endpoint URL". We swap in a bedrock-runtime client with a
    larger read timeout, mirroring the region/credentials the provider resolved.
    """
    import boto3
    from botocore.config import Config

    client = getattr(provider, "_client", None)
    if client is None or not hasattr(client, "client"):
        return
    cfg = Config(
        read_timeout=read_timeout,
        connect_timeout=60,
        retries={"max_attempts": 3, "mode": "standard"},
    )
    client.client = boto3.client(
        "bedrock-runtime",
        region_name=getattr(client, "region_name", None) or settings.aws_default_region,
        aws_access_key_id=settings.aws_access_key_id or None,
        aws_secret_access_key=settings.aws_secret_access_key or None,
        config=cfg,
    )


def build_provider(
    provider: str,
    model_id: str,
    thinking_effort: str,
    max_tokens: int | None = None,
    timeout: int | None = None,
) -> VLMProvider:
    """Instantiate a provider; API keys/region come from the env (.env) settings."""
    if provider == "anthropic":
        inst: VLMProvider = ClaudeProvider(
            model_id=model_id, thinking_effort=thinking_effort or None
        )
    elif provider == "gemini":
        inst = GeminiProvider(model_id=model_id)
    elif provider == "bedrock":
        inst = BedrockProvider(model_id=model_id)
    else:
        inst = OllamaProvider(model_id=model_id)
    if max_tokens:
        _apply_max_tokens(inst, max_tokens)
    if provider == "bedrock" and timeout:
        _apply_bedrock_timeout(inst, timeout)
    return inst


def compose_system_prompt(skill: dict) -> str:
    """Skill body + bundled reference docs, matching the benchmark endpoint so the
    model sees the same column contract / enums it does in the app."""
    prompt = skill.get("system_prompt", "") or ""
    refs = skill.get("references") or []
    if refs:
        blocks = [
            f"## {ref.get('name', 'reference')}\n{ref.get('content', '')}".rstrip()
            for ref in refs
        ]
        prompt = f"{prompt}\n\n# References\n\n" + "\n\n".join(blocks)
    return prompt


# ── Cost helpers ─────────────────────────────────────────────────────────────

def compute_costs(
    input_tokens: int, output_tokens: int, rates: tuple[float, float] | None
) -> dict:
    """Per-part and total USD cost, or None values when no rate is known."""
    if rates is None:
        return {
            "input_cost_usd": None,
            "output_cost_usd": None,
            "total_cost_usd": None,
        }
    in_rate, out_rate = rates
    in_cost = round(input_tokens / 1_000_000 * in_rate, 6)
    out_cost = round(output_tokens / 1_000_000 * out_rate, 6)
    return {
        "input_cost_usd": in_cost,
        "output_cost_usd": out_cost,
        "total_cost_usd": round(in_cost + out_cost, 6),
    }


# ── Inference ────────────────────────────────────────────────────────────────

async def run_one_image(
    provider: VLMProvider,
    skill: dict,
    skill_name: str,
    image_path: Path,
    user_instruction: str,
) -> tuple[str, int, int, str | None]:
    """Run the model on a single image.

    Returns (raw_text, input_tokens, output_tokens, stop_reason). `stop_reason`
    is the provider's finish reason (e.g. "max_tokens", "end_turn") when it
    surfaces one, else None — providers that don't report it leave it None and
    truncation is then inferred structurally from the output.
    """
    import base64

    data_b64 = base64.b64encode(image_path.read_bytes()).decode()

    # Reuse the graph nodes: resize/encode, then build the interleaved
    # image+text message list, few-shot examples, and rendered task template.
    state = preprocess_image({"raw_images": [{"data": data_b64, "name": image_path.name}]})
    state = build_prompt({
        **state,
        "skill_name": skill_name,
        "user_instruction": user_instruction,
    })
    # build_prompt omits the reference docs from the system prompt; append them
    # exactly as the /run endpoint does.
    system_prompt = compose_system_prompt(skill)
    messages = state["messages"]

    tokens: list[str] = []
    input_tokens = 0
    output_tokens = 0
    stop_reason: str | None = None
    async for chunk in provider.astream_vision(
        system_prompt=system_prompt, messages=messages
    ):
        if chunk.content:
            tokens.append(chunk.content)
        if chunk.prompt_tokens:
            input_tokens = chunk.prompt_tokens
        if chunk.completion_tokens:
            output_tokens = chunk.completion_tokens
        # "done" is the providers' synthetic terminator, not a model stop
        # reason — keep the real one (e.g. "max_tokens") that precedes it.
        if chunk.finish_reason and chunk.finish_reason != "done":
            stop_reason = chunk.finish_reason
        if chunk.finish_reason == "done":
            break

    return "".join(tokens), input_tokens, output_tokens, stop_reason


def _salvage_objects(text: str) -> list[dict]:
    """Recover every complete top-level object from a possibly-truncated JSON
    array (e.g. a response cut off at max_tokens, so the closing `]` is missing).

    Walks object-by-object with `raw_decode` starting just inside the opening
    `[`, and stops at the first object that fails to parse — the incomplete tail.
    """
    start = text.find("[")
    if start == -1:
        return []
    decoder = json.JSONDecoder()
    idx = start + 1
    n = len(text)
    objs: list[dict] = []
    while idx < n:
        while idx < n and text[idx] in " \t\r\n,":
            idx += 1
        if idx >= n or text[idx] == "]":
            break
        try:
            obj, end = decoder.raw_decode(text, idx)
        except json.JSONDecodeError:
            break  # incomplete trailing object — stop, keep what we have
        if isinstance(obj, dict):
            objs.append(obj)
        idx = end
    return objs


def _dedupe_rows(rows: list[dict]) -> tuple[list[dict], int]:
    """Drop exact-duplicate row objects, keeping first occurrence and order.

    Weak models can fall into a repetition loop and re-emit identical objects
    until they hit the token cap. Two byte-identical 25-field promo rows are
    essentially always such an artifact, so removing exact duplicates is safe;
    the count of dropped rows measures how badly the model looped.
    """
    seen: set[str] = set()
    out: list[dict] = []
    for row in rows:
        key = json.dumps(row, sort_keys=True, ensure_ascii=False)
        if key in seen:
            continue
        seen.add(key)
        out.append(row)
    return out, len(rows) - len(out)


def output_to_csv(
    skill: dict, raw_text: str, dedupe: bool = False
) -> tuple[str | None, list[dict], bool, int]:
    """Turn a model response into CSV text, the parsed JSON rows (for a combined
    file), a `salvaged` flag, and the count of duplicate rows dropped.

    Prefers the skill's json_to_csv transform on a complete array; if that array
    is truncated (won't parse), salvages every complete object (`salvaged=True`).
    With `dedupe`, exact-duplicate objects are removed before the CSV is built.
    Falls back to a fenced CSV block, then None for non-JSON skills.
    """
    transform = (skill.get("postprocess") or {}).get("transform")
    if transform == "json_to_csv":
        parsed = _extract_json_array(raw_text)
        salvaged = False
        if not parsed:
            # Truncated / malformed array — recover the complete objects.
            parsed = _salvage_objects(raw_text)
            salvaged = bool(parsed)
        if parsed:
            rows = [r for r in parsed if isinstance(r, dict)]
            dropped = 0
            if dedupe:
                rows, dropped = _dedupe_rows(rows)
            return json_array_to_csv(json.dumps(rows)), rows, salvaged, dropped
    # Fallbacks for non-JSON skills: a fenced CSV block, else nothing.
    blocks = extract_csv_blocks(raw_text)
    if blocks:
        return blocks[0], [], False, 0
    return None, [], False, 0


async def main_async(args: argparse.Namespace) -> int:
    input_dir = Path(args.input).expanduser().resolve()
    output_dir = Path(args.output).expanduser().resolve()
    if not input_dir.is_dir():
        raise SystemExit(f"input folder not found: {input_dir}")
    output_dir.mkdir(parents=True, exist_ok=True)

    images = sorted(
        p for p in input_dir.rglob("*")
        if p.is_file() and p.suffix.lower() in _IMAGE_EXTS
    )
    if not images:
        raise SystemExit(f"no images ({', '.join(sorted(_IMAGE_EXTS))}) in {input_dir}")

    skill = resolve_skill(args.skill)
    skill_name = skill["name"]
    provider_key = resolve_provider(args.model, args.provider)
    provider = build_provider(
        provider_key, args.model, args.thinking_effort, args.max_tokens, args.timeout
    )

    # Pricing: CLI override wins, else the built-in per-model table, else none.
    if args.input_price is not None or args.output_price is not None:
        rates: tuple[float, float] | None = (
            args.input_price or 0.0,
            args.output_price or 0.0,
        )
        price_source = "cli"
    else:
        rates = cost_rates(provider_key, args.model)
        price_source = "builtin" if rates is not None else None

    print(
        f"Model:    {provider_key} · {args.model}\n"
        f"Skill:    {skill_name}\n"
        f"Images:   {len(images)} from {input_dir}\n"
        f"Output:   {output_dir}\n"
        f"Pricing:  {rates if rates else 'unavailable (dollar costs left empty)'}\n",
        flush=True,
    )

    started = datetime.now(timezone.utc)
    per_image: list[dict] = []
    combined_rows: list[dict] = []
    total_in = 0
    total_out = 0
    truncated_total = 0
    dedupe_total = 0

    for idx, image_path in enumerate(images, 1):
        # Path relative to the input folder, so images nested in sub-directories
        # keep a unique identity and don't clobber same-named files elsewhere.
        rel = image_path.relative_to(input_dir)
        rel_label = rel.as_posix()
        # Flatten the sub-path into the output stem (a/b/photo.jpg -> a__b__photo).
        out_stem = "__".join(rel.with_suffix("").parts)
        print(f"[{idx}/{len(images)}] {rel_label} … ", end="", flush=True)
        t0 = time.perf_counter()
        entry: dict = {"image": rel_label}
        try:
            raw_text, in_tok, out_tok, stop_reason = await run_one_image(
                provider, skill, skill_name, image_path, args.prompt
            )
            elapsed = time.perf_counter() - t0

            csv_text, rows, salvaged, dropped = output_to_csv(
                skill, raw_text, args.dedupe
            )
            # Truncation = the array had to be salvaged, or the model reported a
            # length stop ("max_tokens" / Gemini "MAX_TOKENS"). Either means rows
            # were dropped from the tail.
            truncated = salvaged or (
                stop_reason is not None and "max" in str(stop_reason).lower()
            )
            out_name = f"{out_stem}.csv"
            if csv_text is not None:
                (output_dir / out_name).write_text(csv_text, encoding="utf-8")
                n_rows = max(len(csv_text.splitlines()) - 1, 0)
            else:
                # Nothing CSV-shaped — preserve the raw model text for inspection.
                out_name = f"{out_stem}.txt"
                (output_dir / out_name).write_text(raw_text, encoding="utf-8")
                n_rows = 0
            combined_rows.extend(rows)

            total_in += in_tok
            total_out += out_tok
            if truncated:
                truncated_total += 1
            dedupe_total += dropped
            entry.update({
                "run_time_s": round(elapsed, 3),
                "input_tokens": in_tok,
                "output_tokens": out_tok,
                **compute_costs(in_tok, out_tok, rates),
                "rows": n_rows,
                "duplicates_removed": dropped,
                "output_file": out_name,
                "truncated": truncated,
                "stop_reason": stop_reason,
                "error": None,
            })
            note = ""
            if dropped:
                note += f"  (deduped {dropped} repeated row(s))"
            if truncated:
                note += (
                    f"  ⚠ TRUNCATED at max_tokens — kept {n_rows} complete row(s); "
                    f"raise --max-tokens to capture the rest"
                )
            print(f"{n_rows} rows, {elapsed:.1f}s{note}", flush=True)
        except Exception as exc:  # keep going; record the failure per image
            entry.update({
                "run_time_s": round(time.perf_counter() - t0, 3),
                "input_tokens": 0,
                "output_tokens": 0,
                **compute_costs(0, 0, rates),
                "rows": 0,
                "duplicates_removed": 0,
                "output_file": None,
                "truncated": False,
                "stop_reason": None,
                "error": str(exc),
            })
            print(f"ERROR: {exc}", flush=True)
        per_image.append(entry)

    ended = datetime.now(timezone.utc)

    # A single combined CSV across all images (skills that emit JSON rows only).
    if combined_rows:
        combined_csv = json_array_to_csv(json.dumps(combined_rows))
        if combined_csv:
            (output_dir / "combined.csv").write_text(combined_csv, encoding="utf-8")

    manifest = {
        "model_id": args.model,
        "provider": provider_key,
        "skill": skill_name,
        "prompt": args.prompt or "",
        "thinking_effort": args.thinking_effort or "",
        "max_tokens": args.max_tokens,
        "bedrock_read_timeout_s": args.timeout if provider_key == "bedrock" else None,
        "start_time": started.isoformat(),
        "end_time": ended.isoformat(),
        "total_run_time_s": round((ended - started).total_seconds(), 3),
        "image_count": len(images),
        "truncated_images": truncated_total,
        "dedupe": args.dedupe,
        "duplicates_removed": dedupe_total,
        "pricing": {
            "input_usd_per_1m": rates[0] if rates else None,
            "output_usd_per_1m": rates[1] if rates else None,
            "source": price_source,
        },
        "totals": {
            "input_tokens": total_in,
            "output_tokens": total_out,
            **compute_costs(total_in, total_out, rates),
        },
        "per_image": per_image,
    }

    (output_dir / "cost.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )

    total_cost = manifest["totals"]["total_cost_usd"]
    cost_str = f"${total_cost}" if total_cost is not None else "(pricing unavailable)"
    print(
        f"\nDone. {total_in} in / {total_out} out tokens, "
        f"total cost {cost_str}. Wrote cost.json to {output_dir}",
        flush=True,
    )
    if truncated_total:
        print(
            f"⚠ {truncated_total}/{len(images)} image(s) truncated at the output cap. "
            f"Re-run those with a higher --max-tokens to capture every row.",
            flush=True,
        )
    if dedupe_total:
        print(
            f"Removed {dedupe_total} exact-duplicate row(s) across the run. A large "
            f"count means the model looped — a stronger model is the real fix.",
            flush=True,
        )
    errors = [e for e in per_image if e["error"]]
    return 1 if errors and len(errors) == len(per_image) else 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Run a VLM skill over a folder of images and write CSV + cost.json.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("--model", help="Model ID to run (e.g. claude-sonnet-4-6)")
    p.add_argument("--skill", help="Skill name (e.g. promo-price-extraction)")
    p.add_argument("--input", help="Folder of input images")
    p.add_argument("--output", help="Folder for CSV output + cost.json")
    p.add_argument(
        "--list-models",
        action="store_true",
        help="List every accepted --model ID (grouped by provider) and exit",
    )
    p.add_argument(
        "--list-skills",
        action="store_true",
        help="List every accepted --skill name and exit",
    )
    p.add_argument("--prompt", default="", help="Optional extra instruction for the skill")
    p.add_argument(
        "--provider",
        default=None,
        choices=list(_PROVIDER_MAP),
        help="Force a provider; otherwise inferred from --model",
    )
    p.add_argument(
        "--thinking-effort",
        default="",
        help="Claude thinking models only: low/medium/high/max or off",
    )
    p.add_argument(
        "--max-tokens",
        type=int,
        default=None,
        help=(
            "Override the model's output-token ceiling. Raise it when long "
            "extractions truncate (rows dropped from the end). Default: the "
            "provider's per-model cap"
        ),
    )
    p.add_argument(
        "--dedupe",
        action="store_true",
        help=(
            "Drop exact-duplicate extracted rows. Use when a weak model loops and "
            "repeats rows; the removed count is reported and saved to cost.json"
        ),
    )
    p.add_argument(
        "--timeout",
        type=int,
        default=300,
        help=(
            "Bedrock only: botocore read timeout in seconds. Raise it if a slow "
            "or large extraction fails with 'Read timeout on endpoint URL' "
            "(botocore's own default is just 60s)"
        ),
    )
    p.add_argument(
        "--input-price",
        type=float,
        default=None,
        help="Override input price, USD per 1M tokens",
    )
    p.add_argument(
        "--output-price",
        type=float,
        default=None,
        help="Override output price, USD per 1M tokens",
    )
    return p.parse_args(argv)


def main() -> None:
    args = parse_args()
    if args.list_models:
        print_models()
        return
    if args.list_skills:
        print_skills()
        return
    missing = [f"--{n}" for n in ("model", "skill", "input", "output") if not getattr(args, n)]
    if missing:
        raise SystemExit(
            f"missing required argument(s): {', '.join(missing)} "
            f"(or use --list-models / --list-skills)"
        )
    raise SystemExit(asyncio.run(main_async(args)))


if __name__ == "__main__":
    main()
