/**
 * ARGON v7.0 — Sleep Pillar (Extended)
 * Sleep staging, hypnogram parsing, naps, bedtime window, regularity, architecture score.
 * Pure functions, no side effects.
 */

import type {
  RawBiometricDay,
  HistoryDay,
  UserProfile,
  EngineConfig,
  ComputedDailyScore,
} from '@/engine/types';
import {
  mean,
  sd,
  clamp,
  computeSleepDebt,
  dynamicSleepNeed,
  bedtimeWindow,
  highSleepStress,
} from '@/engine/utils';

interface HypnogramSegment {
  stage: string;  // '1'=awake, '4'=light, '5'=deep, '6'=REM
  startMin: number;
  endMin: number;
  durationMin: number;
}

interface ParsedHypnogram {
  totalSleepMin: number;
  deepSleepMin: number;
  remSleepMin: number;
  lightSleepMin: number;
  awakeSleepMin: number;
  sleepOnsetLatencyMin: number;
  sleepEfficiencyPct: number;
  timeInBedMin: number;
  segments: HypnogramSegment[];
}

type HypnoSeg = [string, number, number];

/**
 * Parse hypnogram from ghealth format
 * ghealth hypno format: { t0: epochSec, seg: [[stage, startMin, endMin], ...] }
 */
export function parseHypnogram(
  hypno: RawBiometricDay['hr_zones_minutes']['hypno'],
  timeInBedMin: number
): ParsedHypnogram | null {
  if (!hypno || !hypno.seg || !hypno.seg.length) return null;

  const segments: HypnogramSegment[] = hypno.seg.map((seg: HypnoSeg) => {
    const [stage, start, end] = seg;
    return {
      stage,
      startMin: start,
      endMin: end,
      durationMin: end - start,
    };
  });

  const totalSleepMin = segments
    .filter(s => s.stage !== '1')
    .reduce((sum, s) => sum + s.durationMin, 0);

  const deepSleepMin = segments
    .filter(s => s.stage === '5')
    .reduce((sum, s) => sum + s.durationMin, 0);

  const remSleepMin = segments
    .filter(s => s.stage === '6')
    .reduce((sum, s) => sum + s.durationMin, 0);

  const lightSleepMin = segments
    .filter(s => s.stage === '4')
    .reduce((sum, s) => sum + s.durationMin, 0);

  const awakeSleepMin = segments
    .filter(s => s.stage === '1')
    .reduce((sum, s) => sum + s.durationMin, 0);

  // Sleep onset latency: first non-awake segment start
  const firstSleepSegment = segments.find(s => s.stage !== '1');
  const sleepOnsetLatencyMin = firstSleepSegment ? firstSleepSegment.startMin : 0;

  const tib = timeInBedMin || (segments.length > 0 ? segments[segments.length - 1].endMin : 0);
  const efficiency = tib > 0 ? Math.round((totalSleepMin / tib) * 100) : 0;

  return {
    totalSleepMin,
    deepSleepMin,
    remSleepMin,
    lightSleepMin,
    awakeSleepMin,
    sleepOnsetLatencyMin,
    sleepEfficiencyPct: clamp(efficiency, 0, 100),
    timeInBedMin: tib,
    segments,
  };
}

/**
 * Detect naps from hypnogram or naps array
 * Nap: 10-240 min, started 08:00-20:00
 */
export function detectNaps(
  todayRaw: RawBiometricDay,
  parsedHypno: ParsedHypnogram | null
): { napCount: number; napTotalMin: number; napSleepMin: number } {
  let napCount = 0;
  let napTotalMin = 0;

  // Priority 1: explicit naps array from ghealth
  if (todayRaw.hr_zones_minutes?.naps?.length) {
    for (const nap of todayRaw.hr_zones_minutes.naps) {
      const [h, m] = nap.t.split(':').map(Number);
      const startHour = h;
      const durMin = nap.min;
      if (durMin >= 10 && durMin <= 240 && startHour >= 8 && startHour <= 20) {
        napCount++;
        napTotalMin += durMin;
      }
    }
    return { napCount, napTotalMin, napSleepMin: napTotalMin };
  }

  // Priority 2: detect from hypnogram awake segments during day
  if (parsedHypno) {
    for (const seg of parsedHypno.segments) {
      if (seg.stage === '1') { // awake segment
        // Check if it's during nap window (08:00-20:00)
        // We'd need the actual time of day, which requires hypno.t0
        // For now, use the explicit naps data
      }
    }
  }

  // Fallback: use raw naps fields
  napCount = todayRaw.naps_count ?? 0;
  napTotalMin = todayRaw.naps_total_min ?? 0;

  return { napCount, napTotalMin, napSleepMin: napTotalMin };
}

