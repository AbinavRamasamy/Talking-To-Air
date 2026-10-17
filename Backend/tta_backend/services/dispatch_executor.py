"""
dispatch_executor.py
--------------------
T64: runs one ``dispatch`` tool call's requests. The supervisor names its
sub-agent tasks as a typed list; this module decides what actually runs and
returns one result per request, in request order.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Literal

from tta_backend.config.settings import get_settings
from tta_backend.config.workflow_stages import STAGE_FINISHED, STAGE_QUEUED, STAGE_RUNNING
from tta_backend.models import (
    AgentRequest,
    AgentResult,
    DispatchItemResult,
    DispatchResult,
    GroundRequest,
    canonical_key,
)
from tta_backend.services.subagent_dispatch import render_unexpected_exception
from tta_backend.utils.streaming import current_thread_id, dispatch_lane_scope, emit_status, get_call_budget

logger = logging.getLogger(__name__)

RunOne = Callable[[AgentRequest], Awaitable[AgentResult]]
_Outcome = tuple[Literal["ok", "error"], AgentResult]

_STATE_KEY = "dispatch"


@dataclass
class _TurnState:
    """One chat turn's dispatch limits. Lives in the turn's call-budget dict
    (utils.streaming.get_call_budget), which stream_response binds once and
    every ToolNode gather-Task shares by reference -- so two dispatch calls
    the model emits in one message still draw on the same caps."""

    total: asyncio.Semaphore
    satellite: asyncio.Semaphore
    max_runs: int
    max_rounds: int
    runs_used: int = 0
    rounds_used: int = 0
    # canonical_key -> the run of that request, finished or still going. A
    # repeat awaits the same run instead of starting another (D9).
    runs: dict[str, asyncio.Task[_Outcome]] = field(default_factory=dict)

    def refusal(self, new_runs: int) -> str | None:
        """Why a call needing ``new_runs`` sub-agent runs may not proceed, or
        None if it may."""
        if self.rounds_used >= self.max_rounds:
            return f"dispatch round limit reached ({self.max_rounds} per turn); answer from the results already received"
        if self.runs_used + new_runs > self.max_runs:
            return (
                f"per-turn budget of {self.max_runs} sub-agent runs: {self.runs_used} used, "
                f"this dispatch needs {new_runs}; nothing in it was run"
            )
        return None


def _turn_state() -> _TurnState:
    budget = get_call_budget()
    state = budget.get(_STATE_KEY)
    if state is None:
        settings = get_settings()
        state = _TurnState(
            total=asyncio.Semaphore(settings.supervisor_max_concurrency),
            satellite=asyncio.Semaphore(settings.supervisor_max_satellite_concurrency),
            max_runs=settings.supervisor_max_requests_per_turn,
            max_rounds=settings.supervisor_max_dispatch_rounds,
        )
        budget[_STATE_KEY] = state
    return state


async def execute_dispatch(requests: list[AgentRequest], run_one: RunOne) -> DispatchResult:
    """Run ``requests`` through ``run_one`` and report each one's outcome.

    Each distinct request runs once per turn: a repeat -- in this list, an
    earlier round, or a sibling dispatch call -- gets that run's result with
    status ``duplicate`` and costs no budget. A list whose new runs would
    exceed the turn's budget or round limit is rejected whole and nothing in
    it runs."""
    state = _turn_state()
    keys = [canonical_key(request) for request in requests]
    new: dict[str, AgentRequest] = {}
    for key, request in zip(keys, requests, strict=True):
        if key not in state.runs and key not in new:
            new[key] = request

    # Checked, reserved and registered with no await in between, so a sibling
    # dispatch call cannot slip past the same check or start the same run.
    if new:
        refusal = state.refusal(len(new))
        if refusal is not None:
            rejected = DispatchResult(results=[
                DispatchItemResult(index=index, agent=request.agent, intent=request.intent, status="rejected",
                                   reason=refusal)
                for index, request in enumerate(requests)
            ])
            _log_batch(state, rejected, reason=refusal)
            return rejected
        state.rounds_used += 1
        state.runs_used += len(new)
        for key, request in new.items():
            lane = f"{state.rounds_used}.{keys.index(key)}"
            state.runs[key] = asyncio.create_task(_run_capped(state, request, run_one, lane))

    outcomes = await asyncio.gather(*(state.runs[key] for key in keys))
    owners = {key: keys.index(key) for key in new}
    batch = DispatchResult(results=[
        DispatchItemResult(
            index=index, agent=request.agent, intent=request.intent,
            status=status if owners.get(key) == index else "duplicate", result=result,
        )
        for index, (key, request, (status, result)) in enumerate(zip(keys, requests, outcomes, strict=True))
    ])
    _log_batch(state, batch)
    return batch


def _log_batch(state: _TurnState, batch: DispatchResult, *, reason: str | None = None) -> None:
    """One line per dispatch call: what became of each item, in request
    order, and how much of the turn's budget is spent -- the record of what
    the supervisor actually ran, which no other log line gives."""
    logger.log(
        logging.WARNING if reason is not None else logging.INFO,
        "dispatch_batch",
        extra={
            "_event": "dispatch_batch",
            "_thread_id": current_thread_id(),
            "_round": state.rounds_used,
            "_agents": [item.agent for item in batch.results],
            "_intents": [item.intent for item in batch.results],
            "_statuses": [item.status for item in batch.results],
            "_reason": reason,
            "_runs_used": state.runs_used,
            "_max_runs": state.max_runs,
            "_rounds_used": state.rounds_used,
            "_max_rounds": state.max_rounds,
        },
    )


def _lane_label(request: AgentRequest) -> str:
    """How the workflow strip names a request's lane."""
    if isinstance(request, GroundRequest):
        return f"Ground · {request.pollutant} · {request.location}"
    return f"Satellite · {request.variable} · {request.location}"


async def _run_capped(state: _TurnState, request: AgentRequest, run_one: RunOne, lane: str) -> _Outcome:
    with dispatch_lane_scope(lane, _lane_label(request)):
        return await _run_in_lane(state, request, run_one)


async def _run_in_lane(state: _TurnState, request: AgentRequest, run_one: RunOne) -> _Outcome:
    """One request's run. A failure becomes that item's taxonomy answer, never
    the batch's: the other items' work stands (D10)."""
    # The agent's own cap is taken before the shared one, so a satellite run
    # queued behind the satellite cap never holds a slot a ground run could use.
    agent_cap = state.satellite if request.agent == "satellite" else contextlib.nullcontext()
    loop = asyncio.get_running_loop()
    queued = loop.time()
    if state.total.locked() or (request.agent == "satellite" and state.satellite.locked()):
        emit_status("Waiting for a free slot", stage=STAGE_QUEUED)
    async with agent_cap, state.total:
        started = loop.time()
        emit_status("Running", stage=STAGE_RUNNING)
        outcome: _Outcome
        try:
            outcome = "ok", await run_one(request)
        except Exception as exc:
            outcome = "error", AgentResult(text=render_unexpected_exception(exc, f"{request.agent} agent"))
        logger.info(
            "dispatch_item",
            extra={
                "_event": "dispatch_item",
                "_thread_id": current_thread_id(),
                "_agent": request.agent,
                "_intent": str(request.intent),
                "_status": outcome[0],
                "_wait_seconds": round(started - queued, 3),
                "_run_seconds": round(loop.time() - started, 3),
            },
        )
        emit_status("Done" if outcome[0] == "ok" else "Failed", stage=STAGE_FINISHED)
        return outcome
