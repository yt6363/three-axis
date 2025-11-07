"""Database connection and schema for caching planetary events."""
import os
import hashlib
import json
from datetime import datetime
from typing import Optional, Dict, Any
import asyncpg

# Database connection pool
_pool: Optional[asyncpg.Pool] = None


async def get_pool() -> Optional[asyncpg.Pool]:
    """Get or create database connection pool."""
    global _pool
    if _pool is None:
        database_url = os.getenv("DATABASE_URL")
        if not database_url:
            # If DATABASE_URL not set, return None (graceful degradation - no DB caching)
            return None
        # asyncpg needs postgres:// not postgresql://
        if database_url.startswith("postgresql://"):
            database_url = database_url.replace("postgresql://", "postgres://", 1)
        _pool = await asyncpg.create_pool(database_url, min_size=2, max_size=10)
    return _pool


def location_hash(lat: float, lon: float, tz: str) -> str:
    """Create a hash for location+timezone for efficient lookups."""
    key = f"{lat:.4f}|{lon:.4f}|{tz}"
    return hashlib.md5(key.encode()).hexdigest()


async def init_db():
    """Initialize database schema."""
    pool = await get_pool()
    if pool is None:
        # No database configured - skip initialization
        return

    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS planetary_events (
                id SERIAL PRIMARY KEY,
                location_hash VARCHAR(32) NOT NULL,
                month_start VARCHAR(7) NOT NULL,
                data JSONB NOT NULL,
                computed_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(location_hash, month_start)
            );

            CREATE INDEX IF NOT EXISTS idx_location_month
            ON planetary_events(location_hash, month_start);
        """)


async def get_cached_month(
    lat: float, lon: float, tz: str, month_start_iso: str
) -> Optional[Dict[str, Any]]:
    """Get cached planetary events for a specific month."""
    pool = await get_pool()
    if pool is None:
        return None

    loc_hash = location_hash(lat, lon, tz)

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT data FROM planetary_events WHERE location_hash = $1 AND month_start = $2",
            loc_hash,
            month_start_iso[:7],  # Only YYYY-MM
        )

        if row:
            return json.loads(row["data"])
        return None


async def cache_month(
    lat: float, lon: float, tz: str, month_start_iso: str, data: Dict[str, Any]
):
    """Cache planetary events for a specific month."""
    pool = await get_pool()
    if pool is None:
        return  # No database - skip caching

    loc_hash = location_hash(lat, lon, tz)

    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO planetary_events (location_hash, month_start, data)
            VALUES ($1, $2, $3)
            ON CONFLICT (location_hash, month_start)
            DO UPDATE SET data = $3, computed_at = NOW()
            """,
            loc_hash,
            month_start_iso[:7],
            json.dumps(data),
        )


async def get_cache_stats() -> Dict[str, Any]:
    """Get cache statistics."""
    pool = await get_pool()
    if pool is None:
        return {
            "total_months_cached": 0,
            "unique_locations": 0,
            "cache_started": None,
            "database_enabled": False,
        }

    async with pool.acquire() as conn:
        total = await conn.fetchval("SELECT COUNT(*) FROM planetary_events")
        locations = await conn.fetchval(
            "SELECT COUNT(DISTINCT location_hash) FROM planetary_events"
        )
        oldest = await conn.fetchval(
            "SELECT MIN(computed_at) FROM planetary_events"
        )

        return {
            "total_months_cached": total,
            "unique_locations": locations,
            "cache_started": oldest.isoformat() if oldest else None,
            "database_enabled": True,
        }
