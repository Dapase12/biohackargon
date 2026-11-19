/**
 * ARGON v6.0 — Meal Card Component
 * Tab card rendering for nutrition/meals.
 * Import from: import { renderMealTabCard } from '@/components/app/meal-card';
 */

import { config } from '@/config';
import { getDayMeals, getMealTypes } from './meal-helpers';

function getLocalStore(): Record<string, any> {
  try { return JSON.parse(localStorage.getItem('argon_local_store') || '{}'); } catch { return {}; }
}

function mfTypeLabel(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Render meal tab card for the selected date
 */
export function renderMealTabCard(): void {
  const dateEl = document.getElementById('selected-date') as HTMLInputElement;
  const d = dateEl?.value ?? new Date().toISOString().split('T')[0];
  const meals = getDayMeals(d);
  const MFTYPES = getMealTypes();
  const store = getLocalStore();
  const rec = store[d];
  const totalKcal = MFTYPES.reduce((s, t) => s + (meals[t]?.kcal || 0), 0);
  const totalProtein = MFTYPES.reduce((s, t) => s + (meals[t]?.protein || 0), 0);
  const totalCarbs = MFTYPES.reduce((s, t) => s + (meals[t]?.carbs || 0), 0);
  const totalFat = MFTYPES.reduce((s, t) => s + (meals[t]?.fat || 0), 0);
  const totalWater = MFTYPES.reduce((s, t) => s + (meals[t]?.water_ml || 0), 0);
  const target = rec?.target_kcal || config.targets?.kcal || 2200;
  const deficit = target - totalKcal;
  const card = document.getElementById('meal-tab-card');
  if (card) {
    card.innerHTML = `<div class="flex items-center justify-between"><div><h2 class="text-xs font-extrabold uppercase tracking-wider text-white">🍽️ Nutrición</h2><p class="text-[10px] text-slate-400">${totalKcal}/${target} kcal · Déficit: ${deficit > 0 ? '+' : ''}${deficit} kcal</p></div><button onclick="openMealModal()" class="jchip on">+ Registrar</button></div>
    <div class="grid grid-cols-4 gap-2 text-center">
      <div class="bg-slate-950/60 rounded-xl p-2 border border-slate-800"><div class="text-[10px] text-slate-400">kcal</div><div class="font-mono text-cyan-300">${totalKcal}</div></div>
      <div class="bg-slate-950/60 rounded-xl p-2 border border-slate-800"><div class="text-[10px] text-slate-400">P</div><div class="font-mono text-emerald-300">${totalProtein}g</div></div>
      <div class="bg-slate-950/60 rounded-xl p-2 border border-slate-800"><div class="text-[10px] text-slate-400">C</div><div class="font-mono text-violet-300">${totalCarbs}g</div></div>
      <div class="bg-slate-950/60 rounded-xl p-2 border border-slate-800"><div class="text-[10px] text-slate-400">G</div><div class="font-mono text-amber-300">${totalFat}g</div></div>
    </div>
    <div class="text-[10px] text-slate-400">Agua: ${totalWater} ml</div>
    ${MFTYPES.map(t => {
      const mc = meals[t];
      if (!mc || (!mc.foods.length && !mc.water_ml)) return '';
      return `<div class="p-2 rounded-xl bg-slate-950/60 border border-slate-800/70"><div class="flex justify-between text-xs"><span>${mfTypeLabel(t)}</span><span class="font-mono text-cyan-300">${mc.kcal} kcal</span></div><div class="text-[10px] text-slate-400 truncate">${mc.foods.map((f: any) => f.label).join(' · ') || `Agua: ${mc.water_ml}ml`}</div></div>`;
    }).join('') || `<div class="text-[11px] text-slate-500">Sin comidas registradas hoy.</div>`}`;
  }
}

/**
 * Render weekly nutrition summary card
 */
export function renderWeeklyMealCard(): void {
  const store = getLocalStore();
  const wk = Object.keys(store).sort().slice(-7).map(x => store[x]);
  const avgKcal = wk.length ? Math.round(wk.reduce((s, r) => s + (r.total_kcal || 0), 0) / wk.length) : 0;
  const card = document.getElementById('meal-weekly-card');
  if (card) {
    card.innerHTML = `<div class="text-center p-4"><div class="text-3xl font-black text-emerald-300">${avgKcal}</div><div class="text-[11px] text-slate-400">kcal promedio (7d)</div></div>`;
  }
}