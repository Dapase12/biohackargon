/**
 * ARGON v6.0 — Sleep Scores Cards Component
 * Renders sleep score cards (TST, efficiency, debt, stages, HRV).
 * Import from: import { renderSleepScores } from '@/components/sleep/sleep-scores';
 */

import { fmtDuration, fmtPct } from '@/utils/format';
import { stageColor } from '@/utils/format';
import type { SleepSegmentation, ComputedDailyScore, SleepNightObservation, SleepUserProfile } from '@/api/schemas';

interface SleepScoresOptions {
  containerId: string;
  segmentation: SleepSegmentation | null;
  dailyScore: ComputedDailyScore | null;
  nightObservation: SleepNightObservation | null;
  userProfile: SleepUserProfile | null;
}

/**
 * Render sleep scores cards
 */
export function renderSleepScores(options: SleepScoresOptions): void {
  const { containerId, segmentation, dailyScore, nightObservation, userProfile } = options;
  const el = document.getElementById(containerId);
  if (!el) return;

  if (!segmentation && !dailyScore) {
    el.innerHTML = '<p class="text-slate-400 text-center py-8">Sin puntuaciones de sueño para hoy</p>';
    return;
  }

  const tst = dailyScore?.total_sleep_min || (segmentation?.sleep_onset && segmentation?.sleep_offset ?
    Math.round((new Date(segmentation.sleep_offset).getTime() - new Date(segmentation.sleep_onset).getTime()) / 60000) : 0);
  const deepMin = dailyScore?.deep_sleep_min || 0;
  const remMin = dailyScore?.rem_sleep_min || 0;
  const lightMin = dailyScore?.light_sleep_min || 0;
  const efficiency = dailyScore?.sleep_efficiency_pct || 0;
  const waso = dailyScore?.waso_min || 0;
  const tib = dailyScore?.time_in_bed_min || (segmentation ? Math.round((new Date(segmentation.session_end).getTime() - new Date(segmentation.session_start).getTime()) / 60000) : 0);
  const debt = dailyScore?.sleep_debt_hours || 0;
  const need = dailyScore?.dynamic_sleep_need_hours || 7.5;

  const deepPct = tst > 0 ? (deepMin / tst * 100).toFixed(1) : 0;
  const remPct = tst > 0 ? (remMin / tst * 100).toFixed(1) : 0;
  const lightPct = tst > 0 ? (lightMin / tst * 100).toFixed(1) : 0;

  const rmssd = nightObservation?.rmssd_med_ms;
  const lfhf = nightObservation?.lfhf_med;
  const hrSleep = nightObservation?.hr_sleep_median;
  const hrArousal = nightObservation?.hr_arousal;

  const profile = userProfile;
  const rmssdBase = profile?.rmssd_med_ms;
  const rmssdMad = profile?.rmssd_mad_ms;

  el.innerHTML = `
    <div class="space-y-3">
      <!-- Main sleep rings -->
      <div class="grid grid-cols-3 gap-3">
        ${sleepRing('TST', fmtDuration(tst), tst > 0 ? Math.min(100, tst / (need * 60) * 100) : 0, '#8b5cf6', 'sleep-tst-ring')}
        ${sleepRing('Eficiencia', efficiency + '%', efficiency, efficiency >= 85 ? '#10b981' : efficiency >= 70 ? '#f59e0b' : '#ef4444', 'sleep-eff-ring')}
        ${sleepRing('Deuda', debt > 0 ? '+' + debt.toFixed(1) + 'h' : '0h', debt > 0 ? Math.min(100, debt / 5 * 100) : 100, debt > 2 ? '#ef4444' : debt > 0 ? '#f59e0b' : '#10b981', 'sleep-debt-ring')}
      </div>

      <!-- Stage breakdown -->
      <div class="p-3 rounded-2xl bg-slate-950/60 border border-slate-800/50">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Arquitectura del Sueño</div>
        <div class="w-full h-6 rounded-full bg-slate-900 overflow-hidden flex border border-slate-800 mb-2">
          <div class="bg-blue-500 h-full transition-all duration-500" style="width: ${deepPct}%"></div>
          <div class="bg-purple-500 h-full transition-all duration-500" style="width: ${remPct}%"></div>
          <div class="bg-slate-600 h-full transition-all duration-500" style="width: ${lightPct}%"></div>
        </div>
        <div class="flex justify-between text-[10px] text-slate-300 font-medium">
          <span class="text-blue-400">🟦 Profundo (SWS): ${fmtDuration(deepMin)} (${deepPct}%)</span>
          <span class="text-purple-400">🟪 REM: ${fmtDuration(remMin)} (${remPct}%)</span>
          <span class="text-slate-400">⬜ Ligero: ${fmtDuration(lightMin)} (${lightPct}%)</span>
        </div>
      </div>

      <!-- Metrics grid -->
      <div class="grid grid-cols-2 gap-2">
        ${metricCard('TIB', fmtDuration(tib), 'Tiempo en cama', '#64748b')}
        ${metricCard('WASO', fmtDuration(waso), 'Despertares tras inicio', waso > 30 ? '#ef4444' : '#10b981')}
        ${metricCard('Latencia', segmentation?.sleep_onset && segmentation?.session_start ?
          fmtDuration(Math.round((new Date(segmentation.sleep_onset).getTime() - new Date(segmentation.session_start).getTime()) / 60000)) : '--', 'Inicio de sueño', '#22d3ee')}
        ${metricCard('Necesidad', need.toFixed(1) + 'h', 'Necesidad dinámica', '#a855f7')}
      </div>

      <!-- HRV card -->
      ${rmssd ? `
      <div class="p-3 rounded-2xl bg-slate-950/60 border border-slate-800/50">
        <div class="text-[10px] font-bold uppercase tracking-wider text-emerald-400 mb-2">VFC Nocturna (HRV)</div>
        <div class="grid grid-cols-3 gap-2 text-center">
          <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">RMSSD</div><div class="font-mono font-black text-emerald-300">${rmssd.toFixed(0)} ms</div></div>
          <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">LF/HF</div><div class="font-mono font-black text-purple-300">${lfhf ? lfhf.toFixed(2) : '--'}</div></div>
          <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">FC Sueño</div><div class="font-mono font-black text-cyan-300">${hrSleep ? hrSleep.toFixed(0) : '--'} lpm</div></div>
        </div>
        ${rmssdBase && rmssdMad ? `
        <div class="mt-2 text-[10px] text-slate-400">
          Base 14d: ${rmssdBase.toFixed(0)} ms ± ${rmssdMad.toFixed(0)} MAD ·
          Z-score: ${rmssdMad > 0 ? ((rmssd - rmssdBase) / (1.4826 * rmssdMad)).toFixed(2) : '--'} SD
        </div>
        ` : ''}
        ${hrArousal ? `<div class="mt-1 text-[10px] text-amber-400">FC umbral arousal: ${hrArousal.toFixed(0)} lpm</div>` : ''}
      </div>
      ` : ''}
    </div>
  `;
}

