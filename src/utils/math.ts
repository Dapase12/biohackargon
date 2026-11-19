/**
 * ARGON v6.0 — Math & Statistics Utilities
 * Pure functions, no side effects, handles null/NaN safely.
 * Import from: import { mean, sd, median, clamp, ... } from '@/utils/math';
 */

import { RECOVERY } from '@/constants';

// ============================================================
// NULL-SAFE NUMBER HELPERS
// ============================================================

/** Convert to number, return null if invalid */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

/** Convert to integer, return null if invalid */
export function int(v: unknown): number | null {
  const n = num(v);
  return n !== null && Number.isInteger(n) ? n : null;
}

/** Clamp number to range */
export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Null-safe clamp */
export function clampNum(v: unknown, min: number, max: number): number | null {
  const n = num(v);
  return n !== null ? clamp(n, min, max) : null;
}

/** Round to N decimal places */
export function round(n: number, dp = 2): number {
  const factor = 10 ** dp;
  return Math.round(n * factor) / factor;
}

// ============================================================
// BASIC STATISTICS
// ============================================================

/** Mean (average) of numbers, ignores null/NaN */
export function mean(values: (number | null | undefined)[]): number | null {
  const valid = values.map(num).filter((n): n is number => n !== null);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

/** Standard deviation (sample) */
export function sd(values: (number | null | undefined)[], sample = true): number | null {
  const valid = values.map(num).filter((n): n is number => n !== null);
  const n = valid.length;
  if (n < (sample ? 2 : 1)) return null;
  const m = mean(valid)!;
  const variance = valid.reduce((sum, x) => sum + (x - m) ** 2, 0) / (sample ? n - 1 : n);
  return Math.sqrt(variance);
}

/** Population standard deviation */
export function sdPop(values: (number | null | undefined)[]): number | null {
  return sd(values, false);
}

/** Coefficient of variation (%) */
export function cv(values: (number | null | undefined)[]): number | null {
  const m = mean(values);
  const s = sd(values);
  if (m === null || s === null || m === 0) return null;
  return (s / m) * 100;
}

/** Median */
export function median(values: (number | null | undefined)[]): number | null {
  const valid = values.map(num).filter((n): n is number => n !== null).sort((a, b) => a - b);
  const n = valid.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (valid[mid - 1]! + valid[mid]!) / 2 : valid[mid]!;
}

/** Min/Max */
export function min(values: (number | null | undefined)[]): number | null {
  const valid = values.map(num).filter((n): n is number => n !== null);
  return valid.length ? Math.min(...valid) : null;
}

export function max(values: (number | null | undefined)[]): number | null {
  const valid = values.map(num).filter((n): n is number => n !== null);
  return valid.length ? Math.max(...valid) : null;
}

/** Percentile (0-100) */
export function percentile(values: (number | null | undefined)[], p: number): number | null {
  const valid = values.map(num).filter((n): n is number => n !== null).sort((a, b) => a - b);
  const n = valid.length;
  if (n === 0) return null;
  if (p <= 0) return valid[0]!;
  if (p >= 100) return valid[n - 1]!;
  const idx = (p / 100) * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return valid[lo]!;
  return valid[lo]! + (valid[hi]! - valid[lo]!) * (idx - lo);
}

/** Rolling mean (window size) */
export function rollingMean(values: number[], window: number): number[] {
  if (window <= 0) return values;
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1);
    result.push(slice.reduce((a, b) => a + b, 0) / slice.length);
  }
  return result;
}

/** Rolling standard deviation */
export function rollingSd(values: number[], window: number): number[] {
  if (window <= 1) return values.map(() => 0);
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1);
    const m = slice.reduce((a, b) => a + b, 0) / slice.length;
    const variance = slice.reduce((sum, x) => sum + (x - m) ** 2, 0) / (slice.length - 1);
    result.push(Math.sqrt(variance));
  }
  return result;
}

// ============================================================
// LINEAR REGRESSION (for trends)
// ============================================================

export interface LinearRegressionResult {
  slope: number;
  intercept: number;
  r2: number;
  predict: (x: number) => number;
}

