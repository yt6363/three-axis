#!/usr/bin/env python3
"""
Multi-Ayanamsa Cache Warming Script
Pre-populate planetary events for all 3 ayanamsa systems (Lahiri, BV Raman, Tropical)
for Mumbai and New York from 1990-2030.
"""
import asyncio
import aiohttp
from datetime import datetime
from typing import List
import sys

# API endpoint
API_URL = "https://jupiter-terminal-production.up.railway.app/api/swiss/monthly/batch"
STATS_URL = "https://jupiter-terminal-production.up.railway.app/api/cache/stats"

# Locations
LOCATIONS = {
    "India": [
        {"name": "Mumbai", "lat": 19.0760, "lon": 72.8777, "tz": "Asia/Kolkata"},
    ],
    "USA": [
        {"name": "New York", "lat": 40.7128, "lon": -74.0060, "tz": "America/New_York"},
    ],
}

# Ayanamsa systems
AYANAMSA_SYSTEMS = {
    "lahiri": "Lahiri (24°13' - Govt of India standard)",
    "raman": "BV Raman (22°46' - Vedic)",
    "tropical": "Tropical (0° - Western)",
}

# Date range: 1990-2030
START_YEAR = 1990
END_YEAR = 2030

# Batch size for requests (12 months = 1 year per request)
BATCH_SIZE = 12


def generate_month_batches(start_year: int, end_year: int, batch_size: int) -> List[List[str]]:
    """Generate batches of month ISO strings."""
    months = []
    for year in range(start_year, end_year + 1):
        for month in range(1, 13):
            months.append(f"{year:04d}-{month:02d}-01")

    # Split into batches
    batches = []
    for i in range(0, len(months), batch_size):
        batches.append(months[i:i + batch_size])

    return batches


async def warm_cache_for_location_ayanamsa(
    session: aiohttp.ClientSession,
    location: dict,
    country: str,
    ayanamsa: str,
    ayanamsa_desc: str,
    total_combos: int,
    current_combo_idx: int
) -> dict:
    """Warm cache for a specific location and ayanamsa."""
    name = location["name"]
    lat = location["lat"]
    lon = location["lon"]
    tz = location["tz"]

    print(f"\n{'='*80}")
    print(f"[{current_combo_idx}/{total_combos}] {country} - {name} - {ayanamsa_desc}")
    print(f"{'='*80}")

    batches = generate_month_batches(START_YEAR, END_YEAR, BATCH_SIZE)
    total_batches = len(batches)

    print(f"📊 Total: {total_batches} batches ({BATCH_SIZE} months each)")
    print(f"📅 Period: {START_YEAR}-{END_YEAR} ({(END_YEAR - START_YEAR + 1) * 12} months)\n")

    success_count = 0
    error_count = 0

    for batch_idx, month_batch in enumerate(batches, 1):
        payload = {
            "lat": lat,
            "lon": lon,
            "tz": tz,
            "monthStartISOs": month_batch,
            "ayanamsa": ayanamsa  # Include ayanamsa in request
        }

        try:
            async with session.post(API_URL, json=payload, timeout=aiohttp.ClientTimeout(total=180)) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get("ok"):
                        success_count += 1
                        year_start = month_batch[0][:4]
                        year_end = month_batch[-1][:4]
                        print(f"✅ Batch {batch_idx}/{total_batches}: {year_start}-{year_end} ({len(month_batch)} months)")
                    else:
                        error_count += 1
                        print(f"❌ Batch {batch_idx}/{total_batches}: Failed - {data.get('error', 'Unknown error')}")
                else:
                    error_count += 1
                    print(f"❌ Batch {batch_idx}/{total_batches}: HTTP {response.status}")
        except asyncio.TimeoutError:
            error_count += 1
            print(f"⏱️  Batch {batch_idx}/{total_batches}: Timeout (>180s)")
        except Exception as e:
            error_count += 1
            print(f"❌ Batch {batch_idx}/{total_batches}: {str(e)}")

    print(f"\n✨ {name} ({ayanamsa}) Complete: {success_count} succeeded, {error_count} failed")

    return {
        "location": f"{country} - {name} - {ayanamsa}",
        "success": success_count,
        "errors": error_count,
        "total": total_batches
    }


