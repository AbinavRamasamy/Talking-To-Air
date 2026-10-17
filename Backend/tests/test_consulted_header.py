"""T64 D14: the "Agent consulted: ..." header is computed from what the turn's
dispatch calls actually ran, never written by the model."""
import unittest


def _batch(*items):
    from tta_backend.models import AgentResult, DispatchItemResult, DispatchResult

    return DispatchResult(results=[
        DispatchItemResult(index=i, agent=agent, intent="visualize" if agent == "satellite" else "readings",
                           status=status, result=None if status == "rejected" else AgentResult(text=f"{agent} {i}"))
        for i, (agent, status) in enumerate(items)
    ]).model_dump_json(exclude_none=True)


class ConsultedHeaderTests(unittest.TestCase):
    def test_only_items_that_ran_count_as_consulted(self):
        from tta_backend.services.consulted_header import consulted_agents

        self.assertEqual(consulted_agents(_batch(("satellite", "ok"), ("ground", "rejected"))), ["satellite"])
        self.assertEqual(
            consulted_agents(_batch(("ground", "error"), ("satellite", "duplicate"))), ["ground", "satellite"],
        )

    def test_a_tool_message_that_is_not_a_dispatch_batch_names_no_agent(self):
        from tta_backend.models import AgentResult, agent_result_to_json
        from tta_backend.services.consulted_header import consulted_agents

        self.assertEqual(consulted_agents(agent_result_to_json(AgentResult(text="legacy"))), [])
        self.assertEqual(consulted_agents("plain text"), [])

    def test_the_header_names_what_ran_and_replaces_any_the_model_wrote(self):
        from tta_backend.services.consulted_header import with_consulted_header

        self.assertEqual(
            with_consulted_header("Agent consulted: SATELLITE\n\nNO2 peaked near Newark.", ["satellite", "ground"]),
            "Agent consulted: GROUND + SATELLITE\n\nNO2 peaked near Newark.",
        )
        self.assertEqual(with_consulted_header("Ozone was moderate.", ["satellite"]),
                         "Agent consulted: SATELLITE\n\nOzone was moderate.")

    def test_text_the_model_wrote_above_its_own_header_is_dropped(self):
        """The old _strip_supervisor_preamble's job: a model that restates raw
        data before its header line. On the live stream the server's header
        comes first, so everything before the LAST header line goes."""
        from tta_backend.services.consulted_header import with_consulted_header

        for text in (
            "Here is the NO2 data: 4.1e15, 3.9e15\nAgent consulted: SATELLITE\n\nNO2 peaked near Newark.",
            "Agent consulted: SATELLITE\n\nHere is the data: 4.1e15\nAgent consulted: SATELLITE\n\nNO2 peaked near Newark.",
        ):
            with self.subTest(text=text[:30]):
                self.assertEqual(
                    with_consulted_header(text, ["satellite"]),
                    "Agent consulted: SATELLITE\n\nNO2 peaked near Newark.",
                )

    def test_with_nothing_consulted_no_header_is_claimed(self):
        from tta_backend.services.consulted_header import with_consulted_header

        self.assertEqual(with_consulted_header("Agent consulted: GROUND\n\nHello!", []), "Hello!")


