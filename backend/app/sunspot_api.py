"""
Sunspot Data Integration

Fetches and processes sunspot cycle data from NOAA Space Weather Prediction Center.
Provides historical sunspot numbers for correlation analysis.
"""

import httpx
from datetime import datetime, timedelta
from typing import List, Dict, Optional
import json

# NOAA SWPC Data URLs
SUNSPOT_DAILY_URL = "https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json"
SUNSPOT_PREDICTION_URL = "https://services.swpc.noaa.gov/json/solar-cycle/predicted-solar-cycle.json"

# Local cache for sunspot data
_sunspot_cache = None
_cache_timestamp = None
CACHE_TTL_HOURS = 24


class SunspotData:
    """Container for sunspot cycle data."""

    def __init__(self, data: List[Dict]):
        self.data = data

    def get_sunspot_number(self, dt: datetime) -> Optional[float]:
        """
        Get sunspot number for a specific date.

        Args:
            dt: Date to get sunspot number for

        Returns:
            Sunspot number (float) or None if not available
        """
        target_str = dt.strftime("%Y-%m")

        for record in self.data:
            if record.get("time-tag", "").startswith(target_str):
                return record.get("ssn", 0.0)

        return None

    def get_smoothed_sunspot_number(self, dt: datetime) -> Optional[float]:
        """
        Get 13-month smoothed sunspot number.

        Args:
            dt: Date to get smoothed sunspot number for

        Returns:
            Smoothed sunspot number or None
        """
        target_str = dt.strftime("%Y-%m")

        for record in self.data:
            if record.get("time-tag", "").startswith(target_str):
                return record.get("smoothed_ssn", 0.0)

        return None

    def get_solar_cycle_phase(self, dt: datetime) -> Dict:
        """
        Determine current solar cycle phase.

        Returns:
            Dictionary with cycle information
        """
        ssn = self.get_smoothed_sunspot_number(dt)

        if ssn is None:
            return {
                "phase": "unknown",
                "ssn": None,
                "description": "No data available"
            }

        # Simple phase classification
        if ssn < 20:
            phase = "solar_minimum"
            description = "Solar Minimum - Low activity"
        elif ssn < 80:
            phase = "ascending"
            description = "Ascending Phase - Increasing activity"
        elif ssn < 120:
            phase = "solar_maximum"
            description = "Solar Maximum - High activity"
        else:
            phase = "extreme_maximum"
            description = "Extreme Solar Maximum - Very high activity"

        return {
            "phase": phase,
            "ssn": ssn,
            "description": description,
            "date": dt.isoformat()
        }

    def get_series(self, start_dt: datetime, end_dt: datetime) -> List[Dict]:
        """
        Get sunspot data for a date range.

        Args:
            start_dt: Start date
            end_dt: End date

        Returns:
            List of sunspot data points
        """
        start_str = start_dt.strftime("%Y-%m")
        end_str = end_dt.strftime("%Y-%m")

        filtered = []
        for record in self.data:
            time_tag = record.get("time-tag", "")
            if start_str <= time_tag[:7] <= end_str:
                filtered.append({
                    "date": time_tag,
                    "ssn": record.get("ssn", 0.0),
                    "smoothed_ssn": record.get("smoothed_ssn", 0.0),
                })

        return filtered


async def fetch_sunspot_data(use_cache: bool = True) -> SunspotData:
    """
    Fetch sunspot data from NOAA SWPC.

    Args:
        use_cache: Whether to use cached data if available

    Returns:
        SunspotData object
    """
    global _sunspot_cache, _cache_timestamp

    # Check cache
    if use_cache and _sunspot_cache is not None and _cache_timestamp is not None:
        age = datetime.now() - _cache_timestamp
        if age.total_seconds() < CACHE_TTL_HOURS * 3600:
            return SunspotData(_sunspot_cache)

    # Fetch fresh data
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(SUNSPOT_DAILY_URL)
        response.raise_for_status()
        data = response.json()

    # Update cache
    _sunspot_cache = data
    _cache_timestamp = datetime.now()

    return SunspotData(data)


