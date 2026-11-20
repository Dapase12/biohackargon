/**
 * Sleep Webhook Edge Function Entry Point.
 * Handles incoming webhook requests for sleep staging.
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

import {
  parseWebhookPayload,
  processWebhookPayload,
  type PipelineResult,
  type WebhookPayload,
} from './pipeline-index.ts';

// ── Configuration ────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SLEEP_WEBHOOK_SECRET = Deno.env.get('SLEEP_WEBHOOK_SECRET') ?? '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing required environment variables: SUPABASE_URL, SUPABASE_ANON_KEY');
}

if (!SLEEP_WEBHOOK_SECRET) {
  console.warn('SLEEP_WEBHOOK_SECRET not set - webhook authentication disabled');
}

// ── CORS Headers ────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Request Handler ──────────────────────────────────────────────────────────

async function handleRequest(req: Request): Promise<Response> {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Only accept POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Verify webhook secret
  const webhookSecret = req.headers.get('x-webhook-secret');
  if (SLEEP_WEBHOOK_SECRET && webhookSecret !== SLEEP_WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: 'Invalid webhook secret' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // Parse JSON payload
    const payload = await req.json() as WebhookPayload;

    // Process webhook payload
    const result = await processWebhookPayload(payload, SUPABASE_URL, SUPABASE_ANON_KEY);

    // Return result
    return new Response(JSON.stringify(result), {
      status: result.error ? 500 : 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('Webhook processing error:', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

// ── Start Server ─────────────────────────────────────────────────────────────

console.log('Sleep Webhook Edge Function started');
serve(handleRequest);