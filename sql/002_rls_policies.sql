-- ARGON v6.0 - RLS Policies & Multi-User Support
-- Run AFTER: 001_initial_schema.sql, expand_computed_daily_scores.sql, sleep_staging_schema.sql
-- Requires: Supabase Auth enabled

-- ========================================================================
-- ADD user_id COLUMNS (if not already present from initial schema)
-- ========================================================================

-- daily_raw_biometrics
ALTER TABLE daily_raw_biometrics
ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- computed_daily_scores
ALTER TABLE computed_daily_scores
ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- webhook_logs
ALTER TABLE webhook_logs
ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- sleep_staging tables (if they exist)
DO $$ BEGIN
    ALTER TABLE sleep_segmentations ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE sleep_epoch_features ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE sleep_user_profiles ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE sleep_night_observations ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ========================================================================
-- BACKFILL EXISTING DATA (single-user mode)
-- Replace '00000000-0000-0000-0000-000000000001' with actual user UUID from config
-- ========================================================================
-- NOTE: Run this manually after creating your first user via Supabase Auth
-- UPDATE daily_raw_biometrics SET user_id = 'YOUR_USER_UUID_HERE' WHERE user_id IS NULL;
-- UPDATE computed_daily_scores SET user_id = 'YOUR_USER_UUID_HERE' WHERE user_id IS NULL;
-- UPDATE webhook_logs SET user_id = 'YOUR_USER_UUID_HERE' WHERE user_id IS NULL;

-- ========================================================================
-- UNIQUE CONSTRAINTS FOR UPSERT (user_id + log_date)
-- ========================================================================

-- Drop old unique indexes if they exist (without user_id)
DROP INDEX IF EXISTS uq_daily_raw_user_date;
DROP INDEX IF EXISTS uq_computed_user_date;

-- Create new unique indexes with user_id
CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_raw_user_date
    ON daily_raw_biometrics (user_id, log_date);

CREATE UNIQUE INDEX IF NOT EXISTS uq_computed_user_date
    ON computed_daily_scores (user_id, log_date);

-- Sleep staging unique indexes
DO $$ BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sleep_segmentations_user_date
        ON sleep_segmentations (user_id, log_date);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sleep_user_profiles_user
        ON sleep_user_profiles (user_id);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ========================================================================
-- ENABLE ROW LEVEL SECURITY
-- ========================================================================

ALTER TABLE daily_raw_biometrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE computed_daily_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    ALTER TABLE sleep_segmentations ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE sleep_epoch_features ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE sleep_user_profiles ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE sleep_night_observations ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ========================================================================
-- RLS POLICIES: "Users can only access their own data"
-- ========================================================================

-- daily_raw_biometrics
DROP POLICY IF EXISTS "Users own daily_raw_biometrics" ON daily_raw_biometrics;
CREATE POLICY "Users own daily_raw_biometrics"
    ON daily_raw_biometrics
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- computed_daily_scores
DROP POLICY IF EXISTS "Users own computed_daily_scores" ON computed_daily_scores;
CREATE POLICY "Users own computed_daily_scores"
    ON computed_daily_scores
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- webhook_logs
DROP POLICY IF EXISTS "Users own webhook_logs" ON webhook_logs;
CREATE POLICY "Users own webhook_logs"
    ON webhook_logs
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Sleep staging tables
DO $$ BEGIN
    DROP POLICY IF EXISTS "Users own sleep_segmentations" ON sleep_segmentations;
    CREATE POLICY "Users own sleep_segmentations"
        ON sleep_segmentations
        FOR ALL
        USING (auth.uid() = user_id)
        WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
    DROP POLICY IF EXISTS "Users own sleep_epoch_features" ON sleep_epoch_features;
    CREATE POLICY "Users own sleep_epoch_features"
        ON sleep_epoch_features
        FOR ALL
        USING (auth.uid() = user_id)
        WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
    DROP POLICY IF EXISTS "Users own sleep_user_profiles" ON sleep_user_profiles;
    CREATE POLICY "Users own sleep_user_profiles"
        ON sleep_user_profiles
        FOR ALL
        USING (auth.uid() = user_id)
        WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
    DROP POLICY IF EXISTS "Users own sleep_night_observations" ON sleep_night_observations;
    CREATE POLICY "Users own sleep_night_observations"
        ON sleep_night_observations
        FOR ALL
        USING (auth.uid() = user_id)
        WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ========================================================================
-- PROFILES TABLE (for user configuration used by Apps Script)
-- ========================================================================
CREATE TABLE IF NOT EXISTS profiles (
    user_id                 uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    birth_date              date NOT NULL,
    height_m                numeric(4,2) NOT NULL,
    timezone                text NOT NULL DEFAULT 'America/Caracas',
    basal_sleep_need_h      numeric(3,1) NOT NULL DEFAULT 7.5,
    habitual_wake           time NOT NULL DEFAULT '06:30',
    goal_weight_kg          numeric(5,2),
    goal_date               date,
    daily_deficit_kcal      integer DEFAULT 500,
    biological_sex          text CHECK (biological_sex IN ('male', 'female')) NOT NULL,
    -- Computed/derived
    chronological_age_years numeric(4,1) GENERATED ALWAYS AS (
        EXTRACT(year FROM age(birth_date)) + EXTRACT(month FROM age(birth_date))/12.0
    ) STORED,
    created_at              timestamptz DEFAULT now(),
    updated_at              timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users own profiles" ON profiles;
CREATE POLICY "Users own profiles"
    ON profiles
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ========================================================================
-- SERVICE ROLE POLICIES (for Apps Script / server-side operations)
-- Apps Script uses service role key to bypass RLS for upserts
-- ========================================================================

-- Service role can do everything (bypasses RLS automatically in Supabase)
-- But we can add explicit policies if needed for specific service operations

-- ========================================================================
-- HELPER FUNCTION: Get current user's profile
-- ========================================================================
CREATE OR REPLACE FUNCTION get_my_profile()
RETURNS profiles
LANGUAGE sql STABLE AS $$
    SELECT * FROM profiles WHERE user_id = auth.uid();
$$;

-- ========================================================================
-- HELPER FUNCTION: Get latest computed scores for current user
-- ========================================================================
CREATE OR REPLACE FUNCTION get_my_latest_scores(p_limit integer DEFAULT 30)
RETURNS SETOF computed_daily_scores
LANGUAGE sql STABLE AS $$
    SELECT * FROM computed_daily_scores
    WHERE user_id = auth.uid()
    ORDER BY log_date DESC
    LIMIT p_limit;
$$;

-- ========================================================================
-- HELPER FUNCTION: Get raw biometrics for current user in range
-- ========================================================================
CREATE OR REPLACE FUNCTION get_my_raw_biometrics(p_start_date date, p_end_date date)
RETURNS SETOF daily_raw_biometrics
LANGUAGE sql STABLE AS $$
    SELECT * FROM daily_raw_biometrics
    WHERE user_id = auth.uid()
    AND log_date BETWEEN p_start_date AND p_end_date
    ORDER BY log_date DESC;
$$;

-- ========================================================================
-- NOTES
-- ========================================================================
-- 1. After running this migration, create a user via Supabase Auth
-- 2. Insert their profile into `profiles` table
-- 3. Backfill existing data with: UPDATE ... SET user_id = 'UUID' WHERE user_id IS NULL;
-- 4. Apps Script must use SERVICE_ROLE_KEY (not anon key) for upserts
-- 5. PWA uses anon key + user session for reads (RLS enforced)
-- 6. Single-user mode: disable RLS temporarily or use service role for all operations