/**
 * ARGON v6.0 — Profile Baselines Component
 * Renders personal sleep profile baselines from user profile data.
 * Import from: import { renderProfileBaselines } from '@/components/sleep/profile-baselines';
 */

import { getTimezone } from '@/utils/date';
import type { SleepUserProfile } from '@/api/schemas';

interface ProfileBaselinesOptions {
  containerId: string;
  userProfile: SleepUserProfile | null;
  timezone?: string;
}

/**
 * Render profile baselines card
 */
export function renderProfileBaselines(options: ProfileBaselinesOptions): void {
  const { containerId, userProfile, timezone } = options;
  const el = document.getElementById(containerId);
  if (!el) return;

  const p = userProfile;
  if (!p || p.nights === 0) {
    el.innerHTML = '<p class="text-slate-400 text-center py-8">Perfil de sueño aún no calibrado (mín. 1 noche)</p>';
    return;
  }

  const tz = timezone || getTimezone();

  el.innerHTML = `
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <h4 class="text-xs font-extrabold uppercase tracking-wider text-cyan-300">Perfil Personal de Sueño (${p.nights} noches)</h4>
        <span class="text-[10px] text-amber-400 font-mono">Peso personal: ${(p.personal_weight * 100).toFixed(0)}%</span>
      </div>
      <div class="grid grid-cols-2 gap-2">
        ${p.hr_floor_p5 != null ? baseMetric('FC P5 (suelo)', p.hr_floor_p5.toFixed(0) + ' lpm', '#ef4444') : ''}
        ${p.hr_floor_p25 != null ? baseMetric('FC P25', p.hr_floor_p25.toFixed(0) + ' lpm', '#f59e0b') : ''}
        ${p.hr_sleep_median != null ? baseMetric('FC Mediana Sueño', p.hr_sleep_median.toFixed(0) + ' lpm', '#22d3ee') : ''}
        ${p.hr_arousal != null ? baseMetric('FC Arousal', p.hr_arousal.toFixed(0) + ' lpm', '#a855f7') : ''}
        ${p.rmssd_med_ms != null ? baseMetric('RMSSD Mediana', p.rmssd_med_ms.toFixed(0) + ' ms', '#10b981') : ''}
        ${p.rmssd_mad_ms != null ? baseMetric('RMSSD MAD', p.rmssd_mad_ms.toFixed(0) + ' ms', '#34d399') : ''}
        ${p.enmo_still_cut_g != null ? baseMetric('ENMO Still', p.enmo_still_cut_g.toFixed(3) + ' g', '#64748b') : ''}
        ${p.enmo_move_cut_g != null ? baseMetric('ENMO Move', p.enmo_move_cut_g.toFixed(3) + ' g', '#94a3b8') : ''}
        ${p.lfhf_med != null ? baseMetric('LF/HF Mediana', p.lfhf_med.toFixed(2), '#a855f7') : ''}
        ${p.rk_med_bpm != null ? baseMetric('RK Mediana', p.rk_med_bpm.toFixed(1) + ' bpm', '#fbbf24') : ''}
      </div>
      <div class="text-[10px] text-slate-500">
        Actualizado: ${p.updated_at ? new Date(p.updated_at).toLocaleDateString('es-VE', { timeZone: tz }) : '—'}
      </div>
    </div>
  `;
}

function baseMetric(label: string, value: string, color: string) {
  return `
    <div class="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/50 text-center">
      <div class="text-[9px] text-slate-400">${label}</div>
      <div class="font-mono font-bold" style="color:${color}">${value}</div>
    </div>
  `;
}