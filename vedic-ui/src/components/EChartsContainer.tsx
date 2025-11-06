/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  memo,
} from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption, XAXisComponentOption } from "echarts";
import * as echarts from "echarts";
import type { Candle } from "@/lib/api";
import type { IndicatorDataset } from "@/lib/indicators";

const TIMELINE_PADDING_MS = 30 * 24 * 60 * 60 * 1000; // ~1 month padding at chart end

export type OverlayEventLine = {
  time: number;
  color: string;
  label?: string;
};

export type EChartsContainerHandle = {
  autoscale: () => void;
  clearDrawings: () => void;
  setVisibleRange: (range: { start: number | null; end: number | null } | null) => void;
};

export type PlanetaryLineSeries = {
  name?: string;
  data: Array<{ time: number; value: number }>;
  color?: string;
  opacity?: number;
  dash?: boolean;
  width?: number;
};

type DeclinationSeriesMeta = {
  name: string;
  color: string;
  points: Array<{ time: number; value: number; index: number }>;
  kind: StageSeriesKind;
};

type StageSeriesKind = "declination" | "speed" | "force";
type DragMode = "xPan" | "yZoom" | "freePan" | "yAxisScale" | "xAxisScale";

type StageReading = {
  name: string;
  color: string;
  value: number | null;
  kind: StageSeriesKind;
};

type Throttled<T extends (...args: any[]) => void> = ((...args: Parameters<T>) => void) & {
  cancel: () => void;
};

function throttle<T extends (...args: any[]) => void>(fn: T, wait: number): Throttled<T> {
  let lastCall = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: Parameters<T> | null = null;

  const invoke = (args: Parameters<T>) => {
    lastCall = Date.now();
    fn(...args);
  };

  const throttled = (...args: Parameters<T>) => {
    const now = Date.now();
    const remaining = wait - (now - lastCall);
    if (remaining <= 0 || remaining > wait) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      invoke(args);
    } else {
      pendingArgs = args;
      if (!timeoutId) {
        timeoutId = setTimeout(() => {
          timeoutId = null;
          if (pendingArgs) {
            invoke(pendingArgs);
            pendingArgs = null;
          }
        }, remaining);
      }
    }
  };

  throttled.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    pendingArgs = null;
  };

  return throttled as Throttled<T>;
}

function computeKindRange(
  meta: DeclinationSeriesMeta[],
  kind: StageSeriesKind,
  zoom: number | undefined
) {
  const values: number[] = [];
  meta.forEach((series) => {
    if (series.kind !== kind) return;
    series.points.forEach((pt) => {
      if (Number.isFinite(pt.value)) values.push(pt.value);
    });
  });
  if (!values.length) return null;
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.1, 1);
    min -= pad;
    max += pad;
  } else {
    const span = max - min;
    const pad = span * 0.1;
    min -= pad;
    max += pad;
  }
  const factor = Math.min(Math.max(zoom ?? 1, 0.01), 5);
  if (factor !== 1) {
    const span = max - min;
    const mid = (max + min) / 2;
    const half = (span * factor) / 2;
    min = mid - half;
    max = mid + half;
  }
  return { min, max };
}

type EChartsContainerProps = {
  candles: Candle[];
  overlays: IndicatorDataset[];
  onCrosshairMove?: (payload: Candle | null) => void;
  onVisibleRangeChange?: (range: { start: number | null; end: number | null }) => void;
  onReady?: () => void;
  className?: string;
  isLoading?: boolean;
  showVolume: boolean;
  drawingTool: "trendline" | null;
  eventLines?: OverlayEventLine[];
  planetaryLineSeries?: PlanetaryLineSeries[];
  stageZoom?: { speed?: number; force?: number };
};

const upColor = "#4ade80";
const downColor = "#f87171";
const backgroundColor = "#000000";

const DECLINATION_LEVELS = [
  { value: 0, color: "#22c55e", label: "0°" },
  { value: 23.43, color: "#fb923c", label: "+23.43°" },
  { value: -23.43, color: "#fb923c", label: "-23.43°" },
  { value: 16.37, color: "#38bdf8", label: "+16.37°" },
  { value: -16.37, color: "#38bdf8", label: "-16.37°" },
];

function buildCandlesByDate(candles: Candle[]): Map<string, Candle> {
  const map = new Map<string, Candle>();
  candles.forEach((candle) => {
    if (!candle) return;
    const iso = new Date(candle.time * 1000).toISOString().slice(0, 10);
    if (!map.has(iso)) map.set(iso, candle);
  });
  return map;
}

function computeCrossings(points: Array<{ time: number; value: number }>, target: number): number[] {
  const results: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const prevDelta = prev.value - target;
    const currDelta = curr.value - target;
    if (prevDelta === 0) {
      results.push(prev.time);
      continue;
    }
    const crosses = prevDelta <= 0 ? currDelta >= 0 : currDelta <= 0;
    if (crosses && curr.value !== prev.value) {
      const ratio = (target - prev.value) / (curr.value - prev.value);
      const interpolated = prev.time + ratio * (curr.time - prev.time);
      results.push(interpolated);
    }
  }
  return results;
}

