/**
 * ARGON v7.0 — Compute Engine Integration Tests (TDD)
 * Tests the full engine orchestration with realistic fixtures.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { computeEngine, createEmptyComputed, validateComputedOutput } from '@/engine/compute-engine';
import type { ComputeEngineInput, UserProfile, RawBiometricDay, HistoryDay, PrevComputed, EngineConfig } from '@/engine/types';
import { DEFAULT_ENGINE_CONFIG } from '@/engine/index';

const TEST_PROFILE: UserProfile = {
  birth: '1985-06-15',
  height_m: 1.75,
  timezone: 'America/Caracas',
  basalSleepNeedH: 7.5,
  habitualWake: '06:30',
  dailyDeficitKcal: 500,
  biologicalSex: 'male',
};

const TEST_CONFIG: EngineConfig = { ...DEFAULT_ENGINE_CONFIG };

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
    hydration_ml: 2500,
    resp_rate_brpm: 14,
    spo2_pct: 98,
    session_rpe: 7,
    pickleball_or_gym_minutes: 60,
    hr_zones_minutes: {
      z1_minutes: 20,
      z2_minutes: 30,
      z3_minutes: 15,
      z4_minutes: 10,
      z5_minutes: 5,
      real: false,
      workouts: [],
    },
    ...overrides,
  };
}

function createHistory(days: number, baseRmssd = 50, baseRhr = 55): HistoryDay[] {
  return Array.from({ length: days }, (_, i) => ({
    ...createRawDay(),
    log_date: new Date(Date.now() - (i + 1) * 86400000).toISOString().split('T')[0],
    rmssd_ms: baseRmssd,
    rhr_bpm: baseRhr,
    total_sleep_min: 450,
    deep_sleep_min: 90,
    rem_sleep_min: 100,
    strain_score: 8,
    hr_zones_minutes: {
      z1_minutes: 20,
      z2_minutes: 30,
      z3_minutes: 15,
      z4_minutes: 10,
      z5_minutes: 5,
      real: false,
      workouts: [],
    },
  }));
}

function createPrevComputed(): PrevComputed {
  return {
    log_date: '2024-11-19',
    trend_weight_kg: 80.1,
    trend_body_fat_pct: 20.1,
    rmssd_ms: 50,
    rhr_bpm: 55,
    strain_score: 8,
    total_sleep_min: 450,
    recovery_score: 75,
    dynamic_sleep_need_hours: 7.8,
    ln_rmssd: 3.91,
    ln_rmssd_14d_mean: 3.91,
    ln_rmssd_14d_sd: 0.05,
    hrv_z_score: 0,
    rhr_z_score: 0,
    sleep_regularity_pct: 85,
    cumulative_sleep_debt_hours: 0.5,
    hrv_mode: 'night',
  };
}

describe('Compute Engine - Full Orchestration', () => {
  let input: ComputeEngineInput;

  beforeEach(() => {
    input = {
      todayRaw: createRawDay(),
      historyRaw: createHistory(14),
      prevComputed: createPrevComputed(),
      profile: TEST_PROFILE,
      config: TEST_CONFIG,
    };
  });

  it('should compute all 166 columns without errors', () => {
    const result = computeEngine(input);

    // Validate all required columns present
    const validation = validateComputedOutput(result);
    if (!validation.valid) {
      console.log('Missing columns:', validation.missing);
    }
    expect(validation.valid).toBe(true);
    expect(validation.missing).toEqual([]);
  });

  it('should produce valid recovery_score (1-99)', () => {
    const result = computeEngine(input);
    expect(result.recovery_score).not.toBeNull();
    expect(result.recovery_score!).toBeGreaterThanOrEqual(1);
    expect(result.recovery_score!).toBeLessThanOrEqual(99);
  });

  it('should produce valid strain_score (0-21)', () => {
    const result = computeEngine(input);
    expect(result.strain_score).not.toBeNull();
    expect(result.strain_score!).toBeGreaterThanOrEqual(0);
    expect(result.strain_score!).toBeLessThanOrEqual(21);
  });

  it('should produce valid sleep_architecture_score (0-100)', () => {
    const result = computeEngine(input);
    expect(result.sleep_architecture_score).not.toBeNull();
    expect(result.sleep_architecture_score!).toBeGreaterThanOrEqual(0);
    expect(result.sleep_architecture_score!).toBeLessThanOrEqual(100);
  });

  it('should compute body composition metrics', () => {
    const result = computeEngine(input);
    expect(result.ffm_kg).not.toBeNull();
    expect(result.ffm_pct).not.toBeNull();
    expect(result.muscle_mass_kg).not.toBeNull();
    expect(result.visceral_fat_index).not.toBeNull();
    expect(result.bmi).not.toBeNull();
    expect(result.body_comp_score).not.toBeNull();
  });

  it('should compute longevity metrics', () => {
    const result = computeEngine(input);
    expect(result.chronological_age).not.toBeNull();
    expect(result.argon_physiological_age).not.toBeNull();
    expect(result.pace_of_aging_x).not.toBeNull();
    expect(result.total_age_delta).not.toBeNull();
    expect(result.vo2_max_ml_kg_min).not.toBeNull();
  });

  it('should compute nutrition targets', () => {
    const result = computeEngine(input);
    expect(result.target_kcal).not.toBeNull();
    expect(result.target_protein_g).not.toBeNull();
    expect(result.target_carbs_g).not.toBeNull();
    expect(result.target_fat_g).not.toBeNull();
    expect(result.hydration_score).not.toBeNull();
  });

  it('should have correct log_date', () => {
    const result = computeEngine(input);
    expect(result.log_date).toBe('2024-11-20');
  });

  it('should have meta fields populated', () => {
    const result = computeEngine(input);
    expect(result.computed_at).toBeDefined();
    expect(result.computation_version).toBe('v7.0-mbe');
    expect(result.engine_version).toBe('7.0.0');
  });

  it('should handle calibrating state with insufficient HRV history', () => {
    const shortHistory = createHistory(5);
    const calibratingInput = { ...input, historyRaw: shortHistory };
    const result = computeEngine(calibratingInput);
    expect(result.calibrating).toBe(true);
    expect(result.recovery_score).toBeNull();
    // Code.txt uses 'CALIBRATING' (uppercase) during calibration
    expect(result.recovery_status).toBe('CALIBRATING');
  });

  it('should handle sleep_missing when TST < 120 min', () => {
    const noSleepInput = {
      ...input,
      todayRaw: createRawDay({ total_sleep_min: 60, time_in_bed_min: 100 }),
    };
    const result = computeEngine(noSleepInput);
    expect(result.sleep_missing).toBe(true);
    expect(result.sleep_architecture_score).toBeNull();
  });

  it('should handle hrv_missing when RMSSD not provided', () => {
    const noHrvInput = {
      ...input,
      todayRaw: createRawDay({ rmssd_ms: undefined, hrv_rmssd_ms: undefined }),
      historyRaw: createHistory(14, 50, 55).map(h => ({ ...h, rmssd_ms: undefined, hrv_rmssd_ms: undefined })),
    };
    const result = computeEngine(noHrvInput);
    expect(result.hrv_missing).toBe(true);
    expect(result.ln_rmssd).toBeNull();
  });
});

describe('Compute Engine - Empty/Edge Cases', () => {
  it('createEmptyComputed should return valid structure with nulls', () => {
    const empty = createEmptyComputed('2024-11-20');
    expect(empty.log_date).toBe('2024-11-20');
    expect(empty.recovery_score).toBeNull();
    expect(empty.calibrating).toBe(true);
    expect(empty.recovery_status).toBe('insufficient_data');
    expect(empty.engine_version).toBe('7.0.0');
  });

  it('validateComputedOutput should detect missing columns', () => {
    const empty = createEmptyComputed('2024-11-20');
    // Remove a required column
    const { recovery_score, ...incomplete } = empty;
    const validation = validateComputedOutput(incomplete as any);
    expect(validation.valid).toBe(false);
    expect(validation.missing).toContain('recovery_score');
  });
});

describe('Compute Engine - Regression Test: 2026-11-22 Real Production Data', () => {
  // Real production data from 2026-11-22 that previously had 4 failure blocks:
  // Block 1: neuromuscular_load NaN cascade
  // Block 2: Negative TDEE/macros
  // Block 3: Body comp (skeletal_muscle_pct calculated vs raw, body_water_pct/water_mass_kg null)
  // Block 4: sleep_architecture_score null, steps_count null, ln_rmssd precision

  const PROFILE_2026_11_22: UserProfile = {
    birth: '1997-11-12',
    height_m: 1.73,
    timezone: 'America/Caracas',
    basalSleepNeedH: 7.5,
    habitualWake: '06:30',
    dailyDeficitKcal: 500,
    biologicalSex: 'male',
    chronologicalAgeYears: 28,
  };

  const CONFIG: EngineConfig = { ...DEFAULT_ENGINE_CONFIG };

  // Create 14 days of history for rolling window calculations
  function createHistoryForRegression(): HistoryDay[] {
    const baseDate = new Date('2026-11-22');
    const history: HistoryDay[] = [];

    for (let i = 1; i <= 14; i++) {
      const date = new Date(baseDate.getTime() - i * 86400000);
      const logDate = date.toISOString().split('T')[0];

      history.push({
        log_date: logDate,
        rmssd_ms: 80 + Math.random() * 10,
        rhr_bpm: 58 + Math.random() * 4,
        total_sleep_min: 400 + Math.random() * 50,
        deep_sleep_min: 80 + Math.random() * 20,
        rem_sleep_min: 90 + Math.random() * 20,
        light_sleep_min: 200 + Math.random() * 30,
        awake_sleep_min: 20,
        sleep_efficiency_pct: 85 + Math.random() * 10,
        time_in_bed_min: 480,
        steps: 7000 + Math.random() * 2000,
        weight_kg: 85.5 + (Math.random() - 0.5) * 1,
        body_fat_pct: 18 + Math.random() * 2,
        body_water_pct: 54.6,
        water_mass_kg: 46.7,
        vo2_max_ml_kg_min: 48.5,
        hr_zones_minutes: {
          z1_minutes: 20,
          z2_minutes: 30,
          z3_minutes: 15,
          z4_minutes: 10,
          z5_minutes: 5,
          real: false,
          workouts: [],
        },
        strain_score: 8 + Math.random() * 3,
      });
    }
    return history;
  }

  function createRawDay20261122(): RawBiometricDay {
    return {
      log_date: '2026-11-22',
      rmssd_ms: 88,
      rhr_bpm: null, // Missing RHR - tests recovery defaults
      total_sleep_min: 424,
      deep_sleep_min: 84,
      rem_sleep_min: 104,
      light_sleep_min: 236,
      awake_sleep_min: 5,
      sleep_efficiency_pct: 98.8,
      time_in_bed_min: 429,
      steps: 7420, // Should produce steps_count = 7420 (not null)
      intake_kcal: 2100,
      intake_protein_g: 165,
      intake_carbs_g: 220,
      intake_fat_g: 73,
      weight_kg: 85.95,
      body_fat_pct: 18.2,
      skeletal_muscle_pct: 48.9, // Raw value - should be preserved (not calculated 73.5)
      body_water_pct: 54.6, // Raw value - should be preserved
      water_mass_kg: 46.9, // Should be calculated from trend weight * body_water_pct
      hydration_ml: 3000,
      resp_rate_brpm: 16,
      spo2_pct: 97,
      session_rpe: 0, // Zero RPE - should not cause NaN
      pickleball_or_gym_minutes: 161,
      hr_zones_minutes: {
        z1_minutes: 91.2,
        z2_minutes: 30,
        z3_minutes: 28,
        z4_minutes: 8,
        z5_minutes: 0,
        real: true,
        workouts: [
          { id: 'w1', type: 'pickleball', min: 161, rpe: 0, start_ms: 0, end_ms: 0 }
        ],
      },
      is_hospital_shift: false,
      night_awake_shift_hours: 0,
    };
  }

  function createPrevComputed20261122(): PrevComputed {
    return {
      log_date: '2026-11-21',
      trend_weight_kg: 85.8,
      trend_body_fat_pct: 18.3,
      rmssd_ms: 85,
      rhr_bpm: 58,
      resp_rate_brpm: 15.8,
      body_water_pct: 54.5,
      water_mass_kg: 46.8,
      vo2_max_ml_kg_min: 48.4,
      strain_score: 8.5,
      total_sleep_min: 430,
      recovery_score: 72,
      dynamic_sleep_need_hours: 7.8,
      ln_rmssd: 4.44,
      ln_rmssd_14d_mean: 4.42,
      ln_rmssd_14d_sd: 0.08,
      hrv_z_score: 0.3,
      rhr_z_score: -0.2,
      sleep_regularity_pct: 82,
      cumulative_sleep_debt_hours: 1.2,
      hrv_mode: 'night',
    };
  }

  it('should compute all fields correctly for 2026-11-22 (no NaN, no negative, no null for key fields)', () => {
    const todayRaw = createRawDay20261122();
    const historyRaw = createHistoryForRegression();
    const prevComputed = createPrevComputed20261122();

    const input = {
      todayRaw,
      historyRaw,
      prevComputed,
      profile: PROFILE_2026_11_22,
      config: CONFIG,
    };

    const result = computeEngine(input);

    // ========================================================================
    // Block 1: neuromuscular_load NaN cascade
    // ========================================================================
    expect(result.neuromuscular_load).not.toBeNaN();
    expect(result.neuromuscular_load).toBeGreaterThanOrEqual(0);
    expect(typeof result.neuromuscular_load).toBe('number');

    // ========================================================================
    // Block 2: Negative TDEE/macros
    // ========================================================================
    expect(result.dynamic_tdee_kcal).not.toBeNull();
    expect(result.dynamic_tdee_kcal).toBeGreaterThan(1200); // Reasonable minimum
    expect(result.empirical_tdee_kcal).toBeGreaterThanOrEqual(0); // Can be 0 if no intake
    expect(result.target_kcal).not.toBeNull();
    expect(result.target_kcal).toBeGreaterThan(1000);
    expect(result.target_fat_g).not.toBeNull();
    expect(result.target_fat_g).toBeGreaterThan(0);
    expect(result.target_protein_g).not.toBeNull();
    expect(result.target_protein_g).toBeGreaterThan(0);
    expect(result.target_carbs_g).not.toBeNull();
    expect(result.target_carbs_g).toBeGreaterThanOrEqual(0);

    // Verify Code.txt 2026-11-20 reference values (approximate)
    // tmb_kcal: 1780, empirical_tdee_kcal: 2200, dynamic_tdee_kcal: 2200, target_kcal: 2200, target_fat_g: 73
    expect(result.tmb_kcal).toBeGreaterThan(1500);
    expect(result.tmb_kcal).toBeLessThan(2200);

    // ========================================================================
    // Block 3: Body comp - preserve raw values
    // ========================================================================
    // skeletal_muscle_pct should preserve raw 48.9, not calculate 73.5
    expect(result.skeletal_muscle_pct).not.toBeNull();
    expect(result.skeletal_muscle_pct).toBe(48.9); // Raw value preserved
    expect(result.skeletal_muscle_pct).toBeLessThan(60); // Not clamped

    // body_water_pct should preserve raw 54.6
    expect(result.body_water_pct).not.toBeNull();
    expect(result.body_water_pct).toBe(54.6);

    // water_mass_kg should be calculated from trend_weight * body_water_pct
    // trend_weight ~85.8 * 0.546 = 46.8
    expect(result.water_mass_kg).not.toBeNull();
    expect(result.water_mass_kg).toBeGreaterThan(45);
    expect(result.water_mass_kg).toBeLessThan(50);

    // ========================================================================
    // Block 4: Sleep issues
    // ========================================================================
    // sleep_architecture_score should be computed (not null) despite missing regularity history
    expect(result.sleep_architecture_score).not.toBeNull();
    expect(result.sleep_architecture_score).toBeGreaterThan(0);
    expect(result.sleep_architecture_score).toBeLessThanOrEqual(100);

    // steps_count should be 7420 (not null)
    expect(result.steps_count).toBe(7420);

    // ln_rmssd should be a valid finite number (sanitization to 4 decimals happens in recompute-scores.ts)
    expect(result.ln_rmssd).not.toBeNull();
    expect(typeof result.ln_rmssd).toBe('number');
    expect(Number.isFinite(result.ln_rmssd)).toBe(true);
    expect(result.ln_rmssd).toBeGreaterThan(0);
    expect(result.ln_rmssd).toBeLessThan(10);

    // optimal_bedtime_start/end should be valid times (not "NaN:NaN")
    expect(result.optimal_bedtime_start).not.toBeNull();
    expect(result.optimal_bedtime_end).not.toBeNull();
    expect(result.optimal_bedtime_start).not.toContain('NaN');
    expect(result.optimal_bedtime_end).not.toContain('NaN');
    expect(result.optimal_bedtime_start).toMatch(/^\d{2}:\d{2}/);
    expect(result.optimal_bedtime_end).toMatch(/^\d{2}:\d{2}/);

    // clinical_coach_notes should be generated
    expect(result.clinical_coach_notes).not.toBeNull();
    expect(result.clinical_coach_notes).toContain('Recuperación');
    expect(result.clinical_coach_notes).toContain('Strain hoy');
    expect(result.clinical_coach_notes).toContain('Acuéstate entre');

    // ========================================================================
    // General validation
    // ========================================================================
    const validation = validateComputedOutput(result);
    expect(validation.valid).toBe(true);
    expect(validation.missing).toEqual([]);
  });
});