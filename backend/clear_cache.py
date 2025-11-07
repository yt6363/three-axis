#!/usr/bin/env python3
"""
Script to clear all cached planetary data from Neon database.
"""
import asyncio
import asyncpg
import os

async def clear_cache():
    """Delete all cached data from the database."""
    database_url = os.getenv("DATABASE_URL")

    if not database_url:
        print("❌ DATABASE_URL environment variable not set")
        print("Please set it with:")
        print('export DATABASE_URL="postgresql://neondb_owner:npg_XxBDP9JYR6ik@ep-dark-dew-adtwiwlu-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require"')
        return

    # asyncpg needs postgres:// not postgresql://
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgres://", 1)

    print("🗑️  Connecting to Neon database...")

    try:
        conn = await asyncpg.connect(database_url)

        # Count rows before deletion
        count = await conn.fetchval("SELECT COUNT(*) FROM planetary_events")
        print(f"📊 Current rows in database: {count:,}")

        if count == 0:
            print("✅ Database is already empty")
            await conn.close()
            return

        # Confirm deletion
        print(f"\n⚠️  WARNING: This will delete ALL {count:,} cached planetary events!")
        print("Press Ctrl+C within 5 seconds to cancel...")
        await asyncio.sleep(5)

        print("\n🗑️  Deleting all cached data...")
        await conn.execute("DELETE FROM planetary_events")

        # Verify deletion
        final_count = await conn.fetchval("SELECT COUNT(*) FROM planetary_events")
        print(f"✅ Deletion complete! Rows remaining: {final_count}")

        await conn.close()
        print("✨ Database cleared successfully!")

    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    try:
        asyncio.run(clear_cache())
    except KeyboardInterrupt:
        print("\n\n⚠️  Deletion cancelled by user")
