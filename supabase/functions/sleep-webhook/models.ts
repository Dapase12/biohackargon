/**
 * OpenStrap algorithm types ported to TypeScript.
 * Mirrors python/argon_algorithms/models.py
 * All models are immutable (readonly) to match Python's frozen dataclasses.
 */

// ── Enums ────────────────────────────────────────────────────────────────────

export enum Tier {
  AUTH = 'AUTH',
  HIGH = 'HIGH',
  ESTIMATE = 'ESTIMATE',
  RELATIVE = 'RELATIVE',
}

export enum Sex {
  MALE = 'male',
  FEMALE = 'female',
}

export enum SleepStage {
  WAKE = 'wake',
  NREM = 'nrem',
  REM = 'rem',
}

// ── Helper Types ────────────────────────────────────────────────────────────

export interface Driver {
  readonly label: string;
  readonly contribution: number;
  readonly detail?: string;
  toJson(): Record<string, unknown>;
}

export interface Metric<T = unknown> {
  readonly value: T | null;
  readonly confidence: number;
  readonly tier: Tier;
  readonly inputsUsed: string[];
  readonly drivers?: Driver[];
  readonly note?: string;
  readonly present: boolean;
  toJson(encode?: (v: T) => unknown): Record<string, unknown>;
}

export function metricAbsent<T>(
  tier: Tier,
  inputsUsed?: string[],
  note?: string,
): Metric<T> {
  return {
    value: null,
    confidence: 0.0,
    tier,
    inputsUsed: inputsUsed ?? [],
    drivers: undefined,
    note,
    get present() { return false; },
    toJson() {
      return {
        value: '—',
        confidence: 0.0,
        tier: this.tier,
        inputs_used: this.inputsUsed,
      };
    },
  };
}

// ── Core Signal Types ───────────────────────────────────────────────────────

export interface RrSeries {
  readonly tsMs: number[];
  readonly rrMs: number[];
  readonly length: number;
  readonly isEmpty: boolean;
  beatTimesMs(t0Ms?: number): number[];
}

export interface HrSample {
  readonly tsMs: number;
  readonly hr: number;
  readonly valid: boolean;
}

export interface AccelSample {
  readonly tsMs: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly valid: boolean;
}

export interface AdcSample {
  readonly tsMs: number;
  readonly adc: number;
  readonly valid: boolean;
}

// ── Nightly Record ──────────────────────────────────────────────────────────

export interface NightlyRecord {
  readonly date: string;
  readonly rhr?: number;
  readonly lnRmssd?: number;
  readonly rmssd?: number;
  readonly sdnn?: number;
  readonly skinTempZ?: number;
  readonly respRate?: number;
  readonly coverage?: number;
}

// ── Sleep Night Observation ─────────────────────────────────────────────────

export interface SleepNightObservation {
  readonly hrFloorP5?: number | null;
  readonly hrFloorP25?: number | null;
  readonly hrSleepMedian?: number | null;
  readonly hrArousal?: number | null;
  readonly rmssdMed?: number | null;
  readonly rmssdMad?: number | null;
  readonly enmoStillCut?: number | null;
  readonly enmoMoveCut?: number | null;
  readonly lfhfMed?: number | null;
  readonly rkMed?: number | null;
  readonly updatedAtMs: number;
}

// ── Sleep User Profile ──────────────────────────────────────────────────────

export interface SleepUserProfile {
  readonly nights: number;
  readonly hrFloorP5?: number | null;
  readonly hrFloorP25?: number | null;
  readonly hrSleepMedian?: number | null;
  readonly hrArousal?: number | null;
  readonly rmssdMed?: number | null;
  readonly rmssdMad?: number | null;
  readonly enmoStillCut?: number | null;
  readonly enmoMoveCut?: number | null;
  readonly lfhfMed?: number | null;
  readonly rkMed?: number | null;
  readonly updatedAtMs: number;
  readonly personalWeight: number;
  toJson(): Record<string, unknown>;
  fold(observation: SleepNightObservation, horizonNights?: number): SleepUserProfile;
}

