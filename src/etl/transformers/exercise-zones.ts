/**
 * ARGON v7.0 — Exercise + HR Zones Transformer
 * Parses ghealth exercise sessions, minute HR, pause/resume events,
 * Karvonen %HRR zone classification.
 * Pure functions, no side effects.
 * Input: ghealth SIMPLIFIED JSON (--format json)
 */

import type {
  GHealthExerciseListResponse,
  GHealthHrListResponse,
  GHealthExerciseEventsResponse,
  ParsedExerciseSession,
  ParsedHrSample,
  ParsedExerciseEvent,
  UserEtlProfile,
  HrZoneMinutes,
  ExerciseTransformerOutput,
} from '@/etl/types';

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
 * Correctly handles timezone offsets like "2024-11-20T10:00:00-04:00"
 * Uses manual parsing to ensure offset is applied correctly across all environments
 */
function parseIsoToMillis(isoString: string | undefined): number {
  if (!isoString) {
    throw new Error('ISO 8601 datetime string is required');
  }
  // Parse ISO 8601 with offset: "2024-11-20T00:00:00-04:00" or "2024-11-20T00:00:00.000-04:00"
  // or "2024-11-20T00:00:00Z"
  // More flexible regex that handles various formats
  const regex = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/;
  const match = isoString.match(regex);

  if (!match) {
    // Fallback to Date.parse for unexpected formats
    const ms = Date.parse(isoString);
    if (isNaN(ms)) {
      throw new Error(`Invalid ISO 8601 datetime: ${isoString}`);
    }
    return ms;
  }

  const year = parseInt(match[1]!, 10);
  const month = parseInt(match[2]!, 10) - 1; // 0-indexed
  const day = parseInt(match[3]!, 10);
  const hour = parseInt(match[4]!, 10);
  const minute = parseInt(match[5]!, 10);
  const second = parseInt(match[6]!, 10);
  const ms = match[7] ? parseInt(match[7]!.padEnd(3, '0').slice(0, 3), 10) : 0;
  const tz = match[8]; // 'Z', '+04:00', '-04:00', '+0400', '-0400', or undefined

  // Create date in UTC (treating the parsed time as local time)
  const utcMs = Date.UTC(year, month, day, hour, minute, second, ms);

  // Apply timezone offset if present
  if (tz && tz !== 'Z') {
    // Parse offset: +HH:MM, +HHMM, -HH:MM, -HHMM
    const sign = tz[0] === '-' ? 1 : -1; // '-' means local is behind UTC, so add to get UTC
    const tzClean = tz.slice(1).replace(':', '');
    const tzHour = parseInt(tzClean.slice(0, 2), 10);
    const tzMinute = parseInt(tzClean.slice(2, 4), 10);
    const offsetMs = sign * (tzHour * 3600 + tzMinute * 60) * 1000;
    return utcMs + offsetMs;
  }

  return utcMs;
}

/**
 * Parse exercise sessions from ghealth SIMPLIFIED JSON response
 * Fields: start, end, type, name, caloriesKcal, averageHeartRateBeatsPerMinute, maxHeartRateBeatsPerMinute
 */
export function parseExerciseSessions(response: GHealthExerciseListResponse): ParsedExerciseSession[] {
  return (response.dataPoints ?? []).map((session) => {
    const startTimeMillis = parseIsoToMillis(session.start!);
    const endTimeMillis = parseIsoToMillis(session.end!);

    return {
      startTimeMillis,
      endTimeMillis,
      name: session.name ?? '',
      type: session.type ?? '',
      averageHeartRateBeatsPerMinute: parseNumber(session.averageHeartRateBeatsPerMinute),
      maxHeartRateBeatsPerMinute: parseNumber(session.maxHeartRateBeatsPerMinute),
      caloriesBurned: parseNumber(session.caloriesKcal),
      durationMin: Math.round((endTimeMillis - startTimeMillis) / 60000),
    };
  });
}

/**
 * Parse HR samples from ghealth SIMPLIFIED JSON response
 * Fields: time, beatsPerMinute
 */
export function parseHrSamples(response: GHealthHrListResponse): ParsedHrSample[] {
  return (response.dataPoints ?? []).map((sample) => ({
    startTimeMillis: parseIsoToMillis(sample.time!),
    endTimeMillis: parseIsoToMillis(sample.time!), // HR samples are point-in-time
    bpm: parseNumber(sample.beatsPerMinute) ?? 0,
  }));
}

