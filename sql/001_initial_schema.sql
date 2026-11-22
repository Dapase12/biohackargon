-- ARGON v6.0 - Initial Schema Migration
-- Creates core tables: daily_raw_biometrics, computed_daily_scores, webhook_logs
-- Run order: 1. This file, 2. expand_computed_daily_scores.sql, 3. sleep_staging_schema.sql

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ========================================================================
-- CORE TABLE 1: daily_raw_biometrics
-- Raw biometrics from Health Connect / Zepp via Apps Script webhook
-- One row per user per day (upsert on user_id + log_date)
-- ========================================================================
CREATE TABLE IF NOT EXISTS daily_raw_biometrics (
    -- Primary key
    id              bigserial PRIMARY KEY,
    user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    log_date        date NOT NULL,

    -- Heart Rate Variability (ms)
    hrv_rmssd_ms    numeric(6,2),
    hrv_sdnn_ms     numeric(6,2),
    hrv_pnn50_pct   numeric(5,2),

    -- Resting Heart Rate (bpm)
    rhr_bpm         numeric(5,1),

    -- Sleep (from Health Connect)
    sleep_score                     numeric(5,1),
    total_sleep_min                 integer,
    deep_sleep_min                  integer,
    rem_sleep_min                   integer,
    light_sleep_min                 integer,
    awake_sleep_min                 integer,
    sleep_onset_latency_min         integer,
    sleep_efficiency_pct            numeric(5,1),
    bedtime_start                   time,
    bedtime_end                     time,
    naps_count                      integer DEFAULT 0,
    naps_total_min                  integer DEFAULT 0,

    -- Activity (from Zepp/Health Connect)
    steps                           integer DEFAULT 0,
    active_calories                 integer DEFAULT 0,
    exercise_min                    integer DEFAULT 0,
    exercise_type                   text,          -- e.g., "running", "walking", "cycling"
    exercise_intensity              text,          -- e.g., "light", "moderate", "vigorous"

    -- Body Composition (from scale via Health Connect)
    weight_kg                       numeric(5,2),
    body_fat_pct                    numeric(4,1),
    muscle_mass_kg                  numeric(5,2),
    hydration_ml                    integer,

    -- Nutrition (from meal logging)
    intake_kcal                     integer DEFAULT 0,
    intake_protein_g                numeric(6,1) DEFAULT 0,
    intake_carbs_g                  numeric(6,1) DEFAULT 0,
    intake_fat_g                    numeric(6,1) DEFAULT 0,
    meals_log_json                  jsonb DEFAULT '[]'::jsonb,

    -- HR zones (from Zepp exercise)
    z1_minutes                      integer DEFAULT 0,
    z2_minutes                      integer DEFAULT 0,
    z3_minutes                      integer DEFAULT 0,
    z4_minutes                      integer DEFAULT 0,
    z5_minutes                      integer DEFAULT 0,
    hr_zones_minutes                jsonb DEFAULT '{}'::jsonb,

    -- Respiratory rate (from sleep)
    resp_rate_brpm                  numeric(4,1),

    -- SpO2 (from sleep)
    spo2_pct                        numeric(4,1),

    -- Hospital shift tracking
    is_hospital_shift               boolean DEFAULT false,
    night_awake_shift_hours         numeric(4,2) DEFAULT 0,

    -- Subjective / manual
    session_rpe                     numeric(3,1),
    pickleball_or_gym_minutes       integer DEFAULT 0,

    -- Metadata
    raw_payload_hash                text,          -- hash of original webhook payload for idempotency
    source                          text DEFAULT 'health_connect', -- 'health_connect', 'manual', 'zepp'
    created_at                      timestamptz DEFAULT now(),
    updated_at                      timestamptz DEFAULT now()
);