export interface SleepUserProfileInit {
  nights?: number;
  hrFloorP5?: number | null;
  hrFloorP25?: number | null;
  hrSleepMedian?: number | null;
  hrArousal?: number | null;
  rmssdMed?: number | null;
  rmssdMad?: number | null;
  enmoStillCut?: number | null;
  enmoMoveCut?: number | null;
  lfhfMed?: number | null;
  rkMed?: number | null;
  updatedAtMs?: number;
}

export function createSleepUserProfile(data: SleepUserProfileInit = {}): SleepUserProfile {
  return {
    nights: data.nights ?? 0,
    hrFloorP5: data.hrFloorP5 ?? undefined,
    hrFloorP25: data.hrFloorP25 ?? undefined,
    hrSleepMedian: data.hrSleepMedian ?? undefined,
    hrArousal: data.hrArousal ?? undefined,
    rmssdMed: data.rmssdMed ?? undefined,
    rmssdMad: data.rmssdMad ?? undefined,
    enmoStillCut: data.enmoStillCut ?? undefined,
    enmoMoveCut: data.enmoMoveCut ?? undefined,
    lfhfMed: data.lfhfMed ?? undefined,
    rkMed: data.rkMed ?? undefined,
    updatedAtMs: data.updatedAtMs ?? 0,
    get personalWeight() {
      return Math.max(0.0, Math.min(0.5, this.nights / 28.0));
    },
    toJson() {
      const result: Record<string, unknown> = {
        nights: this.nights,
        updated_at_ms: this.updatedAtMs,
      };
      const entries: Array<[string, number | null | undefined]> = [
        ['hr_floor_p5', this.hrFloorP5],
        ['hr_floor_p25', this.hrFloorP25],
        ['hr_sleep_median', this.hrSleepMedian],
        ['hr_arousal', this.hrArousal],
        ['rmssd_med', this.rmssdMed],
        ['rmssd_mad', this.rmssdMad],
        ['enmo_still_cut', this.enmoStillCut],
        ['enmo_move_cut', this.enmoMoveCut],
        ['lfhf_med', this.lfhfMed],
        ['rk_med', this.rkMed],
      ];
      for (const [field, value] of entries) {
        if (value !== undefined && value !== null) result[field] = value;
      }
      return result;
    },
    fold(observation: SleepNightObservation, horizonNights = 14): SleepUserProfile {
      if (horizonNights <= 0) throw new Error('horizon_nights must be positive');
      const n2 = this.nights + 1;
      const a = Math.max(1.0 / n2, 2.0 / (horizonNights + 1));

      const ew = (
        old: number | null | undefined,
        obs: number | null | undefined,
      ): number | undefined => {
        if (obs === undefined || obs === null) return old ?? undefined;
        if (old === undefined || old === null) return obs;
        return old * (1 - a) + obs * a;
      };

      return createSleepUserProfile({
        nights: n2,
        hrFloorP5: ew(this.hrFloorP5, observation.hrFloorP5),
        hrFloorP25: ew(this.hrFloorP25, observation.hrFloorP25),
        hrSleepMedian: ew(this.hrSleepMedian, observation.hrSleepMedian),
        hrArousal: ew(this.hrArousal, observation.hrArousal),
        rmssdMed: ew(this.rmssdMed, observation.rmssdMed),
        rmssdMad: ew(this.rmssdMad, observation.rmssdMad),
        enmoStillCut: ew(this.enmoStillCut, observation.enmoStillCut),
        enmoMoveCut: ew(this.enmoMoveCut, observation.enmoMoveCut),
        lfhfMed: ew(this.lfhfMed, observation.lfhfMed),
        rkMed: ew(this.rkMed, observation.rkMed),
        updatedAtMs: observation.updatedAtMs,
      });
    },
  };
}

export function sleepUserProfileFromJson(data: Record<string, unknown>): SleepUserProfile {
  return createSleepUserProfile({
    nights: typeof data.nights === 'number' ? data.nights : 0,
    hrFloorP5: data.hr_floor_p5 as number | null | undefined,
    hrFloorP25: data.hr_floor_p25 as number | null | undefined,
    hrSleepMedian: data.hr_sleep_median as number | null | undefined,
    hrArousal: data.hr_arousal as number | null | undefined,
    rmssdMed: data.rmssd_med as number | null | undefined,
    rmssdMad: data.rmssd_mad as number | null | undefined,
    enmoStillCut: data.enmo_still_cut as number | null | undefined,
    enmoMoveCut: data.enmo_move_cut as number | null | undefined,
    lfhfMed: data.lfhf_med as number | null | undefined,
    rkMed: data.rk_med as number | null | undefined,
    updatedAtMs: typeof data.updated_at_ms === 'number' ? data.updated_at_ms : 0,
  });
}

