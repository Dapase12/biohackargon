/**
 * ARGON v7.0 — Recovery Pillar
 * 3-pillar recovery: HRV (40%), RHR (20%), Sleep (40%)
 * Pure functions, no side effects.
 */

import type {
  RawBiometricDay,
  HistoryDay,
  PrevComputed,
  UserProfile,
  EngineConfig,
  ComputedDailyScore,
} from '@/engine/types';
import {
  mean,
  sd,
  zScore,
  clamp,
  ewma,
  computeSleepDebt,
  dynamicSleepNeed,
  bedtimeWindow,
  highSleepStress,
  recoveryFromPillars,
} from '@/engine/utils';

interface PillarResult<T extends Partial<ComputedDailyScore>> {
  data: T;
  recoveryScore: number | null;
}

/**
 * Compute HRV pillar metrics
 */
export function computeHRVPillar(
  todayRaw: RawBiometricDay,
  history: HistoryDay[],
  config: EngineConfig,
  prevComputed: PrevComputed | null
): PillarResult<Partial<ComputedDailyScore>> {
  const todayRmssd = todayRaw.rmssd_ms ?? todayRaw.hrv_rmssd_ms;

  // Need at least 7 valid HRV days for calibration
  const validHrvHistory = history.filter(h => h.rmssd_ms && h.rmssd_ms > 0);
  const isCalibrating = validHrvHistory.length < config.minBaselineDays;

  if (!todayRmssd || todayRmssd <= 0) {
    return {
      data: {
        hrv_missing: true,
        calibrating: isCalibrating,
        ln_rmssd: null,
        ln_rmssd_14d_mean: null,
        ln_rmssd_14d_sd: null,
        hrv_z_score: null,
        hrv_swc: null,
        hrv_baseline_rmssd: null,
        hrv_7d_avg_rmssd: null,
        hrv_14d_avg_rmssd: null,
        dynamic_rmssd_cap_ms: null,
        cv_lnrmssd_7d_pct: null,
      },
      recoveryScore: null,
    };
  }

  const todayLn = Math.log(todayRmssd);

  // 14-day lnRMSSD baseline
  const hist14 = validHrvHistory.slice(0, 14).map(h => Math.log(h.rmssd_ms!));
  const ln14Mean = mean(hist14);
  const ln14Sd = sd(hist14);

  // 7-day lnRMSSD
  const hist7 = validHrvHistory.slice(0, 7).map(h => Math.log(h.rmssd_ms!));
  const ln7Mean = mean(hist7);

  // 7-day RMSSD average (raw)
  const rms7dAvg = mean(validHrvHistory.slice(0, 7).map(h => h.rmssd_ms!));

  // 14-day RMSSD average (raw)
  const rms14dAvg = mean(validHrvHistory.slice(0, 14).map(h => h.rmssd_ms!));

  // SWC = 0.5 * SD_ln
  const swc = 0.5 * ln14Sd;

  // HRV z-score with dead zone (SWC)
  let hrvZ = 0;
  if (ln14Sd > 0) {
    const diff = ln7Mean - ln14Mean;
    const excess = Math.max(0, Math.abs(diff) - swc);
    hrvZ = clamp(Math.sign(diff) * excess / ln14Sd, -3, 3);
  }

  // CV lnRMSSD 7d (%)
  const cvLn7d = ln7Mean > 0 ? (sd(hist7) / ln7Mean) * 100 : null;

  // Dynamic RMSSD cap (mean + 3*SD in raw space, approximated)
  const dynamicCap = rms14dAvg + 3 * sd(validHrvHistory.slice(0, 14).map(h => h.rmssd_ms!));

  // HRV recovery score: 50 + z * 16.67, clamped 0-100
  const hrvRecoveryScore = clamp(50 + hrvZ * 16.67, 0, 100);

  return {
    data: {
      hrv_missing: false,
      calibrating: isCalibrating,
      ln_rmssd: todayLn,
      ln_rmssd_14d_mean: ln14Mean,
      ln_rmssd_14d_sd: ln14Sd,
      hrv_z_score: hrvZ,
      hrv_swc: swc,
      hrv_baseline_rmssd: rms14dAvg,
      hrv_7d_avg_rmssd: rms7dAvg,
      hrv_14d_avg_rmssd: rms14dAvg,
      dynamic_rmssd_cap_ms: dynamicCap,
      cv_lnrmssd_7d_pct: cvLn7d,
    },
    recoveryScore: hrvRecoveryScore,
  };
}

