/**
 * ARGON v6.0 — MBE Retrain Section
 * Renders "time to retrain" heuristic.
 * Import from: import { renderRetrain } from '@/components/mbe/sections/retrain';
 */

import { card, note, empty, getSelectedDay, ex, retrain, todayIso } from '../utils';
import type { ComputedDailyScore, RawBiometric } from '@/api/schemas';

interface RetrainOptions {
  state: { raw: RawBiometric[]; comp: ComputedDailyScore[]; selectedDate: string | null };
}

/**
 * Render retrain section
 */
export function renderRetrain(options: RetrainOptions): string {
  const { state } = options;
  const { comp: c, raw: r0 } = getSelectedDay(state);
  if (!c) return card('⏱️ Volver a entrenar', 'Heurística', empty('Sin datos.'));
  let last = null;
  state.raw.slice(0, 4).forEach(r => (ex(r).workouts || []).forEach(w => {
    if (w.end_ms && (!last || w.end_ms > last.end_ms)) last = w;
  }));
  let since: number;
  let src = 'hora real de término';
  if (last) since = (Date.now() - last.end_ms) / 3600000;
  else if (parseFloat((r0 || {}).pickleball_or_gym_minutes) > 0) {
    const e = new Date(r0.log_date + 'T18:00:00-04:00').getTime();
    since = (Date.now() - e) / 3600000;
    src = 'sin hora de término: se asume 18:00';
  } else return card('⏱️ Volver a entrenar', 'Heurística', empty('No hay sesión reciente registrada.'));
  const strain = parseFloat(c.strain_score) || 0;
  const rec = c.recovery_score == null ? null : parseFloat(c.recovery_score);
  const q = retrain(strain, rec, parseFloat(c.cumulative_sleep_debt_hours) || 0, Math.max(0, since));
  const ok = q.left === 0;
  return card('⏱️ Volver a entrenar', 'Regla transparente (heurística)',
    `<div class="text-2xl font-black font-mono ${ok ? 'text-emerald-400' : 'text-amber-400'}">${ok ? 'Listo para entrenar' : 'Faltan ~' + q.left + ' h'}</div>
    <div class="text-[11px] text-slate-300">Recuperación sugerida: ${q.need} h · transcurridas: ${Math.round(since)} h (${src})</div>` +
    note('Base por strain de la sesión (<8: 12 h · 8–12: 24 h · 12–16: 36 h · ≥16: 48 h) × recuperación (≥67: ×0.85, <34: ×1.3) × deuda de sueño >2 h (×1.1). Apoyo: el daño/síntesis proteica tras fuerza se normaliza en ~24–72 h según volumen y grupo muscular, y el entrenamiento guiado por VFC mejora respuesta frente a planes fijos (Kiviniemi 2007). No es una fórmula validada: úsala como guía, no como regla.')
  );
}