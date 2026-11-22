/**
 * ARGON v7.0 — Body Composition Transformer
 * Parses ghealth weight/body-fat samples, cross-references,
 * EWMA trends, fat/FFM/muscle/bone/water, visceral fat, BMI, Katch-McArdle TDEE.
 * Pure functions, no side effects.
 */

import type {
  GHealthWeightListResponse,
  GHealthBodyFatListResponse,
  GHealthWeightSample,
  GHealthBodyFatSample,
  ParsedBodyCompositionSample,
  BodyCompositionTransformerOutput,
  UserEtlProfile,
} from '@/etl/types';

interface PairedBodyComp {
  date: string;
  weightKg: number | null;
  bodyFatPct: number | null;
}

/**
 * Safely parse a string to number, returning null if invalid.
 * ghealth CLI returns int64 fields as strings in protobuf JSON encoding.
 * weight.value and bodyFatPercentage.value are int64 (strings).
 * weight.unit and bodyFatPercentage.unit are strings.
 */
function parseNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse weight samples from ghealth response
 */
export function parseWeightSamples(
  response: GHealthWeightListResponse
): ParsedBodyCompositionSample[] {
  return (response.dataPoints ?? []).map((sample: GHealthWeightListResponse['dataPoints'][0]) => {
    let weightKg: number | null = null;
    if (sample.weight?.value) {
      const value = parseNumber(sample.weight.value);
      // Convert lb to kg if needed
      if (value !== null && (sample.weight.unit === 'lb' || sample.weight.unit === 'lbs')) {
        weightKg = value * 0.453592;
      } else if (value !== null) {
        weightKg = value;
      }
    }

    return {
      startTimeMillis: parseNumber(sample.startTimeMillis) ?? 0,
      endTimeMillis: parseNumber(sample.endTimeMillis) ?? 0,
      weightKg,
      bodyFatPct: null,
    };
  });
}

/**
 * Parse body fat samples from ghealth response
 */
export function parseBodyFatSamples(
  response: GHealthBodyFatListResponse
): ParsedBodyCompositionSample[] {
  return (response.dataPoints ?? []).map((sample: GHealthBodyFatListResponse['dataPoints'][0]) => {
    let bodyFatPct: number | null = null;
    if (sample.bodyFatPercentage?.value) {
      bodyFatPct = parseNumber(sample.bodyFatPercentage.value);
    }

    return {
      startTimeMillis: parseNumber(sample.startTimeMillis) ?? 0,
      endTimeMillis: parseNumber(sample.endTimeMillis) ?? 0,
      weightKg: null,
      bodyFatPct,
    };
  });
}

/**
 * Parse combined body composition samples from ghealth responses
 */
export function parseBodyCompositionSamples(
  weightResponse: GHealthWeightListResponse,
  bodyFatResponse: GHealthBodyFatListResponse
): ParsedBodyCompositionSample[] {
  const weightSamples = parseWeightSamples(weightResponse);
  const bodyFatSamples = parseBodyFatSamples(bodyFatResponse);
  return [...weightSamples, ...bodyFatSamples];
}

/**
 * Cross-reference weight and body fat samples by date
 * Prefers morning sample (earliest of day) for both weight and body fat
 */
export function crossReferenceWeightAndBodyFat(
  samples: ParsedBodyCompositionSample[]
): PairedBodyComp[] {
  // Group samples by date
  const byDate = new Map<string, ParsedBodyCompositionSample[]>();

  for (const sample of samples) {
    const isoDate = new Date(sample.startTimeMillis).toISOString();
    const date = isoDate.split('T')[0];
    if (!date) continue;
    if (!byDate.has(date)) {
      byDate.set(date, []);
    }
    byDate.get(date)!.push(sample);
  }

  // For each date, pick morning sample (earliest) for weight AND body fat separately
  const paired: PairedBodyComp[] = [];

  for (const [date, daySamples] of byDate.entries()) {
    // Sort by time of day
    daySamples.sort((a, b) => a.startTimeMillis - b.startTimeMillis);

    // Find morning weight sample (first sample with weightKg)
    const morningWeightSample = daySamples.find(s => s.weightKg !== null);
    // Find morning body fat sample (first sample with bodyFatPct)
    const morningBodyFatSample = daySamples.find(s => s.bodyFatPct !== null);

    const weightKg = morningWeightSample?.weightKg ?? null;
    const bodyFatPct = morningBodyFatSample?.bodyFatPct ?? null;

    // Only add if we have at least weight
    if (weightKg !== null) {
      paired.push({ date, weightKg, bodyFatPct });
    }
  }

  // Sort by date
  paired.sort((a, b) => a.date.localeCompare(b.date));

  return paired;
}