// ── Stager Results ──────────────────────────────────────────────────────────

export interface StagerResult {
  readonly stages: SleepStage[];
  readonly epochSec: number;
  readonly wakePct: number;
  readonly nremPct: number;
  readonly remPct: number;
  toJson(): Record<string, unknown>;
}

export interface CardioStagerResult {
  readonly base: StagerResult;
  readonly deepFlag: boolean[];
  readonly confidence: number;
  toJson(): Record<string, unknown>;
}

// ── Load State ──────────────────────────────────────────────────────────────

export interface LoadState {
  readonly ctl: number;
  readonly atl: number;
  readonly tsb: number;
}

// ── Quiet Level ─────────────────────────────────────────────────────────────

export interface QuietLevel {
  readonly hrr: number;
  readonly days: number;
  readonly settled: boolean;
}

// ── Net TRIMP ───────────────────────────────────────────────────────────────

export interface NetTrimp {
  readonly exercise: number;
  readonly living: number;
  readonly minutes: number;
  readonly net: number;
}

// ── Sleep Staging Types ─────────────────────────────────────────────────────

export interface SleepWindow {
  readonly startS: number;
  readonly endS: number;
  readonly durationS: number;
}

export interface ImmobilityMask {
  readonly mask: number[];
  readonly tsMs: number[];
  readonly length: number;
  readonly isEmpty: boolean;
}

export interface ZAngle {
  readonly zAngleDeg: number[];
  readonly tsMs: number[];
  readonly length: number;
  readonly isEmpty: boolean;
}

export interface SleepSession {
  readonly accel: AccelSample[];
  readonly hr: HrSample[];
  readonly rr: RrSeries[];
  readonly inBedStartS: number;
  readonly inBedEndS: number;
  readonly profile?: SleepUserProfile;
}

export interface CardioEpochFeatures {
  readonly epochStartS: number;
  readonly enmoMedian: number;
  readonly enmoP95: number;
  readonly stillFrac: number;
  readonly hrMedian?: number | null;
  readonly hrP5?: number | null;
  readonly hrP25?: number | null;
  readonly rmssd?: number | null;
  readonly lfhf?: number | null;
  readonly rk?: number | null;
  readonly validHrFrac: number;
  readonly validRrFrac: number;
  readonly immobileFrac: number;
}

export interface SleepSegmentation {
  readonly stages: number[]; // 0=wake, 1=nrem, 2=rem
  readonly deepFlag: boolean[];
  readonly epochSec: number;
  readonly inBedStartS: number;
  readonly inBedEndS: number;
  readonly sleepOnsetS?: number | null;
  readonly sleepOffsetS?: number | null;
  readonly unobservedSec: number;
  readonly confidence: number;
  readonly sleepStageEnum: SleepStage[];
  toStagerResult(): StagerResult;
  toCardioResult(): CardioStagerResult;
}

export interface AdvancedSleepStager {
  readonly epochSec: number;
  readonly minSleepWindowMin: number;
  readonly stillCutG: number;
  readonly moveCutG: number;
  readonly zAngleStillDeg: number;
  readonly maxPersonalWeight: number;
}

// Factory functions for creating immutable objects with methods

export function createRrSeries(tsMs: number[], rrMs: number[]): RrSeries {
  return {
    tsMs: [...tsMs],
    rrMs: [...rrMs],
    get length() { return this.rrMs.length; },
    get isEmpty() { return this.rrMs.length === 0; },
    beatTimesMs(t0Ms = 0.0): number[] {
      const out: number[] = [];
      let t = t0Ms;
      for (const rr of this.rrMs) {
        t += rr;
        out.push(t);
      }
      return out;
    },
  };
}

export function createHrSample(tsMs: number, hr: number): HrSample {
  return {
    tsMs,
    hr,
    get valid() { return this.hr > 0; },
  };
}

export function createAccelSample(tsMs: number, x: number, y: number, z: number, valid = true): AccelSample {
  return { tsMs, x, y, z, valid };
}

