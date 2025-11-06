from __future__ import annotations

import math
import os
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Literal, Optional, Sequence, Tuple

from zoneinfo import ZoneInfo

try:
    import swisseph as swe
except ImportError as exc:  # pragma: no cover - hard failure surfaced in API layer
    raise RuntimeError(
        "pyswisseph is required but not installed; make sure backend/requirements.txt was applied"
    ) from exc


RASHI = [
    "Mesha",
    "Vrishabha",
    "Mithuna",
    "Karka",
    "Simha",
    "Kanya",
    "Tula",
    "Vrischika",
    "Dhanu",
    "Makara",
    "Kumbha",
    "Meena",
]

PLANET_INGRESS_NAMES: Sequence[str] = [
    "Mercury",
    "Venus",
    "Mars",
    "Jupiter",
    "Saturn",
    "Uranus",
    "Neptune",
    "Pluto",
    "Rahu",
    "Ketu",
]

STATION_PLANET_NAMES: Sequence[str] = [
    "Mercury",
    "Venus",
    "Mars",
    "Jupiter",
    "Saturn",
    "Uranus",
    "Neptune",
    "Pluto",
]

COMBUSTION_ORBS: Dict[str, float] = {
    "Mercury": 14,
    "Venus": 10,
    "Mars": 17,
    "Jupiter": 11,
    "Saturn": 15,
    "Uranus": 10,
    "Neptune": 10,
    "Pluto": 10,
    "Moon": 12,
}

PLANET_IDS: Dict[str, int] = {
    "Sun": swe.SUN,
    "Moon": swe.MOON,
    "Mercury": swe.MERCURY,
    "Venus": swe.VENUS,
    "Mars": swe.MARS,
    "Jupiter": swe.JUPITER,
    "Saturn": swe.SATURN,
    "Uranus": swe.URANUS,
    "Neptune": swe.NEPTUNE,
    "Pluto": swe.PLUTO,
    "Rahu": swe.TRUE_NODE,
    "Ketu": swe.TRUE_NODE,
}

PlanetName = Literal[
    "Sun",
    "Moon",
    "Mercury",
    "Venus",
    "Mars",
    "Jupiter",
    "Saturn",
    "Uranus",
    "Neptune",
    "Pluto",
    "Rahu",
    "Ketu",
]

NAKSHATRA_NAMES: Sequence[str] = [
    "Ashwini",
    "Bharani",
    "Krittika",
    "Rohini",
    "Mrigashira",
    "Ardra",
    "Punarvasu",
    "Pushya",
    "Ashlesha",
    "Magha",
    "Purva Phalguni",
    "Uttara Phalguni",
    "Hasta",
    "Chitra",
    "Swati",
    "Vishakha",
    "Anuradha",
    "Jyeshtha",
    "Moola",
    "Purva Ashadha",
    "Uttara Ashadha",
    "Shravana",
    "Dhanishta",
    "Shatabhisha",
    "Purva Bhadrapada",
    "Uttara Bhadrapada",
    "Revati",
]

NAKSHATRA_SEGMENT_DEG = 360.0 / 27.0
PADA_SEGMENT_DEG = NAKSHATRA_SEGMENT_DEG / 4.0

VELOCITY_PLANETS: Tuple[str, ...] = (
    "Sun",
    "Moon",
    "Mercury",
    "Venus",
    "Mars",
    "Jupiter",
    "Saturn",
    "Uranus",
    "Neptune",
    "Pluto",
)

VELOCITY_STEP_MINUTES: Dict[str, int] = {
    "Moon": 5,
    "Mercury": 10,
    "Venus": 15,
    "Sun": 30,
    "Mars": 60,
    "Jupiter": 120,
    "Saturn": 120,
    "Uranus": 240,
    "Neptune": 240,
    "Pluto": 240,
}

VELOCITY_REFINE_HALF_WINDOW = timedelta(hours=6)
VELOCITY_CURV_DELTA = timedelta(minutes=2)
VELOCITY_TIME_TOL = timedelta(minutes=6)
VELOCITY_VALUE_EPS = 1e-4


@dataclass
class SignChange:
    time_utc: datetime
    from_index: int
    to_index: int


@dataclass
class StationEvent:
    planet: str
    time_utc: datetime
    kind: Literal["retrograde", "direct"]


@dataclass
class StationWindow:
    planet: str
    start_iso: str
    end_iso: Optional[str]


_INIT_LOCK = threading.Lock()
_INITIALISED = False


