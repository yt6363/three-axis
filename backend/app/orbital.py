from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable, List, Sequence

import numpy as np
import certifi  # type: ignore
from astropy.constants import G, M_earth, M_sun
from astropy.coordinates import (
    GCRS,
    ICRS,
    SkyCoord,
    get_body,
    get_sun,
    solar_system_ephemeris,
)
from astropy.coordinates.solar_system import get_body_barycentric
from astropy.time import Time

CERT_PATH = certifi.where()
if CERT_PATH:
    os.environ.setdefault("SSL_CERT_FILE", CERT_PATH)

EPHEMERIS_PATH = os.path.join(os.getcwd(), "de421.bsp")


@dataclass(slots=True)
class OverlaySeries:
    name: str
    key: str
    objects: List[str]
    timestamps: List[datetime]
    values: List[float]


def _ephem_ctx():
    try:
        if os.path.exists(EPHEMERIS_PATH):
            return solar_system_ephemeris.set(EPHEMERIS_PATH)
    except Exception:  # pragma: no cover - falls back gracefully
        pass
    return solar_system_ephemeris.set("builtin")


def _rescale_to_bounds(values: Iterable[float], lo: float, hi: float) -> np.ndarray:
    arr = np.asarray(list(values), dtype=float)
    with np.errstate(invalid="ignore"):
        vmin = np.nanmin(arr)
        vmax = np.nanmax(arr)
    if not np.isfinite(vmin) or not np.isfinite(vmax) or vmin == vmax:
        fill = (lo + hi) / 2.0
        return np.full_like(arr, fill, dtype=float)
    scale = (hi - lo) / (vmax - vmin)
    return lo + (arr - vmin) * scale


def _get_moon(time: Time):
    with solar_system_ephemeris.set("builtin"):
        return get_body("moon", time)


def _orbital_speed(distance_m: float, mu_sun: float) -> float:
    return float(np.sqrt(mu_sun / distance_m))


def _gravitational_force(m1: float, m2: float, distance_m: float) -> float:
    return (G.value * m1 * m2) / (distance_m ** 2)


def _body_position(name: str, time: Time):
    if name == "sun":
        return get_sun(time)
    if name == "moon":
        return _get_moon(time)
    with _ephem_ctx():
        return get_body(name, time)


def _declination_geocentric(name: str, time: Time) -> float:
    if name == "sun":
        pos = get_sun(time)
    elif name == "moon":
        pos = _get_moon(time)
    else:
        with _ephem_ctx():
            pos = get_body(name, time)
    coord = SkyCoord(pos)
    return coord.transform_to(GCRS(obstime=time)).dec.degree


def _declination_heliocentric(name: str, time: Time) -> float:
    with _ephem_ctx():
        body_vec = get_body_barycentric(name, time)
        sun_vec = get_body_barycentric("sun", time)
    rel = body_vec - sun_vec
    icrs = ICRS(
        x=rel.x,
        y=rel.y,
        z=rel.z,
        representation_type="cartesian",
    )
    return icrs.spherical.lat.degree


MASS_LOOKUP = {
    "mercury": 3.3011e23,
    "venus": 4.8675e24,
    "earth": 5.97237e24,
    "mars": 6.4171e23,
    "jupiter": 1.8982e27,
    "saturn": 5.6834e26,
    "uranus": 8.6810e25,
    "neptune": 1.02413e26,
    "moon": M_earth.value * 0.0123,
    "sun": M_sun.value,
}


def _unit_days(unit: str) -> int:
    mapping = {"years": 365, "months": 30, "weeks": 7, "days": 1}
    if unit not in mapping:
        raise ValueError(f"Unsupported duration unit '{unit}'")
    return mapping[unit]