/** Simple linear regression: y = slope * x + intercept */
export function linearRegression(
  points: Array<{ x: number; y: number }>
): LinearRegressionResult | null {
  const n = points.length;
  if (n < 2) return null;

  const sumX = points.reduce((a, p) => a + p.x, 0);
  const sumY = points.reduce((a, p) => a + p.y, 0);
  const sumXY = points.reduce((a, p) => a + p.x * p.y, 0);
  const sumX2 = points.reduce((a, p) => a + p.x * p.x, 0);
  const sumY2 = points.reduce((a, p) => a + p.y * p.y, 0);

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  // R²
  const yMean = sumY / n;
  const ssTot = points.reduce((a, p) => a + (p.y - yMean) ** 2, 0);
  const ssRes = points.reduce((a, p) => a + (p.y - (slope * p.x + intercept)) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return {
    slope,
    intercept,
    r2,
    predict: (x: number) => slope * x + intercept,
  };
}

// ============================================================
// PHYSIOLOGICAL FORMULAS
// ============================================================

/** Mifflin-St Jeor BMR (kcal/day) */
export function bmrMifflin(
  weightKg: number,
  heightCm: number,
  age: number,
  sex: 'male' | 'female'
): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'male' ? base + 5 : base - 161;
}

/** TEF 2-step (protein 25%, carbs 7.5%, fat 1.5%) */
export function tefTwoStep(proteinG: number, carbsG: number, fatG: number): number {
  return 0.25 * proteinG * 4 + 0.075 * carbsG * 4 + 0.015 * fatG * 9;
}

/** PAL to NEAT multiplier */
export function neatFromPal(pal: number, bmr: number): number {
  return bmr * (pal - 1);
}

/** Keytel 2005 exercise kcal (HR-based) */
export function keytelKcal(
  hrAvg: number,
  durationMin: number,
  weightKg: number,
  age: number,
  sex: 'male' | 'female',
  vo2max?: number
): number {
  // Keytel: kcal/min = (a + b*age + c*weight + d*hr + e*vo2max) / 4.184
  // Coefficients from Keytel et al. 2005
  const coeff = sex === 'male'
    ? { a: -59.3954, b: 0.271, c: 0.394, d: -0.110, e: 0.141 }
    : { a: -59.3954, b: 0.271, c: 0.394, d: -0.110, e: 0.141 };

  const vo2 = vo2max ?? (sex === 'male' ? 45 : 38); // Default estimate
  const kcalPerMin = (coeff.a + coeff.b * age + coeff.c * weightKg + coeff.d * hrAvg + coeff.e * vo2) / 4.184;
  return Math.max(0, kcalPerMin * durationMin);
}

/** ACWR (Acute:Chronic Workload Ratio) */
export function acwr(acuteLoad: number, chronicLoad: number): number {
  if (chronicLoad <= 0) return 1;
  return acuteLoad / chronicLoad;
}

/** ACWR penalty (0-15 points) */
export function acwrPenalty(ratio: number): number {
  if (ratio <= 1.0) return 0;
  if (ratio >= 1.5) return 15;
  return Math.round((ratio - 1.0) / 0.5 * 15); // Linear 1.0->1.5 = 0->15
}

// ============================================================
// BODY COMPOSITION
// ============================================================

export interface BodyComposition {
  weightKg: number;
  bodyFatPct: number;
  fatMassKg: number;
  ffmKg: number;           // Fat-free mass
  ffmPct: number;
  lbmKg: number;           // Lean body mass (≈ FFM)
}

/** Calculate body composition from weight + body fat % */
export function calcBodyComp(weightKg: number, bodyFatPct: number): BodyComposition {
  const fatMassKg = weightKg * (bodyFatPct / 100);
  const ffmKg = weightKg - fatMassKg;
  return {
    weightKg,
    bodyFatPct,
    fatMassKg,
    ffmKg,
    ffmPct: 100 - bodyFatPct,
    lbmKg: ffmKg,
  };
}

/** BMI */
export function bmi(weightKg: number, heightCm: number): number {
  const h = heightCm / 100;
  return weightKg / (h * h);
}

/** FFMI (Fat-Free Mass Index) */
export function ffmi(weightKg: number, bodyFatPct: number, heightCm: number): number {
  const { ffmKg } = calcBodyComp(weightKg, bodyFatPct);
  const h = heightCm / 100;
  return ffmKg / (h * h);
}

