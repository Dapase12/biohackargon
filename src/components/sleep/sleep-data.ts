/**
 * ARGON v6.0 — Sleep Data Loading Component
 * Handles fetching sleep data from Supabase.
 * Import from: import { loadSleepData } from '@/components/sleep/sleep-data';
 */

import { todayIso } from '@/utils/date';
import {
  sbGetSleepSegmentations,
  sbGetSleepEpochs,
  sbGetNightObservations,
  sbGetSleepProfile,
  sbGetSleepDailyScores,
} from '@/api/client';
import { config } from '@/config';
import type { SleepSegmentation, SleepEpochFeature, SleepNightObservation, SleepUserProfile, ComputedDailyScore } from '@/api/schemas';

export interface SleepState {
  userId: string | null;
  segmentations: SleepSegmentation[];
  epochFeatures: SleepEpochFeature[];
  nightObservations: SleepNightObservation[];
  userProfile: SleepUserProfile | null;
  dailyScores: ComputedDailyScore[];
  selectedDate: string | null;
}

const state: SleepState = {
  userId: null,
  segmentations: [],
  epochFeatures: [],
  nightObservations: [],
  userProfile: null,
  dailyScores: [],
  selectedDate: null,
};

export function getSleepState(): SleepState {
  return state;
}

export function setSelectedDate(date: string): void {
  state.selectedDate = date;
}

export function getSelectedDate(): string | null {
  return state.selectedDate;
}

/**
 * Load all sleep data for a given date
 */
export async function loadSleepData(targetDate?: string): Promise<void> {
  const { supabase } = config;
  if (!supabase.key) return;

  const userId = config.userId;
  if (!userId) {
    // showToast will be available from main app
    if (typeof window !== 'undefined' && (window as any).showToast) {
      (window as any).showToast('Configura User ID en Ajustes');
    }
    return;
  }
  state.userId = userId;

  try {
    const dateStr = targetDate || todayIso();

    // 1. Sleep segmentations (last 30 days)
    state.segmentations = await sbGetSleepSegmentations(30);

    // 2. Epoch features for selected date's segmentation
    const todaySeg = state.segmentations.find(s => s.log_date === dateStr);
    if (todaySeg) {
      state.epochFeatures = await sbGetSleepEpochs(todaySeg.id);
    }

    // 3. Night observations (last 30 days)
    state.nightObservations = await sbGetNightObservations(30);

    // 4. User profile
    state.userProfile = await sbGetSleepProfile();

    // 5. Daily sleep scores (from view)
    state.dailyScores = await sbGetSleepDailyScores(30);

    state.selectedDate = dateStr;
  } catch (e) {
    console.error('Error loading sleep data:', e);
    if (typeof window !== 'undefined' && (window as any).showToast) {
      (window as any).showToast('Error cargando datos de sueño: ' + (e instanceof Error ? e.message : String(e)));
    }
  }
}

/**
 * Get today's segmentation
 */
export function getTodaySegmentation(): SleepSegmentation | undefined {
  if (!state.selectedDate) return undefined;
  return state.segmentations.find(s => s.log_date === state.selectedDate);
}

/**
 * Get today's daily score
 */
export function getTodayDailyScore(): ComputedDailyScore | undefined {
  if (!state.selectedDate) return undefined;
  return state.dailyScores.find(d => d.log_date === state.selectedDate);
}

/**
 * Get today's night observation
 */
export function getTodayNightObservation(): SleepNightObservation | undefined {
  if (!state.selectedDate) return undefined;
  return state.nightObservations.find(o => o.log_date === state.selectedDate);
}