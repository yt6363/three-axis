"use client";
import React from 'react';
import { DateTime } from "luxon";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
} from "react";
import type { LineData, SeriesMarker, Time, UTCTimestamp } from "lightweight-charts";
import { TrendingUp } from "lucide-react";

import {
  EChartsContainer,
  type EChartsContainerHandle,
  type OverlayEventLine,
  type PlanetaryLineSeries,
} from "@/components/EChartsContainer";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import type { Candle, Interval, Period, OrbitalOverlaySeries } from "@/lib/api";
import { fetchOHLC, fetchOrbitalOverlay, fetchPlanetaryTimeseries } from "@/lib/api";
import type { IndicatorDataset } from "@/lib/indicators";

type Suggestion = {
  label: string;
  value: string;
  secondary?: string;
};

type CsvColumns = {
  date: number;
  open: number;
  high: number;
  low: number;
  close: number;
  price?: number;
  volume?: number;
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") ?? "http://localhost:8000";

const INTERVAL_TO_MINUTES: Record<Interval, number> = {
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
  "1wk": 10080,
  "1mo": 43200,
  "3mo": 129600,
};

type DurationUnit = "years" | "months" | "weeks" | "days";

type SearchQuote = {
  symbol: string;
  name: string;
  exchange?: string;
};

function cls(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

function hasSignChange(event: { from: string; to: string }): boolean {
  const from = event.from?.trim().toLowerCase() ?? "";
  const to = event.to?.trim().toLowerCase() ?? "";
  return from !== to;
}

const PLANET_CODES: Record<string, string> = {
  Sun: "S",
  Moon: "Mo",
  Mercury: "Me",
  Venus: "V",
  Mars: "Ma",
  Jupiter: "J",
  Saturn: "Sa",
  Neptune: "N",
  Uranus: "U",
  Pluto: "P",
};

const EVENT_CODES = {
  ingress: "I",
  combustion: "C",
  retro: "R",
  velocity: "V",
  lagna: "L",
  moon: "NAK",
} as const;

function formatPlanetCode(name: string | undefined): string {
  if (!name) return "";
  return PLANET_CODES[name] ?? name.slice(0, 2).toUpperCase();
}

function toTitleCase(value: string | undefined): string {
  if (!value) return "";
  return value.slice(0, 1).toUpperCase() + value.slice(1).toLowerCase();
}

function planetCodeFromSlug(slug: string | undefined): string {
  if (!slug) return "";
  const titled = toTitleCase(slug);
  return formatPlanetCode(titled);
}

function useDebouncedValue<T>(value: T, delay = 150): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(handle);
  }, [value, delay]);
  return debounced;
}

const ORBITAL_COLORS = [
  "#8bb8f2",
  "#9adbc5",
  "#f5b6d7",
  "#d8c3ff",
  "#f3c995",
  "#a6c1ff",
  "#c0e4d8",
];

const JUPITER_TERMINAL_SESSION_KEY = "vd:jupiter-terminal-state:v1";

const DURATION_UNITS = ["years", "months", "weeks", "days"] as const;

const PERIOD_OPTIONS = ["5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "max"] as const;

const MAX_CANDLES_TO_STORE = 4000;

type PersistedTerminalState = {
  symbolInput?: string;
  activeSymbol?: string;
  interval?: Interval;
  period?: Period;
  showVolume?: boolean;
  drawingTool?: "trendline" | null;
  eventRangeStart?: string;
  eventRangeEnd?: string;
  lagnaRangeStart?: string;
  lagnaRangeEnd?: string;
  ingressEnabledInput?: boolean;
  combustionEnabledInput?: boolean;
  retroEnabledInput?: boolean;
  velocityEnabledInput?: boolean;
  lagnaEnabledInput?: boolean;
  moonEnabledInput?: boolean;
  selectedPlanets?: string[];
  overlayStartDate?: string;
  overlayDurationUnit?: DurationUnit;
  overlayDurationValue?: number;
  overlayPlotGravForce?: boolean;
  overlayPlotSpeed?: boolean;
  overlayPlotGeoDeclination?: boolean;
  overlayPlotHelioDeclination?: boolean;
  overlayPlotWeightedGeo?: boolean;
  overlayPlotWeightedHelio?: boolean;
  overlayWeightsInput?: string;
  speedZoom?: number;
  forceZoom?: number;
  ingressPlanets?: string[];
  combustionPlanets?: string[];
  retroPlanets?: string[];
  velocityPlanets?: string[];
  planetaryLinesEnabled?: boolean;
  planetaryLinesPlanet?: string;
  planetaryLinesScale?: number;
  planetaryLinesHarmonic?: number;
  candles?: Candle[];
  dataTitle?: string;
  lastUpdated?: string | null;
  uploadName?: string | null;
  orbitalSeries?: OrbitalOverlaySeries[];
  overlayError?: string | null;
  planetaryLineSeriesData?: PlanetaryLineSeries[];
  chartRangeStart?: number | null;
  chartRangeEnd?: number | null;
};

type IngressEvent = {
  timeISO: string;
  body: string;
  from: string;
  to: string;
};

type CombustionEvent = {
  startISO: string;
  endISO: string | null;
  planet: string;
  orbDeg: number;
};

type RetroEvent = {
  planet: string;
  state: string;
  startISO: string;
  endISO: string | null;
};

type VelocityEvent = {
  planet: string;
  kind: "max" | "min";
  timeISO: string;
  speed: number;
};

type LagnaEvent = {
  timeISO: string;
  from: string;
  to: string;
  degree: number;
};

type MoonEvent = {
  timeISO: string;
  nakshatra: string;
  pada: number;
};

function groupEventLines(lines: OverlayEventLine[]): OverlayEventLine[] {
  const eventsPerTimestamp = new Map<number, { colors: string[]; labels: string[] }>();
  lines.forEach(({ time, color, label }) => {
    if (time == null) return;
    if (!eventsPerTimestamp.has(time)) {
      eventsPerTimestamp.set(time, { colors: [], labels: [] });
    }
    const group = eventsPerTimestamp.get(time)!;
    group.colors.push(color);
    group.labels.push(label ?? "");
  });
  const grouped: OverlayEventLine[] = [];
  eventsPerTimestamp.forEach((group, time) => {
    if (group.labels.length === 1) {
      grouped.push({ time, color: group.colors[0]!, label: group.labels[0]! });
    } else {
      const combinedLabel = group.labels
        .map((lbl, idx) => `${idx === 0 ? "" : "\n  "}${lbl}`)
        .join("");
      const labelWithCount = `[${group.labels.length} Events]\n${combinedLabel}`;
      grouped.push({ time, color: group.colors[0]!, label: labelWithCount });
    }
  });
  return grouped;
}

type JupiterTerminalProps = {
  plan: "free" | "plus" | "admin";
  tz: string;
  ingressEvents: IngressEvent[];
  combustionEvents: CombustionEvent[];
  retroEvents: RetroEvent[];
  velocityEvents: VelocityEvent[];
  lagnaEvents: LagnaEvent[];
  moonEvents: MoonEvent[];
  onRangeChange?: (range: { start: number | null; end: number | null }) => void;
};

function useDropdownControl() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (event: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return { open, setOpen, ref };
}

function toUtcSecondsFromEvent(timeISO: string, zone: string): number | null {
  let dt = DateTime.fromFormat(timeISO, "yyyy-LL-dd HH:mm:ss", { zone });
  if (!dt.isValid) {
    dt = DateTime.fromISO(timeISO, { zone });
  }
  if (!dt.isValid) {
    return null;
  }

  return Math.floor(dt.toUTC().toSeconds());
}

function toUtcSecondsFromInput(value: string, zone: string): number | null {
  if (!value) return null;
  let dt = DateTime.fromISO(value, { zone });
  if (!dt.isValid) {
    dt = DateTime.fromFormat(value, "MM/dd/yyyy, HH:mm", { zone });
  }
  if (!dt.isValid) {
    dt = DateTime.fromFormat(value, "MM/dd/yyyy HH:mm", { zone });
  }
  if (!dt.isValid) return null;
  return Math.floor(dt.toUTC().toSeconds());
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

function buildColumns(header: string[]): CsvColumns {
  const map = new Map<string, number>();
  header.forEach((value, index) => {
    map.set(value.trim().toLowerCase(), index);
  });

  const find = (candidates: string[]): number => {
    for (const candidate of candidates) {
      const idx = map.get(candidate);
      if (typeof idx === "number" && idx >= 0) {
        return idx;
      }
    }
    return -1;
  };

  const date = find(["date", "datetime", "timestamp", "time", "timestamp_local"]);
  if (date === -1) {
    throw new Error("CSV must include a date or timestamp column");
  }

  const open = find(["open"]);
  const high = find(["high"]);
  const low = find(["low"]);
  const close = find(["close"]);
  const price = find(["price"]);
  const volume = find(["volume", "vol"]);

  if ([open, high, low, close].every((idx) => idx === -1)) {
    if (price === -1) {
      throw new Error("CSV missing required OHLC columns");
    }
    return { date, open: price, high: price, low: price, close: price, price };
  }

  const missing: string[] = [];
  if (open === -1) missing.push("open");
  if (high === -1) missing.push("high");
  if (low === -1) missing.push("low");
  if (close === -1) missing.push("close");
  if (missing.length) {
    throw new Error(
      `CSV missing required OHLC columns: ${missing.join(", ")}`,
    );
  }

  return { date, open, high, low, close, volume };
}

function parseCsvCandles(text: string, timezone: string): Candle[] {
  const rows = text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (rows.length <= 1) {
    throw new Error("CSV file is empty or missing data rows");
  }

  const headerCells = splitCsvLine(rows[0]);
  const columns = buildColumns(headerCells);

  const candles: Candle[] = [];

  for (let i = 1; i < rows.length; i += 1) {
    const rawLine = rows[i];
    if (!rawLine) continue;
    const cells = splitCsvLine(rawLine);
    if (cells.length < headerCells.length) continue;

    const rawDate = cells[columns.date]?.trim();
    if (!rawDate) continue;

    // FIX: Use Luxon to parse date in the specified timezone (not browser timezone)
    // This ensures CSV timestamps are interpreted in the same timezone as events
    let dt = DateTime.fromISO(rawDate, { zone: timezone });
    if (!dt.isValid) {
      dt = DateTime.fromFormat(rawDate, "yyyy-MM-dd HH:mm:ss", { zone: timezone });
    }
    if (!dt.isValid) {
      dt = DateTime.fromFormat(rawDate, "MM/dd/yyyy HH:mm:ss", { zone: timezone });
    }
    if (!dt.isValid) {
      // Fallback to Date.parse for UTC timestamps (e.g., "2024-03-15T18:30:00Z")
      const timestamp = Date.parse(rawDate);
      if (Number.isNaN(timestamp)) continue;
      dt = DateTime.fromMillis(timestamp, { zone: "UTC" });
    }

    const timestamp = dt.toSeconds() * 1000;

    // Log first few candles to verify CSV parsing
    if (i <= 3) {
      console.debug(
        `📊 CSV Candle ${i}:\n` +
        `  Raw Date: "${rawDate}"\n` +
        `  Timezone: "${timezone}"\n` +
        `  Parsed: ${dt.toISO()} (${dt.toFormat('yyyy-MM-dd HH:mm:ss ZZZZ')})\n` +
        `  Timestamp (seconds): ${Math.floor(timestamp / 1000)}\n` +
        `  Date Check: ${new Date(Math.floor(timestamp / 1000) * 1000).toISOString()}`
      );
    }

    const readNumeric = (idx: number): number | null => {
      const raw = cells[idx];
      if (raw == null) return null;
      const value = Number.parseFloat(raw.replace(/[$,%]/g, ""));
      if (!Number.isFinite(value)) return null;
      return value;
    };

    const open = readNumeric(columns.open);
    const high = readNumeric(columns.high);
    const low = readNumeric(columns.low);
    const close = readNumeric(columns.close);
    const volume =
      columns.volume != null && columns.volume >= 0
        ? readNumeric(columns.volume) ?? 0
        : 0;

    if (
      open == null ||
      high == null ||
      low == null ||
      close == null ||
      Number.isNaN(open) ||
      Number.isNaN(high) ||
      Number.isNaN(low) ||
      Number.isNaN(close)
    ) {
      continue;
    }

    candles.push({
      time: Math.floor(timestamp / 1000),
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) ? volume : 0,
    });
  }

  if (candles.length === 0) {
    throw new Error("No valid OHLC rows found in CSV");
  }

  candles.sort((a, b) => a.time - b.time);
  return candles;
}

function formatNumber(value: number | undefined | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString(undefined, {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    });
  }
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 4,
    minimumFractionDigits: 0,
  });
}

export function JupiterTerminal({
  plan,
  tz,
  ingressEvents,
  combustionEvents,
  retroEvents,
  velocityEvents,
  lagnaEvents,
  moonEvents,
  onRangeChange,
}: JupiterTerminalProps) {
  const isPlus = plan === "plus" || plan === "admin";
  const isAdmin = plan === "admin";
  const [hasRestoredSessionState, setHasRestoredSessionState] = useState(false);
  const initialSymbolRef = useRef<string | null>(null);
  const [showSplash, setShowSplash] = useState(true);
  const [symbolInput, setSymbolInput] = useState("^NSEI");
  const [activeSymbol, setActiveSymbol] = useState("^NSEI");
  const [interval, setInterval] = useState<Interval>("1d");
  const [period, setPeriod] = useState<Period>("5y");
  const [customIntervalInput, setCustomIntervalInput] = useState("");
  const [customPeriodInput, setCustomPeriodInput] = useState("");
  const [showIntervalCustom, setShowIntervalCustom] = useState(false);
  const [showPeriodCustom, setShowPeriodCustom] = useState(false);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [dataTitle, setDataTitle] = useState<string>("^NSEI • 1d • 5y");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    const hideTimer = window.setTimeout(() => setShowSplash(false), 2800);
    return () => {
      window.clearTimeout(hideTimer);
    };
  }, []);

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const blurTimer = useRef<number | null>(null);

  const [hoverCandle, setHoverCandle] = useState<Candle | null>(null);
  const [showVolume, setShowVolume] = useState(false);
  const [drawingTool, setDrawingTool] = useState<"trendline" | null>(null);
  const [, startTransition] = useTransition();

  const suggestionsContainerRef = useRef<HTMLDivElement | null>(null);
  const chartHandleRef = useRef<EChartsContainerHandle | null>(null);
  const eventLinesCacheRef = useRef<Map<string, OverlayEventLine[]>>(new Map());
  const planetaryLinesCacheRef = useRef<Map<string, PlanetaryLineSeries[]>>(new Map());

  const eventLabels = useMemo(() => ({
    ingress: isAdmin ? "Ingress" : EVENT_CODES.ingress,
    combustion: isAdmin ? "Combustion" : EVENT_CODES.combustion,
    retro: isAdmin ? "Retro" : EVENT_CODES.retro,
    velocity: isAdmin ? "Velocity" : EVENT_CODES.velocity,
    lagna: isAdmin ? "Lagna" : EVENT_CODES.lagna,
    moon: isAdmin ? "Moon" : EVENT_CODES.moon,
  }), [isAdmin]);

  const planetLabel = useCallback(
    (name: string | undefined) => (isAdmin ? name ?? "" : formatPlanetCode(name)),
    [isAdmin],
  );

  const drawingActive = drawingTool === "trendline";
  const baseControlClasses =
    "rounded-none px-3 py-[0.4rem] text-[0.7rem] tracking-[0.08em] transition-colors border";
  const defaultControlClasses =
    "border-transparent bg-zinc-900 text-zinc-200 hover:border-zinc-600/70";
  const activeControlClasses =
    "border-sky-500 bg-sky-900/25 text-sky-200";

  const [eventRangeStart, setEventRangeStart] = useState("");
  const [eventRangeEnd, setEventRangeEnd] = useState("");
  const [lagnaRangeStart, setLagnaRangeStart] = useState("");
  const [lagnaRangeEnd, setLagnaRangeEnd] = useState("");

  const [chartVisibleRange, setChartVisibleRange] = useState<{
    start: number | null;
    end: number | null;
  } | null>(null);
