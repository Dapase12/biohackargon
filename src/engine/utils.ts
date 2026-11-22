/**
 * ARGON v7.0 — Engine Math Utilities
 * Pure functions, no side effects, fully testable.
 */

// ========================================================================
// BASIC STATS
// ========================================================================

export function mean(arr: number[]): number {
  const valid = arr.filter(v => isFinite(v));
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : NaN;
}

export function median(arr: number[]): number {
  const valid = arr.filter(v => isFinite(v)).sort((a, b) => a - b);
  if (!valid.length) return NaN;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
}

export function sd(arr: number[], m?: number): number {
  const valid = arr.filter(v => isFinite(v));
  if (valid.length <= 1) return 0;
  const avg = m ?? mean(valid);
  return Math.sqrt(valid.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / valid.length);
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

// ========================================================================
// EXPONENTIAL WEIGHTED MOVING AVERAGE
// ========================================================================

export function ewma(values: number[], alpha: number): number {
  if (!values.length) return NaN;
  let result = values[0];
  for (let i = 1; i < values.length; i++) {
    result = alpha * values[i] + (1 - alpha) * result;
  }
  return result;
}

// ========================================================================
// Z-SCORE
// ========================================================================

export function zScore(value: number, mean: number, sd: number): number {
  if (!isFinite(value) || !isFinite(mean) || !isFinite(sd) || sd === 0) return 0;
  return (value - mean) / sd;
}

// ========================================================================
// TRIMP (BANISTER)
// ========================================================================

export interface TrimpCoefficients {
  a: number;
  b: number;
}

export function trimpBanister(minutes: number, avgHR: number, hrMax: number, coeff: TrimpCoefficients): number {
  if (minutes <= 0 || avgHR <= 0 || hrMax <= 0) return 0;
  const hrRatio = avgHR / hrMax;
  if (hrRatio <= 0) return 0;
  return minutes * coeff.a * hrRatio * Math.exp(coeff.b * hrRatio);
}

// HR Zone midpoints (%HRmax) for TRIMP
export const ZONE_MIDPOINTS = {
  z1: 0.55,
  z2: 0.65,
  z3: 0.75,
  z4: 0.85,
  z5: 0.95,
} as const;

export function trimpFromZones(zones: Record<string, number>, hrMax: number, coeff: TrimpCoefficients): number {
  let total = 0;
  for (const [zone, minutes] of Object.entries(zones)) {
    const m = Number(minutes) || 0;
    if (m > 0 && ZONE_MIDPOINTS[zone as keyof typeof ZONE_MIDPOINTS]) {
      total += trimpBanister(m, ZONE_MIDPOINTS[zone as keyof typeof ZONE_MIDPOINTS] * hrMax, hrMax, coeff);
    }
  }
  return total;
}

// ========================================================================
// STRAIN SIGMOID (from net TRIMP)
// ========================================================================

export function strainFromNetTrimp(
  netTrimp: number,
  scale = 0.00165,
  maxStrain = 21
): number {
  if (netTrimp <= 0) return 0;
  return clamp(maxStrain * (1 - Math.exp(-scale * netTrimp)), 0, maxStrain);
}

// ========================================================================
// SLEEP DEBT (weighted exponential decay)
// ========================================================================

export interface SleepDebtConfig {
  basalNeedH: number;
  decayFactor: number;      // 0.35 per night
  maxLookbackDays: number;  // 7
}

export function computeSleepDebt(
  validSleeps: Array<{ total_sleep_min: number; nap_sleep_min?: number }>,
  config: SleepDebtConfig
): number {
  let debt = 0;
  validSleeps.forEach((s, idx) => {
    const tstH = (s.total_sleep_min + (s.nap_sleep_min || 0)) / 60;
    debt += (config.basalNeedH - tstH) * Math.exp(-config.decayFactor * idx);
  });
  return Math.max(0, debt);
}

// ========================================================================
// DYNAMIC SLEEP NEED
// ========================================================================

export function dynamicSleepNeed(
  basalNeedH: number,
  strainScore: number,
  sleepDebtH: number,
  strainFactor = 0.042,
  debtFactor = 0.35,
  minNeed = 6.5,
  maxNeed = 10.0
): number {
  return clamp(basalNeedH + strainFactor * strainScore + debtFactor * sleepDebtH, minNeed, maxNeed);
}

// ========================================================================
// BEDTIME WINDOW
// ========================================================================

export function bedtimeWindow(
  wakeTime: string,           // HH:mm
  dynamicNeedH: number,
  sleepEfficiencyPct: number,
  bufferMin = 15
): { start: string; end: string } {
  const [wakeH, wakeM] = wakeTime.split(':').map(Number);
  const wakeTotalMin = wakeH * 60 + wakeM + 1440; // next day minutes
  const reqTibH = dynamicNeedH / Math.max(0.80, sleepEfficiencyPct / 100);
  const reqTibMin = reqTibH * 60;
  const startMin = Math.round(wakeTotalMin - reqTibMin - bufferMin) % 1440;
  const endMin = Math.round(wakeTotalMin - reqTibMin + bufferMin) % 1440;
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return { start: fmt(startMin), end: fmt(endMin) };
}

// ========================================================================
// HR MAX (Tanaka)
// ========================================================================

export function hrMaxTanaka(ageYears: number): number {
  return 208 - 0.7 * ageYears;
}

// ========================================================================
// VO2MAX ESTIMATION (from HRmax/RHR)
// ========================================================================

export function vo2MaxFromHR(hrMax: number, rhr: number): number {
  if (rhr <= 0) return 0;
  return 15.3 * (hrMax / rhr);
}

// ========================================================================
// BODY COMPOSITION
// ========================================================================

export function fatMassKg(weightKg: number, bodyFatPct: number): number {
  return +(weightKg * (bodyFatPct / 100)).toFixed(2);
}

export function ffmKg(weightKg: number, bodyFatPct: number): number {
  return +(weightKg - fatMassKg(weightKg, bodyFatPct)).toFixed(1);
}

export function muscleMassKg(ffmKg: number): number {
  // muscle = FFM - bone(3.78%)
  return +(ffmKg - ffmKg * 0.0378).toFixed(1);
}

export function boneMassKg(weightKg: number): number {
  return +(weightKg * 0.0378).toFixed(1);
}

export function waterMassKg(weightKg: number, waterPct: number): number {
  return +(weightKg * (waterPct / 100)).toFixed(2);
}

export function bmi(weightKg: number, heightM: number): number {
  return +(weightKg / (heightM * heightM)).toFixed(1);
}

export function visceralFatIndex(bodyFatPct: number): number {
  return Math.max(1, Math.round(11 + (bodyFatPct - 24.4) * 0.48));
}

// ========================================================================
// TDEE (KATCH-MCARDLE via FFM)
// ========================================================================

export function tdeeKatchMcArdle(ffmKg: number): number {
  return Math.round(370 + 21.6 * ffmKg);
}

// ========================================================================
// RECOVERY SCORING
// ========================================================================

export function recoveryFromPillars(
  hrvScore: number,
  rhrScore: number,
  sleepScore: number,
  weights: { hrv: number; rhr: number; sleep: number },
  penalties: number
): number | null {
  if (hrvScore === null || rhrScore === null || sleepScore === null) return null;
  const weighted = hrvScore * weights.hrv + rhrScore * weights.rhr + sleepScore * weights.sleep;
  return Math.min(99, Math.max(1, Math.round(weighted - penalties)));
}

// ========================================================================
// LONGEVITY DELTAS
// ========================================================================

export function deltaVO2(vo2Max: number): number {
  // reference 43 ml/kg/min
  return clamp(-0.18 * (vo2Max - 43), -3.2, 2.5);
}

export function deltaRHR(rhr: number): number {
  // reference 60 bpm
  return clamp(0.06 * (rhr - 60), -2.2, 2.2);
}

export function deltaLnRMSSD(lnRmssd: number): number {
  // reference ln(50) ≈ 3.9
  return clamp(-0.25 * (lnRmssd - 3.9), -1.5, 1.5);
}

export function deltaFFM(ffmPct: number): number {
  // reference 79%
  return clamp(-0.16 * (ffmPct - 79), -2.2, 2.2);
}

export function deltaSleep(regularityPct: number, tstH: number): number {
  // reference 78% regularity, 7.2h sleep
  return clamp(-0.025 * (regularityPct - 78) - 0.25 * (tstH - 7.2), -1.5, 1.8);
}

export function deltaActivity(avgSteps7d: number, workoutMin: number): number {
  // reference 6500 steps, 30min workout bonus
  return clamp(-0.18 * ((avgSteps7d - 6500) / 1000) - (workoutMin >= 30 ? 0.35 : 0), -1.8, 1.5);
}

export function paceOfAging(totalAgeDelta: number): number {
  return clamp(1.0 + 0.09 * totalAgeDelta, 0.55, 1.65);
}

// ========================================================================
// ACWR
// ========================================================================

export function acwr(acuteAvg: number, chronicAvg: number): number {
  if (chronicAvg <= 0) return 0;
  return acuteAvg / chronicAvg;
}

export function acwrPenalty(acwr: number, threshold = 1.3, factor = 5): number {
  if (acwr <= threshold) return 0;
  return Math.min(2.0, (acwr - threshold) * factor);
}

// ========================================================================
// HIGH SLEEP STRESS
// ========================================================================

export function highSleepStress(rhrZ: number, hrvZ: number): number {
  return Math.min(45, Math.max(0, Math.round(Math.max(0, rhrZ * 9) + Math.max(0, -hrvZ * 7))));
}