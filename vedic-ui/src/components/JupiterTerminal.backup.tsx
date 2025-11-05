"use client";

import { DateTime } from "luxon";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { LineData, SeriesMarker, Time, UTCTimestamp } from "lightweight-charts";
import {
  TrendingUp,
  Calendar,
  Orbit,
  Sparkles,
  ChevronDown,
  Play,
  Volume2,
  Ruler,
  Eraser
} from "lucide-react";

import {
  ChartContainer,
  type ChartContainerHandle,
  type OverlayEventLine,
} from "@/components/ChartContainer";
import { Pane } from "@/components/Pane";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import type { Candle, Interval, Period, OrbitalOverlaySeries } from "@/lib/api";
import { fetchOHLC, fetchOrbitalOverlay } from "@/lib/api";

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
  Moon: "M",
  Mercury: "Me",
  Venus: "V",
  Mars: "M",
  Jupiter: "J",
  Saturn: "St",
  Rahu: "R",
  Ketu: "K",
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

const ORBITAL_COLORS = [
  "#8bb8f2",
  "#9adbc5",
  "#f5b6d7",
  "#d8c3ff",
  "#f3c995",
  "#a6c1ff",
  "#c0e4d8",
];

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

type JupiterTerminalProps = {
  plan: "free" | "plus";
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
  if (!dt.isValid) return null;
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

function parseCsvCandles(text: string): Candle[] {
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
    const timestamp = Date.parse(rawDate);
    if (Number.isNaN(timestamp)) continue;

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
  const isPlus = plan === "plus";
  const [symbolInput, setSymbolInput] = useState("AAPL");
  const [activeSymbol, setActiveSymbol] = useState("AAPL");
  const [interval, setInterval] = useState<Interval>("1d");
  const [period, setPeriod] = useState<Period>("1y");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [dataTitle, setDataTitle] = useState<string>("AAPL • 1d • 1y");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const blurTimer = useRef<number | null>(null);

  const [hoverCandle, setHoverCandle] = useState<Candle | null>(null);
  const [showVolume, setShowVolume] = useState(true);
  const [drawingTool, setDrawingTool] = useState<"trendline" | null>(null);

  const suggestionsContainerRef = useRef<HTMLDivElement | null>(null);
  const chartHandleRef = useRef<ChartContainerHandle | null>(null);

  const eventLabels = useMemo(() => ({
    ingress: isPlus ? "Ingress" : EVENT_CODES.ingress,
    combustion: isPlus ? "Combustion" : EVENT_CODES.combustion,
    retro: isPlus ? "Retro" : EVENT_CODES.retro,
    velocity: isPlus ? "Velocity" : EVENT_CODES.velocity,
    lagna: isPlus ? "Lagna" : EVENT_CODES.lagna,
    moon: isPlus ? "Moon" : EVENT_CODES.moon,
  }), [isPlus]);

  const planetLabel = useCallback(
    (name: string | undefined) => (isPlus ? name ?? "" : formatPlanetCode(name)),
    [isPlus],
  );

  const drawingActive = drawingTool === "trendline";
  const baseControlClasses =
    "rounded-none border px-3 py-[0.4rem] text-[0.7rem] tracking-[0.08em] transition-colors";
  const defaultControlClasses =
    "border-zinc-800 bg-zinc-900 text-zinc-200 hover:border-zinc-600";
  const activeControlClasses =
    "border-sky-500 bg-sky-900/25 text-sky-200";

  const [eventRangeStart, setEventRangeStart] = useState("");
  const [eventRangeEnd, setEventRangeEnd] = useState("");
  const [lagnaRangeStart, setLagnaRangeStart] = useState("");
  const [lagnaRangeEnd, setLagnaRangeEnd] = useState("");

  const [ingressEnabled, setIngressEnabled] = useState(true);
  const [combustionEnabled, setCombustionEnabled] = useState(true);
  const [retroEnabled, setRetroEnabled] = useState(true);
  const [velocityEnabled, setVelocityEnabled] = useState(true);
  const [lagnaEnabled, setLagnaEnabled] = useState(false);
  const [moonEnabled, setMoonEnabled] = useState(false);
  const [overlayObjectsInput, setOverlayObjectsInput] = useState(
    "mercury, venus, mars, jupiter, saturn",
  );
  const [overlayStartDate, setOverlayStartDate] = useState<string>(() =>
    DateTime.now().toISODate() ?? "",
  );
  const [overlayDurationUnit, setOverlayDurationUnit] = useState<DurationUnit>("months");
  const [overlayDurationValue, setOverlayDurationValue] = useState<number>(1);
  const [overlayPlotSpeed, setOverlayPlotSpeed] = useState(false);
  const [overlayPlotGravForce, setOverlayPlotGravForce] = useState(false);
  const [overlayPlotGeoDeclination, setOverlayPlotGeoDeclination] = useState(false);
  const [overlayPlotHelioDeclination, setOverlayPlotHelioDeclination] = useState(true);
  const [overlayPlotWeightedGeo, setOverlayPlotWeightedGeo] = useState(false);
  const [overlayPlotWeightedHelio, setOverlayPlotWeightedHelio] = useState(false);
  const [overlayWeightsInput, setOverlayWeightsInput] = useState(
    "mercury=6, venus=5, earth=4, mars=3, jupiter=2, saturn=1",
  );
  const [overlayBusy, setOverlayBusy] = useState(false);
  const [overlayError, setOverlayError] = useState<string | null>(null);
  const [orbitalSeries, setOrbitalSeries] = useState<OrbitalOverlaySeries[]>([]);
  const allPlanetNames = useMemo(() => Object.keys(PLANET_CODES), []);
  const overlayUsesWeights = overlayPlotWeightedGeo || overlayPlotWeightedHelio;
  const overlayHasStandard =
    overlayPlotSpeed ||
    overlayPlotGravForce ||
    overlayPlotGeoDeclination ||
    overlayPlotHelioDeclination;

  useEffect(() => {
    if (overlayUsesWeights) {
      setOverlayPlotSpeed(false);
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
    },
    [],
  );

  const describeSelection = useCallback((selected: Set<string>, options: string[]): string => {
    if (selected.size === 0 || selected.size === options.length) return "All";
    if (selected.size === 1) {
      const value = Array.from(selected)[0]!;
      return isPlus ? value : formatPlanetCode(value);
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
      if (timestamp < minTime || timestamp > maxTime) {
        return null;
      }
      return best ?? null;
    },
    [candles],
  );

  const intervalMinutes = INTERVAL_TO_MINUTES[interval] ?? 1440;
  const allowShortInterval = intervalMinutes <= 20;

  useEffect(() => {
    if (!allowShortInterval) {
      setLagnaEnabled(false);
      setMoonEnabled(false);
    }
  }, [allowShortInterval]);

  const eventRangeState = useMemo(() => ({ start: eventRange.start, end: eventRange.end }), [eventRange]);
  const lagnaRangeState = useMemo(() => ({ start: lagnaRange.start, end: lagnaRange.end }), [lagnaRange]);

  useEffect(() => {
    chartHandleRef.current?.setVisibleRange(eventRangeState);
    onRangeChange?.(eventRangeState);
  }, [candles, eventRangeState, onRangeChange]);

  const renderPlanetFilter = (
    label: string,
    options: string[],
    selected: Set<string>,
    control: ReturnType<typeof useDropdownControl>,
    setter: Dispatch<SetStateAction<Set<string>>>,
  ): JSX.Element | null => {
    if (!options.length) return null;
    const summary = describeSelection(selected, options);
    const isAll = selected.size === 0;
    return (
      <div ref={control.ref} className="relative">
        <button
          type="button"
          onClick={() => control.setOpen((open) => !open)}
          className="flex w-full items-center justify-between rounded-none border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-200 hover:border-zinc-700"
        >
          <span className="uppercase tracking-[0.3em] text-zinc-500">{label}</span>
          <span className="text-zinc-300">{summary}</span>
        </button>
        {control.open && (
          <div className="absolute z-30 mt-1 w-full border border-zinc-800 bg-black shadow-xl">
            <button
              type="button"
              onClick={() => toggleSelection("__all__", setter, options.length)}
              className={cls(
                "w-full px-3 py-2 text-left text-xs transition-colors",
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
                    "w-full px-3 py-2 text-left text-xs transition-colors",
                    active ? "bg-green-900/30 text-green-300" : "text-zinc-200 hover:bg-zinc-900",
                  )}
                >
                  {isPlus ? option : formatPlanetCode(option)}
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
        text: isPlus ? `Ingress ${event.body}` : `${EVENT_CODES.ingress} ${formatPlanetCode(event.body)}`,
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
          text: isPlus ? `Combustion ${event.planet}↑` : `${EVENT_CODES.combustion} ${formatPlanetCode(event.planet)}↑`,
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
          text: isPlus ? `Combustion ${event.planet}↓` : `${EVENT_CODES.combustion} ${formatPlanetCode(event.planet)}↓`,
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
          text: isPlus ? `Retro ${event.planet}↑` : `${EVENT_CODES.retro} ${formatPlanetCode(event.planet)}↑`,
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
          text: isPlus ? `Retro ${event.planet}↓` : `${EVENT_CODES.retro} ${formatPlanetCode(event.planet)}↓`,
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
        text: isPlus ? `Velocity ${event.planet}${isMax ? "↑" : "↓"}` : `${EVENT_CODES.velocity} ${formatPlanetCode(event.planet)}${isMax ? "↑" : "↓"}`,
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
        text: isPlus ? "Lagna" : EVENT_CODES.lagna,
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
        text: isPlus ? `Moon P${event.pada}` : `${EVENT_CODES.moon} P${event.pada}`,
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

  const overlayDatasets = useMemo<IndicatorDataset[]>(() => {
    const datasets: IndicatorDataset[] = [];
    orbitalSeries.forEach((series, index) => {
      const color = ORBITAL_COLORS[index % ORBITAL_COLORS.length];
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
      let minValue = Number.POSITIVE_INFINITY;
      let maxValue = Number.NEGATIVE_INFINITY;
      rawPoints.forEach((point) => {
        if (point.value < minValue) minValue = point.value;
        if (point.value > maxValue) maxValue = point.value;
      });
      if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) return;
      if (minValue === maxValue) {
        maxValue = minValue + 1;
      }
      const range = maxValue - minValue;
      const points: LineData[] = rawPoints.map((point) => ({
        time: point.time,
        value: (point.value - minValue) / range,
      }));
      datasets.push({
        name: overlayLabel(series),
        type: "line",
        pane: "price",
        priceScaleId: `orbital-${index}`,
        data: points,
        color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        useNormalizedRange: true,
      });
    });
    return datasets;
  }, [orbitalSeries, overlayLabel]);

  const overlayEventLines = useMemo<OverlayEventLine[]>(() => {
    const lines: OverlayEventLine[] = [];

    const pushLine = (time: number | null, color: string, label: string) => {
      if (time == null) return;
      lines.push({ time, color, label });
    };

    if (ingressEnabled) {
      ingressEvents.forEach((event) => {
        if (!hasSignChange(event)) return;
        if (!includePlanet(event.body, ingressPlanets)) return;
        const eventTime = toUtcSecondsFromEvent(event.timeISO, tz);
        if (eventTime == null) return;
        if (!isWithinRange(eventTime, eventRangeState)) return;
        const snapped = nearestCandle(eventTime)?.time ?? eventTime;
        pushLine(snapped, "#f97316", isPlus ? `Ingress ${event.body}` : `${EVENT_CODES.ingress} ${formatPlanetCode(event.body)}`);
      });
    }

    if (combustionEnabled) {
      combustionEvents.forEach((event) => {
        if (!includePlanet(event.planet, combustionPlanets)) return;
        const startRaw = toUtcSecondsFromEvent(event.startISO, tz);
        if (startRaw != null && isWithinRange(startRaw, eventRangeState)) {
          const snapped = nearestCandle(startRaw)?.time ?? startRaw;
          pushLine(snapped, "#ef4444", isPlus ? `Combustion ${event.planet}↑` : `${EVENT_CODES.combustion} ${formatPlanetCode(event.planet)}↑`);
        }
        const endRaw = event.endISO ? toUtcSecondsFromEvent(event.endISO, tz) : null;
        if (endRaw != null && isWithinRange(endRaw, eventRangeState)) {
          const snapped = nearestCandle(endRaw)?.time ?? endRaw;
          pushLine(snapped, "#ef4444", isPlus ? `Combustion ${event.planet}↓` : `${EVENT_CODES.combustion} ${formatPlanetCode(event.planet)}↓`);
        }
      });
    }

    if (retroEnabled) {
      retroEvents.forEach((event) => {
        if (!includePlanet(event.planet, retroPlanets)) return;
        const startRaw = toUtcSecondsFromEvent(event.startISO, tz);
        if (startRaw != null && isWithinRange(startRaw, eventRangeState)) {
          const snapped = nearestCandle(startRaw)?.time ?? startRaw;
          pushLine(snapped, "#22d3ee", isPlus ? `Retro ${event.planet}↑` : `${EVENT_CODES.retro} ${formatPlanetCode(event.planet)}↑`);
        }
        const endRaw = event.endISO ? toUtcSecondsFromEvent(event.endISO, tz) : null;
        if (endRaw != null && isWithinRange(endRaw, eventRangeState)) {
          const snapped = nearestCandle(endRaw)?.time ?? endRaw;
          pushLine(snapped, "#22d3ee", isPlus ? `Retro ${event.planet}↓` : `${EVENT_CODES.retro} ${formatPlanetCode(event.planet)}↓`);
        }
      });
    }

    if (velocityEnabled) {
      velocityEvents.forEach((event) => {
        if (!includePlanet(event.planet, velocityPlanets)) return;
        const eventTime = toUtcSecondsFromEvent(event.timeISO, tz);
        if (eventTime == null) return;
        if (!isWithinRange(eventTime, eventRangeState)) return;
        const snapped = nearestCandle(eventTime)?.time ?? eventTime;
        const suffix = event.kind === "max" ? "↑" : "↓";
        pushLine(snapped, "#a855f7", isPlus ? `Velocity ${event.planet}${suffix}` : `${EVENT_CODES.velocity} ${formatPlanetCode(event.planet)}${suffix}`);
      });
    }

    if (allowShortInterval && lagnaEnabled) {
      lagnaEvents.forEach((event) => {
        const eventTime = toUtcSecondsFromEvent(event.timeISO, tz);
        if (eventTime == null) return;
        if (!isWithinRange(eventTime, lagnaRangeState)) return;
        const snapped = nearestCandle(eventTime)?.time ?? eventTime;
        const suffix = event.degree === 15 ? " 15°" : "";
        pushLine(snapped, "#facc15", isPlus ? `Lagna${suffix}` : `${EVENT_CODES.lagna}${suffix}`);
      });
    }

    if (allowShortInterval && moonEnabled) {
      moonEvents.forEach((event) => {
        const eventTime = toUtcSecondsFromEvent(event.timeISO, tz);
        if (eventTime == null) return;
        if (!isWithinRange(eventTime, lagnaRangeState)) return;
        const snapped = nearestCandle(eventTime)?.time ?? eventTime;
        pushLine(snapped, "#38bdf8", isPlus ? `Moon P${event.pada}` : `${EVENT_CODES.moon} P${event.pada}`);
      });
    }

    console.debug("overlay event lines prepared", lines.length, lines.slice(0, 5));
    return lines;
  }, [
    allowShortInterval,
    combustionEnabled,
    combustionEvents,
    combustionPlanets,
    eventRangeState,
    includePlanet,
    ingressEnabled,
    ingressEvents,
    ingressPlanets,
    isWithinRange,
    isPlus,
    lagnaEnabled,
    lagnaEvents,
    lagnaRangeState,
    moonEnabled,
    moonEvents,
    nearestCandle,
    retroEnabled,
    retroEvents,
    retroPlanets,
    tz,
    velocityEnabled,
    velocityEvents,
    velocityPlanets,
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
    const objects = overlayObjectsInput
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0);
    if (objects.length === 0) {
      setOverlayError("Enter at least one object.");
      return;
    }
    const hasSelection =
      overlayPlotSpeed ||
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
      weights = {};
      const parts = overlayWeightsInput.split(",");
      for (const piece of parts) {
        const entry = piece.trim();
        if (!entry) continue;
        const [rawKey, rawValue] = entry.split("=", 2);
        if (!rawKey || !rawValue) {
          setOverlayError(`Invalid weight entry: ${entry}`);
          return;
        }
        const key = rawKey.trim().toLowerCase();
        const parsed = Number.parseFloat(rawValue.trim());
        if (!Number.isFinite(parsed)) {
          setOverlayError(`Invalid weight value: ${entry}`);
          return;
        }
        weights[key] = parsed;
      }
      if (Object.keys(weights).length === 0) {
        setOverlayError("Provide at least one valid weight.");
        return;
      }
    }
    setOverlayBusy(true);
    try {
      const response = await fetchOrbitalOverlay({
        objects,
        startISO,
        durationUnit: overlayDurationUnit,
        durationValue: overlayDurationValue,
        plotSpeed: overlayPlotSpeed,
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
    overlayObjectsInput,
    overlayPlotGeoDeclination,
    overlayPlotGravForce,
    overlayPlotHelioDeclination,
    overlayPlotSpeed,
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
    }, 250);

    return () => {
      window.clearTimeout(handle);
      controller.abort();
    };
  }, [symbolInput]);

  useEffect(() => {
    void loadSymbol("AAPL");
  }, [loadSymbol]);

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
        const parsed = parseCsvCandles(text);
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
    <div className="flex flex-col h-screen bg-[#050608]">
      {/* Compact Top Control Bar */}
      <div className="flex-shrink-0 border-b border-zinc-800 bg-black/50 backdrop-blur-sm">
        <div className="flex items-center justify-between px-4 py-2">
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

          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <span>
              {lastUpdated ? (
                <span className="text-zinc-300">{lastUpdated}</span>
              ) : (
                "—"
              )}
            </span>
          </div>
        </div>
      </div>

      {/* Main Content Area: Chart + Side Info */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Collapsible Controls */}
        <div className="w-80 flex-shrink-0 overflow-y-auto border-r border-zinc-800 bg-zinc-950/30 p-4 space-y-3">

          {/* Symbol & Data Section */}
          <CollapsibleSection
            title="Symbol & Data"
            icon={<TrendingUp className="h-4 w-4" />}
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
                    className="w-full rounded bg-black border border-zinc-800 px-3 py-2 text-sm outline-none focus:border-green-500 font-mono"
                    placeholder="AAPL, BTC-USD"
                    autoComplete="off"
                  />
                  {showSuggestions && (suggestions.length > 0 || searchBusy) && (
                    <div className="absolute z-10 mt-1 w-full border border-zinc-800 bg-black/95 shadow-lg rounded">
                      {searchBusy && (
                        <div className="px-3 py-2 text-xs text-zinc-500">
                          Searching…
                        </div>
                      )}
                      {suggestions.map((suggestion) => (
                        <button
                          key={`${suggestion.value}-${suggestion.label}`}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => handleSuggestionSelect(suggestion)}
                          className="flex w-full justify-between gap-4 px-3 py-2 text-left text-xs text-zinc-200 hover:bg-green-900/20 first:rounded-t last:rounded-b"
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
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5 uppercase tracking-wide">
                    Interval
                  </label>
                  <select
                    value={interval}
                    onChange={(event) =>
                      setInterval(event.target.value as Interval)
                    }
                    className="w-full rounded bg-black border border-zinc-800 px-2 py-2 text-sm outline-none focus:border-green-500 font-mono"
                  >
                    {(["5m", "15m", "1h", "4h", "1d", "1wk", "1mo", "3mo"] as const).map(
                      (opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ),
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5 uppercase tracking-wide">
                    Period
                  </label>
                  <select
                    value={period}
                    onChange={(event) =>
                      setPeriod(event.target.value as Period)
                    }
                    className="w-full rounded bg-black border border-zinc-800 px-2 py-2 text-sm outline-none focus:border-green-500 font-mono"
                  >
                    {(["5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "max"] as const).map(
                      (opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ),
                    )}
                  </select>
                </div>
              </div>

              <button
                type="submit"
                className="w-full rounded border border-green-600 bg-green-900/20 px-4 py-2 text-xs uppercase tracking-wide text-green-400 hover:bg-green-900/30 transition-colors"
                disabled={isLoading}
              >
                {isLoading ? "Loading..." : "Load Data"}
              </button>
            </form>

            <div className="mt-3 pt-3 border-t border-zinc-800">
              <label className="block text-xs text-zinc-400 mb-2 uppercase tracking-wide">
                Upload CSV
              </label>
              <label className="flex h-10 cursor-pointer items-center justify-center border border-dashed border-zinc-700 rounded text-xs text-zinc-400 hover:border-zinc-500 transition-colors">
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
            icon={<Sparkles className="h-4 w-4" />}
            defaultOpen={false}
          >
            <div className="space-y-3">
              <div className="text-xs text-zinc-400">
                {isPlus
                  ? `Event overlays (${eventLabels.ingress} · ${eventLabels.combustion} · ${eventLabels.retro} · ${eventLabels.velocity})`
                  : "Event overlays (I · C · R · V)"}
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-300">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 border border-zinc-700 bg-black accent-green-500"
                    checked={ingressEnabled}
                    onChange={(event) => setIngressEnabled(event.target.checked)}
                  />
                  <span>{eventLabels.ingress}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 border border-zinc-700 bg-black accent-green-500"
                    checked={combustionEnabled}
                    onChange={(event) => setCombustionEnabled(event.target.checked)}
                  />
                  <span>{eventLabels.combustion}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 border border-zinc-700 bg-black accent-green-500"
                    checked={retroEnabled}
                    onChange={(event) => setRetroEnabled(event.target.checked)}
                  />
                  <span>{eventLabels.retro}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 border border-zinc-700 bg-black accent-green-500"
                    checked={velocityEnabled}
                    onChange={(event) => setVelocityEnabled(event.target.checked)}
                  />
                  <span>{eventLabels.velocity}</span>
                </label>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <label className="mb-1 block text-[0.6rem] uppercase tracking-[0.3em] text-zinc-500">
                  Range start
                </label>
                <input
                  type="datetime-local"
                  value={eventRangeStart}
                  onChange={(event) => setEventRangeStart(event.target.value)}
                  className="w-full rounded-none border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-200 outline-none focus:border-green-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-[0.6rem] uppercase tracking-[0.3em] text-zinc-500">
                  Range end
                </label>
                <input
                  type="datetime-local"
                  value={eventRangeEnd}
                  onChange={(event) => setEventRangeEnd(event.target.value)}
                  className="w-full rounded-none border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-200 outline-none focus:border-green-500"
                />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
                    className="h-4 w-4 border border-zinc-700 bg-black accent-green-500"
                    checked={lagnaEnabled}
                    onChange={(event) => setLagnaEnabled(event.target.checked)}
                    disabled={!allowShortInterval}
                  />
                  <span className={!allowShortInterval ? "text-zinc-600" : undefined}>
                    {isPlus ? "Lagna changes" : "L"}
                  </span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 border border-zinc-700 bg-black accent-green-500"
                    checked={moonEnabled}
                    onChange={(event) => setMoonEnabled(event.target.checked)}
                    disabled={!allowShortInterval}
                  />
                  <span className={!allowShortInterval ? "text-zinc-600" : undefined}>
                    {isPlus ? "Moon nakshatra" : "NAK"}
                  </span>
                </label>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <label className="mb-1 block text-[0.6rem] uppercase tracking-[0.3em] text-zinc-500">
                    {isPlus ? "Lagna start" : "L start"}
                  </label>
                  <input
                    type="datetime-local"
                    value={lagnaRangeStart}
                    onChange={(event) => setLagnaRangeStart(event.target.value)}
                    className="w-full rounded-none border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-200 outline-none focus:border-green-500 disabled:border-zinc-800 disabled:text-zinc-600"
                    disabled={!allowShortInterval}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[0.6rem] uppercase tracking-[0.3em] text-zinc-500">
                    {isPlus ? "Lagna end" : "L end"}
                  </label>
                  <input
                    type="datetime-local"
                    value={lagnaRangeEnd}
                    onChange={(event) => setLagnaRangeEnd(event.target.value)}
                    className="w-full rounded-none border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-200 outline-none focus:border-green-500 disabled:border-zinc-800 disabled:text-zinc-600"
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

          <div className="mt-6 border-t border-zinc-900 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[0.6rem] uppercase tracking-[0.3em] text-zinc-500">
                  {isPlus ? "Orbital overlay" : "Orbit overlay"}
                </div>
                <div className="text-[0.65rem] text-zinc-500">
                  {isPlus
                    ? "Plot orbital metrics as lines on the price chart."
                    : "Add orbital lines over the price chart."}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => void handleOverlaySubmit()}
                  className={`${baseControlClasses} ${
                    overlayBusy ? "border-zinc-800 bg-zinc-900 text-zinc-500" : activeControlClasses
                  }`}
                  disabled={overlayBusy}
                >
                  {overlayBusy ? (isPlus ? "Computing…" : "Working…") : isPlus ? "Compute overlay" : "Compute"}
                </button>
                <button
                  type="button"
                  onClick={handleOverlayClear}
                  className={`${baseControlClasses} ${defaultControlClasses}`}
                  disabled={overlayBusy || orbitalSeries.length === 0}
                >
                  {isPlus ? "Clear overlay" : "Clear"}
                </button>
              </div>
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-3">
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-[0.6rem] uppercase tracking-[0.3em] text-zinc-500">
                    {isPlus ? "Objects" : "Bodies"}
                  </label>
                  <input
                    type="text"
                    value={overlayObjectsInput}
                    onChange={(event) => setOverlayObjectsInput(event.target.value)}
                    className="w-full rounded-none border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-200 outline-none focus:border-green-500"
                    placeholder={isPlus ? "mercury, venus, mars" : "mercury, venus"}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[0.6rem] uppercase tracking-[0.3em] text-zinc-500">
                      {isPlus ? "Start date" : "Start"}
                    </label>
                    <input
                      type="date"
                      value={overlayStartDate}
                      onChange={(event) => setOverlayStartDate(event.target.value)}
                      className="w-full rounded-none border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-200 outline-none focus:border-green-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[0.6rem] uppercase tracking-[0.3em] text-zinc-500">
                      {isPlus ? "Units" : "Units"}
                    </label>
                    <select
                      value={overlayDurationUnit}
                      onChange={(event) =>
                        setOverlayDurationUnit(event.target.value as DurationUnit)
                      }
                      className="w-full rounded-none border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-200 outline-none focus:border-green-500"
                    >
                      {(["years", "months", "weeks", "days"] as const).map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-[0.6rem] uppercase tracking-[0.3em] text-zinc-500">
                    {isPlus ? "Number of units" : "# units"}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={1460}
                    value={overlayDurationValue}
                    onChange={(event) => setOverlayDurationValue(Number(event.target.value) || 0)}
                    className="w-full rounded-none border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-200 outline-none focus:border-green-500"
                  />
                </div>
              </div>
              <div className="space-y-2 text-xs text-zinc-300">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 border border-zinc-700 bg-black accent-green-500"
                    checked={overlayPlotSpeed}
                    onChange={(event) => setOverlayPlotSpeed(event.target.checked)}
                    disabled={overlayUsesWeights}
                  />
                  <span>{isPlus ? "Orbital speed" : "Speed"}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 border border-zinc-700 bg-black accent-green-500"
                    checked={overlayPlotGravForce}
                    onChange={(event) => setOverlayPlotGravForce(event.target.checked)}
                    disabled={overlayUsesWeights}
                  />
                  <span>{isPlus ? "Gravitational force" : "Force"}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 border border-zinc-700 bg-black accent-green-500"
                    checked={overlayPlotGeoDeclination}
                    onChange={(event) => setOverlayPlotGeoDeclination(event.target.checked)}
                    disabled={overlayUsesWeights}
                  />
                  <span>{isPlus ? "Geo declination" : "GD"}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 border border-zinc-700 bg-black accent-green-500"
                    checked={overlayPlotHelioDeclination}
                    onChange={(event) => setOverlayPlotHelioDeclination(event.target.checked)}
                    disabled={overlayUsesWeights}
                  />
                  <span>{isPlus ? "Helio declination" : "HD"}</span>
                </label>
              </div>
              <div className="space-y-2 text-xs text-zinc-300">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 border border-zinc-700 bg-black accent-green-500"
                    checked={overlayPlotWeightedGeo}
                    onChange={(event) => setOverlayPlotWeightedGeo(event.target.checked)}
                    disabled={overlayHasStandard}
                  />
                  <span>{isPlus ? "Weighted geo declination" : "W-GD"}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 border border-zinc-700 bg-black accent-green-500"
                    checked={overlayPlotWeightedHelio}
                    onChange={(event) => setOverlayPlotWeightedHelio(event.target.checked)}
                    disabled={overlayHasStandard}
                  />
                  <span>{isPlus ? "Weighted helio declination" : "W-HD"}</span>
                </label>
                <div>
                  <label className="mb-1 block text-[0.6rem] uppercase tracking-[0.3em] text-zinc-500">
                    {isPlus ? "Weights" : "Weights"}
                  </label>
                  <input
                    type="text"
                    value={overlayWeightsInput}
                    onChange={(event) => setOverlayWeightsInput(event.target.value)}
                    className="w-full rounded-none border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-200 outline-none focus:border-green-500 disabled:border-zinc-800 disabled:text-zinc-600"
                    disabled={!overlayUsesWeights}
                    placeholder={isPlus ? "mercury=6, venus=5" : "mercury=6,…"}
                  />
                  <div className="mt-1 text-[0.6rem] text-zinc-500">
                    {isPlus
                      ? "Weighted mode ignores the other series toggles."
                      : "Weighted mode ignores other toggles."}
                  </div>
                </div>
              </div>
            </div>
            {overlayError && (
              <div className="mt-3 text-xs text-red-400">{overlayError}</div>
            )}
            {!overlayError && orbitalSeries.length > 0 && (
              <div className="mt-3 text-xs text-green-400">
                {isPlus
                  ? `${orbitalSeries.length} overlay series ready.`
                  : `${orbitalSeries.length} overlays ready.`}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-4">
            <div className="xl:col-span-3 h-[520px]">
              <ChartContainer
                ref={chartHandleRef}
                candles={candles}
                overlays={overlayDatasets}
                markers={markers}
                eventLines={overlayEventLines}
                onCrosshairMove={setHoverCandle}
                className="h-full"
                isLoading={isLoading}
                showVolume={showVolume}
                drawingTool={drawingTool}
              />
            </div>
            <div className="space-y-4">
              <div>
                <div className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                  Active time
                </div>
                <div className="mt-1 font-mono text-sm text-zinc-200">
                  {activeTimeLabel}
                </div>
              </div>
              <div className="space-y-2">
                {infoRows.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between border-b border-zinc-900 pb-1 text-xs"
                  >
                    <span className="text-zinc-500 uppercase tracking-[0.3em]">
                      {row.label}
                    </span>
                    <span className="text-zinc-200">{row.value}</span>
                  </div>
                ))}
              </div>
              <div className="text-xs text-zinc-500 space-y-1">
                <div>
                  Hover the chart to inspect a specific candle. Upload data to
                  replace the live feed temporarily.
                </div>
                <div className={drawingActive ? "text-orange-300" : ""}>
                  {drawingActive
                    ? "Drawing mode active — click two points to place a trend line."
                    : "Toggle Draw to add simple trend lines; use Clear to remove them."}
                </div>
              </div>
            </div>
          </div>
        </div>
      </Pane>

      <Pane title="DATA STATUS">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-zinc-500">
              Symbol
            </div>
            <div className="mt-1 font-mono text-sm text-zinc-200">
              {activeSymbol || "—"}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-zinc-500">
              Candles
            </div>
            <div className="mt-1 font-mono text-sm text-zinc-200">
              {candles.length}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-zinc-500">
              Source
            </div>
            <div className="mt-1 font-mono text-sm text-zinc-200">
              {uploadName ? "CSV upload" : "Backend feed"}
            </div>
          </div>
        </div>
      </Pane>
    </div>
  );
}