def _candidate_ephe_paths() -> Iterable[Path]:
    env = os.environ.get("SWISS_EPHE_PATH")
    if env:
        yield Path(env)

    base = Path(__file__).resolve().parents[2]
    yield base / "vedic-ui" / "node_modules" / "swisseph" / "ephe"
    yield base / "swisseph" / "ephe"
    yield Path("/usr/share/swisseph")


def _initialise_once() -> None:
    global _INITIALISED
    if _INITIALISED:
        return
    with _INIT_LOCK:
        if _INITIALISED:
            return
        swe.set_sid_mode(swe.SIDM_RAMAN, 0, 0)
        for candidate in _candidate_ephe_paths():
            if candidate.is_dir():
                swe.set_ephe_path(str(candidate))
                break
        _INITIALISED = True


def _mod360(value: float) -> float:
    r = math.fmod(value, 360.0)
    return r + 360.0 if r < 0.0 else r


def _angdiff(a: float, b: float) -> float:
    d = _mod360(a - b)
    return d - 360.0 if d > 180.0 else d


def _abs_sep(a: float, b: float) -> float:
    return abs(_angdiff(a, b))


def _sign_index(deg: float) -> int:
    return int(math.floor(_mod360(deg) / 30.0))


def _to_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _from_iso_local(iso_value: str, tz_name: str) -> datetime:
    tz = ZoneInfo(tz_name)
    dt = datetime.fromisoformat(iso_value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=tz)
    else:
        dt = dt.astimezone(tz)
    return dt


def _format_local(dt: datetime, tz_name: str) -> str:
    tz = ZoneInfo(tz_name)
    local = _to_utc(dt).astimezone(tz)
    return local.strftime("%Y-%m-%d %H:%M:%S")


def _datetime_range_seconds(a: datetime, b: datetime) -> float:
    return (b - a).total_seconds()


def _mid_datetime(a: datetime, b: datetime) -> datetime:
    return datetime.fromtimestamp(
        (_to_utc(a).timestamp() + _to_utc(b).timestamp()) / 2,
        tz=timezone.utc,
    )


def _julday(dt: datetime) -> float:
    utc = _to_utc(dt)
    return utc.timestamp() / 86400.0 + 2440587.5


def _ascendant_sidereal_deg(dt: datetime, lat: float, lon: float) -> float:
    jd = _julday(dt)
    try:
        _, ascmc = swe.houses(jd, lat, lon, b"P")
    except swe.Error:
        return float("nan")
    asc_tropical = ascmc[0]
    ay = swe.get_ayanamsa_ut(jd)
    return _mod360(asc_tropical - ay)


def _planet_lon_speed(
    dt: datetime, planet: int, with_speed: bool = False
) -> Tuple[float, Optional[float]]:
    jd = _julday(dt)
    flags = swe.FLG_MOSEPH | swe.FLG_SIDEREAL
    if with_speed:
        flags |= swe.FLG_SPEED
    try:
        xx, _ = swe.calc_ut(jd, planet, flags)
    except swe.Error:
        return float("nan"), None
    lon = _mod360(xx[0])
    speed = xx[3] if with_speed else None
    return lon, speed


def _planet_lon_only(dt: datetime, planet: int) -> float:
    lon, _ = _planet_lon_speed(dt, planet, False)
    return lon


def _planet_speed_deg_per_day(dt: datetime, planet: int) -> float:
    _, speed = _planet_lon_speed(dt, planet, True)
    if speed is None or not math.isfinite(speed):
        return float("nan")
    return float(speed)


def _parabolic_vertex_time(
    t1: datetime,
    v1: float,
    t2: datetime,
    v2: float,
    t3: datetime,
    v3: float,
) -> datetime:
    if not all(math.isfinite(x) for x in (v1, v2, v3)):
        return t2
    x1 = (_to_utc(t1).timestamp() - _to_utc(t2).timestamp())
    x3 = (_to_utc(t3).timestamp() - _to_utc(t2).timestamp())
    if x1 == 0 or x3 == 0:
        return t2
    # Solve for coefficients of y = ax^2 + bx + c with c = v2
    denom = (x1 * x1 * x3 - x3 * x3 * x1)
    if denom == 0:
        return t2
    a = ((v1 - v2) * x3 - (v3 - v2) * x1) / denom
    if abs(a) < 1e-12:
        return t2
    b = (v1 - v2 - a * x1 * x1) / x1
    x0 = -b / (2 * a)
    t_seconds = _to_utc(t2).timestamp() + x0
    return datetime.fromtimestamp(t_seconds, tz=timezone.utc)


