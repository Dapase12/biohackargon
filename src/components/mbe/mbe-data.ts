/**
 * ARGON v6.0 — MBE Data Loading Component
 * Handles fetching MBE data from Supabase.
 * Import from: import { loadMbeData, getMbeState } from '@/components/mbe/mbe-data';
 */

import { todayIso } from '@/utils/date';
import {
  sbGetComputedDailyScores,
  sbGetRawBiometrics,
} from '@/api/client';
import { config } from '@/config';
import type { ComputedDailyScore, RawBiometric } from '@/api/schemas';

export interface MbeState {
  raw: RawBiometric[];
  comp: ComputedDailyScore[];
  selectedDate: string | null;
}

const state: MbeState = {
  raw: [],
  comp: [],
  selectedDate: null,
};

export function getMbeState(): MbeState {
  return state;
}

export function setSelectedDate(date: string): void {
  state.selectedDate = date;
}

/**
 * Load MBE data for a given date
 */
export async function loadMbeData(dateStr?: string): Promise<void> {
  if (dateStr) state.selectedDate = dateStr;
  const target = state.selectedDate || todayIso();
  try {
    const [raw, comp] = await Promise.all([
      sbGetRawBiometrics(1).then(arr => arr.filter(r => r.log_date === target)),
      sbGetComputedDailyScores(1).then(arr => arr.filter(c => c.log_date === target)),
    ]);
    // Para histórico: también traer rango para sparklines/medias
    const [rawHist, compHist] = await Promise.all([
      sbGetRawBiometrics(30),
      sbGetComputedDailyScores(30),
    ]);
    state.raw = [raw[0], ...rawHist.slice(1)].filter(Boolean);
    state.comp = [comp[0], ...compHist.slice(1)].filter(Boolean);
  } catch (e) {
    console.error('Error loading MBE data:', e);
    throw e;
  }
}