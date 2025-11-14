"""
Advanced Overlays Module

Provides overlay calculations for:
1. Sunspot cycle data
2. Tidal forces
3. Barycenter wobble
4. Net gravitational forces
5. Bradley Siderograph
"""

from datetime import datetime, timedelta
from typing import List, Dict, Tuple
import math
import swisseph as swe

from .planetary_forces import (
    calculate_net_force,
    calculate_tidal_force,
    PLANET_MASSES,
    PLANET_CODES,
    julian_day_from_datetime,
    AU_TO_METERS,
    geocentric_to_cartesian,
)
from .sunspot_api import fetch_sunspot_data


async def calculate_sunspot_overlay(
    start_dt: datetime,
    end_dt: datetime,
    interval_hours: int = 24
) -> List[Dict]:
    """
    Calculate sunspot overlay series.

    Returns list of {timestamp, ssn, smoothed_ssn}
    """
    sunspot_data = await fetch_sunspot_data()
    series = sunspot_data.get_series(start_dt, end_dt)

    result = []
    for point in series:
        dt_str = point["date"] + "-01"  # Add day to YYYY-MM format
        dt = datetime.fromisoformat(dt_str)

        result.append({
            "timestamp": int(dt.timestamp()),
            "ssn": point["ssn"],
            "smoothed_ssn": point["smoothed_ssn"],
        })

    return result


def calculate_tidal_overlay(
    start_dt: datetime,
    end_dt: datetime,
    interval_hours: int = 24
) -> List[Dict]:
    """
    Calculate tidal forces overlay.

    Returns list of {timestamp, total_tidal_force, moon_tidal, sun_tidal, jupiter_tidal}
    """
    result = []
    current_dt = start_dt

    while current_dt <= end_dt:
        jd = julian_day_from_datetime(current_dt)

        # Calculate individual tidal forces
        moon_tidal = 0.0
        sun_tidal = 0.0
        jupiter_tidal = 0.0
        total_tidal = 0.0

        for planet_name, planet_code in PLANET_CODES.items():
            if planet_name not in PLANET_MASSES:
                continue

            # Get planet position
            pos = swe.calc_ut(jd, planet_code)
            distance_au = pos[0][2]
            distance_m = distance_au * AU_TO_METERS

            mass = PLANET_MASSES[planet_name]
            tidal_force = calculate_tidal_force(mass, distance_m)

            total_tidal += tidal_force

            if planet_name == "Moon":
                moon_tidal = tidal_force
            elif planet_name == "Sun":
                sun_tidal = tidal_force
            elif planet_name == "Jupiter":
                jupiter_tidal = tidal_force

        result.append({
            "timestamp": int(current_dt.timestamp()),
            "total_tidal_force": total_tidal,
            "moon_tidal": moon_tidal,
            "sun_tidal": sun_tidal,
            "jupiter_tidal": jupiter_tidal,
        })

        current_dt += timedelta(hours=interval_hours)

    return result


def calculate_barycenter_overlay(
    start_dt: datetime,
    end_dt: datetime,
    interval_hours: int = 24
) -> List[Dict]:
    """
    Calculate solar system barycenter wobble.

    Returns list of {timestamp, distance_from_sun_center_km, x, y, z}

    The barycenter is the center of mass of the solar system.
    When planets align, the Sun wobbles around this point.
    """
    result = []
    current_dt = start_dt

    SUN_MASS = PLANET_MASSES["Sun"]
    SUN_RADIUS_KM = 696000  # km

    while current_dt <= end_dt:
        jd = julian_day_from_datetime(current_dt)

        # Calculate barycenter position relative to Sun
        # Barycenter = Σ(m_i × r_i) / Σ(m_i)
        total_mass = SUN_MASS
        weighted_x = 0.0
        weighted_y = 0.0
        weighted_z = 0.0

        for planet_name, planet_code in PLANET_CODES.items():
            if planet_name not in PLANET_MASSES or planet_name == "Sun":
                continue

            mass = PLANET_MASSES[planet_name]
            total_mass += mass

            # Get heliocentric position
            pos = swe.calc_ut(jd, planet_code, swe.FLG_HELCTR)
            lon = pos[0][0]
            lat = pos[0][1]
            dist_au = pos[0][2]

            # Convert to Cartesian
            x, y, z = geocentric_to_cartesian(lon, lat, dist_au)

            weighted_x += mass * x
            weighted_y += mass * y
            weighted_z += mass * z

        # Barycenter position in AU (heliocentric)
        barycenter_x = weighted_x / total_mass
        barycenter_y = weighted_y / total_mass
        barycenter_z = weighted_z / total_mass

        # Distance from Sun's center
        distance_au = math.sqrt(barycenter_x**2 + barycenter_y**2 + barycenter_z**2)
        distance_km = distance_au * AU_TO_METERS / 1000

        # Express as multiple of Sun's radius
        sun_radii = distance_km / SUN_RADIUS_KM

        result.append({
            "timestamp": int(current_dt.timestamp()),
            "distance_km": distance_km,
            "distance_sun_radii": sun_radii,
            "x_au": barycenter_x,
            "y_au": barycenter_y,
            "z_au": barycenter_z,
        })

        current_dt += timedelta(hours=interval_hours)

    return result


