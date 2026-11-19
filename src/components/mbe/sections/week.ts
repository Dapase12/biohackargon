/**
 * ARGON v6.0 — MBE Week Section
 * Renders weekly summary card with share functionality.
 * Import from: import { renderWeek, weekStats, mbeShare } from '@/components/mbe/sections/week';
 */

import { card, empty, ACC, mean } from '../utils';
import type { ComputedDailyScore, RawBiometric } from '@/api/schemas';

interface WeekOptions {
  state: { raw: RawBiometric[]; comp: ComputedDailyScore[]; selectedDate: string | null };
}

/**
 * Calculate week stats
 */
export function weekStats(state: { raw: RawBiometric[]; comp: ComputedDailyScore[]; selectedDate: string | null }) {
  const c = state.comp.slice(0, 7);
  const r = state.raw.slice(0, 7);
  if (!c.length) return null;
  const av = (a: number[]) => {
    const v = a.filter(v => isFinite(v));
    return v.length ? mean(v) : NaN;
  };
  return {
    from: c[c.length - 1].log_date,
    to: c[0].log_date,
    rec: av(c.map(x => x.recovery_score == null ? NaN : +x.recovery_score)),
    sleep: av(r.map(x => (parseInt(x.total_sleep_min, 10) || NaN) / 60)),
    steps: av(r.map(x => parseInt(x.steps_count, 10) || NaN)),
    strain: av(c.map(x => parseFloat(x.strain_score))),
    prot: av(c.map(x => x.target_protein_g > 0 ? x.intake_protein_g / x.target_protein_g * 100 : NaN)),
    dw: c.length > 1 ? parseFloat(c[0].trend_weight_kg) - parseFloat(c[c.length - 1].trend_weight_kg) : NaN,
  };
}

const fx = (v: number, d = 0) => isFinite(v) ? v.toFixed(d) : '--';

const t = (l: string, v: string) => `<div class="p-2 rounded-xl bg-slate-900 text-center"><div class="text-[9px] text-slate-400">${l}</div><div class="font-mono font-black text-sm">${v}</div></div>`;

/**
 * Render week section
 */
export function renderWeek(options: WeekOptions): string {
  const { state } = options;
  const w = weekStats(state);
  if (!w) return card('📤 Tarjeta semanal', 'Compartible', empty('Sin datos.'));
  return card('📤 Tarjeta semanal', `${w.from} → ${w.to}`,
    `<div class="grid grid-cols-3 gap-2">
      ${t('Recuperación', fx(w.rec) + '%')}
      ${t('Sueño', fx(w.sleep, 1) + ' h')}
      ${t('Pasos', fx(w.steps).replace(/\B(?=(\d{3})+(?!\d))/g, ','))}
      ${t('Strain', fx(w.strain, 1))}
      ${t('Proteína', fx(w.prot) + '%')}
      ${t('Δ Peso', (isFinite(w.dw) ? (w.dw > 0 ? '+' : '') + w.dw.toFixed(2) : '--') + ' kg')}
    </div>
    <button onclick="mbeShare()" class="w-full py-2.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-black font-black text-xs uppercase tracking-wider">Compartir imagen</button>`
  );
}

/**
 * Share weekly summary as image
 */
export async function mbeShare(): Promise<void> {
  const w = weekStats({ raw: [], comp: [] } as any); // Will be called with actual state from window
  // This is a placeholder - the actual implementation will be in the main module
  console.log('mbeShare called from component');
}