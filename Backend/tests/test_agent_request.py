"""T64: the typed requests the supervisor's dispatch tool carries, in the
shape a model actually sends them (plain dicts, ISO date strings)."""
import unittest


class DispatchArgsTests(unittest.TestCase):
    def test_model_shaped_args_validate_into_the_request_class_for_each_agent(self):
        from tta_backend.models.agent_request import DispatchArgs, GroundRequest, SatelliteRequest

        args = DispatchArgs.model_validate({"requests": [
            {"agent": "satellite", "intent": "visualize", "figure_type": "map", "variable": "NO2",
             "dataset": "TROPOMI", "location": "New Jersey", "start_date": "2024-01-15", "end_date": "2024-01-15"},
            {"agent": "ground", "intent": "nearest_monitor", "pollutant": "NO2", "location": "Tampa FL"},
        ]})

        satellite, ground = args.requests
        self.assertIsInstance(satellite, SatelliteRequest)
        self.assertEqual(satellite.figure_type, "map")
        self.assertEqual(satellite.start_date.isoformat(), "2024-01-15")
        self.assertIsInstance(ground, GroundRequest)
        self.assertEqual(ground.pollutant, "NO2")

    def test_a_ground_request_for_anything_but_the_five_aqs_pollutants_is_rejected(self):
        from pydantic import ValidationError

        from tta_backend.models.agent_request import DispatchArgs

        with self.assertRaises(ValidationError):
            DispatchArgs.model_validate({"requests": [
                {"agent": "ground", "intent": "summary", "pollutant": "soil moisture", "location": "Iowa"},
            ]})

    def test_a_request_carrying_the_other_agents_fields_is_rejected_not_silently_trimmed(self):
        """A ground request with `variable` set is the supervisor asking the
        ground agent for something it cannot measure; dropping the field
        would let it run as a plain pollutant query."""
        from pydantic import ValidationError

        from tta_backend.models.agent_request import DispatchArgs

        with self.assertRaises(ValidationError):
            DispatchArgs.model_validate({"requests": [
                {"agent": "ground", "intent": "summary", "pollutant": "PM2.5", "location": "Iowa",
                 "variable": "soil moisture"},
            ]})


def _satellite(location):
    return {"agent": "satellite", "intent": "visualize", "figure_type": "map", "variable": "NO2", "location": location}


class DispatchSizeTests(unittest.TestCase):
    def test_a_dispatch_carries_between_one_and_six_requests(self):
        from pydantic import ValidationError

        from tta_backend.models.agent_request import DispatchArgs

        six = DispatchArgs.model_validate({"requests": [_satellite(f"region {i}") for i in range(6)]})
        self.assertEqual(len(six.requests), 6)

        for size in (0, 7):
            with self.subTest(size=size), self.assertRaises(ValidationError):
                DispatchArgs.model_validate({"requests": [_satellite(f"region {i}") for i in range(size)]})


def _walk(node):
    yield node
    if isinstance(node, dict):
        for value in node.values():
            yield from _walk(value)
    elif isinstance(node, list):
        for value in node:
            yield from _walk(value)


class DispatchJsonSchemaTests(unittest.TestCase):
    """The declaration the model is given. Phase 0 gated exactly one shape on
    every vetted Gemini model: a plain anyOf union with the list caps."""

    def test_requests_are_a_capped_anyof_union_of_both_request_classes(self):
        from tta_backend.models.agent_request import dispatch_json_schema

        schema = dispatch_json_schema()
        requests = schema["properties"]["requests"]

        self.assertEqual((requests["minItems"], requests["maxItems"]), (1, 6))
        branches = [schema["$defs"][ref["$ref"].split("/")[-1]] for ref in requests["items"]["anyOf"]]
        self.assertEqual(
            sorted(b["properties"]["agent"]["const"] for b in branches), ["ground", "satellite"],
        )

    def test_carries_no_keyword_outside_the_gated_shape(self):
        """oneOf/discriminator come from the discriminated union and
        additionalProperties from extra="forbid"; none of them was gated, so
        validation enforces them server-side instead."""
        from tta_backend.models.agent_request import dispatch_json_schema

        keys = {key for node in _walk(dispatch_json_schema()) if isinstance(node, dict) for key in node}

        self.assertFalse(keys & {"oneOf", "discriminator", "additionalProperties"})


def _requests(*items):
    from tta_backend.models.agent_request import DispatchArgs

    return DispatchArgs.model_validate({"requests": list(items)}).requests


