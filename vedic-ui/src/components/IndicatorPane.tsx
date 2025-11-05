"use client";

import {
  IChartApi,
  IPriceLine,
  ISeriesApi,
  LineStyle,
  type HistogramData,
  type LineData,
  type UTCTimestamp,
  createChart,
} from "lightweight-charts";
import { useEffect, useMemo, useRef } from "react";

import type { IndicatorDataset } from "@/lib/indicators";

type IndicatorPaneProps = {
  dataset: IndicatorDataset;
  className?: string;
};

const backgroundColor = "#050608";
const gridColor = "#1f2937";

export function IndicatorPane({ dataset, className }: IndicatorPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line" | "Histogram"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);

  const data = useMemo(() => {
    return dataset.data.map((item) => ({
      ...item,
      time: Number(item.time) as UTCTimestamp,
    }));
  }, [dataset.data]);

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }
    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: backgroundColor },
        textColor: "#cbd5f5",
        fontFamily: "Inter, ui-sans-serif",
      },
      grid: {
        vertLines: { color: gridColor, style: LineStyle.Solid },
        horzLines: { color: gridColor, style: LineStyle.Solid },
      },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      timeScale: {
        borderVisible: true,
      },
      rightPriceScale: {
        borderVisible: true,
        scaleMargins:
          dataset.pane === "rsi"
            ? {
                top: 0.1,
                bottom: 0.1,
              }
            : {
                top: 0.2,
                bottom: 0.2,
              },
      },
      leftPriceScale: {
        visible: false,
      },
    });

    chartRef.current = chart;

    seriesRef.current =
      dataset.type === "line"
        ? chart.addLineSeries({
            color: dataset.name === "RSI" ? "#38bdf8" : "#fbbf24",
            lineWidth: 2,
          })
        : chart.addHistogramSeries({
            color: "#f97316",
            base: 0,
          });

    const resizeObserver = new ResizeObserver((entries) => {
      if (!chartRef.current) return;
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        chartRef.current.applyOptions({ width, height });
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (chartRef.current && seriesRef.current) {
        chartRef.current.removeSeries(seriesRef.current);
      }
      priceLinesRef.current.forEach((line) => {
        seriesRef.current?.removePriceLine(line);
      });
      priceLinesRef.current = [];
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [dataset.name, dataset.pane, dataset.type]);

  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;
    if (dataset.type === "line") {
      (seriesRef.current as ISeriesApi<"Line">).setData(data as LineData[]);
    } else {
      (seriesRef.current as ISeriesApi<"Histogram">).setData(
        data as HistogramData[],
      );
    }
    chartRef.current.timeScale().fitContent();

    priceLinesRef.current.forEach((line) => {
      seriesRef.current?.removePriceLine(line);
    });
    priceLinesRef.current = [];

    if (dataset.referenceLines?.length) {
      priceLinesRef.current = dataset.referenceLines.map((value) =>
        seriesRef.current!.addPriceLine({
          price: value,
          color: "#6b7280",
          lineStyle: LineStyle.Dashed,
          lineWidth: 1,
        }),
      );
    }
  }, [data, dataset.referenceLines, dataset.type]);

  return <div ref={containerRef} className={className} />;
}
