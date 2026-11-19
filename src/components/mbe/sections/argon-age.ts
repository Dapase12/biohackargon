/**
 * ARGON v6.0 — MBE Argon Age Section
 * Renders physiological age from server computations.
 * Import from: import { renderArgonAge } from '@/components/mbe/sections/argon-age';
 */

import { card, note, getSelectedDay } from '../utils';
import type { ComputedDailyScore } from '@/api/schemas';

interface ArgonAgeOptions {
  state: { raw: any[]; comp: ComputedDailyScore[]; selectedDate: string | null };
}

/**
 * Render Argon Age section
 */
export function renderArgonAge(options: ArgonAgeOptions): string {
  const { state } = options;
  const { comp: c } = getSelectedDay(state);
  if (!c || c.chronological_age == null) return card('🧬 Edad Fisiológica ARGON', 'Modelo multivariante (servidor)', empty('Sin datos computados por el servidor aún.'));
  const chrono = parseFloat(c.chronological_age);
  const physio = parseFloat(c.argon_physiological_age);
  const delta = parseFloat(c.total_age_delta);
  const paceVal = parseFloat(c.pace_of_aging_x);
  const vo2 = parseFloat(c.vo2_max_ml_kg_min);
  const dVO2 = parseFloat(c.delta_vo2_years);
  const dRHR = parseFloat(c.delta_rhr_years);
  const dLnR = parseFloat(c.delta_lnrmssd_years);
  const dFFM = parseFloat(c.delta_ffm_years);
  const dSleep = parseFloat(c.delta_sleep_years);
  const dAct = parseFloat(c.delta_act_years);
  const paceColor = paceVal <= 0.85 ? 'text-emerald-400' : paceVal <= 1.0 ? 'text-cyan-300' : paceVal <= 1.15 ? 'text-amber-400' : 'text-rose-400';
  const deltaColor = delta <= -2 ? 'text-emerald-400' : delta <= 0 ? 'text-cyan-300' : delta <= 2 ? 'text-amber-400' : 'text-rose-400';
  return card('🧬 Edad Fisiológica ARGON', `Edad cronológica: ${chrono.toFixed(1)} años · Modelo: VO₂max + RHR + lnRMSSD + FFM + Sueño + Actividad`,
    `<div class="grid grid-cols-2 gap-3">
      <div class="p-3 rounded-xl bg-slate-900 border border-slate-800"><div class="text-[10px] text-slate-400">Edad fisiológica</div><div class="text-3xl font-black font-mono ${deltaColor}">${physio.toFixed(1)} años</div></div>
      <div class="p-3 rounded-xl bg-slate-900 border border-slate-800"><div class="text-[10px] text-slate-400">Delta total</div><div class="text-3xl font-black font-mono ${deltaColor}">${delta >= 0 ? '+' : ''}${delta.toFixed(1)} años</div></div>
      <div class="p-3 rounded-xl bg-slate-900 border border-slate-800"><div class="text-[10px] text-slate-400">Pace of Aging</div><div class="text-3xl font-black font-mono ${paceColor}">${paceVal.toFixed(2)}×</div><div class="text-[9px] text-slate-400">(<1 = envejeces más lento)</div></div>
      <div class="p-3 rounded-xl bg-slate-900 border border-slate-800"><div class="text-[10px] text-slate-400">VO₂max</div><div class="text-3xl font-black font-mono text-cyan-300">${vo2.toFixed(1)}</div><div class="text-[9px] text-slate-400">ml/kg/min</div></div>
    </div>
    <div class="grid grid-cols-3 gap-2 mt-3 text-center">
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">Δ VO₂max</div><div class="font-mono font-black ${dVO2 < 0 ? 'text-emerald-400' : 'text-rose-400'}">${dVO2 >= 0 ? '+' : ''}${dVO2.toFixed(1)} a</div></div>
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">Δ RHR</div><div class="font-mono font-black ${dRHR < 0 ? 'text-emerald-400' : 'text-rose-400'}">${dRHR >= 0 ? '+' : ''}${dRHR.toFixed(1)} a</div></div>
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">Δ lnRMSSD</div><div class="font-mono font-black ${dLnR < 0 ? 'text-emerald-400' : 'text-rose-400'}">${dLnR >= 0 ? '+' : ''}${dLnR.toFixed(1)} a</div></div>
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">Δ FFM</div><div class="font-mono font-black ${dFFM < 0 ? 'text-emerald-400' : 'text-rose-400'}">${dFFM >= 0 ? '+' : ''}${dFFM.toFixed(1)} a</div></div>
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">Δ Sueño</div><div class="font-mono font-black ${dSleep < 0 ? 'text-emerald-400' : 'text-rose-400'}">${dSleep >= 0 ? '+' : ''}${dSleep.toFixed(1)} a</div></div>
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">Δ Actividad</div><div class="font-mono font-black ${dAct < 0 ? 'text-emerald-400' : 'text-rose-400'}">${dAct >= 0 ? '+' : ''}${dAct.toFixed(1)} a</div></div>
    </div>` +
    note('Modelo servidor: edad fisiológica = edad cronológica + Σ(deltas ponderados). Cada delta = (valor_observado − valor_referencia_edad) / pendiente_envejecimiento. Pace of Aging = edad_fisiológica / edad_cronológica. Referencias: VO₂max (Jackson 1995), RHR (Zhang 2016), lnRMSSD (Plews 2013), FFM (Janssen 2000), Sueño (Ohayon 2004), Actividad (Paluch 2022). Parámetros provisionales — validar 4–6 semanas.')
  );
}

function empty(text: string) { return `<p class="text-[11px] text-amber-300/90">${text}</p>`; }