/**
 * Compute EWMA (Exponentially Weighted Moving Average) trend
 * alpha = 0.2 for 7-day half-life approximately
 */
export function computeEwmaTrend(values: number[], alpha = 0.2): number[] {
  if (values.length === 0) return [];
  if (values.length === 1) {
    const single = values[0];
    return single !== undefined ? [single] : [];
  }

  const firstValue = values[0];
  if (firstValue === undefined) return [];
  const trend: number[] = [firstValue];
  for (let i = 1; i < values.length; i++) {
    const prev = trend[i - 1];
    const current = values[i];
    if (prev !== undefined && current !== undefined) {
      trend.push(prev * (1 - alpha) + current * alpha);
    }
  }
  return trend;
}

/**
 * Compute visceral fat index estimate
 * Uses BMI and body fat % as proxy since we don't have waist circumference
 * Approximation based on: VFI ≈ (waist_cm / height_cm) * 100
 * Using regression: waist ≈ 64.5 + 0.8 * BMI + 1.5 * BF% (male)
 *                    waist ≈ 59.2 + 0.7 * BMI + 1.3 * BF% (female)
 * Scaled to 0-30 range (typical VFI range)
 */
export function computeVisceralFatIndex(
  weightKg: number,
  heightM: number,
  bodyFatPct: number,
  biologicalSex: 'male' | 'female'
): number {
  const bmi = weightKg / (heightM * heightM);

  let waistCm: number;
  if (biologicalSex === 'male') {
    waistCm = 64.5 + 0.8 * bmi + 1.5 * bodyFatPct;
  } else {
    waistCm = 59.2 + 0.7 * bmi + 1.3 * bodyFatPct;
  }

  const heightCm = heightM * 100;
  const vfi = (waistCm / heightCm) * 100 * 0.3; // Scale factor to keep in range

  return Math.max(0, Math.min(30, Math.round(vfi * 10) / 10));
}

/**
 * Compute BMR and TDEE using Katch-McArdle formula
 * BMR = 370 + 21.6 * LBM (lean body mass in kg)
 * LBM = weight * (1 - bodyFatPct/100)
 * TDEE = BMR * activityFactor
 */
export function computeKatchMcArdleTdee(
  weightKg: number,
  bodyFatPct: number,
  activityFactor: number
): number {
  const lbm = weightKg * (1 - bodyFatPct / 100);
  const bmr = 370 + 21.6 * lbm;
  return Math.round(bmr * activityFactor);
}

/**
 * Compute body composition metrics for a single date
 */
export function computeBodyCompositionMetrics(
  logDate: string,
  paired: PairedBodyComp,
  profile: UserEtlProfile
): BodyCompositionTransformerOutput {
  const { weightKg, bodyFatPct } = paired;

  const bmi = weightKg ? weightKg / (profile.heightM * profile.heightM) : null;

  let ffmKg: number | null = null;
  let fatMassKg: number | null = null;
  let muscleMassKg: number | null = null;
  let waterKg: number | null = null;
  let boneMassKg: number | null = null;
  let visceralFatIndex: number | null = null;

  if (weightKg !== null && bodyFatPct !== null) {
    fatMassKg = weightKg * (bodyFatPct / 100);
    ffmKg = weightKg - fatMassKg;

    // Muscle mass estimation (sex-specific)
    // Male: ~50% of FFM, Female: ~45% of FFM
    const musclePct = profile.biologicalSex === 'male' ? 0.50 : 0.45;
    muscleMassKg = ffmKg * musclePct;

    // Bone mass ~15% of FFM
    boneMassKg = ffmKg * 0.15;

    // Total body water ~73% of FFM
    waterKg = ffmKg * 0.73;

    // Visceral fat index
    visceralFatIndex = computeVisceralFatIndex(weightKg, profile.heightM, bodyFatPct, profile.biologicalSex);
  }

  // Round to 1 decimal place for output
  const round1 = (n: number | null) => n !== null ? Math.round(n * 10) / 10 : null;

  return {
    log_date: logDate,
    weight_kg: round1(weightKg),
    body_fat_pct: round1(bodyFatPct),
    bmi: round1(bmi),
    ffm_kg: round1(ffmKg),
    fat_mass_kg: round1(fatMassKg),
    muscle_mass_kg: round1(muscleMassKg),
    water_kg: round1(waterKg),
    bone_mass_kg: round1(boneMassKg),
    visceral_fat_index: visceralFatIndex,
  };
}