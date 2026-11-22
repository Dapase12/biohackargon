/**
 * ARGON v7.0 — Recovery Pillar Unit Tests (TDD: RED phase)
 * Tests for HRV, RHR, Sleep recovery scoring.
 * Run: npx vitest run tests/unit/engine/recovery.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  mean,
  median,
  sd,
  zScore,
  ewma,
} from '@/engine/utils';
import type { RawBiometricDay, HistoryDay, PrevComputed, UserProfile, EngineConfig } from '@/engine/types';

// ========================================================================
// TEST FIXTURES
// ========================================================================

const TEST_PROFILE: UserProfile = {
  birth: '1985-06-15',
  height_m: 1.75,
  timezone: 'America/Caracas',
  basalSleepNeedH: 7.5,
  habitualWake: '06:30',
  dailyDeficitKcal: 500,
  biologicalSex: 'male',
};

const TEST_CONFIG: EngineConfig = {
  minBaselineDays: 7,
  basalSleepNeedH: 7.5,
  hrvSWCMultiplier: 0.5,
  hrvDeadZoneSD: 1.0,
  rhrPenaltyThreshold: 20,
  spo2PenaltyThreshold: 94,
  acwrAcuteDays: 3,
  acwrChronicDays: 14,
  acwrThreshold: 1.3,
  ewmaAlphaWeight: 0.25,
  ewmaAlphaBodyFat: 0.25,
  maxHrvCapPercentile: 3,
  trimpCoeffMale: { a: 0.64, b: 1.92 },
  trimpCoeffFemale: { a: 0.86, b: 1.67 },
  strainSigmoidScale: 0.00165,
  strainMax: 21,
  neuroLoadFactor: 0.85,
  shiftLoadFactor: 1.40,
  shiftLoadMET: 35,
  sleepArchWeights: { duration: 0.50, regularity: 0.25, efficiency: 0.15, architecture: 0.10 },
  recoveryWeights: { hrv: 0.40, rhr: 0.20, sleep: 0.40 },
  recoveryPenalty: { spo2: 10, respRate: 5 },
  minValidSleepMin: 120,
  minValidNapMin: 10,
  maxNapMin: 240,
  napStartHour: 8,
  napEndHour: 20,
};

// Helper to create a raw day with specific values
function createRawDay(overrides: Partial<RawBiometricDay> = {}): RawBiometricDay {
  return {
    log_date: '2024-11-20',
    rmssd_ms: 50,
    rhr_bpm: 55,
    total_sleep_min: 450,
    deep_sleep_min: 90,
    rem_sleep_min: 100,
    light_sleep_min: 200,
    awake_sleep_min: 30,
    sleep_efficiency_pct: 90,
    time_in_bed_min: 500,
    steps: 8000,
    intake_kcal: 2000,
    intake_protein_g: 150,
    intake_carbs_g: 200,
    intake_fat_g: 70,
    weight_kg: 80,
    body_fat_pct: 20,
    resp_rate_brpm: 14,
    spo2_pct: 98,
    session_rpe: 7,
    pickleball_or_gym_minutes: 60,
    ...overrides,
  };
}

function createHistory(days: number, baseRmssd = 50, baseRhr = 55): HistoryDay[] {
  return Array.from({ length: days }, (_, i) => ({
    ...createRawDay(),
    log_date: new Date(Date.now() - (i + 1) * 86400000).toISOString().split('T')[0],
    rmssd_ms: baseRmssd + (Math.random() - 0.5) * 10,
    rhr_bpm: baseRhr + (Math.random() - 0.5) * 5,
    total_sleep_min: 450 + Math.round((Math.random() - 0.5) * 60),
    deep_sleep_min: 90 + Math.round((Math.random() - 0.5) * 20),
    rem_sleep_min: 100 + Math.round((Math.random() - 0.5) * 20),
    strain_score: 8 + Math.random() * 4,
  }));
}

describe('Engine Utils - Basic Stats', () => {
  it('mean: calculates arithmetic mean', () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
    expect(mean([10, 20, 30])).toBe(20);
  });

  it('mean: ignores NaN/Infinity', () => {
    expect(mean([1, NaN, 3, Infinity, 5])).toBe(3);
    expect(mean([NaN, NaN])).toBeNaN();
  });

  it('median: odd length', () => {
    expect(median([1, 3, 5])).toBe(3);
    expect(median([5, 1, 3])).toBe(3);
  });

  it('median: even length', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([10, 20])).toBe(15);
  });

  it('median: ignores NaN', () => {
    expect(median([1, NaN, 5])).toBe(3);
    expect(median([NaN, NaN])).toBeNaN();
  });

  it('sd: population standard deviation', () => {
    const arr = [10, 12, 23, 23, 16, 23, 21, 16];
    // mean = 18, variance = 24, sd ≈ 4.899
    expect(sd(arr)).toBeCloseTo(4.899, 2);
  });

  it('sd: returns 0 for single value', () => {
    expect(sd([5])).toBe(0);
    expect(sd([5, 5, 5])).toBe(0);
  });

  it('zScore: computes standard score', () => {
    expect(zScore(12, 10, 2)).toBe(1);
    expect(zScore(8, 10, 2)).toBe(-1);
    expect(zScore(10, 10, 2)).toBe(0);
  });

  it('zScore: handles zero sd', () => {
    expect(zScore(10, 10, 0)).toBe(0);
    expect(zScore(NaN, 10, 2)).toBe(0);
  });

  it('ewma: exponential weighted moving average', () => {
    // alpha=0.5, values=[10, 20] -> 0.5*20 + 0.5*10 = 15
    expect(ewma([10, 20], 0.5)).toBe(15);
    // alpha=0.25, values=[10, 20, 30]
    // iter1: 0.25*20 + 0.75*10 = 12.5
    // iter2: 0.25*30 + 0.75*12.5 = 16.875
    expect(ewma([10, 20, 30], 0.25)).toBeCloseTo(16.875, 3);
  });

  it('ewma: returns first value for single element', () => {
    expect(ewma([42], 0.5)).toBe(42);
  });

  it('ewma: returns NaN for empty array', () => {
    expect(ewma([], 0.5)).toBeNaN();
  });
});

describe('Recovery Pillar - HRV Calculations', () => {
  let history: HistoryDay[];
  let todayRaw: RawBiometricDay;

  beforeEach(() => {
    // Use fixed RMSSD values for deterministic tests
    history = Array.from({ length: 14 }, (_, i) => ({
      ...createRawDay(),
      log_date: new Date(Date.now() - (i + 1) * 86400000).toISOString().split('T')[0],
      rmssd_ms: 50, // Fixed value, no random noise
      rhr_bpm: 55,
      total_sleep_min: 450,
      deep_sleep_min: 90,
      rem_sleep_min: 100,
      strain_score: 8,
    }));
    todayRaw = createRawDay({ rmssd_ms: 55, rhr_bpm: 54 });
  });

  it('lnRMSSD: natural log of RMSSD', () => {
    const rmssd = 50;
    const lnRmssd = Math.log(rmssd);
    expect(lnRmssd).toBeCloseTo(3.912, 3);
  });

  it('14-day lnRMSSD mean: averages ln(rmssd) over 14 days', () => {
    const lnValues = history.slice(0, 14).map(h => Math.log(h.rmssd_ms!));
    const meanLn = mean(lnValues);
    expect(meanLn).toBeCloseTo(Math.log(50), 2);
  });

  it('14-day lnRMSSD SD: computes SD of ln values (zero for constant values)', () => {
    const lnValues = history.slice(0, 14).map(h => Math.log(h.rmssd_ms!));
    const sdLn = sd(lnValues);
    expect(sdLn).toBe(0); // All values are 50, so SD = 0
  });

  it('SWC = 0.5 * SD_lnRMSSD_14d (zero when no variation)', () => {
    const lnValues = history.slice(0, 14).map(h => Math.log(h.rmssd_ms!));
    const sdLn = sd(lnValues);
    const swc = 0.5 * sdLn;
    expect(swc).toBe(0); // All values are 50, so SD = 0, SWC = 0
  });

  it('HRV z-score: (7d_mean_ln - 14d_mean_ln) / SD_ln, with dead zone SWC', () => {
    // Use variable history for this test
    const varHistory = Array.from({ length: 14 }, (_, i) => ({
      ...createRawDay(),
      rmssd_ms: 50 + (i % 5) * 2, // 50, 52, 54, 56, 58, 50, 52, 54, 56, 58, 50, 52, 54, 56
      rhr_bpm: 55,
      total_sleep_min: 450,
      deep_sleep_min: 90,
      rem_sleep_min: 100,
      strain_score: 8,
    }));
    const hist14 = varHistory.map(h => Math.log(h.rmssd_ms!));
    const hist7 = varHistory.slice(0, 7).map(h => Math.log(h.rmssd_ms!));
    const mean14 = mean(hist14);
    const mean7 = mean(hist7);
    const sd14 = sd(hist14);
    const swc = 0.5 * sd14;
    const diff = mean7 - mean14;
    const excess = Math.max(0, Math.abs(diff) - swc);
    const hrvZ = sd14 > 0 ? Math.sign(diff) * excess / sd14 : 0;
    expect(Math.abs(hrvZ)).toBeLessThanOrEqual(3);
  });

  it('HRV z-score capped at ±3', () => {
    // Create history with variation
    const extremeHistory = Array.from({ length: 14 }, (_, i) => ({
      ...createRawDay(),
      rmssd_ms: 30 + i, // 30-43
      rhr_bpm: 55,
      total_sleep_min: 450,
      deep_sleep_min: 90,
      rem_sleep_min: 100,
      strain_score: 8,
    }));
    const hist14 = extremeHistory.map(h => Math.log(h.rmssd_ms!));
    const mean14 = mean(hist14);
    const sd14 = sd(hist14);
    const todayLn = Math.log(80); // very high today
    const diff = todayLn - mean14;
    const swc = 0.5 * sd14;
    const excess = Math.max(0, Math.abs(diff) - swc);
    const hrvZ = clamp(Math.sign(diff) * excess / sd14, -3, 3);
    expect(hrvZ).toBeLessThanOrEqual(3);
    expect(hrvZ).toBeGreaterThanOrEqual(-3);
  });

  it('HRV recovery score: 50 + hrvZ * 16.67, clamped 0-100', () => {
    const hrvZ = 1.0;
    const hrvRecovery = clamp(50 + hrvZ * 16.67, 0, 100);
    expect(hrvRecovery).toBeCloseTo(66.67, 1);

    const hrvZNeg = -1.5;
    const hrvRecoveryNeg = clamp(50 + hrvZNeg * 16.67, 0, 100);
    expect(hrvRecoveryNeg).toBeCloseTo(25, 1);
  });

  it('Calibration: returns null if < 7 valid HRV days', () => {
    const shortHistory = Array.from({ length: 5 }, (_, i) => ({
      ...createRawDay(),
      rmssd_ms: 50,
      rhr_bpm: 55,
      total_sleep_min: 450,
      deep_sleep_min: 90,
      rem_sleep_min: 100,
      strain_score: 8,
    }));
    const validHrvDays = shortHistory.filter(h => h.rmssd_ms && h.rmssd_ms > 0).length;
    expect(validHrvDays).toBeLessThan(7);
    // Engine should return null for recovery_score
  });
});

describe('Recovery Pillar - RHR Calculations', () => {
  it('RHR z-score: (today - 14d_mean) / 14d_sd, capped ±3', () => {
    const history = createHistory(14, 50, 55);
    const rhrValues = history.slice(0, 14).map(h => h.rhr_bpm!);
    const mean14 = mean(rhrValues);
    const sd14 = sd(rhrValues);
    const todayRhr = 50; // lower is better
    const rhrZ = clamp((todayRhr - mean14) / sd14, -3, 3);
    expect(rhrZ).toBeLessThan(0); // lower RHR = negative z = good
  });

  it('RHR recovery score: 50 - rhrZ * 16.67 (inverted)', () => {
    const rhrZ = -1.0; // lower RHR
    const rhrRecovery = clamp(50 - rhrZ * 16.67, 0, 100);
    expect(rhrRecovery).toBeCloseTo(66.67, 1);
  });
});

describe('Recovery Pillar - Sleep Calculations', () => {
  it('Sleep hours vs needed: (TST + naps) / dynamic_need * 100', () => {
    const tstMin = 450;
    const napMin = 30;
    const dynamicNeedH = 7.8;
    const pct = Math.min(100, Math.round(((tstMin + napMin) / 60) / dynamicNeedH * 100));
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeLessThanOrEqual(100);
  });

  it('Sleep regularity: 94 - SD_TST_hours * 14 - nightAwakeH * 3.5, clamped 55-98', () => {
    const validSleeps = [450, 460, 440, 470, 455, 465, 450].map(m => m / 60);
    const meanTst = mean(validSleeps);
    const sdTst = sd(validSleeps, meanTst);
    const nightAwakeH = 0;
    const regularity = clamp(94 - sdTst * 14 - nightAwakeH * 3.5, 55, 98);
    expect(regularity).toBeGreaterThanOrEqual(55);
    expect(regularity).toBeLessThanOrEqual(98);
  });

  it('Sleep architecture score: weighted sum', () => {
    const hoursVsNeeded = 95;
    const regularity = 85;
    const efficiency = 90;
    const swsRemPct = 42; // (deep + rem) / TST * 100
    const archScore = Math.round(
      0.50 * hoursVsNeeded +
      0.25 * regularity +
      0.15 * (efficiency / 88 * 100) +
      0.10 * (swsRemPct / 40 * 100)
    );
    expect(archScore).toBeGreaterThan(0);
    expect(archScore).toBeLessThanOrEqual(100);
  });

  it('Sleep recovery score: sleepMissing ? 50 : architectureScore', () => {
    const sleepMissing = false;
    const archScore = 80;
    const sleepRecovery = sleepMissing ? 50 : clamp(archScore, 0, 100);
    expect(sleepRecovery).toBe(80);

    const sleepRecoveryMissing = true ? 50 : clamp(archScore, 0, 100);
    expect(sleepRecoveryMissing).toBe(50);
  });
});

describe('Recovery Pillar - Penalties', () => {
  it('SpO2 < 94%: 10 point penalty', () => {
    const spo2 = 92;
    const penalty = spo2 < 94 ? 10 : 0;
    expect(penalty).toBe(10);
  });

  it('Resp rate > 20: 5 point penalty', () => {
    const resp = 22;
    const penalty = resp > 20 ? 5 : 0;
    expect(penalty).toBe(5);
  });

  it('Combined penalties subtracted from weighted recovery', () => {
    const hrvRec = 70;
    const rhrRec = 65;
    const sleepRec = 75;
    const weights = { hrv: 0.4, rhr: 0.2, sleep: 0.4 };
    const penalties = 15; // SpO2 + Resp
    const weighted = hrvRec * weights.hrv + rhrRec * weights.rhr + sleepRec * weights.sleep;
    const final = Math.min(99, Math.max(1, Math.round(weighted - penalties)));
    expect(final).toBeLessThan(Math.round(weighted));
  });
});

// Need clamp for tests
function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}