def _curvature_kind(
    planet_name: str,
    t: datetime,
    start: datetime,
    end: datetime,
) -> Tuple[str, float]:
    planet_id = PLANET_IDS[planet_name]
    def sample(dt: datetime) -> float:
        clamped = min(max(dt, start), end)
        return _planet_speed_deg_per_day(clamped, planet_id)

    vd = sample(t - VELOCITY_CURV_DELTA)
    v0 = sample(t)
    vp = sample(t + VELOCITY_CURV_DELTA)
    if not all(math.isfinite(x) for x in (vd, v0, vp)):
        return "max", 0.0
    curvature = vd - 2.0 * v0 + vp
    return ("max" if curvature < 0 else "min", abs(curvature))


def _refine_velocity_extremum(
    planet_name: str,
    hint: datetime,
    start: datetime,
    end: datetime,
) -> Tuple[datetime, float, str, float]:
    planet_id = PLANET_IDS[planet_name]
    left = max(start, hint - VELOCITY_REFINE_HALF_WINDOW)
    right = min(end, hint + VELOCITY_REFINE_HALF_WINDOW)
    v_left = _planet_speed_deg_per_day(left, planet_id)
    v_mid = _planet_speed_deg_per_day(hint, planet_id)
    v_right = _planet_speed_deg_per_day(right, planet_id)
    refined = _parabolic_vertex_time(left, v_left, hint, v_mid, right, v_right)
    if refined < left:
        refined = left
    elif refined > right:
        refined = right
    speed = _planet_speed_deg_per_day(refined, planet_id)
    kind, curvature = _curvature_kind(planet_name, refined, start, end)
    return refined, speed, kind, curvature


def _velocity_brackets_for_planet(
    planet_name: str,
    start: datetime,
    end: datetime,
    step_minutes: int,
) -> List[datetime]:
    planet_id = PLANET_IDS[planet_name]
    step = timedelta(minutes=step_minutes)
    brackets: List[datetime] = []
    t_prev = start
    v_prev = _planet_speed_deg_per_day(t_prev, planet_id)
    t_curr = min(start + step, end)
    v_curr = _planet_speed_deg_per_day(t_curr, planet_id)
    while t_curr < end:
        t_next = min(t_curr + step, end)
        if t_next <= t_curr:
            break
        v_next = _planet_speed_deg_per_day(t_next, planet_id)
        if all(math.isfinite(x) for x in (v_prev, v_curr, v_next)):
            if v_curr > v_prev and v_curr > v_next:
                brackets.append(t_curr)
            elif v_curr < v_prev and v_curr < v_next:
                brackets.append(t_curr)
        t_prev, v_prev = t_curr, v_curr
        t_curr, v_curr = t_next, v_next
    return brackets


def _velocity_extrema_for_planet(
    planet_name: str,
    start: datetime,
    end: datetime,
) -> List[Dict[str, object]]:
    step = VELOCITY_STEP_MINUTES.get(planet_name, 60)
    hints = _velocity_brackets_for_planet(planet_name, start, end, step)
    raw: List[Dict[str, object]] = []
    for hint in hints:
        refined, speed, kind, curvature = _refine_velocity_extremum(
            planet_name, hint, start, end
        )
        if not math.isfinite(speed):
            continue
        raw.append(
            {
                "planet": planet_name,
                "time_utc": refined,
                "speed": speed,
                "kind": kind,
                "curvature": curvature,
            }
        )

    if not raw:
        return []

    raw.sort(key=lambda row: row["time_utc"])  # type: ignore[arg-type]
    deduped: List[Dict[str, object]] = []
    for entry in raw:
        if (
            deduped
            and deduped[-1]["planet"] == entry["planet"]
            and abs(
                _datetime_range_seconds(
                    deduped[-1]["time_utc"], entry["time_utc"]  # type: ignore[arg-type]
                )
            )
            <= VELOCITY_TIME_TOL.total_seconds()
            and abs(deduped[-1]["speed"] - entry["speed"]) <= VELOCITY_VALUE_EPS  # type: ignore[operator]
        ):
            if entry["curvature"] > deduped[-1]["curvature"]:  # type: ignore[operator]
                deduped[-1] = entry
        else:
            deduped.append(entry)
    return deduped


def _refine_boundary(
    fn, left: datetime, right: datetime, desired_seconds: float = 1.0
) -> datetime:
    a = _to_utc(left)
    b = _to_utc(right)
    s_left = _sign_index(fn(a))
    s_right = _sign_index(fn(b))
    if s_left == s_right:
        return b
    while _datetime_range_seconds(a, b) > desired_seconds:
        mid = datetime.fromtimestamp(
            (_to_utc(a).timestamp() + _to_utc(b).timestamp()) / 2, tz=timezone.utc
        )
        s_mid = _sign_index(fn(mid))
        if s_mid == s_left:
            a = mid
            s_left = s_mid
        else:
            b = mid
            s_right = s_mid
    return b


