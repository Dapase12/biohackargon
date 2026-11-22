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
    expect(result.recovery_status).toBe('calibrating');
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