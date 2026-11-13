-- ============================================================================
-- ARGON v6.0 — Sleep Staging Schema
-- Ejecutar en Supabase SQL Editor (idempotente: IF NOT EXISTS)
-- ============================================================================

-- Tabla principal de segmentación de sueño (resultados de segmentSleep)
CREATE TABLE IF NOT EXISTS sleep_segmentations (
    id bigserial PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    log_date date NOT NULL,                    -- fecha del día (wake-to-wake)
    session_start timestamptz NOT NULL,        -- inicio de ventana in-bed
    session_end timestamptz NOT NULL,          -- fin de ventana in-bed
    sleep_onset timestamptz,                   -- inicio del sueño detectado
    sleep_offset timestamptz,                  -- fin del sueño detectado
    epoch_sec integer NOT NULL DEFAULT 30,     -- duración de época en segundos
    stages int[] NOT NULL,                     -- 0=wake, 1=nrem, 2=rem por época
    deep_flags boolean[] NOT NULL,             -- flag de sueño profundo por época (solo NREM)
    total_epochs integer NOT NULL,             -- total de épocas en la segmentación
    wake_pct numeric(5,2) NOT NULL,            -- % wake
    nrem_pct numeric(5,2) NOT NULL,            -- % nrem
    rem_pct numeric(5,2) NOT NULL,             -- % rem
    deep_pct numeric(5,2) NOT NULL,            -- % deep (subset de NREM)
    unobserved_sec integer NOT NULL DEFAULT 0, -- segundos sin datos (off-skin)
    confidence numeric(4,3) NOT NULL,          -- confianza global 0-1
    sleep_windows jsonb NOT NULL DEFAULT '[]', -- ventanas de sueño detectadas (van Hees)
    config jsonb NOT NULL DEFAULT '{}',        -- configuración usada (epoch_sec, thresholds, etc.)
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Índices para consultas habituales
CREATE INDEX IF NOT EXISTS idx_sleep_segmentations_user_date
    ON sleep_segmentations (user_id, log_date DESC);

CREATE INDEX IF NOT EXISTS idx_sleep_segmentations_session_start
    ON sleep_segmentations (session_start DESC);

-- Tabla de características por época (cardioStager output)
CREATE TABLE IF NOT EXISTS sleep_epoch_features (
    id bigserial PRIMARY KEY,
    segmentation_id bigint NOT NULL REFERENCES sleep_segmentations(id) ON DELETE CASCADE,
    epoch_index integer NOT NULL,              -- índice de época (0-based)
    epoch_start timestamptz NOT NULL,          -- inicio de época
    -- Movimiento
    enmo_median numeric(6,4),
    enmo_p95 numeric(6,4),
    still_frac numeric(4,3),
    immobile_frac numeric(4,3),
    -- HR
    hr_median numeric(5,1),
    hr_p5 numeric(5,1),
    hr_p25 numeric(5,1),
    valid_hr_frac numeric(4,3),
    -- HRV
    rmssd_ms numeric(6,1),
    lfhf_ratio numeric(6,3),
    rk_bpm numeric(5,2),
    valid_rr_frac numeric(4,3),
    -- Clasificación
    stage integer NOT NULL,                    -- 0=wake, 1=nrem, 2=rem
    deep_flag boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sleep_epoch_features_segmentation
    ON sleep_epoch_features (segmentation_id, epoch_index);

-- Perfil de sueño personalizado por usuario (SleepUserProfile)
-- Se actualiza vía EWMA tras cada noche finalizada
CREATE TABLE IF NOT EXISTS sleep_user_profiles (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    nights integer NOT NULL DEFAULT 0,
    hr_floor_p5 numeric(5,1),
    hr_floor_p25 numeric(5,1),
    hr_sleep_median numeric(5,1),
    hr_arousal numeric(5,1),
    rmssd_med_ms numeric(6,1),
    rmssd_mad_ms numeric(6,1),
    enmo_still_cut_g numeric(6,4),
    enmo_move_cut_g numeric(6,4),
    lfhf_med numeric(6,3),
    rk_med_bpm numeric(5,2),
    personal_weight numeric(4,3) NOT NULL DEFAULT 0, -- min(nights/28, 0.5)
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Observaciones nocturnas para folding (SleepNightObservation)
-- Datos extraídos de una noche para actualizar el perfil
CREATE TABLE IF NOT EXISTS sleep_night_observations (
    id bigserial PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    segmentation_id bigint NOT NULL REFERENCES sleep_segmentations(id) ON DELETE CASCADE,
    log_date date NOT NULL,
    hr_floor_p5 numeric(5,1),
    hr_floor_p25 numeric(5,1),
    hr_sleep_median numeric(5,1),
    hr_arousal numeric(5,1),
    rmssd_med_ms numeric(6,1),
    rmssd_mad_ms numeric(6,1),
    enmo_still_cut_g numeric(6,4),
    enmo_move_cut_g numeric(6,4),
    lfhf_med numeric(6,3),
    rk_med_bpm numeric(5,2),
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sleep_night_observations_user_date
    ON sleep_night_observations (user_id, log_date DESC);

-- Vista para computar sleep scores diarios (para computed_daily_scores)
CREATE OR REPLACE VIEW sleep_daily_scores AS
SELECT
    ss.user_id,
    ss.log_date,
    -- Duraciones en minutos
    (EXTRACT(EPOCH FROM (ss.sleep_offset - ss.sleep_onset)) / 60)::int AS total_sleep_min,
    (ss.nrem_pct / 100.0 * EXTRACT(EPOCH FROM (ss.sleep_offset - ss.sleep_onset)) / 60)::int AS nrem_sleep_min,
    (ss.rem_pct / 100.0 * EXTRACT(EPOCH FROM (ss.sleep_offset - ss.sleep_onset)) / 60)::int AS rem_sleep_min,
    -- Deep sleep (subset de NREM con deep_flag)
    (SELECT COALESCE(SUM(CASE WHEN ef.deep_flag THEN ss.epoch_sec ELSE 0 END) / 60.0, 0)::int
     FROM sleep_epoch_features ef
     WHERE ef.segmentation_id = ss.id
       AND ef.stage = 1) AS deep_sleep_min,
    -- Light sleep = NREM - deep
    (SELECT COALESCE(SUM(CASE WHEN NOT ef.deep_flag THEN ss.epoch_sec ELSE 0 END) / 60.0, 0)::int
     FROM sleep_epoch_features ef
     WHERE ef.segmentation_id = ss.id
       AND ef.stage = 1) AS light_sleep_min,
    -- Time in bed
    (EXTRACT(EPOCH FROM (ss.session_end - ss.session_start)) / 60)::int AS time_in_bed_min,
    -- Sleep efficiency
    CASE
        WHEN EXTRACT(EPOCH FROM (ss.session_end - ss.session_start)) > 0
        THEN (EXTRACT(EPOCH FROM (ss.sleep_offset - ss.sleep_onset)) / EXTRACT(EPOCH FROM (ss.session_end - ss.session_start)) * 100)::int
        ELSE 0
    END AS sleep_efficiency_pct,
    -- Wake after sleep onset (WASO)
    (SELECT COALESCE(SUM(CASE WHEN ef.stage = 0 THEN ss.epoch_sec ELSE 0 END) / 60.0, 0)::int
     FROM sleep_epoch_features ef
     WHERE ef.segmentation_id = ss.id
       AND ef.epoch_start >= ss.sleep_onset
       AND ef.epoch_start < ss.sleep_offset) AS waso_min,
    -- Sleep regularity (placeholder - needs multi-night analysis)
    0 AS sleep_regularity_pct,
    -- Sleep stress (high HR during sleep)
    (SELECT COALESCE(SUM(CASE WHEN ef.hr_median > sp.hr_arousal THEN ss.epoch_sec ELSE 0 END) / 60.0, 0)::int
     FROM sleep_epoch_features ef
     CROSS JOIN sleep_user_profiles sp
     WHERE ef.segmentation_id = ss.id
       AND sp.user_id = ss.user_id) AS high_sleep_stress_min
FROM sleep_segmentations ss
WHERE ss.sleep_onset IS NOT NULL
  AND ss.sleep_offset IS NOT NULL;

-- Trigger para actualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_sleep_segmentations_updated_at
    BEFORE UPDATE ON sleep_segmentations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sleep_user_profiles_updated_at
    BEFORE UPDATE ON sleep_user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies
ALTER TABLE sleep_segmentations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sleep_epoch_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE sleep_user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sleep_night_observations ENABLE ROW LEVEL SECURITY;

-- Políticas: usuarios solo ven sus propios datos
CREATE POLICY "Users can view own sleep_segmentations"
    ON sleep_segmentations FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sleep_segmentations"
    ON sleep_segmentations FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sleep_segmentations"
    ON sleep_segmentations FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can view own sleep_epoch_features"
    ON sleep_epoch_features FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM sleep_segmentations s
        WHERE s.id = sleep_epoch_features.segmentation_id
        AND s.user_id = auth.uid()
    ));

CREATE POLICY "Users can insert own sleep_epoch_features"
    ON sleep_epoch_features FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM sleep_segmentations s
        WHERE s.id = sleep_epoch_features.segmentation_id
        AND s.user_id = auth.uid()
    ));

CREATE POLICY "Users can view own sleep_user_profiles"
    ON sleep_user_profiles FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sleep_user_profiles"
    ON sleep_user_profiles FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sleep_user_profiles"
    ON sleep_user_profiles FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own sleep_night_observations"
    ON sleep_night_observations FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sleep_night_observations"
    ON sleep_night_observations FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Verificación
SELECT 'sleep_segmentations' as table_name, count(*) as columns
FROM information_schema.columns WHERE table_name = 'sleep_segmentations'
UNION ALL
SELECT 'sleep_epoch_features', count(*) FROM information_schema.columns WHERE table_name = 'sleep_epoch_features'
UNION ALL
SELECT 'sleep_user_profiles', count(*) FROM information_schema.columns WHERE table_name = 'sleep_user_profiles'
UNION ALL
SELECT 'sleep_night_observations', count(*) FROM information_schema.columns WHERE table_name = 'sleep_night_observations';