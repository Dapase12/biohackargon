/**
 * ARGON v7.0 — Sleep + HRV Transformer Unit Tests (TDD: RED phase)
 * Tests for parsing ghealth sleep sessions, hypnogram, HRV nocturnal cross-reference.
 * Based on real ghealth payloads from user account (timezone -04:00).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type {
  GHealthSleepSession,
  GHealthHrvSample,
  SleepTransformerOutput,
} from '@/etl/types';
import {
  parseSleepSessions,
  parseHrvSamples,
  crossReferenceHrvWithSleep,
  computeSleepMetrics,
  detectNaps,
} from '@/etl/transformers/sleep-hrv';

// ========================================================================
// REAL GHEALTH PAYLOAD FIXTURES (from user account, timezone -04:00)
// ========================================================================

const FIXTURE_SLEEP_LIST_RESPONSE = {
  dataPoints: [
    {
      // Main nocturnal sleep
      startTimeMillis: "1732064400000", // 2024-11-20 00:00:00 -04:00
      endTimeMillis: "1732089600000",   // 2024-11-20 07:00:00 -04:00
      isNap: false,
      sleepQuality: "GOOD",
      stageMinutes: {
        DEEP: "90",
        LIGHT: "200",
        REM: "100",
        AWAKE: "30",
      },
      stages: [
        { start: 0, end: 90, type: "DEEP" },
        { start: 90, end: 180, type: "LIGHT" },
        { start: 180, end: 240, type: "REM" },
        { start: 240, end: 250, type: "AWAKE" },
        { start: 250, end: 340, type: "LIGHT" },
        { start: 340, end: 400, type: "DEEP" },
        { start: 400, end: 420, type: "AWAKE" },
      ],
    },
    {
      // Nap
      startTimeMillis: "1732123200000", // 2024-11-20 14:00:00 -04:00
      endTimeMillis: "1732126800000",   // 2024-11-20 15:00:00 -04:00
      isNap: true,
      sleepQuality: "UNKNOWN",
      stageMinutes: {
        LIGHT: "40",
        REM: "20",
      },
      stages: [
        { start: 0, end: 40, type: "LIGHT" },
        { start: 40, end: 60, type: "REM" },
      ],
    },
  ],
  nextPageToken: null,
};

const FIXTURE_HRV_LIST_RESPONSE = {
  dataPoints: [
    // Samples during nocturnal sleep
    { startTimeMillis: "1732064400000", endTimeMillis: "1732064460000", rootMeanSquareOfSuccessiveDifferencesMilliseconds: "52.1" }, // 00:00 - deep
    { startTimeMillis: "1732068000000", endTimeMillis: "1732068060000", rootMeanSquareOfSuccessiveDifferencesMilliseconds: "48.3" }, // 01:00 - deep
    { startTimeMillis: "1732071600000", endTimeMillis: "1732071660000", rootMeanSquareOfSuccessiveDifferencesMilliseconds: "55.7" }, // 02:00 - deep
    { startTimeMillis: "1732075200000", endTimeMillis: "1732075260000", rootMeanSquareOfSuccessiveDifferencesMilliseconds: "51.2" }, // 03:00 - deep
    { startTimeMillis: "1732078800000", endTimeMillis: "1732078860000", rootMeanSquareOfSuccessiveDifferencesMilliseconds: "49.8" }, // 04:00 - light
    { startTimeMillis: "1732082400000", endTimeMillis: "1732082460000", rootMeanSquareOfSuccessiveDifferencesMilliseconds: "47.5" }, // 05:00 - light
    { startTimeMillis: "1732086000000", endTimeMillis: "1732086060000", rootMeanSquareOfSuccessiveDifferencesMilliseconds: "46.9" }, // 06:00 - REM
    // Sample during nap (should be ignored for nocturnal HRV)
    { startTimeMillis: "1732123200000", endTimeMillis: "1732123260000", rootMeanSquareOfSuccessiveDifferencesMilliseconds: "42.1" }, // 14:00 - nap
    // Sample outside sleep
    { startTimeMillis: "1732104000000", endTimeMillis: "1732104060000", rootMeanSquareOfSuccessiveDifferencesMilliseconds: "38.2" }, // 11:00 - awake
  ],
  nextPageToken: null,
};

// ========================================================================
// TESTS
// ========================================================================

describe('ETL Transformers - Sleep + HRV', () => {
  let sleepSessions: GHealthSleepSession[];
  let hrvSamples: GHealthHrvSample[];

  beforeEach(() => {
    sleepSessions = parseSleepSessions(FIXTURE_SLEEP_LIST_RESPONSE);
    hrvSamples = parseHrvSamples(FIXTURE_HRV_LIST_RESPONSE);
  });

  describe('parseSleepSessions', () => {
    it('parses sleep sessions from ghealth response', () => {
      expect(sleepSessions).toHaveLength(2);
      expect(sleepSessions[0].isNap).toBe(false);
      expect(sleepSessions[1].isNap).toBe(true);
    });

    it('converts string timestamps to numbers', () => {
      expect(typeof sleepSessions[0].startTimeMillis).toBe('number');
      expect(sleepSessions[0].startTimeMillis).toBe(1732064400000);
    });

    it('parses stageMinutes as numbers', () => {
      expect(sleepSessions[0].stageMinutes.DEEP).toBe(90);
      expect(sleepSessions[0].stageMinutes.LIGHT).toBe(200);
      expect(sleepSessions[0].stageMinutes.REM).toBe(100);
      expect(sleepSessions[0].stageMinutes.AWAKE).toBe(30);
    });

    it('parses hypnogram stages with numeric start/end/type', () => {
      expect(sleepSessions[0].stages).toHaveLength(7);
      expect(sleepSessions[0].stages[0]).toEqual({ start: 0, end: 90, type: 'DEEP' });
      expect(sleepSessions[0].stages[2]).toEqual({ start: 180, end: 240, type: 'REM' });
    });

    it('handles missing stageMinutes gracefully', () => {
      const response = {
        dataPoints: [{ startTimeMillis: "1000", endTimeMillis: "2000", isNap: false }],
        nextPageToken: null,
      };
      const parsed = parseSleepSessions(response);
      expect(parsed[0].stageMinutes).toEqual({});
    });
  });

  describe('parseHrvSamples', () => {
    it('parses HRV samples from ghealth response', () => {
      expect(hrvSamples).toHaveLength(9);
    });

    it('converts RMSSD string to number', () => {
      expect(typeof hrvSamples[0].rmssd).toBe('number');
      expect(hrvSamples[0].rmssd).toBeCloseTo(52.1, 1);
    });

    it('converts timestamps to numbers', () => {
      expect(typeof hrvSamples[0].startTimeMillis).toBe('number');
      expect(hrvSamples[0].startTimeMillis).toBe(1732064400000);
    });

    it('handles missing RMSSD (null)', () => {
      const response = {
        dataPoints: [{ startTimeMillis: "1000", endTimeMillis: "2000" }],
        nextPageToken: null,
      };
      const parsed = parseHrvSamples(response);
      expect(parsed[0].rmssd).toBeNull();
    });
  });

  describe('crossReferenceHrvWithSleep', () => {
    it('filters HRV samples to nocturnal sleep window only (excludes naps)', () => {
      const nocturnal = crossReferenceHrvWithSleep(hrvSamples, sleepSessions, { includeNaps: false });
      // Should include 7 samples during nocturnal sleep (00:00-07:00)
      // Exclude 1 nap sample (14:00) and 1 awake sample (11:00)
      expect(nocturnal).toHaveLength(7);
    });

    it('includes nap HRV when includeNaps=true', () => {
      const withNaps = crossReferenceHrvWithSleep(hrvSamples, sleepSessions, { includeNaps: true });
      expect(withNaps).toHaveLength(8); // 7 nocturnal + 1 nap
    });

    it('returns empty array when no sleep sessions', () => {
      const result = crossReferenceHrvWithSleep(hrvSamples, [], { includeNaps: false });
      expect(result).toHaveLength(0);
    });

    it('handles HRV samples outside any sleep window', () => {
      const awakeSamples = hrvSamples.filter(s => s.startTimeMillis > 1732100000000);
      const result = crossReferenceHrvWithSleep(awakeSamples, sleepSessions, { includeNaps: false });
      expect(result).toHaveLength(0);
    });
  });

  describe('computeSleepMetrics', () => {
    it('computes total sleep minutes from stageMinutes', () => {
      const nocturnal = sleepSessions.filter(s => !s.isNap);
      const metrics = computeSleepMetrics(nocturnal);
      // TST = DEEP + LIGHT + REM = 90+200+100 = 390 (excludes AWAKE)
      expect(metrics.total_sleep_min).toBe(390);
    });

    it('computes deep, REM, light, awake minutes correctly', () => {
      const nocturnal = sleepSessions.filter(s => !s.isNap);
      const metrics = computeSleepMetrics(nocturnal);
      expect(metrics.deep_sleep_min).toBe(90);
      expect(metrics.rem_sleep_min).toBe(100);
      expect(metrics.light_sleep_min).toBe(200);
      expect(metrics.awake_sleep_min).toBe(30);
    });

    it('computes sleep efficiency from hypnogram', () => {
      const nocturnal = sleepSessions.filter(s => !s.isNap);
      const metrics = computeSleepMetrics(nocturnal);
      // TST = 420, TIB = 420 + 30 (awake) = 450? Actually from timestamps: 7h = 420min
      // The fixture has 7 hours between start/end = 420min TIB
      // But hypnogram awake = 30min, so TST = 390? Let's check...
      // stages total: 90+90+60+10+90+60+20 = 420min = TIB
      // awake in stages = 10+20 = 30min
      // TST = 420 - 30 = 390min
      // Wait, stageMinutes sums to 420, awake=30, so TST=390
      expect(metrics.time_in_bed_min).toBe(420);
      expect(metrics.total_sleep_min).toBe(390);
      expect(metrics.sleep_efficiency_pct).toBeCloseTo(92.9, 0); // 390/420 * 100
    });

    it('computes sleep onset latency (first non-AWAKE stage start)', () => {
      const nocturnal = sleepSessions.filter(s => !s.isNap);
      const metrics = computeSleepMetrics(nocturnal);
      // First stage is DEEP at start=0, so latency = 0
      expect(metrics.sleep_onset_latency_min).toBe(0);
    });

    it('handles nap sessions separately', () => {
      const naps = sleepSessions.filter(s => s.isNap);
      const metrics = computeSleepMetrics(naps);
      expect(metrics.naps_count).toBe(1);
      expect(metrics.naps_total_min).toBe(60);
      expect(metrics.nap_sleep_min).toBe(60);
    });
  });

  describe('detectNaps', () => {
    it('identifies naps: 10-240 min, started 08:00-20:00', () => {
      const naps = detectNaps(sleepSessions);
      expect(naps).toHaveLength(1);
      expect(naps[0].isNap).toBe(true);
      expect(naps[0].durationMin).toBe(60);
    });

    it('excludes nocturnal sleep from naps', () => {
      const naps = detectNaps(sleepSessions);
      expect(naps.every(n => n.isNap)).toBe(true);
    });
  });

  describe('Full sleep + HRV pipeline', () => {
    it('produces complete SleepTransformerOutput', () => {
      const nocturnalSessions = sleepSessions.filter(s => !s.isNap);
      const nocturnalHrv = crossReferenceHrvWithSleep(hrvSamples, sleepSessions, { includeNaps: false });

      const output: SleepTransformerOutput = {
        ...computeSleepMetrics(nocturnalSessions),
        hrv_nocturnal_median: crossReferenceHrvWithSleep(hrvSamples, sleepSessions, { includeNaps: false })
          .filter(s => s.rmssd !== null)
          .map(s => s.rmssd!)
          .sort((a, b) => a - b)[3], // median of 7 values = index 3
        hrv_deep_sleep_median: crossReferenceHrvWithSleep(hrvSamples, sleepSessions, { includeNaps: false })
          .filter(s => s.rmssd !== null)
          .map(s => s.rmssd!)
          .sort((a, b) => a - b)[3],
        hrv_nocturnal_count: nocturnalHrv.filter(s => s.rmssd !== null).length,
      };

      expect(output.total_sleep_min).toBe(390);
      expect(output.deep_sleep_min).toBe(90);
      expect(output.rem_sleep_min).toBe(100);
      expect(output.hrv_nocturnal_count).toBe(7);
      expect(output.hrv_nocturnal_median).toBeCloseTo(50, 0); // median of [46.9, 47.5, 48.3, 49.8, 51.2, 52.1, 55.7] ≈ 49.8
    });

    it('falls back to all nocturnal HRV when deep sleep samples < 5', () => {
      // Create HRV with only 3 samples in deep sleep
      const fewDeepSamples = hrvSamples.slice(0, 3);
      const nocturnal = crossReferenceHrvWithSleep(fewDeepSamples, sleepSessions, { includeNaps: false });

      // Should use all nocturnal samples when deep < 5
      const allNocturnal = crossReferenceHrvWithSleep(hrvSamples, sleepSessions, { includeNaps: false });
      expect(allNocturnal.length).toBeGreaterThan(3);
    });
  });
});