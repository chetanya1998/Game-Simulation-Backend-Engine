import { useEffect, useRef } from 'react';
import { BarChart, LineChart } from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components';
import { init, use, type EChartsCoreOption, type ECharts } from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';

use([
  LineChart,
  BarChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  MarkLineComponent,
  SVGRenderer,
]);

/** Colour-blind-safe series colours (Okabe–Ito), readable on both themes. */
export const PALETTE = [
  '#0072B2',
  '#E69F00',
  '#009E73',
  '#CC79A7',
  '#56B4E9',
  '#D55E00',
  '#F0E442',
  '#999999',
];

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Theme-aware base options; the caller's options are merged on top. */
function themed(option: EChartsCoreOption): EChartsCoreOption {
  const fg = cssVar('--fg') || '#1a1a1a';
  // ECharts measures text itself: give it the real font, or legend labels overlap.
  const font = getComputedStyle(document.body).fontFamily || 'sans-serif';
  const muted = cssVar('--muted') || '#666';
  const grid = cssVar('--line') || '#ddd';
  const axis = {
    axisLine: { lineStyle: { color: muted } },
    axisLabel: { color: muted },
    splitLine: { lineStyle: { color: grid } },
    nameTextStyle: { color: muted },
    nameLocation: 'middle',
    nameGap: 30,
  };
  const fix = (a: unknown): unknown =>
    Array.isArray(a)
      ? a.map((x) => ({ ...axis, ...(x as object) }))
      : a === undefined
        ? undefined
        : { ...axis, ...(a as object) };
  return {
    color: PALETTE,
    backgroundColor: 'transparent',
    textStyle: { color: fg, fontFamily: font },
    animation: false,
    tooltip: {
      trigger: 'axis',
      backgroundColor: cssVar('--panel') || '#fff',
      textStyle: { color: fg },
      borderColor: grid,
    },
    legend: { textStyle: { color: fg, fontFamily: font }, top: 0, type: 'scroll', itemGap: 18 },
    grid: { left: 56, right: 24, top: 48, bottom: 44, containLabel: true },
    ...option,
    xAxis: fix(option['xAxis']),
    yAxis: fix(option['yAxis']),
  };
}

export function EChart({
  option,
  height = 280,
  label,
  theme,
}: {
  option: EChartsCoreOption;
  height?: number;
  label: string;
  theme: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | undefined>(undefined);
  useEffect(() => {
    if (ref.current === null) return;
    chart.current = init(ref.current, undefined, { renderer: 'svg' });
    const observer = new ResizeObserver(() => chart.current?.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.current?.dispose();
    };
  }, []);
  useEffect(() => {
    chart.current?.setOption(themed(option), true);
  }, [option, theme]);
  return <div ref={ref} role="img" aria-label={label} className="chart" style={{ height }} />;
}
