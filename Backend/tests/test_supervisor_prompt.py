import unittest


class SupervisorPromptT25Phase4Tests(unittest.TestCase):
    """T25 Phase 4: the supervisor prompt states the same asymmetry as the
    earthdata agent's — satellite is universal over gridded Earthdata
    collections, ground/cross-source confirmation is air-quality-only — so
    routing never promises a ground check for a non-AQ satellite query."""

    def test_prompt_states_satellite_is_not_limited_to_air_quality(self):
        from tta_backend.config.supervisor_prompt import SUPERVISOR_PROMPT

        prompt = SUPERVISOR_PROMPT.lower()

        self.assertIn("any regularly-gridded", prompt)
        self.assertIn("not just air quality", prompt)

    def test_prompt_states_ground_is_air_quality_pollutants_only(self):
        from tta_backend.config.supervisor_prompt import SUPERVISOR_PROMPT

        prompt = SUPERVISOR_PROMPT.lower()

        self.assertIn("air quality pollutants", prompt)
        self.assertIn("no2, pm2.5, o3, so2, co", prompt)

    def test_prompt_forbids_promising_ground_confirmation_for_non_aq_queries(self):
        from tta_backend.config.supervisor_prompt import SUPERVISOR_PROMPT

        # Collapse whitespace so line wrapping in the prompt can't hide a phrase.
        prompt = " ".join(SUPERVISOR_PROMPT.lower().split())

        self.assertIn("never call ground, and never tell the user", prompt)
        self.assertIn("soil moisture", prompt)
        self.assertIn("land surface temperature", prompt)

    def test_ground_plus_satellite_routing_is_scoped_to_air_quality(self):
        from tta_backend.config.supervisor_prompt import SUPERVISOR_PROMPT

        prompt = " ".join(SUPERVISOR_PROMPT.lower().split())
        routing_idx = prompt.index("ground + satellite: user explicitly requests")

        self.assertIn("air-quality pollutants only", prompt[routing_idx:routing_idx + 300])


class SupervisorPromptPlaceNameTests(unittest.TestCase):
    """The supervisor expanded "the OTC region" into "the Ozone Transport
    Commission (OTC) region (northeastern US)" in its delegation, and the
    subagent sent a spelling the region vocabulary does not hold. The task
    string must carry the user's place name as written."""

    def test_prompt_tells_the_supervisor_to_pass_place_names_as_written(self):
        from tta_backend.config.supervisor_prompt import SUPERVISOR_PROMPT

        prompt = " ".join(SUPERVISOR_PROMPT.lower().split())

        self.assertIn("place name exactly as the user wrote it", prompt)
        self.assertIn("do not expand acronyms", prompt)


if __name__ == "__main__":
    unittest.main()
