/**
 * ARGON v6.0 — MBE Achievements Section
 * Renders achievement chips.
 * Import from: import { renderAchievements } from '@/components/mbe/sections/achievements';
 */

import { card, LS, getSelectedDay, mean } from '../utils';
import type { ComputedDailyScore, RawBiometric } from '@/api/schemas';

interface AchievementsOptions {
  state: { raw: RawBiometric[]; comp: ComputedDailyScore[]; selectedDate: string | null };
}

/**
 * Render achievements section
 */
export function renderAchievements(options: AchievementsOptions): string {
  const { state } = options;
  const goal = LS('argon_steps_goal', 8000);
  const r7 = state.raw.slice(0, 7);
  const c7 = state.comp.slice(0, 7);
  const c14 = state.comp.slice(0, 14);
  const n = (a: any[], f: (x: any) => boolean) => a.filter(f).length;
  const L = [
    ['👣', 'Pasos: meta 7/7', n(r7, r => (parseInt(r.steps_count, 10) || 0) >= goal), 7],
    ['🌙', 'Sueño ≥7 h: 5 de 7', n(r7, r => (parseInt(r.total_sleep_min, 10) || 0) >= 420), 5],
    ['🥩', 'Proteína ≥90% de meta: 5 de 7', n(c7, c => c.target_protein_g > 0 && c.intake_protein_g / c.target_protein_g >= 0.9), 5],
    ['💚', 'Recuperación ≥67: 3 de 7', n(c7, c => c.recovery_score != null && c.recovery_score >= 67), 3],
    ['📅', 'Registro constante 14 d', c14.length, 14],
    ['🏋️', 'Entrenos: 3 en 7 d', n(r7, r => parseFloat(r.pickleball_or_gym_minutes) > 0), 3],
  ];
  const chips = L.map(([i, t, v, g]) => {
    const ok = v >= g;
    return `<div class="flex items-center justify-between p-2 rounded-xl border ${ok ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-slate-900 border-slate-800'}"><span class="text-xs">${i} ${t}</span><span class="text-[11px] font-mono ${ok ? 'text-emerald-400 font-bold' : 'text-slate-400'}">${ok ? '✓' : Math.min(v, g) + '/' + g}</span></div>`;
  }).join('');
  return card('🏆 Logros', 'Ventana móvil de 7–14 días', `<div class="space-y-1.5">${chips}</div>`);
}