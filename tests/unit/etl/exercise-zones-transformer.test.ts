/**
 * ARGON v7.0 — Exercise + HR Zones Transformer Unit Tests (TDD: RED phase)
 * Tests for parsing ghealth exercise sessions, minute HR, pause/resume events,
 * Karvonen %HRR zone classification.
 * Based on real ghealth SIMPLIFIED JSON payloads (--format json, timezone -04:00).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type {
  GHealthExerciseListResponse,
  GHealthHrListResponse,
  GHealthExerciseEventsResponse,
  ExerciseTransformerOutput,
} from '@/etl/types';
import {
  parseExerciseSessions,
  parseHrSamples,
  parseExerciseEvents,
  filterHrDuringExercise,
  classifyHrZonesKarvonen,
  computeExerciseMetrics,
} from '@/etl/transformers/exercise-zones';

// ========================================================================
// REAL GHEALTH SIMPLIFIED JSON PAYLOAD FIXTURES (timezone -04:00)
// Matches google-health-cli/pkg/output/simplify.go output
// ========================================================================

const FIXTURE_EXERCISE_LIST_RESPONSE: GHealthExerciseListResponse = {
  dataPoints: [
    {
      // Session 1: Running 30 min (10:00-10:30 -04:00)
      source: 'Amazfit Bip 6',
      id: 'exercise_1',
      start: '2024-11-20T10:00:00-04:00',
      end: '2024-11-20T10:30:00-04:00',
      type: 'RUNNING',
      name: 'Running',
      caloriesKcal: 320,
      averageHeartRateBeatsPerMinute: 145,
      maxHeartRateBeatsPerMinute: 168,
    },
    {
      // Session 2: Strength training 30 min (16:00-16:30 -04:00)
      source: 'Amazfit Bip 6',
      id: 'exercise_2',
      start: '2024-11-20T16:00:00-04:00',
      end: '2024-11-20T16:30:00-04:00',
      type: 'STRENGTH_TRAINING',
      name: 'Strength Training',
      caloriesKcal: 250,
      averageHeartRateBeatsPerMinute: 120,
      maxHeartRateBeatsPerMinute: 142,
    },
  ],
  nextPageToken: null,
};

const FIXTURE_HR_LIST_RESPONSE: GHealthHrListResponse = {
  dataPoints: [
    // Session 1 HR samples (10:00-10:30)
    { source: 'Amazfit Bip 6', id: 'hr_1', time: '2024-11-20T10:00:00-04:00', beatsPerMinute: 130 },
    { source: 'Amazfit Bip 6', id: 'hr_2', time: '2024-11-20T10:01:00-04:00', beatsPerMinute: 135 },
    { source: 'Amazfit Bip 6', id: 'hr_3', time: '2024-11-20T10:02:00-04:00', beatsPerMinute: 140 },
    { source: 'Amazfit Bip 6', id: 'hr_4', time: '2024-11-20T10:03:00-04:00', beatsPerMinute: 145 },
    { source: 'Amazfit Bip 6', id: 'hr_5', time: '2024-11-20T10:04:00-04:00', beatsPerMinute: 150 },
    { source: 'Amazfit Bip 6', id: 'hr_6', time: '2024-11-20T10:05:00-04:00', beatsPerMinute: 155 },
    { source: 'Amazfit Bip 6', id: 'hr_7', time: '2024-11-20T10:06:00-04:00', beatsPerMinute: 160 },
    { source: 'Amazfit Bip 6', id: 'hr_8', time: '2024-11-20T10:07:00-04:00', beatsPerMinute: 165 },
    { source: 'Amazfit Bip 6', id: 'hr_9', time: '2024-11-20T10:08:00-04:00', beatsPerMinute: 168 },
    { source: 'Amazfit Bip 6', id: 'hr_10', time: '2024-11-20T10:09:00-04:00', beatsPerMinute: 165 },
    { source: 'Amazfit Bip 6', id: 'hr_11', time: '2024-11-20T10:10:00-04:00', beatsPerMinute: 160 },
    { source: 'Amazfit Bip 6', id: 'hr_12', time: '2024-11-20T10:11:00-04:00', beatsPerMinute: 155 },
    { source: 'Amazfit Bip 6', id: 'hr_13', time: '2024-11-20T10:12:00-04:00', beatsPerMinute: 150 },
    { source: 'Amazfit Bip 6', id: 'hr_14', time: '2024-11-20T10:13:00-04:00', beatsPerMinute: 145 },
    { source: 'Amazfit Bip 6', id: 'hr_15', time: '2024-11-20T10:14:00-04:00', beatsPerMinute: 140 },
    { source: 'Amazfit Bip 6', id: 'hr_16', time: '2024-11-20T10:15:00-04:00', beatsPerMinute: 135 },
    { source: 'Amazfit Bip 6', id: 'hr_17', time: '2024-11-20T10:16:00-04:00', beatsPerMinute: 130 },
    { source: 'Amazfit Bip 6', id: 'hr_18', time: '2024-11-20T10:17:00-04:00', beatsPerMinute: 125 },
    { source: 'Amazfit Bip 6', id: 'hr_19', time: '2024-11-20T10:18:00-04:00', beatsPerMinute: 120 },
    { source: 'Amazfit Bip 6', id: 'hr_20', time: '2024-11-20T10:19:00-04:00', beatsPerMinute: 115 },
    { source: 'Amazfit Bip 6', id: 'hr_21', time: '2024-11-20T10:20:00-04:00', beatsPerMinute: 110 },
    { source: 'Amazfit Bip 6', id: 'hr_22', time: '2024-11-20T10:21:00-04:00', beatsPerMinute: 105 },
    { source: 'Amazfit Bip 6', id: 'hr_23', time: '2024-11-20T10:22:00-04:00', beatsPerMinute: 100 },
    { source: 'Amazfit Bip 6', id: 'hr_24', time: '2024-11-20T10:23:00-04:00', beatsPerMinute: 95 },
    { source: 'Amazfit Bip 6', id: 'hr_25', time: '2024-11-20T10:24:00-04:00', beatsPerMinute: 90 },
    { source: 'Amazfit Bip 6', id: 'hr_26', time: '2024-11-20T10:25:00-04:00', beatsPerMinute: 88 },
    { source: 'Amazfit Bip 6', id: 'hr_27', time: '2024-11-20T10:26:00-04:00', beatsPerMinute: 85 },
    { source: 'Amazfit Bip 6', id: 'hr_28', time: '2024-11-20T10:27:00-04:00', beatsPerMinute: 82 },
    { source: 'Amazfit Bip 6', id: 'hr_29', time: '2024-11-20T10:28:00-04:00', beatsPerMinute: 80 },
    { source: 'Amazfit Bip 6', id: 'hr_30', time: '2024-11-20T10:29:00-04:00', beatsPerMinute: 78 },
    // Session 2 HR samples (16:00-16:30)
    { source: 'Amazfit Bip 6', id: 'hr_31', time: '2024-11-20T16:00:00-04:00', beatsPerMinute: 100 },
    { source: 'Amazfit Bip 6', id: 'hr_32', time: '2024-11-20T16:01:00-04:00', beatsPerMinute: 105 },
    { source: 'Amazfit Bip 6', id: 'hr_33', time: '2024-11-20T16:02:00-04:00', beatsPerMinute: 110 },
    { source: 'Amazfit Bip 6', id: 'hr_34', time: '2024-11-20T16:03:00-04:00', beatsPerMinute: 115 },
    { source: 'Amazfit Bip 6', id: 'hr_35', time: '2024-11-20T16:04:00-04:00', beatsPerMinute: 120 },
    { source: 'Amazfit Bip 6', id: 'hr_36', time: '2024-11-20T16:05:00-04:00', beatsPerMinute: 125 },
    { source: 'Amazfit Bip 6', id: 'hr_37', time: '2024-11-20T16:06:00-04:00', beatsPerMinute: 130 },
    { source: 'Amazfit Bip 6', id: 'hr_38', time: '2024-11-20T16:07:00-04:00', beatsPerMinute: 135 },
    { source: 'Amazfit Bip 6', id: 'hr_39', time: '2024-11-20T16:08:00-04:00', beatsPerMinute: 140 },
    { source: 'Amazfit Bip 6', id: 'hr_40', time: '2024-11-20T16:09:00-04:00', beatsPerMinute: 142 },
    { source: 'Amazfit Bip 6', id: 'hr_41', time: '2024-11-20T16:10:00-04:00', beatsPerMinute: 140 },
    { source: 'Amazfit Bip 6', id: 'hr_42', time: '2024-11-20T16:11:00-04:00', beatsPerMinute: 135 },
    { source: 'Amazfit Bip 6', id: 'hr_43', time: '2024-11-20T16:12:00-04:00', beatsPerMinute: 130 },
    { source: 'Amazfit Bip 6', id: 'hr_44', time: '2024-11-20T16:13:00-04:00', beatsPerMinute: 125 },
    { source: 'Amazfit Bip 6', id: 'hr_45', time: '2024-11-20T16:14:00-04:00', beatsPerMinute: 120 },
    { source: 'Amazfit Bip 6', id: 'hr_46', time: '2024-11-20T16:15:00-04:00', beatsPerMinute: 115 },
    { source: 'Amazfit Bip 6', id: 'hr_47', time: '2024-11-20T16:16:00-04:00', beatsPerMinute: 110 },
    { source: 'Amazfit Bip 6', id: 'hr_48', time: '2024-11-20T16:17:00-04:00', beatsPerMinute: 105 },
    { source: 'Amazfit Bip 6', id: 'hr_49', time: '2024-11-20T16:18:00-04:00', beatsPerMinute: 100 },
    { source: 'Amazfit Bip 6', id: 'hr_50', time: '2024-11-20T16:19:00-04:00', beatsPerMinute: 95 },
    { source: 'Amazfit Bip 6', id: 'hr_51', time: '2024-11-20T16:20:00-04:00', beatsPerMinute: 92 },
    { source: 'Amazfit Bip 6', id: 'hr_52', time: '2024-11-20T16:21:00-04:00', beatsPerMinute: 90 },
    { source: 'Amazfit Bip 6', id: 'hr_53', time: '2024-11-20T16:22:00-04:00', beatsPerMinute: 88 },
    { source: 'Amazfit Bip 6', id: 'hr_54', time: '2024-11-20T16:23:00-04:00', beatsPerMinute: 85 },
    { source: 'Amazfit Bip 6', id: 'hr_55', time: '2024-11-20T16:24:00-04:00', beatsPerMinute: 82 },
    { source: 'Amazfit Bip 6', id: 'hr_56', time: '2024-11-20T16:25:00-04:00', beatsPerMinute: 80 },
    { source: 'Amazfit Bip 6', id: 'hr_57', time: '2024-11-20T16:26:00-04:00', beatsPerMinute: 78 },
    { source: 'Amazfit Bip 6', id: 'hr_58', time: '2024-11-20T16:27:00-04:00', beatsPerMinute: 76 },
    { source: 'Amazfit Bip 6', id: 'hr_59', time: '2024-11-20T16:28:00-04:00', beatsPerMinute: 74 },
    { source: 'Amazfit Bip 6', id: 'hr_60', time: '2024-11-20T16:29:00-04:00', beatsPerMinute: 72 },
  ],
  nextPageToken: null,
};

const FIXTURE_EXERCISE_EVENTS_RESPONSE: GHealthExerciseEventsResponse = {
  rollupDataPoints: [
    {
      // Pause at 10:10, Resume at 10:12 (2 min pause)
      start: '2024-11-20T10:10:00-04:00',
      end: '2024-11-20T10:12:00-04:00',
      type: 'PAUSE',
    },
    {
      start: '2024-11-20T10:12:00-04:00',
      end: '2024-11-20T10:12:00-04:00',
      type: 'RESUME',
    },
    // No pauses in session 2
  ],
  nextPageToken: null,
};

// Profile for Karvonen: 30yo male, RHR 55
const TEST_PROFILE = {
  age: 30,
  restingHR: 55,
  maxHR: 187, // Tanaka: 208 - 0.7*30 = 187
  biologicalSex: 'male' as const,
  heightM: 1.75,
};

describe('ETL Transformers - Exercise + HR Zones', () => {
  let exercises: ReturnType<typeof parseExerciseSessions>;
  let hrSamples: ReturnType<typeof parseHrSamples>;
  let events: ReturnType<typeof parseExerciseEvents>;

  beforeEach(() => {
    exercises = parseExerciseSessions(FIXTURE_EXERCISE_LIST_RESPONSE);
    hrSamples = parseHrSamples(FIXTURE_HR_LIST_RESPONSE);
    events = parseExerciseEvents(FIXTURE_EXERCISE_EVENTS_RESPONSE);
  });

  describe('parseExerciseSessions', () => {
    it('parses exercise sessions from ghealth SIMPLIFIED JSON response', () => {
      expect(exercises).toHaveLength(2);
      expect(exercises[0].name).toBe('Running');
      expect(exercises[1].name).toBe('Strength Training');
    });

    it('converts ISO 8601 timestamps to milliseconds', () => {
      // 2024-11-20T10:00:00-04:00 = 1732111200000
      // 2024-11-20T10:30:00-04:00 = 1732113000000
      expect(typeof exercises[0].startTimeMillis).toBe('number');
      expect(exercises[0].startTimeMillis).toBe(1732111200000);
      expect(exercises[0].endTimeMillis).toBe(1732113000000);
    });

    it('parses numeric fields as numbers', () => {
      expect(typeof exercises[0].averageHeartRateBeatsPerMinute).toBe('number');
      expect(exercises[0].averageHeartRateBeatsPerMinute).toBe(145);
      expect(typeof exercises[0].caloriesBurned).toBe('number');
      expect(exercises[0].caloriesBurned).toBe(320);
    });

    it('computes durationMin from timestamps', () => {
      expect(exercises[0].durationMin).toBe(30);
      expect(exercises[1].durationMin).toBe(30);
    });

    it('handles missing optional fields', () => {
      const response: GHealthExerciseListResponse = {
        dataPoints: [{ source: 'test', id: '1', start: '2024-11-20T10:00:00-04:00', end: '2024-11-20T10:30:00-04:00', type: 'RUNNING', name: 'Run', caloriesKcal: 0, averageHeartRateBeatsPerMinute: 0, maxHeartRateBeatsPerMinute: 0 }],
        nextPageToken: null,
      };
      const parsed = parseExerciseSessions(response);
      expect(parsed[0].averageHeartRateBeatsPerMinute).toBe(0);
      expect(parsed[0].caloriesBurned).toBe(0);
    });
  });

  describe('parseHrSamples', () => {
    it('parses HR samples from ghealth SIMPLIFIED JSON response', () => {
      expect(hrSamples).toHaveLength(60); // 30 + 30 samples
    });

    it('converts ISO 8601 time to milliseconds', () => {
      expect(typeof hrSamples[0].startTimeMillis).toBe('number');
      expect(hrSamples[0].startTimeMillis).toBe(1732111200000);
    });

    it('parses beatsPerMinute as number', () => {
      expect(typeof hrSamples[0].bpm).toBe('number');
      expect(hrSamples[0].bpm).toBe(130);
    });
  });

  describe('parseExerciseEvents', () => {
    it('parses PAUSE and RESUME events from rollupDataPoints', () => {
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('PAUSE');
      expect(events[1].type).toBe('RESUME');
    });

    it('converts ISO 8601 timestamps to milliseconds', () => {
      // 2024-11-20T10:10:00-04:00 = 1732111800000
      // 2024-11-20T10:12:00-04:00 = 1732111920000
      expect(typeof events[0].startTimeMillis).toBe('number');
      expect(events[0].startTimeMillis).toBe(1732111800000);
      expect(events[0].endTimeMillis).toBe(1732111920000);
    });
  });

  describe('filterHrDuringExercise', () => {
    it('filters HR samples to exercise session window', () => {
      const session1 = exercises[0];
      const filtered = filterHrDuringExercise(hrSamples, session1, events);

      // Session 1: 10:00-10:30 (30 min), but 2 min pause (10:10-10:12)
      // Should have 28 minutes of HR data (excluding pause)
      expect(filtered.length).toBe(28); // 30 min - 2 min pause
    });

    it('excludes HR during PAUSE intervals', () => {
      const session1 = exercises[0];
      const filtered = filterHrDuringExercise(hrSamples, session1, events);

      // Pause: 1732111800000 to 1732111920000 (2 min = 120 sec)
      // These samples should be excluded
      const pauseSamples = filtered.filter(s =>
        s.startTimeMillis >= 1732111800000 && s.startTimeMillis < 1732111920000
      );
      expect(pauseSamples).toHaveLength(0);
    });

    it('includes all HR when no events', () => {
      const session2 = exercises[1];
      const filtered = filterHrDuringExercise(hrSamples, session2, []);

      expect(filtered.length).toBe(30); // 30 min, no pauses
    });

    it('handles multiple pause/resume pairs', () => {
      // Session2 starts at 16:00 (1732132800000), add pause at 16:10-16:12
      const multiPauseEvents = [
        ...events,
        { startTimeMillis: 1732133400000, endTimeMillis: 1732133520000, type: 'PAUSE' as const },
        { startTimeMillis: 1732133520000, endTimeMillis: 1732133520000, type: 'RESUME' as const },
      ];
      const session2 = exercises[1];
      const filtered = filterHrDuringExercise(hrSamples, session2, multiPauseEvents);
      expect(filtered.length).toBe(28); // 30 - 2 min pause
    });
  });

  describe('classifyHrZonesKarvonen', () => {
    it('classifies HR into Z1-Z5 using Karvonen %HRR', () => {
      const session1 = exercises[0];
      const filteredHr = filterHrDuringExercise(hrSamples, session1, events);
      const zones = classifyHrZonesKarvonen(filteredHr, TEST_PROFILE);

      // HRR = maxHR - restingHR = 187 - 55 = 132
      // Z1: 50-60% HRR = 121-134 bpm
      // Z2: 60-70% HRR = 134-147 bpm
      // Z3: 70-80% HRR = 147-161 bpm
      // Z4: 80-90% HRR = 161-174 bpm
      // Z5: 90-100% HRR = 174-187 bpm

      expect(zones.z1).toBeGreaterThan(0);
      expect(zones.z2).toBeGreaterThan(0);
      expect(zones.z3).toBeGreaterThan(0);
      expect(zones.z4).toBeGreaterThan(0);
      expect(zones.z5).toBeGreaterThanOrEqual(0);
      expect(zones.real).toBe(true);
    });

    it('Z1: 50-60% HRR (uses real minutes from 5-sec intervals)', () => {
      // 12 samples * 5 sec = 60 sec = 1 min in Z1
      const hrSamples = [];
      const baseTime = 1000000;
      for (let i = 0; i < 12; i++) {
        hrSamples.push({ startTimeMillis: baseTime + i * 5000, endTimeMillis: baseTime + i * 5000, bpm: 125 }); // Z1
      }
      const zones = classifyHrZonesKarvonen(hrSamples, TEST_PROFILE);
      expect(zones.z1).toBeCloseTo(1.0, 1);
    });

    it('Z2: 60-70% HRR (uses real minutes from 5-sec intervals)', () => {
      const hrSamples = [];
      const baseTime = 1000000;
      for (let i = 0; i < 12; i++) {
        hrSamples.push({ startTimeMillis: baseTime + i * 5000, endTimeMillis: baseTime + i * 5000, bpm: 135 }); // Z2
      }
      const zones = classifyHrZonesKarvonen(hrSamples, TEST_PROFILE);
      expect(zones.z2).toBeCloseTo(1.0, 1);
    });

    it('Z3: 70-80% HRR (uses real minutes from 5-sec intervals)', () => {
      const hrSamples = [];
      const baseTime = 1000000;
      for (let i = 0; i < 12; i++) {
        hrSamples.push({ startTimeMillis: baseTime + i * 5000, endTimeMillis: baseTime + i * 5000, bpm: 150 }); // Z3
      }
      const zones = classifyHrZonesKarvonen(hrSamples, TEST_PROFILE);
      expect(zones.z3).toBeCloseTo(1.0, 1);
    });

    it('Z4: 80-90% HRR (uses real minutes from 5-sec intervals)', () => {
      const hrSamples = [];
      const baseTime = 1000000;
      for (let i = 0; i < 12; i++) {
        hrSamples.push({ startTimeMillis: baseTime + i * 5000, endTimeMillis: baseTime + i * 5000, bpm: 165 }); // Z4
      }
      const zones = classifyHrZonesKarvonen(hrSamples, TEST_PROFILE);
      expect(zones.z4).toBeCloseTo(1.0, 1);
    });

    it('Z5: 90-100% HRR (uses real minutes from 5-sec intervals)', () => {
      const hrSamples = [];
      const baseTime = 1000000;
      for (let i = 0; i < 12; i++) {
        hrSamples.push({ startTimeMillis: baseTime + i * 5000, endTimeMillis: baseTime + i * 5000, bpm: 180 }); // Z5
      }
      const zones = classifyHrZonesKarvonen(hrSamples, TEST_PROFILE);
      expect(zones.z5).toBeCloseTo(1.0, 1);
    });

    it('handles HR below Z1 (counts as Z1) (uses real minutes from 5-sec intervals)', () => {
      const hrSamples = [];
      const baseTime = 1000000;
      for (let i = 0; i < 12; i++) {
        hrSamples.push({ startTimeMillis: baseTime + i * 5000, endTimeMillis: baseTime + i * 5000, bpm: 80 }); // Below Z1
      }
      const zones = classifyHrZonesKarvonen(hrSamples, TEST_PROFILE);
      expect(zones.z1).toBeCloseTo(1.0, 1);
    });

    it('handles HR above max (counts as Z5) (uses real minutes from 5-sec intervals)', () => {
      const hrSamples = [];
      const baseTime = 1000000;
      for (let i = 0; i < 12; i++) {
        hrSamples.push({ startTimeMillis: baseTime + i * 5000, endTimeMillis: baseTime + i * 5000, bpm: 200 }); // Above max
      }
      const zones = classifyHrZonesKarvonen(hrSamples, TEST_PROFILE);
      expect(zones.z5).toBeCloseTo(1.0, 1);
    });

    it('calculates REAL minutes from 5-second sample intervals (NEW: 5-sec sample fix)', () => {
      // Create samples every 5 seconds for 1 minute (12 samples = 1 minute)
      const hrSamples = [];
      const baseTime = 1000000;
      for (let i = 0; i < 12; i++) {
        hrSamples.push({
          startTimeMillis: baseTime + i * 5000, // 5 seconds apart
          endTimeMillis: baseTime + i * 5000,
          bpm: 150, // Z3
        });
      }
      const zones = classifyHrZonesKarvonen(hrSamples, TEST_PROFILE);

      // 12 samples * 5 sec = 60 sec = 1 minute in Z3
      expect(zones.z3).toBeCloseTo(1.0, 1);
      expect(zones.z1 + zones.z2 + zones.z3 + zones.z4 + zones.z5).toBeCloseTo(1.0, 1);
    });

    it('handles 5-second samples spanning multiple zones (NEW: 5-sec sample fix)', () => {
      // 10 samples at 5 sec each = 50 seconds
      // First 5 at Z1 (125 bpm), next 5 at Z3 (150 bpm)
      const hrSamples = [];
      const baseTime = 1000000;
      for (let i = 0; i < 5; i++) {
        hrSamples.push({ startTimeMillis: baseTime + i * 5000, endTimeMillis: baseTime + i * 5000, bpm: 125 }); // Z1
      }
      for (let i = 5; i < 10; i++) {
        hrSamples.push({ startTimeMillis: baseTime + i * 5000, endTimeMillis: baseTime + i * 5000, bpm: 150 }); // Z3
      }
      const zones = classifyHrZonesKarvonen(hrSamples, TEST_PROFILE);

      // 5 * 5sec = 25sec = 0.416... min in Z1
      // 5 * 5sec = 25sec = 0.416... min in Z3
      expect(zones.z1).toBeCloseTo(0.4, 1);
      expect(zones.z3).toBeCloseTo(0.4, 1);
      expect(zones.z1 + zones.z3).toBeCloseTo(0.8, 1);
    });

    it('handles single sample with default 5-second duration (NEW: 5-sec sample fix)', () => {
      const hrSamples = [
        { startTimeMillis: 1000000, endTimeMillis: 1000000, bpm: 150 }, // Z3
      ];
      const zones = classifyHrZonesKarvonen(hrSamples, TEST_PROFILE);

      // Single sample defaults to 5 seconds = 0.0833 min, rounds to 0.1
      expect(zones.z3).toBeCloseTo(0.1, 1);
    });

    it('caps duration at 1 minute for large gaps between samples (NEW: 5-sec sample fix)', () => {
      // Two samples 5 minutes apart (should cap at 1 min each)
      const hrSamples = [
        { startTimeMillis: 1000000, endTimeMillis: 1000000, bpm: 150 }, // Z3
        { startTimeMillis: 1000000 + 5 * 60000, endTimeMillis: 1000000 + 5 * 60000, bpm: 150 }, // Z3
      ];
      const zones = classifyHrZonesKarvonen(hrSamples, TEST_PROFILE);

      // First sample: 1 min (capped), second sample: 1 min (capped)
      expect(zones.z3).toBeCloseTo(2.0, 1);
    });

    it('rounds zone minutes to 1 decimal place (NEW: 5-sec sample fix)', () => {
      const hrSamples = [];
      const baseTime = 1000000;
      // 3 samples at 5 sec = 15 sec = 0.25 min
      for (let i = 0; i < 3; i++) {
        hrSamples.push({ startTimeMillis: baseTime + i * 5000, endTimeMillis: baseTime + i * 5000, bpm: 150 }); // Z3
      }
      const zones = classifyHrZonesKarvonen(hrSamples, TEST_PROFILE);

      // 0.25 rounded to 1 decimal = 0.3
      expect(zones.z3).toBe(0.3);
    });
  });

  describe('computeExerciseMetrics', () => {
    it('produces complete ExerciseTransformerOutput', () => {
      const session1 = exercises[0];
      const filteredHr = filterHrDuringExercise(hrSamples, session1, events);
      const zones = classifyHrZonesKarvonen(filteredHr, TEST_PROFILE);

      const output: ExerciseTransformerOutput = {
        ...computeExerciseMetrics(session1, filteredHr, zones),
        zones,
      };

      expect(output.duration_min).toBe(30);
      expect(output.zones.real).toBe(true);
      // Zone sum is now real minutes (not sample count) - ~28 minutes of actual exercise time
      const zoneSum = output.zones.z1 + output.zones.z2 + output.zones.z3 + output.zones.z4 + output.zones.z5;
      expect(zoneSum).toBeGreaterThan(20);
      expect(zoneSum).toBeLessThan(30);
      expect(output.avg_hr).toBeCloseTo(125, 0); // average of filtered samples
      expect(output.max_hr).toBe(168);
    });

    it('computes kcal from ghealth caloriesKcal when available', () => {
      const session = exercises[0];
      const output = computeExerciseMetrics(session, [], { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, real: false });
      expect(output.kcal).toBe(320);
    });

    it('estimates kcal from HR when ghealth calories missing', () => {
      const session = { ...exercises[0], caloriesBurned: 0, averageHeartRateBeatsPerMinute: 145 };
      const filteredHr = [{ bpm: 145, startTimeMillis: 0, endTimeMillis: 60000 }] as any;
      const output = computeExerciseMetrics(session, filteredHr, { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, real: true });
      expect(output.kcal).toBeGreaterThan(0);
    });
  });
});