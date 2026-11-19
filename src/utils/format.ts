/**
 * ARGON v6.0 — Formatting Utilities
 * Pure functions for display formatting.
 * Import from: import { fmtKcal, fmtDuration, fmtPct, ... } from '@/utils/format';
 */

import { fmtHHMM } from './date';

/** Calculate kcal from macros (P: 4, C: 4, F: 9 kcal/g) */
export function kcalOf(protein: number, carbs: number, fat: number): number {
  return Math.round(protein * 4 + carbs * 4 + fat * 9);
}

// ============================================================
// NUMBERS
// ============================================================

/** Format with fixed decimals, null-safe */
export function fmtNum(n: number | null | undefined, dp = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '--';
  return n.toFixed(dp);
}

/** Format integer, null-safe */
export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '--';
  return Math.round(n).toLocaleString('es-ES');
}

/** Format percentage (0-100) */
export function fmtPct(n: number | null | undefined, dp = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '--';
  return `${n.toFixed(dp)}%`;
}

/** Format percentage from ratio (0-1) */
export function fmtRatioPct(ratio: number | null | undefined, dp = 0): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '--';
  return `${(ratio * 100).toFixed(dp)}%`;
}

// ============================================================
// UNITS
// ============================================================

/** kcal */
export function fmtKcal(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '--';
  return `${Math.round(n)} kcal`;
}

/** grams */
export function fmtGram(n: number | null | undefined, dp = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '--';
  return `${n.toFixed(dp)} g`;
}

/** kg */
export function fmtKg(n: number | null | undefined, dp = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '--';
  return `${n.toFixed(dp)} kg`;
}

/** cm */
export function fmtCm(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '--';
  return `${Math.round(n)} cm`;
}

/** bpm */
export function fmtBpm(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '--';
  return `${Math.round(n)} bpm`;
}

/** ms */
export function fmtMs(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '--';
  return `${Math.round(n)} ms`;
}

/** breaths/min */
export function fmtBrpm(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '--';
  return `${n.toFixed(1)} rpm`;
}

/** % SpO2 */
export function fmtSpo2(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '--';
  return `${n.toFixed(1)}%`;
}

/** mL */
export function fmtMl(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '--';
  return `${Math.round(n)} mL`;
}

/** L */
export function fmtL(n: number | null | undefined, dp = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '--';
  return `${(n / 1000).toFixed(dp)} L`;
}

// ============================================================
// DURATION
// ============================================================

/** Minutes to "Xh Ym" or "Ym" */
export function fmtDuration(min: number | null | undefined): string {
  if (min === null || min === undefined || !Number.isFinite(min)) return '--';
  const m = Math.round(min);
  if (m <= 0) return '0m';
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return h > 0 ? `${h}h ${rem}m` : `${rem}m`;
}