def calculate_gravitational_overlay(
    start_dt: datetime,
    end_dt: datetime,
    interval_hours: int = 24
) -> List[Dict]:
    """
    Calculate net gravitational force vector.

    Returns list of {timestamp, magnitude, longitude, latitude}
    """
    result = []
    current_dt = start_dt

    while current_dt <= end_dt:
        force_data = calculate_net_force(current_dt)

        result.append({
            "timestamp": int(current_dt.timestamp()),
            "magnitude": force_data["net_force"]["magnitude"],
            "longitude": force_data["net_force"]["longitude"],
            "latitude": force_data["net_force"]["latitude"],
            "total_force": force_data["total_gravitational_force"],
        })

        current_dt += timedelta(hours=interval_hours)

    return result


def calculate_bradley_siderograph(
    start_dt: datetime,
    end_dt: datetime,
    interval_hours: int = 24
) -> List[Dict]:
    """
    Calculate Bradley Siderograph indicator.

    The Bradley Siderograph is a financial astrology indicator that combines:
    - Planetary longitudes
    - Major aspects (0°, 60°, 90°, 120°, 180°)
    - Weighted by planet pairs

    Returns list of {timestamp, bradley_value, trend}
    """
    result = []
    current_dt = start_dt

    # Bradley aspect weights (traditional)
    ASPECT_WEIGHTS = {
        0: 1.0,      # Conjunction
        60: 0.5,     # Sextile
        90: -1.0,    # Square
        120: 0.75,   # Trine
        180: -0.5,   # Opposition
    }

    # Planet weights (traditional Bradley)
    PLANET_WEIGHTS = {
        "Sun": 1.0,
        "Moon": 1.0,
        "Mercury": 0.5,
        "Venus": 0.75,
        "Mars": 0.75,
        "Jupiter": 1.0,
        "Saturn": 1.0,
        "Uranus": 0.5,
        "Neptune": 0.25,
    }

    ASPECT_TOLERANCE = 3.0  # degrees

    planets_to_use = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"]

    while current_dt <= end_dt:
        jd = julian_day_from_datetime(current_dt)

        # Get all planetary positions
        positions = {}
        for planet_name in planets_to_use:
            if planet_name not in PLANET_CODES:
                continue
            planet_code = PLANET_CODES[planet_name]
            pos = swe.calc_ut(jd, planet_code)
            positions[planet_name] = pos[0][0]  # longitude

        # Calculate aspect score
        bradley_value = 0.0

        # Check all planet pairs
        planet_list = list(positions.keys())
        for i, planet1 in enumerate(planet_list):
            for planet2 in planet_list[i+1:]:
                lon1 = positions[planet1]
                lon2 = positions[planet2]

                # Calculate angular separation
                diff = abs(lon1 - lon2)
                if diff > 180:
                    diff = 360 - diff

                # Check for aspects
                for aspect_angle, aspect_weight in ASPECT_WEIGHTS.items():
                    aspect_diff = abs(diff - aspect_angle)

                    if aspect_diff <= ASPECT_TOLERANCE:
                        # Apply weights
                        weight1 = PLANET_WEIGHTS.get(planet1, 0.5)
                        weight2 = PLANET_WEIGHTS.get(planet2, 0.5)
                        combined_weight = (weight1 + weight2) / 2

                        # Add to Bradley value
                        orb_factor = 1.0 - (aspect_diff / ASPECT_TOLERANCE)
                        bradley_value += aspect_weight * combined_weight * orb_factor

        result.append({
            "timestamp": int(current_dt.timestamp()),
            "bradley_value": bradley_value,
        })

        current_dt += timedelta(hours=interval_hours)

    # Calculate trend (simple moving average of bradley value changes)
    if len(result) > 1:
        for i in range(len(result)):
            if i == 0:
                result[i]["trend"] = 0.0
            else:
                result[i]["trend"] = result[i]["bradley_value"] - result[i-1]["bradley_value"]

    return result
