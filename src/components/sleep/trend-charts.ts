/**
 * ARGON v6.0 — Trend Charts Component
 * Renders 7/14/30 day trend charts for sleep metrics using ApexCharts.
 * Import from: import { renderTrendCharts } from '@/components/sleep/trend-charts';
 */

import type { ComputedDailyScore } from '@/api/schemas';

interface TrendChartsOptions {
  containerId: string;
  dailyScores: ComputedDailyScore[];
}

/**
 * Render trend charts (TST, efficiency, SWS%, REM%, sleep debt)
 */
export function renderTrendCharts(options: TrendChartsOptions): void {
  const { containerId, dailyScores } = options;
  const el = document.getElementById(containerId);
  if (!el) return;

  const daily = dailyScores.slice().reverse();
  if (!daily.length) {
    el.innerHTML = '<p class="text-slate-400 text-center py-8">Sin datos de tendencias</p>';
    return;
  }

  if (typeof ApexCharts === 'undefined') {
    el.innerHTML = '<p class="text-slate-400 text-center py-8">ApexCharts no cargado</p>';
    return;
  }

  const dates = daily.map(d => d.log_date);
  const tst = daily.map(d => d.total_sleep_min / 60);
  const efficiency = daily.map(d => d.sleep_efficiency_pct);
  const deepPct = daily.map(d => d.total_sleep_min > 0 ? (d.deep_sleep_min / d.total_sleep_min * 100) : 0);
  const remPct = daily.map(d => d.total_sleep_min > 0 ? (d.rem_sleep_min / d.total_sleep_min * 100) : 0);
  const debt = daily.map(d => d.sleep_debt_hours || 0);

  const options_ = {
    series: [
      { name: 'TST (h)', data: tst, color: '#8b5cf6', type: 'line' },
      { name: 'Eficiencia (%)', data: efficiency, color: '#10b981', type: 'line', yAxisIndex: 1 },
      { name: 'SWS (%)', data: deepPct, color: '#3b82f6', type: 'line', yAxisIndex: 1 },
      { name: 'REM (%)', data: remPct, color: '#a855f7', type: 'line', yAxisIndex: 1 },
      { name: 'Deuda (h)', data: debt, color: '#ef4444', type: 'area', yAxisIndex: 2, fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.3, opacityTo: 0 } } },
    ],
    chart: { type: 'line', height: 300, toolbar: { show: false }, fontFamily: 'Inter, sans-serif' },
    colors: ['#8b5cf6', '#10b981', '#3b82f6', '#a855f7', '#ef4444'],
    stroke: { width: [2, 2, 2, 2, 1], curve: 'smooth' },
    markers: { size: 3 },
    xaxis: { categories: dates, labels: { style: { colors: '#94a3b8', fontSize: '10px' } }, axisBorder: { show: false } },
    yaxis: [
      { title: { text: 'Horas', style: { color: '#8b5cf6', fontSize: '10px' } }, labels: { style: { colors: '#8b5cf6', fontSize: '10px' }, formatter: (v: number) => v.toFixed(1) }, min: 0 },
      { title: { text: '%', style: { color: '#10b981', fontSize: '10px' } }, labels: { style: { colors: '#10b981', fontSize: '10px' }, formatter: (v: number) => v.toFixed(0) }, opposite: true, min: 0, max: 100 },
      { title: { text: 'Deuda (h)', style: { color: '#ef4444', fontSize: '10px' } }, labels: { style: { colors: '#ef4444', fontSize: '10px' }, formatter: (v: number) => v.toFixed(1) }, opposite: true, min: 0 },
    ],
    grid: { borderColor: 'rgba(255,255,255,0.05)' },
    legend: { show: true, position: 'top', fontSize: '10px', labels: { colors: '#94a3b8' } },
    tooltip: { theme: 'dark', shared: true, x: { format: 'dd MMM' } },
  };

  if (el._chart) el._chart.destroy();
  el._chart = new ApexCharts(el, options_);
  el._chart.render();
}