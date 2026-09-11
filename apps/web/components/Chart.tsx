"use client";

import { useEffect, useRef } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { Candle, PricePoint } from "@/lib/types";

/** Glacier chart palette — green line over a fading green area, on the glass panel itself. */
const COLORS = {
  bg: "transparent",
  text: "#8B90A6",
  grid: "rgba(255,255,255,0.06)",
  border: "rgba(255,255,255,0.08)",
  line: "#14F195",
  areaTop: "rgba(20,241,149,0.30)",
  areaBottom: "rgba(20,241,149,0)",
};

interface LineChartProps {
  kind: "line";
  data: PricePoint[];
}
interface CandleChartProps {
  kind: "candles";
  data: Candle[];
}
type ChartProps = (LineChartProps | CandleChartProps) & { height?: number };

/** Decimal places the axis (and the last-value label) needs to show this magnitude, 2–10. */
export function priceDecimals(lastPrice: number): number {
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) return 2;
  return Math.min(10, Math.max(2, 2 - Math.floor(Math.log10(lastPrice))));
}

/**
 * Both feeds render as an area series (the token-page mockup's shape): candles collapse to their close.
 * The chart is disposed and rebuilt when the series kind or data identity changes.
 */
export default function Chart(props: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;

    import("lightweight-charts").then(({ createChart, ColorType, CrosshairMode }) => {
      if (disposed || !containerRef.current) return;
      const chart = createChart(containerRef.current, {
        height: props.height ?? 300,
        layout: {
          background: { type: ColorType.Solid, color: COLORS.bg },
          textColor: COLORS.text,
          fontFamily: "var(--font-mono), 'JetBrains Mono', monospace",
        },
        grid: {
          vertLines: { color: "transparent" },
          horzLines: { color: COLORS.grid },
        },
        rightPriceScale: { borderColor: COLORS.border },
        timeScale: { borderColor: COLORS.border, timeVisible: true, secondsVisible: false },
        crosshair: { mode: CrosshairMode.Normal },
        autoSize: true,
      });
      chartRef.current = chart;

      const points =
        props.kind === "candles"
          ? props.data.map((d) => ({ time: d.ts as number, value: d.c }))
          : props.data.map((d) => ({ time: d.ts as number, value: d.price }));

      // A token priced at 0.0000848 of its commodity would render every axis label as "0.00" on
      // the default 2-decimal format, so precision follows the last value's magnitude.
      const last = points.length > 0 ? points[points.length - 1].value : 1;
      const precision = priceDecimals(last);

      const series = chart.addAreaSeries({
        lineColor: COLORS.line,
        lineWidth: 2,
        topColor: COLORS.areaTop,
        bottomColor: COLORS.areaBottom,
        priceLineVisible: false,
        crosshairMarkerBorderColor: COLORS.line,
        crosshairMarkerBackgroundColor: COLORS.line,
        // `1e-n` rather than Math.pow, which returns 0.000009999999999999999 at n = 5.
        priceFormat: { type: "price", precision, minMove: Number(`1e-${precision}`) },
      });
      series.setData(points as never);
      seriesRef.current = series;

      chart.timeScale().fitContent();

      ro = new ResizeObserver(() => {
        if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
      });
      ro.observe(containerRef.current);
    });

    return () => {
      disposed = true;
      ro?.disconnect();
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.kind, props.data]);

  return <div ref={containerRef} className="w-full" style={{ height: props.height ?? 300 }} />;
}