/**
 * Parse exercise events (pause/resume) from ghealth SIMPLIFIED JSON response
 * Fields: start, end, type (PAUSE/RESUME)
 */
export function parseExerciseEvents(response: GHealthExerciseEventsResponse): ParsedExerciseEvent[] {
  return (response.rollupDataPoints ?? []).map((event) => ({
    startTimeMillis: parseIsoToMillis(event.start!),
    endTimeMillis: parseIsoToMillis(event.end!),
    type: event.type,
  }));
}

/**
 * Filter HR samples to exercise session window, excluding pause intervals
 */
export function filterHrDuringExercise(
  hrSamples: ParsedHrSample[],
  session: ParsedExerciseSession,
  events: ParsedExerciseEvent[]
): ParsedHrSample[] {
  const sessionStart = session.startTimeMillis;
  const sessionEnd = session.endTimeMillis;

  // Build pause intervals from PAUSE/RESUME events
  const pauseIntervals: Array<{ start: number; end: number }> = [];
  let pauseStart: number | null = null;

  for (const event of events) {
    if (event.type === 'PAUSE') {
      pauseStart = event.startTimeMillis;
    } else if (event.type === 'RESUME' && pauseStart !== null) {
      pauseIntervals.push({ start: pauseStart, end: event.endTimeMillis });
      pauseStart = null;
    }
  }

  // Filter HR samples within session window and not in pause intervals
  return hrSamples.filter(hr => {
    if (hr.startTimeMillis < sessionStart || hr.startTimeMillis >= sessionEnd) {
      return false;
    }
    // Check if in any pause interval
    for (const pause of pauseIntervals) {
      if (hr.startTimeMillis >= pause.start && hr.startTimeMillis < pause.end) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Classify HR into Z1-Z5 using Karvonen %HRR formula
 * HRR = maxHR - restingHR
 * Z1: 50-60% HRR
 * Z2: 60-70% HRR
 * Z3: 70-80% HRR
 * Z4: 80-90% HRR
 * Z5: 90-100% HRR
 *
 * Calculates REAL minutes by using time delta between consecutive HR samples
 * (not just counting samples). ghealth returns samples every ~5 seconds.
 */
export function classifyHrZonesKarvonen(
  hrSamples: ParsedHrSample[],
  profile: UserEtlProfile
): HrZoneMinutes {
  const hrr = profile.maxHR - profile.restingHR;

  const z1Min = profile.restingHR + 0.50 * hrr;
  const z2Min = profile.restingHR + 0.60 * hrr;
  const z3Min = profile.restingHR + 0.70 * hrr;
  const z4Min = profile.restingHR + 0.80 * hrr;
  const z5Min = profile.restingHR + 0.90 * hrr;

  const zones: HrZoneMinutes = {
    z1: 0,
    z2: 0,
    z3: 0,
    z4: 0,
    z5: 0,
    real: hrSamples.length > 0,
    workouts: [],
  };

  // Sort samples by time to calculate durations between consecutive samples
  const sortedSamples = [...hrSamples].sort((a, b) => a.startTimeMillis - b.startTimeMillis);

  for (let i = 0; i < sortedSamples.length; i++) {
    const sample = sortedSamples[i];
    const hr = sample.bpm;

    // Calculate duration to next sample (or session end for last sample)
    let durationMs: number;
    if (i < sortedSamples.length - 1) {
      durationMs = sortedSamples[i + 1].startTimeMillis - sample.startTimeMillis;
    } else {
      // Last sample: assume same interval as previous, or 5 seconds default
      durationMs = i > 0
        ? sample.startTimeMillis - sortedSamples[i - 1].startTimeMillis
        : 5000; // 5 seconds default
    }

    // Cap at reasonable max (e.g., 60 seconds) to handle gaps
    const durationMin = Math.min(durationMs / 60000, 1);

    let zone: keyof Pick<HrZoneMinutes, 'z1' | 'z2' | 'z3' | 'z4' | 'z5'>;
    if (hr < z2Min) {
      zone = 'z1';
    } else if (hr < z3Min) {
      zone = 'z2';
    } else if (hr < z4Min) {
      zone = 'z3';
    } else if (hr < z5Min) {
      zone = 'z4';
    } else {
      zone = 'z5';
    }

    zones[zone] += durationMin;
  }

  // Round to 1 decimal place for minutes
  (['z1', 'z2', 'z3', 'z4', 'z5'] as const).forEach(z => {
    zones[z] = Math.round(zones[z] * 10) / 10;
  });

  return zones;
}

/**
 * Compute exercise metrics from session, HR samples, and zones
 */
export function computeExerciseMetrics(
  session: ParsedExerciseSession,
  filteredHr: ParsedHrSample[],
  zones: HrZoneMinutes
): Partial<ExerciseTransformerOutput> {
  // Average HR from filtered samples
  const avgHr = filteredHr.length > 0
    ? Math.round(filteredHr.reduce((sum, s) => sum + s.bpm, 0) / filteredHr.length)
    : session.averageHeartRateBeatsPerMinute;

  // Max HR from filtered samples or session
  const maxHr = filteredHr.length > 0
    ? Math.max(...filteredHr.map(s => s.bpm))
    : session.maxHeartRateBeatsPerMinute;

  // Kcal from ghealth or estimate from HR
  let kcal = session.caloriesBurned ?? 0;
  if (kcal === 0 && filteredHr.length > 0 && avgHr) {
    // Rough estimation: kcal/min = (MET * weight_kg * 3.5) / 200
    // Using HR-based approximation
    kcal = Math.round((avgHr - 60) * session.durationMin * 0.1);
  }

  return {
    duration_min: session.durationMin,
    kcal,
    avg_hr: avgHr,
    max_hr: maxHr,
  };
}

/**
 * Build per-workout zone breakdown for a session
 */
function buildWorkoutZones(
  filteredHr: ParsedHrSample[],
  profile: UserEtlProfile
): { z1: number; z2: number; z3: number; z4: number; z5: number } {
  const hrr = profile.maxHR - profile.restingHR;
  const z1Min = profile.restingHR + 0.50 * hrr;
  const z2Min = profile.restingHR + 0.60 * hrr;
  const z3Min = profile.restingHR + 0.70 * hrr;
  const z4Min = profile.restingHR + 0.80 * hrr;
  const z5Min = profile.restingHR + 0.90 * hrr;

  const workoutZones = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  const sortedSamples = [...filteredHr].sort((a, b) => a.startTimeMillis - b.startTimeMillis);

  for (let i = 0; i < sortedSamples.length; i++) {
    const sample = sortedSamples[i];
    const hr = sample.bpm;
    let durationMs: number;
    if (i < sortedSamples.length - 1) {
      durationMs = sortedSamples[i + 1].startTimeMillis - sample.startTimeMillis;
    } else {
      durationMs = i > 0
        ? sample.startTimeMillis - sortedSamples[i - 1].startTimeMillis
        : 5000;
    }
    const durationMin = Math.min(durationMs / 60000, 1);

    let zone: keyof typeof workoutZones;
    if (hr < z2Min) zone = 'z1';
    else if (hr < z3Min) zone = 'z2';
    else if (hr < z4Min) zone = 'z3';
    else if (hr < z5Min) zone = 'z4';
    else zone = 'z5';

    workoutZones[zone] += durationMin;
  }
  (['z1', 'z2', 'z3', 'z4', 'z5'] as const).forEach(z => {
    workoutZones[z] = Math.round(workoutZones[z] * 10) / 10;
  });

  return workoutZones;
}

/**
 * Build complete ExerciseTransformerOutput for a date
 */
export function buildExerciseTransformerOutput(
  logDate: string,
  session: ParsedExerciseSession,
  filteredHr: ParsedHrSample[],
  zones: HrZoneMinutes,
  profile: UserEtlProfile
): ExerciseTransformerOutput {
  const metrics = computeExerciseMetrics(session, filteredHr, zones);

  // Build per-workout zone breakdown for this session
  const workoutZones = buildWorkoutZones(filteredHr, profile);

  const zonesWithWorkout: HrZoneMinutes = {
    ...zones,
    workouts: [{
      startTimeMillis: session.startTimeMillis,
      endTimeMillis: session.endTimeMillis,
      name: session.name,
      type: session.type,
      zones: workoutZones,
    }],
  };

  return {
    log_date: logDate,
    duration_min: metrics.duration_min ?? session.durationMin,
    kcal: metrics.kcal ?? 0,
    avg_hr: metrics.avg_hr ?? null,
    max_hr: metrics.max_hr ?? null,
    zones: zonesWithWorkout,
  };
}