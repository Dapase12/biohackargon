/**
 * ARGON v6.0 — MBE Bed Time Section
 * Renders optimal bedtime window.
 * Import from: import { renderBedTime } from '@/components/mbe/sections/bed-time';
 */

import { m18 as m18util } from '@/utils/date';
import { card, note, empty, getSelectedDay, ex } from '../utils';
import type { ComputedDailyScore, RawBiometric } from '@/api/schemas';

interface BedTimeOptions {
  state: { raw: RawBiometric[]; comp: ComputedDailyScore[]; selectedDate: string | null };
}

/**
 * Render bed time section
 */
export function renderBedTime(options: BedTimeOptions): string {
  const { state } = options;
  const { comp: c, raw: r0 } = getSelectedDay(state);
  if (!c || !c.optimal_bedtime_start) return card('Hora de dormir', 'Ventana óptima', empty('Sin datos calculados.'));
  const prof = LS('argon_profile_v1', {});
  const wake = prof.wake || '06:00';
  const span = 1080;
  const x = (m: number) => Math.max(0, Math.min(100, m / span * 100));
  const a = m18util(c.optimal_bedtime_start);
  const b = m18util(c.optimal_bedtime_end);
  const w = m18util(wake);
  const h = ex(r0).hypno;
  let real = '';
  if (h && h.seg && h.seg.length) {
    const s0 = m18util(hhmm(h.t0));
    const last = h.seg[h.seg.length - 1];
    const len = last[1] + last[2];
    real = `<div class="absolute top-1 h-2 rounded bg-purple-500/80" style="left:${x(s0)}%;width:${Math.max(1, x(s0 + len) - x(s0))}%" title="Sueño real"></div>`;
  }
  const ticks = [18, 21, 0, 3, 6, 9, 12].map(hh =>
    `<span class="absolute text-[9px] text-slate-500" style="left:${x(m18util(String(hh).padStart(2, '0') + ':00'))}%;top:28px;transform:translateX(-50%)">${String(hh).padStart(2, '0')}h</span>`
  ).join('');
  const bar = `<div class="relative h-12 rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
    <div class="absolute inset-y-0 bg-emerald-500/30 border-x border-emerald-400" style="left:${x(a)}%;width:${Math.max(2, x(b) - x(a))}%"></div>
    ${real}
    <div class="absolute inset-y-0 w-0.5 bg-amber-400" style="left:${x(w)}%"></div>
    ${ticks}
  </div>`;
  return card('🌙 Hora de dormir recomendada', 'Línea verde = ventana · violeta = sueño real · ámbar = despertar',
    `<div class="flex items-end justify-between">
      <div>
        <div class="text-2xl font-black font-mono text-emerald-400">${c.optimal_bedtime_start.slice(0, 5)}–${c.optimal_bedtime_end.slice(0, 5)}</div>
        <div class="text-[10px] text-slate-400">Necesidad hoy: ${c.dynamic_sleep_need_hours} h · despertar ${wake}</div>
      </div>
    </div>${bar}` +
    note('Ventana = despertar − (necesidad dinámica ÷ eficiencia). La necesidad base (7.5 h) es un valor personal calibrable; el rango poblacional adulto es 7–9 h (AASM/SRS, Watson 2015).')
  );
}

// Import LS and hhmm from utils
import { LS, hhmm } from '../utils';