def get_solar_cycle_info() -> Dict:
    """
    Get information about solar cycles.

    Returns:
        Dictionary with solar cycle reference data
    """
    return {
        "cycle_24": {
            "start": "2008-12",
            "peak": "2014-04",
            "end": "2019-12",
            "peak_ssn": 116.4,
            "description": "Solar Cycle 24 was the weakest in 100 years"
        },
        "cycle_25": {
            "start": "2019-12",
            "peak_predicted": "2025-07",
            "peak_ssn_predicted": 115,
            "status": "ongoing",
            "description": "Solar Cycle 25 is currently ongoing, approaching predicted maximum"
        },
        "average_cycle_length": 11.0,
        "hale_cycle_length": 22.0,
        "jose_cycle_length": 179.0,
    }


def analyze_sunspot_correlation(sunspot_series: List[Dict],
                                planetary_force_series: List[Dict]) -> Dict:
    """
    Calculate correlation between sunspot numbers and planetary forces.

    Args:
        sunspot_series: List of sunspot data points
        planetary_force_series: List of planetary force data points

    Returns:
        Correlation analysis results
    """
    # Ensure data is aligned by date
    aligned_data = []

    for force_point in planetary_force_series:
        force_date = datetime.fromisoformat(force_point["datetime"])
        force_date_str = force_date.strftime("%Y-%m")

        # Find matching sunspot data
        matching_ssn = None
        for ssn_point in sunspot_series:
            if ssn_point["date"].startswith(force_date_str):
                matching_ssn = ssn_point["smoothed_ssn"]
                break

        if matching_ssn is not None:
            aligned_data.append({
                "date": force_date_str,
                "ssn": matching_ssn,
                "force_magnitude": force_point["net_force"]["magnitude"],
                "force_direction": force_point["net_force"]["longitude"],
            })

    if not aligned_data:
        return {"error": "No overlapping data found"}

    # Calculate Pearson correlation coefficient
    n = len(aligned_data)
    ssn_values = [d["ssn"] for d in aligned_data]
    force_values = [d["force_magnitude"] for d in aligned_data]

    # Calculate means
    mean_ssn = sum(ssn_values) / n
    mean_force = sum(force_values) / n

    # Calculate correlation
    numerator = sum((ssn_values[i] - mean_ssn) * (force_values[i] - mean_force)
                   for i in range(n))
    denominator_ssn = sum((v - mean_ssn) ** 2 for v in ssn_values) ** 0.5
    denominator_force = sum((v - mean_force) ** 2 for v in force_values) ** 0.5

    if denominator_ssn == 0 or denominator_force == 0:
        correlation = 0.0
    else:
        correlation = numerator / (denominator_ssn * denominator_force)

    return {
        "correlation_coefficient": correlation,
        "data_points": n,
        "date_range": f"{aligned_data[0]['date']} to {aligned_data[-1]['date']}",
        "ssn_range": f"{min(ssn_values):.1f} to {max(ssn_values):.1f}",
        "interpretation": interpret_correlation(correlation),
    }


def interpret_correlation(r: float) -> str:
    """Interpret correlation coefficient."""
    abs_r = abs(r)

    if abs_r < 0.1:
        strength = "negligible"
    elif abs_r < 0.3:
        strength = "weak"
    elif abs_r < 0.5:
        strength = "moderate"
    elif abs_r < 0.7:
        strength = "strong"
    else:
        strength = "very strong"

    direction = "positive" if r > 0 else "negative"

    return f"{strength.capitalize()} {direction} correlation (r={r:.3f})"


# Example usage
if __name__ == "__main__":
    import asyncio

    async def main():
        # Fetch sunspot data
        sunspot_data = await fetch_sunspot_data()

        # Check current solar cycle phase
        now = datetime.now()
        phase_info = sunspot_data.get_solar_cycle_phase(now)

        print(f"Current Solar Cycle Status - {now.strftime('%Y-%m')}")
        print("=" * 60)
        print(f"Phase: {phase_info['phase']}")
        print(f"Smoothed SSN: {phase_info['ssn']:.1f}")
        print(f"Description: {phase_info['description']}")
        print()

        # Get historical data
        start = datetime(2020, 1, 1)
        end = datetime(2025, 1, 1)
        series = sunspot_data.get_series(start, end)

        print(f"Sunspot Data ({start.year}-{end.year}):")
        print(f"Total data points: {len(series)}")

        if series:
            ssn_values = [s["smoothed_ssn"] for s in series]
            print(f"SSN Range: {min(ssn_values):.1f} - {max(ssn_values):.1f}")
            print(f"Average SSN: {sum(ssn_values)/len(ssn_values):.1f}")

    asyncio.run(main())
