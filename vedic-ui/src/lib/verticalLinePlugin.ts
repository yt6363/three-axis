import type {
  IChartApi,
  ISeriesPrimitive,
  ISeriesPrimitivePaneView,
  ISeriesPrimitivePaneRenderer,
  SeriesAttachedParameter,
  Time,
} from "lightweight-charts";

interface VerticalLine {
  time: Time;
  color: string;
  label?: string;
  lineWidth?: number;
}

class VerticalLinePaneView implements ISeriesPrimitivePaneView {
  private _lines: VerticalLine[];
  private _chart: IChartApi | null = null;

  constructor(lines: VerticalLine[]) {
    this._lines = lines;
  }

  setChart(chart: IChartApi | null) {
    this._chart = chart;
  }

  update(lines: VerticalLine[]) {
    this._lines = lines;
  }

  renderer(): ISeriesPrimitivePaneRenderer {
    const chart = this._chart;
    const lines = this._lines;

    return {
      draw: (target: CanvasRenderingContext2D) => {
        if (!chart) {
          console.debug("VerticalLinesPrimitive: No chart");
          return;
        }

        if (!lines || lines.length === 0) {
          console.debug("VerticalLinesPrimitive: No lines to draw");
          return;
        }

        const timeScale = chart.timeScale();

        // Target is a BitmapCoordinatesRenderingScope with context and dimensions
        const ctx = target.context;
        if (!ctx) {
          console.debug("VerticalLinesPrimitive: No context");
          return;
        }

        const bitmapSize = target.bitmapSize;
        const height = bitmapSize.height;
        const width = bitmapSize.width;

        console.debug(`VerticalLinesPrimitive: Drawing ${lines.length} lines on ${width}x${height}`);

        lines.forEach((line) => {
          const coordinate = timeScale.timeToCoordinate(line.time);
          if (coordinate === null) {
            console.debug(`VerticalLinesPrimitive: No coordinate for time ${line.time}`);
            return;
          }

          // Convert logical coordinate to bitmap coordinate
          const x = Math.round(coordinate * target.horizontalPixelRatio);
          console.debug(`VerticalLinesPrimitive: Drawing line at x=${x}, color=${line.color}`);

          // Draw vertical line
          ctx.save();
          ctx.strokeStyle = line.color;
          ctx.lineWidth = (line.lineWidth ?? 1) * target.horizontalPixelRatio;
          ctx.globalAlpha = 0.8;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.stroke();
          ctx.restore();

          // Draw label if provided
          if (line.label) {
            ctx.save();
            ctx.fillStyle = line.color;
            ctx.globalAlpha = 0.75;
            ctx.font = `${8 * target.verticalPixelRatio}px monospace`;
            ctx.textAlign = "left";
            ctx.textBaseline = "top";

            // Split label by newlines for multi-line support
            const labelLines = line.label.split("\n");
            const y = 8 * target.verticalPixelRatio;

            // Rotate context for vertical text
            ctx.translate(x + 4 * target.horizontalPixelRatio, y);
            ctx.rotate(Math.PI / 2);

            labelLines.forEach((textLine, idx) => {
              ctx.fillText(textLine, 0, idx * 10 * target.verticalPixelRatio);
            });

            ctx.restore();
          }
        });
      },
    };
  }
}

export class VerticalLinesPrimitive implements ISeriesPrimitive {
  private _paneView: VerticalLinePaneView;
  private _chart: IChartApi | null = null;

  constructor(lines: VerticalLine[]) {
    this._paneView = new VerticalLinePaneView(lines);
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this._chart = param.chart;
    this._paneView.setChart(param.chart);
  }

  detached() {
    this._chart = null;
    this._paneView.setChart(null);
  }

  updateLines(lines: VerticalLine[]) {
    this._paneView.update(lines);
  }

  paneViews() {
    return [this._paneView];
  }
}
