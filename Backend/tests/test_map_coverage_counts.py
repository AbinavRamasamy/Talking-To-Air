"""What a map says about how much data it holds: the Valid values figure and
the granule counts.

Two figures a reader sees side by side have to describe the same thing:

* ``statistics.valid_fraction`` was counted over the BOUNDING BOX grid, so a
  complete retrieval over any region that is not a rectangle read as partly
  missing -- the Ozone Transport Region's daily TEMPO map showed "40.5%" next
  to a 95.3% QA pass rate, with the Atlantic and Ohio counted as missing data.
  The frame stack already divides by the region's own area; the map has to
  agree with it.
* the title's granule count is the granules that contributed a value, while
  the QA pass rate is counted over every granule retrieved. The metadata has
  to carry both, or "14 granules" and an 18-step QA count look like a mistake.
"""
from __future__ import annotations

import importlib.util
import os
import sys
import unittest

TESTS_DIR = os.path.dirname(__file__)
if TESTS_DIR not in sys.path:
    sys.path.insert(0, TESTS_DIR)

from test_plot_frames_wiring import TOOL_MODULES, _PlotHarness  # noqa: E402

PAYLOAD_MODULES = ["affine", "cartopy", "numpy", "rasterio", "shapely", "xarray"]


def _triangle_field(np, xr, *, missing_rows=0):
    """A complete field over a triangle: half its bounding box is outside."""
    from shapely.geometry import Polygon
    from tta_backend.utils.plotting import mask_data_by_geometry

    ny = nx = 40
    values = np.full((ny, nx), 3.0)
    values[:missing_rows, :] = np.nan
    da = xr.DataArray(
        values,
        dims=("lat", "lon"),
        coords={"lat": np.linspace(30.0, 40.0, ny), "lon": np.linspace(-100.0, -90.0, nx)},
    )
    triangle = Polygon([(-100.0, 30.0), (-90.0, 30.0), (-100.0, 40.0)])
    return mask_data_by_geometry(da, triangle)


@unittest.skipIf(
    any(importlib.util.find_spec(name) is None for name in PAYLOAD_MODULES),
    "satellite plotting dependencies are not installed",
)
class MapValidFractionTests(unittest.TestCase):
    def test_a_complete_retrieval_over_a_non_rectangular_region_is_fully_valid(self):
        import numpy as np
        import xarray as xr
        from tta_backend.tools.satellite_tools.plot_tools import _da_to_heatmap_payload

        masked = _triangle_field(np, xr)

        payload = _da_to_heatmap_payload(
            masked, "Triangle", "NO2", "mol/cm2", region_area=masked.attrs["region_area"],
        )

        self.assertAlmostEqual(payload["statistics"]["valid_fraction"], 1.0, places=6)
        self.assertEqual(payload["statistics"]["valid_basis"], "region")

    def test_missing_data_inside_the_region_is_counted_by_area(self):
        import numpy as np
        import xarray as xr
        from tta_backend.tools.satellite_tools.plot_tools import _da_to_heatmap_payload
        from tta_backend.preprocessing.aggregation_service import cos_lat_weights

        masked = _triangle_field(np, xr, missing_rows=10)
        full = _triangle_field(np, xr)
        weights = cos_lat_weights(masked)
        observed = float((np.isfinite(masked) * weights).sum())
        expected = observed / full.attrs["region_area"]

        payload = _da_to_heatmap_payload(
            masked, "Triangle", "NO2", "mol/cm2", region_area=masked.attrs["region_area"],
        )

        self.assertLess(expected, 1.0)
        self.assertAlmostEqual(payload["statistics"]["valid_fraction"], expected, places=5)

    def test_without_a_region_the_grid_is_the_stated_denominator(self):
        """Comparison panels have no region mask to hand over. Their figure
        stays a share of grid cells, and says so."""
        import numpy as np
        import xarray as xr
        from tta_backend.tools.satellite_tools.plot_tools import _da_to_heatmap_payload

        masked = _triangle_field(np, xr)

        payload = _da_to_heatmap_payload(masked, "Triangle", "NO2", "mol/cm2")

        self.assertLess(payload["statistics"]["valid_fraction"], 0.75)
        self.assertEqual(payload["statistics"]["valid_basis"], "grid")


@unittest.skipIf(
    any(importlib.util.find_spec(name) is None for name in TOOL_MODULES),
    "satellite tool integration dependencies are not installed",
)
class PlotSingularCoverageCountTests(_PlotHarness, unittest.IsolatedAsyncioTestCase):
    async def test_the_map_divides_by_the_region_not_its_bounding_box(self):
        self.add_bundle(ny=40, nx=40)

        _summary, payload = await self.plot(location="New Jersey")

        self.assertEqual(payload["statistics"]["valid_basis"], "region")
        self.assertGreater(payload["statistics"]["valid_fraction"], 0.97)

    async def test_the_metadata_counts_granules_retrieved_as_well_as_used(self):
        import numpy as np

        values = np.full((3, 8, 8), 4.0e15)
        values[0] = np.nan  # the first scan holds nothing over the region
        self.add_bundle(values=values)

        _summary, payload = await self.plot()

        meta = payload["aggregation_meta"]
        self.assertEqual(meta["n_granules"], 2)
        self.assertEqual(meta["n_granules_retrieved"], 3)
        self.assertIn("2 of 3 hourly granules", meta["aggregation_label"])