def compute_overlay_series(
    *,
    objects: Sequence[str],
    start_iso: str,
    duration_unit: str,
    duration_value: int,
    plot_speed: bool,
    plot_grav_force: bool,
    plot_geo_declination: bool,
    plot_helio_declination: bool,
    plot_weighted_geo: bool,
    plot_weighted_helio: bool,
    weights: dict[str, float] | None = None,
) -> List[OverlaySeries]:
    if duration_value <= 0:
        raise ValueError("duration_value must be positive")
    normalized = [obj.strip().lower() for obj in objects if obj.strip()]
    if not normalized:
        raise ValueError("At least one object is required")

    # Build observation window at one-day cadence
    base_time = Time(start_iso)
    total_days = _unit_days(duration_unit) * duration_value
    if total_days <= 0:
        raise ValueError("Computed duration must be positive")

    obs_times = Time(
        np.linspace(base_time.jd, base_time.jd + total_days, total_days + 1),
        format="jd",
    )
    timestamps = list(obs_times.datetime)
    if not timestamps:
        raise ValueError("No timestamps generated for overlay request")

    mu_sun = G.value * M_sun.value
    series: List[OverlaySeries] = []
    weights = {k.lower(): float(v) for k, v in (weights or {}).items()}

    def add_series(name: str, key: str, values: Sequence[float], series_objects: Sequence[str]):
        array = np.asarray(list(values), dtype=float)
        mask = np.isfinite(array)
        if not mask.any():
            return
        filtered_ts = [timestamps[idx] for idx, ok in enumerate(mask) if ok]
        filtered_vals = array[mask].tolist()
        if not filtered_ts:
            return
        series.append(
            OverlaySeries(
                name=name,
                key=key,
                objects=list(series_objects),
                timestamps=filtered_ts,
                values=filtered_vals,
            ),
        )

    if plot_weighted_geo or plot_weighted_helio:
        if plot_weighted_geo:
            raw = []
            for time in obs_times:
                total = 0.0
                for obj in normalized:
                    total += weights.get(obj, 0.0) * _declination_geocentric(obj, time)
                raw.append(total)
            add_series(
                "Weighted Geo-Dec (±23.44°)",
                "weighted_geo_declination",
                _rescale_to_bounds(raw, -23.44, 23.44),
                normalized,
            )

        if plot_weighted_helio:
            raw = []
            for time in obs_times:
                total = 0.0
                for obj in normalized:
                    total += weights.get(obj, 0.0) * _declination_heliocentric(obj, time)
                raw.append(total)
            add_series(
                "Weighted Helio-Dec (±23.44°)",
                "weighted_helio_declination",
                _rescale_to_bounds(raw, -23.44, 23.44),
                normalized,
            )
        return series

    if plot_speed:
        for obj in normalized:
            vals = []
            for time in obs_times:
                dist = _body_position(obj, time).distance.to("m").value
                vals.append(_orbital_speed(dist, mu_sun))
            add_series(
                f"{obj.capitalize()} Speed (m/s)",
                f"{obj}_speed",
                vals,
                [obj],
            )

    if plot_grav_force:
        for obj in normalized:
            if obj not in MASS_LOOKUP:
                raise ValueError(f"Unknown mass for object '{obj}'")
            vals = []
            for time in obs_times:
                dist = _body_position(obj, time).distance.to("m").value
                vals.append(_gravitational_force(MASS_LOOKUP[obj], M_sun.value, dist))
            add_series(
                f"{obj.capitalize()} Force (N)",
                f"{obj}_force",
                vals,
                [obj],
            )

    if plot_geo_declination:
        for obj in normalized:
            vals = [_declination_geocentric(obj, time) for time in obs_times]
            add_series(
                f"{obj.capitalize()} Geo-Dec (°)",
                f"{obj}_geo_dec",
                vals,
                [obj],
            )

    if plot_helio_declination:
        for obj in normalized:
            vals = [_declination_heliocentric(obj, time) for time in obs_times]
            add_series(
                f"{obj.capitalize()} Helio-Dec (°)",
                f"{obj}_helio_dec",
                vals,
                [obj],
            )

    return series
