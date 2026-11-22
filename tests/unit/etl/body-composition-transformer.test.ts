/**
 * ARGON v7.0 — Body Composition Transformer Unit Tests (TDD: RED phase)
 * Tests for parsing ghealth weight/body-fat samples, cross-referencing,
 * EWMA trends, fat/FFM/muscle/bone/water, visceral fat, BMI, Katch-McArdle TDEE.
 * Based on real ghealth payloads.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type {
  GHealthBodyCompositionResponse,
  ParsedBodyCompositionSample,
  BodyCompositionTransformerOutput,
  UserEtlProfile,
} from '@/etl/types';
import {
  parseBodyCompositionSamples,
  crossReferenceWeightAndBodyFat,
  computeBodyCompositionMetrics,
  computeEwmaTrend,
  computeVisceralFatIndex,
  computeKatchMcArdleTdee,
} from '@/etl/transformers/body-composition';

// ========================================================================
// REAL GHEALTH PAYLOAD FIXTURES
// ========================================================================

const FIXTURE_BODY_COMP_RESPONSE = {
  samples: [
    // Morning weight
    {
      startTimeMillis: "1732104000000", // 2024-11-20 07:00:00 -04:00
      endTimeMillis: "1732104060000",
      weight: { value: "80.5", unit: "kg" },
      bodyFatPercentage: { value: "20.2", unit: "%" },
    },
    // Evening weight
    {
      startTimeMillis: "1732136400000", // 2024-11-20 19:00:00 -04:00
      endTimeMillis: "1732136460000",
      weight: { value: "80.8", unit: "kg" },
      bodyFatPercentage: { value: "20.0", unit: "%" },
    },
    // Next day morning
    {
      startTimeMillis: "1732190400000", // 2024-11-21 07:00:00 -04:00
      endTimeMillis: "1732190460000",
      weight: { value: "80.3", unit: "kg" },
      bodyFatPercentage: { value: "20.5", unit: "%" },
    },
  ],
  nextPageToken: null,
};

const TEST_PROFILE: UserEtlProfile = {
  age: 30,
  restingHR: 55,
  maxHR: 187,
  biologicalSex: 'male',
  heightM: 1.75,
};

describe('ETL Transformers - Body Composition', () => {
  let samples: ParsedBodyCompositionSample[];

  beforeEach(() => {
    samples = parseBodyCompositionSamples(FIXTURE_BODY_COMP_RESPONSE);
  });

  describe('parseBodyCompositionSamples', () => {
    it('parses body composition samples from ghealth response', () => {
      expect(samples).toHaveLength(3);
    });

    it('converts string numeric fields to numbers', () => {
      expect(typeof samples[0].weightKg).toBe('number');
      expect(samples[0].weightKg).toBe(80.5);
      expect(typeof samples[0].bodyFatPct).toBe('number');
      expect(samples[0].bodyFatPct).toBe(20.2);
    });

    it('converts timestamps to numbers', () => {
      expect(typeof samples[0].startTimeMillis).toBe('number');
      expect(samples[0].startTimeMillis).toBe(1732104000000);
    });

    it('handles missing weight or body fat', () => {
      const response = {
        samples: [{ startTimeMillis: "1000", endTimeMillis: "2000" }],
        nextPageToken: null,
      };
      const parsed = parseBodyCompositionSamples(response);
      expect(parsed[0].weightKg).toBeNull();
      expect(parsed[0].bodyFatPct).toBeNull();
    });

    it('handles different units (kg, lb)', () => {
      const response = {
        samples: [
          { startTimeMillis: "1000", endTimeMillis: "2000", weight: { value: "177", unit: "lb" }, bodyFatPercentage: { value: "20", unit: "%" } },
        ],
        nextPageToken: null,
      };
      const parsed = parseBodyCompositionSamples(response);
      // Should convert lb to kg: 177 lb = 80.28 kg
      expect(parsed[0].weightKg).toBeCloseTo(80.3, 1);
    });
  });

  describe('crossReferenceWeightAndBodyFat', () => {
    it('pairs weight and body fat samples by date (same day)', () => {
      const paired = crossReferenceWeightAndBodyFat(samples);
      // 3 samples across 2 days (Nov 20 has 2, Nov 21 has 1)
      // Should pair morning/evening for Nov 20
      expect(paired.length).toBeGreaterThan(0);
    });

    it('uses morning weight preference when multiple per day', () => {
      const paired = crossReferenceWeightAndBodyFat(samples);
      const nov20 = paired.find(p => p.date === '2024-11-20');
      expect(nov20).toBeDefined();
      // Morning weight (80.5) should be preferred over evening (80.8)
      expect(nov20!.weightKg).toBe(80.5);
    });

    it('handles days with only weight or only body fat', () => {
      const samplesWithGaps = [
        ...samples,
        { startTimeMillis: 1732276800000, endTimeMillis: 1732276860000, weightKg: 81.0, bodyFatPct: null }, // Nov 22 weight only
      ];
      const paired = crossReferenceWeightAndBodyFat(samplesWithGaps);
      const nov22 = paired.find(p => p.date === '2024-11-22');
      expect(nov22).toBeDefined();
      expect(nov22!.weightKg).toBe(81.0);
      expect(nov22!.bodyFatPct).toBeNull();
    });
  });

  describe('computeEwmaTrend', () => {
    it('computes EWMA with alpha=0.2', () => {
      const values = [80, 80.5, 80.3, 80.8, 80.6];
      const trend = computeEwmaTrend(values, 0.2);
      expect(trend.length).toBe(values.length);
      expect(trend[0]).toBe(80); // First value is seed
      // Each subsequent: prev * (1-alpha) + current * alpha
      expect(trend[1]).toBeCloseTo(80.1, 1);
    });

    it('handles empty array', () => {
      expect(computeEwmaTrend([], 0.2)).toEqual([]);
    });

    it('handles single value', () => {
      expect(computeEwmaTrend([80], 0.2)).toEqual([80]);
    });
  });

  describe('computeVisceralFatIndex', () => {
    it('estimates visceral fat from waist/height ratio approximation', () => {
      // Using BMI and body fat % as proxy
      const vfi = computeVisceralFatIndex(80, 1.75, 20, 'male');
      expect(vfi).toBeGreaterThan(0);
      expect(vfi).toBeLessThan(30);
    });

    it('returns higher VFI for higher body fat', () => {
      const vfiLow = computeVisceralFatIndex(80, 1.75, 15, 'male');
      const vfiHigh = computeVisceralFatIndex(80, 1.75, 30, 'male');
      expect(vfiHigh).toBeGreaterThan(vfiLow);
    });

    it('handles female differently', () => {
      const vfiMale = computeVisceralFatIndex(80, 1.75, 20, 'male');
      const vfiFemale = computeVisceralFatIndex(80, 1.75, 20, 'female');
      // Females typically have lower visceral fat at same BF%
      expect(vfiMale).toBeGreaterThanOrEqual(vfiFemale);
    });
  });

  describe('computeKatchMcArdleTdee', () => {
    it('computes TDEE from LBM using Katch-McArdle', () => {
      // LBM = weight * (1 - bodyFatPct/100) = 80 * 0.8 = 64 kg
      // BMR = 370 + 21.6 * LBM = 370 + 21.6 * 64 = 1752.4
      // TDEE = BMR * activityFactor (sedentary=1.2)
      const tdee = computeKatchMcArdleTdee(80, 20, 1.2);
      expect(tdee).toBeCloseTo(2103, 0); // 1752.4 * 1.2 = 2102.88
    });

    it('uses correct activity multipliers', () => {
      const sedentary = computeKatchMcArdleTdee(80, 20, 1.2);
      const light = computeKatchMcArdleTdee(80, 20, 1.375);
      const moderate = computeKatchMcArdleTdee(80, 20, 1.55);
      const very = computeKatchMcArdleTdee(80, 20, 1.725);
      const extra = computeKatchMcArdleTdee(80, 20, 1.9);

      expect(light).toBeGreaterThan(sedentary);
      expect(moderate).toBeGreaterThan(light);
      expect(very).toBeGreaterThan(moderate);
      expect(extra).toBeGreaterThan(very);
    });

    it('handles zero body fat edge case', () => {
      const tdee = computeKatchMcArdleTdee(80, 0, 1.2);
      // LBM = 80, BMR = 370 + 21.6*80 = 2098, TDEE = 2517.6
      expect(tdee).toBeCloseTo(2518, 0);
    });
  });

  describe('computeBodyCompositionMetrics', () => {
    it('produces complete BodyCompositionTransformerOutput', () => {
      const paired = crossReferenceWeightAndBodyFat(samples);
      const output = computeBodyCompositionMetrics('2024-11-20', paired[0], TEST_PROFILE);

      expect(output.log_date).toBe('2024-11-20');
      expect(output.weight_kg).toBe(80.5);
      expect(output.body_fat_pct).toBe(20.2);
      expect(output.bmi).toBeCloseTo(26.3, 1); // 80.5 / (1.75^2)
      expect(output.ffm_kg).toBeCloseTo(64.2, 1); // 80.5 * 0.798
      expect(output.muscle_mass_kg).toBeGreaterThan(0);
      expect(output.visceral_fat_index).toBeGreaterThan(0);
    });

    it('computes fat mass and FFM correctly', () => {
      const paired = crossReferenceWeightAndBodyFat(samples);
      const output = computeBodyCompositionMetrics('2024-11-20', paired[0], TEST_PROFILE);

      const fatMass = output.weight_kg! * (output.body_fat_pct! / 100);
      const ffm = output.weight_kg! - fatMass;
      expect(output.ffm_kg).toBeCloseTo(ffm, 1);
      expect(output.fat_mass_kg).toBeCloseTo(fatMass, 1);
    });

    it('estimates muscle mass as ~50% of FFM for males', () => {
      const paired = crossReferenceWeightAndBodyFat(samples);
      const output = computeBodyCompositionMetrics('2024-11-20', paired[0], TEST_PROFILE);

      // Male muscle mass ~50% of FFM
      expect(output.muscle_mass_kg).toBeCloseTo(output.ffm_kg! * 0.5, 1);
    });

    it('estimates bone mass as ~15% of FFM', () => {
      const paired = crossReferenceWeightAndBodyFat(samples);
      const output = computeBodyCompositionMetrics('2024-11-20', paired[0], TEST_PROFILE);

      expect(output.bone_mass_kg).toBeCloseTo(output.ffm_kg! * 0.15, 1);
    });

    it('estimates water as ~73% of FFM', () => {
      const paired = crossReferenceWeightAndBodyFat(samples);
      const output = computeBodyCompositionMetrics('2024-11-20', paired[0], TEST_PROFILE);

      expect(output.water_kg).toBeCloseTo(output.ffm_kg! * 0.73, 1);
    });

    it('handles missing body fat gracefully', () => {
      const paired = [{ date: '2024-11-20', weightKg: 80, bodyFatPct: null }];
      const output = computeBodyCompositionMetrics('2024-11-20', paired[0], TEST_PROFILE);

      expect(output.weight_kg).toBe(80);
      expect(output.body_fat_pct).toBeNull();
      expect(output.bmi).toBeCloseTo(26.1, 1);
      expect(output.ffm_kg).toBeNull();
      expect(output.visceral_fat_index).toBeNull();
    });
  });

  describe('Full body composition pipeline', () => {
    it('produces complete output for a date with paired data', () => {
      const paired = crossReferenceWeightAndBodyFat(samples);
      const nov20 = paired.find(p => p.date === '2024-11-20')!;

      const output: BodyCompositionTransformerOutput = computeBodyCompositionMetrics(
        '2024-11-20',
        nov20,
        TEST_PROFILE
      );

      expect(output.log_date).toBe('2024-11-20');
      expect(output.weight_kg).toBe(80.5);
      expect(output.body_fat_pct).toBe(20.2);
      expect(output.bmi).toBeGreaterThan(0);
      expect(output.ffm_kg).toBeGreaterThan(0);
      expect(output.muscle_mass_kg).toBeGreaterThan(0);
      expect(output.water_kg).toBeGreaterThan(0);
      expect(output.bone_mass_kg).toBeGreaterThan(0);
      expect(output.visceral_fat_index).toBeGreaterThan(0);
      expect(output.fat_mass_kg).toBeGreaterThan(0);
    });
  });
});