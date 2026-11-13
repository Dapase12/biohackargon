/**
 * Sleep Staging Webhook Edge Function
 *
 * Receives 1 Hz sleep data from Health Connect → Google Apps Script → Supabase
 * Processes through Argon sleep staging pipeline
 * Stores results in sleep_segmentations, sleep_epoch_features, sleep_night_observations, sleep_user_profiles
 *
 * Expected payload:
 * {
 *   "user_id": "uuid",
 *   "log_date": "2024-01-15",
 *   "accel": [{"ts_ms": 1234567890000, "x": 0.0, "y": 0.0, "z": 1.0, "valid": true}, ...],
 *   "hr": [{"ts_ms": 1234567890000, "hr": 55}, ...],
 *   "rr": [{"ts_ms": [1234567890000, ...], "rr_ms": [1000, 1010, ...]}, ...],
 *   "in_bed_start_s": 1234567890,
 *   "in_bed_end_s": 1234597890,
 *   "config": {"epoch_sec": 30, ...}
 * }
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// Types matching Python pipeline
interface RawSleepData {
  user_id: string;
  log_date: string;
  accel: Array<{ ts_ms: number; x: number; y: number; z: number; valid?: boolean }>;
  hr: Array<{ ts_ms: number; hr: number }>;
  rr: Array<{ ts_ms: number | number[]; rr_ms: number[] }>;
  in_bed_start_s: number;
  in_bed_end_s: number;
  config?: Record<string, unknown>;
}

interface PipelineResult {
  segmentation: {
    stages: number[];
    deep_flag: boolean[];
    sleep_onset_s: number | null;
    sleep_offset_s: number | null;
    in_bed_start_s: number;
    in_bed_end_s: number;
    epoch_sec: number;
    confidence: number;
    unobserved_sec: number;
  };
  features: Array<{
    epoch_start_s: number;
    enmo_median: number | null;
    enmo_p95: number | null;
    still_frac: number | null;
    immobile_frac: number | null;
    hr_median: number | null;
    hr_p5: number | null;
    hr_p25: number | null;
    valid_hr_frac: number | null;
    rmssd_ms: number | null;
    lfhf_ratio: number | null;
    rk_bpm: number | null;
    valid_rr_frac: number | null;
    stage: number;
    deep_flag: boolean;
  }>;
  observation: {
    hr_floor_p5: number | null;
    hr_floor_p25: number | null;
    hr_sleep_median: number | null;
    hr_arousal: number | null;
    rmssd_med_ms: number | null;
    rmssd_mad_ms: number | null;
    enmo_still_cut_g: number | null;
    enmo_move_cut_g: number | null;
    lfhf_med: number | null;
    rk_med_bpm: number | null;
  } | null;
  profile: {
    nights: number;
    hr_floor_p5: number | null;
    hr_floor_p25: number | null;
    hr_sleep_median: number | null;
    hr_arousal: number | null;
    rmssd_med_ms: number | null;
    rmssd_mad_ms: number | null;
    enmo_still_cut_g: number | null;
    enmo_move_cut_g: number | null;
    lfhf_med: number | null;
    rk_med_bpm: number | null;
    personal_weight: number;
  } | null;
  stored: boolean;
  error: string | null;
}

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Verify JWT token
async function verifyAuth(req: Request, supabase: any): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return null;
  }

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return null;
  }

  return user.id;
}

// Parse RR series - handle both formats
function parseRRSeries(rrData: Array<{ ts_ms: number | number[]; rr_ms: number[] }>) {
  const series = [];
  for (const d of rrData) {
    try {
      let tsMs: number[];
      if (Array.isArray(d.ts_ms)) {
        tsMs = d.ts_ms;
      } else {
        // Single timestamp - assume it's the last beat
        tsMs = [d.ts_ms as number];
      }

      if (!Array.isArray(d.rr_ms)) continue;

      // If we have RR intervals but only one timestamp, reconstruct beat times
      if (tsMs.length === 1 && d.rr_ms.length > 1) {
        const endTime = tsMs[0];
        tsMs = [];
        let currentTime = endTime;
        for (let i = d.rr_ms.length - 1; i >= 0; i--) {
          tsMs.unshift(currentTime);
          currentTime -= d.rr_ms[i];
        }
      }

      if (tsMs.length === d.rr_ms.length) {
        series.push({ ts_ms: tsMs, rr_ms: d.rr_ms });
      }
    } catch (e) {
      continue;
    }
  }
  return series;
}

// Call Python pipeline via HTTP (since we can't import Python directly)
// In production, this would call a separate Python service or use a WASM build
// For now, we implement the core logic in TypeScript or call a deployed service
async function processSleepData(raw: RawSleepData, supabaseUrl: string, supabaseKey: string): Promise<PipelineResult> {
  // For now, we'll call a Python service endpoint
  // In the future, we could use Pyodide/WASM or a dedicated Python service

  const pythonServiceUrl = Deno.env.get("PYTHON_PIPELINE_URL") || "";

  if (pythonServiceUrl) {
    try {
      const response = await fetch(`${pythonServiceUrl}/process-sleep`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(raw),
      });

      if (response.ok) {
        return await response.json();
      }
    } catch (e) {
      console.error("Python service error:", e);
    }
  }

  // Fallback: minimal processing to store raw data structure
  // This is a placeholder - real implementation needs Python service
  return {
    segmentation: {
      stages: [],
      deep_flag: [],
      sleep_onset_s: null,
      sleep_offset_s: null,
      in_bed_start_s: raw.in_bed_start_s,
      in_bed_end_s: raw.in_bed_end_s,
      epoch_sec: raw.config?.epoch_sec as number || 30,
      confidence: 0,
      unobserved_sec: 0,
    },
    features: [],
    observation: null,
    profile: null,
    stored: false,
    error: "Python pipeline service not configured",
  };
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Initialize Supabase client
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Verify authentication
  const userId = await verifyAuth(req, supabase);
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const payload = await req.json();

    // Validate required fields
    if (!payload.user_id || !payload.log_date || !payload.accel || !payload.hr) {
      return new Response(JSON.stringify({
        error: "Missing required fields: user_id, log_date, accel, hr"
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify user_id matches authenticated user
    if (payload.user_id !== userId) {
      return new Response(JSON.stringify({ error: "User ID mismatch" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse RR data
    const parsedRr = parseRRSeries(payload.rr || []);

    const rawData: RawSleepData = {
      user_id: payload.user_id,
      log_date: payload.log_date,
      accel: payload.accel,
      hr: payload.hr,
      rr: parsedRr,
      in_bed_start_s: payload.in_bed_start_s,
      in_bed_end_s: payload.in_bed_end_s,
      config: payload.config,
    };

    // Process through pipeline
    const result = await processSleepData(rawData, supabaseUrl, supabaseKey);

    return new Response(JSON.stringify({
      success: !result.error,
      data: result,
    }), {
      status: result.error ? 500 : 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(JSON.stringify({
      error: "Internal server error",
      details: error instanceof Error ? error.message : "Unknown error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});