/**
 * Compute RHR pillar metrics
 * Matches Code.txt: meanRhr computed from 14-day history regardless of today's RHR availability
 */
export function computeRHRPillar(
  todayRaw: RawBiometricDay,
  history: HistoryDay[],
  config: EngineConfig
): PillarResult<Partial<ComputedDailyScore>> {
  const todayRhr = todayRaw.rhr_bpm;

  const validRhrHistory = history.filter(h => h.rhr_bpm && h.rhr_bpm > 0);

  // Compute 14-day mean from history (Code.txt behavior: meanRhr from histRhr)
  const rhr14 = validRhrHistory.slice(0, 14).map(h => h.rhr_bpm!);
  const rhr14Mean = rhr14.length > 0 ? mean(rhr14) : null;
  const rhr14Sd = rhr14.length > 1 ? sd(rhr14) : 0;

  const rhr7 = validRhrHistory.slice(0, 7).map(h => h.rhr_bpm!);
  const rhr7Mean = rhr7.length > 0 ? mean(rhr7) : null;

  let rhrZ = 0;
  let rhrRecoveryScore: number | null = null;
  let todayRhrOut: number | null = null;

  if (todayRhr && todayRhr > 0) {
    todayRhrOut = todayRhr;
    if (rhr14Sd > 0 && rhr14Mean !== null) {
      // Lower RHR is better, so invert: (today - mean) / sd
      rhrZ = clamp((todayRhr - rhr14Mean) / rhr14Sd, -3, 3);
    }
    // RHR recovery score: 50 - z * 16.67 (inverted because lower RHR = better)
    rhrRecoveryScore = clamp(50 - rhrZ * 16.67, 0, 100);
  }

  return {
    data: {
      rhr_bpm: todayRhrOut,
      rhr_14d_mean_bpm: rhr14Mean,
      rhr_z_score: rhrZ,
      rhr_baseline: rhr14Mean,
      rhr_7d_avg: rhr7Mean,
    },
    recoveryScore: rhrRecoveryScore,
  };
}

/**
 * Compute Sleep pillar metrics
 */