const chartVisibleRangeRef = useRef<{ start: number | null; end: number | null } | null>(null);
const pendingVisibleRangeRef = useRef<{ start: number | null; end: number | null } | null>(null);
const visibleRangeTimeoutRef = useRef<number | null>(null);
const visibleRangeAppliedRef = useRef(false);
const [chartReadyTick, setChartReadyTick] = useState(0);

  const [ingressEnabledInput, setIngressEnabledInput] = useState(false);
  const [combustionEnabledInput, setCombustionEnabledInput] = useState(false);
  const [retroEnabledInput, setRetroEnabledInput] = useState(false);
  const [velocityEnabledInput, setVelocityEnabledInput] = useState(false);
  const [lagnaEnabledInput, setLagnaEnabledInput] = useState(false);
  const [moonEnabledInput, setMoonEnabledInput] = useState(false);

  const ingressEventsKey = useMemo(() => ingressEvents.map((event) => event.timeISO).join('|'), [ingressEvents]);
  const combustionEventsKey = useMemo(() => combustionEvents.map((event) => `${event.startISO}-${event.endISO ?? ''}`).join('|'), [combustionEvents]);
  const retroEventsKey = useMemo(() => retroEvents.map((event) => `${event.startISO}-${event.endISO ?? ''}`).join('|'), [retroEvents]);
  const velocityEventsKey = useMemo(() => velocityEvents.map((event) => event.timeISO).join('|'), [velocityEvents]);
  const lagnaEventsKey = useMemo(() => lagnaEvents.map((event) => event.timeISO).join('|'), [lagnaEvents]);
  const moonEventsKey = useMemo(() => moonEvents.map((event) => event.timeISO).join('|'), [moonEvents]);
  const candlesKey = useMemo(() => {
    if (!candles.length) return 'empty';
    const first = candles[0]?.time ?? 0;
    const last = candles[candles.length - 1]?.time ?? 0;
    return `${first}-${last}-${candles.length}`;
  }, [candles]);

  // Planetary Lines state
  const [planetaryLinesEnabled, setPlanetaryLinesEnabled] = useState(false);
  const [planetaryLinesPlanet, setPlanetaryLinesPlanet] = useState<string>("Sun");
  const [planetaryLinesScale, setPlanetaryLinesScale] = useState<number>(1); // 1 degree = $1
  const [planetaryLinesHarmonic, setPlanetaryLinesHarmonic] = useState<number>(360); // 360, 180, or 120
  const [planetaryLineSeriesData, setPlanetaryLineSeriesData] = useState<PlanetaryLineSeries[]>([]);
  const planetaryLineSeriesMemo = useMemo(
    () => planetaryLineSeriesData,
    [planetaryLineSeriesData]
  );
  const [planetaryLineSeriesState, setPlanetaryLineSeriesState] = useState<PlanetaryLineSeries[]>(
    planetaryLineSeriesMemo
  );
  useEffect(() => {
    startTransition(() => {
      setPlanetaryLineSeriesState(planetaryLineSeriesMemo);
    });
  }, [planetaryLineSeriesMemo, startTransition]);

  const planetaryLinesCacheKey = useMemo(
    () =>
      JSON.stringify({
        planet: planetaryLinesPlanet,
        scale: planetaryLinesScale,
        harmonic: planetaryLinesHarmonic,
        candlesKey,
      }),
    [planetaryLinesPlanet, planetaryLinesScale, planetaryLinesHarmonic, candlesKey]
  );
  const ingressEnabled = useDebouncedValue(ingressEnabledInput);
  const combustionEnabled = useDebouncedValue(combustionEnabledInput);
  const retroEnabled = useDebouncedValue(retroEnabledInput);
  const velocityEnabled = useDebouncedValue(velocityEnabledInput);
  const lagnaEnabled = useDebouncedValue(lagnaEnabledInput);
  const moonEnabled = useDebouncedValue(moonEnabledInput);
  // Changed to array for multi-select dropdown
  const [selectedPlanets, setSelectedPlanets] = useState<string[]>([
    "Sun",
    "Mercury",
  ]);
  const [overlayStartDate, setOverlayStartDate] = useState<string>(() =>
    DateTime.now().minus({ years: 2 }).toISODate() ?? "",
  );
  const [overlayDurationUnit, setOverlayDurationUnit] = useState<DurationUnit>("years");
  const [overlayDurationValue, setOverlayDurationValue] = useState<number>(2);
  const [overlayPlotGravForce, setOverlayPlotGravForce] = useState(false);
  const [overlayPlotSpeed, setOverlayPlotSpeed] = useState(false);
  const [overlayPlotGeoDeclination, setOverlayPlotGeoDeclination] = useState(true); // GD enabled by default
  const [overlayPlotHelioDeclination, setOverlayPlotHelioDeclination] = useState(false);
  const [overlayPlotWeightedGeo, setOverlayPlotWeightedGeo] = useState(false);
  const [overlayPlotWeightedHelio, setOverlayPlotWeightedHelio] = useState(false);
  const [overlayWeightsInput, setOverlayWeightsInput] = useState(
    "S=7, Mo=7, Me=6, V=5, Ma=3, J=2, Sa=1"
  );
  const [speedZoom, setSpeedZoom] = useState(1);
  const [forceZoom, setForceZoom] = useState(1);
  const stageZoomMemo = useMemo(
    () => ({ speed: speedZoom, force: forceZoom }),
    [speedZoom, forceZoom]
  );
  const [overlayBusy, setOverlayBusy] = useState(false);
  const [overlayError, setOverlayError] = useState<string | null>(null);
  const [orbitalSeries, setOrbitalSeries] = useState<OrbitalOverlaySeries[]>([]);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeFeature, setUpgradeFeature] = useState<string>("");

  const isLoadingMemo = useMemo(() => isLoading, [isLoading]);

  const allPlanetNames = useMemo(() => Object.keys(PLANET_CODES), []);
  const overlayUsesWeights = overlayPlotWeightedGeo || overlayPlotWeightedHelio;
  const overlayHasStandard =
    overlayPlotGravForce ||
    overlayPlotGeoDeclination ||
    overlayPlotHelioDeclination;

  useEffect(() => {
    if (overlayUsesWeights) {
      setOverlayPlotGravForce(false);
      setOverlayPlotGeoDeclination(false);
      setOverlayPlotHelioDeclination(false);
    }
  }, [overlayUsesWeights]);


  const [ingressPlanets, setIngressPlanets] = useState<Set<string>>(() => new Set());
  const [combustionPlanets, setCombustionPlanets] = useState<Set<string>>(() => new Set());
  const [retroPlanets, setRetroPlanets] = useState<Set<string>>(() => new Set());
  const [velocityPlanets, setVelocityPlanets] = useState<Set<string>>(() => new Set());

  const ingressFilter = useDropdownControl();
  const combustionFilter = useDropdownControl();
  const retroFilter = useDropdownControl();
  const velocityFilter = useDropdownControl();
  const intervalDropdown = useDropdownControl();
  const periodDropdown = useDropdownControl();
  const planetDropdown = useDropdownControl();
  const harmonicDropdown = useDropdownControl();

  useEffect(() => {
    if (typeof window === "undefined") {
      setHasRestoredSessionState(true);
      return;
    }

    const raw = sessionStorage.getItem(JUPITER_TERMINAL_SESSION_KEY);
    if (!raw) {
      setHasRestoredSessionState(true);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as PersistedTerminalState;
      if (!parsed || typeof parsed !== "object") {
        return;
      }

      if (typeof parsed.symbolInput === "string") {
        setSymbolInput(parsed.symbolInput);
      }
      if (typeof parsed.activeSymbol === "string" && parsed.activeSymbol.trim()) {
        const symbol = parsed.activeSymbol.trim();
        initialSymbolRef.current = symbol;
        setActiveSymbol(symbol);
      }
      if (typeof parsed.interval === "string" && parsed.interval in INTERVAL_TO_MINUTES) {
        setInterval(parsed.interval as Interval);
      }
      if (
        typeof parsed.period === "string" &&
        (PERIOD_OPTIONS as readonly string[]).includes(parsed.period)
      ) {
        setPeriod(parsed.period as Period);
      }
      if (typeof parsed.showVolume === "boolean") {
        setShowVolume(parsed.showVolume);
      }
      if (
        Object.prototype.hasOwnProperty.call(parsed, "drawingTool") &&
        (parsed.drawingTool === "trendline" || parsed.drawingTool === null)
      ) {
        setDrawingTool(parsed.drawingTool);
      }
      if (typeof parsed.eventRangeStart === "string") {
        setEventRangeStart(parsed.eventRangeStart);
      }
      if (typeof parsed.eventRangeEnd === "string") {
        setEventRangeEnd(parsed.eventRangeEnd);
      }
      if (typeof parsed.lagnaRangeStart === "string") {
        setLagnaRangeStart(parsed.lagnaRangeStart);
      }
      if (typeof parsed.lagnaRangeEnd === "string") {
        setLagnaRangeEnd(parsed.lagnaRangeEnd);
      }
      if (typeof parsed.ingressEnabledInput === "boolean") {
        setIngressEnabledInput(parsed.ingressEnabledInput);
      }
      if (typeof parsed.combustionEnabledInput === "boolean") {
        setCombustionEnabledInput(parsed.combustionEnabledInput);
      }
      if (typeof parsed.retroEnabledInput === "boolean") {
        setRetroEnabledInput(parsed.retroEnabledInput);
      }
      if (typeof parsed.velocityEnabledInput === "boolean") {
        setVelocityEnabledInput(parsed.velocityEnabledInput);
      }
      if (typeof parsed.lagnaEnabledInput === "boolean") {
        setLagnaEnabledInput(parsed.lagnaEnabledInput);
      }
      if (typeof parsed.moonEnabledInput === "boolean") {
        setMoonEnabledInput(parsed.moonEnabledInput);
      }
      if (Array.isArray(parsed.selectedPlanets)) {
        const planets = parsed.selectedPlanets.filter(
          (item): item is string => typeof item === "string" && item.length > 0,
        );
        setSelectedPlanets(planets);
      }
      if (typeof parsed.overlayStartDate === "string") {
        setOverlayStartDate(parsed.overlayStartDate);
      }
      if (
        typeof parsed.overlayDurationUnit === "string" &&
        (DURATION_UNITS as readonly string[]).includes(parsed.overlayDurationUnit)
      ) {
        setOverlayDurationUnit(parsed.overlayDurationUnit as DurationUnit);
      }
      if (
        typeof parsed.overlayDurationValue === "number" &&
        Number.isFinite(parsed.overlayDurationValue)
      ) {
        setOverlayDurationValue(parsed.overlayDurationValue);
      }
      if (typeof parsed.overlayPlotGravForce === "boolean") {
        setOverlayPlotGravForce(parsed.overlayPlotGravForce);
      }
      if (typeof parsed.overlayPlotSpeed === "boolean") {
        setOverlayPlotSpeed(parsed.overlayPlotSpeed);
      }
      if (typeof parsed.overlayPlotGeoDeclination === "boolean") {
        setOverlayPlotGeoDeclination(parsed.overlayPlotGeoDeclination);
      }
      if (typeof parsed.overlayPlotHelioDeclination === "boolean") {
        setOverlayPlotHelioDeclination(parsed.overlayPlotHelioDeclination);
      }
      if (typeof parsed.overlayPlotWeightedGeo === "boolean") {
        setOverlayPlotWeightedGeo(parsed.overlayPlotWeightedGeo);
      }
      if (typeof parsed.overlayPlotWeightedHelio === "boolean") {
        setOverlayPlotWeightedHelio(parsed.overlayPlotWeightedHelio);
      }
      if (typeof parsed.overlayWeightsInput === "string") {
        setOverlayWeightsInput(parsed.overlayWeightsInput);
      }
      if (typeof parsed.speedZoom === "number" && Number.isFinite(parsed.speedZoom)) {
        setSpeedZoom(parsed.speedZoom);
      }
      if (typeof parsed.forceZoom === "number" && Number.isFinite(parsed.forceZoom)) {
        setForceZoom(parsed.forceZoom);
      }
      if (Array.isArray(parsed.ingressPlanets)) {
        const items = parsed.ingressPlanets.filter(
          (item): item is string => typeof item === "string" && item.length > 0,
        );
        setIngressPlanets(new Set(items));
      }
      if (Array.isArray(parsed.combustionPlanets)) {
        const items = parsed.combustionPlanets.filter(
          (item): item is string => typeof item === "string" && item.length > 0,
        );
        setCombustionPlanets(new Set(items));
      }
      if (Array.isArray(parsed.retroPlanets)) {
        const items = parsed.retroPlanets.filter(
          (item): item is string => typeof item === "string" && item.length > 0,
        );
        setRetroPlanets(new Set(items));
      }
      if (Array.isArray(parsed.velocityPlanets)) {
        const items = parsed.velocityPlanets.filter(
          (item): item is string => typeof item === "string" && item.length > 0,
        );
        setVelocityPlanets(new Set(items));
      }
      if (typeof parsed.planetaryLinesEnabled === "boolean") {
        setPlanetaryLinesEnabled(parsed.planetaryLinesEnabled);
      }
      if (
        typeof parsed.planetaryLinesPlanet === "string" &&
        parsed.planetaryLinesPlanet.length > 0
      ) {
        setPlanetaryLinesPlanet(parsed.planetaryLinesPlanet);
      }
      if (
        typeof parsed.planetaryLinesScale === "number" &&
        Number.isFinite(parsed.planetaryLinesScale)
      ) {
        setPlanetaryLinesScale(parsed.planetaryLinesScale);
      }
      if (
        typeof parsed.planetaryLinesHarmonic === "number" &&
        Number.isFinite(parsed.planetaryLinesHarmonic)
      ) {
        setPlanetaryLinesHarmonic(parsed.planetaryLinesHarmonic);
      }
      if (Array.isArray(parsed.candles)) {
        const sanitizedCandles = parsed.candles
          .filter((item): item is Candle => {
            if (!item || typeof item !== "object") return false;
            const { time, open, high, low, close } = item as Record<string, unknown>;
            const numericFields = [time, open, high, low, close].every(
              (value) => typeof value === "number" && Number.isFinite(value),
            );
            return numericFields;
          })
          .map((item) => ({
            time: Math.trunc(item.time),
            open: item.open,
            high: item.high,
            low: item.low,
            close: item.close,
            volume:
              typeof item.volume === "number" && Number.isFinite(item.volume) ? item.volume : 0,
          }));
        if (sanitizedCandles.length > 0) {
          const limitedCandles =
            sanitizedCandles.length > MAX_CANDLES_TO_STORE
              ? sanitizedCandles.slice(-MAX_CANDLES_TO_STORE)
              : sanitizedCandles;
          setCandles(limitedCandles);
        }
      }
      if (typeof parsed.dataTitle === "string" && parsed.dataTitle.trim().length > 0) {
        setDataTitle(parsed.dataTitle);
      }
      if (
        Object.prototype.hasOwnProperty.call(parsed, "lastUpdated") &&
        (typeof parsed.lastUpdated === "string" || parsed.lastUpdated === null)
      ) {
        setLastUpdated(parsed.lastUpdated);
      }
      if (
        Object.prototype.hasOwnProperty.call(parsed, "uploadName") &&
        (typeof parsed.uploadName === "string" || parsed.uploadName === null)
      ) {
        setUploadName(parsed.uploadName);
      }
      if (Array.isArray(parsed.orbitalSeries)) {
        const sanitizedSeries = parsed.orbitalSeries.filter(
          (series): series is OrbitalOverlaySeries => {
            if (!series || typeof series !== "object") return false;
            const { name, key, objects, timestamps, values } = series as Record<string, unknown>;
            const hasBasicFields =
              typeof name === "string" &&
              typeof key === "string" &&
              Array.isArray(objects) &&
              Array.isArray(timestamps) &&
              Array.isArray(values);
            return hasBasicFields;
          },
        );
        if (sanitizedSeries.length > 0) {
          setOrbitalSeries(sanitizedSeries);
        }
      }
      if (
        Object.prototype.hasOwnProperty.call(parsed, "overlayError") &&
        (typeof parsed.overlayError === "string" || parsed.overlayError === null)
      ) {
        setOverlayError(parsed.overlayError);
      }
      if (Array.isArray(parsed.planetaryLineSeriesData)) {
        const sanitizedPlanetary = parsed.planetaryLineSeriesData
          .filter(
            (series): series is PlanetaryLineSeries =>
              !!series && typeof series === "object" && Array.isArray(series.data),
          )
          .map((series) => ({
            ...series,
            data: series.data.filter(
              (point): point is { time: number; value: number } =>
                typeof point?.time === "number" &&
                Number.isFinite(point.time) &&
                typeof point?.value === "number" &&
                Number.isFinite(point.value),
            ),
          }));
        if (sanitizedPlanetary.length > 0) {
          setPlanetaryLineSeriesData(sanitizedPlanetary);
        }
      }
      if (
        Object.prototype.hasOwnProperty.call(parsed, "chartRangeStart") ||
        Object.prototype.hasOwnProperty.call(parsed, "chartRangeEnd")
      ) {
        const start =
          typeof parsed.chartRangeStart === "number" && Number.isFinite(parsed.chartRangeStart)
            ? Math.trunc(parsed.chartRangeStart)
            : null;
        const end =
          typeof parsed.chartRangeEnd === "number" && Number.isFinite(parsed.chartRangeEnd)
            ? Math.trunc(parsed.chartRangeEnd)
            : null;

        if (start != null || end != null) {
          const range = { start, end };
          chartVisibleRangeRef.current = range;
          setChartVisibleRange(range);
        } else {
          chartVisibleRangeRef.current = null;
          setChartVisibleRange(null);
        }
      }
    } catch (error) {
      console.warn("Failed to restore JupiterTerminal session state", error);
    } finally {
      setHasRestoredSessionState(true);
    }
  }, []);

  // Debounce sessionStorage writes to avoid blocking UI interactions
  useEffect(() => {
    if (!hasRestoredSessionState || typeof window === "undefined") {
      return;
    }

    // Debounce the save operation and use requestIdleCallback to prevent blocking UI
    const timeoutId = setTimeout(() => {
      // Use requestIdleCallback to run during idle time, never blocking user interactions
      const idleCallback = () => {
        const candleSnapshot =
          candles.length > 0
            ? candles.slice(
                candles.length > MAX_CANDLES_TO_STORE ? candles.length - MAX_CANDLES_TO_STORE : 0,
              )
            : undefined;
        const planetarySnapshot =
          planetaryLineSeriesData.length > 0 ? planetaryLineSeriesData : undefined;
        const overlayErrorSnapshot = overlayError ?? null;

        const payload: PersistedTerminalState = {
          symbolInput,
          activeSymbol,
          interval,
          period,
          showVolume,
          drawingTool,
          eventRangeStart,
          eventRangeEnd,
          lagnaRangeStart,
          lagnaRangeEnd,
          ingressEnabledInput,
          combustionEnabledInput,
          retroEnabledInput,
          velocityEnabledInput,
          lagnaEnabledInput,
          moonEnabledInput,
          selectedPlanets,
          overlayStartDate,
          overlayDurationUnit,
          overlayDurationValue,
          overlayPlotGravForce,
          overlayPlotSpeed,
          overlayPlotGeoDeclination,
          overlayPlotHelioDeclination,
          overlayPlotWeightedGeo,
          overlayPlotWeightedHelio,
          overlayWeightsInput,
          speedZoom,
          forceZoom,
          ingressPlanets: Array.from(ingressPlanets),
          combustionPlanets: Array.from(combustionPlanets),
          retroPlanets: Array.from(retroPlanets),
          velocityPlanets: Array.from(velocityPlanets),
          planetaryLinesEnabled,
          planetaryLinesPlanet,
          planetaryLinesScale,
          planetaryLinesHarmonic,
          chartRangeStart:
            chartVisibleRange && chartVisibleRange.start != null
              ? Math.trunc(chartVisibleRange.start)
              : null,
          chartRangeEnd:
            chartVisibleRange && chartVisibleRange.end != null
              ? Math.trunc(chartVisibleRange.end)
              : null,
          overlayError: overlayErrorSnapshot,
        };

        if (candleSnapshot && candleSnapshot.length > 0) {
          payload.candles = candleSnapshot;
        }
        if (dataTitle.trim().length > 0) {
          payload.dataTitle = dataTitle;
        }
        if (typeof lastUpdated === "string" || lastUpdated === null) {
          payload.lastUpdated = lastUpdated ?? null;
        }
        if (typeof uploadName === "string" || uploadName === null) {
          payload.uploadName = uploadName ?? null;
        }
        if (orbitalSeries.length > 0) {
          payload.orbitalSeries = orbitalSeries;
        }
        if (planetarySnapshot && planetarySnapshot.length > 0) {
          payload.planetaryLineSeriesData = planetarySnapshot;
        }

        try {
          sessionStorage.setItem(
            JUPITER_TERMINAL_SESSION_KEY,
            JSON.stringify(payload),
          );
        } catch (error) {
          console.warn("Failed to persist JupiterTerminal session state", error);
        }
      };

      // Use requestIdleCallback if available, otherwise fallback to setTimeout
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(idleCallback, { timeout: 2000 });
      } else {
        setTimeout(idleCallback, 0);
      }
    }, 500); // Reduced to 500ms debounce since we also use requestIdleCallback

    return () => clearTimeout(timeoutId);
  }, [
    activeSymbol,
    combustionEnabledInput,
    combustionPlanets,
    drawingTool,
    eventRangeEnd,
    eventRangeStart,
    forceZoom,
    hasRestoredSessionState,
    ingressEnabledInput,
    ingressPlanets,
    interval,
    lagnaEnabledInput,
    lagnaRangeEnd,
    lagnaRangeStart,
    moonEnabledInput,
    overlayDurationUnit,
    overlayDurationValue,
    overlayPlotGeoDeclination,
    overlayPlotGravForce,
    overlayPlotHelioDeclination,
    overlayPlotSpeed,
    overlayPlotWeightedGeo,
    overlayPlotWeightedHelio,
    overlayStartDate,
    overlayWeightsInput,
    orbitalSeries,
    chartVisibleRange,
    period,
    planetaryLinesEnabled,
    planetaryLinesHarmonic,
    planetaryLinesPlanet,
    planetaryLinesScale,
    retroEnabledInput,
    retroPlanets,
    selectedPlanets,
    showVolume,
    speedZoom,
    symbolInput,
    candles,
    dataTitle,
    lastUpdated,
    overlayError,
    planetaryLineSeriesData,
    uploadName,
    velocityEnabledInput,
    velocityPlanets,
  ]);

  const ingressOptions = useMemo(
    () => Array.from(new Set(ingressEvents.map((event) => event.body))).sort(),
    [ingressEvents],
  );
  const combustionOptions = useMemo(
    () => Array.from(new Set(combustionEvents.map((event) => event.planet))).sort(),
    [combustionEvents],
  );
  const retroOptions = useMemo(
    () => Array.from(new Set(retroEvents.map((event) => event.planet))).sort(),
    [retroEvents],
  );
  const velocityOptions = useMemo(
    () => Array.from(new Set(velocityEvents.map((event) => event.planet))).sort(),
    [velocityEvents],
  );

  const toggleSelection = useCallback(
    (value: string, setter: Dispatch<SetStateAction<Set<string>>>, limit?: number) => {
      startTransition(() => {
        setter((prev) => {
          if (value === "__all__") {
            return new Set();
          }
          const next = new Set(prev);
          if (next.has(value)) {
            next.delete(value);
          } else {
            next.add(value);
          }
          if (typeof limit === "number" && limit > 0 && next.size >= limit) {
            return new Set();
          }
          return next;
        });
      });
    },
    [startTransition],
  );

  const describeSelection = useCallback((selected: Set<string>, options: string[]): string => {
    if (selected.size === 0 || selected.size === options.length) return "All";
    if (selected.size === 1) {
      const value = Array.from(selected)[0]!;
      return isAdmin ? value : formatPlanetCode(value);
    }
    return `${selected.size} selected`;
  }, [isPlus]);

  const eventRange = useMemo(() => {
    let start = toUtcSecondsFromInput(eventRangeStart, tz);
    let end = toUtcSecondsFromInput(eventRangeEnd, tz);
    if (start != null && end != null && start > end) {
      [start, end] = [end, start];
    }
    return { start, end };
  }, [eventRangeEnd, eventRangeStart, tz]);

  const lagnaRange = useMemo(() => {
    let start = toUtcSecondsFromInput(lagnaRangeStart, tz);
    let end = toUtcSecondsFromInput(lagnaRangeEnd, tz);
    if (start != null && end != null && start > end) {
      [start, end] = [end, start];
    }
    return { start, end };
  }, [lagnaRangeEnd, lagnaRangeStart, tz]);

  const clearChartVisibleRange = useCallback(() => {
    chartVisibleRangeRef.current = null;
    setChartVisibleRange((prev) => (prev === null ? prev : null));
    visibleRangeAppliedRef.current = false;
  }, []);

  const commitVisibleRangeUpdate = useCallback(() => {
    if (!pendingVisibleRangeRef.current) return;
    const nextRange = pendingVisibleRangeRef.current;
    pendingVisibleRangeRef.current = null;
    startTransition(() => {
      setChartVisibleRange(nextRange);
    });
  }, [startTransition]);

  useEffect(() => {
    return () => {
      if (visibleRangeTimeoutRef.current != null) {
        window.clearTimeout(visibleRangeTimeoutRef.current);
        visibleRangeTimeoutRef.current = null;
      }
      pendingVisibleRangeRef.current = null;
    };
  }, []);

  const handleVisibleRangeChange = useCallback(
    (range: { start: number | null; end: number | null }) => {
      if (!hasRestoredSessionState || !visibleRangeAppliedRef.current) {
        return;
      }
      let start =
        typeof range.start === "number" && Number.isFinite(range.start) ? Math.trunc(range.start) : null;
      let end =
        typeof range.end === "number" && Number.isFinite(range.end) ? Math.trunc(range.end) : null;

      if (start != null && end != null && start > end) {
        [start, end] = [end, start];
      }

      const previous = chartVisibleRangeRef.current;
      if (previous && previous.start === start && previous.end === end) {
        return;
      }

      const nextRange = start == null && end == null ? null : { start, end };
      chartVisibleRangeRef.current = nextRange;
      pendingVisibleRangeRef.current = nextRange;

      if (typeof window !== "undefined") {
        if (visibleRangeTimeoutRef.current != null) {
          window.clearTimeout(visibleRangeTimeoutRef.current);
        }
        visibleRangeTimeoutRef.current = window.setTimeout(() => {
          visibleRangeTimeoutRef.current = null;
          commitVisibleRangeUpdate();
        }, 120);
      } else {
        commitVisibleRangeUpdate();
      }
    },
    [commitVisibleRangeUpdate, hasRestoredSessionState],
  );

  const handleChartReady = useCallback(() => {
    visibleRangeAppliedRef.current = false;
    setChartReadyTick((value) => value + 1);
  }, []);

  const includePlanet = useCallback(
    (planet: string, selected: Set<string>) =>
      selected.size === 0 || selected.has(planet),
    [],
  );

  const isWithinRange = useCallback(
    (time: number | null, range: { start: number | null; end: number | null }) => {
      if (time == null) return false;
      if (range.start != null && time < range.start) return false;
      if (range.end != null && time > range.end) return false;
      return true;
    },
    [],
  );

  const nearestCandle = useCallback(
    (timestamp: number | null): Candle | null => {
      if (timestamp == null || candles.length === 0) return null;
      const first = candles[0];
      if (!first) return null;
      let minTime = first.time;
      let maxTime = first.time;
      let best = first;
      let minDiff = Math.abs(first.time - timestamp);
      for (let i = 1; i < candles.length; i += 1) {
        const candidate = candles[i];
        if (!candidate) continue;
        if (candidate.time < minTime) minTime = candidate.time;
        if (candidate.time > maxTime) maxTime = candidate.time;
        const diff = Math.abs(candidate.time - timestamp);
        if (diff < minDiff) {
          best = candidate;
          minDiff = diff;
          if (diff === 0) {
            return candidate;
          }
        }
      }
      // FIX: Don't return null for events outside the candle range.
      // Instead, return the nearest candle (either first or last).
      // This allows events outside the range to still be plotted.
      return best ?? null;
    },
    [candles],
  );

  // NEW: Date-based candle matching for daily/weekly intervals
  // This matches events to candles by DATE rather than exact timestamp
  // Also handles weekends by snapping to nearest trading day
  const nearestCandleByDate = useCallback(
    (timestamp: number | null, timezone: string): Candle | null => {
      if (timestamp == null || candles.length === 0) return null;

      // For intraday intervals (< 1 day), use time-based matching
      const intervalMinutes = INTERVAL_TO_MINUTES[interval] ?? 1440;
      if (intervalMinutes < 1440) {
        return nearestCandle(timestamp);
      }

      // For daily/weekly intervals, match by DATE in the local timezone
      let eventDt = DateTime.fromSeconds(timestamp, { zone: timezone });
      const originalDate = eventDt.toFormat("yyyy-MM-dd");
      const dayOfWeek = eventDt.weekday; // 1=Monday, 7=Sunday

      // Handle weekends: snap to Friday for Saturday/Sunday events
      let adjustedForWeekend = false;
      if (dayOfWeek === 6) {
        // Saturday → Friday
        eventDt = eventDt.minus({ days: 1 });
        adjustedForWeekend = true;
      } else if (dayOfWeek === 7) {
        // Sunday → Friday
        eventDt = eventDt.minus({ days: 2 });
        adjustedForWeekend = true;
      }

      const eventDate = eventDt.toFormat("yyyy-MM-dd");

      if (adjustedForWeekend) {
        console.debug(
          `📅 Weekend event adjusted: ${originalDate} (${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][dayOfWeek-1]}) → ${eventDate} (Fri)`
        );
      }

      // Find candle that matches the event's DATE (after weekend adjustment)
      // FIX: Check if event is AFTER the last candle (future event)
      let bestCandle: Candle | null = null;
      let minDaysDiff = Infinity;

      // Get the last candle date to determine if event is in the future
      const lastCandle = candles[candles.length - 1];
      const lastCandleDt = lastCandle ? DateTime.fromSeconds(lastCandle.time, { zone: "UTC" }) : null;
      const lastCandleDate = lastCandleDt ? lastCandleDt.toFormat("yyyy-MM-dd") : null;

      // Check if event is AFTER the last candle (future event)
      if (lastCandleDate) {
        const eventDayStart = DateTime.fromFormat(eventDate, "yyyy-MM-dd", { zone: timezone }).startOf("day");
        const lastCandleDayStart = DateTime.fromFormat(lastCandleDate, "yyyy-MM-dd", { zone: "UTC" }).startOf("day");
        const daysFromLast = eventDayStart.diff(lastCandleDayStart, "days").days;

        // If event is AFTER the last candle (positive days), it's a future event
        if (daysFromLast > 0) {
          console.debug(
            `📅 Future event detected: ${eventDate} is ${Math.floor(daysFromLast)} days after last candle (${lastCandleDate}). Will plot at actual date.`
          );
          return null; // Use event's own timestamp, don't snap to any candle
        }
      }

      // Event is within or before the chart range - find matching candle
      for (const candle of candles) {
        const candleDt = DateTime.fromSeconds(candle.time, { zone: "UTC" });
        const candleDate = candleDt.toFormat("yyyy-MM-dd");

        // Calculate day difference
        const eventDayStart = DateTime.fromFormat(eventDate, "yyyy-MM-dd", { zone: timezone }).startOf("day");
        const candleDayStart = DateTime.fromFormat(candleDate, "yyyy-MM-dd", { zone: "UTC" }).startOf("day");
        const daysDiff = Math.abs(eventDayStart.diff(candleDayStart, "days").days);

        if (daysDiff < minDaysDiff) {
          minDaysDiff = daysDiff;
          bestCandle = candle;

          // Perfect match - same date
          if (daysDiff === 0) {
            return candle;
          }
        }
      }

      return bestCandle;
    },
    [candles, interval, nearestCandle],
  );

  const intervalMinutes = INTERVAL_TO_MINUTES[interval] ?? 1440;
  const allowShortInterval = intervalMinutes <= 20;

  useEffect(() => {
    if (!allowShortInterval) {
      setLagnaEnabledInput(false);
      setMoonEnabledInput(false);
    }
  }, [allowShortInterval]);

  useEffect(() => {
    if (!overlayPlotGravForce) {
      setForceZoom(1);
    }
  }, [overlayPlotGravForce]);

  const eventRangeState = useMemo(() => ({ start: eventRange.start, end: eventRange.end }), [eventRange]);
  const lagnaRangeState = useMemo(() => ({ start: lagnaRange.start, end: lagnaRange.end }), [lagnaRange]);

  const preferredVisibleRange = useMemo(
    () => chartVisibleRange ?? eventRangeState,
    [chartVisibleRange, eventRangeState],
  );

  useEffect(() => {
    if (!hasRestoredSessionState) return;
    visibleRangeAppliedRef.current = false;
    const handle = chartHandleRef.current;
    if (!handle) return;
    handle.setVisibleRange(preferredVisibleRange);
    visibleRangeAppliedRef.current = true;
  }, [candles, preferredVisibleRange, hasRestoredSessionState, chartReadyTick]);

  useEffect(() => {
    onRangeChange?.(eventRangeState);
  }, [eventRangeState, onRangeChange]);

  const renderPlanetFilter = (
    label: string,
    options: string[],
    selected: Set<string>,
    control: ReturnType<typeof useDropdownControl>,
    setter: Dispatch<SetStateAction<Set<string>>>,
  ): ReactNode => {
    if (!options.length) return null;
    const summary = describeSelection(selected, options);
    const isAll = selected.size === 0;
    return (
      <div ref={control.ref} className="relative">
        <button
          type="button"
          onClick={() => control.setOpen((open) => !open)}
          className="flex w-full items-center justify-between rounded-none border border-transparent bg-black px-3 py-1.5 text-xs text-zinc-200 hover:border-zinc-700/70"
        >
          <span className="uppercase tracking-[0.3em] text-zinc-500">{label}</span>
          <span className="text-zinc-300">{summary}</span>
        </button>
        {control.open && (
          <div className="absolute z-30 mt-1 w-full max-h-60 overflow-y-auto border border-zinc-800/40 bg-black shadow-xl">
            <button
              type="button"
              onClick={() => toggleSelection("__all__", setter, options.length)}
              className={cls(
                "w-full px-3 py-1.5 text-left text-xs transition-colors",
                isAll ? "bg-green-900/30 text-green-300" : "text-zinc-200 hover:bg-zinc-900",
              )}
            >
              All
            </button>
            {options.map((option) => {
              const active = selected.has(option);
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => toggleSelection(option, setter, options.length)}
                  className={cls(
                    "w-full px-3 py-1.5 text-left text-xs transition-colors",
                    active ? "bg-green-900/30 text-green-300" : "text-zinc-200 hover:bg-zinc-900",
                  )}
                >
                  {isAdmin ? option : formatPlanetCode(option)}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const ingressMarkers = useMemo<SeriesMarker<Time>[]>(() => {
    if (!ingressEnabled) return [];
    const markers: SeriesMarker<Time>[] = [];
    ingressEvents.forEach((event) => {
      if (!hasSignChange(event)) return;
      if (!includePlanet(event.body, ingressPlanets)) return;
      const eventTime = toUtcSecondsFromEvent(event.timeISO, tz);
      if (eventTime == null) return;
      if (!isWithinRange(eventTime, eventRangeState)) return;
      const candle = nearestCandle(eventTime);
      const snapped = candle?.time ?? null;
      if (snapped == null) return;
      markers.push({
        time: snapped as Time,
        position: "aboveBar",
        color: "#f97316",
        shape: "square",
        price: (candle?.high ?? candle?.close) ?? undefined,
        text: isAdmin ? `Ingress ${event.body}` : `${EVENT_CODES.ingress} ${formatPlanetCode(event.body)}`,
        size: 2,
      });
    });
    return markers;
  }, [eventRangeState, includePlanet, ingressEnabled, ingressEvents, ingressPlanets, isPlus, isWithinRange, nearestCandle, tz]);

  const combustionMarkers = useMemo<SeriesMarker<Time>[]>(() => {
    if (!combustionEnabled) return [];
    const markers: SeriesMarker<Time>[] = [];
    combustionEvents.forEach((event) => {
      if (!includePlanet(event.planet, combustionPlanets)) return;
      const startRaw = toUtcSecondsFromEvent(event.startISO, tz);
      if (startRaw != null && isWithinRange(startRaw, eventRangeState)) {
        const startCandle = nearestCandle(startRaw);
        const startTime = startCandle?.time ?? null;
        if (startTime != null) {
          markers.push({
            time: startTime as Time,
            position: "aboveBar",
            color: "#ef4444",
            shape: "arrowUp",
            price: (startCandle?.high ?? startCandle?.close) ?? undefined,
          text: isAdmin ? `Combustion ${event.planet}↑` : `${EVENT_CODES.combustion} ${formatPlanetCode(event.planet)}↑`,
            size: 2,
          });
        }
      }
      const endRaw = event.endISO ? toUtcSecondsFromEvent(event.endISO, tz) : null;
      if (endRaw != null && isWithinRange(endRaw, eventRangeState)) {
        const endCandle = nearestCandle(endRaw);
        const endTime = endCandle?.time ?? null;
        if (endTime != null) {
          markers.push({
            time: endTime as Time,
            position: "belowBar",
            color: "#ef4444",
            shape: "arrowDown",
            price: (endCandle?.low ?? endCandle?.close) ?? undefined,
          text: isAdmin ? `Combustion ${event.planet}↓` : `${EVENT_CODES.combustion} ${formatPlanetCode(event.planet)}↓`,
            size: 2,
          });
        }
      }
    });
    return markers;
  }, [combustionEnabled, combustionEvents, combustionPlanets, eventRangeState, includePlanet, isPlus, isWithinRange, nearestCandle, tz]);

  const retroMarkers = useMemo<SeriesMarker<Time>[]>(() => {
    if (!retroEnabled) return [];
    const markers: SeriesMarker<Time>[] = [];
    retroEvents.forEach((event) => {
      if (!includePlanet(event.planet, retroPlanets)) return;
      const startRaw = toUtcSecondsFromEvent(event.startISO, tz);
      if (startRaw != null && isWithinRange(startRaw, eventRangeState)) {
        const startCandle = nearestCandle(startRaw);
        const startTime = startCandle?.time ?? null;
        if (startTime != null) {
          markers.push({
            time: startTime as Time,
            position: "aboveBar",
            color: "#22d3ee",
            shape: "arrowUp",
            price: (startCandle?.high ?? startCandle?.close) ?? undefined,
          text: isAdmin ? `Retro ${event.planet}↑` : `${EVENT_CODES.retro} ${formatPlanetCode(event.planet)}↑`,
            size: 2,
          });
        }
      }
      const endRaw = event.endISO ? toUtcSecondsFromEvent(event.endISO, tz) : null;
      if (endRaw != null && isWithinRange(endRaw, eventRangeState)) {
        const endCandle = nearestCandle(endRaw);
        const endTime = endCandle?.time ?? null;
        if (endTime != null) {
          markers.push({
            time: endTime as Time,
            position: "belowBar",
            color: "#22d3ee",
            shape: "arrowDown",
            price: (endCandle?.low ?? endCandle?.close) ?? undefined,
          text: isAdmin ? `Retro ${event.planet}↓` : `${EVENT_CODES.retro} ${formatPlanetCode(event.planet)}↓`,
            size: 2,
          });
        }
      }
    });
    return markers;
  }, [eventRangeState, includePlanet, isPlus, isWithinRange, nearestCandle, retroEnabled, retroEvents, retroPlanets, tz]);

  const velocityMarkers = useMemo<SeriesMarker<Time>[]>(() => {
    if (!velocityEnabled) return [];
    const markers: SeriesMarker<Time>[] = [];
    velocityEvents.forEach((event) => {
      if (!includePlanet(event.planet, velocityPlanets)) return;
      const eventTime = toUtcSecondsFromEvent(event.timeISO, tz);
      if (eventTime == null) return;
      if (!isWithinRange(eventTime, eventRangeState)) return;
      const candle = nearestCandle(eventTime);
      const snapped = candle?.time ?? null;
      if (snapped == null) return;
      const isMax = event.kind === "max";
      markers.push({
        time: snapped as Time,
        position: isMax ? "aboveBar" : "belowBar",
        color: "#a855f7",
        shape: "circle",
        price: isMax
          ? (candle?.high ?? candle?.close) ?? undefined
          : (candle?.low ?? candle?.close) ?? undefined,
        text: isAdmin ? `Velocity ${event.planet}${isMax ? "↑" : "↓"}` : `${EVENT_CODES.velocity} ${formatPlanetCode(event.planet)}${isMax ? "↑" : "↓"}`,
        size: 2,
      });
    });
    return markers;
  }, [eventRangeState, includePlanet, isPlus, isWithinRange, nearestCandle, velocityEnabled, velocityEvents, velocityPlanets, tz]);

  const lagnaMarkers = useMemo<SeriesMarker<Time>[]>(() => {
    if (!lagnaEnabled || !allowShortInterval) return [];
    const markers: SeriesMarker<Time>[] = [];
    lagnaEvents.forEach((event) => {
      const eventTime = toUtcSecondsFromEvent(event.timeISO, tz);
      if (eventTime == null) return;
      if (!isWithinRange(eventTime, lagnaRangeState)) return;
      const candle = nearestCandle(eventTime);
      const snapped = candle?.time ?? null;
      if (snapped == null) return;
      markers.push({
        time: snapped as Time,
        position: event.degree === 15 ? "belowBar" : "aboveBar",
        color: "#facc15",
        shape: "square",
        price:
          event.degree === 15
            ? (candle?.low ?? candle?.close) ?? undefined
            : (candle?.high ?? candle?.close) ?? undefined,
        text: isAdmin ? "Lagna" : EVENT_CODES.lagna,
        size: 2,
      });
    });
    return markers;
  }, [allowShortInterval, isPlus, isWithinRange, lagnaEnabled, lagnaEvents, lagnaRangeState, nearestCandle, tz]);

  const moonMarkers = useMemo<SeriesMarker<Time>[]>(() => {
    if (!moonEnabled || !allowShortInterval) return [];
    const markers: SeriesMarker<Time>[] = [];
    moonEvents.forEach((event) => {
      const eventTime = toUtcSecondsFromEvent(event.timeISO, tz);
      if (eventTime == null) return;
      if (!isWithinRange(eventTime, lagnaRangeState)) return;
      const candle = nearestCandle(eventTime);
      const snapped = candle?.time ?? null;
      if (snapped == null) return;
      markers.push({
        time: snapped as Time,
        position: "aboveBar",
        color: "#38bdf8",
        shape: "circle",
        price: (candle?.high ?? candle?.close) ?? undefined,
        text: isAdmin ? `Moon P${event.pada}` : `${EVENT_CODES.moon} P${event.pada}`,
        size: 2,
      });
    });
    return markers;
  }, [allowShortInterval, isPlus, isWithinRange, lagnaRangeState, moonEnabled, moonEvents, nearestCandle, tz]);

  const markers = useMemo<SeriesMarker<Time>[]>(() => {
    return [
      ...ingressMarkers,
      ...combustionMarkers,
      ...retroMarkers,
      ...velocityMarkers,
      ...lagnaMarkers,
      ...moonMarkers,
    ];
  }, [
    combustionMarkers,
    ingressMarkers,
    lagnaMarkers,
    moonMarkers,
    retroMarkers,
    velocityMarkers,
  ]);

  useEffect(() => {
    if (markers.length) {
      console.debug("Event markers prepared", markers.length, markers.slice(0, 5));
    } else {
      console.debug("No event markers prepared for current filters");
    }
  }, [markers]);

  const latestCandle = useMemo(() => {
    if (hoverCandle) return hoverCandle;
    return candles.length ? candles[candles.length - 1] : null;
  }, [candles, hoverCandle]);


  const overlayLabel = useCallback(
    (series: OrbitalOverlaySeries) => {
      if (isPlus) return series.name;
      if (series.key === "weighted_geo_declination") return "W-GD";
      if (series.key === "weighted_helio_declination") return "W-HD";
      const primarySlug = series.objects[0];
      const code =
        planetCodeFromSlug(primarySlug) ||
        (primarySlug ? primarySlug.slice(0, 2).toUpperCase() : "OV");
      if (series.key.endsWith("_speed")) return `${code} SPD`;
      if (series.key.endsWith("_force")) return `${code} F`;
      if (series.key.endsWith("_geo_dec")) return `${code} GD`;
      if (series.key.endsWith("_helio_dec")) return `${code} HD`;
      return code;
    },
    [isPlus],
  );

  const candlesMemo = useMemo(() => candles, [candles]);

  const overlayDatasetsMemo = useMemo<IndicatorDataset[]>(() => {
    const datasets: IndicatorDataset[] = [];
    orbitalSeries.forEach((series, index) => {
      const color = ORBITAL_COLORS[index % ORBITAL_COLORS.length];
      const key = series.key ?? "";
      let valueKind: "declination" | "speed" | "force" = "declination";
      if (key.includes("_speed")) {
        valueKind = "speed";
      } else if (key.includes("_force")) {
        valueKind = "force";
      } else if (
        key.includes("_geo_dec") ||
        key.includes("_helio_dec") ||
        key.includes("weighted_geo") ||
        key.includes("weighted_helio")
      ) {
        valueKind = "declination";
      }
      const isDeclination = valueKind === "declination";
      const rawPoints: { time: UTCTimestamp; value: number }[] = [];
      for (let i = 0; i < series.timestamps.length; i += 1) {
        const rawTime = series.timestamps[i];
        const rawValue = series.values[i];
        if (rawTime == null || rawValue == null) continue;
        const dt = DateTime.fromISO(rawTime, { zone: "utc" });
        if (!dt.isValid) continue;
        const value = Number(rawValue);
        if (!Number.isFinite(value)) continue;
        const time = Math.floor(dt.toSeconds());
        rawPoints.push({
          time: time as UTCTimestamp,
          value,
        });
      }
      if (!rawPoints.length) return;

      // Keep the actual declination values, don't normalize
      const points: LineData[] = rawPoints.map((point) => ({
        time: point.time,
        value: point.value, // Keep original declination degree values
      }));

      datasets.push({
        name: overlayLabel(series),
        type: "line",
        pane: "orbital",
        priceScaleId: isDeclination ? `orbital-decl-${index}` : `orbital-${valueKind}`,
        data: points,
        color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        useDeclinationScale: isDeclination,
        valueKind,
      });
    });
    return datasets;
  }, [orbitalSeries, overlayLabel]);

  const ingressEventLines = useMemo<OverlayEventLine[]>(() => {
    if (!ingressEnabled) return [];
    const result: OverlayEventLine[] = [];
    ingressEvents.forEach((event) => {
      if (!hasSignChange(event)) return;
      if (!includePlanet(event.body, ingressPlanets)) return;
      const eventTime = toUtcSecondsFromEvent(event.timeISO, tz);
      if (eventTime == null) return;
      if (!isWithinRange(eventTime, eventRangeState)) return;
      const matchedCandle = nearestCandleByDate(eventTime, tz);
      const snapped = matchedCandle?.time ?? eventTime;
      const eventDt = DateTime.fromSeconds(eventTime, { zone: tz });
      const dateLabel = eventDt.toFormat("MMM dd");
      const timeLabel = eventDt.toFormat("HH:mm");
      const fullLabel = isPlus
        ? `${event.body} • ${dateLabel} ${timeLabel}`
        : `${formatPlanetCode(event.body)} • ${dateLabel} ${timeLabel}`;
      result.push({ time: snapped, color: "#f97316", label: fullLabel });
    });
    return result;
  }, [
    ingressEnabled,
    ingressEvents,
    ingressPlanets,
    includePlanet,
    eventRangeState,
    isWithinRange,
    nearestCandleByDate,
    tz,
    isPlus,
  ]);

  const combustionEventLines = useMemo<OverlayEventLine[]>(() => {
    if (!combustionEnabled) return [];
    const result: OverlayEventLine[] = [];
    combustionEvents.forEach((event) => {
      if (!includePlanet(event.planet, combustionPlanets)) return;
      const startRaw = toUtcSecondsFromEvent(event.startISO, tz);
      if (startRaw != null && isWithinRange(startRaw, eventRangeState)) {
        const snapped = nearestCandleByDate(startRaw, tz)?.time ?? startRaw;
        const eventDt = DateTime.fromSeconds(startRaw, { zone: tz });
      const label = isPlus
        ? `Combustion ${event.planet} Start • ${eventDt.toFormat("MMM dd HH:mm")}`
        : `${EVENT_CODES.combustion} ${formatPlanetCode(event.planet)}↑ • ${eventDt.toFormat("MMM dd HH:mm")}`;
        result.push({ time: snapped, color: "#ef4444", label });
      }
      const endRaw = event.endISO ? toUtcSecondsFromEvent(event.endISO, tz) : null;
      if (endRaw != null && isWithinRange(endRaw, eventRangeState)) {
        const snapped = nearestCandleByDate(endRaw, tz)?.time ?? endRaw;
        const eventDt = DateTime.fromSeconds(endRaw, { zone: tz });
        const label = isPlus
          ? `Combustion ${event.planet} End • ${eventDt.toFormat("MMM dd HH:mm")}`
          : `${EVENT_CODES.combustion} ${formatPlanetCode(event.planet)}↓ • ${eventDt.toFormat("MMM dd HH:mm")}`;
        result.push({ time: snapped, color: "#ef4444", label });
      }
    });
    return result;
  }, [
    combustionEnabled,
    combustionEvents,
    combustionPlanets,
    includePlanet,
    eventRangeState,
    isWithinRange,
    nearestCandleByDate,
    tz,
    isPlus,
  ]);

  const retroEventLines = useMemo<OverlayEventLine[]>(() => {
    if (!retroEnabled) return [];
    const result: OverlayEventLine[] = [];
    retroEvents.forEach((event) => {
      if (!includePlanet(event.planet, retroPlanets)) return;
      const startRaw = toUtcSecondsFromEvent(event.startISO, tz);
      if (startRaw != null && isWithinRange(startRaw, eventRangeState)) {
        const snapped = nearestCandleByDate(startRaw, tz)?.time ?? startRaw;
        const eventDt = DateTime.fromSeconds(startRaw, { zone: tz });
      const label = isPlus
        ? `Retro ${event.planet} Start • ${eventDt.toFormat("MMM dd HH:mm")}`
        : `${EVENT_CODES.retro} ${formatPlanetCode(event.planet)}↑ • ${eventDt.toFormat("MMM dd HH:mm")}`;
        result.push({ time: snapped, color: "#22d3ee", label });
      }
      const endRaw = event.endISO ? toUtcSecondsFromEvent(event.endISO, tz) : null;
      if (endRaw != null && isWithinRange(endRaw, eventRangeState)) {
        const snapped = nearestCandleByDate(endRaw, tz)?.time ?? endRaw;
        const eventDt = DateTime.fromSeconds(endRaw, { zone: tz });
        const label = isPlus
          ? `Retro ${event.planet} End • ${eventDt.toFormat("MMM dd HH:mm")}`
          : `${EVENT_CODES.retro} ${formatPlanetCode(event.planet)}↓ • ${eventDt.toFormat("MMM dd HH:mm")}`;
        result.push({ time: snapped, color: "#22d3ee", label });
      }
    });
    return result;
  }, [
    retroEnabled,
    retroEvents,
    retroPlanets,
    includePlanet,
    eventRangeState,
    isWithinRange,
    nearestCandleByDate,
    tz,
    isPlus,
  ]);

  const velocityEventLines = useMemo<OverlayEventLine[]>(() => {
    if (!velocityEnabled) return [];
    const result: OverlayEventLine[] = [];
    velocityEvents.forEach((event) => {
      if (!includePlanet(event.planet, velocityPlanets)) return;
      const eventTime = toUtcSecondsFromEvent(event.timeISO, tz);
      if (eventTime == null) return;
      if (!isWithinRange(eventTime, eventRangeState)) return;
      const snapped = nearestCandleByDate(eventTime, tz)?.time ?? eventTime;
      const eventDt = DateTime.fromSeconds(eventTime, { zone: tz });
      const suffix = event.kind === "max" ? "Max" : "Min";
      const label = isPlus
        ? `Velocity ${event.planet} ${suffix} • ${eventDt.toFormat("MMM dd HH:mm")}`
        : `${EVENT_CODES.velocity} ${formatPlanetCode(event.planet)} ${suffix} • ${eventDt.toFormat("MMM dd HH:mm")}`;
      result.push({ time: snapped, color: "#a855f7", label });
    });
    return result;
  }, [
    velocityEnabled,
    velocityEvents,
    velocityPlanets,
    includePlanet,
    eventRangeState,
    isWithinRange,
    nearestCandleByDate,
    tz,
    isPlus,
  ]);

  const lagnaEventLines = useMemo<OverlayEventLine[]>(() => {
    if (!allowShortInterval || !lagnaEnabled) return [];
    const result: OverlayEventLine[] = [];
    lagnaEvents.forEach((event) => {
      const eventTime = toUtcSecondsFromEvent(event.timeISO, tz);
      if (eventTime == null) return;
      if (!isWithinRange(eventTime, lagnaRangeState)) return;
      const snapped = nearestCandle(eventTime)?.time ?? eventTime;
      const suffix = event.degree === 15 ? " 15°" : "";
      const label = isAdmin ? `Lagna${suffix}` : `${EVENT_CODES.lagna}${suffix}`;
      result.push({ time: snapped, color: "#facc15", label });
    });
    return result;
  }, [
    allowShortInterval,
    lagnaEnabled,
    lagnaEvents,
    lagnaRangeState,
    nearestCandle,
    isAdmin,
    isWithinRange,
    tz,
  ]);

  const moonEventLines = useMemo<OverlayEventLine[]>(() => {
    if (!allowShortInterval || !moonEnabled) return [];
    const result: OverlayEventLine[] = [];
    moonEvents.forEach((event) => {
      const eventTime = toUtcSecondsFromEvent(event.timeISO, tz);
      if (eventTime == null) return;
      if (!isWithinRange(eventTime, lagnaRangeState)) return;
      const snapped = nearestCandle(eventTime)?.time ?? eventTime;
      const label = isAdmin ? `Moon P${event.pada}` : `${EVENT_CODES.moon} P${event.pada}`;
      result.push({ time: snapped, color: "#38bdf8", label });
    });
    return result;
  }, [
    allowShortInterval,
    moonEnabled,
    moonEvents,
    lagnaRangeState,
    nearestCandle,
    isAdmin,
    isWithinRange,
    tz,
  ]);

  const overlayEventLinesMemo = useMemo<OverlayEventLine[]>(() => {
    const cacheKey = JSON.stringify({
      ingressEnabled,
      combustionEnabled,
      retroEnabled,
      velocityEnabled,
      lagnaEnabled,
      moonEnabled,
      ingressEventsKey,
      combustionEventsKey,
      retroEventsKey,
      velocityEventsKey,
      lagnaEventsKey,
      moonEventsKey,
      eventRange: eventRange,
      lagnaRange,
      candlesKey,
      ingressCount: ingressEventLines.length,
      combustionCount: combustionEventLines.length,
      retroCount: retroEventLines.length,
      velocityCount: velocityEventLines.length,
      lagnaCount: lagnaEventLines.length,
      moonCount: moonEventLines.length,
    });
    const cache = eventLinesCacheRef.current;
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey)!;
    }
    const combined = [
      ...ingressEventLines,
      ...combustionEventLines,
      ...retroEventLines,
      ...velocityEventLines,
      ...lagnaEventLines,
      ...moonEventLines,
    ];
    const grouped = groupEventLines(combined);
    cache.set(cacheKey, grouped);
    return grouped;
  }, [
    ingressEnabled,
    combustionEnabled,
    retroEnabled,
    velocityEnabled,
    lagnaEnabled,
    moonEnabled,
    ingressEventLines,
    combustionEventLines,
    retroEventLines,
    velocityEventLines,
    lagnaEventLines,
    moonEventLines,
    ingressEventsKey,
    combustionEventsKey,
    retroEventsKey,
    velocityEventsKey,
    lagnaEventsKey,
    moonEventsKey,
    eventRange,
    lagnaRange,
    candlesKey,
  ]);

  const [eventLinesState, setEventLinesState] = useState<OverlayEventLine[]>(overlayEventLinesMemo);
  useEffect(() => {
    startTransition(() => {
      setEventLinesState(overlayEventLinesMemo);
    });
  }, [overlayEventLinesMemo, startTransition]);

  const deferredCandles = useDeferredValue(candlesMemo);
  const deferredOverlayDatasets = useDeferredValue(overlayDatasetsMemo);
  const deferredEventLines = useDeferredValue(eventLinesState);
  const deferredPlanetarySeries = useDeferredValue(planetaryLineSeriesState);
  const deferredStageZoom = useDeferredValue(stageZoomMemo);
  const deferredIsLoading = useDeferredValue(isLoadingMemo);


  // Fetch planetary longitude data and calculate slanting line series
  useEffect(() => {
    if (!planetaryLinesEnabled || candles.length === 0) {
      setPlanetaryLineSeriesData([]);
      return;
    }

    let cancelled = false;

    const fetchPlanetaryData = async () => {
      const cache = planetaryLinesCacheRef.current;
      if (cache.has(planetaryLinesCacheKey)) {
        setPlanetaryLineSeriesData(cache.get(planetaryLinesCacheKey)!);
        return;
      }
      try {
        console.log('🔮 Fetching planetary data for', planetaryLinesPlanet, 'with', candles.length, 'candles');

        // Normalize candle timestamps to epoch seconds for the API.
        const timestamps = candles.map((c) => {
          const time = c.time;
          return time > 10_000_000_000 ? Math.floor(time / 1000) : Math.floor(time);
        });

        // Fetch planetary longitude for each timestamp
        const response = await fetchPlanetaryTimeseries({
          planet: planetaryLinesPlanet,
          timestamps,
        });

        console.log('✅ Received planetary data:', response.data.length, 'points');

        if (cancelled) return;

        const anchorPrice = candles[0]?.close ?? 0;
        const baseSeries: Array<{ time: number; value: number }> = [];

        if (response.data.length > 0) {
          let prevLongitude = response.data[0].longitude;
          let unwrappedLongitude = prevLongitude;
          const baseLongitude = unwrappedLongitude;
          const wrapAngle = 360;
          const halfWrap = wrapAngle / 2;

          baseSeries.push({
            time: response.data[0].time * 1000,
            value: anchorPrice,
          });

          for (let i = 1; i < response.data.length; i++) {
            const point = response.data[i];
            const rawLongitude = point.longitude;
            let delta = rawLongitude - prevLongitude;

            if (delta > halfWrap) {
              delta -= wrapAngle;
            } else if (delta < -halfWrap) {
              delta += wrapAngle;
            }

            unwrappedLongitude += delta;
            prevLongitude = rawLongitude;

            const price = anchorPrice + (unwrappedLongitude - baseLongitude) * planetaryLinesScale;

            baseSeries.push({
              time: point.time * 1000,
              value: price,
            });
          }
        }

        const planetaryLines: PlanetaryLineSeries[] = [];

        if (baseSeries.length > 0) {
          planetaryLines.push({
            name: `${planetaryLinesPlanet}`,
            data: baseSeries,
          });

          const priceStep = Math.abs(planetaryLinesHarmonic * planetaryLinesScale);
          if (priceStep > 0) {
            const chartHigh = Math.max(...candles.map((c) => c.high));
            const chartLow = Math.min(...candles.map((c) => c.low));
            const baseHigh = Math.max(...baseSeries.map((p) => p.value));
            const baseLow = Math.min(...baseSeries.map((p) => p.value));
            const harmonicLabel = `${planetaryLinesHarmonic}°`;

            const MAX_MULTIPLIERS = 200;

            for (let step = 1; step <= MAX_MULTIPLIERS; step++) {
              const offset = step * priceStep;
              const minUpValue = baseLow + offset;
              if (minUpValue > chartHigh + priceStep) break;

              planetaryLines.push({
                name: `${planetaryLinesPlanet} + ${step}×${harmonicLabel}`,
                data: baseSeries.map((point) => ({
                  time: point.time,
                  value: point.value + offset,
                })),
              });
            }

            for (let step = 1; step <= MAX_MULTIPLIERS; step++) {
              const offset = step * priceStep;
              const maxDownValue = baseHigh - offset;
              if (maxDownValue < chartLow - priceStep) break;

              planetaryLines.push({
                name: `${planetaryLinesPlanet} - ${step}×${harmonicLabel}`,
                data: baseSeries.map((point) => ({
                  time: point.time,
                  value: point.value - offset,
                })),
              });
            }
          }
        }

        console.log('📊 Planetary line groups:', planetaryLines.length);
        if (planetaryLines[0]) {
          console.log('📐 Sample base values:', planetaryLines[0].data.slice(0, 3));
        }

        cache.set(planetaryLinesCacheKey, planetaryLines);
        setPlanetaryLineSeriesData(planetaryLines);
      } catch (error) {
        if (!cancelled) {
          console.error("❌ Failed to fetch planetary timeseries:", error);
          setPlanetaryLineSeriesData([]);
        }
      }
    };

    fetchPlanetaryData();

    return () => {
      cancelled = true;
    };
  }, [
    planetaryLinesEnabled,
    planetaryLinesPlanet,
    planetaryLinesScale,
    planetaryLinesHarmonic,
    candles,
    planetaryLinesCacheKey,
  ]);

  const handleToggleVolume = useCallback(() => {
    setShowVolume((prev) => !prev);
  }, []);

  const handleAutoscale = useCallback(() => {
    chartHandleRef.current?.autoscale();
  }, []);

  const handleToggleDrawing = useCallback(() => {
    setDrawingTool((prev) => (prev === "trendline" ? null : "trendline"));
  }, []);

  const handleClearDrawings = useCallback(() => {
    chartHandleRef.current?.clearDrawings();
    setDrawingTool(null);
  }, []);

  const handleOverlaySubmit = useCallback(async () => {
    setOverlayError(null);
    const objects = selectedPlanets.map((planet) => planet.toLowerCase());
    if (objects.length === 0) {
      setOverlayError("Select at least one planet.");
      return;
    }
    const hasSelection =
      overlayPlotGravForce ||
      overlayPlotGeoDeclination ||
      overlayPlotHelioDeclination ||
      overlayUsesWeights;
    if (!hasSelection) {
      setOverlayError("Select at least one overlay series.");
      return;
    }
    if (!Number.isFinite(overlayDurationValue) || overlayDurationValue <= 0) {
      setOverlayError("Duration must be greater than zero.");
      return;
    }
    const start = DateTime.fromISO(overlayStartDate, { zone: "utc" });
    if (!start.isValid) {
      setOverlayError("Enter a valid start date.");
      return;
    }
    const startISO = start.startOf("day").toISODate();
    if (!startISO) {
      setOverlayError("Unable to format the start date.");
      return;
    }
    let weights: Record<string, number> | undefined;
    if (overlayUsesWeights) {
      const parsed: Record<string, number> = {};
      const entries = overlayWeightsInput
        .split(/[,\n]+/)
        .map((chunk) => chunk.trim())
        .filter(Boolean);

      for (const entry of entries) {
        const [rawKey, rawValue] = entry.split(/[:=]/).map((part) => part.trim());
        if (!rawKey || rawValue === undefined) continue;
        const key = rawKey.toLowerCase();
        const value = Number(rawValue);
        if (!Number.isFinite(value)) continue;
        parsed[key] = value;
      }

      if (Object.keys(parsed).length === 0) {
        setOverlayError("Enter at least one weight in the format 'planet=value'.");
        return;
      }
      weights = parsed;
    }
    setOverlayBusy(true);
    try {
      const response = await fetchOrbitalOverlay({
        objects,
        startISO,
        durationUnit: overlayDurationUnit,
        durationValue: overlayDurationValue,
        plotGravForce: overlayPlotGravForce,
        plotGeoDeclination: overlayPlotGeoDeclination,
        plotHelioDeclination: overlayPlotHelioDeclination,
        plotWeightedGeo: overlayPlotWeightedGeo,
        plotWeightedHelio: overlayPlotWeightedHelio,
        weights,
      });
      setOrbitalSeries(response.series);
      if (response.series.length === 0) {
        setOverlayError("No overlay data returned for the selected configuration.");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setOverlayError(message);
    } finally {
      setOverlayBusy(false);
    }
  }, [
    overlayDurationUnit,
    overlayDurationValue,
    selectedPlanets,
    overlayPlotGeoDeclination,
    overlayPlotGravForce,
    overlayPlotHelioDeclination,
    overlayPlotWeightedGeo,
    overlayPlotWeightedHelio,
    overlayStartDate,
    overlayUsesWeights,
    overlayWeightsInput,
  ]);

  const handleOverlayClear = useCallback(() => {
    setOrbitalSeries([]);
    setOverlayError(null);
  }, []);

  const loadSymbol = useCallback(
    async (rawSymbol?: string) => {
      const symbol = (rawSymbol ?? symbolInput).trim().toUpperCase();
      if (!symbol) {
        setError("Symbol is required");
        return;
      }
      setIsLoading(true);
      setError(null);
      setUploadError(null);
      setUploadName(null);
      try {
        const data = await fetchOHLC({ symbol, interval, period });
        if (!data || data.length === 0) {
          throw new Error("No data available for this symbol/period combination");
        }
        setCandles(data);
        setActiveSymbol(symbol);
        setDataTitle(`${symbol} • ${interval} • ${period}`);
        setLastUpdated(new Date().toLocaleString());
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to load data";
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [interval, period, symbolInput],
  );

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void loadSymbol();
    },
    [loadSymbol],
  );

  const handleSuggestionSelect = useCallback(
    (suggestion: Suggestion) => {
      setSymbolInput(suggestion.value);
      setActiveSymbol(suggestion.value);
      setShowSuggestions(false);
      void loadSymbol(suggestion.value);
    },
    [loadSymbol],
  );

  useEffect(() => {
    const controller = new AbortController();
    const term = symbolInput.trim();
    if (term.length < 2) {
      setSuggestions([]);
      setSearchError(null);
      return () => controller.abort();
    }

    setSearchBusy(true);
    const handle = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          q: term,
          quotesCount: "6",
          newsCount: "0",
        });
        const response = await fetch(
          `${API_BASE}/api/search?${params.toString()}`,
          {
            headers: {
              Accept: "application/json",
            },
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          throw new Error(response.statusText);
        }
        const data = (await response.json()) as { quotes?: SearchQuote[] };
        const quotes = Array.isArray(data?.quotes) ? data.quotes : [];
        const nextSuggestions: Suggestion[] = quotes.map((item) => ({
          label: item.name ?? item.symbol,
          value: item.symbol,
          secondary: item.exchange ?? "",
        }));
        setSuggestions(nextSuggestions);
        setSearchError(null);
      } catch (err: unknown) {
        if ((err as Error)?.name === "AbortError") return;
        const rawMessage =
          err instanceof Error ? err.message : "Unable to fetch suggestions";
        if (rawMessage === "Failed to fetch") {
          setSearchError(null);
        } else {
          setSearchError(rawMessage);
        }
        setSuggestions([]);
      } finally {
        setSearchBusy(false);
      }
    }, 150);  // Reduced from 250ms to 150ms for faster search

    return () => {
      window.clearTimeout(handle);
      controller.abort();
    };
  }, [symbolInput]);

  useEffect(() => {
    if (!hasRestoredSessionState) {
      return;
    }
    const storedSymbol = initialSymbolRef.current?.trim();
    if (storedSymbol) {
      initialSymbolRef.current = null;
      void loadSymbol(storedSymbol);
      return;
    }
    initialSymbolRef.current = null;
    void loadSymbol();
  }, [hasRestoredSessionState, loadSymbol]);

  useEffect(() => {
    return () => {
      if (blurTimer.current) {
        window.clearTimeout(blurTimer.current);
      }
    };
  }, []);

  const handleFileUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = parseCsvCandles(text, tz);
        setCandles(parsed);
        setActiveSymbol(file.name.replace(/\.[^.]+$/, "").toUpperCase());
        setUploadName(file.name);
        setDataTitle(`Uploaded • ${file.name}`);
        setLastUpdated(new Date().toLocaleString());
        setError(null);
        setUploadError(null);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Could not parse CSV file";
        setUploadError(message);
      } finally {
        event.target.value = "";
      }
    },
    [],
  );

  const infoRows = useMemo(() => {
    if (!latestCandle) {
      return [
        { label: "Open", value: "—" },
        { label: "High", value: "—" },
        { label: "Low", value: "—" },
        { label: "Close", value: "—" },
        { label: "Volume", value: "—" },
      ];
    }
    return [
      { label: "Open", value: formatNumber(latestCandle.open) },
      { label: "High", value: formatNumber(latestCandle.high) },
      { label: "Low", value: formatNumber(latestCandle.low) },
      { label: "Close", value: formatNumber(latestCandle.close) },
      {
        label: "Volume",
        value: latestCandle.volume
          ? formatNumber(latestCandle.volume)
          : "—",
      },
    ];
  }, [latestCandle]);

  const activeTimeLabel = useMemo(() => {
    if (!latestCandle?.time) return "—";
    return new Date(latestCandle.time * 1000).toLocaleString();
  }, [latestCandle]);

  return (
    <>
      <div className="flex flex-col h-full min-h-0 bg-[#050608]">
      {/* Compact Top Control Bar */}
      <div className="flex-shrink-0 border-b border-zinc-800 bg-black/50 backdrop-blur-sm">
        <div className="flex items-center justify-between px-4 py-1">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <TrendingUp className="h-4 w-4 text-green-500" />
              <span className="font-mono">{activeSymbol || "—"}</span>
              <span className="text-xs text-zinc-500">
                {interval} · {period}
              </span>
            </div>
            {candles.length > 0 && (
              <div className="text-xs text-zinc-500">
                {candles.length} candles
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="text-xs text-zinc-400">
              <span>
                {lastUpdated ? (
                  <span className="text-zinc-300">{lastUpdated}</span>
                ) : (
                  "—"
                )}
              </span>
            </div>

            {/* Chart Control Buttons */}
            <div className="flex items-center gap-0">
              <button
                type="button"
                onClick={handleAutoscale}
              className="px-1.5 py-0.5 leading-none text-zinc-600 border border-zinc-700/50 hover:border-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 rounded-none transition-all duration-200 uppercase tracking-tight"
                style={{ fontSize: '0.75rem' }}
                title="Auto scale"
              >
                AUTO SCALE
              </button>
              <button
                type="button"
                onClick={handleToggleVolume}
                className={`px-1.5 py-0.5 leading-none border rounded-none transition-all duration-200 uppercase tracking-tight ${
                  showVolume
                    ? "text-green-400 bg-green-500/10 border-green-500/50 hover:border-green-400"
                    : "text-zinc-600 border-zinc-700/50 hover:border-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
                }`}
                style={{ fontSize: '0.75rem' }}
                title="Toggle volume"
              >
                VOLUME
              </button>
              <button
                type="button"
                onClick={handleToggleDrawing}
                className={`px-1.5 py-0.5 leading-none border rounded-none transition-all duration-200 uppercase tracking-tight ${
                  drawingActive
                    ? "text-blue-400 bg-blue-500/10 border-blue-500/50 hover:border-blue-400"
                    : "text-zinc-600 border-zinc-700/50 hover:border-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
                }`}
                style={{ fontSize: '0.75rem' }}
                title="Draw trendlines"
              >
                DRAW
              </button>
              <button
                type="button"
                onClick={handleClearDrawings}
                className="px-1.5 py-0.5 leading-none text-zinc-600 border border-zinc-700/50 hover:border-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 rounded-none transition-all duration-200 uppercase tracking-tight"
                style={{ fontSize: '0.75rem' }}
                title="Clear drawings"
              >
                CLEAR
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area: Sidebar + Chart */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left Sidebar - Collapsible Controls */}
        <div className="flex-shrink-0 overflow-y-auto border-r border-zinc-900/40 bg-black w-[300px] lg:w-[320px] xl:w-[340px] 2xl:w-[360px]">
          <div className="py-1.5 space-y-1.5">

          {/* Symbol & Data Section */}
          <CollapsibleSection
            title="Symbol & Data"
            defaultOpen={true}
          >
            <form
              onSubmit={handleSubmit}
              className="space-y-3"
            >
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5 uppercase tracking-wide">
                  Search symbol
                </label>
                <div className="relative" ref={suggestionsContainerRef}>
                  <input
                    type="text"
                    value={symbolInput}
                    onChange={(event) => setSymbolInput(event.target.value)}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => {
                      blurTimer.current = window.setTimeout(
                        () => setShowSuggestions(false),
                        150,
                      );
                    }}
                    className="w-full rounded-none bg-black border border-zinc-800/40 px-3 py-1.5 text-xs outline-none focus:border-green-500 font-mono"
                    placeholder="AAPL, BTC-USD"
                    autoComplete="off"
                  />
                  {showSuggestions && (suggestions.length > 0 || searchBusy) && (
                    <div className="absolute z-10 mt-1 w-full border border-zinc-800/40 bg-black/95 shadow-lg rounded-none">
                      {searchBusy && (
                        <div className="px-3 py-1.5 text-xs text-zinc-500">
                          Searching…
                        </div>
                      )}
                      {suggestions.map((suggestion) => (
                        <button
                          key={`${suggestion.value}-${suggestion.label}`}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => handleSuggestionSelect(suggestion)}
                          className="flex w-full justify-between gap-4 px-3 py-1.5 text-left text-xs text-zinc-200 hover:bg-green-900/20 first:rounded-none last:rounded-none"
                        >
                          <span className="font-semibold">{suggestion.value}</span>
                          <span className="text-zinc-500">{suggestion.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {searchError && (
                    <div className="mt-1.5 text-xs text-red-400">{searchError}</div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div ref={intervalDropdown.ref} className="relative">
                  <button
                    type="button"
                    onClick={() => intervalDropdown.setOpen(!intervalDropdown.open)}
                    className="w-full flex items-center justify-between border border-zinc-700/50 bg-black px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-600/70"
                  >
                    <span className="uppercase tracking-wide text-zinc-500" style={{ fontSize: '0.65rem' }}>Interval</span>
                    <span className="text-zinc-300" style={{ fontSize: '0.7rem' }}>{interval}</span>
                  </button>
                  {intervalDropdown.open && (
                    <div className="absolute z-30 mt-1 w-full border border-zinc-800/40 bg-black shadow-xl max-h-48 overflow-y-auto">
                      {(["5m", "15m", "1h", "4h", "1d", "1wk", "1mo", "3mo"] as const).map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => { setInterval(opt); setShowIntervalCustom(false); intervalDropdown.setOpen(false); }}
                          className={cls(
                            "w-full px-3 py-1.5 text-left transition-colors",
                            interval === opt ? "bg-green-900/30 text-green-300" : "text-zinc-200 hover:bg-zinc-900"
                          )}
                          style={{ fontSize: '0.7rem' }}
                        >
                          {opt}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setShowIntervalCustom(!showIntervalCustom)}
                        className="w-full px-3 py-1.5 text-left transition-colors text-green-400 hover:bg-zinc-900 border-t border-zinc-800/40"
                        style={{ fontSize: '0.7rem' }}
                      >
                        Custom...
                      </button>
                      {showIntervalCustom && (
                        <div className="p-2 border-t border-zinc-800/40">
                          <input
                            type="text"
                            value={customIntervalInput}
                            onChange={(e) => setCustomIntervalInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && customIntervalInput.trim()) {
                                setInterval(customIntervalInput.trim() as Interval);
                                intervalDropdown.setOpen(false);
                                setShowIntervalCustom(false);
                                setCustomIntervalInput("");
                              }
                            }}
                            placeholder="e.g. 30m, 2h, 1d"
                            className="w-full bg-zinc-900 border border-zinc-700 text-zinc-200 px-2 py-1 text-xs focus:outline-none focus:border-green-500"
                            autoFocus
                          />
                          <div className="text-zinc-500 text-[0.6rem] mt-1">Press Enter to apply</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div ref={periodDropdown.ref} className="relative">
                  <button
                    type="button"
                    onClick={() => periodDropdown.setOpen(!periodDropdown.open)}
                    className="w-full flex items-center justify-between border border-zinc-700/50 bg-black px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-600/70"
                  >
                    <span className="uppercase tracking-wide text-zinc-500" style={{ fontSize: '0.65rem' }}>Period</span>
                    <span className="text-zinc-300" style={{ fontSize: '0.7rem' }}>{period}</span>
                  </button>
                  {periodDropdown.open && (
                    <div className="absolute z-30 mt-1 w-full border border-zinc-800/40 bg-black shadow-xl max-h-48 overflow-y-auto">
                      {(["5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "max"] as const).map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => { setPeriod(opt); setShowPeriodCustom(false); periodDropdown.setOpen(false); }}
                          className={cls(
                            "w-full px-3 py-1.5 text-left transition-colors",
                            period === opt ? "bg-green-900/30 text-green-300" : "text-zinc-200 hover:bg-zinc-900"
                          )}
                          style={{ fontSize: '0.7rem' }}
                        >
                          {opt}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setShowPeriodCustom(!showPeriodCustom)}
                        className="w-full px-3 py-1.5 text-left transition-colors text-green-400 hover:bg-zinc-900 border-t border-zinc-800/40"
                        style={{ fontSize: '0.7rem' }}
                      >
                        Custom...
                      </button>
                      {showPeriodCustom && (
                        <div className="p-2 border-t border-zinc-800/40">
                          <input
                            type="text"
                            value={customPeriodInput}
                            onChange={(e) => setCustomPeriodInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && customPeriodInput.trim()) {
                                setPeriod(customPeriodInput.trim() as Period);
                                periodDropdown.setOpen(false);
                                setShowPeriodCustom(false);
                                setCustomPeriodInput("");
                              }
                            }}
                            placeholder="e.g. 10d, 15mo, 3y"
                            className="w-full bg-zinc-900 border border-zinc-700 text-zinc-200 px-2 py-1 text-xs focus:outline-none focus:border-green-500"
                            autoFocus
                          />
                          <div className="text-zinc-500 text-[0.6rem] mt-1">Press Enter to apply</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <button
                type="submit"
                className="w-full rounded-none border border-green-600 bg-green-900/20 px-4 py-1.5 uppercase tracking-wide text-green-400 hover:bg-green-900/30 transition-colors"
                disabled={isLoading}
                style={{ fontSize: '0.7rem' }}
              >
                {isLoading ? "Loading..." : "Load Data"}
              </button>
            </form>

            <div className="mt-3 pt-3 border-t border-zinc-800">
              <label className="block text-xs text-zinc-400 mb-2 uppercase tracking-wide">
                Upload CSV
              </label>
              <label className="flex h-10 cursor-pointer items-center justify-center border border-dashed border-zinc-700 rounded-none text-xs text-zinc-400 hover:border-zinc-500 transition-colors">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                Drop CSV or click
              </label>
              {uploadName && (
                <div className="mt-2 text-xs text-green-400">
                  ✓ {uploadName}
                </div>
              )}
              {uploadError && (
                <div className="mt-2 text-xs text-red-400">{uploadError}</div>
              )}
              {error && (
                <div className="mt-2 text-xs text-red-400">{error}</div>
              )}
            </div>
          </CollapsibleSection>

          {/* Event Overlays Section */}
          <CollapsibleSection
            title="Event Overlays"
            defaultOpen={false}
          >
            <div className="space-y-3">
              <div className="text-xs text-zinc-400">
                {isPlus
                  ? `Event overlays (${eventLabels.ingress} · ${eventLabels.combustion} · ${eventLabels.retro} · ${eventLabels.velocity})`
                  : "Event overlays (I · C · R · V)"}
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-zinc-300">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded-none border border-zinc-700 bg-black accent-green-500"
                    checked={ingressEnabledInput}
                    onChange={(event) => setIngressEnabledInput(event.target.checked)}
                  />
                  <span>{eventLabels.ingress}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded-none border border-zinc-700 bg-black accent-green-500"
                    checked={combustionEnabledInput}
                    onChange={(event) => setCombustionEnabledInput(event.target.checked)}
                  />
                  <span>{eventLabels.combustion}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded-none border border-zinc-700 bg-black accent-green-500"
                    checked={retroEnabledInput}
                    onChange={(event) => setRetroEnabledInput(event.target.checked)}
                  />
                  <span>{eventLabels.retro}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded-none border border-zinc-700 bg-black accent-green-500"
                    checked={velocityEnabledInput}
                    onChange={(event) => setVelocityEnabledInput(event.target.checked)}
                  />
                  <span>{eventLabels.velocity}</span>
                </label>
              </div>

              <div className="grid gap-3 grid-cols-2">
                <div>
                  <label className="mb-1 block text-[0.6rem] uppercase tracking-[0.3em] text-zinc-500">
                    Range start
                  </label>
                  <input
                    type="datetime-local"
                    value={eventRangeStart}
                    onChange={(event) => {
                      setEventRangeStart(event.target.value);
                      clearChartVisibleRange();
                    }}
                    className="w-full rounded-none border border-zinc-800/40 bg-black px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-green-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[0.6rem] uppercase tracking-[0.3em] text-zinc-500">
                    Range end
                  </label>
                  <input
                    type="datetime-local"
                    value={eventRangeEnd}
                    onChange={(event) => {
                      setEventRangeEnd(event.target.value);
                      clearChartVisibleRange();
                    }}
                    className="w-full rounded-none border border-zinc-800/40 bg-black px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-green-500"
                  />
                </div>
              </div>

              <div className="space-y-2">
                {renderPlanetFilter(eventLabels.ingress, ingressOptions, ingressPlanets, ingressFilter, setIngressPlanets)}
                {renderPlanetFilter(eventLabels.combustion, combustionOptions, combustionPlanets, combustionFilter, setCombustionPlanets)}
                {renderPlanetFilter(eventLabels.retro, retroOptions, retroPlanets, retroFilter, setRetroPlanets)}
                {renderPlanetFilter(eventLabels.velocity, velocityOptions, velocityPlanets, velocityFilter, setVelocityPlanets)}
              </div>

              <div className="border-t border-zinc-900 pt-4">
                <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-300">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded-none border border-zinc-700 bg-black accent-green-500"
                      checked={lagnaEnabledInput}
                      onChange={(event) => setLagnaEnabledInput(event.target.checked)}
                      disabled={!allowShortInterval}
                    />
                    <span className={!allowShortInterval ? "text-zinc-600" : undefined}>
                      {isAdmin ? "Lagna changes" : "L"}
                    </span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded-none border border-zinc-700 bg-black accent-green-500"
                      checked={moonEnabledInput}
                      onChange={(event) => setMoonEnabledInput(event.target.checked)}
                      disabled={!allowShortInterval}
                    />
                    <span className={!allowShortInterval ? "text-zinc-600" : undefined}>
                      {isAdmin ? "Moon nakshatra" : "NAK"}
                    </span>
                  </label>
                </div>
                <div className="mt-3 grid gap-3 grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[0.6rem] uppercase tracking-[0.3em] text-zinc-500">
                      {isAdmin ? "Lagna start" : "L start"}
                    </label>
                    <input
                      type="datetime-local"
                      value={lagnaRangeStart}
                      onChange={(event) => setLagnaRangeStart(event.target.value)}
                      className="w-full rounded-none border border-zinc-800/40 bg-black px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-green-500 disabled:border-zinc-800/40 disabled:text-zinc-600"
                      disabled={!allowShortInterval}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[0.6rem] uppercase tracking-[0.3em] text-zinc-500">
                      {isAdmin ? "Lagna end" : "L end"}
                    </label>
                    <input
                      type="datetime-local"
                      value={lagnaRangeEnd}
                      onChange={(event) => setLagnaRangeEnd(event.target.value)}
                      className="w-full rounded-none border border-zinc-800/40 bg-black px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-green-500 disabled:border-zinc-800/40 disabled:text-zinc-600"
                      disabled={!allowShortInterval}
                    />
                  </div>
                </div>
                {!allowShortInterval && (
                  <div className="mt-2 text-[0.65rem] text-zinc-500">
                    Lagna and Moon overlays are available when the interval is 15m or shorter.
                  </div>
                )}
              </div>
            </div>
          </CollapsibleSection>

          {/* Orbital Overlays Section */}
          <CollapsibleSection
            title={isAdmin ? "Orbital Overlays" : "OBO"}
            defaultOpen={false}
            disabled={!isPlus}
            onDisabledClick={() => {
              setUpgradeFeature('OBO');
              setShowUpgradeModal(true);
            }}
          >
            <div className="space-y-3">
              <div className="text-xs text-zinc-400">
                {isPlus
                  ? "Plot orbital metrics as lines on the price chart."
                  : "Add orbital lines over the price chart."}
              </div>

              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-[0.6rem] uppercase tracking-[0.3em] text-zinc-500">
                    {isAdmin ? "Objects" : "Bodies"}
                  </label>
                  <div className="grid grid-cols-2 gap-2 border border-zinc-800/40 bg-black px-3 py-1.5 text-xs">
                    {allPlanetNames.map((planet) => {
                      const isSelected = selectedPlanets.includes(planet);
                      return (
                        <label key={planet} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            className="h-3 w-3 rounded-none border border-zinc-700 bg-black accent-green-500"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedPlanets([...selectedPlanets, planet]);
                              } else {
                                setSelectedPlanets(selectedPlanets.filter((p) => p !== planet));
                              }
                            }}
                          />
                          <span className="text-zinc-300">
                            {isAdmin ? planet : PLANET_CODES[planet]}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[0.6rem] uppercase tracking-[0.3em] text-zinc-500">
                      {isAdmin ? "Start date" : "Start"}
                    </label>
                    <input
                      type="date"
                      value={overlayStartDate}
                      onChange={(event) => setOverlayStartDate(event.target.value)}
                      className="w-full rounded-none border border-zinc-800/40 bg-black px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-green-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[0.6rem] uppercase tracking-[0.3em] text-zinc-500">
                      Duration
                    </label>
                    <div className="border border-zinc-800/40 bg-black px-3 py-1.5 text-xs">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={1460}
                          value={overlayDurationValue}
                          onChange={(event) => setOverlayDurationValue(Number(event.target.value) || 0)}
                          className="w-14 rounded-none border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-green-500"
                        />
                        <select
                          value={overlayDurationUnit}
                          onChange={(event) =>
                            setOverlayDurationUnit(event.target.value as DurationUnit)
                          }
                          className="w-14 border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 outline-none focus:border-green-600 cursor-pointer hover:bg-black transition-colors"
                        >
                          <option value="years" title="Years" className="bg-zinc-900 text-zinc-300">Y</option>
                          <option value="months" title="Months" className="bg-zinc-900 text-zinc-300">M</option>
                          <option value="weeks" title="Weeks" className="bg-zinc-900 text-zinc-300">W</option>
                          <option value="days" title="Days" className="bg-zinc-900 text-zinc-300">D</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 text-xs text-zinc-300">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded-none border border-zinc-700 bg-black accent-green-500"
                      checked={overlayPlotSpeed}
                      onChange={(event) => setOverlayPlotSpeed(event.target.checked)}
                      disabled={overlayUsesWeights}
                    />
                    <span>{isAdmin ? "Orbital speed" : "Speed"}</span>
                  </label>
                  {overlayPlotSpeed && (
                    <div className="flex items-center gap-2 pl-6 text-[0.6rem] text-zinc-500">
                      <span>Zoom</span>
                      <input
                        type="range"
                        min="0.05"
                        max="1"
                        step="0.05"
                        value={speedZoom}
                        onChange={(event) => setSpeedZoom(Number(event.target.value) || 1)}
                        className="h-1 w-32 accent-green-500"
                      />
                      <span className="text-zinc-400">{Math.round(speedZoom * 100)}%</span>
                      <button
                        type="button"
                        onClick={() => setSpeedZoom(1)}
                        className="text-zinc-400 hover:text-green-300"
                      >
                        Reset
                      </button>
                    </div>
                  )}
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded-none border border-zinc-700 bg-black accent-green-500"
                      checked={overlayPlotGravForce}
                      onChange={(event) => setOverlayPlotGravForce(event.target.checked)}
                      disabled={overlayUsesWeights}
                    />
                    <span>{isAdmin ? "Gravitational force" : "Force"}</span>
                  </label>
                  {overlayPlotGravForce && (
                    <div className="flex items-center gap-2 pl-6 text-[0.6rem] text-zinc-500">
                      <span>Zoom</span>
                      <input
                        type="range"
                        min="0.05"
                        max="1"
                        step="0.05"
                        value={forceZoom}
                        onChange={(event) => setForceZoom(Number(event.target.value) || 1)}
                        className="h-1 w-32 accent-green-500"
                      />
                      <span className="text-zinc-400">{Math.round(forceZoom * 100)}%</span>
                      <button
                        type="button"
                        onClick={() => setForceZoom(1)}
                        className="text-zinc-400 hover:text-green-300"
                      >
                        Reset
                      </button>
                    </div>
                  )}
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded-none border border-zinc-700 bg-black accent-green-500"
                      checked={overlayPlotGeoDeclination}
                      onChange={(event) => setOverlayPlotGeoDeclination(event.target.checked)}
                      disabled={overlayUsesWeights}
                    />
                    <span>{isAdmin ? "Geo declination" : "GD"}</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded-none border border-zinc-700 bg-black accent-green-500"
                      checked={overlayPlotHelioDeclination}
                      onChange={(event) => setOverlayPlotHelioDeclination(event.target.checked)}
                      disabled={overlayUsesWeights}
                    />
                    <span>{isAdmin ? "Helio declination" : "HD"}</span>
                  </label>
                </div>

                <div className="border-t border-zinc-900 pt-3 space-y-2">
                  <label className="flex items-center gap-2 text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded-none border border-zinc-700 bg-black accent-green-500"
                      checked={overlayPlotWeightedGeo}
                      onChange={(event) => setOverlayPlotWeightedGeo(event.target.checked)}
                      disabled={overlayHasStandard}
                    />
                    <span>{isAdmin ? "Weighted geo declination" : "W-GD"}</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded-none border border-zinc-700 bg-black accent-green-500"
                      checked={overlayPlotWeightedHelio}
                      onChange={(event) => setOverlayPlotWeightedHelio(event.target.checked)}
                      disabled={overlayHasStandard}
                    />
                    <span>{isAdmin ? "Weighted helio declination" : "W-HD"}</span>
                  </label>
                  <div>
                    <label className="mb-1 block text-[0.6rem] uppercase tracking-[0.3em] text-zinc-500">
                      {isAdmin ? "Weights" : "Weights"}
                    </label>
                    <textarea
                      value={overlayWeightsInput}
                      onChange={(event) => setOverlayWeightsInput(event.target.value)}
                      disabled={!overlayUsesWeights}
                      rows={3}
                      className="h-24 w-full resize-none rounded-none border border-zinc-800/40 bg-black px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-green-500 disabled:border-zinc-800/40 disabled:text-zinc-600"
                      placeholder={isAdmin ? "S=7, Mo=7, Me=6" : "S=7, Mo=7…"}
                    />
                    <div className="mt-1 text-[0.6rem] text-zinc-500">
                      {isPlus
                        ? "Separate entries with commas or new lines. Use shortforms (e.g. Me=6, V=5)."
                        : "Comma-separated pairs (e.g. Me=6, V=5)."}
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleOverlaySubmit()}
                    className="flex-1 rounded-none border border-green-600 bg-green-900/20 px-3 py-1.5 text-xs uppercase tracking-wide text-green-400 hover:bg-green-900/30 transition-colors disabled:opacity-50"
                    disabled={overlayBusy}
                  >
                    {overlayBusy ? (isAdmin ? "Computing…" : "Working…") : isAdmin ? "Compute" : "Compute"}
                  </button>
                  <button
                    type="button"
                    onClick={handleOverlayClear}
                    className="flex-1 rounded-none border border-zinc-700 bg-zinc-900/20 px-3 py-1.5 text-xs uppercase tracking-wide text-zinc-400 hover:bg-zinc-900/30 transition-colors disabled:opacity-50"
                    disabled={overlayBusy || orbitalSeries.length === 0}
                  >
                    Clear
                  </button>
                </div>

                {overlayError && (
                  <div className="text-xs text-red-400">{overlayError}</div>
                )}
                {!overlayError && orbitalSeries.length > 0 && (
                  <div className="text-xs text-green-400">
                    {isPlus
                      ? `${orbitalSeries.length} overlay series ready.`
                      : `${orbitalSeries.length} overlays ready.`}
                  </div>
                )}
              </div>
            </div>
          </CollapsibleSection>

          {/* Planetary Lines Section */}
          <CollapsibleSection
            title={isAdmin ? "Planetary Lines" : "PL"}
            defaultOpen={false}
            disabled={!isPlus}
            onDisabledClick={() => {
              setUpgradeFeature('PL');
              setShowUpgradeModal(true);
            }}
          >
            <div className="space-y-3">
              {/* Enable checkbox */}
              <label className="flex items-center gap-2 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded-none border border-zinc-700 bg-black accent-green-500"
                  checked={planetaryLinesEnabled}
                  onChange={(e) => setPlanetaryLinesEnabled(e.target.checked)}
                />
                <span>Enable data lines</span>
              </label>

              {/* Planet selection */}
              <div ref={planetDropdown.ref} className="relative">
                <button
                  type="button"
                  onClick={() => !planetaryLinesEnabled ? null : planetDropdown.setOpen(!planetDropdown.open)}
                  disabled={!planetaryLinesEnabled}
                  className="w-full flex items-center justify-between border border-zinc-700/50 bg-black px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-600/70 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="uppercase tracking-wide text-zinc-500">DATA</span>
                  <span className="text-zinc-300">{planetaryLinesPlanet}</span>
                </button>
                {planetDropdown.open && planetaryLinesEnabled && (
                  <div className="absolute z-30 mt-1 w-full border border-zinc-800/40 bg-black shadow-xl max-h-60 overflow-y-auto">
                    {allPlanetNames.map((planet) => (
                      <button
                        key={planet}
                        type="button"
                        onClick={() => { setPlanetaryLinesPlanet(planet); planetDropdown.setOpen(false); }}
                        className={cls(
                          "w-full px-3 py-1.5 text-left text-xs transition-colors",
                          planetaryLinesPlanet === planet ? "bg-green-900/30 text-green-300" : "text-zinc-200 hover:bg-zinc-900"
                        )}
                      >
                        {planet}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Scale */}
              <div>
                <label className="mb-1 block text-[0.6rem] uppercase tracking-[0.3em] text-zinc-500">
                  Scale (1° = $)
                </label>
                <input
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={planetaryLinesScale}
                  onChange={(e) => setPlanetaryLinesScale(Number(e.target.value) || 1)}
                  disabled={!planetaryLinesEnabled}
                  className="w-full rounded-none border border-zinc-800/40 bg-black px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-green-500 disabled:opacity-50"
                />
              </div>

              {/* Harmonic */}
              <div ref={harmonicDropdown.ref} className="relative">
                <button
                  type="button"
                  onClick={() => !planetaryLinesEnabled ? null : harmonicDropdown.setOpen(!harmonicDropdown.open)}
                  disabled={!planetaryLinesEnabled}
                  className="w-full flex items-center justify-between border border-zinc-700/50 bg-black px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-600/70 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="uppercase tracking-wide text-zinc-500">Harmonic</span>
                  <span className="text-zinc-300">
                    {planetaryLinesHarmonic === 360 ? "360° (Full circle)" :
                     planetaryLinesHarmonic === 180 ? "180° (Opposition)" :
                     "120° (Trine)"}
                  </span>
                </button>
                {harmonicDropdown.open && planetaryLinesEnabled && (
                  <div className="absolute z-30 mt-1 w-full border border-zinc-800/40 bg-black shadow-xl">
                    {[
                      { value: 360, label: "360° (Full circle)" },
                      { value: 180, label: "180° (Opposition)" },
                      { value: 120, label: "120° (Trine)" }
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => { setPlanetaryLinesHarmonic(option.value); harmonicDropdown.setOpen(false); }}
                        className={cls(
                          "w-full px-3 py-1.5 text-left text-xs transition-colors",
                          planetaryLinesHarmonic === option.value ? "bg-green-900/30 text-green-300" : "text-zinc-200 hover:bg-zinc-900"
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {planetaryLinesEnabled && (
                <div className="rounded-none border border-zinc-800/40 bg-zinc-950/40 p-2 text-[0.65rem] text-zinc-400">
                  Slanting time-series lines tracking {planetaryLinesPlanet} longitude over history
                </div>
              )}
            </div>
          </CollapsibleSection>

          </div>
        </div>

        {/* Main Chart Area */}
        <div className="flex-1 flex flex-col relative min-h-0">
          <div className="flex-1 min-h-0">
            <EChartsContainer
              ref={chartHandleRef}
              candles={deferredCandles}
              overlays={deferredOverlayDatasets}
              eventLines={deferredEventLines}
              planetaryLineSeries={deferredPlanetarySeries}
              onCrosshairMove={setHoverCandle}
              onVisibleRangeChange={handleVisibleRangeChange}
              onReady={handleChartReady}
              className="h-full"
              isLoading={deferredIsLoading}
              showVolume={showVolume}
              drawingTool={drawingTool}
              stageZoom={deferredStageZoom}
            />
          </div>

        </div>
      </div>

      {/* Upgrade Modal */}
      {showUpgradeModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={() => setShowUpgradeModal(false)}
        >
          <div
            className="w-full max-w-md border border-zinc-800 bg-black p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 font-mono text-sm tracking-wide uppercase text-green-400">
              Upgrade Required
            </h2>
            <p className="mb-6 font-mono text-[10px] text-zinc-500">
              {upgradeFeature} requires premium access.
            </p>
            <div className="mb-6 space-y-2 font-mono text-[10px] text-zinc-600">
              <p className="text-zinc-400 uppercase tracking-wide">Premium Features</p>
              <ul className="list-inside list-disc space-y-1 pl-1">
                <li>Advanced data events</li>
                <li>Real-time market data</li>
                <li>Download all data as CSV</li>
                <li>Navigate to any month</li>
                <li>Custom indicators</li>
                <li>Priority support</li>
              </ul>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowUpgradeModal(false)}
                className="flex-1 bg-green-600 border border-green-600 px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-black transition-colors hover:bg-green-700"
              >
                Upgrade
              </button>
              <button
                onClick={() => setShowUpgradeModal(false)}
                className="flex-1 border border-zinc-800 bg-black px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-zinc-400 transition-colors hover:bg-zinc-900"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