def _find_sign_changes(
    fn,
    start: datetime,
    end: datetime,
    coarse_minutes: int,
) -> List[SignChange]:
    start = _to_utc(start)
    end = _to_utc(end)
    out: List[SignChange] = []
    coarse_delta = timedelta(minutes=coarse_minutes)

    t = start
    prev_index: Optional[int] = None
    guard = 0
    while guard < 10 and t <= end:
        deg = fn(t)
        if math.isfinite(deg):
            prev_index = _sign_index(deg)
            break
        t = min(t + coarse_delta, end)
        guard += 1

    if prev_index is None:
        return out

    last_pushed: Optional[datetime] = None
    while t < end:
        t_next = min(t + coarse_delta, end)
        deg_next = fn(t_next)
        if not math.isfinite(deg_next):
            t = t_next
            continue
        next_index = _sign_index(deg_next)
        if next_index != prev_index:
            exact = _refine_boundary(fn, t, t_next, 1.0)
            before = fn(exact - timedelta(seconds=1))
            after = fn(exact + timedelta(seconds=1))
            if not (math.isfinite(before) and math.isfinite(after)):
                t = t_next
                continue
            before_idx = _sign_index(before)
            after_idx = _sign_index(after)
            if (
                before_idx == prev_index
                and after_idx == next_index
                and (
                    last_pushed is None
                    or _datetime_range_seconds(last_pushed, exact) > 5.0
                )
            ):
                out.append(SignChange(time_utc=exact, from_index=prev_index, to_index=next_index))
                last_pushed = exact
                prev_index = next_index
        t = t_next
    return out


def _segment_index(deg: float, segment_size: float) -> int:
    return int(math.floor(_mod360(deg) / segment_size))


def _pada_from_segment_index(index: int) -> Tuple[int, int]:
    nak_idx = index // 4
    pada = (index % 4) + 1
    return nak_idx, pada


def _pada_index_from_lon(lon: float) -> Tuple[int, int]:
    deg = _mod360(lon)
    segment = deg / PADA_SEGMENT_DEG
    idx = int(math.floor(segment))
    if idx < 0:
        idx += 108
    nak_idx, pada = _pada_from_segment_index(idx)
    return nak_idx % len(NAKSHATRA_NAMES), pada


def _find_segment_changes(
    fn,
    start: datetime,
    end: datetime,
    segment_size: float,
    coarse_minutes: int,
) -> List[SignChange]:
    start = _to_utc(start)
    end = _to_utc(end)
    out: List[SignChange] = []
    coarse_delta = timedelta(minutes=coarse_minutes)

    t = start
    prev_index: Optional[int] = None
    guard = 0
    while guard < 10 and t <= end:
        deg = fn(t)
        if math.isfinite(deg):
            prev_index = _segment_index(deg, segment_size)
            break
        t = min(t + coarse_delta, end)
        guard += 1

    if prev_index is None:
        return out

    last_pushed: Optional[datetime] = None
    while t < end:
        t_next = min(t + coarse_delta, end)
        deg_next = fn(t_next)
        if not math.isfinite(deg_next):
            t = t_next
            continue
        next_index = _segment_index(deg_next, segment_size)
        if next_index != prev_index:
            left = t
            right = t_next
            left_idx = prev_index
            for _ in range(60):
                if _datetime_range_seconds(left, right) <= 1:
                    break
                mid = _mid_datetime(left, right)
                deg_mid = fn(mid)
                if not math.isfinite(deg_mid):
                    left = mid
                    continue
                mid_idx = _segment_index(deg_mid, segment_size)
                if mid_idx == left_idx:
                    left = mid
                else:
                    right = mid
                    next_index = mid_idx
            exact = right
            if last_pushed is None or _datetime_range_seconds(last_pushed, exact) > 5.0:
                out.append(SignChange(time_utc=exact, from_index=prev_index, to_index=next_index))
                last_pushed = exact
                prev_index = next_index
                t = exact
                continue
        t = t_next
    return out


def _velocity_deg_per_hr(fn, dt: datetime) -> float:
    h = timedelta(hours=0.5)
    t1 = dt - h
    t2 = dt + h
    return _angdiff(fn(t2), fn(t1)) / 1.0


