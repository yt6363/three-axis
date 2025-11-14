"""
Planetary Forces Calculator

Calculates gravitational and tidal forces exerted by celestial bodies on Earth.
Uses Swiss Ephemeris for accurate planetary positions and distances.
"""

import swisseph as swe
from datetime import datetime, timedelta
from typing import Dict, List, Tuple
import math

# Physical constants
G = 6.67430e-11  # Gravitational constant (m³ kg⁻¹ s⁻²)
AU_TO_METERS = 1.495978707e11  # 1 AU in meters
EARTH_MASS = 5.972e24  # kg
EARTH_RADIUS = 6.371e6  # meters

# Planetary masses (kg) - Source: NASA JPL
PLANET_MASSES = {
    "Sun": 1.9885e30,
    "Moon": 7.342e22,
    "Mercury": 3.3011e23,
    "Venus": 4.8675e24,
    "Mars": 6.4171e23,
    "Jupiter": 1.8982e27,
    "Saturn": 5.6834e26,
    "Uranus": 8.6810e25,
    "Neptune": 1.02413e26,
}

# Swiss Ephemeris planet codes
PLANET_CODES = {
    "Sun": swe.SUN,
    "Moon": swe.MOON,
    "Mercury": swe.MERCURY,
    "Venus": swe.VENUS,
    "Mars": swe.MARS,
    "Jupiter": swe.JUPITER,
    "Saturn": swe.SATURN,
    "Uranus": swe.URANUS,
    "Neptune": swe.NEPTUNE,
}


def initialize_ephemeris():
    """Initialize Swiss Ephemeris."""
    # Set ephemeris path if needed
    # swe.set_ephe_path("/path/to/ephe")
    pass


def julian_day_from_datetime(dt: datetime) -> float:
    """Convert datetime to Julian Day."""
    return swe.julday(dt.year, dt.month, dt.day,
                      dt.hour + dt.minute/60 + dt.second/3600)


def calculate_gravitational_force(planet_mass: float, distance_m: float) -> float:
    """
    Calculate gravitational force between Earth and another body.

    F = G × (m₁ × m₂) / r²

    Args:
        planet_mass: Mass of the planet (kg)
        distance_m: Distance from Earth (meters)

    Returns:
        Force in Newtons
    """
    force = G * (planet_mass * EARTH_MASS) / (distance_m ** 2)
    return force


def calculate_tidal_force(planet_mass: float, distance_m: float) -> float:
    """
    Calculate tidal force (differential gravity).

    F_tidal ∝ m / r³

    This is more relevant than absolute force for planetary effects on Earth.

    Args:
        planet_mass: Mass of the planet (kg)
        distance_m: Distance from Earth (meters)

    Returns:
        Tidal force coefficient (relative units)
    """
    # Tidal force scales as m/r³
    # We multiply by Earth's radius to get actual differential force
    tidal_coefficient = (2 * G * planet_mass * EARTH_RADIUS) / (distance_m ** 3)
    return tidal_coefficient


def geocentric_to_cartesian(longitude_deg: float, latitude_deg: float,
                            distance_au: float) -> Tuple[float, float, float]:
    """
    Convert geocentric ecliptic coordinates to 3D Cartesian.

    Args:
        longitude_deg: Ecliptic longitude (degrees)
        latitude_deg: Ecliptic latitude (degrees)
        distance_au: Distance in AU

    Returns:
        (x, y, z) in AU (geocentric ecliptic frame)
    """
    lon_rad = math.radians(longitude_deg)
    lat_rad = math.radians(latitude_deg)

    x = distance_au * math.cos(lat_rad) * math.cos(lon_rad)
    y = distance_au * math.cos(lat_rad) * math.sin(lon_rad)
    z = distance_au * math.sin(lat_rad)

    return (x, y, z)


def get_planetary_position(planet_name: str, jd: float) -> Dict:
    """
    Get position and distance of a planet at given Julian Day.

    Args:
        planet_name: Name of planet (e.g., "Jupiter")
        jd: Julian Day

    Returns:
        Dictionary with position data
    """
    planet_code = PLANET_CODES[planet_name]

    # Calculate geocentric position
    result = swe.calc_ut(jd, planet_code)

    longitude = result[0][0]  # Ecliptic longitude (degrees)
    latitude = result[0][1]   # Ecliptic latitude (degrees)
    distance_au = result[0][2]  # Distance in AU

    # Convert to Cartesian
    x, y, z = geocentric_to_cartesian(longitude, latitude, distance_au)

    return {
        "name": planet_name,
        "longitude": longitude,
        "latitude": latitude,
        "distance_au": distance_au,
        "distance_m": distance_au * AU_TO_METERS,
        "x": x,
        "y": y,
        "z": z,
    }