class SupervisorStreamHeaderTests(unittest.IsolatedAsyncioTestCase):
    async def _stream(self, *events):
        import json
        from unittest.mock import AsyncMock, patch

        from tta_backend.services.chart_service import ChartService
        from tta_backend.services.chat_stream_service import ChatStreamService

        async def fake_stream_response(agent, message, thread_id, **kwargs):
            for event in events:
                yield event

        service = ChatStreamService(ChartService(), long_request_seconds=999)
        with patch("tta_backend.services.chat_stream_service.stream_response", fake_stream_response), \
             patch("tta_backend.services.chart_service.chart_repository.get_chart", AsyncMock(return_value=None)):
            sse = [e async for e in service.stream_chat_events(object(), None, None, "hi", "thread-1", "user-1", "r")]
        texts = [json.loads(e.split("data: ", 1)[1])["content"] for e in sse if e.startswith("event: text")]
        done = json.loads(next(e for e in sse if e.startswith("event: done")).split("data: ", 1)[1])
        return texts, done["response"]

    async def test_the_answer_streams_under_a_header_naming_what_ran(self):
        texts, response = await self._stream(
            ("tool_call", {"name": "dispatch", "args": {}}),
            ("tool_result", {"name": "dispatch", "content": _batch(("satellite", "ok"), ("ground", "rejected"))}),
            ("text", "Ozone peaked "),
            ("text", "over Philadelphia."),
        )

        self.assertEqual(texts, ["Agent consulted: SATELLITE\n\n", "Ozone peaked ", "over Philadelphia."])
        self.assertEqual(response, "Agent consulted: SATELLITE\n\nOzone peaked over Philadelphia.")

    async def test_a_header_the_model_wrote_is_replaced_by_what_ran(self):
        _, response = await self._stream(
            ("tool_call", {"name": "dispatch", "args": {}}),
            ("tool_result", {"name": "dispatch", "content": _batch(("satellite", "ok"))}),
            ("text", "Agent consulted: GROUND + SATELLITE\n\nOzone peaked over Philadelphia."),
        )

        self.assertEqual(response, "Agent consulted: SATELLITE\n\nOzone peaked over Philadelphia.")

    async def test_a_turn_that_dispatched_nothing_carries_no_header(self):
        texts, response = await self._stream(("text", "Hello! Ask me about air quality."))

        self.assertEqual(texts, ["Hello! Ask me about air quality."])
        self.assertEqual(response, "Hello! Ask me about air quality.")


class HistoryHeaderTests(unittest.IsolatedAsyncioTestCase):
    async def _history(self, messages):
        from types import SimpleNamespace
        from unittest.mock import AsyncMock, patch

        from tta_backend.services.chart_service import ChartService
        from tta_backend.services.history_service import HistoryService

        class FakeAgent:
            async def aget_state(self, config):
                return SimpleNamespace(values={"messages": messages})

        with patch("tta_backend.services.chart_service.chart_repository.get_charts", AsyncMock(return_value={})):
            return await HistoryService(ChartService()).build_history(FakeAgent(), "thread-1", "user-1")

    async def test_a_reloaded_dispatch_turn_carries_the_same_header_as_it_streamed_with(self):
        from types import SimpleNamespace

        history = await self._history([
            SimpleNamespace(type="human", content="ozone over the OTC and the nearest monitor to Camden"),
            SimpleNamespace(type="ai", content="", tool_calls=[{"id": "c1", "name": "dispatch", "args": {}}]),
            SimpleNamespace(type="tool", name="dispatch",
                            content=_batch(("satellite", "ok"), ("ground", "ok"))),
            SimpleNamespace(type="ai", content="Ozone peaked over Philadelphia; Camden Spruce St is nearest.",
                            tool_calls=[]),
            SimpleNamespace(type="human", content="thanks"),
            SimpleNamespace(type="ai", content="You're welcome.", tool_calls=[]),
        ])

        answers = [m["content"] for m in history if m["role"] == "assistant"]
        self.assertEqual(answers, [
            "Agent consulted: GROUND + SATELLITE\n\nOzone peaked over Philadelphia; Camden Spruce St is nearest.",
            "You're welcome.",
        ])

    async def test_a_legacy_turn_keeps_the_header_it_was_saved_with(self):
        from types import SimpleNamespace

        from tta_backend.models import AgentResult, agent_result_to_json

        saved = "Agent consulted: SATELLITE\n\nNO2 peaked near Newark."
        history = await self._history([
            SimpleNamespace(type="human", content="plot NO2 over NJ"),
            SimpleNamespace(type="ai", content="", tool_calls=[{"id": "c1", "name": "ask_earthdata_agent", "args": {}}]),
            SimpleNamespace(type="tool", name="ask_earthdata_agent", content=agent_result_to_json(AgentResult(text="x"))),
            SimpleNamespace(type="ai", content=saved, tool_calls=[]),
        ])

        self.assertEqual([m["content"] for m in history if m["role"] == "assistant"], [saved])


if __name__ == "__main__":
    unittest.main()
