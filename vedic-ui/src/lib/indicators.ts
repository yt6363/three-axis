import type {
  HistogramData,
  LineData,
  LineType,
  Time,
  UTCTimestamp,
} from "lightweight-charts";

import type { Candle } from "./api";

export type IndicatorDataset =
  | {
      name: string;
      type: "line";
      data: LineData[];
      priceScaleId?: string;
      pane?: string;
      referenceLines?: number[];
      color?: string;
      lineWidth?: number;
      lineType?: LineType;
      priceLineVisible?: boolean;
      lastValueVisible?: boolean;
      useNormalizedRange?: boolean;
      useDeclinationScale?: boolean;
      valueKind?: "declination" | "speed" | "force";
    }
  | {
      name: string;
      type: "histogram";
      data: HistogramData[];
      priceScaleId?: string;
      pane?: string;
      referenceLines?: number[];
      color?: string;
      baseValue?: number;
      priceLineVisible?: boolean;
      lastValueVisible?: boolean;
      useNormalizedRange?: boolean;
      valueKind?: "declination" | "speed" | "force";
    }

export type IndicatorOptions = Record<string, unknown>;

type IndicatorDefinition = {
  name: string;
  optionsSchema: Record<string, unknown>;
  fn: (data: Candle[], options?: IndicatorOptions) => IndicatorDataset;
};

class IndicatorRegistry {
  private indicators = new Map<string, IndicatorDefinition>();

  registerIndicator(def: IndicatorDefinition) {
    this.indicators.set(def.name.toLowerCase(), def);
  }

  listIndicators() {
    return Array.from(this.indicators.values());
  }

  applyIndicator(
    name: string,
    data: Candle[],
    options?: IndicatorOptions,
  ): IndicatorDataset {
    const indicator = this.indicators.get(name.toLowerCase());
    if (!indicator) {
      throw new Error(`Indicator ${name} is not registered`);
    }
    const result = indicator.fn(data, options);
    return { ...result, name: indicator.name };
  }
}

export const indicatorRegistry = new IndicatorRegistry();

function toTime(timestamp: number): Time {
  return timestamp as UTCTimestamp;
}

indicatorRegistry.registerIndicator({
  name: "EMA",
  optionsSchema: { length: { type: "number", default: 20, min: 1, max: 200 } },
  fn: (data, options) => {
    const length = Math.max(Number(options?.length ?? 20), 1);
    const alpha = 2 / (length + 1);
    let ema: number | null = null;
    const series: LineData[] = [];
    for (const bar of data) {
      ema = ema === null ? bar.close : alpha * bar.close + (1 - alpha) * ema;
      series.push({ time: toTime(bar.time), value: ema });
    }
    return {
      name: "EMA",
      type: "line",
      pane: "price",
      priceScaleId: "ema",
      data: series,
    };
  },
});

indicatorRegistry.registerIndicator({
  name: "RSI",
  optionsSchema: { length: { type: "number", default: 14, min: 2, max: 200 } },
  fn: (data, options) => {
    const length = Math.max(Number(options?.length ?? 14), 2);
    if (data.length <= length) {
      return {
        name: "RSI",
        type: "line",
        pane: "rsi",
        data: [],
        referenceLines: [30, 70],
        priceScaleId: "rsi",
      };
    }

    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= length; i += 1) {
      const delta = data[i].close - data[i - 1].close;
      if (delta >= 0) {
        gains += delta;
      } else {
        losses -= delta;
      }
    }

    let avgGain = gains / length;
    let avgLoss = losses / length;

    const results: LineData[] = [];
    const pushValue = (idx: number) => {
      const denominator = Math.max(avgLoss, 1e-6);
      const rs = avgGain / denominator;
      const rsi = 100 - 100 / (1 + rs);
      results.push({
        time: toTime(data[idx].time),
        value: Number.isFinite(rsi) ? rsi : 0,
      });
    };

    pushValue(length);

    for (let i = length + 1; i < data.length; i += 1) {
      const delta = data[i].close - data[i - 1].close;
      const gain = Math.max(delta, 0);
      const loss = Math.max(-delta, 0);
      avgGain = (avgGain * (length - 1) + gain) / length;
      avgLoss = (avgLoss * (length - 1) + loss) / length;
      pushValue(i);
    }

    return {
      name: "RSI",
      type: "line",
      pane: "rsi",
      priceScaleId: "rsi",
      data: results,
      referenceLines: [30, 70],
    };
  },
});