// ============================================================
// HYDRATION
// ============================================================

/** Target hydration (ml) = weight * 35 ml/kg ±25% */
export function hydrationTarget(weightKg: number, mlPerKg = 35): { target: number; min: number; max: number } {
  const target = Math.round(weightKg * mlPerKg);
  return {
    target,
    min: Math.round(target * 0.75),
    max: Math.round(target * 1.25),
  };
}

/** Hydration status from intake vs target */
export function hydrationStatus(intakeMl: number, targetMl: number): 'low' | 'ok' | 'high' {
  const ratio = intakeMl / targetMl;
  if (ratio < 0.75) return 'low';
  if (ratio > 1.25) return 'high';
  return 'ok';
}

// ============================================================
// RECOVERY SCORING (3-pillar)
// ============================================================

export interface RecoveryPillars {
  hrv: number;    // 0-100
  rhr: number;    // 0-100
  sleep: number;  // 0-100
}

export interface RecoveryResult {
  score: number;       // 0-100
  status: string;      // 'Óptimo' | 'Bueno' | 'Regular' | 'Bajo' | 'Crítico'
  pillars: RecoveryPillars;
  calibrated: boolean;
}

/** Score HRV (lnRMSSD) vs 14-day baseline with SWC dead zone */
export function scoreHrv(
  lnRmssdToday: number,
  lnRmssdBaseline: number,
  lnRmssdSd: number,
  cv7d: number
): number {
  // SWC = 0.5 * SD
  const swc = 0.5 * lnRmssdSd;

  // Dead zone: within ±SWC = 100
  const diff = lnRmssdToday - lnRmssdBaseline;
  if (Math.abs(diff) <= swc) return 100;

  // Outside dead zone: linear scaling
  // 2*SWC below = 0, 2*SWC above = 100
  const range = 2 * swc;
  const normalized = (diff + range) / (2 * range); // 0 to 1
  return Math.round(clamp(normalized * 100, 0, 100));
}

/** Score RHR vs 14-day baseline */
export function scoreRhr(rhrToday: number, rhrBaseline: number): number {
  // Lower is better. 5 bpm below baseline = 100, 10 bpm above = 0
  const diff = rhrBaseline - rhrToday;
  if (diff >= 5) return 100;
  if (diff <= -10) return 0;
  return Math.round(((diff + 10) / 15) * 100);
}

/** Score Sleep (hours vs need + regularity) */
export function scoreSleep(
  totalSleepH: number,
  sleepNeedH: number,
  regularityPct: number
): number {
  const hoursRatio = totalSleepH / sleepNeedH;
  const hoursScore = hoursRatio >= 1 ? 100 : hoursRatio * 100;
  const regularityScore = regularityPct;
  return Math.round(0.7 * hoursScore + 0.3 * regularityScore);
}

/** Full 3-pillar recovery score */
export function recoveryScore(
  hrvScore: number,
  rhrScore: number,
  sleepScore: number,
  acwrPenaltyPoints: number = 0,
  calibrated = true
): RecoveryResult {
  if (!calibrated) {
    return {
      score: 0,
      status: 'Calibrando',
      pillars: { hrv: 0, rhr: 0, sleep: 0 },
      calibrated: false,
    };
  }

  const { HRV_WEIGHT, RHR_WEIGHT, SLEEP_WEIGHT } = RECOVERY;

  const weighted = HRV_WEIGHT * hrvScore + RHR_WEIGHT * rhrScore + SLEEP_WEIGHT * sleepScore;
  const final = Math.round(clamp(weighted - acwrPenaltyPoints, 0, 100));

  let status: string;
  if (final >= 85) status = 'Óptimo';
  else if (final >= 70) status = 'Bueno';
  else if (final >= 55) status = 'Regular';
  else if (final >= 40) status = 'Bajo';
  else status = 'Crítico';

  return {
    score: final,
    status,
    pillars: { hrv: hrvScore, rhr: rhrScore, sleep: sleepScore },
    calibrated: true,
  };
}

// ============================================================
// Z-SCORES
// ============================================================

/** Z-score: (value - mean) / sd */
export function zScore(value: number, mean: number, sd: number): number | null {
  if (sd <= 0) return null;
  return (value - mean) / sd;
}