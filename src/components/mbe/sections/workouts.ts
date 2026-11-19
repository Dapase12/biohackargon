/**
 * ARGON v6.0 — MBE Workouts Section
 * Renders recent workouts from raw biometrics.
 * Import from: import { renderWorkouts } from '@/components/mbe/sections/workouts';
 */

import { card, note, empty, getSelectedDay, ex, mean } from '../utils';
import type { RawBiometric, ComputedDailyScore } from '@/api/schemas';

interface WorkoutsOptions {
  state: { raw: RawBiometric[]; comp: ComputedDailyScore[]; selectedDate: string | null };
}

/**
 * Render workouts section
 */
export function renderWorkouts(options: WorkoutsOptions): string {
  const { state } = options;
  const { raw: r0 } = getSelectedDay(state);
  const list: any[] = [];
  state.raw.slice(0, 7).forEach(r => (ex(r).workouts || []).forEach(w => list.push(Object.assign({ date: r.log_date }, w))));
  list.sort((a, b) => (b.end_ms || 0) - (a.end_ms || 0));
  const body = list.length
    ? list.slice(0, 8).map(w =>
      `<div class="flex items-center justify-between p-2 rounded-xl bg-slate-900 text-xs">
        <div>
          <div class="font-bold">${w.type}</div>
          <div class="text-[10px] text-slate-400">${w.date.slice(5)} · ${w.start || '--'}–${w.end || '--'}</div>
        </div>
        <div class="text-right font-mono">
          <div>${w.min} min</div>
          <div class="text-[10px] text-amber-300">${w.kcal != null ? (w.kcal_est ? '~' : '') + w.kcal + ' kcal' : 'kcal n/d'}${w.avg_hr ? ' · ' + w.avg_hr + ' lpm' : ''}</div>
          <div class="text-[9px] text-slate-400">${w.dist_m ? (w.dist_m / 1000).toFixed(2) + ' km' : ''}${w.steps ? ' · ' + w.steps + ' pasos' : ''}${w.max_hr ? ' · máx ' + w.max_hr : ''}</div>
        </div>
      </div>`
    ).join('')
    : empty('Sin entrenamientos guardados. Se llenan con el próximo webhook de ejercicio (Code.txt actualizado).');
  const rr: [number, number][] = [];
  state.raw.slice(1, 8).forEach(r => {
    const z = ex(r).active_kcal;
    const c = state.comp.find(q => q.log_date === r.log_date);
    const tmb = parseFloat(r.tmb_kcal);
    if (z && c && tmb && c.dynamic_tdee_kcal) {
      const ap = c.dynamic_tdee_kcal - tmb * 1.05;
      if (ap > 50) rr.push([z, ap]);
    }
  });
  const calTxt = rr.length >= 3
    ? `<div class="text-[11px] text-amber-300">Calibración: kcal "activas" de Zepp ≈ ×${(mean(rr.map(q => q[0])) / mean(rr.map(q => q[1]))).toFixed(2)} vs estimación ARGON (${rr.length} días). La dieta usa la de ARGON.</div>`
    : '';
  return card('🏃 Entrenamientos recientes (Zepp)', 'Últimos 7 días' + (ex(r0).active_kcal ? ' · kcal activas día seleccionado (Zepp): ' + ex(r0).active_kcal : ''), body + calTxt + note('Zepp no envía kcal por sesión: las marcadas con ~ se estiman con la FC (Keytel 2005, fórmula masculina; error típico ±20–30%, tiende a sobreestimar con FC baja). No se suman a la ingesta ni se usan para "comer lo quemado".'));
}