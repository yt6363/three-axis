from __future__ import annotations

import anyio
from functools import partial
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import httpx
from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import List, Literal
import warnings

warnings.filterwarnings("ignore", category=FutureWarning, module="yfinance")

from .utils import (
    ALLOWED_PERIODS,
    DEFAULT_PERIOD,
    PANDAS_FREQ,
    FetchError,
    ResponseCache,
    dataframe_to_candles,
    fetch_bars,
    normalize_symbol,
)
from .swiss import compute_horizon, compute_monthly, compute_planetary_timeseries
from .orbital import compute_overlay_series
from .database import init_db, get_cached_month, cache_month, get_cache_stats


app = FastAPI(title="Candlestick Service", version="0.1.0")


@app.on_event("startup")
async def startup_event():
    """Initialize database on startup."""
    await init_db()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

cache = ResponseCache(ttl_seconds=120)
# Long-term cache for planetary events (1 hour - data doesn't change)
events_cache = ResponseCache(ttl_seconds=3600)
# Search cache (5 minutes - symbols don't change often)
search_cache = ResponseCache(ttl_seconds=300)


class SwissHorizonPayload(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    lat: float
    lon: float
    tz: str
    start_local_iso: str = Field(alias="startLocalISO", min_length=8)
    asc_hours: int = Field(alias="ascHours", ge=1, le=168)
    moon_days: float = Field(alias="moonDays", ge=1/24, le=120)
    ayanamsa: Literal["lahiri", "raman", "tropical"] = "lahiri"


class SwissMonthlyPayload(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    lat: float
    lon: float
    tz: str
    month_start_iso: str = Field(alias="monthStartISO", min_length=7)
    ayanamsa: Literal["lahiri", "raman", "tropical"] = "lahiri"


class SwissMonthlyBatchPayload(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    lat: float
    lon: float
    tz: str
    month_start_isos: List[str] = Field(alias="monthStartISOs", min_length=1, max_length=60)
    ayanamsa: Literal["lahiri", "raman", "tropical"] = "lahiri"


class OrbitalOverlayPayload(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    objects: List[str] = Field(min_length=1)
    start_iso: str = Field(alias="startISO", min_length=8)
    duration_unit: str = Field(alias="durationUnit")
    duration_value: int = Field(alias="durationValue", ge=1, le=1460)
    plot_speed: bool = Field(alias="plotSpeed", default=False)
    plot_grav_force: bool = Field(alias="plotGravForce", default=False)
    plot_geo_declination: bool = Field(alias="plotGeoDeclination", default=False)
    plot_helio_declination: bool = Field(alias="plotHelioDeclination", default=False)
    plot_weighted_geo: bool = Field(alias="plotWeightedGeo", default=False)
    plot_weighted_helio: bool = Field(alias="plotWeightedHelio", default=False)
    weights: dict[str, float] | None = None


class PlanetaryTimeseriesPayload(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    planet: str
    timestamps: List[int]


@app.get("/healthz")
async def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/cache/stats")
async def cache_stats():
    """Get database cache statistics."""
    stats = await get_cache_stats()
    return {"ok": True, **stats}


@app.get("/api/search")
async def search_symbols(
    q: str = Query(..., min_length=1, max_length=60, description="Search text"),
    limit: int = Query(8, ge=1, le=20, description="Maximum number of quotes"),
):
    # Check cache first
    cache_key = f"search|{q.lower()}|{limit}"
    cached = search_cache.get(cache_key)
    if cached is not None:
        return cached

    params = {"q": q, "quotesCount": limit, "newsCount": 0}
    headers = {"User-Agent": "jupiter-terminal/1.0", "Accept": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=2) as client:  # Reduced from 5s to 2s
            response = await client.get(
                "https://query1.finance.yahoo.com/v1/finance/search",
                params=params,
                headers=headers,
            )
        response.raise_for_status()
        payload = response.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=f"Upstream search failed ({exc.response.status_code})",
        ) from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Search request failed: {exc}") from exc

    quotes = []
    for item in payload.get("quotes", []):
        symbol = str(item.get("symbol") or "").upper()
        if not symbol:
            continue
        name = (
            item.get("shortname")
            or item.get("longname")
            or item.get("name")
            or symbol
        )
        exchange = item.get("exchDisp") or item.get("typeDisp") or ""
        quotes.append({"symbol": symbol, "name": name, "exchange": exchange})
        if len(quotes) >= limit:
            break

    result = {"quotes": quotes}
    search_cache.set(cache_key, result)
    return result


@app.get("/api/ohlc")
async def get_ohlc(
    symbol: str = Query(..., description="Yahoo Finance symbol e.g. AAPL or BTC USD"),
    interval: str = Query(..., description="One of 5m, 15m, 1h, 4h, 1d, 1wk, 1mo, 3mo"),
    period: str = Query(DEFAULT_PERIOD, description="History period such as 6mo or 1y"),
):
    requested_interval = interval.lower()
    requested_period = (period or DEFAULT_PERIOD).lower()

    if requested_interval not in PANDAS_FREQ:
        raise HTTPException(status_code=400, detail=f"Unsupported interval '{interval}'")

    if requested_period not in ALLOWED_PERIODS:
        raise HTTPException(status_code=400, detail=f"Unsupported period '{period}'")

    normalized_symbol = normalize_symbol(symbol)
    cache_key = f"{normalized_symbol}|{requested_interval}|{requested_period}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        frame = fetch_bars(normalized_symbol, requested_interval, requested_period)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FetchError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    payload = dataframe_to_candles(frame)
    if not payload:
        raise HTTPException(status_code=404, detail="No data available for the request")

    cache.set(cache_key, payload)
    return payload


@app.post("/api/swiss/horizon")
async def swiss_horizon(payload: SwissHorizonPayload):
    try:
        data = await anyio.to_thread.run_sync(
            compute_horizon,
            payload.lat,
            payload.lon,
            payload.tz,
            payload.start_local_iso,
            payload.asc_hours,
            payload.moon_days,
            payload.ayanamsa,  # Pass ayanamsa parameter
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - surfaces specific runtime issues
        raise HTTPException(status_code=500, detail=f"Swiss horizon failed: {exc}") from exc
    return {"ok": True, **data}


@app.post("/api/swiss/monthly")
async def swiss_monthly(payload: SwissMonthlyPayload):
    # Check cache first (include ayanamsa in key)
    cache_key = f"monthly|{payload.lat}|{payload.lon}|{payload.tz}|{payload.month_start_iso}|{payload.ayanamsa}"
    cached = events_cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        data = await anyio.to_thread.run_sync(
            compute_monthly,
            payload.lat,
            payload.lon,
            payload.tz,
            payload.month_start_iso,
            payload.ayanamsa,  # Pass ayanamsa parameter
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"Swiss monthly failed: {exc}") from exc

    result = {"ok": True, **data}
    events_cache.set(cache_key, result)
    return result


@app.post("/api/swiss/monthly/batch")
async def swiss_monthly_batch(payload: SwissMonthlyBatchPayload):
    """
    Batch endpoint to compute multiple months at once.
    Much faster than calling /monthly 60 times for 5 years!
    Returns cached data when available (checks DB first, then memory cache).
    """
    results = {}

    # Check which months are already cached (DB first, then memory)
    uncached_months = []
    for month_iso in payload.month_start_isos:
        # Try database first (permanent cache) - include ayanamsa
        db_cached = await get_cached_month(payload.lat, payload.lon, payload.tz, month_iso, payload.ayanamsa)
        if db_cached is not None:
            results[month_iso] = {"ok": True, **db_cached}
            continue

        # Try memory cache (faster but temporary) - include ayanamsa in key
        cache_key = f"monthly|{payload.lat}|{payload.lon}|{payload.tz}|{month_iso}|{payload.ayanamsa}"
        cached = events_cache.get(cache_key)
        if cached is not None:
            results[month_iso] = cached
        else:
            uncached_months.append(month_iso)

    # Compute uncached months in parallel
    if uncached_months:
        async def compute_one_month(month_iso: str):
            try:
                data = await anyio.to_thread.run_sync(
                    compute_monthly,
                    payload.lat,
                    payload.lon,
                    payload.tz,
                    month_iso,
                    payload.ayanamsa,  # Pass ayanamsa parameter
                )
                result = {"ok": True, **data}

                # Store in both memory cache and database - include ayanamsa
                cache_key = f"monthly|{payload.lat}|{payload.lon}|{payload.tz}|{month_iso}|{payload.ayanamsa}"
                events_cache.set(cache_key, result)
                await cache_month(payload.lat, payload.lon, payload.tz, month_iso, data, payload.ayanamsa)

                return month_iso, result
            except Exception as exc:
                # Return error for this specific month
                return month_iso, {"ok": False, "error": str(exc)}

        # Compute all uncached months with limited concurrency to prevent memory spikes
        import asyncio
        from asyncio import Semaphore

        # Limit to 6 concurrent computations - balances speed with memory usage
        # Railway Hobby: 512MB RAM, each computation ~50-80MB
        semaphore = Semaphore(6)

        async def compute_with_limit(month_iso: str):
            async with semaphore:
                return await compute_one_month(month_iso)

        tasks = [compute_with_limit(month_iso) for month_iso in uncached_months]
        computed_results = await asyncio.gather(*tasks)

        for month_iso, result in computed_results:
            results[month_iso] = result

    return {"ok": True, "months": results}


@app.post("/api/orbit/overlay")
async def orbital_overlay(payload: OrbitalOverlayPayload):
    # Create cache key from payload
    objects_key = "|".join(sorted(payload.objects))
    weights_key = "|".join(f"{k}:{v}" for k, v in sorted((payload.weights or {}).items()))
    flags_key = f"{payload.plot_speed}|{payload.plot_grav_force}|{payload.plot_geo_declination}|{payload.plot_helio_declination}|{payload.plot_weighted_geo}|{payload.plot_weighted_helio}"
    cache_key = f"overlay|{objects_key}|{payload.start_iso}|{payload.duration_unit}|{payload.duration_value}|{flags_key}|{weights_key}"

    # Check cache first
    cached = events_cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        worker = partial(
            compute_overlay_series,
            objects=payload.objects,
            start_iso=payload.start_iso,
            duration_unit=payload.duration_unit,
            duration_value=payload.duration_value,
            plot_speed=payload.plot_speed,
            plot_grav_force=payload.plot_grav_force,
            plot_geo_declination=payload.plot_geo_declination,
            plot_helio_declination=payload.plot_helio_declination,
            plot_weighted_geo=payload.plot_weighted_geo,
            plot_weighted_helio=payload.plot_weighted_helio,
            weights=payload.weights,
        )
        series = await anyio.to_thread.run_sync(worker)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"Orbital overlay failed: {exc}") from exc

    response = {
        "series": [
            {
                "name": item.name,
                "key": item.key,
                "objects": item.objects,
                "timestamps": [ts.isoformat() for ts in item.timestamps],
                "values": item.values,
            }
            for item in series
        ]
    }

    # Cache the response
    events_cache.set(cache_key, response)
    return response


@app.post("/api/planetary/timeseries")
async def planetary_timeseries(payload: PlanetaryTimeseriesPayload):
    try:
        data = await anyio.to_thread.run_sync(
            compute_planetary_timeseries,
            payload.planet,
            payload.timestamps,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"Planetary timeseries failed: {exc}") from exc

    return {"ok": True, "data": data}


def create_app() -> FastAPI:
    return app
