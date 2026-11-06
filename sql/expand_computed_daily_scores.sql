-- ============================================================================
-- ARGON v6.0 — Expansión de computed_daily_scores para cliente thin-client
-- Ejecutar en Supabase SQL Editor (idempotente: IF NOT EXISTS)
-- ============================================================================

-- Campos de edad fisiológica ARGON
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS chronological_age numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS argon_physiological_age numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS total_age_delta numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS pace_of_aging_x numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS delta_vo2_years numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS delta_rhr_years numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS delta_lnrmssd_years numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS delta_ffm_years numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS delta_sleep_years numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS delta_act_years numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS vo2_max_ml_kg_min numeric;

-- Composición corporal (Feelfit + derivados)
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS weight_kg numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS body_fat_pct numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS fat_mass_kg numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS ffm_kg numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS ffm_pct numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS muscle_mass_kg numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS bone_mass_kg numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS skeletal_muscle_pct numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS visceral_fat_index integer;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS tmb_kcal integer;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS body_water_pct numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS water_mass_kg numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS bmi numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS trend_body_fat_pct numeric;

-- VFC / Recuperación MBE (métricas completas)
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS rmssd_ms numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS rmssd_14d_mean_ms numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS rhr_bpm numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS rhr_14d_mean_bpm numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS resp_rate_brpm numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS resp_14d_mean_brpm numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS spo2_pct numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS ln_rmssd numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS ln_rmssd_14d_mean numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS ln_rmssd_14d_sd numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS hrv_z_score numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS rhr_z_score numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS dynamic_rmssd_cap_ms integer;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS cv_lnrmssd_7d_pct numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS swc_lnrmssd numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS acwr_penalty_strain numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS recovery_score integer;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS recovery_status text;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS recommended_max_strain numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS calibrating boolean;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS sleep_missing boolean;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS hrv_missing boolean;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS nap_sleep_min integer;

-- Sueño detalle (4 pilares + regularidad)
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS time_in_bed_min integer;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS total_sleep_min integer;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS deep_sleep_min integer;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS rem_sleep_min integer;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS light_sleep_min integer;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS sleep_hours_vs_needed_pct integer;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS sleep_regularity_pct integer;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS high_sleep_stress_pct integer;

-- Strain desglose
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS steps_net integer;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS session_rpe numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS hr_zones_minutes jsonb;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS z13_minutes integer;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS z45_minutes integer;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS is_hospital_shift boolean;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS night_awake_shift_hours numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS cardio_trimp_load numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS neuromuscular_load numeric;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS shift_orthostatic_load numeric;

-- Nutrición extra
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS target_carbs_g integer;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS target_fat_g integer;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS intake_carbs_g integer;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS intake_fat_g integer;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS tef_kcal integer;
ALTER TABLE computed_daily_scores ADD COLUMN IF NOT EXISTS empirical_tdee_kcal integer;

-- Índices útiles para consultas por rango
CREATE INDEX IF NOT EXISTS idx_computed_daily_scores_log_date ON computed_daily_scores (log_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_raw_biometrics_log_date ON daily_raw_biometrics (log_date DESC);

-- Verificación
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'computed_daily_scores'
ORDER BY ordinal_position;