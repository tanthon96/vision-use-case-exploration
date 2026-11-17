from __future__ import annotations

from langgraph.graph import StateGraph, END
from typing import TypedDict, Any

from .nodes import preprocess_image, build_prompt, invoke_model, record_metrics


class BenchmarkState(TypedDict, total=False):
    # Inputs
    raw_images: list[dict]
    skill_name: str
    user_instruction: str
    provider: Any

    # Intermediate
    processed_images: list[dict]
    system_prompt: str
    messages: list[dict]
    start_time: float

    # Outputs
    response_text: str
    latency_ms: float
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float
    metrics: dict


def build_benchmark_graph():
    """Return a compiled LangGraph for a single-image benchmark run."""
    g = StateGraph(BenchmarkState)

    g.add_node("preprocess_image", preprocess_image)
    g.add_node("build_prompt", build_prompt)
    g.add_node("invoke_model", invoke_model)
    g.add_node("record_metrics", record_metrics)

    g.set_entry_point("preprocess_image")
    g.add_edge("preprocess_image", "build_prompt")
    g.add_edge("build_prompt", "invoke_model")
    g.add_edge("invoke_model", "record_metrics")
    g.add_edge("record_metrics", END)

    return g.compile()


# Singleton — compiled once at import time
benchmark_graph = build_benchmark_graph()