export function computeSleepPillar(
  todayRaw: RawBiometricDay,
  history: HistoryDay[],
  config: EngineConfig,
  profile: UserProfile
): PillarResult<Partial<ComputedDailyScore>> {
  const tstMin = todayRaw.total_sleep_min ?? 0;
  const napMin = todayRaw.naps_total_min ?? 0;
  const deepMin = todayRaw.deep_sleep_min ?? 0;
  const remMin = todayRaw.rem_sleep_min ?? 0;
  const lightMin = todayRaw.light_sleep_min ?? 0;
  const awakeMin = todayRaw.awake_sleep_min ?? 0;
  const tibMin = todayRaw.time_in_bed_min ?? 0;
  const efficiency = todayRaw.sleep_efficiency_pct ?? (tibMin > 0 ? Math.round((tstMin / tibMin) * 100) : 0);

  const sleepMissing = tstMin < config.minValidSleepMin;

  // Valid sleep history for regularity/debt (last 14 days)
  const validSleepHistory = history.filter(
    h => h.total_sleep_min && h.total_sleep_min >= config.minValidSleepMin
  ).slice(0, 14);

  // Sleep debt (weighted exponential decay, 7 days)
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

  // Dynamic sleep need
  const strainScore = todayRaw.hr_zones_minutes && todayRaw.hr_zones_minutes.real
    ? 10 // placeholder - will be computed by strain pillar
    : 8;
  const dynamicNeedH = dynamicSleepNeed(profile.basalSleepNeedH, strainScore, sleepDebtH);

  // Hours vs needed %
  const totalSleepH = (tstMin + napMin) / 60;
  const hoursVsNeededPct = dynamicNeedH > 0 ? clamp(Math.round((totalSleepH / dynamicNeedH) * 100), 0, 100) : null;

  // Sleep regularity
  let sleepRegularityPct: number | null = null;
  if (validSleepHistory.length >= 3) {
    const tstHours = validSleepHistory.map(h => (h.total_sleep_min! + (h.naps_total_min ?? 0)) / 60);
    const meanTst = mean(tstHours);
    const sdTst = sd(tstHours, meanTst);
    const nightAwakeH = todayRaw.awake_sleep_min ? todayRaw.awake_sleep_min / 60 : 0;
    sleepRegularityPct = clamp(Math.round(94 - sdTst * 14 - nightAwakeH * 3.5), 55, 98);
  }

  // Sleep architecture score
  let sleepArchitectureScore: number | null = null;
  if (!sleepMissing && tstMin > 0) {
    const swsRemPct = ((deepMin + remMin) / tstMin) * 100;
    const effScore = efficiency > 0 ? (efficiency / 88) * 100 : 0;
    const archScore = Math.round(
      config.sleepArchWeights.duration * (hoursVsNeededPct ?? 0) +
      config.sleepArchWeights.regularity * (sleepRegularityPct ?? 0) +
      config.sleepArchWeights.efficiency * effScore +
      config.sleepArchWeights.architecture * (swsRemPct / 40 * 100)
    );
    sleepArchitectureScore = clamp(archScore, 0, 100);
  }

  // Sleep recovery score
  const sleepRecoveryScore = sleepMissing ? 50 : (sleepArchitectureScore ?? 50);

  // High sleep stress
  const hrvZ = 0; // placeholder - will be computed by HRV pillar
  const rhrZ = 0; // placeholder - will be computed by RHR pillar
  const highSleepStressPct = highSleepStress(rhrZ, hrvZ);

  // Bedtime window - Code.txt: Calculate even when sleep_missing = true
  // Use actual efficiency if available, else assume 85% (Code.txt default for missing sleep)
  const effectiveEfficiency = efficiency > 0 ? efficiency : 85;
  let optimalBedtimeStart: string | null = null;
  let optimalBedtimeEnd: string | null = null;
  if (profile.habitualWake) {
    const window = bedtimeWindow(profile.habitualWake, dynamicNeedH, effectiveEfficiency);
    optimalBedtimeStart = window.start;
    optimalBedtimeEnd = window.end;
  }

  return {
    data: {
      sleep_missing: sleepMissing,
      time_in_bed_min: tibMin || null,
      total_sleep_min: tstMin || null,
      deep_sleep_min: deepMin || null,
      rem_sleep_min: remMin || null,
      light_sleep_min: lightMin || null,
      sleep_efficiency_pct: efficiency || null,
      sleep_onset_latency_min: todayRaw.sleep_onset_latency_min ?? null,
      nap_sleep_min: napMin || null,
      sleep_hours_vs_needed_pct: hoursVsNeededPct,
      sleep_regularity_pct: sleepRegularityPct,
      high_sleep_stress_pct: highSleepStressPct,
      sleep_architecture_score: sleepArchitectureScore,
      sleep_debt_h: sleepDebtH,
      dynamic_sleep_need_h: dynamicNeedH,
      optimal_bedtime_start: optimalBedtimeStart,
      optimal_bedtime_end: optimalBedtimeEnd,
      cumulative_sleep_debt_hours: sleepDebtH,
    },
    recoveryScore: sleepRecoveryScore,
  };
}

/**
 * Compute combined recovery score from three pillars
 * Matches Code.txt behavior exactly (lines 1495-1514):
 * - During calibration: recovery_score=null, recovery_status='CALIBRATING', recommended_max_strain=12.0
 * - When NOT calibrating: always computes weighted score, status = OPTIMAL/MODERATE/COMPROMISED
 * - hrv_z_score = 0 when hrvMissing (not null), rhr_z_score = 0 when rhrMissing (not null)
 */
