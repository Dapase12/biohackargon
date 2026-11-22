/**
 * ARGON v7.0 — Sleep + HRV Transformer
 * Parses ghealth sleep sessions, hypnogram, HRV nocturnal cross-reference.
 * Pure functions, no side effects.
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
function parseNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse sleep sessions from ghealth response
 */
export function parseSleepSessions(response: GHealthSleepListResponse): ParsedSleepSession[] {
  return (response.dataPoints ?? []).map((session: GHealthSleepListResponse['dataPoints'][0]) => ({
    startTimeMillis: parseNumber(session.startTimeMillis) ?? 0,
    endTimeMillis: parseNumber(session.endTimeMillis) ?? 0,
    isNap: session.isNap ?? false,
    sleepQuality: session.sleepQuality ?? 'UNKNOWN',
    stageMinutes: Object.fromEntries(
      Object.entries(session.stageMinutes ?? {}).map(([k, v]: [string, unknown]) => [k, parseNumber(String(v)) ?? 0])
    ),
    stages: (session.stages ?? []).map((s: { start: number; end: number; type: string }) => ({
      start: Number(s.start),
      end: Number(s.end),
      type: s.type,
    })),
    durationMin: Math.round((Number(session.endTimeMillis) - Number(session.startTimeMillis)) / 60000),
  }));
}

/**
 * Parse HRV samples from ghealth response
 */
export function parseHrvSamples(response: GHealthHrvListResponse): ParsedHrvSample[] {
  return (response.dataPoints ?? []).map((sample: GHealthHrvListResponse['dataPoints'][0]) => ({
    startTimeMillis: parseNumber(sample.startTimeMillis) ?? 0,
    endTimeMillis: parseNumber(sample.endTimeMillis) ?? 0,
    rmssd: parseNumber(sample.rootMeanSquareOfSuccessiveDifferencesMilliseconds),
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
  const totalSleepMin = nocturnal.reduce((sum, s) => {
    const stages = s.stageMinutes ?? {};
    return sum + (stages.DEEP ?? 0) + (stages.LIGHT ?? 0) + (stages.REM ?? 0);
  }, 0);

  const deepSleepMin = nocturnal.reduce((sum, s) => sum + (s.stageMinutes?.DEEP ?? 0), 0);
  const remSleepMin = nocturnal.reduce((sum, s) => sum + (s.stageMinutes?.REM ?? 0), 0);
  const lightSleepMin = nocturnal.reduce((sum, s) => sum + (s.stageMinutes?.LIGHT ?? 0), 0);
  const awakeSleepMin = nocturnal.reduce((sum, s) => sum + (s.stageMinutes?.AWAKE ?? 0), 0);

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
      sleepOnsetLatencyMin = firstSleepStage.start;
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
 */
export function computeHrvMedian(samples: ParsedHrvSample[]): number | null {
  const values = samples
    .filter(s => s.rmssd !== null)
    .map(s => s.rmssd!);
  if (values.length === 0) return null;
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
): 'night' | 'deep' | 'fallback' {
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

  // Deep sleep HRV samples (need hypnogram stages)
  const deepSleepHrv = nocturnalHrv.filter(hrv => {
    // Check if HRV sample falls in deep sleep stage
    // This is a simplification - real implementation needs stage mapping
    return true; // Will be refined
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