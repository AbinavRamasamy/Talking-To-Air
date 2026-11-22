"""
Unit tests for EPA AirNow tools (airnow_tools.py).
Tests geocoding fallback, rate-limiting, mock responses, and table artifact generation.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tta_backend.tools.ground_sensor_tools.airnow_tools import (
    _AirNowRateLimiter,
    _format_aqs_id,
    get_airnow_area_data,
    get_airnow_observation,
)


@pytest.fixture
def mock_geocoding():
    with patch("tta_backend.tools.ground_sensor_tools.airnow_tools.get_geocoding_service") as mock_get_geo:
        service = MagicMock()
        service.ageocode = AsyncMock(return_value={"latitude": 40.7357, "longitude": -74.1724, "bbox": [40.7, -74.2, 40.8, -74.1]})
        mock_get_geo.return_value = service
        yield service


@pytest.fixture
def mock_settings():
    with patch("tta_backend.tools.ground_sensor_tools.airnow_tools.get_settings") as mock_get_set:
        settings = MagicMock(airnow_api_key="test-airnow-key")
        mock_get_set.return_value = settings
        yield settings


@pytest.mark.asyncio
async def test_airnow_rate_limiter_spacing():
    limiter = _AirNowRateLimiter(max_requests=5, window_seconds=10.0, min_spacing=0.05)
    t0 = asyncio.get_event_loop().time()
    await limiter.acquire()
    await limiter.acquire()
    t1 = asyncio.get_event_loop().time()
    assert t1 - t0 >= 0.04


def test_format_aqs_id():
    assert _format_aqs_id("340130003") == "34-013-0003"
    assert _format_aqs_id("840340130003") == "34-013-0003"
    assert _format_aqs_id("0003", state="34") == "34-0003"
    assert _format_aqs_id("") == "AirNow-Station"


@pytest.mark.asyncio
async def test_get_airnow_observation_missing_geocode():
    with patch("tta_backend.tools.ground_sensor_tools.airnow_tools.get_geocoding_service") as mock_get_geo:
        service = MagicMock()
        service.ageocode = AsyncMock(return_value=None)
        mock_get_geo.return_value = service

        result = await get_airnow_observation.ainvoke({"location": "NonexistentPlace"})
        assert result["Header"][0]["status"] == "error"
        assert "Could not geocode" in result["Header"][0]["message"]
        assert result["Body"] == []


@pytest.mark.asyncio
async def test_get_airnow_observation_success(mock_geocoding, mock_settings):
    mock_data = [
        {
            "DateObserved": "2024-05-01 ",
            "HourObserved": 17,
            "LocalTimeZone": "EST",
            "ReportingArea": "Newark",
            "StateCode": "NJ",
            "Latitude": 40.73,
            "Longitude": -74.17,
            "ParameterName": "O3",
            "AQI": 42,
            "Category": {"Number": 1, "Name": "Good"},
        },
        {
            "DateObserved": "2024-05-01 ",
            "HourObserved": 17,
            "LocalTimeZone": "EST",
            "ReportingArea": "Newark",
            "StateCode": "NJ",
            "Latitude": 40.73,
            "Longitude": -74.17,
            "ParameterName": "PM2.5",
            "AQI": 35,
            "Category": {"Number": 1, "Name": "Good"},
        },
    ]

    with patch("tta_backend.tools.ground_sensor_tools.airnow_tools._fetch_airnow", new_callable=AsyncMock) as mock_fetch, \
         patch("tta_backend.tools.ground_sensor_tools.airnow_tools.artifact_store.put_table") as mock_put_table:

        mock_fetch.return_value = mock_data
        fake_ref = MagicMock(id="tbl_airnow_123")
        fake_ref.model_dump.return_value = {"id": "tbl_airnow_123", "type": "table"}
        mock_put_table.return_value = fake_ref

        res = await get_airnow_observation.ainvoke({"location": "Newark, NJ"})

        assert res["Header"][0]["status"] == "success"
        assert res["Header"][0]["table_artifact_id"] == "tbl_airnow_123"
        assert res["Header"][0]["verified"] is False
        assert len(res["Body"]) == 2
        assert res["Body"][0]["parameter"] == "O3"
        assert res["Body"][0]["aqi"] == 42
        assert res["Body"][0]["verified"] is False
        assert res["_artifact_refs"][0]["id"] == "tbl_airnow_123"

        mock_put_table.assert_called_once()
        _, kwargs = mock_put_table.call_args
        assert kwargs["metadata"]["dataset"] == "EPA AirNow (Preliminary)"
        assert kwargs["metadata"]["has_coordinates"] is True
        assert kwargs["metadata"]["verified"] is False


@pytest.mark.asyncio
async def test_get_airnow_area_data_success(mock_geocoding, mock_settings):
    mock_area_data = [
        {
            "Latitude": 40.73,
            "Longitude": -74.17,
            "UTC": "2024-05-01T21:00",
            "Parameter": "O3",
            "Unit": "PPB",
            "Value": 35.0,
            "AQI": 42,
            "Category": 1,
            "SiteName": "Newark Lab",
            "AgencyName": "NJDEP",
            "FullAQSCode": "340130003",
        }
    ]

    with patch("tta_backend.tools.ground_sensor_tools.airnow_tools._fetch_airnow", new_callable=AsyncMock) as mock_fetch, \
         patch("tta_backend.tools.ground_sensor_tools.airnow_tools.artifact_store.put_table") as mock_put_table:

        mock_fetch.return_value = mock_area_data
        fake_ref = MagicMock(id="tbl_airnow_area_456")
        fake_ref.model_dump.return_value = {"id": "tbl_airnow_area_456", "type": "table"}
        mock_put_table.return_value = fake_ref

        res = await get_airnow_area_data.ainvoke({"location": "Newark, NJ", "distance_miles": 20})

        assert res["Header"][0]["status"] == "success"
        assert res["Header"][0]["table_artifact_id"] == "tbl_airnow_area_456"
        assert len(res["Body"]) == 1
        assert res["Body"][0]["site_id"] == "34-013-0003"
        assert res["Body"][0]["displayName"] == "Newark Lab (O3)"
        assert res["Body"][0]["primaryVal"] == 35.0


@pytest.mark.asyncio
async def test_airnow_negative_999_cleaned_to_none(mock_geocoding, mock_settings):
    mock_data = [
        {
            "Latitude": 40.73,
            "Longitude": -74.17,
            "UTC": "2024-05-01T21:00",
            "Parameter": "NO2",
            "Unit": "PPB",
            "Value": -999.0,
            "AQI": -999,
            "SiteName": "Newark Chestnut",
            "FullAQSCode": "340130005",
        }
    ]

    with patch("tta_backend.tools.ground_sensor_tools.airnow_tools._fetch_airnow", new_callable=AsyncMock) as mock_fetch, \
         patch("tta_backend.tools.ground_sensor_tools.airnow_tools.artifact_store.put_table") as mock_put_table:

        mock_fetch.return_value = mock_data
        fake_ref = MagicMock(id="tbl_clean_999")
        fake_ref.model_dump.return_value = {"id": "tbl_clean_999", "type": "table"}
        mock_put_table.return_value = fake_ref

        res = await get_airnow_observation.ainvoke({"location": "Newark, NJ"})
        assert len(res["Body"]) == 1
        assert res["Body"][0]["mean"] is None
        assert res["Body"][0]["max"] is None
        assert res["Body"][0]["primaryVal"] is None
        assert res["Body"][0]["aqi"] is None


@pytest.mark.asyncio
async def test_airnow_date_older_than_90_days_routes_to_epa_aqs(mock_geocoding, mock_settings):
    # Feb 6 2026 is > 90 days before Nov 2026
    res = await get_airnow_observation.ainvoke({"location": "Rutgers, NJ", "date": "2026-02-06"})
    assert res["Header"][0]["status"] == "use_epa_aqs"
    assert "Verified, certified EPA AQS data is available" in res["Header"][0]["message"]
    assert res["Body"] == []

    # With is_fallback=True, it allows calling AirNow
    with patch("tta_backend.tools.ground_sensor_tools.airnow_tools._fetch_airnow", new_callable=AsyncMock) as mock_fetch:
        mock_fetch.return_value = []
        res_fb = await get_airnow_observation.ainvoke({
            "location": "Rutgers, NJ", "date": "2026-02-06", "is_fallback": True
        })
        assert res_fb["Header"][0]["status"] == "no_data"

