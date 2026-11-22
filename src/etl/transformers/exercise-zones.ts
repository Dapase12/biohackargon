/**
 * ARGON v7.0 — Exercise + HR Zones Transformer
 * Parses ghealth exercise sessions, minute HR, pause/resume events,
 * Karvonen %HRR zone classification.
 * Pure functions, no side effects.
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
 * Parse exercise sessions from ghealth response
 */
export function parseExerciseSessions(response: GHealthExerciseListResponse): ParsedExerciseSession[] {
  return (response.sessions ?? []).map((session: GHealthExerciseListResponse['sessions'][0]) => ({
    startTimeMillis: Number(session.startTimeMillis),
    endTimeMillis: Number(session.endTimeMillis),
    name: session.name ?? '',
    type: session.type ?? '',
    averageHeartRateBeatsPerMinute: session.averageHeartRateBeatsPerMinute
      ? Number(session.averageHeartRateBeatsPerMinute)
      : null,
    maxHeartRateBeatsPerMinute: session.maxHeartRateBeatsPerMinute
      ? Number(session.maxHeartRateBeatsPerMinute)
      : null,
    caloriesBurned: session.caloriesBurned ? Number(session.caloriesBurned) : null,
    durationMin: Math.round((Number(session.endTimeMillis) - Number(session.startTimeMillis)) / 60000),
  }));
}

/**
 * Parse HR samples from ghealth response
 */
export function parseHrSamples(response: GHealthHrListResponse): ParsedHrSample[] {
  return (response.samples ?? []).map((sample: GHealthHrListResponse['samples'][0]) => ({
    startTimeMillis: Number(sample.startTimeMillis),
    endTimeMillis: Number(sample.endTimeMillis),
    bpm: Number(sample.beatsPerMinute),
  }));
}

/**
 * Parse exercise events (pause/resume) from ghealth response
 */
export function parseExerciseEvents(response: GHealthExerciseEventsResponse): ParsedExerciseEvent[] {
  return (response.events ?? []).map((event: GHealthExerciseEventsResponse['events'][0]) => ({
    startTimeMillis: Number(event.startTimeMillis),
    endTimeMillis: Number(event.endTimeMillis),
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

  for (const sample of hrSamples) {
    const hr = sample.bpm;
    if (hr < z2Min) {
      // Below Z2 (including below Z1) counts as Z1
      zones.z1++;
    } else if (hr < z3Min) {
      zones.z2++;
    } else if (hr < z4Min) {
      zones.z3++;
    } else if (hr < z5Min) {
      zones.z4++;
    } else {
      // Z5 and above counts as Z5
      zones.z5++;
    }
  }

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
 * Build complete ExerciseTransformerOutput for a date
 */
export function buildExerciseTransformerOutput(
  logDate: string,
  session: ParsedExerciseSession,
  filteredHr: ParsedHrSample[],
  zones: HrZoneMinutes
): ExerciseTransformerOutput {
  const metrics = computeExerciseMetrics(session, filteredHr, zones);

  return {
    log_date: logDate,
    duration_min: metrics.duration_min ?? session.durationMin,
    kcal: metrics.kcal ?? 0,
    avg_hr: metrics.avg_hr ?? null,
    max_hr: metrics.max_hr ?? null,
    zones,
  };
}