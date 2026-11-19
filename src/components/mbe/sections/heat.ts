/**
 * ARGON v6.0 — MBE Heat Map Section
 * Renders 30-day recovery heat map.
 * Import from: import { renderHeatMap } from '@/components/mbe/sections/heat';
 */

import { card, empty, ACC } from '../utils';
import type { ComputedDailyScore } from '@/api/schemas';

interface HeatMapOptions {
  state: { raw: any[]; comp: ComputedDailyScore[]; selectedDate: string | null };
}

/**
 * Render heat map section
 */
export function renderHeatMap(options: HeatMapOptions): string {
  const { state } = options;
  const rows = state.comp.slice(0, 30).reverse();
  if (!rows.length) return card('🗓️ Mapa de calor · 30 días', 'Recuperación diaria', empty('Sin datos.'));
  const col = (v: number | null) => v == null ? '#334155' : v >= 67 ? '#10B981' : v >= 34 ? '#F59E0B' : '#EF4444';
  const cells = rows.map(r =>
    `<div title="${r.log_date}: ${r.recovery_score == null ? 'calibrando' : r.recovery_score + '%'}" class="aspect-square rounded-md" style="background:${col(r.recovery_score)};opacity:${r.recovery_score == null ? .5 : .35 + .65 * Math.min(1, r.recovery_score / 100)}"></div>`
  ).join('');
  return card('🗓️ Mapa de calor · 30 días', 'Recuperación diaria (más antiguo → hoy)',
    `<div class="grid grid-cols-10 gap-1">${cells}</div>
    <div class="flex gap-3 text-[9px] text-slate-400">
      <span><b style="color:#10B981">■</b> ≥67</span>
      <span><b style="color:#F59E0B">■</b> 34–66</span>
      <span><b style="color:#EF4444">■</b> <34</span>
      <span><b style="color:#64748b">■</b> calibrando</span>
    </div>`
  );
}