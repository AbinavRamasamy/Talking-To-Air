"""
consulted_header.py
-------------------
T64 D14: the "Agent consulted: ..." line that opens a sub-agent answer. It is
derived from what the turn's dispatch calls actually ran, so it can never
claim a ground check that did not happen; any header the model writes itself
is dropped.
"""
from __future__ import annotations

import re
from typing import Any

from tta_backend.models import parse_dispatch_result

_HEADER_LINE = re.compile(r"^[ \t]*Agent consulted:[^\n]*\n?", re.MULTILINE)
# Header order is fixed, whatever order the requests ran in.
_ORDER = ("ground", "satellite")
_RAN = ("ok", "error", "duplicate")


def consulted_agents(tool_content: Any) -> list[str]:
    """The agents a supervisor ToolMessage shows were consulted: those with at
    least one dispatch item that ran (a rejected item never did). Empty for
    anything that is not a dispatch batch."""
    batch = parse_dispatch_result(tool_content)
    if batch is None:
        return []
    ran = {item.agent for item in batch.results if item.status in _RAN}
    return [agent for agent in _ORDER if agent in ran]


def consulted_header(agents: list[str]) -> str | None:
    named = [agent.upper() for agent in _ORDER if agent in agents]
    return f"Agent consulted: {' + '.join(named)}" if named else None


def with_consulted_header(text: str, agents: list[str]) -> str:
    """``text`` opened by the header for ``agents``, with any header line the
    model wrote removed first."""
    body = _HEADER_LINE.sub("", text).lstrip()
    header = consulted_header(agents)
    return f"{header}\n\n{body}" if header else body