const EChartsContainerBase = forwardRef<EChartsContainerHandle, EChartsContainerProps>(
  function EChartsContainer(props, ref) {
    const {
      candles,
      overlays,
      onCrosshairMove,
      onVisibleRangeChange,
      onReady,
      className,
      isLoading,
      showVolume,
      drawingTool,
      eventLines,
      planetaryLineSeries: _planetaryLineSeries,
      stageZoom,
    } = props;

    const prevPropsRef = useRef<EChartsContainerProps | null>(null);
    useEffect(() => {
      const prevProps = prevPropsRef.current;
      if (prevProps) {
        const changedProps = Object.keys(props).filter(
          (key) =>
            prevProps[key as keyof EChartsContainerProps] !==
            props[key as keyof EChartsContainerProps]
        );
        if (changedProps.length > 0) {
          const noisyProps = new Set([
            "planetaryLineSeries",
            "eventLines",
            "isLoading",
            "candles",
            "overlays",
            "onVisibleRangeChange",
            "onReady",
          ]);
          const significantChanges = changedProps.filter((prop) => !noisyProps.has(prop));
          if (significantChanges.length > 0) {
            console.debug("[Chart rebuilt] Props changed:", significantChanges);
          } else {
            console.debug("[FYI] Chart props changed on expected keys:", changedProps);
          }
        }
      }
      prevPropsRef.current = props;
    });

    const containerRef = useRef<HTMLDivElement | null>(null);
    const stageChartRef = useRef<ReactECharts>(null);
    const priceChartRef = useRef<ReactECharts>(null);
    const [priceChartReadyVersion, setPriceChartReadyVersion] = useState(0);
    const drawingLinesRef = useRef<any[]>([]);
    const pendingPointRef = useRef<{ time: number; value: number } | null>(null);
    const manualYAxisRangeRef = useRef<{ min: number; max: number } | null>(null);
    const manualXAxisRangeRef = useRef<{ min: number; max: number } | null>(null);
    const pointerInsideGridRef = useRef(false);
    const axisHoverStateRef = useRef<"x" | "y" | null>(null);

    // Guards for sync to avoid recursion
    const syncingPointerRef = useRef(false);
    const syncingZoomRef = useRef(false);
    const suppressRangeCallbackRef = useRef(false);
    const lastEmittedRangeRef = useRef<{ start: number | null; end: number | null } | null>(null);

    const emitVisibleRange = useCallback(
      (startValueMs: number | null | undefined, endValueMs: number | null | undefined) => {
        if (!onVisibleRangeChange) return;
        if (suppressRangeCallbackRef.current) return;

        const normalizedStart =
          typeof startValueMs === "number" && Number.isFinite(startValueMs)
            ? Math.round(startValueMs / 1000)
            : null;
        const normalizedEnd =
          typeof endValueMs === "number" && Number.isFinite(endValueMs)
            ? Math.round(endValueMs / 1000)
            : null;

        let start = normalizedStart;
        let end = normalizedEnd;
        if (start != null && end != null && start > end) {
          [start, end] = [end, start];
        }

        const previous = lastEmittedRangeRef.current;
        if (previous && previous.start === start && previous.end === end) {
          return;
        }

        lastEmittedRangeRef.current = { start, end };
        onVisibleRangeChange({ start, end });
      },
      [onVisibleRangeChange],
    );

    const dragStateRef = useRef<{
      mode: DragMode | null;
      preferredMode: DragMode | null;
      modeResolved: boolean;
      active: boolean;
      startX: number;
      startY: number;
      startXAxisRange: { min: number; max: number } | null;
      startYAxisRange: { min: number; max: number } | null;
      anchorPrice: number | null;
      axisSide: 1 | -1 | null;
    }>({
      mode: null,
      preferredMode: null,
      modeResolved: false,
      active: false,
      startX: 0,
      startY: 0,
      startXAxisRange: null,
      startYAxisRange: null,
      anchorPrice: null,
      axisSide: null,
    });

    const stageSeriesMeta = useMemo<DeclinationSeriesMeta[]>(() => {
      const palette = ["#38bdf8", "#f472b6", "#facc15", "#a855f7", "#22d3ee", "#fb7185", "#f59e0b"];
      const meta: DeclinationSeriesMeta[] = [];
      overlays
        .filter(
          (overlay): overlay is Extract<IndicatorDataset, { type: "line" }> =>
            overlay.pane === "orbital" && overlay.type === "line"
        )
        .forEach((overlay, index) => {
          const color = overlay.color ?? palette[index % palette.length];
          const kind: StageSeriesKind = overlay.valueKind
            ? overlay.valueKind
            : (overlay as any).useDeclinationScale
            ? "declination"
            : "speed";
          const points = overlay.data
            .map((item, pointIndex) => ({
              time: Number(item.time) * 1000,
              value: item.value,
              index: pointIndex,
            }))
            .sort((a, b) => a.time - b.time);
          meta.push({
            name: overlay.name ?? `Series ${index + 1}`,
            color,
            points,
            kind,
          });
        });
      return meta;
    }, [overlays]);

    const axisIndexByKind = useMemo(() => {
      const mapping: Partial<Record<StageSeriesKind, number>> = {};
      let idx = 0;
      if (stageSeriesMeta.some((series) => series.kind === "declination")) {
        mapping.declination = idx++;
      }
      if (stageSeriesMeta.some((series) => series.kind === "speed")) {
        mapping.speed = idx++;
      }
      if (stageSeriesMeta.some((series) => series.kind === "force")) {
        mapping.force = idx++;
      }
      return mapping;
    }, [stageSeriesMeta]);

    const timelineSeconds = useMemo(() => {
      const set = new Set<number>();
      candles.forEach((candle) => {
        if (candle && Number.isFinite(candle.time)) set.add(Math.floor(candle.time));
      });
      stageSeriesMeta.forEach((series) => {
        series.points.forEach((pt) => {
          if (Number.isFinite(pt.time)) set.add(Math.round(pt.time / 1000));
        });
      });
      if (_planetaryLineSeries) {
        _planetaryLineSeries.forEach((series) => {
          series.data.forEach((point) => {
            if (point && Number.isFinite(point.time)) set.add(Math.round(point.time / 1000));
          });
        });
      }
      if (eventLines) {
        eventLines.forEach((line) => {
          if (line && Number.isFinite(line.time)) set.add(Math.round(line.time));
        });
      }
      return Array.from(set).sort((a, b) => a - b);
    }, [stageSeriesMeta, candles, _planetaryLineSeries, eventLines]);

    const speedRange = useMemo(
      () => computeKindRange(stageSeriesMeta, "speed", stageZoom?.speed),
      [stageSeriesMeta, stageZoom?.speed]
    );
    const forceRange = useMemo(
      () => computeKindRange(stageSeriesMeta, "force", stageZoom?.force),
      [stageSeriesMeta, stageZoom?.force]
    );

    const timelineMs = useMemo(() => timelineSeconds.map((sec) => sec * 1000), [timelineSeconds]);
    const timelineStartMs = useMemo(
      () => (timelineMs.length ? timelineMs[0] : null),
      [timelineMs]
    );
    const timelineEndMs = useMemo(
      () => (timelineMs.length ? timelineMs[timelineMs.length - 1] : null),
      [timelineMs]
    );
    const paddedTimelineEndMs = useMemo(
      () => (timelineEndMs != null ? timelineEndMs + TIMELINE_PADDING_MS : null),
      [timelineEndMs]
    );
    const futureScaffoldSeries = useMemo(() => {
      if (!candles.length || !timelineMs.length) return [];
      const validTimes = candles
        .map((candle) => (Number.isFinite(candle.time) ? candle.time * 1000 : null))
        .filter((ms): ms is number => ms != null)
        .sort((a, b) => a - b);
      if (!validTimes.length) return [];
      const firstCandleMs = validTimes[0];
      const lastCandleMs = validTimes[validTimes.length - 1];
      const maxTimelineMs = timelineMs[timelineMs.length - 1];
      if (!Number.isFinite(maxTimelineMs) || maxTimelineMs <= lastCandleMs) return [];
      return timelineMs
        .filter((ms) => ms >= firstCandleMs && ms <= maxTimelineMs)
        .map((ms) => [ms, null]);
    }, [candles, timelineMs]);

    const minTimelineStep = useMemo(() => {
      if (timelineMs.length < 2) return 60_000;
      let min = Number.POSITIVE_INFINITY;
      for (let i = 1; i < timelineMs.length; i += 1) {
        const diff = timelineMs[i] - timelineMs[i - 1];
        if (Number.isFinite(diff) && diff > 0) min = Math.min(min, diff);
      }
      return Number.isFinite(min) ? min : 60_000;
    }, [timelineMs]);

    const candleByDate = useMemo(() => buildCandlesByDate(candles), [candles]);

    const { priceSeries, volumeSeries, priceLookupByMs } = useMemo(() => {
      const lookup = new Map<
        number,
        {
          actual: Candle | null;
          carried: Candle | null;
        }
      >();
      const price: Array<[number, number | null, number | null, number | null, number | null]> = [];
      const volume: Array<[number, number | null, string]> = [];

      if (timelineSeconds.length === 0) {
        const sorted = candles.slice().sort((a, b) => a.time - b.time);
        sorted.forEach((candle) => {
          const ms = candle.time * 1000;
          price.push([ms, candle.open, candle.close, candle.low, candle.high]);
          volume.push([ms, candle.volume ?? 0, candle.close >= candle.open ? upColor : downColor]);
          lookup.set(ms, { actual: candle, carried: candle });
        });
        return { priceSeries: price, volumeSeries: volume, priceLookupByMs: lookup };
      }

      let lastActual: Candle | null = null;

      timelineSeconds.forEach((seconds) => {
        const ms = seconds * 1000;
        const iso = new Date(ms).toISOString().slice(0, 10);
        const actual = candleByDate.get(iso) ?? null;
        if (actual) {
          lastActual = actual;
          price.push([ms, actual.open, actual.close, actual.low, actual.high]);
          volume.push([ms, actual.volume ?? 0, actual.close >= actual.open ? upColor : downColor]);
          lookup.set(ms, { actual, carried: actual });
          return;
        }

        const carried = lastActual;
        price.push([ms, null, null, null, null]);
        volume.push([ms, null, upColor]);
        lookup.set(ms, { actual: null, carried });
      });

      return { priceSeries: price, volumeSeries: volume, priceLookupByMs: lookup };
    }, [timelineSeconds, candles, candleByDate]);

    const planetarySeriesFingerprint = useMemo(() => {
      if (!_planetaryLineSeries || !_planetaryLineSeries.length) return "none";
      return _planetaryLineSeries
        .map((series) => {
          const len = series.data?.length ?? 0;
          const first = len ? series.data[0] : null;
          const last = len ? series.data[len - 1] : null;
          return [
            series.name ?? "",
            len,
            first?.time ?? 0,
            first?.value ?? 0,
            last?.time ?? 0,
            last?.value ?? 0,
          ].join(":");
        })
        .join("|");
    }, [_planetaryLineSeries]);

    const planetarySeries = useMemo(() => {
      if (!_planetaryLineSeries || _planetaryLineSeries.length === 0) return [];
      const palette = ["#38bdf8", "#f472b6", "#facc15", "#34d399", "#a855f7", "#fb923c", "#22d3ee"];
      return _planetaryLineSeries.map((series, index) => {
        const color = series.color ?? palette[index % palette.length];
        const opacity =
          series.opacity ?? (index === 0 ? 0.95 : Math.max(0.3, 0.75 - index * 0.05));
        const width = series.width ?? (index === 0 ? 2 : 1.2);
        const lineType = series.dash ? "dashed" : "solid";
        return {
          name: series.name ?? `Planetary ${index + 1}`,
          type: "line" as const,
          data: series.data.map((point) => [point.time, point.value]),
          xAxisIndex: 0,
          yAxisIndex: 0,
          showSymbol: false,
          smooth: false,
          lineStyle: { color, opacity, width, type: lineType },
          emphasis: { focus: "series" },
          z: 20 + index,
        };
      });
    }, [_planetaryLineSeries]);

    useEffect(() => {
      manualYAxisRangeRef.current = null;
      manualXAxisRangeRef.current = null;
    }, [priceSeries, timelineMs]);

    const stageSeries = useMemo(() => {
      return stageSeriesMeta.map((series) => ({
        name: series.name,
        type: "line" as const,
        data: series.points.map((pt) => [pt.time, pt.value]),
        smooth: series.kind === "declination",
        showSymbol: false,
        animation: false,
        yAxisIndex: axisIndexByKind[series.kind] ?? 0,
        lineStyle: {
          color: series.color,
          width: 2,
          opacity: series.kind === "declination" ? 0.95 : 0.75,
        },
        emphasis: { focus: "series" },
        __kind: series.kind,
      }));
    }, [stageSeriesMeta, axisIndexByKind]);

    const stageMarkLines = useMemo(() => {
      const primary = stageSeriesMeta.find((series) => series.kind === "declination");
      if (!primary || primary.points.length === 0) return [];
      const verticals: any[] = [];
      DECLINATION_LEVELS.forEach((level) => {
        const times = computeCrossings(primary.points, level.value);
        times.forEach((time) => {
          verticals.push({
            xAxis: time,
            lineStyle: { color: level.color, type: "dashed" as const, width: 1.2, opacity: 0.85 },
            label: {
              formatter: new Date(time).toLocaleDateString(),
              color: "#e2e8f0",
              rotate: 90,
              position: "end" as const,
              fontSize: 10,
            },
          });
        });
      });

      const horizontals = DECLINATION_LEVELS.map((level) => ({
        yAxis: level.value,
        lineStyle: { color: level.color, type: "dashed" as const, width: 1.2, opacity: 0.5 },
        label: { show: false },
      }));

      return [...horizontals, ...verticals];
    }, [stageSeriesMeta]);

    const xAxisMin = useMemo(
      () => (timelineStartMs != null ? timelineStartMs : undefined),
      [timelineStartMs]
    );
    const xAxisMax = useMemo(
      () =>
        paddedTimelineEndMs != null
          ? paddedTimelineEndMs
          : timelineEndMs != null
          ? timelineEndMs
          : undefined,
      [paddedTimelineEndMs, timelineEndMs]
    );

    const computeStageReadings = useCallback(
      (axisMs: number): StageReading[] =>
        stageSeriesMeta.map((series) => {
          const points = series.points;
          if (!points.length)
            return { name: series.name, color: series.color, value: null, kind: series.kind };
          let left = 0;
          let right = points.length - 1;
          while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const t = points[mid].time;
            if (t === axisMs) {
              return { name: series.name, color: series.color, value: points[mid].value, kind: series.kind };
            }
            if (t < axisMs) left = mid + 1;
            else right = mid - 1;
          }
          const before = right >= 0 ? points[right] : null;
          const after = left < points.length ? points[left] : null;
          let interpolated: number | null = null;
          if (before && after && before.time !== after.time) {
            const ratio = (axisMs - before.time) / (after.time - before.time);
            interpolated = before.value + ratio * (after.value - before.value);
          } else if (before) {
            interpolated = before.value;
          } else if (after) {
            interpolated = after.value;
          }
          return { name: series.name, color: series.color, value: interpolated, kind: series.kind };
        }),
      [stageSeriesMeta]
    );

    const hasStage = stageSeriesMeta.length > 0;

    const stageOption: EChartsOption = useMemo(() => {
      const declIndex = axisIndexByKind.declination;
      const speedIndex = axisIndexByKind.speed;
      const forceIndex = axisIndexByKind.force;

      const yAxes: any[] = [];
      if (declIndex !== undefined) {
        yAxes.push({
          type: "value",
          position: "left",
          min: -30,
          max: 30,
          interval: 5,
          axisLine: { lineStyle: { color: "#4b5563" } },
          axisTick: { show: true },
          axisLabel: {
            color: "#cbd5e1",
            fontSize: 11,
            formatter: (value: number) => `${value.toFixed(0)}°`,
          },
          splitLine: { lineStyle: { color: "#27272a", type: "dashed" } },
          name: "Declination (°)",
          nameTextStyle: { color: "#cbd5e1" },
        });
      }

      if (speedIndex !== undefined && speedRange) {
        yAxes.push({
          type: "value",
          position: declIndex !== undefined ? "right" : "left",
          offset: 0,
          min: speedRange.min,
          max: speedRange.max,
          axisLine: { lineStyle: { color: "#38bdf8" } },
          axisTick: { show: true },
          axisLabel: {
            color: "#38bdf8",
            formatter: (value: number) => {
              const span = speedRange.max - speedRange.min;
              return span < 1 ? value.toFixed(4) : value.toFixed(2);
            },
          },
          splitLine: { show: false },
          name: "Speed (m/s)",
          nameTextStyle: { color: "#38bdf8" },
        });
      }

      if (forceIndex !== undefined && forceRange) {
        const offset = speedIndex !== undefined ? 60 : 0;
        yAxes.push({
          type: "value",
          position: declIndex !== undefined ? "right" : speedIndex !== undefined ? "right" : "left",
          offset,
          min: forceRange.min,
          max: forceRange.max,
          axisLine: { lineStyle: { color: "#f97316" } },
          axisTick: { show: true },
          axisLabel: {
            color: "#f97316",
            formatter: (value: number) => {
              const span = forceRange.max - forceRange.min;
              return span < 1 ? value.toFixed(4) : value.toFixed(2);
            },
          },
          splitLine: { show: false },
          name: "Gravity (N)",
          nameTextStyle: { color: "#f97316" },
        });
      }

      const finalYAxes = yAxes.length
        ? yAxes
        : [
            {
              type: "value",
              position: "left",
              min: -30,
              max: 30,
              interval: 5,
              axisLine: { lineStyle: { color: "#4b5563" } },
              axisTick: { show: true },
              axisLabel: {
                color: "#cbd5e1",
                fontSize: 11,
                formatter: (value: number) => `${value.toFixed(0)}°`,
              },
              splitLine: { lineStyle: { color: "#27272a", type: "dashed" } },
            },
          ];

      let declAttached = false;
      const stageSeriesForOption: any[] =
        stageSeries.length === 0
          ? []
          : stageSeries.map((series) => {
              const { __kind, ...rest } = series as any;
              if (__kind === "declination" && stageMarkLines.length && !declAttached) {
                declAttached = true;
                (rest as any).markLine = { symbol: "none", silent: true, data: stageMarkLines };
              }
              return rest;
            });

      return {
        backgroundColor,
        animation: false,
        grid: { left: "8%", right: "6%", top: 35, bottom: 40 },
        xAxis: {
          type: "time",
          min: xAxisMin,
          max: xAxisMax,
          axisLabel: {
            color: "#cbd5e1",
            formatter: (value: any) => {
              const date = new Date(value);
              if (Number.isNaN(date.getTime())) return "";
              return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
            },
          },
          axisLine: { lineStyle: { color: "#4b5563" } },
          axisTick: { show: false },
        },
        // allow mirroring from price (we'll drive via dispatchAction)
        dataZoom: [
          {
            type: "inside",
            xAxisIndex: 0,
            zoomOnMouseWheel: false,
            moveOnMouseWheel: false,
            zoomOnTouchPinch: false,
          },
        ],
        yAxis: finalYAxes,
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "cross", snap: false, lineStyle: { color: "#38bdf8", width: 1 } },
          backgroundColor: "rgba(0,0,0,0.9)",
          borderColor: "#27272a",
          textStyle: { color: "#cbd5e1", fontFamily: "monospace", fontSize: 11 },
          formatter: (params: any) => {
            const arr = Array.isArray(params) ? params : [params];
            if (!arr.length) return "";
            const axisValue = arr[0]?.axisValue ?? arr[0]?.value;
            const axisMs =
              typeof axisValue === "number"
                ? axisValue
                : typeof axisValue === "string"
                ? Date.parse(axisValue)
                : NaN;
            if (!Number.isFinite(axisMs)) return "";
            const date = new Date(axisMs);
            const readings = stageSeriesMeta.length ? computeStageReadings(axisMs) : [];

            let html = '<div style="font-family:monospace;font-size:11px;">';
            html += `<div style="font-weight:bold;margin-bottom:6px;">${date.toLocaleDateString()}</div>`;
            readings.forEach((reading) => {
              let display = "—";
              if (typeof reading.value === "number") {
                if (reading.kind === "declination") display = `${reading.value.toFixed(2)}°`;
                else if (reading.kind === "speed") display = `${reading.value.toFixed(4)} m/s`;
                else if (reading.kind === "force") display = `${reading.value.toFixed(4)} N`;
              }
              html += `<div><span style="color:${reading.color};">●</span> ${reading.name}: ${display}</div>`;
            });
            html += "</div>";
            return html;
          },
        },
        series: stageSeriesForOption,
      };
    }, [
      axisIndexByKind,
      stageSeries,
      stageMarkLines,
      xAxisMin,
      xAxisMax,
      computeStageReadings,
      stageSeriesMeta,
      speedRange,
      forceRange,
    ]);

    const priceOption: EChartsOption = useMemo(() => {
      const seriesOption = [
        {
          name: "Price",
          type: "candlestick" as const,
          data: priceSeries,
          itemStyle: {
            color: upColor,
            color0: downColor,
            borderColor: upColor,
            borderColor0: downColor,
          },
          markLine: eventLines
            ? {
                symbol: "none",
                data: eventLines.map((line) => ({
                  xAxis: line.time * 1000,
                  lineStyle: { color: line.color, width: 1, opacity: 0.6 },
                  label: {
                    show: !!line.label,
                    color: line.color,
                    position: "insideStartTop" as const,
                    fontSize: 9,
                    formatter: line.label ?? "",
                  },
                })),
              }
            : undefined,
        },
        ...planetarySeries,
        ...(futureScaffoldSeries
          ? [
              {
                name: "futureScaffoldSeries",
                type: "line" as const,
                data: futureScaffoldSeries,
                silent: true,
                symbol: "none",
                lineStyle: { opacity: 0, width: 0 },
                itemStyle: { opacity: 0 },
                tooltip: { show: false },
                hoverAnimation: false,
                xAxisIndex: 0,
                yAxisIndex: 0,
                z: -1,
              },
            ]
          : []),
        ...(showVolume
          ? [
              {
                name: "Volume",
                type: "bar" as const,
                xAxisIndex: 1,
                yAxisIndex: 1,
                data: volumeSeries,
                barWidth: "60%",
                itemStyle: { color: (p: any) => p.data?.[2] ?? upColor },
              },
            ]
          : []),
      ];

      return {
        backgroundColor,
        animation: false,
        grid: [
          { left: "8%", right: "4%", top: showVolume ? "6%" : "10%", height: showVolume ? "60%" : "80%" },
          ...(showVolume ? [{ left: "8%", right: "4%", top: "72%", height: "18%" }] : []),
        ],
        xAxis: [
          {
            type: "time",
            axisLabel: {
              color: "#cbd5e1",
              formatter: (value: any) => {
                const date = new Date(value);
                if (Number.isNaN(date.getTime())) return "";
                return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
              },
            },
            axisLine: { lineStyle: { color: "#4b5563" } },
            axisTick: { show: true },
            splitLine: { show: false },
          },
          ...(showVolume
            ? [
                {
                  type: "time" as const,
                  gridIndex: 1,
                  axisLabel: { show: false },
                  axisLine: { show: false },
                  axisTick: { show: false },
                  splitLine: { show: false },
                },
              ]
            : []),
        ] as XAXisComponentOption[],
        yAxis: [
          {
            scale: true,
            position: "right",
            axisLabel: { color: "#cbd5e1" },
            axisLine: { lineStyle: { color: "#4b5563" } },
            splitLine: { show: false },
          },
          ...(showVolume
            ? [{ gridIndex: 1, scale: true, axisLabel: { show: false }, axisLine: { show: false }, splitLine: { show: false } }]
            : []),
        ],
        dataZoom: [
          {
            type: "inside",
            xAxisIndex: [0, ...(showVolume ? [1] : [])],
            zoomOnMouseWheel: false,
            moveOnMouseWheel: false,
            zoomOnTouchPinch: false,
          },
          {
            type: "slider",
            xAxisIndex: [0, ...(showVolume ? [1] : [])],
            height: 14,
            bottom: 20,
            handleSize: 8,
            borderColor: "#4b5563",
            fillerColor: "rgba(74,222,128,0.12)",
          },
        ],
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "cross", snap: false, lineStyle: { color: "#38bdf8", width: 1 } },
          backgroundColor: "rgba(0,0,0,0.9)",
          borderColor: "#27272a",
          textStyle: { color: "#cbd5e1", fontFamily: "monospace", fontSize: 11 },
          formatter: (params: any) => {
            const arr = Array.isArray(params) ? params : [params];
            if (!arr.length) return "";
            const axisValue = arr[0]?.axisValue ?? arr[0]?.value;
            const axisMs =
              typeof axisValue === "number"
                ? axisValue
                : typeof axisValue === "string"
                ? Date.parse(axisValue)
                : NaN;
            if (!Number.isFinite(axisMs)) return "";
            const date = new Date(axisMs);
            const info = priceLookupByMs.get(Math.round(axisMs));
            const actual = info?.actual ?? null;
            const carried = info?.carried ?? null;

            let html = '<div style="font-family:monospace;font-size:11px;">';
            html += `<div style="font-weight:bold;margin-bottom:6px;">${date.toLocaleDateString()}</div>`;
            if (actual) {
              html += `<div>O: ${actual.open.toFixed(2)}</div>`;
              html += `<div>H: ${actual.high.toFixed(2)}</div>`;
              html += `<div>L: ${actual.low.toFixed(2)}</div>`;
              html += `<div>C: ${actual.close.toFixed(2)}</div>`;
              if (actual.volume != null) {
                html += `<div>V: ${actual.volume.toLocaleString()}</div>`;
              }
            } else if (carried) {
              html += "<div>Market closed</div>";
              html += `<div>Last close (${new Date(carried.time * 1000).toLocaleDateString()}): ${carried.close.toFixed(
                2
              )}</div>`;
            } else {
              html += "<div>No market data</div>";
            }
            html += "</div>";
            return html;
          },
        },
        series: seriesOption as any,
      };
    }, [
      eventLines,
      priceSeries,
      priceLookupByMs,
      planetarySeries,
      futureScaffoldSeries,
      volumeSeries,
      showVolume,
      xAxisMin,
      xAxisMax,
    ]);

    // === CROSSHAIR SYNC: showTip + updateAxisPointer with guard ===
    const handleAxisPointerUpdate = useCallback(
      (event: any, sourceChart: "price" | "stage") => {
        if (syncingPointerRef.current) return;

        const targetRef = sourceChart === "price" ? stageChartRef : priceChartRef;
        const target = targetRef.current?.getEchartsInstance();
        if (!target) return;

        // Pull ms from event
        const axisInfo = Array.isArray(event?.axesInfo)
          ? event.axesInfo.find((i: any) => i?.axisDim === "x")
          : null;
        const raw = axisInfo?.value ?? event?.value ?? event?.x;
        const axisMs =
          typeof raw === "number" ? raw : typeof raw === "string" ? Date.parse(raw) : NaN;
        if (!Number.isFinite(axisMs)) return;

        // Convert the time to x pixel on TARGET chart
        const xPx = target.convertToPixel({ xAxisIndex: 0 }, axisMs);
        if (!Number.isFinite(xPx)) return;

        // Use a mid-grid Y so crosshair is drawn even if not on a symbol
        const gridRect = (() => {
          try {
            const model = (target as any)._model;
            const gridModel = model?.getComponent("grid", 0);
            const rect = gridModel?.coordinateSystem?.getRect?.();
            return rect || null;
          } catch {
            return null;
          }
        })();
        const yPx = gridRect ? gridRect.y + gridRect.height / 2 : target.getHeight() / 2;

        syncingPointerRef.current = true;
        try {
          // Force-visible cursor on the other chart
          target.dispatchAction({ type: "showTip", x: xPx, y: yPx });
          target.dispatchAction({ type: "updateAxisPointer", x: xPx, y: yPx });
        } finally {
          setTimeout(() => {
            syncingPointerRef.current = false;
          }, 0);
        }

        // Optional callback with candle payload
        if (onCrosshairMove) {
          const info = priceLookupByMs.get(Math.round(axisMs));
          const iso = new Date(axisMs).toISOString().slice(0, 10);
          const fallback = candleByDate.get(iso) ?? null;
          const payload = info?.actual ?? info?.carried ?? fallback ?? null;
          onCrosshairMove(payload);
        }
      },
      [onCrosshairMove, priceLookupByMs, candleByDate]
    );

    // Container-level mouseleave: hide both tooltips together
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const hideBoth = () => {
        priceChartRef.current?.getEchartsInstance().dispatchAction({ type: "hideTip" });
        stageChartRef.current?.getEchartsInstance().dispatchAction({ type: "hideTip" });
      };
      el.addEventListener("mouseleave", hideBoth);
      return () => el.removeEventListener("mouseleave", hideBoth);
    }, []);

    // Bind only updateAxisPointer; no per-chart globalout that would hide the other cursor
    const stageEvents = useMemo(
      () =>
        hasStage
          ? {
              updateAxisPointer: (evt: any) => handleAxisPointerUpdate(evt, "stage"),
            }
          : undefined,
      [handleAxisPointerUpdate, hasStage]
    );

    const priceEvents = useMemo(
      () => ({
        updateAxisPointer: (evt: any) => handleAxisPointerUpdate(evt, "price"),
      }),
      [handleAxisPointerUpdate]
    );

    const onChartClick = useCallback(
      (params: any) => {
        if (drawingTool !== "trendline") return;
        if (!params || !params.value) return;
        if (!Array.isArray(params.value) || params.value.length < 2) return;

        const time = params.value[0];
        const value = params.value[1];

        const first = pendingPointRef.current;
        if (!first) {
          pendingPointRef.current = { time, value };
          return;
        }

        const second = { time, value };
        const lineData = [
          [first.time, first.value],
          [second.time, second.value],
        ];

        drawingLinesRef.current.push({
          type: "line",
          data: lineData,
          lineStyle: { color: "#f97316", width: 2 },
          showSymbol: true,
          symbolSize: 6,
        });

        pendingPointRef.current = null;

        if (priceChartRef.current) {
          const currentOption = priceChartRef.current.getEchartsInstance().getOption();
          const existingSeries = (currentOption.series as any[]) || [];
          priceChartRef.current.getEchartsInstance().setOption({
            series: [...existingSeries, ...drawingLinesRef.current] as any,
          });
        }
      },
      [drawingTool]
    );

    useImperativeHandle(
      ref,
      () => ({
        autoscale() {
          const chart = priceChartRef.current?.getEchartsInstance();
          if (chart) {
            const startValue = timelineStartMs ?? (timelineMs.length ? timelineMs[0] : null);
            const endValue =
              paddedTimelineEndMs ??
              timelineEndMs ??
              (timelineMs.length ? timelineMs[timelineMs.length - 1] : null);
            if (startValue != null && endValue != null) {
              chart.dispatchAction({
                type: "dataZoom",
                xAxisIndex: [0, ...(showVolume ? [1] : [])],
                startValue,
                endValue,
              });
              if (hasStage) {
                const stage = stageChartRef.current?.getEchartsInstance();
                if (stage) {
                  syncingZoomRef.current = true;
                  try {
                    stage.dispatchAction({
                      type: "dataZoom",
                      xAxisIndex: 0,
                      startValue,
                      endValue,
                    });
                  } finally {
                    setTimeout(() => {
                      syncingZoomRef.current = false;
                    }, 0);
                  }
                }
              }
            } else {
              chart.dispatchAction({ type: "dataZoom", start: 0, end: 100 });
            }
            chart.setOption({ yAxis: [{ min: "dataMin", max: "dataMax" }] });
          }
          manualYAxisRangeRef.current = null;
          manualXAxisRangeRef.current = null;
        },
        clearDrawings() {
          drawingLinesRef.current = [];
          pendingPointRef.current = null;
          const chart = priceChartRef.current?.getEchartsInstance();
          if (chart) {
            chart.setOption(priceOption, true);
          }
          manualYAxisRangeRef.current = null;
          manualXAxisRangeRef.current = null;
        },
        setVisibleRange(range) {
          const chart = priceChartRef.current?.getEchartsInstance();
          if (!chart || !range || !timelineMs.length) return;
          const defaultStart = timelineStartMs ?? timelineMs[0];
          const defaultEnd =
            paddedTimelineEndMs ??
            timelineEndMs ??
            timelineMs[timelineMs.length - 1];
          const startMs = range.start != null ? range.start * 1000 : defaultStart;
          const endMs = range.end != null ? range.end * 1000 : defaultEnd;
          const startIndex = timelineMs.findIndex((ms) => ms >= startMs);
          const endIndex = timelineMs.findIndex((ms) => ms >= endMs);
          const startPercent =
            startIndex === -1 ? 0 : (startIndex / Math.max(timelineMs.length - 1, 1)) * 100;
          const endPercent =
            endIndex === -1 ? 100 : (endIndex / Math.max(timelineMs.length - 1, 1)) * 100;

          suppressRangeCallbackRef.current = true;
          chart.dispatchAction({ type: "dataZoom", start: startPercent, end: endPercent });
          if (hasStage) {
            const stage = stageChartRef.current?.getEchartsInstance();
            if (stage) {
              syncingZoomRef.current = true;
              try {
                stage.dispatchAction({
                  type: "dataZoom",
                  xAxisIndex: 0,
                  startValue: startMs,
                  endValue: endMs,
                });
              } finally {
                setTimeout(() => {
                  syncingZoomRef.current = false;
                }, 0);
              }
            }
          }
          manualXAxisRangeRef.current = { min: startMs, max: endMs };

          const normalizedStart =
            typeof startMs === "number" && Number.isFinite(startMs) ? Math.round(startMs / 1000) : null;
          const normalizedEnd =
            typeof endMs === "number" && Number.isFinite(endMs) ? Math.round(endMs / 1000) : null;
          let start = normalizedStart;
          let end = normalizedEnd;
          if (start != null && end != null && start > end) {
            [start, end] = [end, start];
          }
          lastEmittedRangeRef.current = { start, end };

          setTimeout(() => {
            suppressRangeCallbackRef.current = false;
          }, 0);
        },
      }),
      [
        priceOption,
        timelineMs,
        timelineStartMs,
        timelineEndMs,
        paddedTimelineEndMs,
        showVolume,
        hasStage,
      ]
    );

    // === Price chart interaction plumbing (zoom, pan, etc) ===
    useEffect(() => {
      const chart = priceChartRef.current?.getEchartsInstance();
      if (!chart) return;

      const mirrorZoomToStage = (startValue: number, endValue: number) => {
        if (!hasStage) return;
        const stage = stageChartRef.current?.getEchartsInstance();
        if (!stage || syncingZoomRef.current) return;

        syncingZoomRef.current = true;
        try {
          stage.dispatchAction({
            type: "dataZoom",
            xAxisIndex: 0,
            startValue,
            endValue,
          });
        } finally {
          setTimeout(() => {
            syncingZoomRef.current = false;
          }, 0);
        }
      };

      // Direct dispatch - skip mirrorZoomToStage during drag for performance
      let pendingZoomRaf: number | null = null;
      let lastZoomAction: {sv: number, ev: number} | null = null;
      const throttledZoomDispatch = (action: echarts.Payload) => {
        if (pendingZoomRaf !== null) {
          cancelAnimationFrame(pendingZoomRaf);
        }
        pendingZoomRaf = requestAnimationFrame(() => {
          chart.dispatchAction(action);
          const sv = (action as any).startValue;
          const ev = (action as any).endValue;
          // Store last zoom for sync on mouseup, but don't mirror during drag
          if (Number.isFinite(sv) && Number.isFinite(ev)) {
            lastZoomAction = {sv, ev};
          }
          pendingZoomRaf = null;
        });
      };

      const syncZoomToStage = () => {
        if (lastZoomAction && Number.isFinite(lastZoomAction.sv) && Number.isFinite(lastZoomAction.ev)) {
          mirrorZoomToStage(lastZoomAction.sv, lastZoomAction.ev);
        }
      };

      let pendingYAxisRaf: number | null = null;
      const throttledYAxisUpdate = (range: { min: number; max: number }) => {
        if (pendingYAxisRaf !== null) {
          cancelAnimationFrame(pendingYAxisRaf);
        }
        pendingYAxisRaf = requestAnimationFrame(() => {
          chart.setOption({ yAxis: [{ min: range.min, max: range.max }] });
          pendingYAxisRaf = null;
        });
      };

      const dom = chart.getDom();
      const zr = chart.getZr();
      pointerInsideGridRef.current = false;

      const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

      const getLayout = (): {
        gridRect: { x: number; y: number; width: number; height: number };
        yAxisRect: { x: number; y: number; width: number; height: number };
        xAxisRect: { x: number; y: number; width: number; height: number };
      } | null => {
        try {
          const model = (chart as any)._model;
          const gridModel = model?.getComponent("grid", 0);
          const coordSys = gridModel?.coordinateSystem;
          if (!coordSys || typeof coordSys.getRect !== "function") return null;
          const rect = coordSys.getRect();
          if (!rect) return null;

          const chartWidth = chart.getWidth();
          const chartHeight = chart.getHeight();
          const yAxisWidth = Math.max(chartWidth - (rect.x + rect.width), 28);
          const xAxisHeight = Math.max(chartHeight - (rect.y + rect.height), 28);

          return {
            gridRect: rect,
            yAxisRect: { x: rect.x + rect.width, y: rect.y, width: yAxisWidth, height: rect.height },
            xAxisRect: { x: rect.x, y: rect.y + rect.height, width: rect.width, height: xAxisHeight },
          };
        } catch {
          return null;
        }
      };

      type CursorState = "default" | "grab" | "grabbing" | "yAxis" | "xAxis";

      const setCursorStyle = (value: string | null) => {
        if (!dom) return;
        if (value) dom.style.setProperty("cursor", value, "important");
        else dom.style.removeProperty("cursor");
      };

      const applyCursorState = (state: CursorState) => {
        let cursorValue: string | null = null;
        if (state === "grab") cursorValue = "grab";
        else if (state === "grabbing") cursorValue = "grabbing";
        else if (state === "yAxis") cursorValue = "ns-resize";
        else if (state === "xAxis") cursorValue = "ew-resize";
        else cursorValue = null;
        setCursorStyle(cursorValue);
      };

      const determineAxisHover = (
        offsetX: number,
        offsetY: number,
        layout: ReturnType<typeof getLayout> | null
      ): "x" | "y" | null => {
        if (!layout) return null;
        const { yAxisRect, xAxisRect } = layout;
        const withinYAxis =
          offsetX >= yAxisRect.x &&
          offsetX <= yAxisRect.x + yAxisRect.width &&
          offsetY >= yAxisRect.y &&
          offsetY <= yAxisRect.y + yAxisRect.height &&
          yAxisRect.width > 6;
        if (withinYAxis) return "y";

        const withinXAxis =
          offsetX >= xAxisRect.x &&
          offsetX <= xAxisRect.x + xAxisRect.width &&
          offsetY >= xAxisRect.y &&
          offsetY <= xAxisRect.y + xAxisRect.height &&
          xAxisRect.height > 6;
        if (withinXAxis) return "x";

        return null;
      };

      const updateCursor = (axis: "x" | "y" | null) => {
        if (!dom) return;
        if (dragStateRef.current.active) {
          const activeMode = dragStateRef.current.mode ?? dragStateRef.current.preferredMode;
          if (activeMode === "yAxisScale" || activeMode === "xAxisScale") {
            applyCursorState(activeMode === "yAxisScale" ? "yAxis" : "xAxis");
            return;
          }
          applyCursorState("grabbing");
          return;
        }
        if (axis === "y") applyCursorState("yAxis");
        else if (axis === "x") applyCursorState("xAxis");
        else if (pointerInsideGridRef.current) applyCursorState("grab");
        else applyCursorState("default");
      };

      const extractOffsets = (source: any): { offsetX: number; offsetY: number } | null => {
        if (!source) return null;
        if (typeof source.offsetX === "number" && typeof source.offsetY === "number") {
          return { offsetX: source.offsetX, offsetY: source.offsetY };
        }
        if (typeof source.zrX === "number" && typeof source.zrY === "number") {
          return { offsetX: source.zrX, offsetY: source.zrY };
        }
        if (typeof source.clientX === "number" && typeof source.clientY === "number") {
          const rect = dom.getBoundingClientRect();
          return { offsetX: source.clientX - rect.left, offsetY: source.clientY - rect.top };
        }
        return null;
      };

      const handlePointerMove = (raw: any) => {
        const offsets = extractOffsets(raw);
        if (!offsets) return;
        const layout = getLayout();
        const withinGrid = layout
          ? offsets.offsetX >= layout.gridRect.x &&
            offsets.offsetX <= layout.gridRect.x + layout.gridRect.width &&
            offsets.offsetY >= layout.gridRect.y &&
            offsets.offsetY <= layout.gridRect.y + layout.gridRect.height
          : false;
        let shouldUpdate = false;
        if (pointerInsideGridRef.current !== withinGrid) {
          pointerInsideGridRef.current = withinGrid;
          shouldUpdate = true;
        }
        if (shouldUpdate) updateCursor(axisHoverStateRef.current);
      };

      const resetDragState = () => {
        dragStateRef.current.active = false;
        dragStateRef.current.mode = null;
        dragStateRef.current.preferredMode = null;
        dragStateRef.current.modeResolved = false;
        dragStateRef.current.startX = 0;
        dragStateRef.current.startY = 0;
        dragStateRef.current.startXAxisRange = null;
        dragStateRef.current.startYAxisRange = null;
        dragStateRef.current.anchorPrice = null;
        dragStateRef.current.axisSide = null;
      };

      const startDrag = (options?: {
        preferredMode?: DragMode | null;
        forceMode?: DragMode | null;
        axisSide?: 1 | -1 | null;
        insideGrid?: boolean;
      }) => {
        const preferredMode = options?.preferredMode ?? null;
        const forceMode = options?.forceMode ?? null;
        dragStateRef.current.active = true;
        dragStateRef.current.mode = forceMode;
        dragStateRef.current.preferredMode = preferredMode;
        dragStateRef.current.modeResolved = forceMode !== null;
        dragStateRef.current.axisSide = options?.axisSide ?? null;
        if (typeof options?.insideGrid === "boolean") {
          pointerInsideGridRef.current = options.insideGrid;
        }
        updateCursor(axisHoverStateRef.current);
      };

      const endDrag = () => {
        resetDragState();
        updateCursor(axisHoverStateRef.current);
      };

      const resolveDragMode = (dx: number, dy: number): DragMode | null => {
        const drag = dragStateRef.current;
        if (!drag.active) return null;
        if (drag.modeResolved && drag.mode) return drag.mode;

        let candidate = drag.preferredMode;
        if (!candidate) candidate = "freePan";

        if (candidate === "xPan" && !drag.startXAxisRange) {
          candidate = drag.startYAxisRange ? "freePan" : null;
        } else if (candidate === "yZoom" && !drag.startYAxisRange) {
          candidate = drag.startXAxisRange ? "xPan" : null;
        } else if (candidate === "freePan" && !drag.startXAxisRange && !drag.startYAxisRange) {
          candidate = null;
        } else if (candidate === "yAxisScale" && !drag.startYAxisRange) {
          candidate = null;
        } else if (candidate === "xAxisScale" && !drag.startXAxisRange) {
          candidate = null;
        }

        drag.mode = candidate;
        drag.modeResolved = candidate !== null;
        return candidate ?? null;
      };

      // viewport-only globalout for cursor state (not tooltip)
      const handleViewportGlobalOut = () => {
        axisHoverStateRef.current = null;
        pointerInsideGridRef.current = false;
        if (dragStateRef.current.active) endDrag();
        else updateCursor(null);
      };

      const handleAxisMouseOver = (params: any) => {
        const type = params?.componentType;
        if (type === "yAxis") {
          axisHoverStateRef.current = "y";
          updateCursor("y");
        } else if (type === "xAxis") {
          axisHoverStateRef.current = "x";
          updateCursor("x");
        }
      };

      const handleAxisMouseOut = (params: any) => {
        const type = params?.componentType;
        if (type === "yAxis" || type === "xAxis") {
          axisHoverStateRef.current = null;
          updateCursor(null);
        }
      };

      const handleWheel = (rawParams: any) => {
        const rawEvent = rawParams?.event ?? rawParams;
        const offsets = extractOffsets(rawEvent);
        if (!offsets) return;
        const layout = getLayout();
        if (!layout) return;
        const withinGrid =
          offsets.offsetX >= layout.gridRect.x &&
          offsets.offsetX <= layout.gridRect.x + layout.gridRect.width &&
          offsets.offsetY >= layout.gridRect.y &&
          offsets.offsetY <= layout.gridRect.y + layout.gridRect.height;
        if (!withinGrid) return;

        pointerInsideGridRef.current = true;

        if (typeof rawEvent.preventDefault === "function") rawEvent.preventDefault();

        let deltaY = 0;
        if (typeof rawEvent.deltaY === "number") deltaY = rawEvent.deltaY;
        else if (typeof rawEvent.wheelDelta === "number") deltaY = -rawEvent.wheelDelta;
        if (deltaY === 0) return;

        const zoomFactor = deltaY < 0 ? 0.85 : 1.15;

        const anchorX = clamp(
          offsets.offsetX,
          layout.gridRect.x,
          layout.gridRect.x + layout.gridRect.width
        );
        const anchorPairX = chart.convertFromPixel(
          { gridIndex: 0 },
          [anchorX, layout.gridRect.y + layout.gridRect.height - 1]
        );
        const leftPair = chart.convertFromPixel(
          { gridIndex: 0 },
          [layout.gridRect.x, layout.gridRect.y + layout.gridRect.height - 1]
        );
        const rightPair = chart.convertFromPixel(
          { gridIndex: 0 },
          [layout.gridRect.x + layout.gridRect.width, layout.gridRect.y + layout.gridRect.height - 1]
        );
        const anchorY = clamp(
          offsets.offsetY,
          layout.gridRect.y,
          layout.gridRect.y + layout.gridRect.height
        );
        const anchorPairY = chart.convertFromPixel(
          { gridIndex: 0 },
          [layout.gridRect.x + layout.gridRect.width - 1, anchorY]
        );
        const topPair = chart.convertFromPixel(
          { gridIndex: 0 },
          [layout.gridRect.x + layout.gridRect.width - 1, layout.gridRect.y]
        );
        const bottomPair = chart.convertFromPixel(
          { gridIndex: 0 },
          [
            layout.gridRect.x + layout.gridRect.width - 1,
            layout.gridRect.y + layout.gridRect.height,
          ]
        );

        const anchorTime = Array.isArray(anchorPairX) ? anchorPairX[0] : anchorPairX;
        const minTime = Array.isArray(leftPair) ? leftPair[0] : leftPair;
        const maxTime = Array.isArray(rightPair) ? rightPair[0] : rightPair;
        if (
          Number.isFinite(anchorTime) &&
          Number.isFinite(minTime) &&
          Number.isFinite(maxTime) &&
          maxTime !== minTime
        ) {
          let newStart = anchorTime + (minTime - anchorTime) * zoomFactor;
          let newEnd = anchorTime + (maxTime - anchorTime) * zoomFactor;
          const fullStart = timelineStartMs ?? newStart;
          const fullEnd = paddedTimelineEndMs ?? timelineEndMs ?? newEnd;
          if (Number.isFinite(fullStart)) newStart = Math.max(newStart, fullStart);
          if (Number.isFinite(fullEnd)) newEnd = Math.min(newEnd, fullEnd);
          if (newEnd - newStart >= minTimelineStep) {
            const xAxisIndex = [0, ...(showVolume ? [1] : [])];
            throttledZoomDispatch({ type: "dataZoom", xAxisIndex, startValue: newStart, endValue: newEnd });
            mirrorZoomToStage(newStart, newEnd);
            manualXAxisRangeRef.current = { min: newStart, max: newEnd };
          }
        }

        const anchorPrice = Array.isArray(anchorPairY) ? anchorPairY[1] : anchorPairY;
        const maxPrice = Array.isArray(topPair) ? topPair[1] : topPair;
        const minPrice = Array.isArray(bottomPair) ? bottomPair[1] : bottomPair;
        if (
          Number.isFinite(anchorPrice) &&
          Number.isFinite(maxPrice) &&
          Number.isFinite(minPrice) &&
          maxPrice !== minPrice
        ) {
          const newMin = anchorPrice + (minPrice - anchorPrice) * zoomFactor;
          const newMax = anchorPrice + (maxPrice - anchorPrice) * zoomFactor;
          if (Number.isFinite(newMin) && Number.isFinite(newMax) && newMax - newMin > 0) {
            throttledYAxisUpdate({ min: newMin, max: newMax });
            manualYAxisRangeRef.current = { min: newMin, max: newMax };
          }
        }
      };

      const zrMoveHandler = (params: any) => {
        if (!params || !params.event) return;
        handlePointerMove(params.event);
        if (!dragStateRef.current.active) return;
        const offsets = extractOffsets(params.event);
        if (!offsets) return;
        const layout = getLayout();
        if (!layout) return;

        const drag = dragStateRef.current;
        const dx = offsets.offsetX - drag.startX;
               // dy used below
        const dy = offsets.offsetY - drag.startY;

        const mode = drag.modeResolved ? drag.mode : resolveDragMode(dx, dy);
        if (!mode) return;

        const panXAxis = (mode === "xPan" || mode === "freePan") && drag.startXAxisRange;
        if (panXAxis && drag.startXAxisRange) {
          const span = drag.startXAxisRange.max - drag.startXAxisRange.min;
          if (Number.isFinite(span) && span > 0) {
            const ratio = dx / Math.max(layout.gridRect.width, 1);
            const newStart = drag.startXAxisRange.min - ratio * span;
            const newEnd = drag.startXAxisRange.max - ratio * span;
            const finalSpan = newEnd - newStart;
            if (finalSpan > 0.001) {
              const xAxisIndex = [0, ...(showVolume ? [1] : [])];
              throttledZoomDispatch({ type: "dataZoom", xAxisIndex, startValue: newStart, endValue: newEnd });
              mirrorZoomToStage(newStart, newEnd);
              manualXAxisRangeRef.current = { min: newStart, max: newEnd };
            }
          }
        }

        if (mode === "yZoom" && drag.startYAxisRange) {
          const { min: baseMin, max: baseMax } = drag.startYAxisRange;
          const anchorPrice =
            Number.isFinite(drag.anchorPrice ?? NaN) ? (drag.anchorPrice as number) : (baseMin + baseMax) / 2;
          if (Number.isFinite(baseMin) && Number.isFinite(baseMax) && Number.isFinite(anchorPrice) && baseMax !== baseMin) {
            const sensitivity = 0.003;
            const scale = Math.exp(dy * sensitivity);
            const clampedScale = clamp(scale, 0.2, 5);
            const newMin = anchorPrice + (baseMin - anchorPrice) * clampedScale;
            const newMax = anchorPrice + (baseMax - anchorPrice) * clampedScale;
            if (Number.isFinite(newMin) && Number.isFinite(newMax) && newMax - newMin > 0) {
              throttledYAxisUpdate({ min: newMin, max: newMax });
              manualYAxisRangeRef.current = { min: newMin, max: newMax };
            }
          }
        }

        if (mode === "freePan" && drag.startYAxisRange) {
          const { min: baseMin, max: baseMax } = drag.startYAxisRange;
          if (Number.isFinite(baseMin) && Number.isFinite(baseMax) && baseMax !== baseMin) {
            const span = baseMax - baseMin;
            const ratioY = dy / Math.max(layout.gridRect.height, 1);
            const delta = ratioY * span;
            const newMin = baseMin + delta;
            const newMax = baseMax + delta;
            if (Number.isFinite(newMin) && Number.isFinite(newMax) && newMax - newMin > 0) {
              throttledYAxisUpdate({ min: newMin, max: newMax });
              manualYAxisRangeRef.current = { min: newMin, max: newMax };
            }
          }
        }

        if (mode === "yAxisScale" && drag.startYAxisRange) {
          const { min: baseMin, max: baseMax } = drag.startYAxisRange;
          if (Number.isFinite(baseMin) && Number.isFinite(baseMax) && baseMax !== baseMin) {
            const span = baseMax - baseMin;
            const sensitivity = 0.003;
            const scale = Math.exp(dy * sensitivity);
            const clampedScale = clamp(scale, 0.2, 5);
            const newSpan = span / clampedScale;
            const mid = (baseMax + baseMin) / 2;
            const half = newSpan / 2;
            const newMin = mid - half;
            const newMax = mid + half;
            if (Number.isFinite(newMin) && Number.isFinite(newMax) && newMax - newMin > 0) {
              throttledYAxisUpdate({ min: newMin, max: newMax });
              manualYAxisRangeRef.current = { min: newMin, max: newMax };
            }
          }
        }

        if (mode === "xAxisScale" && drag.startXAxisRange) {
          const { min: baseMin, max: baseMax } = drag.startXAxisRange;
          if (Number.isFinite(baseMin) && Number.isFinite(baseMax) && baseMax > baseMin) {
            const span = baseMax - baseMin;
            const center = (baseMax + baseMin) / 2;
            const axisSide =
              drag.axisSide ?? (drag.startX < layout.gridRect.x + layout.gridRect.width / 2 ? -1 : 1);
            if (axisSide !== null) {
              const sensitivity = 0.003;
              const movement = dx * axisSide;
              const scale = Math.exp(movement * sensitivity);
              const clampedScale = clamp(scale, 0.2, 5);
              const newSpan = Math.max(span / clampedScale, minTimelineStep);
              let newStart = center - newSpan / 2;
              let newEnd = center + newSpan / 2;
              const fullStart = timelineStartMs ?? baseMin;
              const fullEnd = paddedTimelineEndMs ?? timelineEndMs ?? baseMax;
              if (Number.isFinite(fullStart)) newStart = Math.max(newStart, fullStart);
              if (Number.isFinite(fullEnd)) newEnd = Math.min(newEnd, fullEnd);
              if (newEnd - newStart >= minTimelineStep) {
                const xAxisIndex = [0, ...(showVolume ? [1] : [])];
                throttledZoomDispatch({ type: "dataZoom", xAxisIndex, startValue: newStart, endValue: newEnd });
                mirrorZoomToStage(newStart, newEnd);
                manualXAxisRangeRef.current = { min: newStart, max: newEnd };
              }
            }
          }
        }
      };

      const zrPinchHandler = (params: any) => {
        const rawEvent = params?.event ?? params;
        const offsets = extractOffsets(rawEvent);
        if (!offsets) return;
        const layout = getLayout();
        if (!layout) return;
        const withinGrid =
          offsets.offsetX >= layout.gridRect.x &&
          offsets.offsetX <= layout.gridRect.x + layout.gridRect.width &&
          offsets.offsetY >= layout.gridRect.y &&
          offsets.offsetY <= layout.gridRect.y + layout.gridRect.height;
        if (!withinGrid) return;

        let scale = 1;
        if (typeof rawEvent.scale === "number") scale = rawEvent.scale;
        else if (typeof rawEvent.pinchScale === "number") scale = rawEvent.pinchScale;
        else if (typeof params.scale === "number") scale = params.scale;
        if (!Number.isFinite(scale) || scale === 0) return;

        const zoomFactor = scale > 1 ? 1 / scale : 1 / Math.max(scale, 0.0001);

        const anchorX = clamp(
          offsets.offsetX,
          layout.gridRect.x,
          layout.gridRect.x + layout.gridRect.width
        );
        const anchorPairX = chart.convertFromPixel(
          { gridIndex: 0 },
          [anchorX, layout.gridRect.y + layout.gridRect.height - 1]
        );
        const leftPair = chart.convertFromPixel(
          { gridIndex: 0 },
          [layout.gridRect.x, layout.gridRect.y + layout.gridRect.height - 1]
        );
        const rightPair = chart.convertFromPixel(
          { gridIndex: 0 },
          [layout.gridRect.x + layout.gridRect.width, layout.gridRect.y + layout.gridRect.height - 1]
        );
        const anchorY = clamp(
          offsets.offsetY,
          layout.gridRect.y,
          layout.gridRect.y + layout.gridRect.height
        );
        const anchorPairY = chart.convertFromPixel(
          { gridIndex: 0 },
          [layout.gridRect.x + layout.gridRect.width - 1, anchorY]
        );
        const topPair = chart.convertFromPixel(
          { gridIndex: 0 },
          [layout.gridRect.x + layout.gridRect.width - 1, layout.gridRect.y]
        );
        const bottomPair = chart.convertFromPixel(
          { gridIndex: 0 },
          [
            layout.gridRect.x + layout.gridRect.width - 1,
            layout.gridRect.y + layout.gridRect.height,
          ]
        );

        const anchorTime = Array.isArray(anchorPairX) ? anchorPairX[0] : anchorPairX;
        const minTime = Array.isArray(leftPair) ? leftPair[0] : leftPair;
        const maxTime = Array.isArray(rightPair) ? rightPair[0] : rightPair;
        const anchorPrice = Array.isArray(anchorPairY) ? anchorPairY[1] : anchorPairY;
        const maxPrice = Array.isArray(topPair) ? topPair[1] : topPair;
        const minPrice = Array.isArray(bottomPair) ? bottomPair[1] : bottomPair;

        const xValid =
          Number.isFinite(anchorTime) &&
          Number.isFinite(minTime) &&
          Number.isFinite(maxTime) &&
          maxTime !== minTime;
        if (xValid) {
          let newStart = anchorTime + (minTime - anchorTime) * zoomFactor;
          let newEnd = anchorTime + (maxTime - anchorTime) * zoomFactor;
          const fullStart = timelineStartMs ?? newStart;
          const fullEnd = paddedTimelineEndMs ?? timelineEndMs ?? newEnd;
          if (Number.isFinite(fullStart)) newStart = Math.max(newStart, fullStart);
          if (Number.isFinite(fullEnd)) newEnd = Math.min(newEnd, fullEnd);
          if (newEnd - newStart >= minTimelineStep) {
            const xAxisIndex = [0, ...(showVolume ? [1] : [])];
            throttledZoomDispatch({ type: "dataZoom", xAxisIndex, startValue: newStart, endValue: newEnd });
            mirrorZoomToStage(newStart, newEnd);
            manualXAxisRangeRef.current = { min: newStart, max: newEnd };
          }
        }

        const yValid =
          Number.isFinite(anchorPrice) &&
          Number.isFinite(maxPrice) &&
          Number.isFinite(minPrice) &&
          maxPrice !== minPrice;
        if (yValid) {
          const newMin = anchorPrice + (minPrice - anchorPrice) * zoomFactor;
          const newMax = anchorPrice + (maxPrice - anchorPrice) * zoomFactor;
          if (Number.isFinite(newMin) && Number.isFinite(newMax) && newMax - newMin > 0) {
            throttledYAxisUpdate({ min: newMin, max: newMax });
            manualYAxisRangeRef.current = { min: newMin, max: newMax };
          }
        }
      };

      const zrWheelHandler = (params: any) => {
        handleWheel(params);
      };

      const zrMouseDownHandler = (params: any) => {
        if (drawingTool === "trendline") return;
        const rawEvent = params?.event ?? params;
        const offsets = extractOffsets(rawEvent);
        if (!offsets) return;
        const layout = getLayout();
        if (!layout) return;
        let axisHover = axisHoverStateRef.current;
        if (!axisHover) {
          axisHover = determineAxisHover(offsets.offsetX, offsets.offsetY, layout);
        }
        const withinGrid =
          offsets.offsetX >= layout.gridRect.x &&
          offsets.offsetX <= layout.gridRect.x + layout.gridRect.width &&
          offsets.offsetY >= layout.gridRect.y &&
          offsets.offsetY <= layout.gridRect.y + layout.gridRect.height;
        if (!withinGrid && !axisHover) return;

        const eventObj = rawEvent?.event ?? rawEvent;
        const baseButton =
          eventObj?.button ?? rawEvent?.event?.zrEvent?.button ?? rawEvent?.button ?? 0;
        const isLeftButton = baseButton === 0;
        if (!isLeftButton) return;

        const leftPair = chart.convertFromPixel(
          { gridIndex: 0 },
          [layout.gridRect.x, layout.gridRect.y + layout.gridRect.height - 1]
        );
        const rightPair = chart.convertFromPixel(
          { gridIndex: 0 },
          [layout.gridRect.x + layout.gridRect.width, layout.gridRect.y + layout.gridRect.height - 1]
        );
        const topPair = chart.convertFromPixel(
          { gridIndex: 0 },
          [layout.gridRect.x + layout.gridRect.width - 1, layout.gridRect.y]
        );
        const bottomPair = chart.convertFromPixel(
          { gridIndex: 0 },
          [
            layout.gridRect.x + layout.gridRect.width - 1,
            layout.gridRect.y + layout.gridRect.height,
          ]
        );
        const anchorPair = chart.convertFromPixel(
          { gridIndex: 0 },
          [layout.gridRect.x + layout.gridRect.width - 1, offsets.offsetY]
        );

        const min = Array.isArray(leftPair) ? leftPair[0] : leftPair;
        const max = Array.isArray(rightPair) ? rightPair[0] : rightPair;
        const yTop = Array.isArray(topPair) ? topPair[1] : topPair;
        const yBottom = Array.isArray(bottomPair) ? bottomPair[1] : bottomPair;
        const anchorPrice = Array.isArray(anchorPair) ? anchorPair[1] : anchorPair;

        dragStateRef.current.startX = offsets.offsetX;
        dragStateRef.current.startY = offsets.offsetY;

        let startXAxisRange: { min: number; max: number } | null = null;
        if (Number.isFinite(min) && Number.isFinite(max) && max !== min) {
          startXAxisRange = { min, max };
        } else if (manualXAxisRangeRef.current) {
          startXAxisRange = { ...manualXAxisRangeRef.current };
        } else if (timelineMs.length >= 2) {
          startXAxisRange = {
            min: timelineStartMs ?? timelineMs[0],
            max: paddedTimelineEndMs ?? timelineEndMs ?? timelineMs[timelineMs.length - 1],
          };
        }
        dragStateRef.current.startXAxisRange = startXAxisRange;

        let startYAxisRange: { min: number; max: number } | null = null;
        if (manualYAxisRangeRef.current) {
          startYAxisRange = { ...manualYAxisRangeRef.current };
        } else if (Number.isFinite(yTop) && Number.isFinite(yBottom) && yTop !== yBottom) {
          startYAxisRange = { min: Math.min(yTop, yBottom), max: Math.max(yTop, yBottom) };
        }
        dragStateRef.current.startYAxisRange = startYAxisRange;
        dragStateRef.current.anchorPrice = Number.isFinite(anchorPrice) ? anchorPrice : null;

        if (rawEvent?.event?.preventDefault) rawEvent.event.preventDefault();

        let preferredMode: DragMode = "freePan";
        let axisSide: 1 | -1 | null = null;
        let insideGrid = withinGrid;
        if (axisHover === "y") {
          preferredMode = "yAxisScale";
          insideGrid = false;
        } else if (axisHover === "x") {
          preferredMode = "xAxisScale";
          axisSide = offsets.offsetX < layout.gridRect.x + layout.gridRect.width / 2 ? -1 : 1;
          insideGrid = false;
        }

        startDrag({ forceMode: preferredMode, preferredMode, axisSide, insideGrid });
      };

      const zrMouseUpHandler = () => {
        if (!dragStateRef.current.active) return;
        endDrag();
        // Sync orbital chart after drag completes
        syncZoomToStage();
      };

      const zrDoubleClickHandler = (params: any) => {
        const rawEvent = params?.event ?? params;
        const offsets = extractOffsets(rawEvent);
        if (!offsets) return;
        const layout = getLayout();
        if (!layout) return;
        let axis = axisHoverStateRef.current;
        if (!axis) {
          axis = determineAxisHover(offsets.offsetX, offsets.offsetY, layout);
        }
        if (axis === "y") {
          chart.setOption({ yAxis: [{ min: "dataMin", max: "dataMax" }] });
          manualYAxisRangeRef.current = null;
        } else if (axis === "x") {
          manualXAxisRangeRef.current = null;
          const xAxisIndex = [0, ...(showVolume ? [1] : [])];
          const startValue = timelineStartMs ?? (timelineMs.length ? timelineMs[0] : null);
          const endValue =
            paddedTimelineEndMs ??
            timelineEndMs ??
            (timelineMs.length ? timelineMs[timelineMs.length - 1] : null);
          if (startValue != null && endValue != null) {
            chart.dispatchAction({ type: "dataZoom", xAxisIndex, startValue, endValue });
            mirrorZoomToStage(startValue, endValue);
          } else {
            chart.dispatchAction({ type: "dataZoom", start: 0, end: 100 });
          }
        }
      };

      const suppressContextMenu = (event: MouseEvent) => {
        if (event.target && dom.contains(event.target as Node)) event.preventDefault();
      };

      // Mirror slider/inside zooms initiated by components
      // Skip mirroring during active drag to prevent feedback loop snap-back
      const onPriceDataZoom = (e: any) => {
        const batch = e?.batch?.[0] ?? e;
        const sv = batch?.startValue;
        const ev = batch?.endValue;

        if (Number.isFinite(sv) && Number.isFinite(ev)) {
          emitVisibleRange(sv as number, ev as number);
          // Only mirror if not actively dragging to avoid feedback loop
          if (!dragStateRef.current.active) {
            mirrorZoomToStage(sv, ev);
          }
          return;
        }

        if (
          (!Number.isFinite(sv) || sv == null) &&
          (!Number.isFinite(ev) || ev == null)
        ) {
          emitVisibleRange(null, null);
        }
      };

      dom.addEventListener("contextmenu", suppressContextMenu);
      zr.on("mousemove", zrMoveHandler);
      zr.on("globalout", handleViewportGlobalOut);
      zr.on("mousewheel", zrWheelHandler);
      zr.on("pinch", zrPinchHandler);
      zr.on("mousedown", zrMouseDownHandler);
      zr.on("mouseup", zrMouseUpHandler);
      zr.on("dblclick", zrDoubleClickHandler);
      chart.on("mouseover", handleAxisMouseOver);
      chart.on("mouseout", handleAxisMouseOut);
      chart.on("dataZoom", onPriceDataZoom);

      return () => {
        dom.removeEventListener("contextmenu", suppressContextMenu);
        zr.off("mousemove", zrMoveHandler);
        zr.off("globalout", handleViewportGlobalOut);
        zr.off("mousewheel", zrWheelHandler);
        zr.off("pinch", zrPinchHandler);
        zr.off("mousedown", zrMouseDownHandler);
        zr.off("mouseup", zrMouseUpHandler);
        zr.off("dblclick", zrDoubleClickHandler);
        chart.off("mouseover", handleAxisMouseOver);
        chart.off("mouseout", handleAxisMouseOut);
        chart.off("dataZoom", onPriceDataZoom);
        if (pendingZoomRaf !== null) cancelAnimationFrame(pendingZoomRaf);
        if (pendingYAxisRaf !== null) cancelAnimationFrame(pendingYAxisRaf);
        if (dom) dom.style.cursor = "";
      };
    }, [
      minTimelineStep,
      showVolume,
      timelineMs,
      timelineStartMs,
      timelineEndMs,
      paddedTimelineEndMs,
      emitVisibleRange,
      drawingTool,
      planetarySeriesFingerprint,
      priceChartReadyVersion,
      hasStage,
    ]);

    const handlePriceChartReady = useCallback(() => {
      setPriceChartReadyVersion((v) => v + 1);
      if (onReady) {
        onReady();
      }
    }, [onReady]);

    const priceFlex = hasStage ? "1 1 58%" : "1 1 auto";
    const priceMinHeight = showVolume ? (hasStage ? 360 : 420) : hasStage ? 300 : 360;

    return (
      <div
        ref={containerRef}
        className={className}
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          height: "100%",
        }}
      >
        {hasStage && (
          <div style={{ flex: "0 0 42%", minHeight: 240 }}>
            <ReactECharts
              ref={stageChartRef}
              option={stageOption}
              style={{ width: "100%", height: "100%" }}
              notMerge
              lazyUpdate
              onEvents={stageEvents}
            />
          </div>
        )}
        <div style={{ flex: priceFlex, minHeight: priceMinHeight }}>
          <ReactECharts
            ref={priceChartRef}
            option={priceOption}
            style={{ width: "100%", height: "100%" }}
            notMerge
            lazyUpdate
            onEvents={{ ...priceEvents, click: onChartClick }}
            onChartReady={handlePriceChartReady}
          />
        </div>
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm uppercase tracking-[0.4em]">
            Loading…
          </div>
        )}
      </div>
    );
  }
);

EChartsContainerBase.displayName = "EChartsContainer";
export const EChartsContainer = memo(EChartsContainerBase);