/** Minutes to "HH:MM" */
export function fmtDurationHHMM(min: number | null | undefined): string {
  if (min === null || min === undefined || !Number.isFinite(min)) return '--:--';
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `${h.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
}

/** Seconds to "MM:SS" */
export function fmtSecToMMSS(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec) % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// ============================================================
// SLEEP SPECIFIC
// ============================================================

/** Sleep need: "7h 30m / 8h 00m (94%)" */
export function fmtSleepVsNeed(
  actualMin: number | null,
  needMin: number | null
): string {
  if (actualMin === null || needMin === null) return '--';
  const pct = Math.round((actualMin / needMin) * 100);
  return `${fmtDuration(actualMin)} / ${fmtDuration(needMin)} (${pct}%)`;
}

/** Sleep efficiency */
export function fmtSleepEfficiency(
  totalMin: number | null,
  timeInBedMin: number | null
): string {
  if (totalMin === null || timeInBedMin === null || timeInBedMin === 0) return '--';
  return fmtPct((totalMin / timeInBedMin) * 100);
}

/** Sleep stage distribution */
export function fmtStagePct(
  stageMin: number | null,
  totalMin: number | null
): string {
  if (stageMin === null || totalMin === null || totalMin === 0) return '--';
  return fmtPct((stageMin / totalMin) * 100);
}

// ============================================================
// RECOVERY / SCORES
// ============================================================

/** Score with color class */
export interface ScoreDisplay {
  value: string;
  label: string;
  colorClass: string;
}

export function fmtRecoveryScore(score: number | null): ScoreDisplay {
  if (score === null) return { value: '--', label: 'Sin datos', colorClass: 'text-slate-500' };
  if (score >= 85) return { value: String(score), label: 'Óptimo', colorClass: 'text-emerald-500' };
  if (score >= 70) return { value: String(score), label: 'Bueno', colorClass: 'text-green-500' };
  if (score >= 55) return { value: String(score), label: 'Regular', colorClass: 'text-amber-500' };
  if (score >= 40) return { value: String(score), label: 'Bajo', colorClass: 'text-orange-500' };
  return { value: String(score), label: 'Crítico', colorClass: 'text-rose-500' };
}

export function fmtStrainScore(score: number | null): ScoreDisplay {
  if (score === null) return { value: '--', label: 'Sin datos', colorClass: 'text-slate-500' };
  if (score <= 7) return { value: String(score), label: 'Recovery', colorClass: 'text-emerald-500' };
  if (score <= 11) return { value: String(score), label: 'Óptimo', colorClass: 'text-green-500' };
  if (score <= 14) return { value: String(score), label: 'Moderado', colorClass: 'text-amber-500' };
  if (score <= 17) return { value: String(score), label: 'Alto', colorClass: 'text-orange-500' };
  return { value: String(score), label: 'Excesivo', colorClass: 'text-rose-500' };
}

// ============================================================
// BODY COMPOSITION
// ============================================================

export function fmtBodyFat(pct: number | null): string {
  if (pct === null) return '--';
  return `${pct.toFixed(1)}%`;
}

export function fmtWeight(kg: number | null): string {
  if (kg === null) return '--';
  return `${kg.toFixed(1)} kg`;
}

export function fmtLeanMass(kg: number | null): string {
  if (kg === null) return '--';
  return `${kg.toFixed(1)} kg`;
}

// ============================================================
// HYDRATION
// ============================================================

export function fmtHydration(intakeMl: number | null, targetMl: number | null): string {
  if (intakeMl === null || targetMl === null) return '--';
  const pct = Math.round((intakeMl / targetMl) * 100);
  return `${fmtMl(intakeMl)} / ${fmtMl(targetMl)} (${pct}%)`;
}

// ============================================================
// MACROS
// ============================================================

export function fmtMacros(
  protein: number | null,
  carbs: number | null,
  fat: number | null,
  kcal: number | null
): string {
  const parts: string[] = [];
  if (protein !== null) parts.push(`P: ${fmtGram(protein, 0)}`);
  if (carbs !== null) parts.push(`C: ${fmtGram(carbs, 0)}`);
  if (fat !== null) parts.push(`F: ${fmtGram(fat, 0)}`);
  if (kcal !== null) parts.push(fmtKcal(kcal));
  return parts.join(' · ');
}

export function fmtMacroTargets(
  targetP: number | null,
  targetC: number | null,
  targetF: number | null,
  targetKcal: number | null
): string {
  return fmtMacros(targetP, targetC, targetF, targetKcal);
}

// ============================================================
// HRV SPECIFIC
// ============================================================

export function fmtLnRmssd(n: number | null, dp = 2): string {
  if (n === null) return '--';
  return n.toFixed(dp);
}

export function fmtCv(cv: number | null, dp = 1): string {
  if (cv === null) return '--';
  return `${cv.toFixed(dp)}%`;
}

// ============================================================
// PHYSIOLOGICAL AGE
// ============================================================

export function fmtAge(age: number | null): string {
  if (age === null) return '--';
  return `${age.toFixed(1)} años`;
}

export function fmtAgeDelta(delta: number | null): string {
  if (delta === null) return '--';
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)} años`;
}

export function fmtPaceOfAging(x: number | null): string {
  if (x === null) return '--';
  return x.toFixed(2);
}

// ============================================================
// VO2 MAX
// ============================================================

export function fmtVo2Max(vo2: number | null): string {
  if (vo2 === null) return '--';
  return `${vo2.toFixed(1)} ml/kg/min`;
}

// ============================================================
// COLOR HELPERS (for charts/UI)
// ============================================================

/** Get color for recovery score */
export function recoveryColor(score: number | null): string {
  if (score === null) return '#94a3b8'; // slate-500
  if (score >= 85) return '#10b981';    // emerald-500
  if (score >= 70) return '#22c55e';    // green-500
  if (score >= 55) return '#f59e0b';    // amber-500
  if (score >= 40) return '#f97316';    // orange-500
  return '#f43f5e';                     // rose-500
}

/** Get color for strain score */
export function strainColor(score: number | null): string {
  if (score === null) return '#94a3b8';
  if (score <= 7) return '#10b981';
  if (score <= 11) return '#22c55e';
  if (score <= 14) return '#f59e0b';
  if (score <= 17) return '#f97316';
  return '#f43f5e';
}

/** Get color for sleep stage */
export function stageColor(stage: number): string {
  switch (stage) {
    case 1: return '#ef4444'; // awake - red
    case 4: return '#3b82f6'; // light - blue
    case 5: return '#8b5cf6'; // deep - purple
    case 6: return '#22c55e'; // REM - green
    default: return '#64748b';
  }
}

/** Gradient for recovery ring */
export function recoveryGradient(score: number | null): string {
  const c = recoveryColor(score);
  return `conic-gradient(${c} ${score || 0}%, #e2e8f0 ${score || 0}%)`;
}