async def get_cache_stats(session: aiohttp.ClientSession) -> dict:
    """Get current cache statistics."""
    try:
        async with session.get(STATS_URL) as response:
            if response.status == 200:
                return await response.json()
    except Exception as e:
        print(f"⚠️  Could not fetch cache stats: {e}")
    return {}


async def main():
    """Main cache warming function."""
    print("\n" + "="*80)
    print("🚀 MULTI-AYANAMSA CACHE WARMING SCRIPT")
    print("="*80)
    print(f"📅 Date Range: {START_YEAR} - {END_YEAR}")
    print(f"📍 Locations: {sum(len(locs) for locs in LOCATIONS.values())} cities")
    print(f"🔮 Ayanamsa Systems: {len(AYANAMSA_SYSTEMS)} (Lahiri, Raman, Tropical)")
    print(f"📦 Total combinations: {sum(len(locs) for locs in LOCATIONS.values()) * len(AYANAMSA_SYSTEMS)}")
    print(f"⏱️  Estimated time: ~4-6 hours total")
    print("="*80 + "\n")

    async with aiohttp.ClientSession() as session:
        # Get initial cache stats
        print("📊 Fetching initial cache stats...")
        initial_stats = await get_cache_stats(session)
        if initial_stats:
            print(f"   Database enabled: {initial_stats.get('database_enabled', False)}")
            print(f"   Months cached: {initial_stats.get('total_months_cached', 0)}")
            print(f"   Unique locations: {initial_stats.get('unique_locations', 0)}\n")

        # Calculate total combinations
        total_combos = sum(len(locs) for locs in LOCATIONS.values()) * len(AYANAMSA_SYSTEMS)
        current_idx = 0

        # Warm cache for all location + ayanamsa combinations
        results = []
        start_time = datetime.now()

        for country, locations in LOCATIONS.items():
            for location in locations:
                for ayanamsa, ayanamsa_desc in AYANAMSA_SYSTEMS.items():
                    current_idx += 1
                    result = await warm_cache_for_location_ayanamsa(
                        session, location, country, ayanamsa, ayanamsa_desc, total_combos, current_idx
                    )
                    results.append(result)

        # Get final cache stats
        print("\n" + "="*80)
        print("📊 FINAL CACHE STATS")
        print("="*80)
        final_stats = await get_cache_stats(session)
        if final_stats:
            print(f"   Database enabled: {final_stats.get('database_enabled', False)}")
            print(f"   Total months cached: {final_stats.get('total_months_cached', 0)}")
            print(f"   Unique locations: {final_stats.get('unique_locations', 0)}")
            print(f"   Cache started: {final_stats.get('cache_started', 'N/A')}")

        # Print summary
        print("\n" + "="*80)
        print("📋 SUMMARY")
        print("="*80)

        total_success = sum(r["success"] for r in results)
        total_errors = sum(r["errors"] for r in results)
        total_batches = sum(r["total"] for r in results)

        for result in results:
            status = "✅" if result["errors"] == 0 else "⚠️"
            print(f"{status} {result['location']}: {result['success']}/{result['total']} batches")

        elapsed = datetime.now() - start_time
        print(f"\n⏱️  Total time: {elapsed}")
        print(f"✅ Total successful batches: {total_success}/{total_batches}")
        print(f"❌ Total failed batches: {total_errors}/{total_batches}")

        if initial_stats and final_stats:
            months_added = final_stats.get('total_months_cached', 0) - initial_stats.get('total_months_cached', 0)
            print(f"📈 Months added to cache: {months_added}")

        print(f"\n🎉 Multi-ayanamsa cache warming complete!")
        print(f"   - Lahiri (24°13'): Government of India standard")
        print(f"   - BV Raman (22°46'): Traditional Vedic system")
        print(f"   - Tropical (0°): Western astrology system")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n⚠️  Cache warming interrupted by user")
        sys.exit(1)
