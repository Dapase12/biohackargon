/**
 * ARGON v6.0 — Workout Card Component
 * Tab card rendering for workout history.
 * Import from: import { renderWorkoutTabCard } from '@/components/app/workout-card';
 */

import { config } from '@/config';
import { getDayWorkouts, getWorkoutTypes } from './workout-helpers';

function getLocalStore(): Record<string, any> {
  try { return JSON.parse(localStorage.getItem('argon_local_store') || '{}'); } catch { return {}; }
}

/**
 * Render workout tab card for the selected date
 */
export function renderWorkoutTabCard(): void {
  const dateEl = document.getElementById('selected-date') as HTMLInputElement;
  const d = dateEl?.value ?? new Date().toISOString().split('T')[0];
  const ws = getDayWorkouts(d);
  const store = getLocalStore();
  const rec = store[d];
  const WTYPES = getWorkoutTypes();
  const lbl = (k: string) => (WTYPES.find(t => t[0] === k) || ['', '🏷️'])[1];
  const wk = Object.keys(store).sort().slice(-7).map(x => store[x]);
  const mins = wk.reduce((s, r) => s + (r.pickleball_or_gym_minutes || 0), 0);
  const n = wk.filter(r => r.pickleball_or_gym_minutes > 0).length;
  const card = document.getElementById('wk-tab-card');
  if (card) {
    card.innerHTML = `<div class="flex items-center justify-between"><div><h2 class="text-xs font-extrabold uppercase tracking-wider text-white">🏋️ Entrenamientos</h2><p class="text-[10px] text-slate-400">7 días: ${n} sesiones · ${mins} min</p></div><button onclick="openWorkoutModal()" class="jchip on">+ Registrar</button></div>` +
      (ws.length ? ws.map(w => `<div class="flex justify-between text-xs p-2 rounded-xl bg-slate-950/60 border border-slate-800/70"><span>${lbl(w.type)}</span><span class="font-mono text-slate-300">${w.min} min · RPE ${w.rpe}</span></div>`).join('') : `<div class="text-[11px] text-slate-500">${rec && rec.pickleball_or_gym_minutes > 0 ? `Registro manual: ${rec.pickleball_or_gym_minutes} min.` : 'Sin sesiones este día.'}</div>`);
  }
}

/**
 * Render weekly workout summary card
 */
export function renderWeeklyWorkoutCard(): void {
  const store = getLocalStore();
  const wk = Object.keys(store).sort().slice(-7).map(x => store[x]);
  const mins = wk.reduce((s, r) => s + (r.pickleball_or_gym_minutes || 0), 0);
  const n = wk.filter(r => r.pickleball_or_gym_minutes > 0).length;
  const card = document.getElementById('wk-weekly-card');
  if (card) {
    card.innerHTML = `<div class="text-center p-4"><div class="text-3xl font-black text-cyan-300">${mins}</div><div class="text-[11px] text-slate-400">min en ${n} sesiones (7d)</div></div>`;
  }
}