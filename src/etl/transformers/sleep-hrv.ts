/**
 * ARGON v7.0 — Sleep + HRV Transformer
 * Parses ghealth sleep sessions, hypnogram, HRV nocturnal cross-reference.
 * Pure functions, no side effects.
 * Input: ghealth SIMPLIFIED JSON (--format json)
 */

import type {
  GHealthSleepListResponse,
  GHealthHrvListResponse,
  ParsedSleepSession,
  ParsedHrvSample,
  SleepTransformerOutput,
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
 * Correctly handles timezone offsets like "2024-11-20T00:00:00-04:00"
 * Uses manual parsing to ensure offset is applied correctly across all environments
 */
function parseIsoToMillis(isoString: string | undefined): number {
  if (!isoString) {
    throw new Error('ISO 8601 datetime string is required');
  }
  // Handle the common formats from ghealth simplified JSON:
  // "2024-11-20T00:00:00-04:00" or "2024-11-20T00:00:00Z" or "2024-11-20T00:00:00.000-04:00"

  // Split into date/time part and timezone part
  let dateTimePart = isoString;
  let tzPart: string = '';

  // Find timezone indicator (Z or +/-HH:MM or +/-HHMM at the end)
  const tzMatch = isoString.match(/(Z|[+-]\d{2}:?\d{2})$/);
  if (tzMatch) {
    tzPart = tzMatch[1] ?? '';
    dateTimePart = isoString.slice(0, -tzPart.length);
  }

  // Parse date/time part: "2024-11-20T00:00:00" or "2024-11-20T00:00:00.000"
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
 * Parse sleep sessions from ghealth SIMPLIFIED JSON response
 * Fields: start, end, sleepType, isNap, minutesAsleep, minutesAwake, totalMinutes,
 * minutesToFallAsleep, stageMinutes, stages (with --detail)
 */
export function parseSleepSessions(response: GHealthSleepListResponse): ParsedSleepSession[] {
  return (response.dataPoints ?? []).map((session) => {
    const startTimeMillis = parseIsoToMillis(session.start!);
    const endTimeMillis = parseIsoToMillis(session.end!);

    // Convert stages from simplified format (ISO strings) to internal format (millis)
    const stages = (session.stages ?? []).map((s) => ({
      start: parseIsoToMillis(s.start!),
      end: parseIsoToMillis(s.end!),
      type: s.type,
    }));

    return {
      startTimeMillis,
      endTimeMillis,
      isNap: session.isNap ?? false,
      sleepQuality: session.sleepType ?? 'UNKNOWN',
      stageMinutes: session.stageMinutes ?? {},
      stages,
      durationMin: Math.round((endTimeMillis - startTimeMillis) / 60000),
    };
  });
}

/**
 * Parse HRV samples from ghealth SIMPLIFIED JSON response
 * Fields: time, rmssd
 */
export function parseHrvSamples(response: GHealthHrvListResponse): ParsedHrvSample[] {
  return (response.dataPoints ?? []).map((sample) => ({
    startTimeMillis: parseIsoToMillis(sample.time!),
    endTimeMillis: parseIsoToMillis(sample.time!), // HRV samples are point-in-time
    rmssd: parseNumber(sample.rmssd),
  }));
}

/**
 * Cross-reference HRV samples with sleep sessions
 * Filters HRV to nocturnal sleep window only (excludes naps by default)
 */
export function crossReferenceHrvWithSleep(
  hrvSamples: ParsedHrvSample[],
  sleepSessions: ParsedSleepSession[],
  options: { includeNaps: boolean } = { includeNaps: false }
): ParsedHrvSample[] {
  if (sleepSessions.length === 0) return [];

  const nocturnalSessions = sleepSessions.filter(s => !s.isNap);
  const napSessions = sleepSessions.filter(s => s.isNap);

  const relevantSessions = options.includeNaps
    ? [...nocturnalSessions, ...napSessions]
    : nocturnalSessions;

  if (relevantSessions.length === 0) return [];

  return hrvSamples.filter(hrv => {
    return relevantSessions.some(session =>
      hrv.startTimeMillis >= session.startTimeMillis &&
      hrv.startTimeMillis < session.endTimeMillis
    );
  });
}

/**
 * Compute sleep metrics from parsed sessions
 */
export function computeSleepMetrics(
  sleepSessions: ParsedSleepSession[]
): Partial<SleepTransformerOutput> {
  const nocturnal = sleepSessions.filter(s => !s.isNap);
  const naps = sleepSessions.filter(s => s.isNap);

  // Total sleep time from stage minutes (excludes awake)
  // stageMinutes values from ghealth are strings in protobuf JSON, use parseNumber
  const totalSleepMin = nocturnal.reduce((sum, s) => {
    const stages = s.stageMinutes ?? {};
    return sum + (parseNumber(stages.DEEP) ?? 0) + (parseNumber(stages.LIGHT) ?? 0) + (parseNumber(stages.REM) ?? 0);
  }, 0);

  const deepSleepMin = nocturnal.reduce((sum, s) => sum + (parseNumber(s.stageMinutes?.DEEP) ?? 0), 0);
  const remSleepMin = nocturnal.reduce((sum, s) => sum + (parseNumber(s.stageMinutes?.REM) ?? 0), 0);
  const lightSleepMin = nocturnal.reduce((sum, s) => sum + (parseNumber(s.stageMinutes?.LIGHT) ?? 0), 0);
  const awakeSleepMin = nocturnal.reduce((sum, s) => sum + (parseNumber(s.stageMinutes?.AWAKE) ?? 0), 0);

  // Time in bed from timestamps
  const timeInBedMin = nocturnal.reduce((sum, s) => sum + s.durationMin, 0);

  // Sleep efficiency
  const sleepEfficiencyPct = timeInBedMin > 0
    ? Math.round((totalSleepMin / timeInBedMin) * 100)
    : null;

  // Sleep onset latency: first non-awake stage start
  let sleepOnsetLatencyMin = 0;
  for (const session of nocturnal) {
    const firstSleepStage = session.stages.find((seg: { type: string }) => seg.type !== 'AWAKE' && seg.type !== '1');
    if (firstSleepStage) {
      sleepOnsetLatencyMin = Math.round((firstSleepStage.start - session.startTimeMillis) / 60000);
      break;
    }
  }

  // Nap metrics
  const napCount = naps.length;
  const napTotalMin = naps.reduce((sum, s) => sum + s.durationMin, 0);
  const napSleepMin = naps.reduce((sum, s) => {
    const stages = s.stageMinutes ?? {};
    return sum + (stages.LIGHT ?? 0) + (stages.REM ?? 0) + (stages.DEEP ?? 0);
  }, 0);

  return {
    total_sleep_min: totalSleepMin || null,
    deep_sleep_min: deepSleepMin || null,
    rem_sleep_min: remSleepMin || null,
    light_sleep_min: lightSleepMin || null,
    awake_sleep_min: awakeSleepMin || null,
    sleep_efficiency_pct: sleepEfficiencyPct,
    time_in_bed_min: timeInBedMin || null,
    sleep_onset_latency_min: sleepOnsetLatencyMin !== undefined && sleepOnsetLatencyMin !== null ? sleepOnsetLatencyMin : null,
    nap_sleep_min: napSleepMin || null,
    naps_count: napCount,
    naps_total_min: napTotalMin,
    // These require additional computation (history, profile) - set in orchestrator
    sleep_hours_vs_needed_pct: null,
    sleep_regularity_pct: null,
    high_sleep_stress_pct: null,
    sleep_architecture_score: null,
    sleep_debt_h: null,
    dynamic_sleep_need_h: null,
    optimal_bedtime_start: null,
    optimal_bedtime_end: null,
    cumulative_sleep_debt_hours: null,
    hrv_nocturnal_median: null,
    hrv_deep_sleep_median: null,
    hrv_nocturnal_count: 0,
    hrv_mode: 'night',
  };
}

/**
 * Detect naps from sleep sessions
 * Nap: 10-240 min, started 08:00-20:00 (local time)
 */
export function detectNaps(sleepSessions: ParsedSleepSession[]): ParsedSleepSession[] {
  return sleepSessions.filter(session => {
    if (!session.isNap) return false;
    const duration = session.durationMin;
    // Check start hour in local time (need timezone)
    // For now, rely on isNap flag from ghealth
    return duration >= 10 && duration <= 240;
  });
}

/**
 * Compute HRV median from samples
 * Handles single sample case (returns that value)
 */
export function computeHrvMedian(samples: ParsedHrvSample[]): number | null {
  const values = samples
    .filter(s => s.rmssd !== null)
    .map(s => s.rmssd!);
  if (values.length === 0) return null;
  if (values.length === 1) return values[0]; // Single sample = that value is the median
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const lower = sorted[mid - 1];
  const upper = sorted[mid];
  if (lower === undefined || upper === undefined) return null;
  return sorted.length % 2 === 0
    ? (lower + upper) / 2
    : upper;
}

/**
 * Determine HRV mode based on available samples
 */
export function determineHrvMode(
  nocturnalSamples: ParsedHrvSample[],
  deepSleepSamples: ParsedHrvSample[]
): 'night' | 'nap' | 'deep' | 'fallback' {
  const deepCount = deepSleepSamples.filter(s => s.rmssd !== null).length;
  if (deepCount >= 5) return 'deep';
  const nocturnalCount = nocturnalSamples.filter(s => s.rmssd !== null).length;
  if (nocturnalCount > 0) return 'night';
  return 'fallback';
}

/**
 * Build complete SleepTransformerOutput for a date
 */
export function buildSleepTransformerOutput(
  logDate: string,
  sleepSessions: ParsedSleepSession[],
  hrvSamples: ParsedHrvSample[],
  options: { includeNaps: boolean } = { includeNaps: false }
): SleepTransformerOutput {
  const metrics = computeSleepMetrics(sleepSessions);
  const nocturnalHrv = crossReferenceHrvWithSleep(hrvSamples, sleepSessions, { includeNaps: false });
  const allHrv = crossReferenceHrvWithSleep(hrvSamples, sleepSessions, { includeNaps: true });

  // Deep sleep HRV samples (filter against hypnogram stages)
  const nocturnalSessions = sleepSessions.filter(s => !s.isNap);
  const deepSleepHrv = nocturnalHrv.filter(hrv => {
    // Check if HRV sample falls in any deep sleep stage
    return nocturnalSessions.some(session =>
      (session.stages ?? []).some(stage =>
        stage.type === 'DEEP' &&
        hrv.startTimeMillis >= stage.start &&
        hrv.startTimeMillis < stage.end
      )
    );
  });

  const hrvNocturnalMedian = computeHrvMedian(nocturnalHrv);
  const hrvDeepSleepMedian = computeHrvMedian(deepSleepHrv);
  const hrvNocturnalCount = nocturnalHrv.filter(s => s.rmssd !== null).length;
  const hrvMode = determineHrvMode(nocturnalHrv, deepSleepHrv);

  return {
    log_date: logDate,
    ...metrics,
    hrv_nocturnal_median: hrvNocturnalMedian,
    hrv_deep_sleep_median: hrvDeepSleepMedian,
    hrv_nocturnal_count: hrvNocturnalCount,
    hrv_mode: hrvMode,
  } as SleepTransformerOutput;
}