/**
 * Compute sleep architecture score (0-100)
 * Weighted: duration 50%, regularity 25%, efficiency 15%, architecture 10%
 */
export function computeSleepArchitectureScore(
  hoursVsNeededPct: number | null,
  regularityPct: number | null,
  efficiencyPct: number | null,
  deepMin: number,
  remMin: number,
  tstMin: number,
  config: EngineConfig
): number | null {
  if (hoursVsNeededPct === null || regularityPct === null || efficiencyPct === null || tstMin <= 0) {
    return null;
  }

  const swsRemPct = tstMin > 0 ? ((deepMin + remMin) / tstMin) * 100 : 0;
  const effScore = (efficiencyPct / 88) * 100; // normalize to 88% baseline

  const archScore = Math.round(
    config.sleepArchWeights.duration * clamp(hoursVsNeededPct, 0, 100) +
    config.sleepArchWeights.regularity * clamp(regularityPct, 0, 100) +
    config.sleepArchWeights.efficiency * clamp(effScore, 0, 100) +
    config.sleepArchWeights.architecture * clamp((swsRemPct / 40) * 100, 0, 100)
  );

  return clamp(archScore, 0, 100);
}

/**
 * Compute sleep regularity from history
 * 94 - SD_TST_hours * 14 - nightAwakeH * 3.5, clamped 55-98
 */
export function computeSleepRegularity(
  history: HistoryDay[],
  todayRaw: RawBiometricDay,
  config: EngineConfig
): number | null {
  const validSleeps = history
    .filter(h => h.total_sleep_min && h.total_sleep_min >= config.minValidSleepMin)
    .slice(0, 14);

  if (validSleeps.length < 3) return null;

  const tstHours = validSleeps.map(h => (h.total_sleep_min! + (h.naps_total_min ?? 0)) / 60);
  const meanTst = mean(tstHours);
  const sdTst = sd(tstHours, meanTst);

  const nightAwakeH = todayRaw.awake_sleep_min ? todayRaw.awake_sleep_min / 60 : 0;

  return clamp(Math.round(94 - sdTst * 14 - nightAwakeH * 3.5), 55, 98);
}

/**
 * Main sleep pillar orchestrator (extends the one in recovery.ts with hypnogram parsing)
 */
