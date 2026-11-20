-- ============================================================================
-- ARGON v6.0 — Insert Test Sleep Data for UI Validation
-- Ejecutar en Supabase SQL Editor
-- User ID: fcda98e0-9c9c-47b5-a6bf-8333dc6fe461
-- ============================================================================

-- Insert test sleep segmentation for today (or recent dates)
-- Using 30-second epochs for 8 hours of sleep (960 epochs)
-- Stages: 0=wake, 1=nrem, 2=rem

DO $$
DECLARE
    test_user_id uuid := 'fcda98e0-9c9c-47b5-a6bf-8333dc6fe461';
    seg_id bigint;
    epoch_sec int := 30;
    total_epochs int := 960; -- 8 hours * 3600 / 30
    stages int[];
    deep_flags boolean[];
    i int;
    session_start timestamptz := (now() - interval '8 hours')::timestamptz;
    session_end timestamptz := now()::timestamptz;
    sleep_onset timestamptz := (now() - interval '7 hours 30 minutes')::timestamptz;
    sleep_offset timestamptz := (now() - interval '30 minutes')::timestamptz;
    log_date date := CURRENT_DATE;
BEGIN
    -- Generate realistic sleep stages for 8 hours
    -- First 30 min: wake (60 epochs)
    -- Then NREM/REM cycles: ~90 min cycles
    -- Typical: NREM (light) -> NREM (deep) -> NREM (light) -> REM
    -- Total: ~4-5 cycles in 7 hours

    stages := ARRAY[]::int[];
    deep_flags := ARRAY[]::boolean[];

    -- First 30 min: wake (60 epochs)
    FOR i IN 1..60 LOOP
        stages := stages || 0;
        deep_flags := deep_flags || false;
    END LOOP;

    -- Sleep onset: 7.5 hours ago
    -- Cycle 1: 90 min = 180 epochs
    -- NREM light: 30 min (60 epochs)
    FOR i IN 1..60 LOOP
        stages := stages || 1;
        deep_flags := deep_flags || false;
    END LOOP;
    -- NREM deep: 30 min (60 epochs)
    FOR i IN 1..60 LOOP
        stages := stages || 1;
        deep_flags := deep_flags || true;
    END LOOP;
    -- NREM light: 15 min (30 epochs)
    FOR i IN 1..30 LOOP
        stages := stages || 1;
        deep_flags := deep_flags || false;
    END LOOP;
    -- REM: 15 min (30 epochs)
    FOR i IN 1..30 LOOP
        stages := stages || 2;
        deep_flags := deep_flags || false;
    END LOOP;

    -- Cycle 2: 90 min = 180 epochs
    FOR i IN 1..60 LOOP
        stages := stages || 1; deep_flags := deep_flags || false;
    END LOOP;
    FOR i IN 1..60 LOOP
        stages := stages || 1; deep_flags := deep_flags || true;
    END LOOP;
    FOR i IN 1..30 LOOP
        stages := stages || 1; deep_flags := deep_flags || false;
    END LOOP;
    FOR i IN 1..30 LOOP
        stages := stages || 2; deep_flags := deep_flags || false;
    END LOOP;

    -- Cycle 3: 90 min = 180 epochs
    FOR i IN 1..60 LOOP
        stages := stages || 1; deep_flags := deep_flags || false;
    END LOOP;
    FOR i IN 1..60 LOOP
        stages := stages || 1; deep_flags := deep_flags || true;
    END LOOP;
    FOR i IN 1..30 LOOP
        stages := stages || 1; deep_flags := deep_flags || false;
    END LOOP;
    FOR i IN 1..30 LOOP
        stages := stages || 2; deep_flags := deep_flags || false;
    END LOOP;

    -- Cycle 4: 90 min = 180 epochs
    FOR i IN 1..60 LOOP
        stages := stages || 1; deep_flags := deep_flags || false;
    END LOOP;
    FOR i IN 1..45 LOOP
        stages := stages || 1; deep_flags := deep_flags || true;
    END LOOP;
    FOR i IN 1..30 LOOP
        stages := stages || 1; deep_flags := deep_flags || false;
    END LOOP;
    FOR i IN 1..45 LOOP
        stages := stages || 2; deep_flags := deep_flags || false;
    END LOOP;

    -- Cycle 5: 60 min = 120 epochs (to reach 7 hours = 840 epochs in sleep window)
    FOR i IN 1..30 LOOP
        stages := stages || 1; deep_flags := deep_flags || false;
    END LOOP;
    FOR i IN 1..30 LOOP
        stages := stages || 1; deep_flags := deep_flags || true;
    END LOOP;
    FOR i IN 1..30 LOOP
        stages := stages || 1; deep_flags := deep_flags || false;
    END LOOP;
    FOR i IN 1..30 LOOP
        stages := stages || 2; deep_flags := deep_flags || false;
    END LOOP;

    -- Final wake: 30 min = 60 epochs
    FOR i IN 1..60 LOOP
        stages := stages || 0;
        deep_flags := deep_flags || false;
    END LOOP;

    -- Verify total epochs
    RAISE NOTICE 'Total epochs: %', array_length(stages, 1);

    -- Insert into sleep_segmentations
    INSERT INTO sleep_segmentations (
        user_id,
        log_date,
        session_start,
        session_end,
        sleep_onset,
        sleep_offset,
        epoch_sec,
        stages,
        deep_flags,
        total_epochs,
        wake_pct,
        nrem_pct,
        rem_pct,
        deep_pct,
        unobserved_sec,
        confidence,
        sleep_windows,
        config
    ) VALUES (
        test_user_id,
        log_date,
        session_start,
        session_end,
        sleep_onset,
        sleep_offset,
        epoch_sec,
        stages,
        deep_flags,
        total_epochs,
        12.5,  -- wake_pct: 120 epochs / 960 * 100
        70.31, -- nrem_pct: 675 epochs / 960 * 100
        17.19, -- rem_pct: 165 epochs / 960 * 100
        26.56, -- deep_pct: 255 epochs / 960 * 100 (subset of NREM)
        0,
        0.92,
        jsonb_build_array(jsonb_build_object('start', sleep_onset, 'end', sleep_offset)),
        jsonb_build_object('epoch_sec', 30, 'algorithm', 'van_hees_cardio')
    ) RETURNING id INTO seg_id;

    RAISE NOTICE 'Inserted sleep_segmentation with id: %', seg_id;

    -- Insert epoch features for this segmentation
    -- We'll create a subset of epochs with realistic features
    -- For brevity, insert features for every 10th epoch (96 epochs)
    -- In reality, you'd insert all 960 epochs
    FOR i IN 0..95 LOOP
        INSERT INTO sleep_epoch_features (
            segmentation_id,
            epoch_index,
            epoch_start,
            enmo_median,
            enmo_p95,
            still_frac,
            immobile_frac,
            hr_median,
            hr_p5,
            hr_p25,
            valid_hr_frac,
            rmssd_ms,
            lfhf_ratio,
            rk_bpm,
            valid_rr_frac,
            stage,
            deep_flag
        ) VALUES (
            seg_id,
            i * 10,
            session_start + (i * 10 * epoch_sec) * interval '1 second',
            CASE WHEN (i * 10) < 60 THEN 0.05 ELSE 0.01 END, -- Higher ENMO during wake
            CASE WHEN (i * 10) < 60 THEN 0.1 ELSE 0.02 END,
            CASE WHEN (i * 10) < 60 THEN 0.3 ELSE 0.9 END,
            CASE WHEN (i * 10) < 60 THEN 0.2 ELSE 0.85 END,
            CASE
                WHEN (i * 10) < 60 THEN 75  -- Wake HR
                WHEN stages[i * 10 + 1] = 2 THEN 60  -- REM HR
                ELSE 55  -- NREM HR
            END,
            CASE
                WHEN (i * 10) < 60 THEN 70
                WHEN stages[i * 10 + 1] = 2 THEN 55
                ELSE 50
            END,
            CASE
                WHEN (i * 10) < 60 THEN 72
                WHEN stages[i * 10 + 1] = 2 THEN 57
                ELSE 53
            END,
            0.95,
            CASE
                WHEN (i * 10) < 60 THEN NULL
                WHEN stages[i * 10 + 1] = 2 THEN 35
                ELSE 45
            END,
            CASE
                WHEN (i * 10) < 60 THEN NULL
                WHEN stages[i * 10 + 1] = 2 THEN 2.5
                ELSE 1.5
            END,
            CASE
                WHEN (i * 10) < 60 THEN NULL
                WHEN stages[i * 10 + 1] = 2 THEN 2.0
                ELSE 1.0
            END,
            0.9,
            stages[i * 10 + 1],
            deep_flags[i * 10 + 1]
        );
    END LOOP;

    RAISE NOTICE 'Inserted epoch features for segmentation %', seg_id;

    -- Insert night observation
    INSERT INTO sleep_night_observations (
        user_id,
        segmentation_id,
        log_date,
        hr_floor_p5,
        hr_floor_p25,
        hr_sleep_median,
        hr_arousal,
        rmssd_med_ms,
        rmssd_mad_ms,
        enmo_still_cut_g,
        enmo_move_cut_g,
        lfhf_med,
        rk_med_bpm
    ) VALUES (
        test_user_id,
        seg_id,
        log_date,
        50.0,
        53.0,
        55.0,
        65.0,
        42.0,
        5.0,
        0.015,
        0.05,
        1.8,
        1.2
    );

    RAISE NOTICE 'Inserted night observation for segmentation %', seg_id;

    -- Insert/update user profile
    INSERT INTO sleep_user_profiles (
        user_id,
        nights,
        hr_floor_p5,
        hr_floor_p25,
        hr_sleep_median,
        hr_arousal,
        rmssd_med_ms,
        rmssd_mad_ms,
        enmo_still_cut_g,
        enmo_move_cut_g,
        lfhf_med,
        rk_med_bpm,
        personal_weight
    ) VALUES (
        test_user_id,
        1,
        50.0,
        53.0,
        55.0,
        65.0,
        42.0,
        5.0,
        0.015,
        0.05,
        1.8,
        1.2,
        0.0357 -- 1/28
    ) ON CONFLICT (user_id) DO UPDATE SET
        nights = sleep_user_profiles.nights + 1,
        hr_floor_p5 = EXCLUDED.hr_floor_p5,
        hr_floor_p25 = EXCLUDED.hr_floor_p25,
        hr_sleep_median = EXCLUDED.hr_sleep_median,
        hr_arousal = EXCLUDED.hr_arousal,
        rmssd_med_ms = EXCLUDED.rmssd_med_ms,
        rmssd_mad_ms = EXCLUDED.rmssd_mad_ms,
        enmo_still_cut_g = EXCLUDED.enmo_still_cut_g,
        enmo_move_cut_g = EXCLUDED.enmo_move_cut_g,
        lfhf_med = EXCLUDED.lfhf_med,
        rk_med_bpm = EXCLUDED.rk_med_bpm,
        personal_weight = LEAST((sleep_user_profiles.nights + 1)::numeric / 28.0, 0.5),
        updated_at = now();

    RAISE NOTICE 'Updated sleep_user_profile for user %', test_user_id;
END $$;

-- Verification query
SELECT
    ss.id,
    ss.user_id,
    ss.log_date,
    ss.total_epochs,
    ss.epoch_sec,
    ss.wake_pct,
    ss.nrem_pct,
    ss.rem_pct,
    ss.deep_pct,
    ss.confidence,
    array_length(ss.stages, 1) as stages_count,
    array_length(ss.deep_flags, 1) as deep_flags_count,
    COUNT(ef.id) as epoch_features_count
FROM sleep_segmentations ss
LEFT JOIN sleep_epoch_features ef ON ef.segmentation_id = ss.id
WHERE ss.user_id = 'fcda98e0-9c9c-47b5-a6bf-8333dc6fe461'
GROUP BY ss.id, ss.user_id, ss.log_date, ss.total_epochs, ss.epoch_sec, ss.wake_pct, ss.nrem_pct, ss.rem_pct, ss.deep_pct, ss.confidence, ss.stages, ss.deep_flags
ORDER BY ss.log_date DESC;