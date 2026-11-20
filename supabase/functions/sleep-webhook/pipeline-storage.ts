/**
 * Storage functions for sleep staging results.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import type {
  SleepSegmentation,
  CardioEpochFeatures,
  SleepNightObservation,
  SleepUserProfile,
} from './models.ts';
import { upsertUserProfile } from './pipeline-profile.ts';

/**
 * Store sleep staging results in Supabase.
 */
export async function storeResults(
  supabase: SupabaseClient,
  userId: string,
  logDate: string,
  segmentation: SleepSegmentation,
  features: CardioEpochFeatures[],
  observation: SleepNightObservation | null,
  updatedProfile: SleepUserProfile | null,
): Promise<boolean> {
  try {
    // 1. Store segmentation
    const segData = {
      user_id: userId,
      log_date: logDate,
      session_start: new Date(segmentation.inBedStartS * 1000).toISOString(),
      session_end: new Date(segmentation.inBedEndS * 1000).toISOString(),
      sleep_onset: segmentation.sleepOnsetS
        ? new Date(segmentation.sleepOnsetS * 1000).toISOString()
        : null,
      sleep_offset: segmentation.sleepOffsetS
        ? new Date(segmentation.sleepOffsetS * 1000).toISOString()
        : null,
      epoch_sec: segmentation.epochSec,
      stages: segmentation.stages,
      deep_flags: segmentation.deepFlag,
      total_epochs: segmentation.stages.length,
      wake_pct: Math.round(
        (segmentation.stages.filter(s => s === 0).length / Math.max(1, segmentation.stages.length)) * 10000
      ) / 100,
      nrem_pct: Math.round(
        (segmentation.stages.filter(s => s === 1).length / Math.max(1, segmentation.stages.length)) * 10000
      ) / 100,
      rem_pct: Math.round(
        (segmentation.stages.filter(s => s === 2).length / Math.max(1, segmentation.stages.length)) * 10000
      ) / 100,
      deep_pct: Math.round(
        (segmentation.deepFlag.filter(Boolean).length / Math.max(1, segmentation.deepFlag.length)) * 10000
      ) / 100,
      unobserved_sec: segmentation.unobservedSec,
      confidence: segmentation.confidence,
      sleep_windows: [],
      config: { epoch_sec: segmentation.epochSec },
    };

    const { data: segResult, error: segError } = await supabase
      .from('sleep_segmentations')
      .insert(segData)
      .select('id')
      .single();

    if (segError || !segResult) {
      console.error('Segmentation insert error:', segError);
      return false;
    }
    const segmentationId = segResult.id;

    // 2. Store epoch features
    const epochData = features.map((feat, i) => ({
      segmentation_id: segmentationId,
      epoch_index: i,
      epoch_start: new Date(feat.epochStartS * 1000).toISOString(),
      enmo_median: feat.enmoMedian,
      enmo_p95: feat.enmoP95,
      still_frac: feat.stillFrac,
      immobile_frac: feat.immobileFrac,
      hr_median: feat.hrMedian ?? null,
      hr_p5: feat.hrP5 ?? null,
      hr_p25: feat.hrP25 ?? null,
      valid_hr_frac: feat.validHrFrac,
      rmssd_ms: feat.rmssd ?? null,
      lfhf_ratio: feat.lfhf ?? null,
      rk_bpm: feat.rk ?? null,
      valid_rr_frac: feat.validRrFrac,
      stage: segmentation.stages[i] ?? 0,
      deep_flag: segmentation.deepFlag[i] ?? false,
    }));

    if (epochData.length > 0) {
      const { error: epochError } = await supabase
        .from('sleep_epoch_features')
        .insert(epochData);
      if (epochError) {
        console.error('Epoch features insert error:', epochError);
        return false;
      }
    }

    // 3. Store observation
    if (observation) {
      const obsData = {
        user_id: userId,
        segmentation_id: segmentationId,
        log_date: logDate,
        hr_floor_p5: observation.hrFloorP5 ?? null,
        hr_floor_p25: observation.hrFloorP25 ?? null,
        hr_sleep_median: observation.hrSleepMedian ?? null,
        hr_arousal: observation.hrArousal ?? null,
        rmssd_med_ms: observation.rmssdMed ?? null,
        rmssd_mad_ms: observation.rmssdMad ?? null,
        enmo_still_cut_g: observation.enmoStillCut ?? null,
        enmo_move_cut_g: observation.enmoMoveCut ?? null,
        lfhf_med: observation.lfhfMed ?? null,
        rk_med_bpm: observation.rkMed ?? null,
      };

      const { error: obsError } = await supabase
        .from('sleep_night_observations')
        .insert(obsData);
      if (obsError) {
        console.error('Observation insert error:', obsError);
        return false;
      }
    }

    // 4. Update profile
    if (updatedProfile) {
      await upsertUserProfile(supabase, userId, updatedProfile);
    }

    return true;
  } catch (e) {
    console.error('Error storing results:', e);
    return false;
  }
}