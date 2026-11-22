/**
 * ARGON v7.0 — Sleep + HRV Transformer Unit Tests (TDD: RED phase)
 * Tests for parsing ghealth sleep sessions, hypnogram, HRV nocturnal cross-reference.
 * Based on real ghealth SIMPLIFIED JSON payloads (--format json, timezone -04:00).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type {
  GHealthSleepListResponse,
  GHealthHrvListResponse,
  SleepTransformerOutput,
} from '@/etl/types';
import {
  parseSleepSessions,
  parseHrvSamples,
  crossReferenceHrvWithSleep,
  computeSleepMetrics,
  detectNaps,
  computeHrvMedian,
} from '@/etl/transformers/sleep-hrv';

// ========================================================================
// REAL GHEALTH SIMPLIFIED JSON PAYLOAD FIXTURES (timezone -04:00)
// Matches google-health-cli/pkg/output/simplify.go output
// ========================================================================

const FIXTURE_SLEEP_LIST_RESPONSE: GHealthSleepListResponse = {
  dataPoints: [
    {
      // Main nocturnal sleep: 2024-11-20 00:00 to 07:00 -04:00
      source: 'Amazfit Bip 6',
      id: 'sleep_1',
      start: '2024-11-20T00:00:00-04:00',
      end: '2024-11-20T07:00:00-04:00',
      sleepType: 'MAIN',
      isNap: false,
      minutesAsleep: 390,
      minutesAwake: 30,
      totalMinutes: 420,
      minutesToFallAsleep: 10,
      stageMinutes: {
        DEEP: 90,
        LIGHT: 200,
        REM: 100,
        AWAKE: 30,
      },
      stages: [
        { type: 'DEEP', start: '2024-11-20T00:00:00-04:00', end: '2024-11-20T01:30:00-04:00' },
        { type: 'LIGHT', start: '2024-11-20T01:30:00-04:00', end: '2024-11-20T03:00:00-04:00' },
        { type: 'REM', start: '2024-11-20T03:00:00-04:00', end: '2024-11-20T04:00:00-04:00' },
        { type: 'AWAKE', start: '2024-11-20T04:00:00-04:00', end: '2024-11-20T04:10:00-04:00' },
        { type: 'LIGHT', start: '2024-11-20T04:10:00-04:00', end: '2024-11-20T05:40:00-04:00' },
        { type: 'DEEP', start: '2024-11-20T05:40:00-04:00', end: '2024-11-20T06:40:00-04:00' },
        { type: 'AWAKE', start: '2024-11-20T06:40:00-04:00', end: '2024-11-20T07:00:00-04:00' },
      ],
    },
    {
      // Nap: 2024-11-20 14:00 to 15:00 -04:00
      source: 'Amazfit Bip 6',
      id: 'sleep_2',
      start: '2024-11-20T14:00:00-04:00',
      end: '2024-11-20T15:00:00-04:00',
      sleepType: 'NAP',
      isNap: true,
      minutesAsleep: 60,
      minutesAwake: 0,
      totalMinutes: 60,
      minutesToFallAsleep: 5,
      stageMinutes: {
        LIGHT: 40,
        REM: 20,
      },
      stages: [
        { type: 'LIGHT', start: '2024-11-20T14:00:00-04:00', end: '2024-11-20T14:40:00-04:00' },
        { type: 'REM', start: '2024-11-20T14:40:00-04:00', end: '2024-11-20T15:00:00-04:00' },
      ],
    },
  ],
  nextPageToken: null,
};

const FIXTURE_HRV_LIST_RESPONSE: GHealthHrvListResponse = {
  dataPoints: [
    // Samples during nocturnal sleep (00:00-07:00 -04:00)
    { source: 'Amazfit Bip 6', id: 'hrv_1', time: '2024-11-20T00:00:00-04:00', rmssd: 52.1 },
    { source: 'Amazfit Bip 6', id: 'hrv_2', time: '2024-11-20T01:00:00-04:00', rmssd: 48.3 },
    { source: 'Amazfit Bip 6', id: 'hrv_3', time: '2024-11-20T02:00:00-04:00', rmssd: 55.7 },
    { source: 'Amazfit Bip 6', id: 'hrv_4', time: '2024-11-20T03:00:00-04:00', rmssd: 51.2 },
    { source: 'Amazfit Bip 6', id: 'hrv_5', time: '2024-11-20T04:00:00-04:00', rmssd: 49.8 },
    { source: 'Amazfit Bip 6', id: 'hrv_6', time: '2024-11-20T05:00:00-04:00', rmssd: 47.5 },
    { source: 'Amazfit Bip 6', id: 'hrv_7', time: '2024-11-20T06:00:00-04:00', rmssd: 46.9 },
    // Sample during nap (should be ignored for nocturnal HRV)
    { source: 'Amazfit Bip 6', id: 'hrv_8', time: '2024-11-20T14:00:00-04:00', rmssd: 42.1 },
    // Sample outside sleep (11:00 - awake)
    { source: 'Amazfit Bip 6', id: 'hrv_9', time: '2024-11-20T11:00:00-04:00', rmssd: 38.2 },
  ],
  nextPageToken: null,
};

// ========================================================================
// TESTS
// ========================================================================

describe('ETL Transformers - Sleep + HRV', () => {
  let sleepSessions: ReturnType<typeof parseSleepSessions>;
  let hrvSamples: ReturnType<typeof parseHrvSamples>;

  beforeEach(() => {
    sleepSessions = parseSleepSessions(FIXTURE_SLEEP_LIST_RESPONSE);
    hrvSamples = parseHrvSamples(FIXTURE_HRV_LIST_RESPONSE);
  });

  describe('parseSleepSessions', () => {
    it('parses sleep sessions from ghealth SIMPLIFIED JSON response', () => {
      expect(sleepSessions).toHaveLength(2);
      expect(sleepSessions[0].isNap).toBe(false);
      expect(sleepSessions[1].isNap).toBe(true);
    });

    it('converts ISO 8601 timestamps to milliseconds', () => {
      // 2024-11-20T00:00:00-04:00 = 1732075200000
      // 2024-11-20T07:00:00-04:00 = 1732100400000
      expect(typeof sleepSessions[0].startTimeMillis).toBe('number');
      expect(sleepSessions[0].startTimeMillis).toBe(1732075200000);
      expect(sleepSessions[0].endTimeMillis).toBe(1732100400000);
    });

    it('parses stageMinutes as numbers', () => {
      expect(sleepSessions[0].stageMinutes.DEEP).toBe(90);
      expect(sleepSessions[0].stageMinutes.LIGHT).toBe(200);
      expect(sleepSessions[0].stageMinutes.REM).toBe(100);
      expect(sleepSessions[0].stageMinutes.AWAKE).toBe(30);
    });

    it('parses hypnogram stages with millisecond start/end/type', () => {
      expect(sleepSessions[0].stages).toHaveLength(7);
      // First stage: DEEP from 00:00 to 01:30
      expect(sleepSessions[0].stages[0].type).toBe('DEEP');
      expect(sleepSessions[0].stages[0].start).toBe(1732075200000);
      expect(sleepSessions[0].stages[0].end).toBe(1732080600000);
      // Third stage: REM from 03:00 to 04:00
      expect(sleepSessions[0].stages[2].type).toBe('REM');
      expect(sleepSessions[0].stages[2].start).toBe(1732086000000);
      expect(sleepSessions[0].stages[2].end).toBe(1732089600000);
    });

    it('handles missing stageMinutes gracefully', () => {
      const response: GHealthSleepListResponse = {
        dataPoints: [{ source: 'test', id: '1', start: '2024-11-20T00:00:00-04:00', end: '2024-11-20T07:00:00-04:00', sleepType: 'MAIN', isNap: false, minutesAsleep: 0, minutesAwake: 0, totalMinutes: 0, minutesToFallAsleep: 0, stageMinutes: {} }],
        nextPageToken: null,
      };
      const parsed = parseSleepSessions(response);
      expect(parsed[0].stageMinutes).toEqual({});
    });

    it('handles missing stages gracefully', () => {
      const response: GHealthSleepListResponse = {
        dataPoints: [{ source: 'test', id: '1', start: '2024-11-20T00:00:00-04:00', end: '2024-11-20T07:00:00-04:00', sleepType: 'MAIN', isNap: false, minutesAsleep: 0, minutesAwake: 0, totalMinutes: 0, minutesToFallAsleep: 0, stageMinutes: {} }],
        nextPageToken: null,
      };
      const parsed = parseSleepSessions(response);
      expect(parsed[0].stages).toEqual([]);
    });
  });

  describe('parseHrvSamples', () => {
    it('parses HRV samples from ghealth SIMPLIFIED JSON response', () => {
      expect(hrvSamples).toHaveLength(9);
    });

    it('converts ISO 8601 time to milliseconds', () => {
      expect(typeof hrvSamples[0].startTimeMillis).toBe('number');
      expect(hrvSamples[0].startTimeMillis).toBe(1732075200000);
    });

    it('parses RMSSD as number', () => {
      expect(typeof hrvSamples[0].rmssd).toBe('number');
      expect(hrvSamples[0].rmssd).toBeCloseTo(52.1, 1);
    });

    it('handles missing RMSSD (null)', () => {
      const response: GHealthHrvListResponse = {
        dataPoints: [{ source: 'test', id: '1', time: '2024-11-20T00:00:00-04:00' }],
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
    it('computes total sleep minutes from stageMinutes (excludes awake)', () => {
      const nocturnal = sleepSessions.filter(s => !s.isNap);
      const metrics = computeSleepMetrics(nocturnal);
      // TST = DEEP + LIGHT + REM = 90+200+100 = 390 (excludes AWAKE 30)
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
      // Time in bed = 7 hours = 420 min
      // Total sleep time = 390 min
      // Efficiency = 390/420 * 100 = 92.85... ≈ 93
      expect(metrics.time_in_bed_min).toBe(420);
      expect(metrics.total_sleep_min).toBe(390);
      expect(metrics.sleep_efficiency_pct).toBe(93); // Math.round(92.85) = 93
    });

    it('computes sleep onset latency (first non-AWAKE stage start)', () => {
      const nocturnal = sleepSessions.filter(s => !s.isNap);
      const metrics = computeSleepMetrics(nocturnal);
      // First stage is DEEP at start=0 (relative to session start), so latency = 0
      expect(metrics.sleep_onset_latency_min).toBe(0);
    });

    it('handles nap sessions separately', () => {
      const naps = sleepSessions.filter(s => s.isNap);
      const metrics = computeSleepMetrics(naps);
      expect(metrics.naps_count).toBe(1);
      expect(metrics.naps_total_min).toBe(60);
      expect(metrics.nap_sleep_min).toBe(60); // LIGHT 40 + REM 20
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
      // Sorted RMSSD: [46.9, 47.5, 48.3, 49.8, 51.2, 52.1, 55.7], median = 49.8
      expect(output.hrv_nocturnal_median).toBeCloseTo(49.8, 1);
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

  describe('computeHrvMedian', () => {
    it('returns null for empty samples', () => {
      expect(computeHrvMedian([])).toBeNull();
    });

    it('returns null when all RMSSD are null', () => {
      const samples = [
        { startTimeMillis: 1000, endTimeMillis: 1000, rmssd: null },
        { startTimeMillis: 2000, endTimeMillis: 2000, rmssd: null },
      ];
      expect(computeHrvMedian(samples)).toBeNull();
    });

    it('returns the single value for 1 sample (NEW: single sample fix)', () => {
      const samples = [
        { startTimeMillis: 1000, endTimeMillis: 1000, rmssd: 42.5 },
      ];
      expect(computeHrvMedian(samples)).toBe(42.5);
    });

    it('returns median for odd number of samples', () => {
      const samples = [
        { startTimeMillis: 1000, endTimeMillis: 1000, rmssd: 10 },
        { startTimeMillis: 2000, endTimeMillis: 2000, rmssd: 20 },
        { startTimeMillis: 3000, endTimeMillis: 3000, rmssd: 30 },
      ];
      expect(computeHrvMedian(samples)).toBe(20);
    });

    it('returns average of two middle values for even number of samples', () => {
      const samples = [
        { startTimeMillis: 1000, endTimeMillis: 1000, rmssd: 10 },
        { startTimeMillis: 2000, endTimeMillis: 2000, rmssd: 20 },
        { startTimeMillis: 3000, endTimeMillis: 3000, rmssd: 30 },
        { startTimeMillis: 4000, endTimeMillis: 4000, rmssd: 40 },
      ];
      expect(computeHrvMedian(samples)).toBe(25); // (20 + 30) / 2
    });

    it('ignores null RMSSD values', () => {
      const samples = [
        { startTimeMillis: 1000, endTimeMillis: 1000, rmssd: 10 },
        { startTimeMillis: 2000, endTimeMillis: 2000, rmssd: null },
        { startTimeMillis: 3000, endTimeMillis: 3000, rmssd: 30 },
      ];
      expect(computeHrvMedian(samples)).toBe(20); // (10 + 30) / 2
    });
  });
});