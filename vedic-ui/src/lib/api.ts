export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Interval =
  | "5m"
  | "15m"
  | "1h"
  | "4h"
  | "1d"
  | "1wk"
  | "1mo"
  | "3mo";

export type Period = "5d" | "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y" | "max";

const DEFAULT_PERIOD: Period = "1y";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") ?? "http://localhost:8000";

function toQuery(params: Record<string, string | number | undefined>) {
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    usp.set(key, String(value));
  });
  return usp.toString();
}

export async function fetchOHLC({
  symbol,
  interval,
  period = DEFAULT_PERIOD,
}: {
  symbol: string;
  interval: Interval;
  period?: Period;
}): Promise<Candle[]> {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) {
    throw new Error("Symbol is required");
  }

  const qs = toQuery({ symbol: normalized, interval, period });
  const response = await fetch(`${API_BASE}/api/ohlc?${qs}`, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Request failed (${response.status}): ${detail || response.statusText}`,
    );
  }

  const data = (await response.json()) as Candle[];
  return data;
}

type SwissHorizonRequest = {
  lat: number;
  lon: number;
  tz: string;
  startLocalISO: string;
  ascHours: number;
  moonDays: number;
};

export type SwissHorizonResponse = {
  ok: boolean;
  lagnaRows?: { timeISO: string; from: string; to: string; degree: number }[];
  moonRows?: { timeISO: string; nakshatra: string; pada: number; midpoint?: boolean }[];
  notes?: string[];
  swissAvailable?: boolean;
  error?: string;
};

type SwissMonthlyRequest = {
  lat: number;
  lon: number;
  tz: string;
  monthStartISO: string;
};

export type SwissMonthlyResponse = {
  ok: boolean;
  moonMonthlyRows?: { timeISO: string; nakshatra: string; pada: number; midpoint?: boolean }[];
  sunRows?: { timeISO: string; from: string; to: string }[];
  otherIngressRows?: { body: string; from: string; to: string; timeISO: string }[];
  stationRows?: { planet: string; state: string; startISO: string; endISO: string | null }[];
  combRows?: { startISO: string; endISO: string | null; planet: string; orbDeg: number }[];
  velocityRows?: { planet: string; kind: string; timeISO: string; speed: number }[];
  swissAvailable?: boolean;
  error?: string;
};

async function postSwiss<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = (await response.text()) || response.statusText;
    throw new Error(`Swiss request failed (${response.status}): ${detail}`);
  }

  const data = (await response.json()) as T & { ok?: boolean; error?: string };
  if (typeof data === "object" && data !== null && "ok" in data && data.ok === false) {
    const err = (data as { error?: string }).error;
    throw new Error(err || "Swiss request returned ok=false");
  }
  return data;
}

export async function fetchSwissHorizon(
  payload: SwissHorizonRequest,
): Promise<SwissHorizonResponse> {
  return postSwiss<SwissHorizonResponse>("/api/swiss/horizon", payload);
}

export async function fetchSwissMonthly(
  payload: SwissMonthlyRequest,
): Promise<SwissMonthlyResponse> {
  return postSwiss<SwissMonthlyResponse>("/api/swiss/monthly", payload);
}

type SwissMonthlyBatchRequest = {
  lat: number;
  lon: number;
  tz: string;
  monthStartISOs: string[];
};

export type SwissMonthlyBatchResponse = {
  ok: boolean;
  months: Record<string, SwissMonthlyResponse>;
};

export async function fetchSwissMonthlyBatch(
  payload: SwissMonthlyBatchRequest,
): Promise<SwissMonthlyBatchResponse> {
  return postSwiss<SwissMonthlyBatchResponse>("/api/swiss/monthly/batch", payload);
}

export type OrbitalOverlayRequest = {
  objects: string[];
  startISO: string;
  durationUnit: "years" | "months" | "weeks" | "days";
  durationValue: number;
  plotSpeed?: boolean;
  plotGravForce: boolean;
  plotGeoDeclination: boolean;
  plotHelioDeclination: boolean;
  plotWeightedGeo: boolean;
  plotWeightedHelio: boolean;
  weights?: Record<string, number>;
};

export type OrbitalOverlaySeries = {
  name: string;
  key: string;
  objects: string[];
  timestamps: string[];
  values: number[];
};

export type OrbitalOverlayResponse = {
  series: OrbitalOverlaySeries[];
};

export async function fetchOrbitalOverlay(
  payload: OrbitalOverlayRequest,
): Promise<OrbitalOverlayResponse> {
  const response = await fetch(`${API_BASE}/api/orbit/overlay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = (await response.text()) || response.statusText;
    throw new Error(`Orbital overlay failed (${response.status}): ${detail}`);
  }

  const data = (await response.json()) as OrbitalOverlayResponse;
  return data;
}

export type PlanetaryTimeseriesRequest = {
  planet: string;
  timestamps: number[];
};

export type PlanetaryTimeseriesDataPoint = {
  time: number;
  longitude: number;
};

export type PlanetaryTimeseriesResponse = {
  ok: boolean;
  data: PlanetaryTimeseriesDataPoint[];
};

export async function fetchPlanetaryTimeseries(
  payload: PlanetaryTimeseriesRequest,
): Promise<PlanetaryTimeseriesResponse> {
  const response = await fetch(`${API_BASE}/api/planetary/timeseries`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = (await response.text()) || response.statusText;
    throw new Error(`Planetary timeseries failed (${response.status}): ${detail}`);
  }

  const data = (await response.json()) as PlanetaryTimeseriesResponse;
  return data;
}
