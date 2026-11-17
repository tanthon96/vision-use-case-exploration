"""Token-cost estimation, keyed by (provider, model_id).

Reuses the per-model `_COST` tables that already live on each provider so there
is a single source of truth for prices. Providers without a table (Ollama is
local/free) resolve to None — the caller reports those as "pricing unavailable"
rather than $0, so an estimate is never silently understated.
"""
from __future__ import annotations

from .claude import _COST as _CLAUDE_COST
from .gemini import _COST as _GEMINI_COST
from .bedrock import _COST as _BEDROCK_COST

# (provider, model_id) -> (input_usd_per_1m, output_usd_per_1m)
_PRICING: dict[tuple[str, str], tuple[float, float]] = {}
for _mid, _rates in _CLAUDE_COST.items():
    _PRICING[("anthropic", _mid)] = _rates
for _mid, _rates in _GEMINI_COST.items():
    _PRICING[("gemini", _mid)] = _rates
for _mid, _rates in _BEDROCK_COST.items():
    _PRICING[("bedrock", _mid)] = _rates


def cost_rates(provider: str | None, model_id: str | None) -> tuple[float, float] | None:
    """Return (input, output) USD per 1M tokens for a model, or None if unknown."""
    return _PRICING.get((provider or "", model_id or ""))


def estimate_cost(
    provider: str | None,
    model_id: str | None,
    input_tokens: int,
    output_tokens: int,
) -> float | None:
    """Estimate USD cost for a token count, or None when the model isn't priced."""
    rates = cost_rates(provider, model_id)
    if rates is None:
        return None
    in_rate, out_rate = rates
    return round(input_tokens / 1_000_000 * in_rate + output_tokens / 1_000_000 * out_rate, 6)
