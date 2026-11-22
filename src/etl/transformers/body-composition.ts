/**
 * ARGON v7.0 — Body Composition Transformer
 * Parses ghealth weight/body-fat samples, cross-references,
 * EWMA trends, fat/FFM/muscle/bone/water, visceral fat, BMI, Katch-McArdle TDEE.
 * Pure functions, no side effects.
 * Input: ghealth SIMPLIFIED JSON (--format json)
 * Matches simplify.go: weight/body-fat have 'time' (ISO 8601 with offset) or 'date' (YYYY-MM-DD)
 */

import type {
  GHealthWeightListResponse,
  GHealthBodyFatListResponse,
  GHealthWeightSimplifiedSample,
  GHealthBodyFatSimplifiedSample,
  ParsedBodyCompositionSample,
  BodyCompositionTransformerOutput,
  UserEtlProfile,
} from '@/etl/types';

interface PairedBodyComp {
  date: string; // Local date YYYY-MM-DD from timestamp prefix
  weightKg: number | null;
  bodyFatPct: number | null;
}

/**
 * Safely parse a string to number, returning null if invalid.
 * ghealth CLI returns int64 fields as strings in protobuf JSON encoding.
 */
function parseNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse ISO 8601 datetime string (with offset) to milliseconds since epoch
 * Correctly handles timezone offsets like "2024-11-20T07:30:00-04:00"
 * Uses manual parsing to ensure offset is applied correctly across all environments
 */
function parseIsoToMillis(isoString: string | undefined): number {
  if (!isoString) {
    throw new Error('ISO 8601 datetime string is required');
  }
  // Handle formats from ghealth simplified JSON:
  // "2024-11-20T07:30:00-04:00" or "2024-11-20T07:30:00Z" or "2024-11-20T07:30:00.000-04:00"

  // Split into date/time part and timezone part
  let dateTimePart = isoString;
  let tzPart: string = '';

  // Find timezone indicator (Z or +/-HH:MM or +/-HHMM at the end)
  const tzMatch = isoString.match(/(Z|[+-]\d{2}:?\d{2})$/);
  if (tzMatch) {
    tzPart = tzMatch[1] ?? '';
    dateTimePart = isoString.slice(0, -tzPart.length);
  }

  // Parse date/time part: "2024-11-20T07:30:00" or "2024-11-20T07:30:00.000"
  const dtRegex = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/;
  const dtMatch = dateTimePart.match(dtRegex);

  if (!dtMatch) {
    // Fallback to Date.parse
    const ms = Date.parse(isoString);
    if (isNaN(ms)) {
      throw new Error(`Invalid ISO 8601 datetime: ${isoString}`);
    }
    return ms;
  }

  const year = parseInt(dtMatch[1]!, 10);
  const month = parseInt(dtMatch[2]!, 10) - 1; // 0-indexed
  const day = parseInt(dtMatch[3]!, 10);
  const hour = parseInt(dtMatch[4]!, 10);
  const minute = parseInt(dtMatch[5]!, 10);
  const second = parseInt(dtMatch[6]!, 10);
  const ms = dtMatch[7] ? parseInt(dtMatch[7]!.padEnd(3, '0').slice(0, 3), 10) : 0;

  // Create date in UTC (treating the parsed time as local time)
  const utcMs = Date.UTC(year, month, day, hour, minute, second, ms);

  // Apply timezone offset if present
  if (tzPart && tzPart !== 'Z') {
    // Parse offset: +HH:MM, +HHMM, -HH:MM, -HHMM
    const sign = tzPart[0] === '-' ? 1 : -1; // '-' means local is behind UTC, so add to get UTC
    const tzClean = tzPart.slice(1).replace(':', '');
    const tzHour = parseInt(tzClean.slice(0, 2), 10);
    const tzMinute = parseInt(tzClean.slice(2, 4), 10);
    const offsetMs = sign * (tzHour * 3600 + tzMinute * 60) * 1000;
    return utcMs + offsetMs;
  }

  return utcMs;
}

