/**
 * Strain/TRIMP Webhook Edge Function
 *
 * Receives exercise/activity data and computes:
 * - Banister TRIMP from HR zones
 * - CTL/ATL/TSB (Training Stress Balance)
 * - Strain score (0-21 scale)
 *
 * Expected payload:
 * {
 *   "user_id": "uuid",
 *   "log_date": "2024-01-15",
 *   "hr_per_min": [120, 130, 145, ...],  // 1 Hz HR during exercise
 *   "resting_hr": 55,
 *   "max_hr": 190,
 *   "sex": "M",
 *   "wake_minutes": 960,
 *   "quiet_hrr": 0.35,
 *   "exercise_type": "running" | "strength" | "pickleball" | "shift"
 * }
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

interface StrainWebhookPayload {
  user_id: string;
  log_date: string;
  hr_per_min: number[];
  resting_hr: number;
  max_hr: number;
  sex: "M" | "F";
  wake_minutes?: number;
  quiet_hrr?: number;
  exercise_type?: "running" | "strength" | "pickleball" | "shift";
}

interface StrainResult {
  trimp: number;
  net_trimp: number;
  net_above_quiet: number;
  strain_score: number;
  ctl: number;
  atl: number;
  tsb: number;
  quiet_hrr: number | null;
  baseline_trimp: number;
  recommended_max_strain: number;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function verifyAuth(req: Request, supabase: any): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) return null;
  return user.id;
}

// Banister TRIMP calculation (ported from Python)
function banisterTrimp(
  hrPerMin: number[],
  restingHr: number,
  maxHr: number,
  sex: "M" | "F"
): number {
  if (!hrPerMin.length) return 0;

  const avgHr = hrPerMin.reduce((a, b) => a + b, 0) / hrPerMin.length;
  const hrr = (avgHr - restingHr) / (maxHr - restingHr);

  if (hrr <= 0) return 0;

  // Banister coefficients
  const k = sex === "M" ? 1.92 : 1.67;
  const durationMinutes = hrPerMin.length / 60;

  return durationMinutes * hrr * Math.exp(k * hrr);
}

// Daily quiet HRR
function dailyQuietWakingHrr(
  hrPerMin: number[],
  restingHr: number,
  maxHr: number,
  minMinutes = 60
): number | null {
  if (!hrPerMin.length) return null;

  // Find minimum 60-minute window
  const windowSize = minMinutes * 60; // samples
  if (hrPerMin.length < windowSize) return null;

  let minAvgHr = Infinity;
  for (let i = 0; i <= hrPerMin.length - windowSize; i++) {
    const window = hrPerMin.slice(i, i + windowSize);
    const avg = window.reduce((a, b) => a + b, 0) / window.length;
    if (avg < minAvgHr) minAvgHr = avg;
  }

  const hrr = (minAvgHr - restingHr) / (maxHr - restingHr);
  return hrr > 0 ? hrr : null;
}

// Baseline TRIMP
function baselineTrimp(wakeMinutes: number, quietHrr: number, female: boolean): number {
  const k = female ? 1.67 : 1.92;
  return wakeMinutes * quietHrr * Math.exp(k * quietHrr);
}

// Net TRIMP above quiet
function netTrimpAboveQuiet(
  hrPerMin: number[],
  restingHr: number,
  maxHr: number,
  quietHrr: number,
  sex: "M" | "F"
): number {
  const totalTrimp = banisterTrimp(hrPerMin, restingHr, maxHr, sex);
  const baseline = baselineTrimp(hrPerMin.length / 60, quietHrr, sex === "F");
  return Math.max(0, totalTrimp - baseline);
}

// Strain from net TRIMP (sigmoid)
function strainFromNetTrimp(netTrimp: number): number {
  if (netTrimp <= 0) return 0;
  const MAXIMAL_NET_TRIMP = 400;
  const STRAIN_CURVATURE = 10;
  const rawStrain = 21 * (1 - Math.exp(-netTrimp / STRAIN_CURVATURE));
  return Math.min(21, Math.max(0, rawStrain));
}

// CTL/ATL/TSB using EWMA
function ctlAtlTsb(dailyTrimp: number[], ctlDays = 42, atlDays = 7): { ctl: number; atl: number; tsb: number } {
  if (!dailyTrimp.length) return { ctl: 0, atl: 0, tsb: 0 };

  const ctlAlpha = 2 / (ctlDays + 1);
  const atlAlpha = 2 / (atlDays + 1);

  let ctl = dailyTrimp[0];
  let atl = dailyTrimp[0];

  for (let i = 1; i < dailyTrimp.length; i++) {
    ctl = ctl + ctlAlpha * (dailyTrimp[i] - ctl);
    atl = atl + atlAlpha * (dailyTrimp[i] - atl);
  }

  return {
    ctl: Math.round(ctl * 10) / 10,
    atl: Math.round(atl * 10) / 10,
    tsb: Math.round((ctl - atl) * 10) / 10,
  };
}

// Get recent daily TRIMP from Supabase
async function getRecentTrimp(supabase: any, userId: string, days: number): Promise<number[]> {
  const { data, error } = await supabase
    .from("computed_daily_scores")
    .select("strain_score, log_date")
    .eq("user_id", userId)
    .gte("log_date", new Date(Date.now() - days * 86400000).toISOString().split("T")[0])
    .order("log_date", { ascending: true });

  if (error || !data) return [];

  // Convert strain back to TRIMP approximation (reverse of strain curve)
  // This is approximate - better to store raw TRIMP
  return data.map(d => {
    if (!d.strain_score || d.strain_score <= 0) return 0;
    // Inverse of strain_from_net_trimp: net = -10 * ln(1 - strain/21)
    const strain = Math.min(20.9, d.strain_score);
    const netTrimp = -10 * Math.log(1 - strain / 21);
    // Approximate: assume baseline ~ 100, so total ≈ net + 100
    return netTrimp + 100;
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const userId = await verifyAuth(req, supabase);
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const payload: StrainWebhookPayload = await req.json();

    if (!payload.user_id || !payload.log_date || !payload.hr_per_min?.length) {
      return new Response(JSON.stringify({
        error: "Missing required fields: user_id, log_date, hr_per_min"
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (payload.user_id !== userId) {
      return new Response(JSON.stringify({ error: "User ID mismatch" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const {
      hr_per_min,
      resting_hr,
      max_hr,
      sex,
      wake_minutes = 960,
      quiet_hrr,
      exercise_type,
    } = payload;

    // Calculate TRIMP
    const trimp = banisterTrimp(hr_per_min, resting_hr, max_hr, sex);

    // Get or calculate quiet HRR
    let effectiveQuietHrr = quiet_hrr;
    if (effectiveQuietHrr == null) {
      // Try to get from sleep_user_profiles
      const { data: profile } = await supabase
        .from("sleep_user_profiles")
        .select("rmssd_med_ms, hr_sleep_median")
        .eq("user_id", userId)
        .single();

      if (profile?.hr_sleep_median) {
        effectiveQuietHrr = (profile.hr_sleep_median - resting_hr) / (max_hr - resting_hr);
      }
    }

    // Calculate net TRIMP above quiet
    let netAboveQuiet = 0;
    let baseline = 0;
    if (effectiveQuietHrr && effectiveQuietHrr > 0) {
      baseline = baselineTrimp(wake_minutes, effectiveQuietHrr, sex === "F");
      netAboveQuiet = netTrimpAboveQuiet(hr_per_min, resting_hr, max_hr, effectiveQuietHrr, sex);
    } else {
      // Without quiet HRR, use raw TRIMP as net
      netAboveQuiet = trimp;
    }

    // Strain score
    const strainScore = strainFromNetTrimp(netAboveQuiet);

    // Get recent TRIMP for CTL/ATL/TSB
    const recentTrimp = await getRecentTrimp(supabase, userId, 42);
    // Add today's TRIMP
    recentTrimp.push(trimp);

    const { ctl, atl, tsb } = ctlAtlTsb(recentTrimp);

    // Recommended max strain based on recovery (from computed_daily_scores)
    const { data: todayScores } = await supabase
      .from("computed_daily_scores")
      .select("recovery_score")
      .eq("user_id", userId)
      .eq("log_date", payload.log_date)
      .single();

    let recommendedMaxStrain = 10; // default
    if (todayScores?.recovery_score != null) {
      const rec = todayScores.recovery_score;
      if (rec >= 67) recommendedMaxStrain = 14;
      else if (rec >= 34) recommendedMaxStrain = 10;
      else recommendedMaxStrain = 6;
    }

    const result: StrainResult = {
      trimp: Math.round(trimp * 10) / 10,
      net_trimp: Math.round(netAboveQuiet * 10) / 10,
      net_above_quiet: Math.round(netAboveQuiet * 10) / 10,
      strain_score: Math.round(strainScore * 10) / 10,
      ctl,
      atl,
      tsb,
      quiet_hrr: effectiveQuietHrr ? Math.round(effectiveQuietHrr * 1000) / 1000 : null,
      baseline_trimp: Math.round(baseline * 10) / 10,
      recommended_max_strain: recommendedMaxStrain,
    };

    // Store in computed_daily_scores (upsert)
    await supabase
      .from("computed_daily_scores")
      .upsert({
        user_id: userId,
        log_date: payload.log_date,
        strain_score: result.strain_score,
        ctl: result.ctl,
        atl: result.atl,
        tsb: result.tsb,
        recommended_max_strain: result.recommended_max_strain,
        // Other fields will be filled by sleep webhook or manual entry
      }, { onConflict: "user_id,log_date" });

    return new Response(JSON.stringify({
      success: true,
      data: result,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Strain webhook error:", error);
    return new Response(JSON.stringify({
      error: "Internal server error",
      details: error instanceof Error ? error.message : "Unknown error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});