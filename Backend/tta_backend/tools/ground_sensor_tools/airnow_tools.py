"""
airnow_tools.py
---------------
EPA AirNow REST API tools for preliminary real-time and near-real-time ground monitoring data.
Provides recent observations (hourly, current, area) that bridge the ~90-day EPA AQS publication lag.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

import httpx
from langchain_core.tools import tool

from tta_backend.config.settings import get_settings
from tta_backend.services.artifact_store import artifact_store
from tta_backend.utils.plotting import get_geocoding_service

logger = logging.getLogger(__name__)

AIRNOW_BASE_URL = "https://www.airnowapi.org/aq"
DEFAULT_TIMEOUT = 25.0

# Tracks the latest valid AirNow payload for raw-data fallback upon unexpected turn interruptions
_last_airnow_raw_data: Any = None


def get_last_airnow_raw_json_snippet() -> str | None:
    data = _last_airnow_raw_data
    if not data or (isinstance(data, dict) and "error" in data):
        return None
    try:
        formatted = json.dumps(data, indent=2)
        if len(formatted) > 3500:
            formatted = formatted[:3500] + "\n... (truncated)"
        return formatted
    except Exception:
        return None


# In-memory sliding-window rate limiter (500 req/hour limit, ~8 req/min)
class _AirNowRateLimiter:
    def __init__(self, max_requests: int = 8, window_seconds: float = 60.0, min_spacing: float = 0.5) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.min_spacing = min_spacing
        self._timestamps: list[float] = []
        self._last_call: float = 0.0
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            elapsed_since_last = now - self._last_call
            if elapsed_since_last < self.min_spacing:
                await asyncio.sleep(self.min_spacing - elapsed_since_last)
                now = time.monotonic()

            self._timestamps = [t for t in self._timestamps if now - t < self.window_seconds]
            if len(self._timestamps) >= self.max_requests:
                sleep_needed = self.window_seconds - (now - self._timestamps[0])
                if sleep_needed > 0:
                    logger.info("AirNow rate limit backoff: sleeping %.2fs", sleep_needed)
                    await asyncio.sleep(sleep_needed)
                    now = time.monotonic()
                    self._timestamps = [t for t in self._timestamps if now - t < self.window_seconds]

            self._timestamps.append(now)
            self._last_call = now


_limiter = _AirNowRateLimiter()
_response_cache: dict[str, tuple[float, Any]] = {}
CACHE_TTL_CURRENT = 600.0   # 10 minutes
CACHE_TTL_HISTORICAL = 3600.0  # 1 hour


def _get_api_key() -> str:
    settings = get_settings()
    key = getattr(settings, "airnow_api_key", "")
    if not key:
        logger.warning("AIRNOW_API_KEY is not configured in settings or environment.")
    return key


def _table_columns(rows: List[Dict[str, Any]]) -> list[str]:
    cols: list[str] = []
    seen = set()
    for r in rows:
        for k in r:
            if k not in seen:
                seen.add(k)
                cols.append(k)
    return cols


def _has_coordinates(rows: List[Dict[str, Any]]) -> bool:
    return any(
        isinstance(r, dict) and r.get("latitude") is not None and r.get("longitude") is not None
        for r in rows
    )


def _build_artifact_response(
    header: list[dict[str, Any]], body: list[dict[str, Any]], title: str, metadata: dict[str, Any] | None = None,
) -> Dict[str, Any]:
    meta = {
        "dataset": "EPA AirNow (Preliminary)",
        "has_coordinates": _has_coordinates(body),
        "verified": False,
        **(metadata or {}),
    }
    artifact_ref = artifact_store.put_table(title=title, columns=_table_columns(body), rows=body, metadata=meta)
    header[0]["artifact_count"] = 1
    header[0]["table_artifact_id"] = artifact_ref.id
    header[0]["verified"] = False
    header[0]["caveat"] = "Preliminary unverified real-time data from EPA AirNow, subject to validation."
    return {"Header": header, "Body": body, "_artifact_refs": [artifact_ref.model_dump(exclude_none=True)]}


async def _fetch_airnow(endpoint: str, params: dict[str, Any], ttl: float = CACHE_TTL_CURRENT) -> Any:
    global _last_airnow_raw_data
    key = _get_api_key()
    if not key:
        return {"error": "AIRNOW_API_KEY is missing. Configure it in .env or settings."}

    req_params = {**params, "API_KEY": key, "format": "application/json"}
    cache_key = f"{endpoint}?{urlencode(sorted(req_params.items()))}"

    now = time.monotonic()
    if cache_key in _response_cache:
        cached_time, cached_val = _response_cache[cache_key]
        if now - cached_time < ttl:
            return cached_val

    await _limiter.acquire()
    url = f"{AIRNOW_BASE_URL}/{endpoint.lstrip('/')}"
    try:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
            resp = await client.get(url, params=req_params)
            if resp.status_code == 429:
                logger.warning("AirNow upstream 429 rate limit reached.")
                return {"error": "AirNow upstream rate limit reached. Please retry shortly."}
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, (list, dict)) and "error" not in data:
                _last_airnow_raw_data = data
            _response_cache[cache_key] = (now, data)
            return data
    except httpx.HTTPStatusError as e:
        logger.error("AirNow HTTP status error: %s (%s)", e.response.status_code, e.response.text)
        return {"error": f"AirNow HTTP {e.response.status_code}: {e.response.text}"}
    except Exception as e:
        logger.error("AirNow request failed: %s", str(e))
        return {"error": f"AirNow request failed: {str(e)}"}


def _format_aqs_id(raw_code: Any, state: str | None = None) -> str:
    s = str(raw_code or "").strip()
    if len(s) == 9:
        return f"{s[:2]}-{s[2:5]}-{s[5:]}"
    if len(s) == 12 and s.startswith("840"):
        return f"{s[3:5]}-{s[5:8]}-{s[8:]}"
    if state and s:
        return f"{state}-{s}"
    return s or "AirNow-Station"


@tool
async def get_airnow_observation(location: str, date: Optional[str] = None, distance_miles: int = 25) -> Dict[str, Any]:
    """Retrieve current or recent unverified ground sensor observations from EPA AirNow.

    Use this tool when queried for current air quality, today, yesterday, or dates within
    the last 90 days where EPA AQS certification lag prevents data availability.

    Parameters
    ----------
    location : str
        City, state, or address (e.g., 'Newark, NJ', 'Los Angeles, CA') to geocode.
    date : Optional[str]
        Target date in YYYY-MM-DD format. If omitted or 'today', queries current observations.
    distance_miles : int
        Search radius in miles around the geocoded coordinates (default: 25).
    """
    geo_service = get_geocoding_service()
    geo = await geo_service.ageocode(location)
    if not geo:
        return {"Header": [{"status": "error", "message": f"Could not geocode location: '{location}'"}], "Body": []}

    lat, lon = geo["latitude"], geo["longitude"]
    lat_delta = max(0.08, distance_miles / 69.0)
    lon_delta = max(0.08, distance_miles / max(1.0, (69.0 * math.cos(math.radians(lat)))))
    min_lat, max_lat = round(lat - lat_delta, 4), round(lat + lat_delta, 4)
    min_lon, max_lon = round(lon - lon_delta, 4), round(lon + lon_delta, 4)
    bbox = f"{min_lon},{min_lat},{max_lon},{max_lat}"

    now_utc = datetime.now(timezone.utc)
    if date and date.strip().lower() not in {"today", "current", "now"}:
        try:
            target_dt = datetime.fromisoformat(date.strip().split("T")[0])
            start_str = target_dt.strftime("%Y-%m-%dT00")
            end_str = target_dt.strftime("%Y-%m-%dT23")
            ttl = CACHE_TTL_HISTORICAL
        except ValueError:
            start_str = (now_utc - timedelta(hours=3)).strftime("%Y-%m-%dT%H")
            end_str = now_utc.strftime("%Y-%m-%dT%H")
            ttl = CACHE_TTL_CURRENT
    else:
        start_str = (now_utc - timedelta(hours=3)).strftime("%Y-%m-%dT%H")
        end_str = now_utc.strftime("%Y-%m-%dT%H")
        ttl = CACHE_TTL_CURRENT

    query_params = {
        "startDate": start_str,
        "endDate": end_str,
        "parameters": "O3,PM25,NO2",
        "BBOX": bbox,
        "dataType": "B",
        "verbose": 1,
    }

    data = await _fetch_airnow("data/", query_params, ttl=ttl)
    if isinstance(data, dict) and "error" in data:
        return {"Header": [{"status": "upstream_error", "message": data["error"]}], "Body": []}
    if not isinstance(data, list) or not data:
        return {
            "Header": [{"status": "no_data", "location": location, "latitude": lat, "longitude": lon, "rows": 0}],
            "Body": [],
        }

    body: list[dict[str, Any]] = []
    for r in data:
        site_lat = r.get("Latitude", lat)
        site_lon = r.get("Longitude", lon)
        param = r.get("Parameter") or "AQI"
        unit = r.get("Unit") or "PPB"
        raw_val = r.get("Value")
        aqi_val = r.get("AQI")
        val = raw_val if raw_val is not None and raw_val != -999 else aqi_val
        site_name = r.get("SiteName") or r.get("AgencyName") or location
        site_code = _format_aqs_id(r.get("FullAQSCode") or r.get("IntlAQSCode"))

        body.append({
            "site_id": site_code,
            "local_site_name": site_name,
            "displayName": f"{site_name} ({param})",
            "latitude": site_lat,
            "longitude": site_lon,
            "parameter": param,
            "pollutant_standard": f"AirNow {param} ({unit})",
            "mean": val,
            "max": val,
            "primaryVal": val,
            "aqi": aqi_val,
            "category": str(r.get("Category", "")),
            "units": unit,
            "date": r.get("UTC", ""),
            "verified": False,
        })

    title = f"AirNow Observations - {location}"
    header = [{
        "status": "success",
        "rows": len(body),
        "location": location,
        "latitude": lat,
        "longitude": lon,
        "verified": False,
    }]
    return _build_artifact_response(header, body, title=title, metadata={"location": location, "query_type": "observation"})


@tool
async def get_airnow_area_data(
    location: str, date: Optional[str] = None, parameters: Optional[str] = None, distance_miles: int = 40,
) -> Dict[str, Any]:
    """Retrieve multi-station raw air quality monitoring records across an area from EPA AirNow.

    Provides observations suitable for station mapping across a region within the recent
    unverified window.

    Parameters
    ----------
    location : str
        City, state, or region name to geocode and center bounding box around.
    date : Optional[str]
        Date in YYYY-MM-DD format (defaults to current day).
    parameters : Optional[str]
        Comma-separated pollutant codes: 'O3,PM25,NO2,CO,SO2' (defaults to 'O3,PM25').
    distance_miles : int
        Radius in miles to compute the search bounding box (default: 40).
    """
    geo_service = get_geocoding_service()
    geo = await geo_service.ageocode(location)
    if not geo:
        return {"Header": [{"status": "error", "message": f"Could not geocode location: '{location}'"}], "Body": []}

    lat, lon = geo["latitude"], geo["longitude"]
    lat_delta = max(0.1, distance_miles / 69.0)
    lon_delta = max(0.1, distance_miles / max(1.0, (69.0 * math.cos(math.radians(lat)))))
    min_lat, max_lat = round(lat - lat_delta, 4), round(lat + lat_delta, 4)
    min_lon, max_lon = round(lon - lon_delta, 4), round(lon + lon_delta, 4)
    bbox = f"{min_lon},{min_lat},{max_lon},{max_lat}"

    now_utc = datetime.now(timezone.utc)
    if date and date.strip().lower() not in {"today", "current", "now"}:
        try:
            target_dt = datetime.fromisoformat(date.strip().split("T")[0])
            start_str = target_dt.strftime("%Y-%m-%dT00")
            end_str = target_dt.strftime("%Y-%m-%dT23")
        except ValueError:
            start_str = (now_utc - timedelta(hours=3)).strftime("%Y-%m-%dT%H")
            end_str = now_utc.strftime("%Y-%m-%dT%H")
    else:
        start_str = (now_utc - timedelta(hours=3)).strftime("%Y-%m-%dT%H")
        end_str = now_utc.strftime("%Y-%m-%dT%H")

    params_str = parameters if parameters else "O3,PM25,NO2"
    query_params = {
        "startDate": start_str,
        "endDate": end_str,
        "parameters": params_str,
        "BBOX": bbox,
        "dataType": "B",
        "verbose": 1,
    }

    data = await _fetch_airnow("data/", query_params, ttl=CACHE_TTL_HISTORICAL)
    if isinstance(data, dict) and "error" in data:
        return {"Header": [{"status": "upstream_error", "message": data["error"]}], "Body": []}
    if not isinstance(data, list) or not data:
        return {
            "Header": [{"status": "no_data", "location": location, "bbox": bbox, "rows": 0}],
            "Body": [],
        }

    body: list[dict[str, Any]] = []
    for r in data:
        site_lat = r.get("Latitude")
        site_lon = r.get("Longitude")
        param = r.get("Parameter") or "AQI"
        unit = r.get("Unit") or "PPB"
        raw_val = r.get("Value")
        aqi_val = r.get("AQI")
        val = raw_val if raw_val is not None and raw_val != -999 else aqi_val
        site_name = r.get("SiteName") or r.get("AgencyName") or "Monitor"
        site_code = _format_aqs_id(r.get("FullAQSCode") or r.get("IntlAQSCode"))

        body.append({
            "site_id": site_code,
            "local_site_name": site_name,
            "displayName": f"{site_name} ({param})",
            "latitude": site_lat,
            "longitude": site_lon,
            "parameter": param,
            "pollutant_standard": f"AirNow {param} ({unit})",
            "mean": val,
            "max": val,
            "primaryVal": val,
            "aqi": aqi_val,
            "category": str(r.get("Category", "")),
            "units": unit,
            "date": r.get("UTC", ""),
            "verified": False,
        })

    title = f"AirNow Regional Stations - {location}"
    header = [{
        "status": "success",
        "rows": len(body),
        "location": location,
        "bbox": bbox,
        "verified": False,
    }]
    return _build_artifact_response(header, body, title=title, metadata={"location": location, "bbox": bbox, "query_type": "area"})
