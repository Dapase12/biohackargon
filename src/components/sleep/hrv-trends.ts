/**
 * ARGON v6.0 — HRV Trends Chart Component
 * Renders HRV trends (RMSSD, LF/HF, RK) using ApexCharts.
 * Import from: import { renderHrvTrends } from '@/components/sleep/hrv-trends';
 */

import type { SleepNightObservation, ComputedDailyScore } from '@/api/schemas';

interface HrvTrendsOptions {
  containerId: string;
  nightObservations: SleepNightObservation[];
  dailyScores: ComputedDailyScore[];
}

/**
 * Render HRV trends chart with RMSSD, LF/HF, and Resting HR
 */
export function renderHrvTrends(options: HrvTrendsOptions): void {
  const { containerId, nightObservations, dailyScores } = options;
  const el = document.getElementById(containerId);
  if (!el) return;

  const obs = nightObservations.slice().reverse();
  if (!obs.length) {
    el.innerHTML = '<p class="text-slate-400 text-center py-8">Sin datos de VFC nocturnos</p>';
    return;
  }

  const dates = obs.map(o => o.log_date);
  const rmssd = obs.map(o => o.rmssd_med_ms);
  const lfhf = obs.map(o => o.lfhf_med);
  const rk = obs.map(o => o.rk_med_bpm);

  const daily = dailyScores.slice().reverse();
  const recovery = daily.map(d => d.recovery_score);

  if (typeof ApexCharts === 'undefined') {
    el.innerHTML = '<p class="text-slate-400 text-center py-8">ApexCharts no cargado</p>';
    return;
  }

  const options_ = {
    series: [
      { name: 'RMSSD (ms)', data: rmssd, type: 'line', color: '#22d3ee' },
      { name: 'LF/HF', data: lfhf, type: 'line', color: '#a855f7', yAxisIndex: 1 },
      { name: 'RK (bpm)', data: rk, type: 'line', color: '#fbbf24', yAxisIndex: 2 },
    ],
    chart: { type: 'line', height: 280, toolbar: { show: false }, fontFamily: 'Inter, sans-serif' },
    colors: ['#22d3ee', '#a855f7', '#fbbf24'],
    stroke: { width: 2, curve: 'smooth' },
    markers: { size: 3 },
    xaxis: { categories: dates, labels: { style: { colors: '#94a3b8', fontSize: '10px' } }, axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: [
      { title: { text: 'RMSSD (ms)', style: { color: '#22d3ee', fontSize: '10px' } }, labels: { style: { colors: '#22d3ee', fontSize: '10px' }, formatter: (v: number) => v.toFixed(0) }, min: 0 },
      { title: { text: 'LF/HF', style: { color: '#a855f7', fontSize: '10px' } }, labels: { style: { colors: '#a855f7', fontSize: '10px' }, formatter: (v: number) => v.toFixed(2) }, opposite: true, min: 0 },
      { title: { text: 'RK (bpm)', style: { color: '#fbbf24', fontSize: '10px' } }, labels: { style: { colors: '#fbbf24', fontSize: '10px' }, formatter: (v: number) => v.toFixed(1) }, opposite: true, min: 0 },
    ],
    grid: { borderColor: 'rgba(255,255,255,0.05)', row: { colors: ['transparent', 'rgba(255,255,255,0.02)'] } },
    legend: { show: true, position: 'top', fontSize: '10px', labels: { colors: '#94a3b8' } },
    tooltip: { theme: 'dark', shared: true, x: { format: 'dd MMM' } },
  };

  if (el._chart) el._chart.destroy();
  el._chart = new ApexCharts(el, options_);
  el._chart.render();
}