/**
 * ARGON v6.0 — MBE Utility Functions
 * Shared utility functions for MBE components.
 * Import from: import { card, note, empty, pace, isSeed, retrain, ltCalc, getSelectedDay } from '@/components/mbe/utils';
 */

import { getTimezone, todayIso, m18 as m18util, addDays } from '@/utils/date';
import { fmtPct, stageColor } from '@/utils/format';
import { mean, sd as sdUtil } from '@/utils/math';
import type { ComputedDailyScore, RawBiometric } from '@/api/schemas';

const ACC = {
  cyan: '#22d3ee',
  emerald: '#34d399',
  violet: '#a78bfa',
  amber: '#fbbf24',
  rose: '#fb7185',
};

// Re-export mean for use in sections
export { mean };

const TZ = getTimezone();

const LS = (key: string, def: any) => {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : def;
  } catch {
    return def;
  }
};

const hhmm = (ms: number): string => {
  const d = new Date(ms);
  return d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
};

const pace = (p: number): string => {
  const m = Math.floor(p);
  const s = Math.round((p - m) * 60);
  return `${m}:${String(s === 60 ? 0 : s).padStart(2, '0')}`;
};

const isSeed = (r: RawBiometric) => parseFloat(r.rmssd_ms) === 50 && parseFloat(r.rhr_bpm) === 54.5;

function retrain(strain: number, rec: number | null, debtH: number, hoursSince: number) {
  const base = strain < 8 ? 12 : strain < 12 ? 24 : strain < 16 ? 36 : 48;
  const f = rec == null ? 1 : rec >= 67 ? 0.85 : rec < 34 ? 1.3 : 1;
  const need = Math.round(base * f * (debtH > 2 ? 1.1 : 1));
  return { need, left: Math.max(0, Math.round(need - hoursSince)) };
}

function ltCalc(km: number, hr: number) {
  const p30 = 30 / km;
  const zs = [
    ['Z1 Recuperación', 0, 0.85],
    ['Z2 Aeróbica', 0.85, 0.89],
    ['Z3 Tempo', 0.90, 0.94],
    ['Z4 Sub-umbral', 0.95, 0.99],
    ['Z5a Super-umbral', 1, 1.02],
    ['Z5b Capacidad aeróbica', 1.03, 1.06],
  ];
  return {
    lthr: Math.round(hr),
    p30,
    pThr: p30 * 1.04,
    zones: zs.map(z => [z[0], z[1] ? Math.round(hr * z[1]) : 0, Math.round(hr * z[2])]),
  };
}

const card = (title: string, subtitle: string, body: string) =>
  `<section class="native-card p-4 space-y-2.5"><div><h4 class="text-[11px] font-extrabold uppercase tracking-wider text-cyan-300">${title}</h4><p class="text-[10px] text-slate-400">${subtitle}</p></div>${body}</section>`;

const note = (text: string) => `<p class="text-[10px] text-slate-400 leading-snug">${text}</p>`;

const empty = (text: string) => `<p class="text-[11px] text-amber-300/90">${text}</p>`;

const ex = (r: RawBiometric) => (r && r.hr_zones_minutes && r.hr_zones_minutes.x) || {};

function getSelectedDay(state: { raw: RawBiometric[]; comp: ComputedDailyScore[]; selectedDate: string | null }) {
  const target = state.selectedDate;
  if (!target) return { raw: state.raw[0], comp: state.comp[0] };
  const raw = state.raw.find(r => r && r.log_date === target) || state.raw[0];
  const comp = state.comp.find(c => c && c.log_date === target) || state.comp[0];
  return { raw, comp };
}

export { ACC, TZ, LS, hhmm, pace, isSeed, retrain, ltCalc, card, note, empty, ex, getSelectedDay };