def _find_stations(
    fn,
    start: datetime,
    end: datetime,
    coarse_minutes: int = 60,
    speed_fn=None,
    planet_name: str = "",
) -> List[StationEvent]:
    start = _to_utc(start)
    end = _to_utc(end)
    out: List[StationEvent] = []
    step = timedelta(minutes=coarse_minutes)

    def velocity_at(dt: datetime) -> float:
        if speed_fn is not None:
            per_day = speed_fn(dt)
            if per_day is None or not math.isfinite(per_day):
                return math.nan
            return per_day / 24.0
        return _velocity_deg_per_hr(fn, dt)

    def safe_sign(value: float) -> int:
        if not math.isfinite(value):
            return 0
        if abs(value) < 1e-6:
            return 0
        return 1 if value > 0 else -1

    prev_time = start
    prev_sign = 0
    guard = 0
    while guard < 48 and prev_time < end and prev_sign == 0:
        prev_sign = safe_sign(velocity_at(prev_time))
        if prev_sign == 0:
            prev_time = min(prev_time + step, end)
        guard += 1

    if prev_sign == 0:
        return out

    t = prev_time
    while t < end:
        t_next = min(t + step, end)
        curr_vel = velocity_at(t_next)
        curr_sign = safe_sign(curr_vel)
        if curr_sign != 0 and prev_sign != 0 and curr_sign != prev_sign:
            a = prev_time
            b = t_next
            sign_a = prev_sign
            for _ in range(40):
                if _datetime_range_seconds(a, b) <= 1.0:
                    break
                mid = datetime.fromtimestamp(
                    (_to_utc(a).timestamp() + _to_utc(b).timestamp()) / 2,
                    tz=timezone.utc,
                )
                mid_sign = safe_sign(velocity_at(mid))
                if mid_sign == 0:
                    a = mid
                    sign_a = 0
                    continue
                if mid_sign == sign_a or sign_a == 0:
                    a = mid
                    sign_a = mid_sign
                else:
                    b = mid

            kind: Literal["retrograde", "direct"] = (
                "retrograde" if curr_sign < 0 else "direct"
            )
            if out:
                gap = _datetime_range_seconds(out[-1].time_utc, b)
                if gap < 6 * 3600:
                    if out[-1].kind == kind:
                        prev_sign = curr_sign
                        prev_time = t_next
                        t = t_next
                        continue
                    out.pop()
            out.append(StationEvent(planet=planet_name, time_utc=b, kind=kind))
            prev_sign = curr_sign
            prev_time = t_next
        elif curr_sign != 0:
            prev_sign = curr_sign
            prev_time = t_next
        t = t_next
    return out


def _find_combustion(
    sun_fn,
    planet_fn,
    start: datetime,
    end: datetime,
    orb_deg: float,
    coarse_minutes: int = 60,
) -> List[Tuple[datetime, datetime]]:
    out: List[Tuple[datetime, datetime]] = []
    step = timedelta(minutes=coarse_minutes)
    t = start
    in_comb = False
    win_start: Optional[datetime] = None
    while t <= end:
        sun_lon = sun_fn(t)
        planet_lon = planet_fn(t)
        if not (math.isfinite(sun_lon) and math.isfinite(planet_lon)):
            t = min(t + step, end + timedelta(seconds=1))
            continue
        sep = _abs_sep(sun_lon, planet_lon)
        now_comb = sep <= orb_deg
        if not in_comb and now_comb:
            in_comb = True
            win_start = t
        if in_comb and not now_comb:
            in_comb = False
            out.append((win_start or t, t))
            win_start = None
        t = min(t + step, end + timedelta(seconds=1))
    if in_comb and win_start is not None:
        out.append((win_start, end))
    return out


def _find_degree_hit(
    fn,
    start: datetime,
    end: datetime,
    target_deg: float,
    coarse_minutes: int,
) -> Optional[datetime]:
    if start >= end:
        return None
    coarse = timedelta(minutes=coarse_minutes)
    prev_time = start
    prev_diff = _angdiff(fn(prev_time), target_deg)
    t = min(prev_time + coarse, end)
    epsilon = 1e-3
    while True:
        diff = _angdiff(fn(t), target_deg)
        if abs(diff) < epsilon:
            return t
        if (prev_diff <= 0 <= diff) or (prev_diff >= 0 >= diff):
            left = prev_time
            right = t
            left_diff = prev_diff
            right_diff = diff
            for _ in range(60):
                if _datetime_range_seconds(left, right) <= 1:
                    break
                mid = _mid_datetime(left, right)
                mid_diff = _angdiff(fn(mid), target_deg)
                if abs(mid_diff) < epsilon:
                    return mid
                if (left_diff <= 0 <= mid_diff) or (left_diff >= 0 >= mid_diff):
                    right = mid
                    right_diff = mid_diff
                else:
                    left = mid
                    left_diff = mid_diff
            return _mid_datetime(left, right)
        if t >= end:
            break
        prev_time = t
        prev_diff = diff
        t = min(t + coarse, end)
    return None