class CanonicalKeyTests(unittest.TestCase):
    """The identity the dispatch executor dedupes on (D9): the typed fields
    define the task; prior_findings is context, so rewording it cannot dodge
    dedupe."""

    def test_requests_differing_only_in_prior_findings_share_a_key(self):
        from tta_backend.models.agent_request import canonical_key

        first, reworded = _requests(
            {**_satellite("the OTC"), "prior_findings": "peak near 40.7,-74.0"},
            {"prior_findings": "the peak was at 40.7N 74.0W", **_satellite("the OTC")},
        )

        self.assertEqual(canonical_key(first), canonical_key(reworded))

    def test_requests_for_different_tasks_have_different_keys(self):
        from tta_backend.models.agent_request import canonical_key

        base = _satellite("New Jersey")
        variants = _requests(
            base,
            {**base, "location": "New York"},
            {**base, "figure_type": "timeseries"},
            {**base, "start_date": "2024-07-01"},
            {"agent": "ground", "intent": "readings", "pollutant": "NO2", "location": "New Jersey"},
        )

        self.assertEqual(len({canonical_key(r) for r in variants}), len(variants))


class RenderTaskTests(unittest.TestCase):
    """The task string a sub-agent receives (D7): a fixed template over the
    typed fields plus the researcher's own words (D6) -- no model rewrites
    anything on the way."""

    def test_a_satellite_request_renders_as_labeled_lines_under_the_researchers_words(self):
        from tta_backend.models.agent_request import render_task

        (request,) = _requests({
            "agent": "satellite", "intent": "visualize", "figure_type": "map", "variable": "ozone",
            "dataset": "TEMPO", "location": "the OTC", "start_date": "2024-07-15", "end_date": "2024-07-15",
            "prior_findings": "ground monitors exceeded 70 ppb at 3 sites",
        })

        self.assertEqual(
            render_task(request, "Plot TEMPO ozone over the OTC for 2024-07-15"),
            "Researcher's request (verbatim): Plot TEMPO ozone over the OTC for 2024-07-15\n"
            "Intent: visualize\n"
            "Figure: map\n"
            "Variable: ozone\n"
            "Dataset: TEMPO\n"
            "Location (use exactly as written): the OTC\n"
            "Dates: 2024-07-15 to 2024-07-15\n"
            "Prior findings: ground monitors exceeded 70 ppb at 3 sites",
        )

    def test_a_ground_request_renders_only_the_fields_it_has(self):
        from tta_backend.models.agent_request import render_task

        single_day, open_ended, undated = _requests(
            {"agent": "ground", "intent": "readings", "pollutant": "PM2.5", "location": "Phoenix",
             "start_date": "2024-07-04"},
            {"agent": "ground", "intent": "readings", "pollutant": "PM2.5", "location": "Phoenix",
             "end_date": "2024-07-31"},
            {"agent": "ground", "intent": "nearest_monitor", "pollutant": "NO2", "location": "Tampa FL"},
        )

        self.assertEqual(
            render_task(single_day, None),
            "Intent: readings\n"
            "Pollutant: PM2.5\n"
            "Location (use exactly as written): Phoenix\n"
            "Date: 2024-07-04",
        )
        self.assertTrue(render_task(open_ended, None).endswith("\nDates: up to 2024-07-31"))
        self.assertEqual(
            render_task(undated, "closest NO2 monitor to Tampa FL?"),
            "Researcher's request (verbatim): closest NO2 monitor to Tampa FL?\n"
            "Intent: nearest_monitor\n"
            "Pollutant: NO2\n"
            "Location (use exactly as written): Tampa FL",
        )


class RenderedTaskPromptContractTests(unittest.TestCase):
    """D7: the sub-agents keep taking a string, so each one's prompt must say
    what the labeled lines render_task sends mean. A label added to the
    template without a word in the prompt is a field the agent has to guess."""

    @staticmethod
    def _labels(task):
        return [line.split(":", 1)[0] for line in task.splitlines()]

    def test_every_label_a_satellite_task_carries_is_explained_in_the_earthdata_prompt(self):
        from tta_backend.config.earthdata_agent_prompt import get_earthdata_agent_prompt
        from tta_backend.models.agent_request import render_task

        (request,) = _requests({
            "agent": "satellite", "intent": "compare", "figure_type": "map_multi", "variable": "NO2",
            "dataset": "TEMPO", "location": "the OTC", "start_date": "2024-07-01", "end_date": "2024-07-31",
            "prior_findings": "exceedance at Camden on 07-12",
        })
        prompt = get_earthdata_agent_prompt()

        for label in self._labels(render_task(request, "compare NO2 over the OTC")):
            with self.subTest(label=label):
                self.assertIn(label, prompt)

    def test_every_label_a_ground_task_carries_is_explained_in_the_ground_prompt(self):
        from tta_backend.config.ground_sensor_agent_prompt import GROUND_SYSTEM_PROMPT
        from tta_backend.models.agent_request import render_task

        (request,) = _requests({
            "agent": "ground", "intent": "readings", "pollutant": "NO2", "location": "40.71,-74.01",
            "start_date": "2024-07-01", "end_date": "2024-07-31", "prior_findings": "satellite peak at 40.71,-74.01",
        })

        for label in self._labels(render_task(request, "check the ground at the NO2 peak")):
            with self.subTest(label=label):
                self.assertIn(label, GROUND_SYSTEM_PROMPT)


if __name__ == "__main__":
    unittest.main()
