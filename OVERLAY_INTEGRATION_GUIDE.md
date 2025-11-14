# Advanced Overlays Integration Guide

## Status: Frontend Implementation In Progress

### ✅ COMPLETED:
1. Backend - All 5 overlay calculations
2. Backend - All 5 API endpoints
3. Frontend - API types and fetch functions in `lib/api.ts`

### 🔨 IN PROGRESS:
Frontend UI integration in `JupiterTerminal.tsx`

---

## What Needs to Be Added to JupiterTerminal.tsx

### 1. Add State Variables (after line 695 - after `orbitalSeries` state)

```typescript
// Advanced overlay states
const [sunspotSeries, setSunspotSeries] = useState<OrbitalOverlaySeries[]>([]);
const [tidalSeries, setTidalSeries] = useState<OrbitalOverlaySeries[]>([]);
const [barycenterSeries, setBarycenterSeries] = useState<OrbitalOverlaySeries[]>([]);
const [gravitationalSeries, setGravitationalSeries] = useState<OrbitalOverlaySeries[]>([]);
const [bradleySeries, setBradleySeries] = useState<OrbitalOverlaySeries[]>([]);

const [sunspotBusy, setSunspotBusy] = useState(false);
const [tidalBusy, setTidalBusy] = useState(false);
const [barycenterBusy, setBarycenterBusy] = useState(false);
const [gravitationalBusy, setGravitationalBusy] = useState(false);
const [bradleyBusy, setBradleyBusy] = useState(false);

const [sunspotError, setSunspotError] = useState<string | null>(null);
const [tidalError, setTidalError] = useState<string | null>(null);
const [barycenterError, setBarycenterError] = useState<string | null>(null);
const [gravitationalError, setGravitationalError] = useState<string | null>(null);
const [bradleyError, setBradleyError] = useState<string | null>(null);
```

### 2. Add Import Statements (at top of file)

```typescript
import {
  fetchSunspotOverlay,
  fetchTidalOverlay,
  fetchBarycenterOverlay,
  fetchGravitationalOverlay,
  fetchBradleyOverlay,
} from "@/lib/api";
```

### 3. Add Fetch Handler Functions (similar to `handleOverlayFetch`)

```typescript
const handleSunspotFetch = useCallback(async () => {
  if (!candles.length) return;

  const firstCandle = candles[0];
  const startDT = DateTime.fromSeconds(firstCandle.time, { zone: "UTC" });
  const startISO = startDT.toFormat("yyyy-MM-dd'T'HH:mm:ss");

  setSunspotBusy(true);
  setSunspotError(null);

  try {
    const response = await fetchSunspotOverlay({
      startISO,
      durationValue: 1,
      durationUnit: "years",
      intervalHours: 24,
    });
    setSunspotSeries(response.series);
  } catch (err) {
    setSunspotError(err instanceof Error ? err.message : String(err));
  } finally {
    setSunspotBusy(false);
  }
}, [candles]);

// Repeat for each overlay type...
const handleTidalFetch = useCallback(async () => { ... }, [candles]);
const handleBarycenterFetch = useCallback(async () => { ... }, [candles]);
const handleGravitationalFetch = useCallback(async () => { ... }, [candles]);
const handleBradleyFetch = useCallback(async () => { ... }, [candles]);

// Clear handlers
const handleSunspotClear = useCallback(() => {
  setSunspotSeries([]);
  setSunspotError(null);
}, []);
// Repeat for each overlay...
```

### 4. Add UI Components in Sidebar (after the Cyclic Overlay section, around line 3231)

