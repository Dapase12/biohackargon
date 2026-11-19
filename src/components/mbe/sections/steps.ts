/**
 * ARGON v6.0 — MBE Steps Section
 * Renders steps data with ring visualization.
 * Import from: import { renderSteps } from '@/components/mbe/sections/steps';
 */

import { card, note, getSelectedDay, mean } from '../utils';
import type { RawBiometric } from '@/api/schemas';

interface StepsOptions {
  state: { raw: RawBiometric[]; comp: any[]; selectedDate: string | null };
}

/**
 * Render steps section
 */
export function renderSteps(options: StepsOptions): string {
  const { state } = options;
  const { raw: r0 } = getSelectedDay(state);
  const goal = LS('argon_steps_goal', 8000);
  const today = parseInt((r0 || {}).steps_count, 10) || 0;
  const last7 = state.raw.slice(0, 7).map(r => parseInt(r.steps_count, 10) || 0);
  const hit = last7.filter(v => v >= goal).length;
  const pct = Math.min(100, today / goal * 100);
  const C = 251.2;
  return card('👣 Pasos', 'Meta diaria editable',
    `<div class="flex items-center gap-4">
      <svg viewBox="0 0 100 100" class="w-20 h-20">
        <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="9"/>
        <circle cx="50" cy="50" r="40" fill="none" stroke="#22d3ee" stroke-width="9" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${(C - pct / 100 * C).toFixed(1)}" transform="rotate(-90 50 50)"/>
        <text x="50" y="55" text-anchor="middle" font-size="16" font-weight="800" fill="#fff">${Math.round(pct)}%</text>
      </svg>
      <div class="text-xs space-y-1">
        <div class="font-mono font-black text-lg">${today.toLocaleString()} <span class="text-slate-400 text-xs">/ <input id="mbe-goal" type="number" value="${goal}" class="w-16 bg-slate-800 rounded px-1 text-white"></span></div>
        <div class="text-slate-400">Media 7 d: ${Math.round(mean(last7)).toLocaleString()} · meta cumplida ${hit}/7 días</div>
      </div>
    </div>` +
    note('Meta por defecto 8 000: en adultos <60 años el riesgo de mortalidad se estabiliza hacia 8 000–10 000 pasos/día (Paluch, Lancet Public Health 2022); 8 000 vs 4 000 se asoció a ~51% menos mortalidad total (Saint-Maurice, JAMA 2020). Es asociación observacional.')
  );
}

// Import LS from utils
import { LS } from '../utils';