/**
 * Parse weight samples from ghealth SIMPLIFIED JSON response
 * Fields: time (ISO 8601 with offset) OR date (YYYY-MM-DD), weightGrams (int64 in grams), unit
 * Filters out samples without valid timestamp
 */
export function parseWeightSamples(
  response: GHealthWeightListResponse
): ParsedBodyCompositionSample[] {
  const result: ParsedBodyCompositionSample[] = [];

  for (const sample of response.dataPoints ?? []) {
    // Accept time (ISO 8601 with offset) OR date (YYYY-MM-DD) per simplify.go
    const timestamp = sample.time ?? sample.date;
    if (!timestamp) {
      // Sample without valid timestamp - skip it
      continue;
    }

    let startTimeMillis: number;
    try {
      startTimeMillis = parseIsoToMillis(timestamp);
    } catch {
      // Invalid timestamp - skip it
      continue;
    }

    let weightKg: number | null = null;
    if (sample.weightGrams !== undefined && sample.weightGrams !== null) {
      // weightGrams is in grams, convert to kg
      weightKg = parseNumber(sample.weightGrams) ?? null;
      if (weightKg !== null) {
        weightKg = weightKg / 1000;
      }
    }

    // Extract local date from timestamp prefix (YYYY-MM-DD) for grouping
    // Avoids UTC midnight boundary issues for night-time weigh-ins
    const localDate = timestamp.slice(0, 10);

    result.push({
      startTimeMillis,
      endTimeMillis: startTimeMillis,
      weightKg,
      bodyFatPct: null,
      localDate,
    });
  }

  return result;
}

/**
 * Parse body fat samples from ghealth SIMPLIFIED JSON response
 * Fields: time (ISO 8601 with offset) OR date (YYYY-MM-DD), percentage (float 0-100), unit
 * simplify.go copies percentage directly as float64 (e.g., 20.2 for 20.2%)
 * Filters out samples without valid timestamp
 */
export function parseBodyFatSamples(
  response: GHealthBodyFatListResponse
): ParsedBodyCompositionSample[] {
  const result: ParsedBodyCompositionSample[] = [];

  for (const sample of response.dataPoints ?? []) {
    // Accept time (ISO 8601 with offset) OR date (YYYY-MM-DD) per simplify.go
    const timestamp = sample.time ?? sample.date;
    if (!timestamp) {
      // Sample without valid timestamp - skip it
      continue;
    }

    let startTimeMillis: number;
    try {
      startTimeMillis = parseIsoToMillis(timestamp);
    } catch {
      // Invalid timestamp - skip it
      continue;
    }

    let bodyFatPct: number | null = null;
    if (sample.percentage !== undefined && sample.percentage !== null) {
      // ghealth returns percentage as float 0-100 (e.g., 20.2 for 20.2%)
      // parseNumber handles string->number conversion from protobuf JSON
      // NO /100 division needed - already in correct scale
      bodyFatPct = parseNumber(sample.percentage);
    }

    // Extract local date from timestamp prefix (YYYY-MM-DD) for grouping
    const localDate = timestamp.slice(0, 10);

    result.push({
      startTimeMillis,
      endTimeMillis: startTimeMillis,
      weightKg: null,
      bodyFatPct,
      localDate,
    });
  }

  return result;
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
 * Cross-reference weight and body fat samples by local date
 * Prefers morning sample (earliest of day) for both weight and body fat
 * Uses localDate from timestamp prefix to avoid UTC midnight boundary issues
 * Falls back to deriving localDate from startTimeMillis if not present
 */
export function crossReferenceWeightAndBodyFat(
  samples: ParsedBodyCompositionSample[]
): PairedBodyComp[] {
  // Group samples by local date (from timestamp prefix or derived from startTimeMillis)
  const byDate = new Map<string, ParsedBodyCompositionSample[]>();

  for (const sample of samples) {
    // Use localDate if present, otherwise derive from startTimeMillis (UTC date)
    let date = sample.localDate;
    if (!date) {
      // Derive local date from UTC milliseconds (YYYY-MM-DD)
      const d = new Date(sample.startTimeMillis);
      date = d.toISOString().slice(0, 10);
    }
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