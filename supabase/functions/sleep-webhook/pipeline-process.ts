/**
 * Main sleep data processing pipeline.
 */

import type {
  RawSleepData,
  SleepUserProfile,
  SleepSegmentation,
  CardioEpochFeatures,
  SleepNightObservation,
  PipelineResult,
  AdvancedSleepStager,
} from './models.ts';
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getUserProfile } from './pipeline-profile.ts';
import { buildSleepSession, runSleepStaging } from './pipeline-session.ts';
import { extractNightlyObservation } from './sleep-stager.ts';
import { storeResults } from './pipeline-storage.ts';

/**
 * Process sleep data through the full pipeline.
 */
export async function processSleepData(
  raw: RawSleepData,
  supabase: SupabaseClient,
  config: AdvancedSleepStager | null = null,
): Promise<PipelineResult> {
  try {
    // 1. Get or create profile
    const profile = await getUserProfile(supabase, raw.user_id);

    // 2. Build session
    const session = buildSleepSession(raw, profile);

    // 3. Run sleep staging
    const [segmentation, features] = runSleepStaging(session, config);

    // 4. Extract observation
    const observation = extractNightlyObservation(segmentation, features);

    // 5. Fold observation into profile
    let updatedProfile: SleepUserProfile | null = null;
    if (observation) {
      updatedProfile = profile.fold(observation, 14);
    }

    // 6. Store in Supabase
    const stored = await storeResults(
      supabase,
      raw.user_id,
      raw.log_date,
      segmentation,
      features,
      observation,
      updatedProfile,
    );

    return {
      segmentation,
      features,
      observation,
      profile: updatedProfile,
      stored,
      error: null,
    };
  } catch (e) {
    return {
      segmentation: null,
      features: [],
      observation: null,
      profile: null,
      stored: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}