export function createSleepWindow(startS: number, endS: number): SleepWindow {
  return {
    startS,
    endS,
    get durationS() { return this.endS - this.startS; },
  };
}

export function createImmobilityMask(mask: number[], tsMs: number[]): ImmobilityMask {
  return {
    mask: [...mask],
    tsMs: [...tsMs],
    get length() { return this.mask.length; },
    get isEmpty() { return this.mask.length === 0; },
  };
}

export function createZAngle(zAngleDeg: number[], tsMs: number[]): ZAngle {
  return {
    zAngleDeg: [...zAngleDeg],
    tsMs: [...tsMs],
    get length() { return this.zAngleDeg.length; },
    get isEmpty() { return this.zAngleDeg.length === 0; },
  };
}

export function createSleepSession(
  accel: AccelSample[],
  hr: HrSample[],
  rr: RrSeries[],
  inBedStartS: number,
  inBedEndS: number,
  profile?: SleepUserProfile,
): SleepSession {
  return { accel, hr, rr, inBedStartS, inBedEndS, profile };
}

export function createSleepSegmentation(data: {
  stages: number[];
  deepFlag: boolean[];
  epochSec: number;
  inBedStartS: number;
  inBedEndS: number;
  sleepOnsetS?: number | null;
  sleepOffsetS?: number | null;
  unobservedSec: number;
  confidence: number;
}): SleepSegmentation {
  const seg: SleepSegmentation = {
    stages: [...data.stages],
    deepFlag: [...data.deepFlag],
    epochSec: data.epochSec,
    inBedStartS: data.inBedStartS,
    inBedEndS: data.inBedEndS,
    sleepOnsetS: data.sleepOnsetS ?? null,
    sleepOffsetS: data.sleepOffsetS ?? null,
    unobservedSec: data.unobservedSec,
    confidence: data.confidence,
    get sleepStageEnum(): SleepStage[] {
      const mapping: Record<number, SleepStage> = { 0: SleepStage.WAKE, 1: SleepStage.NREM, 2: SleepStage.REM };
      return this.stages.map(s => mapping[s] ?? SleepStage.WAKE);
    },
    toStagerResult(): StagerResult {
      const stages = this.sleepStageEnum;
      const total = stages.length;
      if (total === 0) {
        return {
          stages: [],
          epochSec: this.epochSec,
          wakePct: 0,
          nremPct: 0,
          remPct: 0,
          toJson() { return { epoch_sec: this.epochSec, wake_pct: 0, nrem_pct: 0, rem_pct: 0, epochs: 0 }; },
        };
      }
      const wake = stages.filter(s => s === SleepStage.WAKE).length / total;
      const nrem = stages.filter(s => s === SleepStage.NREM).length / total;
      const rem = stages.filter(s => s === SleepStage.REM).length / total;
      return {
        stages,
        epochSec: this.epochSec,
        wakePct: wake * 100,
        nremPct: nrem * 100,
        remPct: rem * 100,
        toJson() {
          return {
            epoch_sec: this.epochSec,
            wake_pct: Math.round(this.wakePct * 1e6) / 1e6,
            nrem_pct: Math.round(this.nremPct * 1e6) / 1e6,
            rem_pct: Math.round(this.remPct * 1e6) / 1e6,
            epochs: total,
          };
        },
      };
    },
    toCardioResult(): CardioStagerResult {
      const base = this.toStagerResult();
      return {
        base,
        deepFlag: this.deepFlag,
        confidence: this.confidence,
        toJson() {
          const result = this.base.toJson();
          result.deep_flag = this.deepFlag;
          result.confidence = Math.round(this.confidence * 1e6) / 1e6;
          return result;
        },
      };
    },
  };
  return seg;
}

export function createAdvancedSleepStager(config: Partial<AdvancedSleepStager> = {}): AdvancedSleepStager {
  return {
    epochSec: config.epochSec ?? 30,
    minSleepWindowMin: config.minSleepWindowMin ?? 30,
    stillCutG: config.stillCutG ?? 0.015,
    moveCutG: config.moveCutG ?? 0.05,
    zAngleStillDeg: config.zAngleStillDeg ?? 5.0,
    maxPersonalWeight: config.maxPersonalWeight ?? 0.5,
  };
}
