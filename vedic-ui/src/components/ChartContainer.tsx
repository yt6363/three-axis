/* eslint-disable react-hooks/exhaustive-deps */
"use client";

import {
  CrosshairMode,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  LineStyle,
  LineType,
  type BusinessDay,
  type CandlestickData,
  type HistogramData,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import type { Candle } from "@/lib/api";
import type { IndicatorDataset } from "@/lib/indicators";

type DrawTool = "trendline" | null;

export type OverlayEventLine = {
  time: number;
  color: string;
  label?: string;
};

export type ChartContainerHandle = {
  autoscale: () => void;
  clearDrawings: () => void;
  setVisibleRange: (range: { start: number | null; end: number | null } | null) => void;
};

type ChartContainerProps = {
  candles: Candle[];
  overlays: IndicatorDataset[];
  onCrosshairMove?: (payload: Candle | null) => void;
  className?: string;
  isLoading?: boolean;
  showVolume: boolean;
  drawingTool: DrawTool;
  markers?: SeriesMarker<Time>[];
  eventLines?: OverlayEventLine[];
};

const backgroundColor = "#000000ff";
const gridColor = "#000000ff";
const upColor = "#4ade80";
const downColor = "#f87171";

type SeriesType = "Candlestick" | "Histogram" | "Line";

type SeriesDefinitions = Partial<Record<SeriesType, unknown>>;

function resolveSeriesDefinitions(mod: unknown): SeriesDefinitions {
  const base =
    mod && typeof mod === "object" ? (mod as Record<string, unknown>) : {};
  const candidate =
    base && typeof base.default === "object"
      ? (base.default as Record<string, unknown>)
      : base;
  return {
    Candlestick:
      candidate.CandlestickSeries ?? base.CandlestickSeries ?? null,
    Histogram: candidate.HistogramSeries ?? base.HistogramSeries ?? null,
    Line: candidate.LineSeries ?? base.LineSeries ?? null,
  };
}

function addSeriesWithFallback<T extends SeriesType>(
  chart: IChartApi,
  type: T,
  defs: SeriesDefinitions,
  options: Record<string, unknown>,
): ISeriesApi<T> {
  const legacyName =
    type === "Candlestick"
      ? "addCandlestickSeries"
      : type === "Histogram"
        ? "addHistogramSeries"
        : "addLineSeries";
  const chartObject = chart as unknown as Record<string, unknown>;
  const legacy = chartObject[legacyName];
  if (typeof legacy === "function") {
    return (legacy as (opts: Record<string, unknown>) => ISeriesApi<T>).call(
      chart,
      options,
    );
  }
  const modern = chartObject.addSeries;
  if (typeof modern === "function") {
    const definition = defs[type];
    if (!definition) {
      throw new Error(`Series definition missing for ${type}`);
    }
    return (modern as (def: unknown, opts: Record<string, unknown>) => ISeriesApi<T>).call(
      chart,
      definition,
      options,
    );
  }
  throw new Error(`Chart API missing ${legacyName}`);
}

function toTimestamp(
  time: UTCTimestamp | BusinessDay | undefined,
): UTCTimestamp | null {
  if (time === undefined || time === null) return null;
  if (typeof time === "number") {
    return time as UTCTimestamp;
  }
  const { year, month, day } = time;
  const ms = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  return Math.floor(ms / 1000) as UTCTimestamp;
}

export const ChartContainer = forwardRef<
  ChartContainerHandle,
  ChartContainerProps
>(function ChartContainer(
  {
    candles,
    overlays,
    onCrosshairMove,
    className,
    isLoading,
    showVolume,
    drawingTool,
    markers,
    eventLines,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartContainerDivRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const overlaySeriesRef = useRef<
    Map<string, ISeriesApi<"Line" | "Histogram">>
  >(new Map());
  const overlayLinesRef = useRef<Map<string, IPriceLine[]>>(new Map());
  const seriesDefinitionsRef = useRef<SeriesDefinitions>({});
  const drawingSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const pendingPointRef = useRef<{ time: UTCTimestamp; value: number } | null>(
    null,
  );
  const drawingToolRef = useRef<DrawTool>(null);
  const timeBoundsRef = useRef<{ min: number; max: number } | null>(null);
  const requestedRangeRef = useRef<{ start: number | null; end: number | null } | null>(null);
  const eventLinesRef = useRef<OverlayEventLine[] | undefined>(undefined);
  const [eventLineCoords, setEventLineCoords] = useState<
    (OverlayEventLine & { x: number })[]
  >([]);

  const updateEventLineCoords = useCallback(() => {
    const currentEventLines = eventLinesRef.current;
    if (!chartRef.current || !currentEventLines || currentEventLines.length === 0) {
      setEventLineCoords([]);
      return;
    }
    const timeScale = chartRef.current.timeScale();
    const width = containerRef.current?.clientWidth ?? 0;
    if (width <= 0) {
      setEventLineCoords([]);
      return;
    }
    const coords: (OverlayEventLine & { x: number })[] = [];
    let filteredOutCount = 0;
    let outsideViewCount = 0;
    let futureEventsCount = 0;

    // Get visible logical range to understand the time scale
    const logicalRange = timeScale.getVisibleLogicalRange();
    const visibleTimeRange = timeScale.getVisibleRange();

    currentEventLines.forEach((line) => {
      let coordinate = timeScale.timeToCoordinate(line.time as UTCTimestamp);

      // FIX FOR FUTURE EVENTS: If coordinate is null (event is outside data range),
      // try to extrapolate the position manually
      if (coordinate == null && visibleTimeRange && logicalRange) {
        const eventTime = Number(line.time);
        const rangeStart = Number(visibleTimeRange.from);
        const rangeEnd = Number(visibleTimeRange.to);

        // Check if event is in the future (after visible range end)
        if (eventTime > rangeEnd) {
          // Extrapolate position beyond the chart
          // Calculate pixels per second based on visible range
          const timeSpan = rangeEnd - rangeStart;
          const logicalSpan = logicalRange.to - logicalRange.from;
          if (timeSpan > 0 && logicalSpan > 0) {
            const pixelsPerSecond = width / timeSpan;
            const secondsFromRangeEnd = eventTime - rangeEnd;
            const pixelsFromRangeEnd = secondsFromRangeEnd * pixelsPerSecond;

            // Get the coordinate of the range end and add offset
            const rangeEndCoord = timeScale.timeToCoordinate(rangeEnd as UTCTimestamp);
            if (rangeEndCoord != null) {
              coordinate = rangeEndCoord + pixelsFromRangeEnd;
              futureEventsCount++;
              console.debug(
                `📅 Future event extrapolated: ${new Date(eventTime * 1000).toISOString()} ` +
                `→ x=${Math.round(coordinate)}px (${Math.round(secondsFromRangeEnd / 86400)} days in future)`
              );
            }
          }
        }
      }

      if (coordinate == null) {
        filteredOutCount++;
        return;
      }

      // FIX: Don't filter out events that are outside the visible viewport.
      // They should still be rendered (the browser will handle clipping).
      // This ensures all events are visible even when zoomed/panned.
      if (coordinate < -100 || coordinate > width + 100) {
        // Only skip if FAR outside (100px buffer for labels)
        outsideViewCount++;
        return;
      }
      coords.push({ ...line, x: coordinate });
    });

    if (filteredOutCount > 0 || outsideViewCount > 0 || futureEventsCount > 0) {
      console.debug(
        `Event line coords: ${coords.length} visible, ${outsideViewCount} outside view, ` +
        `${filteredOutCount} not in time range, ${futureEventsCount} future events extrapolated`
      );
    } else {
      console.debug("Event line coords:", coords.length, "visible");
    }
    setEventLineCoords(coords);
  }, []); // No dependencies - uses refs to access latest values

  const applyRequestedRange = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const bounds = timeBoundsRef.current;
    const request = requestedRangeRef.current;
    if (!bounds || bounds.min === bounds.max || !request || (request.start == null && request.end == null)) {
      chart.timeScale().fitContent();
      updateEventLineCoords();
      return;
    }
    let from = Math.max(bounds.min, request.start ?? bounds.min);
    let to = Math.min(bounds.max, request.end ?? bounds.max);
    if (!Number.isFinite(from)) from = bounds.min;
    if (!Number.isFinite(to)) to = bounds.max;
    if (from > to) {
      const centerCandidate =
        request.start != null
          ? request.start
          : request.end != null
            ? request.end
            : bounds.min;
      const center = Math.min(
        bounds.max,
        Math.max(bounds.min, centerCandidate),
      );
      const defaultSpan = Math.max(60, Math.floor((bounds.max - bounds.min) * 0.01));
      const adjustedFrom = Math.max(bounds.min, center - defaultSpan);
      const adjustedTo = Math.min(bounds.max, center + defaultSpan);
      if (adjustedFrom < adjustedTo) {
        from = adjustedFrom;
        to = adjustedTo;
      } else {
        chart.timeScale().fitContent();
        updateEventLineCoords();
        return;
      }
    }
    if (from === to) {
      const span = Math.max(60, Math.floor((bounds.max - bounds.min) * 0.01));
      const adjustedFrom = Math.max(bounds.min, from - span);
      const adjustedTo = Math.min(bounds.max, to + span);
      if (adjustedFrom < adjustedTo) {
        from = adjustedFrom;
        to = adjustedTo;
      }
    }
    if (from >= to) {
      chart.timeScale().fitContent();
      updateEventLineCoords();
      return;
    }
    chart.timeScale().setVisibleRange({
      from: from as UTCTimestamp,
      to: to as UTCTimestamp,
    });
    updateEventLineCoords();
  }, [updateEventLineCoords]);

  const [isReady, setIsReady] = useState(false);

  const candleData = useMemo<CandlestickData[]>(
    () =>
      candles.map((candle) => ({
        time: candle.time as UTCTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    [candles],
  );

  const volumeData = useMemo<HistogramData[]>(
    () =>
      candles.map((candle) => ({
        time: candle.time as UTCTimestamp,
        value: candle.volume,
        color: candle.close >= candle.open ? upColor : downColor,
      })),
    [candles],
  );

  useEffect(() => {
    drawingToolRef.current = drawingTool;
    if (drawingTool === null) {
      pendingPointRef.current = null;
    }
  }, [drawingTool]);

  useEffect(() => {
    const series = candleSeriesRef.current as
      | (ISeriesApi<"Candlestick"> & {
          setMarkers?: (m: SeriesMarker<Time>[]) => void;
          applyMarkers?: (m: SeriesMarker<Time>[]) => void;
          createMarkers?: (m: SeriesMarker<Time>[]) => void;
        })
      | null;
    if (!series) return;
    const payload = markers
      ? [...markers].sort((a, b) => {
          const toNumber = (value: Time): number => {
            if (typeof value === "number") return value;
            const { year, month, day } = value as BusinessDay;
            return Math.floor(Date.UTC(year, month - 1, day) / 1000);
          };
          return toNumber(a.time) - toNumber(b.time);
        })
      : [];
    if (payload.length) {
      console.debug("Applying markers to chart", payload.length);
    }
    if (typeof series.setMarkers === "function") {
      series.setMarkers(payload);
    } else if (typeof series.applyMarkers === "function") {
      series.applyMarkers(payload);
    } else if (typeof series.createMarkers === "function") {
      series.createMarkers(payload);
    }
  }, [markers, isReady]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    let chart: IChartApi | null = null;
    let candleSeries: ISeriesApi<"Candlestick"> | null = null;
    let volumeSeries: ISeriesApi<"Histogram"> | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let cancelled = false;

    const handleCrosshair = (param: MouseEventParams) => {
      if (!onCrosshairMove || !candleSeriesRef.current) {
        return;
      }
      const seriesData = param.seriesData.get(
        candleSeriesRef.current,
      ) as CandlestickData | undefined;
      if (!seriesData) {
        onCrosshairMove(null);
        return;
      }
      const { time, open, high, low, close } = seriesData;
      const volumeDatum =
        volumeSeriesRef.current &&
        (param.seriesData.get(volumeSeriesRef.current) as
          | HistogramData
          | undefined);
      const volume = volumeDatum?.value ?? 0;
      onCrosshairMove({
        time: Number(time),
        open,
        high,
        low,
        close,
        volume,
      });
    };

    import("lightweight-charts")
      .then((mod) => {
        seriesDefinitionsRef.current = resolveSeriesDefinitions(mod);
        const factory =
          typeof mod.createChart === "function"
            ? mod.createChart
            : typeof mod.default === "function"
              ? mod.default
              : typeof mod.default?.createChart === "function"
                ? mod.default.createChart
                : null;
        if (!factory || !containerRef.current) {
          throw new Error("lightweight-charts createChart factory unavailable");
        }

        if (cancelled || !containerRef.current) {
          return;
        }

        chart = factory(containerRef.current, {
          layout: {
            background: { color: backgroundColor },
            textColor: "#cbd5f5",
            fontFamily: "Inter, ui-sans-serif",
          },
          crosshair: {
            mode: CrosshairMode.Normal,
          },
          grid: {
            vertLines: { color: gridColor, style: LineStyle.Solid },
            horzLines: { color: gridColor, style: LineStyle.Solid },
          },
          watermark: {
            visible: false,
          },
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
          rightPriceScale: {
            borderVisible: true,
          },
          timeScale: {
            borderVisible: true,
            rightOffset: 8,
            barSpacing: 10,
          },
        });

        candleSeries = addSeriesWithFallback(
          chart,
          "Candlestick",
          seriesDefinitionsRef.current,
          {
            upColor,
            downColor,
            borderUpColor: upColor,
            borderDownColor: downColor,
            wickUpColor: upColor,
            wickDownColor: downColor,
            priceLineVisible: false,
          },
        );

        volumeSeries = addSeriesWithFallback(
          chart,
          "Histogram",
          seriesDefinitionsRef.current,
          {
            priceFormat: { type: "volume" },
            priceScaleId: "volume",
            color: "#6b7280",
            base: 0,
            priceLineVisible: false,
            lastValueVisible: false,
          },
        );
        volumeSeries.priceScale().applyOptions({
          scaleMargins: {
            top: 0.75,
            bottom: 0,
          },
          borderVisible: true,
        });

        chart.subscribeCrosshairMove(handleCrosshair);
        chart.timeScale().fitContent();

        resizeObserver = new ResizeObserver((entries) => {
          const api = chartRef.current;
          if (!api) return;
          for (const entry of entries) {
            const { width, height } = entry.contentRect;
            api.applyOptions({ width, height });
          }
        });
        resizeObserver.observe(containerRef.current);

        chartRef.current = chart;
        candleSeriesRef.current = candleSeries;
        volumeSeriesRef.current = volumeSeries;
        setIsReady(true);
      })
      .catch((error) => {
        console.error("Failed to initialise chart", error);
      });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();

      drawingSeriesRef.current.forEach((series) => {
        chart?.removeSeries(series);
      });
      drawingSeriesRef.current = [];
      pendingPointRef.current = null;

      if (chart) {
        chart.unsubscribeCrosshairMove(handleCrosshair);
        chart.remove();
      }

      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      overlaySeriesRef.current.clear();
      overlayLinesRef.current.clear();
      setIsReady(false);
    };
  }, [onCrosshairMove]);

  useEffect(() => {
    if (
      !isReady ||
      !chartRef.current ||
      !candleSeriesRef.current ||
      !volumeSeriesRef.current
    ) {
      return;
    }

    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volumeData);
    if (candleData.length > 0) {
      let min = Number(candleData[0]!.time);
      let max = min;
      for (let i = 1; i < candleData.length; i += 1) {
        const value = Number(candleData[i]!.time);
        if (value < min) min = value;
        if (value > max) max = value;
      }

      // EXTENSION: Include event line times in the bounds calculation
      // This allows future events (beyond the last candle) to be plotted
      const currentEventLines = eventLinesRef.current;
      if (currentEventLines && currentEventLines.length > 0) {
        currentEventLines.forEach((line) => {
          const time = Number(line.time);
          if (time < min) min = time;
          if (time > max) max = time;
        });
      }

      timeBoundsRef.current = { min, max };
    } else {
      timeBoundsRef.current = null;
    }
    applyRequestedRange();
    updateEventLineCoords();
  }, [applyRequestedRange, candleData, volumeData, isReady, updateEventLineCoords]);

  useEffect(() => {
    if (!isReady || !volumeSeriesRef.current) return;
    volumeSeriesRef.current.applyOptions({ visible: showVolume });
    const scale = volumeSeriesRef.current.priceScale();
    if (scale) {
      scale.applyOptions({
        visible: showVolume,
        scaleMargins: showVolume
          ? { top: 0.75, bottom: 0 }
          : { top: 0.9, bottom: 0 },
      });
    }
  }, [showVolume, isReady]);

  useEffect(() => {
    if (!isReady || !chartRef.current) return;
    const chart = chartRef.current;

    const handleClick = (param: MouseEventParams) => {
      if (drawingToolRef.current !== "trendline") {
        return;
      }
      if (!param.point) return;
      const ts = toTimestamp(
        param.time as UTCTimestamp | BusinessDay | undefined,
      );
      if (ts === null) return;

      const candleSeries = candleSeriesRef.current;
      if (!candleSeries) {
        return;
      }
      const price =
        typeof candleSeries.coordinateToPrice === "function"
          ? candleSeries.coordinateToPrice(param.point.y)
          : candleSeries.priceScale()?.coordinateToPrice?.(param.point.y);
      if (price === null || price === undefined || !Number.isFinite(price)) {
        return;
      }

      const first = pendingPointRef.current;
      if (!first) {
        pendingPointRef.current = { time: ts, value: price };
        return;
      }

      const second = { time: ts, value: price };
      const data =
        first.time <= second.time ? [first, second] : [second, first];

      const lineSeries = addSeriesWithFallback(
        chart,
        "Line",
        seriesDefinitionsRef.current,
        {
          color: "#f97316",
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        },
      );
      lineSeries.setData(data);
      drawingSeriesRef.current.push(lineSeries);
      pendingPointRef.current = null;
    };

    chart.subscribeClick(handleClick);
    return () => {
      chart.unsubscribeClick(handleClick);
    };
  }, [isReady]);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = chartRef.current;

    const overlaysOnPrice = overlays.filter(
      (overlay) => overlay.pane === undefined || overlay.pane === "price",
    );

    const seriesMap = overlaySeriesRef.current;
    const activeNames = new Set(overlaysOnPrice.map((overlay) => overlay.name));

    for (const [name, series] of seriesMap.entries()) {
      if (!activeNames.has(name)) {
        chart.removeSeries(series);
        seriesMap.delete(name);
        const lines = overlayLinesRef.current.get(name);
        if (lines) {
          for (const line of lines) {
            series?.removePriceLine(line);
          }
        }
        overlayLinesRef.current.delete(name);
      }
    }

    overlaysOnPrice.forEach((overlay) => {
      let series = seriesMap.get(overlay.name);
        if (!series) {
          if (overlay.type === "line") {
            series = addSeriesWithFallback(
              chart,
              "Line",
              seriesDefinitionsRef.current,
              {
                priceScaleId: overlay.priceScaleId ?? "overlay",
                color: overlay.color ?? "#38bdf8",
                lineWidth: overlay.lineWidth ?? 2,
                lineStyle: overlay.lineStyle ?? LineStyle.Solid,
                lineType: overlay.lineType ?? LineType.Simple,
                priceLineVisible: overlay.priceLineVisible ?? false,
                lastValueVisible: overlay.lastValueVisible ?? false,
              },
            );
          if (overlay.useNormalizedRange) {
            const scale = chart.priceScale((overlay.priceScaleId ?? "overlay") as string);
            scale.applyOptions({ position: "overlay", scaleMargins: { top: 0, bottom: 0 } });
          }
        } else {
          series = addSeriesWithFallback(
            chart,
            "Histogram",
            seriesDefinitionsRef.current,
            {
              priceScaleId: overlay.priceScaleId ?? "overlay",
              color: overlay.color ?? "#e879f9",
              base: overlay.baseValue ?? 0,
              priceLineVisible: overlay.priceLineVisible ?? false,
              lastValueVisible: overlay.lastValueVisible ?? false,
            },
          );
        }
        seriesMap.set(overlay.name, series);
      }

      if (overlay.type === "line") {
        const data = overlay.data.map((item) => ({
          ...item,
          time: Number(item.time) as UTCTimestamp,
        }));
        series.setData(data);
        if (overlay.useNormalizedRange) {
          series.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 1 } }) });
        }
      } else {
        series.setData(
          overlay.data.map((item) => ({
            ...item,
            time: Number(item.time) as UTCTimestamp,
          })),
        );
      }

      if (overlay.referenceLines?.length) {
        const existingLines = overlayLinesRef.current.get(overlay.name) ?? [];
        for (const line of existingLines) {
          series.removePriceLine(line);
        }
        const newLines = overlay.referenceLines.map((value) =>
          series.addPriceLine({
            price: value,
            color: "#6b7280",
            lineStyle: LineStyle.Dashed,
            lineWidth: 1,
          }),
        );
        overlayLinesRef.current.set(overlay.name, newLines);
      }
    });
  }, [overlays]);

  // Keep eventLinesRef in sync with eventLines prop and trigger coordinate update
  useEffect(() => {
    eventLinesRef.current = eventLines;
    // Trigger coordinate recalculation when event lines change
    if (isReady && chartRef.current) {
      updateEventLineCoords();
    }
  }, [eventLines, isReady, updateEventLineCoords]);

  useEffect(() => {
    if (!isReady || !chartRef.current) {
      setEventLineCoords([]);
      return;
    }
    updateEventLineCoords();
    const chart = chartRef.current;
    const timeScale = chart.timeScale();
    const listener = () => updateEventLineCoords();
    timeScale.subscribeVisibleTimeRangeChange(listener);
    const resizeObserver = new ResizeObserver(() => {
      updateEventLineCoords();
    });
    const target = chartContainerDivRef.current ?? containerRef.current;
    if (target) {
      resizeObserver.observe(target);
    }
    return () => {
      timeScale.unsubscribeVisibleTimeRangeChange(listener);
      resizeObserver.disconnect();
    };
  }, [isReady, updateEventLineCoords]);

  useImperativeHandle(
    ref,
    () => ({
      autoscale() {
        requestedRangeRef.current = null;
        if (!chartRef.current) return;
        chartRef.current.timeScale().fitContent();
        updateEventLineCoords();
        const priceScale = candleSeriesRef.current?.priceScale();
        priceScale?.applyOptions({ autoScale: true });
      },
      clearDrawings() {
        const chart = chartRef.current;
        drawingSeriesRef.current.forEach((series) => {
          chart?.removeSeries(series);
        });
        drawingSeriesRef.current = [];
        pendingPointRef.current = null;
      },
      setVisibleRange(range) {
        if (range && (range.start != null || range.end != null)) {
          requestedRangeRef.current = {
            start: range.start,
            end: range.end,
          };
        } else {
          requestedRangeRef.current = null;
        }
        applyRequestedRange();
        updateEventLineCoords();
      },
    }),
    [applyRequestedRange],
  );

  return (
    <div className={className} style={{ position: "relative" }}>
      <div ref={(el) => { containerRef.current = el; chartContainerDivRef.current = el; }} className="w-full h-full" />
      {/* Event lines rendered as DOM overlays */}
      {eventLineCoords.map((line, idx) => (
        <div
          key={`event-${line.time}-${idx}`}
          className="absolute inset-y-0 pointer-events-none"
          style={{
            left: `${Math.round(line.x)}px`,
            width: "2px",
            backgroundColor: line.color,
            opacity: 0.6,
            zIndex: 20,
          }}
        >
          {line.label && (
            <div
              className="absolute left-2 top-2 text-[9px] font-mono"
              style={{
                writingMode: "vertical-lr",
                color: line.color,
                opacity: 0.8,
                textShadow: "0 0 2px rgba(0,0,0,0.8)",
                whiteSpace: "pre",
              }}
            >
              {line.label}
            </div>
          )}
        </div>
      ))}
      {(isLoading || !isReady) && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm uppercase tracking-[0.4em]">
          Loading…
        </div>
      )}
    </div>
  );
});
