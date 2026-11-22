/**
 * ARGON v7.0 — Exercise + HR Zones Transformer Unit Tests (TDD: RED phase)
 * Tests for parsing ghealth exercise sessions, minute HR, pause/resume events,
 * Karvonen %HRR zone classification.
 * Based on real ghealth payloads.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type {
  GHealthExerciseSession,
  GHealthHrSample,
  GHealthExerciseEvent,
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
// REAL GHEALTH PAYLOAD FIXTURES
// ========================================================================

const FIXTURE_EXERCISE_LIST_RESPONSE = {
  dataPoints: [
    {
      // Session 1: Running 30 min
      startTimeMillis: "1732110000000", // 2024-11-20 10:00:00 -04:00
      endTimeMillis: "1732111800000",   // 2024-11-20 10:30:00 -04:00
      name: "Running",
      type: "RUNNING",
      averageHeartRateBeatsPerMinute: "145",
      maxHeartRateBeatsPerMinute: "168",
      caloriesBurned: "320",
    },
    {
      // Session 2: Strength training 45 min
      startTimeMillis: "1732128000000", // 2024-11-20 16:00:00 -04:00
      endTimeMillis: "1732129800000",   // 2024-11-20 16:30:00 -04:00
      name: "Strength Training",
      type: "STRENGTH_TRAINING",
      averageHeartRateBeatsPerMinute: "120",
      maxHeartRateBeatsPerMinute: "142",
      caloriesBurned: "250",
    },
  ],
  nextPageToken: null,
};

const FIXTURE_HR_LIST_RESPONSE = {
  dataPoints: [
    // Session 1 HR samples (10:00-10:30)
    { startTimeMillis: "1732110000000", endTimeMillis: "1732110060000", beatsPerMinute: "130" },
    { startTimeMillis: "1732110060000", endTimeMillis: "1732110120000", beatsPerMinute: "135" },
    { startTimeMillis: "1732110120000", endTimeMillis: "1732110180000", beatsPerMinute: "140" },
    { startTimeMillis: "1732110180000", endTimeMillis: "1732110240000", beatsPerMinute: "145" },
    { startTimeMillis: "1732110240000", endTimeMillis: "1732110300000", beatsPerMinute: "150" },
    { startTimeMillis: "1732110300000", endTimeMillis: "1732110360000", beatsPerMinute: "155" },
    { startTimeMillis: "1732110360000", endTimeMillis: "1732110420000", beatsPerMinute: "160" },
    { startTimeMillis: "1732110420000", endTimeMillis: "1732110480000", beatsPerMinute: "165" },
    { startTimeMillis: "1732110480000", endTimeMillis: "1732110540000", beatsPerMinute: "168" },
    { startTimeMillis: "1732110540000", endTimeMillis: "1732110600000", beatsPerMinute: "165" },
    { startTimeMillis: "1732110600000", endTimeMillis: "1732110660000", beatsPerMinute: "160" },
    { startTimeMillis: "1732110660000", endTimeMillis: "1732110720000", beatsPerMinute: "155" },
    { startTimeMillis: "1732110720000", endTimeMillis: "1732110780000", beatsPerMinute: "150" },
    { startTimeMillis: "1732110780000", endTimeMillis: "1732110840000", beatsPerMinute: "145" },
    { startTimeMillis: "1732110840000", endTimeMillis: "1732110900000", beatsPerMinute: "140" },
    { startTimeMillis: "1732110900000", endTimeMillis: "1732110960000", beatsPerMinute: "135" },
    { startTimeMillis: "1732110960000", endTimeMillis: "1732111020000", beatsPerMinute: "130" },
    { startTimeMillis: "1732111020000", endTimeMillis: "1732111080000", beatsPerMinute: "125" },
    { startTimeMillis: "1732111080000", endTimeMillis: "1732111140000", beatsPerMinute: "120" },
    { startTimeMillis: "1732111140000", endTimeMillis: "1732111200000", beatsPerMinute: "115" },
    { startTimeMillis: "1732111200000", endTimeMillis: "1732111260000", beatsPerMinute: "110" },
    { startTimeMillis: "1732111260000", endTimeMillis: "1732111320000", beatsPerMinute: "105" },
    { startTimeMillis: "1732111320000", endTimeMillis: "1732111380000", beatsPerMinute: "100" },
    { startTimeMillis: "1732111380000", endTimeMillis: "1732111440000", beatsPerMinute: "95" },
    { startTimeMillis: "1732111440000", endTimeMillis: "1732111500000", beatsPerMinute: "90" },
    { startTimeMillis: "1732111500000", endTimeMillis: "1732111560000", beatsPerMinute: "88" },
    { startTimeMillis: "1732111560000", endTimeMillis: "1732111620000", beatsPerMinute: "85" },
    { startTimeMillis: "1732111620000", endTimeMillis: "1732111680000", beatsPerMinute: "82" },
    { startTimeMillis: "1732111680000", endTimeMillis: "1732111740000", beatsPerMinute: "80" },
    { startTimeMillis: "1732111740000", endTimeMillis: "1732111800000", beatsPerMinute: "78" },
    // Session 2 HR samples (16:00-16:30)
    { startTimeMillis: "1732128000000", endTimeMillis: "1732128060000", beatsPerMinute: "100" },
    { startTimeMillis: "1732128060000", endTimeMillis: "1732128120000", beatsPerMinute: "105" },
    { startTimeMillis: "1732128120000", endTimeMillis: "1732128180000", beatsPerMinute: "110" },
    { startTimeMillis: "1732128180000", endTimeMillis: "1732128240000", beatsPerMinute: "115" },
    { startTimeMillis: "1732128240000", endTimeMillis: "1732128300000", beatsPerMinute: "120" },
    { startTimeMillis: "1732128300000", endTimeMillis: "1732128360000", beatsPerMinute: "125" },
    { startTimeMillis: "1732128360000", endTimeMillis: "1732128420000", beatsPerMinute: "130" },
    { startTimeMillis: "1732128420000", endTimeMillis: "1732128480000", beatsPerMinute: "135" },
    { startTimeMillis: "1732128480000", endTimeMillis: "1732128540000", beatsPerMinute: "140" },
    { startTimeMillis: "1732128540000", endTimeMillis: "1732128600000", beatsPerMinute: "142" },
    { startTimeMillis: "1732128600000", endTimeMillis: "1732128660000", beatsPerMinute: "140" },
    { startTimeMillis: "1732128660000", endTimeMillis: "1732128720000", beatsPerMinute: "135" },
    { startTimeMillis: "1732128720000", endTimeMillis: "1732128780000", beatsPerMinute: "130" },
    { startTimeMillis: "1732128780000", endTimeMillis: "1732128840000", beatsPerMinute: "125" },
    { startTimeMillis: "1732128840000", endTimeMillis: "1732128900000", beatsPerMinute: "120" },
    { startTimeMillis: "1732128900000", endTimeMillis: "1732128960000", beatsPerMinute: "115" },
    { startTimeMillis: "1732128960000", endTimeMillis: "1732129020000", beatsPerMinute: "110" },
    { startTimeMillis: "1732129020000", endTimeMillis: "1732129080000", beatsPerMinute: "105" },
    { startTimeMillis: "1732129080000", endTimeMillis: "1732129140000", beatsPerMinute: "100" },
    { startTimeMillis: "1732129140000", endTimeMillis: "1732129200000", beatsPerMinute: "95" },
    { startTimeMillis: "1732129200000", endTimeMillis: "1732129260000", beatsPerMinute: "92" },
    { startTimeMillis: "1732129260000", endTimeMillis: "1732129320000", beatsPerMinute: "90" },
    { startTimeMillis: "1732129320000", endTimeMillis: "1732129380000", beatsPerMinute: "88" },
    { startTimeMillis: "1732129380000", endTimeMillis: "1732129440000", beatsPerMinute: "85" },
    { startTimeMillis: "1732129440000", endTimeMillis: "1732129500000", beatsPerMinute: "82" },
    { startTimeMillis: "1732129500000", endTimeMillis: "1732129560000", beatsPerMinute: "80" },
    { startTimeMillis: "1732129560000", endTimeMillis: "1732129620000", beatsPerMinute: "78" },
    { startTimeMillis: "1732129620000", endTimeMillis: "1732129680000", beatsPerMinute: "76" },
    { startTimeMillis: "1732129680000", endTimeMillis: "1732129740000", beatsPerMinute: "74" },
    { startTimeMillis: "1732129740000", endTimeMillis: "1732129800000", beatsPerMinute: "72" },
  ],
  nextPageToken: null,
};

const FIXTURE_EXERCISE_EVENTS_RESPONSE = {
  events: [
    {
      // Pause at 10:10, Resume at 10:12 (2 min pause)
      startTimeMillis: "1732110600000",
      endTimeMillis: "1732110720000",
      type: "PAUSE",
    },
    {
      startTimeMillis: "1732110720000",
      endTimeMillis: "1732110720000",
      type: "RESUME",
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
};

describe('ETL Transformers - Exercise + HR Zones', () => {
  let exercises: GHealthExerciseSession[];
  let hrSamples: GHealthHrSample[];
  let events: GHealthExerciseEvent[];

  beforeEach(() => {
    exercises = parseExerciseSessions(FIXTURE_EXERCISE_LIST_RESPONSE);
    hrSamples = parseHrSamples(FIXTURE_HR_LIST_RESPONSE);
    events = parseExerciseEvents(FIXTURE_EXERCISE_EVENTS_RESPONSE);
  });

  describe('parseExerciseSessions', () => {
    it('parses exercise sessions from ghealth response', () => {
      expect(exercises).toHaveLength(2);
      expect(exercises[0].name).toBe('Running');
      expect(exercises[1].name).toBe('Strength Training');
    });

    it('converts string numeric fields to numbers', () => {
      expect(typeof exercises[0].averageHeartRateBeatsPerMinute).toBe('number');
      expect(exercises[0].averageHeartRateBeatsPerMinute).toBe(145);
      expect(typeof exercises[0].caloriesBurned).toBe('number');
      expect(exercises[0].caloriesBurned).toBe(320);
    });

    it('converts timestamps to numbers', () => {
      expect(typeof exercises[0].startTimeMillis).toBe('number');
      expect(exercises[0].startTimeMillis).toBe(1732110000000);
    });

    it('handles missing optional fields', () => {
      const response = {
        dataPoints: [{ startTimeMillis: "1000", endTimeMillis: "2000" }],
        nextPageToken: null,
      };
      const parsed = parseExerciseSessions(response);
      expect(parsed[0].averageHeartRateBeatsPerMinute).toBeNull();
      expect(parsed[0].caloriesBurned).toBeNull();
    });
  });

  describe('parseHrSamples', () => {
    it('parses HR samples from ghealth response', () => {
      expect(hrSamples).toHaveLength(60); // 30 + 30 samples
    });

    it('converts beatsPerMinute string to number', () => {
      expect(typeof hrSamples[0].bpm).toBe('number');
      expect(hrSamples[0].bpm).toBe(130);
    });

    it('converts timestamps to numbers', () => {
      expect(typeof hrSamples[0].startTimeMillis).toBe('number');
    });
  });

  describe('parseExerciseEvents', () => {
    it('parses PAUSE and RESUME events', () => {
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('PAUSE');
      expect(events[1].type).toBe('RESUME');
    });

    it('converts timestamps to numbers', () => {
      expect(typeof events[0].startTimeMillis).toBe('number');
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

      // Pause: 1732110600000 to 1732110720000 (2 min = 120 sec)
      // These samples should be excluded
      const pauseSamples = filtered.filter(s =>
        s.startTimeMillis >= 1732110600000 && s.startTimeMillis < 1732110720000
      );
      expect(pauseSamples).toHaveLength(0);
    });

    it('includes all HR when no events', () => {
      const session2 = exercises[1];
      const filtered = filterHrDuringExercise(hrSamples, session2, []);

      expect(filtered.length).toBe(30); // 30 min, no pauses
    });

    it('handles multiple pause/resume pairs', () => {
      const multiPauseEvents = [
        ...events,
        { startTimeMillis: 1732128600000, endTimeMillis: 1732128720000, type: 'PAUSE' as const },
        { startTimeMillis: 1732128720000, endTimeMillis: 1732128720000, type: 'RESUME' as const },
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

    it('Z1: 50-60% HRR', () => {
      const hrSamples = [
        { startTimeMillis: 1000, endTimeMillis: 2000, bpm: 125 }, // Z1 (50% HRR = 121)
        { startTimeMillis: 2000, endTimeMillis: 3000, bpm: 130 }, // Z1
      ];
      const zones = classifyHrZonesKarvonen(hrSamples, TEST_PROFILE);
      expect(zones.z1).toBe(2);
    });

    it('Z2: 60-70% HRR', () => {
      const hrSamples = [
        { startTimeMillis: 1000, endTimeMillis: 2000, bpm: 135 }, // Z2 (60% HRR = 134)
        { startTimeMillis: 2000, endTimeMillis: 3000, bpm: 140 }, // Z2
      ];
      const zones = classifyHrZonesKarvonen(hrSamples, TEST_PROFILE);
      expect(zones.z2).toBe(2);
    });

    it('Z3: 70-80% HRR', () => {
      const hrSamples = [
        { startTimeMillis: 1000, endTimeMillis: 2000, bpm: 150 }, // Z3 (70% HRR = 147)
        { startTimeMillis: 2000, endTimeMillis: 3000, bpm: 155 }, // Z3
      ];
      const zones = classifyHrZonesKarvonen(hrSamples, TEST_PROFILE);
      expect(zones.z3).toBe(2);
    });

    it('Z4: 80-90% HRR', () => {
      const hrSamples = [
        { startTimeMillis: 1000, endTimeMillis: 2000, bpm: 165 }, // Z4 (80% HRR = 161)
        { startTimeMillis: 2000, endTimeMillis: 3000, bpm: 170 }, // Z4
      ];
      const zones = classifyHrZonesKarvonen(hrSamples, TEST_PROFILE);
      expect(zones.z4).toBe(2);
    });

    it('Z5: 90-100% HRR', () => {
      const hrSamples = [
        { startTimeMillis: 1000, endTimeMillis: 2000, bpm: 180 }, // Z5 (90% HRR = 174)
      ];
      const zones = classifyHrZonesKarvonen(hrSamples, TEST_PROFILE);
      expect(zones.z5).toBe(1);
    });

    it('handles HR below Z1 (counts as Z1)', () => {
      const hrSamples = [
        { startTimeMillis: 1000, endTimeMillis: 2000, bpm: 80 }, // Below Z1
      ];
      const zones = classifyHrZonesKarvonen(hrSamples, TEST_PROFILE);
      expect(zones.z1).toBe(1);
    });

    it('handles HR above max (counts as Z5)', () => {
      const hrSamples = [
        { startTimeMillis: 1000, endTimeMillis: 2000, bpm: 200 }, // Above max
      ];
      const zones = classifyHrZonesKarvonen(hrSamples, TEST_PROFILE);
      expect(zones.z5).toBe(1);
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
      expect(output.zones.z1 + output.zones.z2 + output.zones.z3 + output.zones.z4 + output.zones.z5).toBe(28); // 30 - 2 pause
      expect(output.avg_hr).toBeCloseTo(125, 0); // average of filtered samples (28 min after pause removal)
      expect(output.max_hr).toBe(168);
    });

    it('computes kcal from ghealth caloriesBurned when available', () => {
      const session = exercises[0];
      const output = computeExerciseMetrics(session, [], { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, real: false });
      expect(output.kcal).toBe(320);
    });

    it('estimates kcal from HR when ghealth calories missing', () => {
      const session = { ...exercises[0], caloriesBurned: null, averageHeartRateBeatsPerMinute: 145 };
      const filteredHr = [{ bpm: 145, startTimeMillis: 0, endTimeMillis: 60000 }] as any;
      const output = computeExerciseMetrics(session, filteredHr, { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, real: true });
      expect(output.kcal).toBeGreaterThan(0);
    });
  });
});