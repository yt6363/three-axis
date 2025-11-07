# Ayanamsa Multi-System Implementation Plan

## Problem Discovered
- Current code uses **BV Raman ayanamsa (22° 46')**
- App results match **~24° 08'** (likely Lahiri or Krishnamurti)
- Database has **1,009 months of cached data with wrong ayanamsa**
- Need to support user choice of ayanamsa system

## Solution: Multi-Ayanamsa Support

Allow users to choose from 3 systems:
1. **Lahiri** (24° 13' for 2025) - Government of India standard
2. **BV Raman** (22° 46' for 2025) - Popular Vedic system
3. **Tropical** (0° - Western astrology)

## Implementation Steps

### 1. Database Changes (COMPLETED ✅)
- [x] Updated `database.py` to include ayanamsa in location_hash
- [x] Modified schema to add `ayanamsa VARCHAR(20)` column
- [x] Updated UNIQUE constraint to `(location_hash, ayanamsa, month_start)`
- [x] Updated `get_cached_month()` to accept ayanamsa parameter
- [x] Updated `cache_month()` to store ayanamsa
- [ ] **TODO: Deploy and run to drop old table and create new schema**

### 2. Backend swiss.py Changes (TODO)

Current code (line 210):
```python
swe.set_sid_mode(swe.SIDM_RAMAN, 0, 0)
```

**Changes needed:**
- [ ] Remove global `set_sid_mode` from `_initialise_once()`
- [ ] Add ayanamsa parameter to all calculation functions
- [ ] Create helper function to set ayanamsa per calculation:

```python
AYANAMSA_MAP = {
    "lahiri": swe.SIDM_LAHIRI,
    "raman": swe.SIDM_RAMAN,
    "tropical": None  # No ayanamsa for tropical
}

def _set_ayanamsa(ayanamsa: str):
    """Set the ayanamsa system for calculations."""
    if ayanamsa == "tropical":
        # Use tropical (no sidereal mode)
        return swe.FLG_MOSEPH
    else:
        sid_mode = AYANAMSA_MAP.get(ayanamsa, swe.SIDM_LAHIRI)
        swe.set_sid_mode(sid_mode, 0, 0)
        return swe.FLG_MOSEPH | swe.FLG_SIDEREAL
```

- [ ] Update these functions to accept ayanamsa parameter:
  - `_ascendant_sidereal_deg(dt, lat, lon, ayanamsa="lahiri")`
  - `_planet_lon_speed(dt, planet, ayanamsa="lahiri", with_speed=False)`
  - `compute_horizon(payload, ayanamsa="lahiri")`
  - `compute_monthly(payload, ayanamsa="lahiri")`

### 3. API Endpoint Changes (TODO)

Update payload models in `main.py`:

```python
class SwissMonthlyBatchPayload(BaseModel):
    lat: float
    lon: float
    tz: str
    month_start_isos: List[str]
    ayanamsa: str = "lahiri"  # NEW: default to Lahiri

    @validator('ayanamsa')
    def validate_ayanamsa(cls, v):
        if v not in ["lahiri", "raman", "tropical"]:
            raise ValueError('ayanamsa must be lahiri, raman, or tropical')
        return v
```

- [ ] Add ayanamsa field to `SwissHorizonPayload`
- [ ] Add ayanamsa field to `SwissMonthlyPayload`
- [ ] Add ayanamsa field to `SwissMonthlyBatchPayload`
- [ ] Update all `compute_*` function calls to pass ayanamsa
- [ ] Update database cache calls to include ayanamsa

### 4. Cache Warming Script (TODO)

Create new `warm_cache_multi_ayanamsa.py`:

```python
LOCATIONS = {
    "India": [
        {"name": "Mumbai", "lat": 19.0760, "lon": 72.8777, "tz": "Asia/Kolkata"},
    ],
    "USA": [
        {"name": "New York", "lat": 40.7128, "lon": -74.0060, "tz": "America/New_York"},
    ],
}

AYANAMSA_SYSTEMS = ["lahiri", "raman", "tropical"]

# For each location
#   For each ayanamsa
#     Cache all months 1990-2030
```

**Expected cache size:**
- 2 locations × 3 ayanamsas × 492 months = **2,952 total months**
- Estimated storage: ~22 MB (well within 512 MB free tier)
- Estimated time: ~4-6 hours total

### 5. Frontend Changes (TODO)

**Add to user settings/preferences:**

```typescript
// In user settings component
const [ayanamsa, setAyanamsa] = useState<"lahiri" | "raman" | "tropical">("lahiri");

<select value={ayanamsa} onChange={(e) => setAyanamsa(e.target.value)}>
  <option value="lahiri">Lahiri (Chitrapaksha) - 24°13'</option>
  <option value="raman">BV Raman - 22°46'</option>
  <option value="tropical">Tropical (Western) - 0°</option>
</select>
```

**Update API calls:**
- [ ] Add ayanamsa parameter to all `/api/swiss/*` requests
- [ ] Store user preference in localStorage or user profile
- [ ] Pass ayanamsa to batch requests

### 6. Migration Steps

**When ready to deploy:**

1. **Clear database** (already has wrong data):
   ```sql
   -- Run in Neon SQL Editor
   DELETE FROM planetary_events;
   ```

2. **Deploy backend changes**:
   ```bash
   cd backend
   git add .
   git commit -m "feat: Add multi-ayanamsa support (Lahiri, Raman, Tropical)"
   git push
   railway up
   ```

3. **Verify schema update**:
   ```bash
   curl https://jupiter-terminal-production.up.railway.app/api/cache/stats
   # Should show: database_enabled: true, total_months_cached: 0
   ```

4. **Run cache warming**:
   ```bash
   python3 warm_cache_multi_ayanamsa.py
   # This will take 4-6 hours
   ```

5. **Deploy frontend changes**:
   ```bash
   cd vedic-ui
   git add .
   git commit -m "feat: Add ayanamsa selector in settings"
   git push
   # Vercel auto-deploys
   ```

### 7. Testing Plan

**Test each ayanamsa system:**

1. **Lahiri (24° 13')**:
   - Request planetary data with `ayanamsa=lahiri`
   - Compare ingress times with known Lahiri ephemeris
   - Should match your current app results (~24°08')

2. **BV Raman (22° 46')**:
   - Request with `ayanamsa=raman`
   - Verify ~1.5° difference from Lahiri results
   - Compare with BV Raman ephemeris

3. **Tropical (0°)**:
   - Request with `ayanamsa=tropical`
   - Should match Western astrology software
   - ~24° ahead of Lahiri positions

## Current Status

✅ Database schema updated (database.py)
⏸️ Waiting for user decision on implementation details
🔴 Backend swiss.py needs updates
🔴 API endpoints need ayanamsa parameter
🔴 Cache warming script needs creation
🔴 Frontend settings need ayanamsa selector

## Files Modified So Far

1. `backend/app/database.py` - Updated for multi-ayanamsa support
2. `backend/clear_cache.py` - Script to clear database (created)
3. `backend/warm_cache.py` - Single ayanamsa version (exists)

## Files That Need Changes

1. `backend/app/swiss.py` - Add ayanamsa parameter to all functions
2. `backend/app/main.py` - Add ayanamsa to payload models
3. `backend/warm_cache_multi_ayanamsa.py` - New script for 3 systems
4. `vedic-ui/src/components/Settings.tsx` - Add ayanamsa selector
5. `vedic-ui/src/components/JupiterTerminal.tsx` - Pass ayanamsa to API

## Storage Estimate

| Ayanamsa Systems | Locations | Years | Months | Storage |
|------------------|-----------|-------|--------|---------|
| 3 systems | 2 cities | 41 years | 2,952 | ~22 MB |
| 3 systems | 5 cities | 41 years | 7,380 | ~55 MB |
| 3 systems | 10 cities | 41 years | 14,760 | ~110 MB |

**Neon free tier: 512 MB** - plenty of space!

## Questions for User

1. ✅ Which ayanamsa systems? **Answer: Lahiri, BV Raman, Tropical**
2. ✅ Pre-cache which locations? **Answer: Mumbai, New York**
3. ✅ Pre-cache which years? **Answer: 1990-2030**
4. ⏳ Where to put ayanamsa selector in UI? **Pending: Account Settings**
5. ⏳ Default ayanamsa? **Pending: Probably Lahiri (most common)**

## Next Session Action Items

1. Confirm default ayanamsa (suggest: Lahiri)
2. Modify `swiss.py` to support multiple ayanamsa systems
3. Update API endpoints to accept ayanamsa parameter
4. Create multi-ayanamsa cache warming script
5. Deploy and test with all 3 systems
6. Add frontend ayanamsa selector

---

**Generated:** 2025-11-07
**Status:** In Progress
**Priority:** HIGH (affects data accuracy)
