"use client";

import { useEffect, useRef } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { Candle, PricePoint } from "@/lib/types";

const CHART_COLORS = {
  bg: "transparent",
  text: "#8b8b9a",
  grid: "#1a1a24",
  border: "#23232f",
  up: "#14F195",
  down: "#FF5C5C",
  line: "#14F195",
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

export default function Chart(props: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | ISeriesApi<"Candlestick"> | null>(null);

  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;

    import("lightweight-charts").then(({ createChart, ColorType, CrosshairMode }) => {
      if (disposed || !containerRef.current) return;
      const chart = createChart(containerRef.current, {
        height: props.height ?? 320,
        layout: { background: { type: ColorType.Solid, color: CHART_COLORS.bg }, textColor: CHART_COLORS.text },
        grid: {
          vertLines: { color: CHART_COLORS.grid },
          horzLines: { color: CHART_COLORS.grid },
        },
        rightPriceScale: { borderColor: CHART_COLORS.border },
        timeScale: { borderColor: CHART_COLORS.border, timeVisible: true, secondsVisible: false },
        crosshair: { mode: CrosshairMode.Normal },
        autoSize: true,
      });
      chartRef.current = chart;

      if (props.kind === "candles") {
        const series = chart.addCandlestickSeries({
          upColor: CHART_COLORS.up,
          downColor: CHART_COLORS.down,
          borderVisible: false,
          wickUpColor: CHART_COLORS.up,
          wickDownColor: CHART_COLORS.down,
        });
        series.setData(props.data.map((d) => ({ time: d.ts as number, open: d.o, high: d.h, low: d.l, close: d.c })) as never);
        seriesRef.current = series;
      } else {
        const series = chart.addLineSeries({ color: CHART_COLORS.line, lineWidth: 2 });
        series.setData(props.data.map((d) => ({ time: d.ts as number, value: d.price })) as never);
        seriesRef.current = series;
      }

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

  return <div ref={containerRef} className="w-full" style={{ height: props.height ?? 320 }} />;
}