function sleepRing(label: string, value: string, pct: number, color: string, id: string) {
  const C = 157; // 2 * PI * 25
  const offset = C - (pct / 100) * C;
  return `
    <div onclick="goToArgonTab(1)" class="flex flex-col items-center cursor-pointer active:scale-95 transition p-3 rounded-2xl bg-slate-950/60 border border-slate-800/50">
      <div class="relative w-20 h-20">
        <svg class="w-full h-full" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="25" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="6"/>
          <circle id="${id}" cx="50" cy="50" r="25" fill="none" stroke="${color}" stroke-width="6"
            stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${offset}"
            transform="rotate(-90 50 50)" style="transition: stroke-dashoffset 0.8s cubic-bezier(0.16,1,0.3,1)"/>
        </svg>
        <div class="absolute inset-0 flex flex-col items-center justify-center">
          <span class="text-lg font-black text-white leading-none">${value}</span>
        </div>
      </div>
      <span class="text-[10px] font-bold text-slate-200 mt-2">${label}</span>
    </div>
  `;
}

function metricCard(label: string, value: string, sub: string, color: string) {
  return `
    <div class="p-3 rounded-2xl bg-slate-950/60 border border-slate-800/50 text-center">
      <div class="text-[9px] text-slate-400">${label}</div>
      <div class="font-mono font-black text-lg" style="color:${color}">${value}</div>
      <div class="text-[9px] text-slate-500">${sub}</div>
    </div>
  `;
}