-- Unique constraint for upsert
CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_raw_user_date
    ON daily_raw_biometrics (user_id, log_date);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_daily_raw_user_date_desc
    ON daily_raw_biometrics (user_id, log_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_raw_date
    ON daily_raw_biometrics (log_date DESC);

-- ========================================================================
-- CORE TABLE 2: computed_daily_scores
-- Server-computed MBE scores (100+ columns)
-- One row per user per day (upsert on user_id + log_date)
-- ========================================================================
CREATE TABLE IF NOT EXISTS computed_daily_scores (
    -- Primary key
    id              bigserial PRIMARY KEY,
    user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    log_date        date NOT NULL,

    -- ================================================================
    -- RECOVERY PILLARS (3-pillar model)
    -- ================================================================
    recovery_score                numeric(5,1),     -- 0-100 composite
    readiness_score               numeric(5,1),     -- 0-100 readiness

    -- HRV Pillar (40% weight)
    hrv_baseline_rmssd            numeric(6,2),     -- 14-day baseline
    hrv_7d_avg_rmssd              numeric(6,2),     -- 7-day rolling avg
    hrv_14d_avg_rmssd             numeric(6,2),     -- 14-day rolling avg
    hrv_swc                       numeric(6,2),     -- Smallest Worthwhile Change = 0.5*SD
    hrv_z_score                   numeric(5,2),     -- (current - baseline) / SWC
    ln_rmssd                      numeric(5,3),     -- ln(RMSSD)
    ln_rmssd_14d_mean             numeric(5,3),
    ln_rmssd_14d_sd               numeric(5,3),
    cv_lnrmssd_7d_pct             numeric(5,1),     -- Coefficient of variation 7d %
    dynamic_rmssd_cap_ms          numeric(6,2),     -- Dynamic cap for recovery calc

    -- RHR Pillar (20% weight)
    rhr_baseline                  numeric(5,1),     -- 14-day baseline
    rhr_7d_avg                    numeric(5,1),     -- 7-day rolling avg
    rhr_z_score                   numeric(5,2),     -- (baseline - current) / SWC (inverted)

    -- Sleep Pillar (40% weight)
    sleep_hours_vs_needed_pct     numeric(5,1),     -- hours / dynamic_need * 100
    sleep_regularity_pct          numeric(5,1),     -- 100 - (SD_duration / mean * 100)
    high_sleep_stress_pct         numeric(5,1),     -- % nights with HRV suppression
    sleep_architecture_score      numeric(5,1),     -- deep+REM / TST * 100
    sleep_debt_h                  numeric(4,1),     -- Cumulative debt
    dynamic_sleep_need_h          numeric(4,2),     -- Basal + strain adjustment
    optimal_bedtime_start         time,
    optimal_bedtime_end           time,
    cumulative_sleep_debt_hours   numeric(5,2),

    -- Recovery status
    recovery_status               text,             -- 'optimal' | 'moderate' | 'compromised' | 'calibrating'
    calibrating                   boolean DEFAULT true,
    sleep_missing                 boolean DEFAULT false,
    hrv_missing                   boolean DEFAULT false,

    -- ================================================================
    -- STRAIN (Carga de Esfuerzo 4D)
    -- ================================================================
    strain_score                  numeric(5,1),     -- 0-100 composite strain
    training_load_7d              numeric(7,1),     -- 7-day TRIMP sum
    acwr                          numeric(4,2),     -- Acute:Chronic Workload Ratio
    acwr_penalty_strain           numeric(5,1),     -- Penalty if ACWR > 1.3
    recommended_max_strain        numeric(5,1),     -- Based on recovery
    cardio_trimp_load             numeric(7,1),     -- Cardio TRIMP (Banister)
    neuromuscular_load            numeric(7,1),     -- Neuromuscular load
    shift_orthostatic_load        numeric(7,1),     -- Hospital shift load
    z13_minutes                   integer DEFAULT 0, -- Zone 1-3 minutes
    z45_minutes                   integer DEFAULT 0, -- Zone 4-5 minutes
    hr_zones_minutes              jsonb DEFAULT '{}'::jsonb,
    steps_net                     integer DEFAULT 0, -- Steps - shift steps

    -- ========================================================================
    -- SLEEP STAGING & ARCHITECTURE
    -- ========================================================================
    total_sleep_min               integer,
    deep_sleep_min                integer,
    rem_sleep_min                 integer,
    light_sleep_min               integer,
    awake_sleep_min               integer,
    sleep_efficiency_pct          numeric(5,1),
    time_in_bed_min               integer,
    sleep_onset_latency_min       integer,
    nap_sleep_min                 integer DEFAULT 0,
    bedtime_start                 time,
    bedtime_end                   time,

    -- ========================================================================
    -- AUTONOMIC / HRV DETAIL
    -- ========================================================================
    rmssd_ms                      numeric(6,2),
    rmssd_14d_mean_ms             numeric(6,2),
    rhr_bpm                       numeric(5,1),
    rhr_14d_mean_bpm              numeric(5,1),
    resp_rate_brpm                numeric(4,1),
    resp_14d_mean_brpm            numeric(4,1),
    spo2_pct                      numeric(4,1),

    -- ========================================================================
    -- NUTRITION / ENERGY BALANCE
    -- ========================================================================
    target_kcal                   integer,          -- TDEE - deficit
    intake_kcal                   integer,
    intake_protein_g              numeric(6,1),
    intake_carbs_g                numeric(6,1),
    intake_fat_g                  numeric(6,1),
    tef_kcal                      integer,          -- Thermic Effect of Food
    empirical_tdee_kcal           integer,          -- Measured TDEE
    target_protein_g              numeric(6,1),     -- 2.35 g/kg FFM
    target_carbs_g                numeric(6,1),
    target_fat_g                  numeric(6,1),
    hydration_score               numeric(5,1),     -- 0-100

    -- ========================================================================
    -- BODY COMPOSITION
    -- ========================================================================
    trend_weight_kg               numeric(5,2),
    trend_body_fat_pct            numeric(4,1),
    ffm_kg                        numeric(5,2),     -- Fat Free Mass
    ffm_pct                       numeric(4,1),
    muscle_mass_kg                numeric(5,2),
    bone_mass_kg                  numeric(5,2),
    skeletal_muscle_pct           numeric(4,1),
    visceral_fat_index            numeric(4,1),
    tmb_kcal                      integer,          -- BMR from impedance
    body_water_pct                numeric(4,1),
    water_mass_kg                 numeric(5,2),
    bmi                           numeric(4,1),
    fat_mass_kg                   numeric(5,2),
    body_comp_score               numeric(5,1),     -- 0-100

    -- ========================================================================
    -- LONGEVITY / PHYSIOLOGICAL AGE
    -- ========================================================================
    chronological_age             numeric(4,1),     -- years
    argon_physiological_age       numeric(4,1),     -- years
    pace_of_aging_x               numeric(3,2),     -- DunedinPACE style
    total_age_delta               numeric(4,1),     -- bio - chrono (years)
    vo2_max_ml_kg_min             numeric(5,1),

    -- Age deltas by system
    delta_cardio_years            numeric(4,1),
    delta_metabolic_years         numeric(4,1),
    delta_inflammatory_years      numeric(4,1),
    delta_autonomic_years         numeric(4,1),

    -- ========================================================================
    -- CLINICAL COACH NOTES
    -- ========================================================================
    clinical_coach_notes          text,

    -- ========================================================================
    -- METADATA
    -- ========================================================================
    computed_at                   timestamptz DEFAULT now(),
    computation_version           text DEFAULT 'v6.0',
    created_at                    timestamptz DEFAULT now(),
    updated_at                    timestamptz DEFAULT now()
);

-- Unique constraint for upsert
CREATE UNIQUE INDEX IF NOT EXISTS uq_computed_user_date
    ON computed_daily_scores (user_id, log_date);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_computed_user_date_desc
    ON computed_daily_scores (user_id, log_date DESC);
CREATE INDEX IF NOT EXISTS idx_computed_date
    ON computed_daily_scores (log_date DESC);

-- ========================================================================
-- CORE TABLE 3: webhook_logs
-- Audit trail for webhook processing (debugging, idempotency)
-- ========================================================================
CREATE TABLE IF NOT EXISTS webhook_logs (
    id                  bigserial PRIMARY KEY,
    user_id             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    log_date            date,                           -- derived from payload
    payload_hash        text NOT NULL,                  -- SHA256 of raw payload
    status              text NOT NULL,                  -- 'received' | 'queued' | 'processing' | 'completed' | 'failed' | 'dead'
    error_message       text,
    processing_time_ms  integer,
    attempt_count       integer DEFAULT 1,
    queued_at           timestamptz DEFAULT now(),
    processed_at        timestamptz,
    raw_payload         jsonb,                          -- full payload for debugging
    headers             jsonb,                          -- request headers
    source_ip           inet
);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_user_date
    ON webhook_logs (user_id, log_date DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_status
    ON webhook_logs (status);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_payload_hash
    ON webhook_logs (payload_hash);

-- ========================================================================
-- UPDATED_AT TRIGGERS
-- ========================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_daily_raw_biometrics_updated_at ON daily_raw_biometrics;
CREATE TRIGGER update_daily_raw_biometrics_updated_at
    BEFORE UPDATE ON daily_raw_biometrics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_computed_daily_scores_updated_at ON computed_daily_scores;
CREATE TRIGGER update_computed_daily_scores_updated_at
    BEFORE UPDATE ON computed_daily_scores
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ========================================================================
-- HELPER FUNCTIONS
-- ========================================================================

-- Get latest computed scores for a user (for sync)
CREATE OR REPLACE FUNCTION get_latest_computed_scores(p_user_id uuid, p_limit integer DEFAULT 30)
RETURNS SETOF computed_daily_scores
LANGUAGE sql STABLE AS $$
    SELECT * FROM computed_daily_scores
    WHERE user_id = p_user_id
    ORDER BY log_date DESC
    LIMIT p_limit;
$$;

-- Get raw biometrics for a date range (for MBE+ panel)
CREATE OR REPLACE FUNCTION get_raw_biometrics_range(p_user_id uuid, p_start_date date, p_end_date date)
RETURNS SETOF daily_raw_biometrics
LANGUAGE sql STABLE AS $$
    SELECT * FROM daily_raw_biometrics
    WHERE user_id = p_user_id
    AND log_date BETWEEN p_start_date AND p_end_date
    ORDER BY log_date DESC;
$$;

-- Get computed scores for a date range
CREATE OR REPLACE FUNCTION get_computed_scores_range(p_user_id uuid, p_start_date date, p_end_date date)
RETURNS SETOF computed_daily_scores
LANGUAGE sql STABLE AS $$
    SELECT * FROM computed_daily_scores
    WHERE user_id = p_user_id
    AND log_date BETWEEN p_start_date AND p_end_date
    ORDER BY log_date DESC;
$$;