def calculate_planetary_force(planet_name: str, jd: float) -> Dict:
    """
    Calculate gravitational and tidal forces for a single planet.

    Args:
        planet_name: Name of planet
        jd: Julian Day

    Returns:
        Dictionary with force data
    """
    pos = get_planetary_position(planet_name, jd)
    mass = PLANET_MASSES[planet_name]

    # Calculate forces
    grav_force = calculate_gravitational_force(mass, pos["distance_m"])
    tidal_force = calculate_tidal_force(mass, pos["distance_m"])

    # Force vector components (gravitational)
    # Direction is FROM planet TO Earth (negative of position vector)
    distance_total = math.sqrt(pos["x"]**2 + pos["y"]**2 + pos["z"]**2)
    force_x = -grav_force * (pos["x"] / distance_total)
    force_y = -grav_force * (pos["y"] / distance_total)
    force_z = -grav_force * (pos["z"] / distance_total)

    return {
        "planet": planet_name,
        "mass": mass,
        "distance_au": pos["distance_au"],
        "distance_m": pos["distance_m"],
        "longitude": pos["longitude"],
        "latitude": pos["latitude"],
        "gravitational_force": grav_force,
        "tidal_force": tidal_force,
        "force_vector": {
            "x": force_x,
            "y": force_y,
            "z": force_z,
        }
    }


def calculate_net_force(dt: datetime) -> Dict:
    """
    Calculate net gravitational force from all planets on Earth.

    Args:
        dt: Datetime to calculate for

    Returns:
        Dictionary with net force data and individual contributions
    """
    initialize_ephemeris()
    jd = julian_day_from_datetime(dt)

    # Calculate forces for all bodies
    individual_forces = []
    net_fx, net_fy, net_fz = 0.0, 0.0, 0.0
    total_grav_force = 0.0
    total_tidal_force = 0.0

    for planet_name in PLANET_MASSES.keys():
        force_data = calculate_planetary_force(planet_name, jd)
        individual_forces.append(force_data)

        # Add to net force vector
        net_fx += force_data["force_vector"]["x"]
        net_fy += force_data["force_vector"]["y"]
        net_fz += force_data["force_vector"]["z"]

        # Sum magnitudes (for reference)
        total_grav_force += force_data["gravitational_force"]
        total_tidal_force += force_data["tidal_force"]

    # Calculate net force magnitude and direction
    net_magnitude = math.sqrt(net_fx**2 + net_fy**2 + net_fz**2)

    # Direction in ecliptic coordinates
    net_distance = math.sqrt(net_fx**2 + net_fy**2 + net_fz**2)
    if net_distance > 0:
        # Convert back to longitude/latitude
        net_longitude = math.degrees(math.atan2(net_fy, net_fx))
        if net_longitude < 0:
            net_longitude += 360
        net_latitude = math.degrees(math.asin(net_fz / net_distance))
    else:
        net_longitude = 0
        net_latitude = 0

    return {
        "datetime": dt.isoformat(),
        "julian_day": jd,
        "net_force": {
            "magnitude": net_magnitude,
            "longitude": net_longitude,
            "latitude": net_latitude,
            "vector": {
                "x": net_fx,
                "y": net_fy,
                "z": net_fz,
            }
        },
        "total_gravitational_force": total_grav_force,
        "total_tidal_force": total_tidal_force,
        "individual_forces": individual_forces,
    }


def calculate_force_series(start_dt: datetime, end_dt: datetime,
                          interval_hours: int = 24) -> List[Dict]:
    """
    Calculate net force over a time period.

    Args:
        start_dt: Start datetime
        end_dt: End datetime
        interval_hours: Time interval between calculations

    Returns:
        List of force data dictionaries
    """
    series = []
    current_dt = start_dt

    while current_dt <= end_dt:
        force_data = calculate_net_force(current_dt)
        series.append(force_data)
        current_dt += timedelta(hours=interval_hours)

    return series


def get_force_contributions_percent(force_data: Dict) -> Dict[str, float]:
    """
    Get percentage contribution of each planet to total gravitational force.

    Args:
        force_data: Output from calculate_net_force()

    Returns:
        Dictionary of planet names to percentage contributions
    """
    total = force_data["total_gravitational_force"]

    contributions = {}
    for planet_force in force_data["individual_forces"]:
        planet_name = planet_force["planet"]
        force = planet_force["gravitational_force"]
        percent = (force / total) * 100 if total > 0 else 0
        contributions[planet_name] = percent

    return contributions


# Example usage
if __name__ == "__main__":
    # Calculate current forces
    now = datetime.now()
    force_data = calculate_net_force(now)

    print(f"Planetary Forces on Earth - {now}")
    print("=" * 60)
    print(f"Net Force Magnitude: {force_data['net_force']['magnitude']:.3e} N")
    print(f"Net Force Direction: {force_data['net_force']['longitude']:.2f}° lon, "
          f"{force_data['net_force']['latitude']:.2f}° lat")
    print()

    # Show contributions
    contributions = get_force_contributions_percent(force_data)
    print("Individual Contributions:")
    for planet, percent in sorted(contributions.items(), key=lambda x: -x[1]):
        force = next(f["gravitational_force"] for f in force_data["individual_forces"]
                    if f["planet"] == planet)
        print(f"  {planet:12s}: {percent:5.2f}% ({force:.3e} N)")
