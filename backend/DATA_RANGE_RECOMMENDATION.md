# Data Range Recommendation for THREE AXIS

## Swiss Ephemeris Range

The Swiss Ephemeris library supports:
- **Full precision**: 3000 BC to 3000 AD
- **Lower precision**: 10000 BC to 10000 AD (using long-range files)

## Current Implementation

**No hard limits!** The backend currently accepts any date range that Swiss Ephemeris supports.

## Recommended Pre-computation Strategy

### For Production Deployment:

Pre-compute and cache events for commonly used ranges:

#### **Historical Data** (Past)
- **10 years back**: 2015-2025 (covers most market analysis)
- **50 years back**: 1975-2025 (institutional research)
- **100 years back**: 1925-2025 (long-term patterns)

#### **Future Data** (Forward)
- **5 years forward**: 2025-2030 (near-term planning)
- **10 years forward**: 2025-2035 (extended forecasting)

### Why These Ranges?

1. **Market Data Availability**: Most free market data only goes back 10-20 years
2. **Common Use Cases**: 95% of users need data within ±10 years
3. **Storage Efficiency**: ~10 years = ~120 months = manageable cache size
4. **Computation Time**: Balance between coverage and pre-computation time

## Cache Strategy

### Tier 1: Hot Cache (Always in Memory)
- **Range**: Current year ± 2 years
- **TTL**: 24 hours
- **Size**: ~60 months × 4 KB = ~240 KB per location
- **Benefit**: Instant response for 99% of queries

### Tier 2: Warm Cache (Redis/Database)
- **Range**: ±10 years from current
- **TTL**: 7 days
- **Size**: ~240 months × 4 KB = ~1 MB per location
- **Benefit**: Fast response for historical analysis

### Tier 3: Cold Compute (On-Demand)
- **Range**: Everything else
- **TTL**: 1 hour
- **Benefit**: Available but slower, still faster than frontend computation

## Locations to Pre-compute

Pre-compute for major financial centers:

1. **New York** (40.7128, -74.0060) - NYSE timezone
2. **London** (51.5074, -0.1278) - LSE timezone  
3. **Tokyo** (35.6762, 139.6503) - TSE timezone
4. **Mumbai** (19.0760, 72.8777) - NSE/BSE timezone
5. **Hong Kong** (22.3193, 114.1694) - HKEX timezone
6. **Frankfurt** (50.1109, 8.6821) - FSE timezone
7. **Shanghai** (31.2304, 121.4737) - SSE timezone
8. **Sydney** (33.8688, 151.2093) - ASX timezone

**Total storage**: 8 locations × 1 MB × (hot + warm) = ~16 MB

## Implementation Timeline

### Phase 1: Current (Done ✅)
- Batch API with 1-hour in-memory cache
- Supports any date range on-demand

### Phase 2: Next (Recommended)
- Add Redis cache layer
- Pre-compute hot cache ranges (±2 years) for 8 major locations
- Background worker to refresh monthly

### Phase 3: Future (Optional)
- Add PostgreSQL for persistent storage
- Pre-compute warm cache ranges (±10 years)
- Admin API to trigger pre-computation for custom locations

## Cost-Benefit Analysis

### Current Setup (Phase 1)
- Cost: ~5 seconds for 5 years first time
- Benefit: Works for any location/date immediately
- Cache: 1 hour (good enough for development)

### With Redis (Phase 2)
- Cost: ~$20/month for managed Redis
- Benefit: <100ms for 99% of queries
- Cache: Persistent across deploys

### With PostgreSQL (Phase 3)
- Cost: ~$30/month for database
- Benefit: Unlimited historical data
- Cache: Infinite (data never expires)

## Recommendation

**For MVP/Launch**: Stick with Phase 1 (current)
- Already handles your use case
- No additional infrastructure cost
- Can handle thousands of users with 1-hour cache

**For Scale**: Implement Phase 2 when you hit:
- 10,000+ monthly active users
- Cache hit rate < 50%
- P95 latency > 2 seconds

**For Enterprise**: Phase 3 when you need:
- Custom locations for institutional clients
- Historical analysis > 10 years
- Data export features
