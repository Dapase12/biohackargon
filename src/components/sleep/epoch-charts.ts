/**
 * ARGON v6.0 — Epoch Charts Component
 * Renders HR, HRV, and movement (ENMO) across sleep epochs using ApexCharts.
 * Import from: import { renderEpochCharts } from '@/components/sleep/epoch-charts';
 */

import { getTimezone } from '@/utils/date';
import type { SleepEpochFeature } from '@/api/schemas';

interface EpochChartsOptions {
  containerId: string;
  epochFeatures: SleepEpochFeature[];
  timezone?: string;
}

/**
 * Render epoch-level charts (HR, RMSSD, ENMO) with stage backgrounds
 */
export function renderEpochCharts(options: EpochChartsOptions): void {
  const { containerId, epochFeatures, timezone } = options;
  const el = document.getElementById(containerId);
  if (!el) return;

  if (!epochFeatures.length) {
    el.innerHTML = '<p class="text-slate-400 text-center py-8">Sin datos de épocas para esta noche</p>';
    return;
  }

  if (typeof ApexCharts === 'undefined') {
    el.innerHTML = '<p class="text-slate-400 text-center py-8">ApexCharts no cargado</p>';
    return;
  }

  const epochs = epochFeatures;
  const tz = timezone || getTimezone();
  const times = epochs.map(e => {
    const d = new Date(e.epoch_start);
    return d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
  });

  const hr = epochs.map(e => e.hr_median);
  const rmssd = epochs.map(e => e.rmssd_ms);
  const enmo = epochs.map(e => e.enmo_median);
  const stages = epochs.map(e => e.stage);

  // Create stage background areas
  const stageAreas = [];
  let currentStage = stages[0];
  let startIdx = 0;
  for (let i = 1; i <= stages.length; i++) {
    if (i === stages.length || stages[i] !== currentStage) {
      const color = currentStage === 0 ? 'rgba(148,163,184,0.15)' : currentStage === 1 ? 'rgba(59,130,246,0.15)' : 'rgba(168,85,247,0.15)';
      stageAreas.push({
        x1: startIdx,
        x2: i - 1,
        color,
      });
      if (i < stages.length) {
        currentStage = stages[i];
        startIdx = i;
      }
    }
  }

  const options_ = {
    series: [
      { name: 'FC (lpm)', data: hr, color: '#ef4444', type: 'line' },
      { name: 'RMSSD (ms)', data: rmssd, color: '#22d3ee', type: 'line', yAxisIndex: 1 },
      { name: 'ENMO (g)', data: enmo, color: '#10b981', type: 'area', yAxisIndex: 2, fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.3, opacityTo: 0.05 } } },
    ],
    chart: { type: 'line', height: 320, toolbar: { show: false }, fontFamily: 'Inter, sans-serif', animations: { enabled: true } },
    colors: ['#ef4444', '#22d3ee', '#10b981'],
    stroke: { width: [2, 2, 1], curve: 'smooth' },
    fill: { type: ['none', 'none', 'gradient'] },
    markers: { size: 0, hover: { size: 4 } },
    xaxis: {
      categories: times,
      labels: { style: { colors: '#94a3b8', fontSize: '9px' }, show: true },
      axisBorder: { show: false },
      axisTicks: { show: false },
      tooltip: { enabled: true },
    },
    yaxis: [
      { title: { text: 'FC (lpm)', style: { color: '#ef4444', fontSize: '10px' } }, labels: { style: { colors: '#ef4444', fontSize: '10px' }, formatter: (v: number) => v.toFixed(0) }, min: 30, max: 180 },
      { title: { text: 'RMSSD (ms)', style: { color: '#22d3ee', fontSize: '10px' } }, labels: { style: { colors: '#22d3ee', fontSize: '10px' }, formatter: (v: number) => v.toFixed(0) }, opposite: true, min: 0 },
      { title: { text: 'ENMO (g)', style: { color: '#10b981', fontSize: '10px' } }, labels: { style: { colors: '#10b981', fontSize: '10px' }, formatter: (v: number) => v.toFixed(3) }, opposite: true, min: 0 },
    ],
    grid: { borderColor: 'rgba(255,255,255,0.05)', row: { colors: ['transparent', 'rgba(255,255,255,0.02)'] }, padding: { left: 10, right: 10 } },
    legend: { show: true, position: 'top', fontSize: '10px', labels: { colors: '#94a3b8' } },
    tooltip: {
      theme: 'dark',
      shared: true,
      x: { format: 'HH:mm', show: true },
      y: {
        formatter: (val: number, { seriesIndex }: { seriesIndex: number }) => {
          if (seriesIndex === 0) return val.toFixed(0) + ' lpm';
          if (seriesIndex === 1) return val.toFixed(0) + ' ms';
          return val.toFixed(3) + ' g';
        },
      },
    },
    annotations: {
      xaxis: stageAreas.map(a => ({
        x: a.x1,
        x2: a.x2,
        fillColor: a.color,
      })),
    },
  };

  if (el._chart) el._chart.destroy();
  el._chart = new ApexCharts(el, options_);
  el._chart.render();
}