def _add_month(dt: datetime, months: int) -> datetime:
    year = dt.year + (dt.month - 1 + months) // 12
    month = (dt.month - 1 + months) % 12 + 1
    day = min(
        dt.day,
        [
            31,
            29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28,
            31,
            30,
            31,
            30,
            31,
            31,
            30,
            31,
            30,
            31,
        ][month - 1],
    )
    return dt.replace(year=year, month=month, day=day)


def _planet_lon_fn(name: PlanetName):
    def fn(dt: datetime) -> float:
        if name == "Ketu":
            lon, _ = _planet_lon_speed(dt, PLANET_IDS["Rahu"], False)
            return _mod360(lon + 180.0)
        lon, _ = _planet_lon_speed(dt, PLANET_IDS[name], False)
        return lon

    return fn


def _planet_speed_fn(name: PlanetName):
    def fn(dt: datetime) -> Optional[float]:
        if name == "Ketu":
            _, speed = _planet_lon_speed(dt, PLANET_IDS["Rahu"], True)
            if speed is None:
                return None
            return speed
        _, speed = _planet_lon_speed(dt, PLANET_IDS[name], True)
        return speed

    return fn


def compute_horizon(
    lat: float,
    lon: float,
    tz_name: str,
    start_local_iso: str,
    asc_hours: int,
    moon_days: int,
) -> Dict[str, object]:
    _initialise_once()
    start_local = _from_iso_local(start_local_iso, tz_name)
    start_utc = _to_utc(start_local)
    asc_end = start_utc + timedelta(hours=asc_hours)
    moon_end = start_utc + timedelta(days=moon_days)

    asc_fn = lambda dt: _ascendant_sidereal_deg(dt, lat, lon)
    moon_fn = _planet_lon_fn("Moon")

    asc_coarse = 10 if asc_hours > 24 else 5
    lagna_changes = _find_sign_changes(asc_fn, start_utc, asc_end, asc_coarse)
    lagna_rows: List[Dict[str, object]] = []
    for idx, change in enumerate(lagna_changes):
        local = _format_local(change.time_utc, tz_name)
        lagna_rows.append(
            {
                "timeISO": local,
                "from": RASHI[change.from_index],
                "to": RASHI[change.to_index],
                "degree": 0,
            }
        )
        next_boundary = (
            lagna_changes[idx + 1].time_utc if idx + 1 < len(lagna_changes) else asc_end
        )
        try:
            midpoint = _find_degree_hit(
                asc_fn,
                change.time_utc + timedelta(seconds=1),
                next_boundary,
                change.to_index * 30 + 15,
                max(1, asc_coarse // 2),
            )
        except RecursionError:
            midpoint = None
        if midpoint and midpoint <= asc_end:
            lagna_rows.append(
                {
                    "timeISO": _format_local(midpoint, tz_name),
                    "from": RASHI[change.to_index],
                    "to": RASHI[change.to_index],
                    "degree": 15,
                }
            )

    moon_coarse = 60 if moon_days > 15 else 30
    pada_coarse = max(1, moon_coarse // 4)
    pada_changes = _find_segment_changes(
        moon_fn,
        start_utc,
        moon_end,
        PADA_SEGMENT_DEG,
        pada_coarse,
    )
    moon_rows: List[Dict[str, object]] = []
    initial_nak_idx, initial_pada = _pada_index_from_lon(moon_fn(start_utc))
    initial_nak = NAKSHATRA_NAMES[initial_nak_idx % len(NAKSHATRA_NAMES)]
    moon_rows.append(
        {
            "timeISO": _format_local(start_utc, tz_name),
            "nakshatra": initial_nak,
            "pada": initial_pada,
        }
    )
    for change in pada_changes:
        nak_idx, pada = _pada_from_segment_index(change.to_index)
        name = NAKSHATRA_NAMES[nak_idx % len(NAKSHATRA_NAMES)]
        moon_rows.append(
            {
                "timeISO": _format_local(change.time_utc, tz_name),
                "nakshatra": name,
                "pada": pada,
            }
        )

    return {
        "lagnaRows": sorted(lagna_rows, key=lambda row: row["timeISO"]),
        "moonRows": sorted(moon_rows, key=lambda row: row["timeISO"]),
        "notes": [
            "Swiss Ephemeris (pyswisseph, BV Raman sidereal)",
            f"asc flips: {sum(1 for row in lagna_rows if row['degree'] == 0)}",
            f"moon nakshatra shifts: {len(moon_rows)}",
        ],
        "swissAvailable": True,
    }


def compute_monthly(
    lat: float,
    lon: float,
    tz_name: str,
    month_start_iso: str,
) -> Dict[str, object]:
    _initialise_once()
    month_start_local = _from_iso_local(month_start_iso, tz_name).replace(hour=0, minute=0, second=0, microsecond=0)
    month_end_local = _add_month(month_start_local, 1)
    window_start = month_start_local - timedelta(days=45)
    window_end = month_end_local + timedelta(days=45)

    start_utc = _to_utc(window_start)
    end_utc = _to_utc(window_end)
    month_end_utc = _to_utc(month_end_local)
    month_start_ms = month_start_local.timestamp()
    month_end_ms = month_end_local.timestamp()

    sun_fn = _planet_lon_fn("Sun")
    moon_fn = _planet_lon_fn("Moon")

    moon_changes = _find_segment_changes(
        moon_fn,
        start_utc,
        end_utc,
        PADA_SEGMENT_DEG,
        30,
    )
    moon_monthly: List[Dict[str, object]] = []
    if not moon_changes:
        lon_val = moon_fn(month_start_local)
        if math.isfinite(lon_val):
            idx, pada = _pada_index_from_lon(lon_val)
            name = NAKSHATRA_NAMES[idx % len(NAKSHATRA_NAMES)]
            moon_monthly.append(
                {
                    "timeISO": month_start_local.strftime("%Y-%m-%d %H:%M:%S"),
                    "nakshatra": name,
                    "pada": pada,
                }
            )
    for change in moon_changes:
        local_str = _format_local(change.time_utc, tz_name)
        local_dt = _from_iso_local(local_str, tz_name)
        ms = local_dt.timestamp()
        if month_start_ms <= ms < month_end_ms:
            nak_idx, pada = _pada_from_segment_index(change.to_index)
            name = NAKSHATRA_NAMES[nak_idx % len(NAKSHATRA_NAMES)]
            moon_monthly.append(
                {
                    "timeISO": local_str,
                    "nakshatra": name,
                    "pada": pada,
                }
            )

    sun_changes = _find_sign_changes(sun_fn, start_utc, end_utc, 120)
    sun_rows = []
    for change in sun_changes:
        local_str = _format_local(change.time_utc, tz_name)
        local_dt = _from_iso_local(local_str, tz_name)
        ms = local_dt.timestamp()
        if month_start_ms <= ms < month_end_ms:
            sun_rows.append(
                {
                    "timeISO": local_str,
                    "from": RASHI[change.from_index],
                    "to": RASHI[change.to_index],
                }
            )

    planet_rows: List[Dict[str, object]] = []
    for planet_name in PLANET_INGRESS_NAMES:
        coarse = 30 if planet_name == "Mercury" else 60 if planet_name == "Venus" else 240
        planet_fn = _planet_lon_fn(planet_name)  # type: ignore[arg-type]
        changes = _find_sign_changes(planet_fn, start_utc, end_utc, coarse)
        if not changes:
            anchor_local = month_start_local
            lon_val = planet_fn(anchor_local)
            sign_name = RASHI[_sign_index(lon_val)]
            planet_rows.append(
                {
                    "body": planet_name,
                    "from": sign_name,
                    "to": sign_name,
                    "timeISO": anchor_local.strftime("%Y-%m-%d %H:%M:%S"),
                }
            )
            continue
        for change in changes:
            local_str = _format_local(change.time_utc, tz_name)
            local_dt = _from_iso_local(local_str, tz_name)
            ms = local_dt.timestamp()
            if month_start_ms <= ms < month_end_ms:
                planet_rows.append(
                    {
                        "body": planet_name,
                        "from": RASHI[change.from_index],
                        "to": RASHI[change.to_index],
                        "timeISO": local_str,
                    }
                )

    velocity_rows: List[Dict[str, object]] = []
    for planet_name in VELOCITY_PLANETS:
        events = _velocity_extrema_for_planet(planet_name, start_utc, end_utc)
        for entry in events:
            local_str = _format_local(entry["time_utc"], tz_name)  # type: ignore[index]
            local_dt = _from_iso_local(local_str, tz_name)
            ms = local_dt.timestamp()
            if month_start_ms <= ms < month_end_ms:
                velocity_rows.append(
                    {
                        "planet": planet_name,
                        "kind": entry["kind"],
                        "timeISO": local_str,
                        "speed": entry["speed"],
                    }
                )

    station_rows: List[Dict[str, object]] = []
    comb_rows: List[Dict[str, object]] = []

    for planet_name in STATION_PLANET_NAMES:
        planet_fn = _planet_lon_fn(planet_name)  # type: ignore[arg-type]
        speed_fn = _planet_speed_fn(planet_name)  # type: ignore[arg-type]
        events = _find_stations(
            planet_fn,
            start_utc,
            end_utc,
            60,
            speed_fn,
            planet_name=planet_name,
        )
        if not events:
            continue
        initial_speed = speed_fn(start_utc)
        initial_retro = (
            initial_speed < 0
            if isinstance(initial_speed, (int, float)) and math.isfinite(initial_speed)
            else _velocity_deg_per_hr(planet_fn, start_utc) < 0
        )
        sorted_events = sorted(events, key=lambda ev: ev.time_utc)
        retro_start: Optional[datetime] = start_utc if initial_retro else None
        for ev in sorted_events:
            if ev.kind == "retrograde":
                retro_start = ev.time_utc
                continue
            # direct station
            if retro_start is None:
                retro_start = start_utc
            station_rows.append(
                {
                    "planet": planet_name,
                    "state": "retrograde",
                    "startISO": _format_local(retro_start, tz_name),
                    "endISO": _format_local(ev.time_utc, tz_name),
                }
            )
            retro_start = None
        if retro_start is not None:
            end_clip = min(end_utc, month_end_utc)
            station_rows.append(
                {
                    "planet": planet_name,
                    "state": "retrograde",
                    "startISO": _format_local(retro_start, tz_name),
                    "endISO": _format_local(end_clip, tz_name),
                }
            )

    for planet_name, orb in COMBUSTION_ORBS.items():
        if orb <= 0:
            continue
        planet_fn = _planet_lon_fn(planet_name)  # type: ignore[arg-type]
        comb_windows = _find_combustion(
            sun_fn,
            planet_fn,
            start_utc,
            end_utc,
            orb,
            60,
        )
        for start_win, end_win in comb_windows:
            start_iso = _format_local(start_win, tz_name)
            end_iso = _format_local(end_win, tz_name)
            start_ms = _from_iso_local(start_iso, tz_name).timestamp()
            end_ms = _from_iso_local(end_iso, tz_name).timestamp()
            if end_ms < month_start_ms or start_ms >= month_end_ms:
                continue
            comb_rows.append(
                {
                    "startISO": start_iso,
                    "endISO": end_iso,
                    "planet": planet_name,
                    "orbDeg": orb,
                }
            )

    def _filter_month(rows: List[Dict[str, object]], start_key: str, end_key: Optional[str] = None):
        filtered = []
        for row in rows:
            start_ms = _from_iso_local(row[start_key], tz_name).timestamp()  # type: ignore[index]
            end_ms = (
                _from_iso_local(row[end_key], tz_name).timestamp()  # type: ignore[index]
                if end_key and row.get(end_key)
                else None
            )
            if start_ms < month_end_ms and (end_ms or month_end_ms) >= month_start_ms:
                filtered.append(row)
        return filtered

    station_rows = _filter_month(station_rows, "startISO", "endISO")
    comb_rows = _filter_month(comb_rows, "startISO", "endISO")

    planet_rows.sort(key=lambda row: row["timeISO"])
    station_rows.sort(key=lambda row: row["startISO"])
    comb_rows.sort(key=lambda row: row["startISO"])
    velocity_rows.sort(key=lambda row: row["timeISO"])

    return {
        "moonMonthlyRows": moon_monthly,
        "sunRows": sun_rows,
        "otherIngressRows": planet_rows,
        "stationRows": station_rows,
        "combRows": comb_rows,
        "velocityRows": velocity_rows,
        "swissAvailable": True,
    }


def compute_planetary_timeseries(
    planet: str,
    timestamps: List[int],  # Unix timestamps in seconds
) -> List[Dict[str, object]]:
    """
    Compute planetary longitude for a list of timestamps.

    Args:
        planet: Planet name (Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn, Rahu, Ketu)
        timestamps: List of Unix timestamps in seconds

    Returns:
        List of dicts with 'time' (timestamp) and 'longitude' (degrees 0-360)
    """
    _initialise_once()

    if planet not in PLANET_IDS and planet != "Ketu":
        raise ValueError(f"Unknown planet: {planet}")

    planet_fn = _planet_lon_fn(planet)

    result = []
    for ts in timestamps:
        dt = datetime.fromtimestamp(ts, tz=timezone.utc)
        longitude = planet_fn(dt)
        result.append({
            "time": ts,
            "longitude": longitude,
        })

    return result
