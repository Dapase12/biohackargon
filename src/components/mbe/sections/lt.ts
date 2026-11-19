/**
 * ARGON v6.0 — MBE LT Section
 * Renders lactate threshold calculator.
 * Import from: import { renderLT } from '@/components/mbe/sections/lt';
 */

import { card, note, LS, todayIso, pace, ltCalc } from '../utils';
import type { ComputedDailyScore, RawBiometric } from '@/api/schemas';

interface LTOptions {
  state: { raw: RawBiometric[]; comp: ComputedDailyScore[]; selectedDate: string | null };
}

/**
 * Render LT section
 */
export function renderLT(options: LTOptions): string {
  const { state } = options;
  const hist = LS('argon_lt_v1', []);
  const prof = LS('argon_profile_v1', {});
  const cfg = (window as any).CONFIG?.profile || {};
  const birth = new Date((prof.birth || cfg.birthDate || '1990-01-01') + 'T12:00:00');
  const age = (Date.now() - birth.getTime()) / (365.2425 * 86400000);
  const hrMax = Math.round(208 - 0.7 * age);
  const lastT = hist[hist.length - 1];
  const out = lastT
    ? (() => {
        const r = ltCalc(lastT.km, lastT.hr);
        return `<div class="grid grid-cols-3 gap-2 text-center text-xs">
          <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">LTHR</div><div class="font-mono font-black text-lg text-rose-400">${r.lthr}</div></div>
          <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">Ritmo 30′</div><div class="font-mono font-black">${pace(r.p30)}/km</div></div>
          <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">Ritmo umbral ≈</div><div class="font-mono font-black">${pace(r.pThr)}/km</div></div>
        </div>` + r.zones.map(z =>
          `<div class="flex justify-between text-[11px] font-mono"><span class="text-slate-300">${z[0]}</span><span>${z[1] ? z[1] + '–' : '<'}${z[2]} lpm</span></div>`
        ).join('') + `<div class="text-[10px] text-slate-400">Último test: ${lastT.date}</div>`;
      })()
    : `<div class="text-xs">Estimación sin test (baja confianza): ${Math.round(hrMax * 0.85)}–${Math.round(hrMax * 0.90)} lpm (85–90% de FCmáx Tanaka ${hrMax}).</div>`;
  return card('🫁 Umbral de lactato en carrera', 'Test de campo de 30 min (Friel)',
    out +
    `<div class="grid grid-cols-3 gap-1.5 pt-1">
      <input id="lt-km" type="number" step="0.01" placeholder="km en 30′" class="bg-slate-800 rounded-xl px-2 py-1.5 text-xs text-white">
      <input id="lt-hr" type="number" placeholder="FC media últ. 20′" class="bg-slate-800 rounded-xl px-2 py-1.5 text-xs text-white">
      <button id="lt-save" class="rounded-xl bg-cyan-500 text-black font-black text-[11px]">Calcular</button>
    </div>` +
    note('Protocolo: calentar 10–15′, correr 30′ al máximo ritmo sostenible y constante, solo, plano, sin pausas; pulsa "lap" a los 10′. LTHR = FC media de los últimos 20′. Correlaciona razonablemente con el umbral de laboratorio pero con error individual de varios lpm; el ritmo umbral estricto ≈ ritmo de 60′ (por eso se aplica +4% a tu ritmo de 30′). Repetir cada 6–8 semanas, descansado, mismas condiciones.')
  );
}