```tsx
{/* Sunspot Overlay Section */}
<CollapsibleSection
  title="Sunspot Cycle"
  defaultOpen={false}
  disabled={!isPlus}
  onDisabledClick={() => {
    setUpgradeFeature("Sunspot Cycle overlay");
    setShowUpgradeModal(true);
  }}
>
  <div className="space-y-3">
    <div className="text-xs text-zinc-400">
      Plot NOAA sunspot cycle data on the chart.
    </div>

    <div className="flex gap-2">
      <button
        type="button"
        onClick={handleSunspotFetch}
        className="flex-1 rounded-none border border-green-600 bg-green-900/20 px-3 py-1.5 text-xs uppercase tracking-wide text-green-400 hover:bg-green-900/30 transition-colors disabled:opacity-50"
        disabled={sunspotBusy || !candles.length}
      >
        {sunspotBusy ? "Loading..." : "Load"}
      </button>
      <button
        type="button"
        onClick={handleSunspotClear}
        className="flex-1 rounded-none border border-zinc-700 bg-zinc-900/20 px-3 py-1.5 text-xs uppercase tracking-wide text-zinc-400 hover:bg-zinc-900/30 transition-colors disabled:opacity-50"
        disabled={sunspotBusy || sunspotSeries.length === 0}
      >
        Clear
      </button>
    </div>

    {sunspotError && (
      <div className="text-xs text-red-400">{sunspotError}</div>
    )}
    {!sunspotError && sunspotSeries.length > 0 && (
      <div className="text-xs text-green-400">
        {sunspotSeries.length} series ready.
      </div>
    )}
  </div>
</CollapsibleSection>

{/* Repeat similar sections for: */}
{/* - Tidal Forces */}
{/* - Barycenter Wobble */}
{/* - Gravitational Forces */}
{/* - Bradley Siderograph */}
```

### 5. Update overlayDatasetsMemo to Include New Series (around line 1766)

```typescript
const overlayDatasetsMemo = useMemo<IndicatorDataset[]>(() => {
  const datasets: IndicatorDataset[] = [];

  // Existing orbital series
  orbitalSeries.forEach((series, index) => {
    // ... existing code
  });

  // Add sunspot series
  sunspotSeries.forEach((series, index) => {
    const color = "#fbbf24"; // Amber for sunspot
    const points = series.timestamps.map((ts, i) => ({
      time: DateTime.fromISO(ts).toSeconds() as UTCTimestamp,
      value: series.values[i],
    }));

    datasets.push({
      name: series.name,
      type: "line",
      pane: "sunspot",
      priceScaleId: `sunspot-${index}`,
      data: points,
      color,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
  });

  // Add tidal series
  tidalSeries.forEach((series, index) => {
    // Similar to above with different pane and color
  });

  // Add barycenter series
  barycenterSeries.forEach((series, index) => {
    // Similar to above
  });

  // Add gravitational series
  gravitationalSeries.forEach((series, index) => {
    // Similar to above
  });

  // Add bradley series
  bradleySeries.forEach((series, index) => {
    // Similar to above
  });

  return datasets;
}, [
  orbitalSeries,
  sunspotSeries,
  tidalSeries,
  barycenterSeries,
  gravitationalSeries,
  bradleySeries,
  overlayLabel,
]);
```

### 6. Add Session Storage Persistence (in existing persistence code around line 1089)

```typescript
if (sunspotSeries.length > 0) {
  payload.sunspotSeries = sunspotSeries;
}
if (tidalSeries.length > 0) {
  payload.tidalSeries = tidalSeries;
}
// ... etc for each overlay
```

---

## Color Scheme for Overlays

```typescript
const OVERLAY_COLORS = {
  sunspot: "#fbbf24",      // Amber
  tidal: "#3b82f6",        // Blue
  barycenter: "#a855f7",   // Purple
  gravitational: "#ec4899", // Pink
  bradley: "#10b981",      // Green
};
```

---

## Testing Checklist

After implementation:

- [ ] Deploy backend to Railway
- [ ] Deploy frontend to Vercel
- [ ] Test Sunspot overlay loads data
- [ ] Test Tidal overlay shows Moon/Sun/Jupiter forces
- [ ] Test Barycenter shows Sun radii distance
- [ ] Test Gravitational shows net force
- [ ] Test Bradley shows indicator values
- [ ] Verify all overlays render as separate panes
- [ ] Verify overlays persist across page refreshes
- [ ] Verify overlays clear correctly
- [ ] Test with Plus plan requirement

---

## Current File Locations

- Backend: `/backend/app/overlays.py` ✅
- Backend API: `/backend/app/main.py` (lines 409-574) ✅
- Frontend API: `/vedic-ui/src/lib/api.ts` (lines 253-349) ✅
- Frontend UI: `/vedic-ui/src/components/JupiterTerminal.tsx` ⏳ IN PROGRESS

---

## Next Steps

1. Add all state variables to JupiterTerminal
2. Add fetch handler functions
3. Add 5 CollapsibleSection UI components
4. Wire overlay data to overlayDatasetsMemo
5. Test locally
6. Commit and deploy
