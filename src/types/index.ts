export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      computed_daily_scores: {
        Row: {
          acwr_penalty_strain: number | null
          argon_physiological_age: number | null
          bmi: number | null
          body_fat_pct: number | null
          body_water_pct: number | null
          bone_mass_kg: number | null
          calibrating: boolean | null
          cardio_trimp_load: number | null
          chronological_age: number | null
          clinical_coach_notes: string | null
          computed_at: string | null
          cumulative_sleep_debt_hours: number | null
          cv_lnrmssd_7d_pct: number | null
          deep_sleep_min: number | null
          delta_act_years: number | null
          delta_ffm_years: number | null
          delta_lnrmssd_years: number | null
          delta_rhr_years: number | null
          delta_sleep_years: number | null
          delta_vo2_years: number | null
          dynamic_rmssd_cap_ms: number | null
          dynamic_sleep_need_hours: number | null
          dynamic_tdee_kcal: number | null
          empirical_tdee_kcal: number | null
          fat_mass_kg: number | null
          ffm_kg: number | null
          ffm_pct: number | null
          high_sleep_stress_pct: number | null
          hr_zones_minutes: Json | null
          hrv_missing: boolean | null
          hrv_z_score: number | null
          intake_carbs_g: number | null
          intake_fat_g: number | null
          intake_kcal: number | null
          intake_protein_g: number | null
          is_hospital_shift: boolean | null
          light_sleep_min: number | null
          ln_rmssd: number | null
          ln_rmssd_14d_mean: number | null
          ln_rmssd_14d_sd: number | null
          log_date: string
          meals_log_json: Json | null
          muscle_mass_kg: number | null
          nap_sleep_min: number | null
          neuromuscular_load: number | null
          night_awake_shift_hours: number | null
          optimal_bedtime_end: string | null
          optimal_bedtime_start: string | null
          pace_of_aging_x: number | null
          pickleball_or_gym_minutes: number | null
          recommended_max_strain: number | null
          recovery_score: number | null
          recovery_status: string | null
          rem_sleep_min: number | null
          resp_14d_mean_brpm: number | null
          resp_rate_brpm: number | null
          rhr_14d_mean_bpm: number | null
          rhr_bpm: number | null
          rhr_z_score: number | null
          rmssd_14d_mean_ms: number | null
          rmssd_ms: number | null
          session_rpe: number | null
          shift_orthostatic_load: number | null
          skeletal_muscle_pct: number | null
          sleep_architecture_score: number | null
          sleep_efficiency_pct: number | null
          sleep_hours_vs_needed_pct: number | null
          sleep_missing: boolean | null
          sleep_regularity_pct: number | null
          spo2_pct: number | null
          steps_count: number | null
          steps_net: number | null
          strain_score: number | null
          swc_lnrmssd: number | null
          target_carbs_g: number | null
          target_fat_g: number | null
          target_kcal: number | null
          target_protein_g: number | null
          tef_kcal: number | null
          time_in_bed_min: number | null
          tmb_kcal: number | null
          total_age_delta: number | null
          total_sleep_min: number | null
          trend_body_fat_pct: number | null
          trend_weight_kg: number | null
          visceral_fat_index: number | null
          vo2_max_ml_kg_min: number | null
          water_mass_kg: number | null
          weight_kg: number | null
          z13_minutes: number | null
          z45_minutes: number | null
        }
        Insert: {
          acwr_penalty_strain?: number | null
          argon_physiological_age?: number | null
          bmi?: number | null
          body_fat_pct?: number | null
          body_water_pct?: number | null
          bone_mass_kg?: number | null
          calibrating?: boolean | null
          cardio_trimp_load?: number | null
          chronological_age?: number | null
          clinical_coach_notes?: string | null
          computed_at?: string | null
          cumulative_sleep_debt_hours?: number | null
          cv_lnrmssd_7d_pct?: number | null
          deep_sleep_min?: number | null
          delta_act_years?: number | null
          delta_ffm_years?: number | null
          delta_lnrmssd_years?: number | null
          delta_rhr_years?: number | null
          delta_sleep_years?: number | null
          delta_vo2_years?: number | null
          dynamic_rmssd_cap_ms?: number | null
          dynamic_sleep_need_hours?: number | null
          dynamic_tdee_kcal?: number | null
          empirical_tdee_kcal?: number | null
          fat_mass_kg?: number | null
          ffm_kg?: number | null
          ffm_pct?: number | null
          high_sleep_stress_pct?: number | null
          hr_zones_minutes?: Json | null
          hrv_missing?: boolean | null
          hrv_z_score?: number | null
          intake_carbs_g?: number | null
          intake_fat_g?: number | null
          intake_kcal?: number | null
          intake_protein_g?: number | null
          is_hospital_shift?: boolean | null
          light_sleep_min?: number | null
          ln_rmssd?: number | null
          ln_rmssd_14d_mean?: number | null
          ln_rmssd_14d_sd?: number | null
          log_date: string
          meals_log_json?: Json | null
          muscle_mass_kg?: number | null
          nap_sleep_min?: number | null
          neuromuscular_load?: number | null
          night_awake_shift_hours?: number | null
          optimal_bedtime_end?: string | null
          optimal_bedtime_start?: string | null
          pace_of_aging_x?: number | null
          pickleball_or_gym_minutes?: number | null
          recommended_max_strain?: number | null
          recovery_score?: number | null
          recovery_status?: string | null
          rem_sleep_min?: number | null
          resp_14d_mean_brpm?: number | null
          resp_rate_brpm?: number | null
          rhr_14d_mean_bpm?: number | null
          rhr_bpm?: number | null
          rhr_z_score?: number | null
          rmssd_14d_mean_ms?: number | null
          rmssd_ms?: number | null
          session_rpe?: number | null
          shift_orthostatic_load?: number | null
          skeletal_muscle_pct?: number | null
          sleep_architecture_score?: number | null
          sleep_efficiency_pct?: number | null
          sleep_hours_vs_needed_pct?: number | null
          sleep_missing?: boolean | null
          sleep_regularity_pct?: number | null
          spo2_pct?: number | null
          steps_count?: number | null
          steps_net?: number | null
          strain_score?: number | null
          swc_lnrmssd?: number | null
          target_carbs_g?: number | null
          target_fat_g?: number | null
          target_kcal?: number | null
          target_protein_g?: number | null
          tef_kcal?: number | null
          time_in_bed_min?: number | null
          tmb_kcal?: number | null
          total_age_delta?: number | null
          total_sleep_min?: number | null
          trend_body_fat_pct?: number | null
          trend_weight_kg?: number | null
          visceral_fat_index?: number | null
          vo2_max_ml_kg_min?: number | null
          water_mass_kg?: number | null
          weight_kg?: number | null
          z13_minutes?: number | null
          z45_minutes?: number | null
        }
        Update: {
          acwr_penalty_strain?: number | null
          argon_physiological_age?: number | null
          bmi?: number | null
          body_fat_pct?: number | null
          body_water_pct?: number | null
          bone_mass_kg?: number | null
          calibrating?: boolean | null
          cardio_trimp_load?: number | null
          chronological_age?: number | null
          clinical_coach_notes?: string | null
          computed_at?: string | null
          cumulative_sleep_debt_hours?: number | null
          cv_lnrmssd_7d_pct?: number | null
          deep_sleep_min?: number | null
          delta_act_years?: number | null
          delta_ffm_years?: number | null
          delta_lnrmssd_years?: number | null
          delta_rhr_years?: number | null
          delta_sleep_years?: number | null
          delta_vo2_years?: number | null
          dynamic_rmssd_cap_ms?: number | null
          dynamic_sleep_need_hours?: number | null
          dynamic_tdee_kcal?: number | null
          empirical_tdee_kcal?: number | null
          fat_mass_kg?: number | null
          ffm_kg?: number | null
          ffm_pct?: number | null
          high_sleep_stress_pct?: number | null
          hr_zones_minutes?: Json | null
          hrv_missing?: boolean | null
          hrv_z_score?: number | null
          intake_carbs_g?: number | null
          intake_fat_g?: number | null
          intake_kcal?: number | null
          intake_protein_g?: number | null
          is_hospital_shift?: boolean | null
          light_sleep_min?: number | null
          ln_rmssd?: number | null
          ln_rmssd_14d_mean?: number | null
          ln_rmssd_14d_sd?: number | null
          log_date?: string
          meals_log_json?: Json | null
          muscle_mass_kg?: number | null
          nap_sleep_min?: number | null
          neuromuscular_load?: number | null
          night_awake_shift_hours?: number | null
          optimal_bedtime_end?: string | null
          optimal_bedtime_start?: string | null
          pace_of_aging_x?: number | null
          pickleball_or_gym_minutes?: number | null
          recommended_max_strain?: number | null
          recovery_score?: number | null
          recovery_status?: string | null
          rem_sleep_min?: number | null
          resp_14d_mean_brpm?: number | null
          resp_rate_brpm?: number | null
          rhr_14d_mean_bpm?: number | null
          rhr_bpm?: number | null
          rhr_z_score?: number | null
          rmssd_14d_mean_ms?: number | null
          rmssd_ms?: number | null
          session_rpe?: number | null
          shift_orthostatic_load?: number | null
          skeletal_muscle_pct?: number | null
          sleep_architecture_score?: number | null
          sleep_efficiency_pct?: number | null
          sleep_hours_vs_needed_pct?: number | null
          sleep_missing?: boolean | null
          sleep_regularity_pct?: number | null
          spo2_pct?: number | null
          steps_count?: number | null
          steps_net?: number | null
          strain_score?: number | null
          swc_lnrmssd?: number | null
          target_carbs_g?: number | null
          target_fat_g?: number | null
          target_kcal?: number | null
          target_protein_g?: number | null
          tef_kcal?: number | null
          time_in_bed_min?: number | null
          tmb_kcal?: number | null
          total_age_delta?: number | null
          total_sleep_min?: number | null
          trend_body_fat_pct?: number | null
          trend_weight_kg?: number | null
          visceral_fat_index?: number | null
          vo2_max_ml_kg_min?: number | null
          water_mass_kg?: number | null
          weight_kg?: number | null
          z13_minutes?: number | null
          z45_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "computed_daily_scores_log_date_fkey"
            columns: ["log_date"]
            isOneToOne: true
            referencedRelation: "daily_raw_biometrics"
            referencedColumns: ["log_date"]
          },
        ]
      }
      daily_raw_biometrics: {
        Row: {
          active_calories_kcal: number | null
          body_fat_pct: number | null
          body_water_pct: number | null
          deep_sleep_min: number | null
          hr_zones_minutes: Json | null
          intake_carbs_g: number | null
          intake_fat_g: number | null
          intake_kcal: number | null
          intake_protein_g: number | null
          is_hospital_shift: boolean | null
          light_sleep_min: number | null
          log_date: string
          meals_log_json: Json | null
          metabolic_age: number | null
          nap_sleep_min: number | null
          night_awake_shift_hours: number | null
          pickleball_or_gym_minutes: number | null
          raw_rr_intervals_ms: Json | null
          rem_sleep_min: number | null
          resp_rate_brpm: number | null
          rhr_bpm: number | null
          rmssd_ms: number | null
          session_rpe: number | null
          skeletal_muscle_kg: number | null
          skeletal_muscle_pct: number | null
          skin_temp_delta_c: number | null
          sleep_onset_timestamp: string | null
          spo2_pct: number | null
          steps_count: number | null
          time_in_bed_min: number | null
          tmb_kcal: number | null
          total_sleep_min: number | null
          updated_at: string | null
          visceral_fat_index: number | null
          wake_timestamp: string | null
          weight_kg: number | null
        }
        Insert: {
          active_calories_kcal?: number | null
          body_fat_pct?: number | null
          body_water_pct?: number | null
          deep_sleep_min?: number | null
          hr_zones_minutes?: Json | null
          intake_carbs_g?: number | null
          intake_fat_g?: number | null
          intake_kcal?: number | null
          intake_protein_g?: number | null
          is_hospital_shift?: boolean | null
          light_sleep_min?: number | null
          log_date: string
          meals_log_json?: Json | null
          metabolic_age?: number | null
          nap_sleep_min?: number | null
          night_awake_shift_hours?: number | null
          pickleball_or_gym_minutes?: number | null
          raw_rr_intervals_ms?: Json | null
          rem_sleep_min?: number | null
          resp_rate_brpm?: number | null
          rhr_bpm?: number | null
          rmssd_ms?: number | null
          session_rpe?: number | null
          skeletal_muscle_kg?: number | null
          skeletal_muscle_pct?: number | null
          skin_temp_delta_c?: number | null
          sleep_onset_timestamp?: string | null
          spo2_pct?: number | null
          steps_count?: number | null
          time_in_bed_min?: number | null
          tmb_kcal?: number | null
          total_sleep_min?: number | null
          updated_at?: string | null
          visceral_fat_index?: number | null
          wake_timestamp?: string | null
          weight_kg?: number | null
        }
        Update: {
          active_calories_kcal?: number | null
          body_fat_pct?: number | null
          body_water_pct?: number | null
          deep_sleep_min?: number | null
          hr_zones_minutes?: Json | null
          intake_carbs_g?: number | null
          intake_fat_g?: number | null
          intake_kcal?: number | null
          intake_protein_g?: number | null
          is_hospital_shift?: boolean | null
          light_sleep_min?: number | null
          log_date?: string
          meals_log_json?: Json | null
          metabolic_age?: number | null
          nap_sleep_min?: number | null
          night_awake_shift_hours?: number | null
          pickleball_or_gym_minutes?: number | null
          raw_rr_intervals_ms?: Json | null
          rem_sleep_min?: number | null
          resp_rate_brpm?: number | null
          rhr_bpm?: number | null
          rmssd_ms?: number | null
          session_rpe?: number | null
          skeletal_muscle_kg?: number | null
          skeletal_muscle_pct?: number | null
          skin_temp_delta_c?: number | null
          sleep_onset_timestamp?: string | null
          spo2_pct?: number | null
          steps_count?: number | null
          time_in_bed_min?: number | null
          tmb_kcal?: number | null
          total_sleep_min?: number | null
          updated_at?: string | null
          visceral_fat_index?: number | null
          wake_timestamp?: string | null
          weight_kg?: number | null
        }
        Relationships: []
      }
      sleep_epoch_features: {
        Row: {
          created_at: string
          deep_flag: boolean
          enmo_median: number | null
          enmo_p95: number | null
          epoch_index: number
          epoch_start: string
          hr_median: number | null
          hr_p25: number | null
          hr_p5: number | null
          id: number
          immobile_frac: number | null
          lfhf_ratio: number | null
          rk_bpm: number | null
          rmssd_ms: number | null
          segmentation_id: number
          stage: number
          still_frac: number | null
          valid_hr_frac: number | null
          valid_rr_frac: number | null
        }
        Insert: {
          created_at?: string
          deep_flag?: boolean
          enmo_median?: number | null
          enmo_p95?: number | null
          epoch_index: number
          epoch_start: string
          hr_median?: number | null
          hr_p25?: number | null
          hr_p5?: number | null
          id?: number
          immobile_frac?: number | null
          lfhf_ratio?: number | null
          rk_bpm?: number | null
          rmssd_ms?: number | null
          segmentation_id: number
          stage: number
          still_frac?: number | null
          valid_hr_frac?: number | null
          valid_rr_frac?: number | null
        }
        Update: {
          created_at?: string
          deep_flag?: boolean
          enmo_median?: number | null
          enmo_p95?: number | null
          epoch_index?: number
          epoch_start?: string
          hr_median?: number | null
          hr_p25?: number | null
          hr_p5?: number | null
          id?: number
          immobile_frac?: number | null
          lfhf_ratio?: number | null
          rk_bpm?: number | null
          rmssd_ms?: number | null
          segmentation_id?: number
          stage?: number
          still_frac?: number | null
          valid_hr_frac?: number | null
          valid_rr_frac?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sleep_epoch_features_segmentation_id_fkey"
            columns: ["segmentation_id"]
            isOneToOne: false
            referencedRelation: "sleep_segmentations"
            referencedColumns: ["id"]
          },
        ]
      }
      sleep_night_observations: {
        Row: {
          created_at: string
          enmo_move_cut_g: number | null
          enmo_still_cut_g: number | null
          hr_arousal: number | null
          hr_floor_p25: number | null
          hr_floor_p5: number | null
          hr_sleep_median: number | null
          id: number
          lfhf_med: number | null
          log_date: string
          rk_med_bpm: number | null
          rmssd_mad_ms: number | null
          rmssd_med_ms: number | null
          segmentation_id: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enmo_move_cut_g?: number | null
          enmo_still_cut_g?: number | null
          hr_arousal?: number | null
          hr_floor_p25?: number | null
          hr_floor_p5?: number | null
          hr_sleep_median?: number | null
          id?: number
          lfhf_med?: number | null
          log_date: string
          rk_med_bpm?: number | null
          rmssd_mad_ms?: number | null
          rmssd_med_ms?: number | null
          segmentation_id: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enmo_move_cut_g?: number | null
          enmo_still_cut_g?: number | null
          hr_arousal?: number | null
          hr_floor_p25?: number | null
          hr_floor_p5?: number | null
          hr_sleep_median?: number | null
          id?: number
          lfhf_med?: number | null
          log_date?: string
          rk_med_bpm?: number | null
          rmssd_mad_ms?: number | null
          rmssd_med_ms?: number | null
          segmentation_id?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sleep_night_observations_segmentation_id_fkey"
            columns: ["segmentation_id"]
            isOneToOne: false
            referencedRelation: "sleep_segmentations"
            referencedColumns: ["id"]
          },
        ]
      }
      sleep_segmentations: {
        Row: {
          confidence: number
          config: Json
          created_at: string
          deep_flags: boolean[]
          deep_pct: number
          epoch_sec: number
          id: number
          log_date: string
          nrem_pct: number
          rem_pct: number
          session_end: string
          session_start: string
          sleep_offset: string | null
          sleep_onset: string | null
          sleep_windows: Json
          stages: number[]
          total_epochs: number
          unobserved_sec: number
          updated_at: string
          user_id: string
          wake_pct: number
        }
        Insert: {
          confidence: number
          config?: Json
          created_at?: string
          deep_flags: boolean[]
          deep_pct: number
          epoch_sec?: number
          id?: number
          log_date: string
          nrem_pct: number
          rem_pct: number
          session_end: string
          session_start: string
          sleep_offset?: string | null
          sleep_onset?: string | null
          sleep_windows?: Json
          stages: number[]
          total_epochs: number
          unobserved_sec?: number
          updated_at?: string
          user_id: string
          wake_pct: number
        }
        Update: {
          confidence?: number
          config?: Json
          created_at?: string
          deep_flags?: boolean[]
          deep_pct?: number
          epoch_sec?: number
          id?: number
          log_date?: string
          nrem_pct?: number
          rem_pct?: number
          session_end?: string
          session_start?: string
          sleep_offset?: string | null
          sleep_onset?: string | null
          sleep_windows?: Json
          stages?: number[]
          total_epochs?: number
          unobserved_sec?: number
          updated_at?: string
          user_id?: string
          wake_pct?: number
        }
        Relationships: []
      }
      sleep_user_profiles: {
        Row: {
          enmo_move_cut_g: number | null
          enmo_still_cut_g: number | null
          hr_arousal: number | null
          hr_floor_p25: number | null
          hr_floor_p5: number | null
          hr_sleep_median: number | null
          lfhf_med: number | null
          nights: number
          personal_weight: number
          rk_med_bpm: number | null
          rmssd_mad_ms: number | null
          rmssd_med_ms: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          enmo_move_cut_g?: number | null
          enmo_still_cut_g?: number | null
          hr_arousal?: number | null
          hr_floor_p25?: number | null
          hr_floor_p5?: number | null
          hr_sleep_median?: number | null
          lfhf_med?: number | null
          nights?: number
          personal_weight?: number
          rk_med_bpm?: number | null
          rmssd_mad_ms?: number | null
          rmssd_med_ms?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          enmo_move_cut_g?: number | null
          enmo_still_cut_g?: number | null
          hr_arousal?: number | null
          hr_floor_p25?: number | null
          hr_floor_p5?: number | null
          hr_sleep_median?: number | null
          lfhf_med?: number | null
          nights?: number
          personal_weight?: number
          rk_med_bpm?: number | null
          rmssd_mad_ms?: number | null
          rmssd_med_ms?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_clinical_profile: {
        Row: {
          basal_sleep_need_hours: number
          birth_year: number
          created_at: string | null
          deadline_date: string
          habitual_wake_time: string
          height_cm: number
          id: string
          target_body_fat_pct: number
          target_weight_kg: number
        }
        Insert: {
          basal_sleep_need_hours?: number
          birth_year?: number
          created_at?: string | null
          deadline_date?: string
          habitual_wake_time?: string
          height_cm?: number
          id?: string
          target_body_fat_pct?: number
          target_weight_kg?: number
        }
        Update: {
          basal_sleep_need_hours?: number
          birth_year?: number
          created_at?: string | null
          deadline_date?: string
          habitual_wake_time?: string
          height_cm?: number
          id?: string
          target_body_fat_pct?: number
          target_weight_kg?: number
        }
        Relationships: []
      }
      webhook_logs: {
        Row: {
          detected_categories: Json | null
          detected_dates: Json | null
          id: number
          parsed_summary: Json | null
          raw_payload: Json | null
          received_at: string | null
          source_app: string | null
        }
        Insert: {
          detected_categories?: Json | null
          detected_dates?: Json | null
          id?: number
          parsed_summary?: Json | null
          raw_payload?: Json | null
          received_at?: string | null
          source_app?: string | null
        }
        Update: {
          detected_categories?: Json | null
          detected_dates?: Json | null
          id?: number
          parsed_summary?: Json | null
          raw_payload?: Json | null
          received_at?: string | null
          source_app?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      sleep_daily_scores: {
        Row: {
          deep_sleep_min: number | null
          high_sleep_stress_min: number | null
          light_sleep_min: number | null
          log_date: string | null
          nrem_sleep_min: number | null
          rem_sleep_min: number | null
          sleep_efficiency_pct: number | null
          sleep_regularity_pct: number | null
          time_in_bed_min: number | null
          total_sleep_min: number | null
          user_id: string | null
          waso_min: number | null
        }
        Insert: {
          deep_sleep_min?: never
          high_sleep_stress_min?: never
          light_sleep_min?: never
          log_date?: string | null
          nrem_sleep_min?: never
          rem_sleep_min?: never
          sleep_efficiency_pct?: never
          sleep_regularity_pct?: never
          time_in_bed_min?: never
          total_sleep_min?: never
          user_id?: string | null
          waso_min?: never
        }
        Update: {
          deep_sleep_min?: never
          high_sleep_stress_min?: never
          light_sleep_min?: never
          log_date?: string | null
          nrem_sleep_min?: never
          rem_sleep_min?: never
          sleep_efficiency_pct?: never
          sleep_regularity_pct?: never
          time_in_bed_min?: never
          total_sleep_min?: never
          user_id?: string | null
          waso_min?: never
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const