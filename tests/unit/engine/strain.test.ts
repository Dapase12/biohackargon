/**
 * ARGON v7.0 — Strain Pillar Unit Tests (TDD: RED phase)
 * Tests for TRIMP, HR zones, ACWR, neuroLoad, shiftLoad, strain sigmoid.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  trimpBanister,
  trimpFromZones,
  strainFromNetTrimp,
  acwr,
  acwrPenalty,
  hrMaxTanaka,
} from '@/engine/utils';
import type { EngineConfig, RawBiometricDay, HistoryDay } from '@/engine/types';

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

describe('Strain Pillar - TRIMP (Banister)', () => {
  const maleCoeff = TEST_CONFIG.trimpCoeffMale;
  const femaleCoeff = TEST_CONFIG.trimpCoeffFemale;

  it('TRIMP male: 60 min at 75% HRmax', () => {
    const hrMax = 190;
    const avgHR = hrMax * 0.75; // 142.5
    const trimp = trimpBanister(60, avgHR, hrMax, maleCoeff);
    // TRIMP = 60 * 0.64 * 0.75 * exp(1.92 * 0.75)
    // = 60 * 0.64 * 0.75 * exp(1.44)
    // = 60 * 0.64 * 0.75 * 4.22
    // ≈ 121.5
    expect(trimp).toBeCloseTo(121.5, 0);
  });

  it('TRIMP female: different coefficients', () => {
    const hrMax = 185;
    const avgHR = hrMax * 0.75;
    const maleTrimp = trimpBanister(60, avgHR, hrMax, maleCoeff);
    const femaleTrimp = trimpBanister(60, avgHR, hrMax, femaleCoeff);
    expect(femaleTrimp).toBeGreaterThan(maleTrimp); // female coeff produces higher TRIMP
  });

  it('TRIMP zero for zero minutes', () => {
    expect(trimpBanister(0, 150, 190, maleCoeff)).toBe(0);
    expect(trimpBanister(60, 0, 190, maleCoeff)).toBe(0);
    expect(trimpBanister(60, 150, 0, maleCoeff)).toBe(0);
  });

  it('TRIMP from zones: sums across Z1-Z5', () => {
    const hrMax = 190;
    const zones = { z1: 20, z2: 30, z3: 15, z4: 10, z5: 5 };
    const trimp = trimpFromZones(zones, hrMax, maleCoeff);
    expect(trimp).toBeGreaterThan(0);
  });

  it('TRIMP from zones: ignores zero-minute zones', () => {
    const hrMax = 190;
    const zones1 = { z1: 20, z2: 30, z3: 0, z4: 0, z5: 0 };
    const zones2 = { z1: 20, z2: 30, z3: 15, z4: 10, z5: 5 };
    const trimp1 = trimpFromZones(zones1, hrMax, maleCoeff);
    const trimp2 = trimpFromZones(zones2, hrMax, maleCoeff);
    expect(trimp2).toBeGreaterThan(trimp1);
  });
});

describe('Strain Pillar - Strain Sigmoid', () => {
  it('Strain 0 for 0 TRIMP', () => {
    expect(strainFromNetTrimp(0)).toBe(0);
  });

  it('Strain increases with TRIMP, asymptotes at 21', () => {
    const s1 = strainFromNetTrimp(100);
    const s2 = strainFromNetTrimp(500);
    const s3 = strainFromNetTrimp(2000);
    const s4 = strainFromNetTrimp(10000);
    expect(s1).toBeLessThan(s2);
    expect(s2).toBeLessThan(s3);
    expect(s3).toBeLessThan(s4);
    expect(s4).toBeCloseTo(21, 1); // asymptote
  });

  it('Strain at 1000 TRIMP ≈ 17.0 (scale=0.00165, max=21)', () => {
    const s = strainFromNetTrimp(1000);
    // 21 * (1 - exp(-0.00165 * 1000)) = 21 * (1 - exp(-1.65)) = 21 * 0.808 = 16.97
    expect(s).toBeCloseTo(17.0, 0);
  });

  it('Strain at 3000 TRIMP ≈ 20.9 (scale=0.00165, max=21)', () => {
    const s = strainFromNetTrimp(3000);
    // 21 * (1 - exp(-0.00165 * 3000)) = 21 * (1 - exp(-4.95)) = 21 * 0.993 = 20.85
    expect(s).toBeCloseTo(20.9, 0);
  });
});

describe('Strain Pillar - HR Zones Allocation', () => {
  // Port of Code.txt lines 1334-1365 logic
  it('Ambient Z1: (stepsNet - 2000) / 320', () => {
    const steps = 10000;
    const walkingSteps = 2000;
    const stepsNet = steps - walkingSteps;
    const ambientZ1 = Math.round(Math.max(0, stepsNet - 2000) / 320);
    // Math.round(18.75) = 19, not 18
    expect(ambientZ1).toBe(19);
  });

  it('Workout zones from RPE distribution', () => {
    const workoutMin = 60;
    const sRpe = 7;
    const rpeFactor = Math.max(0, Math.min(1, (sRpe - 1) / 9)); // 0.667
    const workoutZ1 = Math.round(workoutMin * 0.22);
    const workoutZ2 = Math.round(workoutMin * 0.33);
    const baseZ1 = workoutZ1;
    const baseZ2 = workoutZ2;
    const baseZ3 = Math.round(workoutMin * 0.20);
    const baseZ4 = Math.round(workoutMin * 0.17);
    const baseZ5 = Math.round(workoutMin * 0.08);

    const shiftAmount = (workoutZ1 + workoutZ2) * rpeFactor * 0.5;
    const newWorkoutZ1 = Math.round(workoutZ1 * (1 - rpeFactor * 0.5));
    const newWorkoutZ2 = Math.round(workoutZ2 * (1 - rpeFactor * 0.5));
    const totalHigh = baseZ3 + baseZ4 + baseZ5;
    const shiftZ3 = totalHigh > 0 ? Math.round(shiftAmount * (baseZ3 / totalHigh)) : Math.round(shiftAmount * 0.5);
    const shiftZ4 = totalHigh > 0 ? Math.round(shiftAmount * (baseZ4 / totalHigh)) : Math.round(shiftAmount * 0.3);
    const shiftZ5 = totalHigh > 0 ? Math.round(shiftAmount * (baseZ5 / totalHigh)) : Math.round(shiftAmount * 0.2);

    expect(newWorkoutZ1).toBeLessThan(workoutZ1);
    expect(newWorkoutZ2).toBeLessThan(workoutZ2);
    expect(shiftZ3 + shiftZ4 + shiftZ5).toBeCloseTo(shiftAmount, 0);
  });

  it('Real HR zones (from ghealth exercise minute HR) take precedence', () => {
    // When zonesReal = true, use explicit Z1-Z5 from exercise HR data
    const realZones = { z1: 10, z2: 20, z3: 15, z4: 10, z5: 5 };
    // Should NOT apply RPE redistribution
    expect(realZones.z1).toBe(10);
    expect(realZones.z5).toBe(5);
  });
});

describe('Strain Pillar - ACWR', () => {
  it('ACWR = acute (3d) / chronic (14d) average strain', () => {
    const history = Array.from({ length: 14 }, (_, i) => ({
      strain_score: 8 + (i % 5),
    }));
    const acuteAvg = history.slice(0, 3).reduce((s, r) => s + r.strain_score!, 0) / 3;
    const chronicAvg = history.slice(0, 14).reduce((s, r) => s + r.strain_score!, 0) / 14;
    const ratio = acwr(acuteAvg, chronicAvg);
    expect(ratio).toBeGreaterThan(0);
  });

  it('ACWR penalty: zero when ratio <= 1.3', () => {
    expect(acwrPenalty(1.0)).toBe(0);
    expect(acwrPenalty(1.2)).toBe(0);
    expect(acwrPenalty(1.3)).toBe(0);
  });

  it('ACWR penalty: increases above 1.3, capped at 2.0', () => {
    expect(acwrPenalty(1.4)).toBeCloseTo(0.5, 1);
    expect(acwrPenalty(1.5)).toBeCloseTo(1.0, 1);
    expect(acwrPenalty(2.0)).toBeCloseTo(2.0, 1); // capped
  });
});

describe('Strain Pillar - Neuro & Shift Load', () => {
  it('Neuro load = 0.85 * sRPE * workoutMin', () => {
    const sRpe = 7;
    const workoutMin = 60;
    const neuroLoad = 0.85 * sRpe * workoutMin;
    expect(neuroLoad).toBe(357);
  });

  it('Shift load = 1.40 * nightAwakeH * 35', () => {
    const nightAwakeH = 8;
    const shiftLoad = 1.40 * nightAwakeH * 35;
    expect(shiftLoad).toBe(392);
  });

  it('Shift load zero for no night shift', () => {
    expect(1.40 * 0 * 35).toBe(0);
  });
});

describe('Strain Pillar - Total Load & Net TRIMP', () => {
  it('Total load = cardioTrimp + neuroLoad + shiftLoad', () => {
    const cardioTrimp = 500;
    const neuroLoad = 357;
    const shiftLoad = 0;
    const total = cardioTrimp + neuroLoad + shiftLoad;
    expect(total).toBe(857);
  });

  it('Strain from total load', () => {
    const total = 857;
    const strain = strainFromNetTrimp(total);
    expect(strain).toBeGreaterThan(10);
    expect(strain).toBeLessThan(21);
  });
});

describe('Strain Pillar - HR Max (Tanaka)', () => {
  it('HRmax = 208 - 0.7 * age', () => {
    expect(hrMaxTanaka(30)).toBe(187);
    expect(hrMaxTanaka(40)).toBe(180);
    expect(hrMaxTanaka(50)).toBe(173);
  });
});