export function computeRecoveryScore(
  hrvScore: number | null,
  rhrScore: number | null,
  sleepScore: number | null,
  todayRaw: RawBiometricDay,
  config: EngineConfig,
  calibrating: boolean,
  hrvZ: number,      // HRV z-score (0 when missing, matching Code.txt)
  rhrZ: number,      // RHR z-score (0 when missing, matching Code.txt)
  sleepArchScore: number | null // Sleep architecture score
): { recovery_score: number | null; recovery_status: string; recommended_max_strain: number | null } {
  // Default values matching Code.txt (lines 1500-1514)
  let recoveryStatus = calibrating ? 'CALIBRATING' : 'INSUFFICIENT_DATA';
  let recommendedMaxStrain = 12.0; // Code.txt default
  let recoveryScore: number | null = null;

  // Code.txt: Only skip weighted computation if calibrating
  // When NOT calibrating, it ALWAYS computes (hrvRecovery/rhrRecovery/sleepRecovery default to 50 when missing)
  if (!calibrating) {
    // Penalties (Code.txt lines 1493-1494)
    let penalties = 0;
    if (todayRaw.spo2_pct !== undefined && todayRaw.spo2_pct !== null && todayRaw.spo2_pct < config.spo2PenaltyThreshold) {
      penalties += config.recoveryPenalty.spo2;
    }
    if (todayRaw.resp_rate_brpm !== undefined && todayRaw.resp_rate_brpm !== null && todayRaw.resp_rate_brpm > config.rhrPenaltyThreshold) {
      penalties += config.recoveryPenalty.respRate;
    }

    // Pillar scores (Code.txt lines 1489-1491): default to 50 when missing
    const hrvRecovery = hrvScore ?? 50;
    const rhrRecovery = rhrScore ?? 50;
    const sleepRecovery = sleepScore ?? 50;

    const weighted = recoveryFromPillars(hrvRecovery, rhrRecovery, sleepRecovery, config.recoveryWeights, penalties);
    recoveryScore = weighted ?? null;

    // Recovery status (Code.txt lines 1500-1514) - UPPERCASE
    if (recoveryScore !== null) {
      recoveryScore = Math.min(99, Math.max(1, recoveryScore)); // clamp 1-99 like Code.txt
      if (recoveryScore >= 67) {
        recoveryStatus = 'OPTIMAL';
        recommendedMaxStrain = +(14.5 + (recoveryScore - 67) * 0.14).toFixed(1);
      } else if (recoveryScore < 34) {
        recoveryStatus = 'COMPROMISED';
        recommendedMaxStrain = +(6.0 + recoveryScore * 0.10).toFixed(1);
      } else {
        recoveryStatus = 'MODERATE';
        recommendedMaxStrain = +(10.0 + (recoveryScore - 34) * 0.13).toFixed(1);
      }
    }
  }

  return {
    recovery_score: recoveryScore,
    recovery_status: recoveryStatus,
    recommended_max_strain: recommendedMaxStrain,
  };
}

/**
 * Main recovery pillar orchestrator
 */
export function computeRecoveryPillar(
  todayRaw: RawBiometricDay,
  history: HistoryDay[],
  prevComputed: PrevComputed | null,
  profile: UserProfile,
  config: EngineConfig
): Partial<ComputedDailyScore> {
  const hrv = computeHRVPillar(todayRaw, history, config, prevComputed);
  const rhr = computeRHRPillar(todayRaw, history, config);
  const sleep = computeSleepPillar(todayRaw, history, config, profile);

  const recovery = computeRecoveryScore(
    hrv.recoveryScore,
    rhr.recoveryScore,
    sleep.recoveryScore,
    todayRaw,
    config,
    hrv.data.calibrating ?? true,
    hrv.data.hrv_z_score ?? 0,      // hrvZ (0 when missing, matching Code.txt)
    rhr.data.rhr_z_score ?? 0,       // rhrZ (0 when missing, matching Code.txt)
    sleep.data.sleep_architecture_score ?? null // sleepArchScore
  );

  return {
    ...hrv.data,
    ...rhr.data,
    ...sleep.data,
    ...recovery,
    readiness_score: recovery.recovery_score, // alias for compatibility
  };
}