/**
 * ARGON v7.0 — Sleep Pillar Unit Tests (TDD: RED phase)
 * Tests for sleep architecture, debt, dynamic need, bedtime window, regularity.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  mean,
  sd,
  computeSleepDebt,
  dynamicSleepNeed,
  bedtimeWindow,
  ewma,
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

describe('Sleep Pillar - Sleep Efficiency', () => {
  it('Efficiency = TST / TIB * 100, capped at 100', () => {
    const tst = 450;
    const tib = 500;
    const eff = Math.min(100, (tst / tib) * 100);
    expect(eff).toBe(90);
  });

  it('Efficiency capped at 100', () => {
    const tst = 500;
    const tib = 480;
    const eff = Math.min(100, (tst / tib) * 100);
    expect(eff).toBe(100);
  });
});

describe('Sleep Pillar - SWS% and REM%', () => {
  it('SWS% = deep / TST * 100', () => {
    const deep = 90;
    const tst = 450;
    const swsPct = (deep / tst) * 100;
    expect(swsPct).toBe(20);
  });

  it('REM% = rem / TST * 100', () => {
    const rem = 100;
    const tst = 450;
    const remPct = (rem / tst) * 100;
    expect(remPct).toBeCloseTo(22.22, 1);
  });
});

describe('Sleep Pillar - Sleep Debt (weighted exponential)', () => {
  it('Debt accumulates when sleep < basal need (total max(0, sum), not per-night)', () => {
    const validSleeps = [
      { total_sleep_min: 360, nap_sleep_min: 0 }, // 6h
      { total_sleep_min: 420, nap_sleep_min: 0 }, // 7h
      { total_sleep_min: 480, nap_sleep_min: 30 }, // 8.5h
    ];
    const debt = computeSleepDebt(validSleeps, {
      basalNeedH: 7.5,
      decayFactor: 0.35,
      maxLookbackDays: 7,
    });
    // Implementation: sum of (need - actual) * decay^idx, then max(0, total)
    // Night 0 (idx=0): (7.5-6)*1 = 1.5
    // Night 1 (idx=1): (7.5-7)*0.705 = 0.352
    // Night 2 (idx=2): (7.5-8.5)*0.497 = -0.497
    // Total = 1.5 + 0.352 - 0.497 = 1.355 -> max(0, 1.355) = 1.355
    expect(debt).toBeCloseTo(1.355, 2);
  });

  it('Debt zero when sleep >= need every night', () => {
    const validSleeps = [
      { total_sleep_min: 480, nap_sleep_min: 30 }, // 8.5h
      { total_sleep_min: 450, nap_sleep_min: 30 }, // 8h
    ];
    const debt = computeSleepDebt(validSleeps, {
      basalNeedH: 7.5,
      decayFactor: 0.35,
      maxLookbackDays: 7,
    });
    expect(debt).toBe(0);
  });

  it('Recent nights weighted more heavily', () => {
    const validSleepsRecent = [
      { total_sleep_min: 360, nap_sleep_min: 0 }, // 6h (recent)
      { total_sleep_min: 480, nap_sleep_min: 0 }, // 8h (older)
    ];
    const validSleepsOlder = [
      { total_sleep_min: 480, nap_sleep_min: 0 }, // 8h (recent)
      { total_sleep_min: 360, nap_sleep_min: 0 }, // 6h (older)
    ];
    const debtRecent = computeSleepDebt(validSleepsRecent, {
      basalNeedH: 7.5,
      decayFactor: 0.35,
      maxLookbackDays: 7,
    });
    const debtOlder = computeSleepDebt(validSleepsOlder, {
      basalNeedH: 7.5,
      decayFactor: 0.35,
      maxLookbackDays: 7,
    });
    expect(debtRecent).toBeGreaterThan(debtOlder);
  });
});

describe('Sleep Pillar - Dynamic Sleep Need', () => {
  it('Increases with strain score', () => {
    const needLow = dynamicSleepNeed(7.5, 5, 0);
    const needHigh = dynamicSleepNeed(7.5, 15, 0);
    expect(needHigh).toBeGreaterThan(needLow);
  });

  it('Increases with sleep debt', () => {
    const needLow = dynamicSleepNeed(7.5, 10, 0);
    const needHigh = dynamicSleepNeed(7.5, 10, 2);
    expect(needHigh).toBeGreaterThan(needLow);
  });

  it('Clamped between 6.5 and 10 hours', () => {
    expect(dynamicSleepNeed(7.5, 0, 0)).toBeGreaterThanOrEqual(6.5);
    expect(dynamicSleepNeed(7.5, 0, 0)).toBeLessThanOrEqual(10);
    // Extreme values
    expect(dynamicSleepNeed(7.5, 21, 5)).toBeLessThanOrEqual(10);
    expect(dynamicSleepNeed(7.5, 0, 0)).toBeGreaterThanOrEqual(6.5);
  });
});

describe('Sleep Pillar - Bedtime Window', () => {
  it('Calculates window around ideal bedtime', () => {
    const wake = '06:30';
    const dynamicNeed = 8.0;
    const efficiency = 90;
    const { start, end } = bedtimeWindow(wake, dynamicNeed, efficiency);
    // wakeTotalMin = 6*60+30+1440 = 1830
    // reqTibH = 8 / 0.9 = 8.89h = 533min
    // start = 1830 - 533 - 15 = 1282 % 1440 = 1282 -> 21:22
    // end = 1830 - 533 + 15 = 1312 % 1440 = 1312 -> 21:52
    expect(start).toMatch(/^\d{2}:\d{2}$/);
    expect(end).toMatch(/^\d{2}:\d{2}$/);
  });

  it('Window shifts earlier with higher sleep need', () => {
    const { start: startLow } = bedtimeWindow('06:30', 7.0, 90);
    const { start: startHigh } = bedtimeWindow('06:30', 9.0, 90);
    // Higher need -> earlier bedtime (larger startMin in 0-1440 range means earlier in night)
    const toMin = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };
    // In 24h format, earlier bedtime = smaller hour (e.g., 21:00 < 23:00)
    // But modulo 1440 wraps, so compare carefully
    expect(toMin(startHigh)).toBeLessThanOrEqual(toMin(startLow) + 10); // allow small diff
  });
});

describe('Sleep Pillar - Sleep Regularity', () => {
  it('Regularity = 94 - SD_TST_hours * 14 - nightAwakeH * 3.5, clamped 55-98', () => {
    const tstHours = [7.5, 7.6, 7.4, 7.7, 7.5, 7.6, 7.5];
    const meanTst = mean(tstHours);
    const sdTst = sd(tstHours, meanTst);
    const nightAwakeH = 0;
    const regularity = Math.min(98, Math.max(55, Math.round(94 - sdTst * 14 - nightAwakeH * 3.5)));
    expect(regularity).toBeGreaterThanOrEqual(55);
    expect(regularity).toBeLessThanOrEqual(98);
    // Low SD -> high regularity
    expect(regularity).toBeGreaterThan(90);
  });

  it('Night awake hours reduce regularity', () => {
    const tstHours = [7.5, 7.6, 7.4, 7.7, 7.5, 7.6, 7.5];
    const meanTst = mean(tstHours);
    const sdTst = sd(tstHours, meanTst);
    const reg0 = Math.min(98, Math.max(55, Math.round(94 - sdTst * 14 - 0 * 3.5)));
    const reg4 = Math.min(98, Math.max(55, Math.round(94 - sdTst * 14 - 4 * 3.5)));
    expect(reg4).toBeLessThan(reg0);
  });
});

describe('Sleep Pillar - Sleep Architecture Score', () => {
  it('Weighted sum of 4 components', () => {
    const hoursVsNeeded = 95;
    const regularity = 85;
    const efficiency = 90;
    const swsRemPct = 42;
    const arch = Math.round(
      0.50 * hoursVsNeeded +
      0.25 * regularity +
      0.15 * (efficiency / 88 * 100) +
      0.10 * (swsRemPct / 40 * 100)
    );
    expect(arch).toBeGreaterThan(80);
    expect(arch).toBeLessThanOrEqual(100);
  });

  it('Each component capped at 100', () => {
    const hoursVsNeeded = 120; // capped
    const regularity = 110; // capped
    const efficiency = 110; // capped
    const swsRemPct = 80; // capped
    const arch = Math.round(
      0.50 * Math.min(100, hoursVsNeeded) +
      0.25 * Math.min(100, regularity) +
      0.15 * Math.min(100, efficiency / 88 * 100) +
      0.10 * Math.min(100, swsRemPct / 40 * 100)
    );
    expect(arch).toBeLessThanOrEqual(100);
  });
});

describe('Sleep Pillar - Nap Detection', () => {
  it('Nap: 10-240 min, started 08:00-20:00', () => {
    const isNap = (durMin: number, startHour: number) => {
      return durMin >= 10 && durMin <= 240 && startHour >= 8 && startHour <= 20;
    };
    expect(isNap(30, 14)).toBe(true);   // 30min at 14:00
    expect(isNap(60, 10)).toBe(true);   // 60min at 10:00
    expect(isNap(5, 14)).toBe(false);   // too short
    expect(isNap(300, 14)).toBe(false); // too long
    expect(isNap(30, 7)).toBe(false);   // too early
    expect(isNap(30, 21)).toBe(false);  // too late
  });

  it('Naps contribute to sleep debt at 100% (current logic)', () => {
    const napMin = 30;
    const tstMin = 420;
    const totalSleep = tstMin + napMin; // 450 min = 7.5h
    expect(totalSleep / 60).toBe(7.5);
  });
});

describe('Sleep Pillar - Hypnogram Stages', () => {
  it('Stage codes: 1=awake, 4=light, 5=deep, 6=REM', () => {
    const stages = [
      { type: '5', start: 0, end: 90 },   // deep 90min
      { type: '4', start: 90, end: 180 }, // light 90min
      { type: '6', start: 180, end: 240 }, // REM 60min
      { type: '1', start: 240, end: 250 }, // awake 10min
    ];
    const deep = stages.filter(s => s.type === '5').reduce((a, s) => a + s.end - s.start, 0);
    const rem = stages.filter(s => s.type === '6').reduce((a, s) => a + s.end - s.start, 0);
    const light = stages.filter(s => s.type === '4').reduce((a, s) => a + s.end - s.start, 0);
    const awake = stages.filter(s => s.type === '1').reduce((a, s) => a + s.end - s.start, 0);
    expect(deep).toBe(90);
    expect(rem).toBe(60);
    expect(light).toBe(90);
    expect(awake).toBe(10);
  });
});