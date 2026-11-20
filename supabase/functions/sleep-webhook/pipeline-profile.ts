/**
 * User profile management for sleep staging.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import type { SleepUserProfile } from './models.ts';
import { createSleepUserProfile, sleepUserProfileFromJson } from './models.ts';

/**
 * Get or create user sleep profile from Supabase.
 */
export async function getUserProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<SleepUserProfile> {
  const { data, error } = await supabase
    .from('sleep_user_profiles')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    return createSleepUserProfile({ nights: 0 });
  }

  // Parse updated_at to milliseconds
  let updatedAtMs = 0;
  if (data.updated_at) {
    try {
      updatedAtMs = new Date(data.updated_at).getTime();
    } catch {
      updatedAtMs = 0;
    }
  }

  return sleepUserProfileFromJson({
    nights: data.nights ?? 0,
    hr_floor_p5: data.hr_floor_p5 ?? undefined,
    hr_floor_p25: data.hr_floor_p25 ?? undefined,
    hr_sleep_median: data.hr_sleep_median ?? undefined,
    hr_arousal: data.hr_arousal ?? undefined,
    rmssd_med: data.rmssd_med_ms ?? undefined,
    rmssd_mad: data.rmssd_mad_ms ?? undefined,
    enmo_still_cut: data.enmo_still_cut_g ?? undefined,
    enmo_move_cut: data.enmo_move_cut_g ?? undefined,
    lfhf_med: data.lfhf_med ?? undefined,
    rk_med: data.rk_med_bpm ?? undefined,
    updated_at_ms: updatedAtMs,
  });
}

/**
 * Upsert user sleep profile to Supabase.
 */
export async function upsertUserProfile(
  supabase: SupabaseClient,
  userId: string,
  profile: SleepUserProfile,
): Promise<boolean> {
  const profileJson = profile.toJson();
  const data = {
    user_id: userId,
    nights: profile.nights,
    hr_floor_p5: profileJson.hr_floor_p5 ?? null,
    hr_floor_p25: profileJson.hr_floor_p25 ?? null,
    hr_sleep_median: profileJson.hr_sleep_median ?? null,
    hr_arousal: profileJson.hr_arousal ?? null,
    rmssd_med_ms: profileJson.rmssd_med ?? null,
    rmssd_mad_ms: profileJson.rmssd_mad ?? null,
    enmo_still_cut_g: profileJson.enmo_still_cut ?? null,
    enmo_move_cut_g: profileJson.enmo_move_cut ?? null,
    lfhf_med: profileJson.lfhf_med ?? null,
    rk_med_bpm: profileJson.rk_med ?? null,
    personal_weight: profile.personalWeight,
    updated_at: new Date().toISOString(),
  };

  try {
    const { error } = await supabase.from('sleep_user_profiles').upsert(data).select().single();
    return !error;
  } catch {
    return false;
  }
}