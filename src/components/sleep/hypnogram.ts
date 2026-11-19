/**
 * ARGON v6.0 — Hypnogram Rendering Component
 * Renders sleep stage timeline (hypnogram) from segmentations data.
 * Import from: import { renderHypnogram } from '@/components/sleep/hypnogram';
 */

import { fmtHHMM } from '@/utils/date';
import { fmtPct, fmtDuration, stageColor } from '@/utils/format';
import type { SleepSegmentation } from '@/api/schemas';

interface HypnogramData {
  stages: number[];
  deep_flag?: boolean[];
  epoch_sec?: number;
  session_start: string;
  sleep_onset?: string;
  sleep_offset?: string;
  session_end: string;
  confidence?: number;
  unobserved_sec?: number;
}

interface HypnogramOptions {
  containerId: string;
  data: HypnogramData | null;
  timezone?: string;
}

/**
 * Render hypnogram SVG visualization
 */
export function renderHypnogram(options: HypnogramOptions): void {
  const { containerId, data, timezone } = options;
  const el = document.getElementById(containerId);
  if (!el) return;

  if (!data || !data.stages?.length) {
    el.innerHTML = '<p class="text-slate-400 text-center py-8">Sin datos de hipnograma para esta noche</p>';
    return;
  }

  const stages = data.stages;
  const deepFlags = data.deep_flag || [];
  const epochSec = data.epoch_sec || 30;
  const sessionStart = new Date(data.session_start).getTime();
  const sleepOnset = data.sleep_onset ? new Date(data.sleep_onset).getTime() : null;
  const sleepOffset = data.sleep_offset ? new Date(data.sleep_offset).getTime() : null;

  const totalEpochs = stages.length;
  const totalMinutes = (totalEpochs * epochSec) / 60;
  const W = Math.min(600, totalEpochs * 4);
  const H = 80;

  // Count minutes per stage
  const counts = { 0: 0, 1: 0, 2: 0 };
  let deepMin = 0;
  stages.forEach((s, i) => {
    counts[s] = (counts[s] || 0) + epochSec / 60;
    if (s === 1 && deepFlags[i]) deepMin += epochSec / 60;
  });

  const rects = stages.map((s, i) => {
    const x = (i / totalEpochs) * W;
    const w = Math.max(1, W / totalEpochs);
    const y = s === 0 ? 10 : s === 1 ? 30 : 50;
    const color = deepFlags[i] && s === 1 ? '#1e40af' : stageColor(s + 1);
    return `<rect x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="16" rx="1" fill="${color}" data-stage="${s}" data-epoch="${i}" data-time="${fmtHHMM(sessionStart + i * epochSec * 1000)}" />`;
  }).join('');

  // Time markers every hour
  const timeMarkers = [];
  for (let h = 0; h <= Math.ceil(totalMinutes / 60); h++) {
    const x = (h * 60 / totalMinutes) * W;
    const label = fmtHHMM(sessionStart + h * 60 * 60 * 1000);
    timeMarkers.push(`<text x="${x}" y="${H - 2}" font-size="8" fill="#64748b" text-anchor="middle">${label}</text>`);
  }

  // Sleep onset/offset markers
  let onsetMarker = '', offsetMarker = '';
  if (sleepOnset && sleepOffset) {
    const onsetX = ((sleepOnset - sessionStart) / 1000 / epochSec / totalEpochs) * W;
    const offsetX = ((sleepOffset - sessionStart) / 1000 / epochSec / totalEpochs) * W;
    onsetMarker = `<line x1="${onsetX}" y1="0" x2="${onsetX}" y2="${H}" stroke="#10b981" stroke-width="2" stroke-dasharray="4,4" />`;
    offsetMarker = `<line x1="${offsetX}" y1="0" x2="${offsetX}" y2="${H}" stroke="#ef4444" stroke-width="2" stroke-dasharray="4,4" />`;
  }

  // Stage legend
  const stageLabels = { 0: 'Despierto', 1: 'NREM', 2: 'REM' };
  const legend = Object.entries({ 0: '#94a3b8', 1: '#3b82f6', 2: '#a855f7' }).map(([k, v]) => {
    const label = stageLabels[Number(k)];
    const count = counts[Number(k)] || 0;
    const c = k === '1'
      ? `<span style="color:${v}">■</span> ${label} ${fmtDuration(count)} <span style="color:#1e40af">(Deep ${fmtDuration(deepMin)})</span>`
      : `<span style="color:${v}">■</span> ${label} ${fmtDuration(count)}`;
    return c;
  }).join(' · ');

  const efficiency = sleepOnset && sleepOffset
    ? (sleepOffset - sleepOnset) / (new Date(data.session_end).getTime() - new Date(data.session_start).getTime()) * 100
    : 0;

  el.innerHTML = `
    <div class="space-y-2">
      <div class="flex items-center justify-between text-xs">
        <span class="text-slate-400">${fmtHHMM(sessionStart)} → ${fmtHHMM(sessionStart + totalMinutes * 60000)}</span>
        <span class="text-slate-300 font-mono">${fmtDuration(totalMinutes)} en cama · Eficiencia ${fmtPct(efficiency)}</span>
      </div>
      <div class="relative" style="width:${W}px;height:${H}px">
        <svg viewBox="0 0 ${W} ${H}" class="w-full h-full" style="max-width:100%">
          <!-- Stage rows backgrounds -->
          <rect x="0" y="8" width="${W}" height="20" fill="rgba(59,130,246,0.05)"/>
          <rect x="0" y="28" width="${W}" height="20" fill="rgba(168,85,247,0.05)"/>
          <rect x="0" y="48" width="${W}" height="20" fill="rgba(148,163,184,0.05)"/>
          ${onsetMarker}
          ${offsetMarker}
          ${rects}
          ${timeMarkers.join('')}
          <!-- Stage labels on left -->
          <text x="2" y="22" font-size="8" fill="#64748b">NREM</text>
          <text x="2" y="42" font-size="8" fill="#64748b">REM</text>
          <text x="2" y="62" font-size="8" fill="#64748b">Wake</text>
        </svg>
      </div>
      <div class="text-[10px] text-slate-400 flex flex-wrap gap-3">${legend}</div>
      <div class="text-[10px] text-slate-500">
        Confianza: ${(data.confidence ? data.confidence * 100 : 0).toFixed(0)}% · Épocas: ${totalEpochs} × ${epochSec}s · Sin datos: ${data.unobserved_sec || 0}s
      </div>
    </div>
  `;
}

/**
 * Create hypnogram from sleep segmentation record
 */
export function createHypnogramData(seg: SleepSegmentation): HypnogramData {
  return {
    stages: seg.stages || [],
    deep_flag: seg.deep_flag,
    epoch_sec: seg.epoch_sec,
    session_start: seg.session_start,
    sleep_onset: seg.sleep_onset,
    sleep_offset: seg.sleep_offset,
    session_end: seg.session_end,
    confidence: seg.confidence,
    unobserved_sec: seg.unobserved_sec,
  };
}