"""
consulted_header.py
-------------------
T64 D14: the "Data sources: ..." line that opens a sub-agent answer. It is
derived from what the turn's dispatch calls actually ran, so it can never
claim a dataset or ground check that did not happen; any header the model
writes itself is dropped.

A satellite run is named by the datasets its charts were drawn from; a ground
run is EPA AQS. Each dispatch item records its sources when it runs, because
the checkpointed copy keeps only chart references and loses the dataset.
"""
from __future__ import annotations

import re
from typing import Any

from tta_backend.models import AgentResult, parse_dispatch_result

_HEADER_PREFIX = "Data sources:"
# The current header, and the "Agent consulted:" one written before it.
_HEADER_LINE = re.compile(r"^[ \t]*(?:Data sources|Agent consulted):[^\n]*\n?", re.MULTILINE)
_RAN = ("ok", "error", "duplicate")

GROUND_SOURCE = "EPA AQS"
SATELLITE_FALLBACK = "NASA Earthdata"


def _datasets(chart: Any) -> list[str]:
    payload = chart.model_dump() if hasattr(chart, "model_dump") else chart
    if not isinstance(payload, dict):
        return []
    provenances = [payload.get("provenance")]
    provenances += [panel.get("provenance") for panel in payload.get("panels") or [] if isinstance(panel, dict)]
    return [p["dataset"] for p in provenances if isinstance(p, dict) and isinstance(p.get("dataset"), str) and p["dataset"]]


def merge_sources(*groups: list[str]) -> list[str]:
    """Every source in ``groups`` once: satellite datasets in first-seen
    order, then EPA AQS last."""
    seen: list[str] = []
    for source in (source for group in groups for source in group):
        if source not in seen:
            seen.append(source)
    return [s for s in seen if s != GROUND_SOURCE] + ([GROUND_SOURCE] if GROUND_SOURCE in seen else [])


def result_sources(agent: str, result: AgentResult) -> list[str]:
    """The sources one sub-agent run drew on."""
    if agent == "ground":
        return [GROUND_SOURCE]
    return merge_sources([d for chart in result.charts for d in _datasets(chart)]) or [SATELLITE_FALLBACK]


def consulted_sources(tool_content: Any) -> list[str]:
    """The sources a supervisor ToolMessage shows were consulted, from the
    dispatch items that ran (a rejected item never did). An item saved
    before items recorded sources is named by its agent. Empty for anything
    that is not a dispatch batch."""
    batch = parse_dispatch_result(tool_content)
    if batch is None:
        return []
    return merge_sources(*(
        item.sources or ([GROUND_SOURCE] if item.agent == "ground" else [SATELLITE_FALLBACK])
        for item in batch.results if item.status in _RAN
    ))


def sources_header(sources: list[str]) -> str | None:
    return f"{_HEADER_PREFIX} {' · '.join(sources)}" if sources else None


def with_sources_header(text: str, sources: list[str]) -> str:
    """``text`` opened by the header for ``sources``. Any header line already
    in the text goes, and so does everything above the last one that opens
    more text: a model that writes before its own header restates raw data
    ahead of the answer, and on the live stream the server's header precedes
    it. A header line with nothing after it is only dropped, so a model's
    closing "Data sources" line cannot swallow its answer."""
    openers = [m for m in _HEADER_LINE.finditer(text) if text[m.end():].strip()]
    body = text[openers[-1].end():] if openers else text
    body = _HEADER_LINE.sub("", body).strip()
    header = sources_header(sources)
    return f"{header}\n\n{body}" if header else body