export function computeSleepPillarExtended(
  todayRaw: RawBiometricDay,
  history: HistoryDay[],
  profile: UserProfile,
  config: EngineConfig,
  strainScore: number // from strain pillar
): Partial<ComputedDailyScore> {
  // Parse hypnogram if available
  const parsedHypno = parseHypnogram(
    todayRaw.hr_zones_minutes?.hypno ?? null,
    todayRaw.time_in_bed_min ?? 0
  );

  // Use hypnogram data if available, otherwise fall back to raw fields
  const tstMin = parsedHypno?.totalSleepMin ?? todayRaw.total_sleep_min ?? 0;
  const deepMin = parsedHypno?.deepSleepMin ?? todayRaw.deep_sleep_min ?? 0;
  const remMin = parsedHypno?.remSleepMin ?? todayRaw.rem_sleep_min ?? 0;
  const lightMin = parsedHypno?.lightSleepMin ?? todayRaw.light_sleep_min ?? 0;
  const awakeMin = parsedHypno?.awakeSleepMin ?? todayRaw.awake_sleep_min ?? 0;
  const tibMin = parsedHypno?.timeInBedMin ?? todayRaw.time_in_bed_min ?? 0;
  const efficiency = parsedHypno?.sleepEfficiencyPct ?? todayRaw.sleep_efficiency_pct ?? (tibMin > 0 ? Math.round((tstMin / tibMin) * 100) : 0);
  const sleepOnsetLatency = parsedHypno?.sleepOnsetLatencyMin ?? todayRaw.sleep_onset_latency_min ?? 0;

  const sleepMissing = tstMin < config.minValidSleepMin;

  // Valid sleep history for regularity/debt
  const validSleepHistory = history.filter(
    h => h.total_sleep_min && h.total_sleep_min >= config.minValidSleepMin
  ).slice(0, 14);

  // Sleep debt (7-day weighted exponential)
  const debtConfig = {
    basalNeedH: profile.basalSleepNeedH,
    decayFactor: 0.35,
    maxLookbackDays: 7,
  };
  const sleepDebtH = computeSleepDebt(
    validSleepHistory.slice(0, 7).map(h => ({
      total_sleep_min: h.total_sleep_min!,
      nap_sleep_min: h.naps_total_min ?? 0,
    })),
    debtConfig
  );

  // Dynamic sleep need (based on strain + debt)
  const dynamicNeedH = dynamicSleepNeed(profile.basalSleepNeedH, strainScore, sleepDebtH);

  // Hours vs needed %
  const totalSleepH = (tstMin + (todayRaw.naps_total_min ?? 0)) / 60;
  const hoursVsNeededPct = dynamicNeedH > 0 ? clamp(Math.round((totalSleepH / dynamicNeedH) * 100), 0, 100) : null;

  // Sleep regularity
  const sleepRegularityPct = computeSleepRegularity(history, todayRaw, config);

  // Sleep architecture score
  let sleepArchitectureScore: number | null = null;
  if (!sleepMissing) {
    sleepArchitectureScore = computeSleepArchitectureScore(
      hoursVsNeededPct,
      sleepRegularityPct,
      efficiency,
      deepMin,
      remMin,
      tstMin,
      config
    );
  }

  // Sleep recovery score
  const sleepRecoveryScore = sleepMissing ? 50 : (sleepArchitectureScore ?? 50);

  // High sleep stress (needs HRV/RHR z-scores from recovery pillar)
  // Placeholder - will be computed after recovery pillar
  const highSleepStressPct = 0;

  // Bedtime window
  let optimalBedtimeStart: string | null = null;
  let optimalBedtimeEnd: string | null = null;
  if (profile.habitualWake && efficiency > 0) {
    const window = bedtimeWindow(profile.habitualWake, dynamicNeedH, efficiency);
    optimalBedtimeStart = window.start;
    optimalBedtimeEnd = window.end;
  }

  // Nap detection
  const { napCount, napTotalMin, napSleepMin } = detectNaps(todayRaw, parsedHypno);

  return {
    sleep_missing: sleepMissing,
    time_in_bed_min: tibMin ?? null,
    total_sleep_min: tstMin ?? null,
    deep_sleep_min: deepMin ?? null,
    rem_sleep_min: remMin ?? null,
    light_sleep_min: lightMin ?? null,
    sleep_efficiency_pct: efficiency ?? null,
    sleep_onset_latency_min: sleepOnsetLatency ?? null,
    nap_sleep_min: napSleepMin ?? 0, // Default to 0 (not null) when no naps - matching Code.txt
    sleep_hours_vs_needed_pct: hoursVsNeededPct,
    sleep_regularity_pct: sleepRegularityPct,
    high_sleep_stress_pct: highSleepStressPct,
    sleep_architecture_score: sleepArchitectureScore,
    sleep_debt_h: sleepDebtH,
    dynamic_sleep_need_h: dynamicNeedH,
    optimal_bedtime_start: optimalBedtimeStart,
    optimal_bedtime_end: optimalBedtimeEnd,
    cumulative_sleep_debt_hours: sleepDebtH,
    naps_count: napCount,
    naps_total_min: napTotalMin,
    _sleepRecoveryScore: sleepRecoveryScore,
  } as Partial<ComputedDailyScore> & { _sleepRecoveryScore: number };
}