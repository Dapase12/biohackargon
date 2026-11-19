/**
 * ARGON v6.0 — MBE HRV Section
 * Renders HRV nocturnal vs diurnal data.
 * Import from: import { renderHrv } from '@/components/mbe/sections/hrv';
 */

import { card, note, getSelectedDay, ex } from '../utils';
import type { ComputedDailyScore, RawBiometric } from '@/api/schemas';

interface HrvOptions {
  state: { raw: RawBiometric[]; comp: ComputedDailyScore[]; selectedDate: string | null };
}

/**
 * Render HRV section
 */
export function renderHrv(options: HrvOptions): string {
  const { state } = options;
  const { comp: c, raw: r0 } = getSelectedDay(state);
  if (!c || c.ln_rmssd == null) return card('💓 VFC nocturna vs diurna', 'lnRMSSD (servidor)', empty('Sin datos de VFC computados por el servidor aún.'));
  const lnToday = parseFloat(c.ln_rmssd);
  const lnBase = parseFloat(c.ln_rmssd_14d_mean);
  const lnBaseSd = parseFloat(c.ln_rmssd_14d_sd);
  const hrvZ = parseFloat(c.hrv_z_score);
  const rhrZ = parseFloat(c.rhr_z_score);
  const recScore = c.recovery_score;
  const recStatus = c.recovery_status || '—';
  const recMaxStrain = c.recommended_max_strain;
  const cv7 = parseFloat(c.cv_lnrmssd_7d_pct);
  const swc = parseFloat(c.swc_lnrmssd);
  const calibrating = c.calibrating;
  const rmssd = parseFloat(c.rmssd_ms);
  const rhr = parseFloat(c.rhr_bpm);
  const rmssd14d = parseFloat(c.rmssd_14d_mean_ms);
  const rhr14d = parseFloat(c.rhr_14d_mean_bpm);
  const resp = parseFloat(c.resp_rate_brpm);
  const resp14d = parseFloat(c.resp_14d_mean_brpm);
  const spo2 = parseFloat(c.spo2_pct);
  const nap = ex(r0).hrv_nap;
  const napTxt = nap
    ? `<div class="text-xs">Siesta: mediana <b class="font-mono">${nap.median} ms</b> · n=${nap.n} <span class="text-slate-400">(no entra en la base)</span></div>`
    : '';
  const day = ex(r0).hrv_day;
  const dayTxt = day
    ? `<div class="text-xs">Diurna (reposo/actividad): mediana <b class="font-mono">${day.median} ms</b> · n=${day.n} · rango ${day.min}–${day.max}</div>`
    : '<div class="text-[11px] text-slate-400">Sin muestras diurnas guardadas.</div>';
  const stat = recScore != null
    ? (recScore >= 67 ? ['Recuperado', 'text-emerald-400'] : recScore >= 34 ? ['Equilibrado', 'text-cyan-300'] : ['Fatiga/estrés', 'text-amber-400'])
    : ['Calibrando', 'text-slate-400'];
  const norm = rhr > 0 ? (rmssd / (60000 / rhr) * 100).toFixed(1) : '--';
  return card('💓 VFC nocturna vs diurna', 'Datos del servidor (lnRMSSD 7d vs base 14d, SWC=0.5·SD)',
    `<div class="grid grid-cols-3 gap-2 text-center">
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">RMSSD noche</div><div class="font-mono font-black">${rmssd.toFixed(0)} ms</div><div class="text-[9px] text-cyan-400 font-mono">ln ${lnToday.toFixed(2)}</div></div>
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">Base 14 d (ln)</div><div class="font-mono font-black">${lnBase.toFixed(2)}</div><div class="text-[9px] text-slate-400 font-mono">SD ${lnBaseSd.toFixed(3)}</div></div>
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">SWC (0.5·SD)</div><div class="font-mono font-black">±${swc.toFixed(3)}</div><div class="text-[9px] text-slate-400 font-mono">CV7 ${cv7.toFixed(1)}%</div></div>
    </div>
    <div class="grid grid-cols-3 gap-2 text-center mt-2">
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">z-score HRV</div><div class="font-mono font-black text-cyan-300">${hrvZ.toFixed(2)}</div></div>
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">z-score RHR</div><div class="font-mono font-black text-cyan-300">${rhrZ.toFixed(2)}</div></div>
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">RHR / 14d</div><div class="font-mono font-black">${rhr} / ${rhr14d} bpm</div></div>
    </div>
    <div class="grid grid-cols-3 gap-2 text-center mt-2">
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">Resp. / 14d</div><div class="font-mono font-black">${resp} / ${resp14d} rpm</div></div>
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">SpO₂</div><div class="font-mono font-black">${spo2}%</div></div>
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">RMSSD/RR norm</div><div class="font-mono font-black">${norm}%</div></div>
    </div>
    <div class="text-xs font-bold ${stat[1]} mt-2">Recuperación: ${recScore != null ? recScore + '%' : 'calibrando'} · ${recStatus} ${recMaxStrain != null ? '· Strain máx: ' + recMaxStrain.toFixed(1) : ''}${calibrating ? ' <span class="text-amber-400">(calibrando)</span>' : ''}</div>
    ${dayTxt}${napTxt}` +
    note('Cálculo servidor: lnRMSSD media 7 d vs base 14 d (Plews 2013; Buchheit 2014). SWC = 0.5·SD. FR > 20 rpm penaliza. z-scores vs base 14 d. Recuperación: pesos 0.55/0.20/0.25 provisionales (HRV/RHR/FR).')
  );
}