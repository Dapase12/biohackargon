/**
 * ARGON v6.0 — Supabase Client Wrapper
 * Thin client: reads computed data, writes raw biometrics via GAS webhook.
 * Import from: import { sb, sbGet, sbUpsert } from '@/api/client';
 *
 * Uses window.supabase from CDN (single instance) to avoid "Multiple GoTrueClient instances" warning.
 */

import type { Database } from '@/types';
import { STORAGE_KEYS } from '@/constants';

// Get createClient from window.supabase (loaded via CDN in index.html)
function getCreateClient() {
  if (typeof window !== 'undefined' && window.supabase?.createClient) {
    return window.supabase.createClient;
  }
  // Fallback for tests/SSR - dynamic import
  return import('@supabase/supabase-js').then(m => m.createClient);
}

// ============================================================
// CONFIG ACCESS (reads from localStorage + window.CONFIG fallback)
// ============================================================
function getSbConfig(): { url: string; key: string } {
  const url = (localStorage.getItem(STORAGE_KEYS.SB_URL) || '').trim();
  const key = (localStorage.getItem(STORAGE_KEYS.SB_KEY) || '').trim();
  return { url, key };
}

function getUserId(): string | null {
  const stored = localStorage.getItem(STORAGE_KEYS.USER_ID);
  return stored?.trim() || null;
}

// ============================================================
// CLIENT INSTANCE (lazy singleton, async)
// ============================================================
let _client: SupabaseClient<Database> | null = null;
let _clientPromise: Promise<SupabaseClient<Database> | null> | null = null;

export function getClient(): SupabaseClient<Database> | null {
  // Synchronous access - returns client if already initialized
  return _client;
}

export async function getClientAsync(): Promise<SupabaseClient<Database> | null> {
  if (_client) return _client;
  if (_clientPromise) return _clientPromise;

  const { url, key } = getSbConfig();
  if (!url || !key) {
    return null;
  }

  _clientPromise = (async () => {
    const createClient = await getCreateClient();
    _client = createClient<Database>(url, key, {
      auth: { persistSession: false },
      global: { headers: { 'x-client-info': 'argon-pwa/6.0' } },
    });
    return _client;
  })();

  return _clientPromise;
}

export function resetClient(): void {
  _client = null;
  _clientPromise = null;
}

// Expose for backward compatibility with existing code
// Note: This Proxy now uses getClientAsync internally for async methods
export const supabaseClient = new Proxy({} as SupabaseClient<Database>, {
  get(_, prop) {
    const client = getClient();
    if (!client) {
      // For async methods, we need to handle this differently
      // Throw only for synchronous property access
      throw new Error('Supabase no configurado: ve a ⚙️ Ajustes');
    }
    return client[prop as keyof SupabaseClient<Database>];
  },
});

// ============================================================
// READ HELPERS (typed, with user_id filter) - ASYNC
// ============================================================
type TableName = keyof Database['public']['Tables'] | keyof Database['public']['Views'];

interface QueryParams {
  select?: string;
  filters?: Record<string, string>;
  order?: { column: string; ascending?: boolean };
  limit?: number;
  range?: [number, number];
}

async function request<T>(
  table: TableName,
  params: QueryParams = {}
): Promise<T[]> {
  const client = await getClientAsync();
  if (!client) {
    throw new Error('Supabase no configurado: ve a ⚙️ Ajustes');
  }
  const userId = getUserId();

  // Cast client to any for Supabase query builder (union table type not supported)
  const qb: any = client;
  let query = qb.from(table).select(params.select || '*');

  // Auto-filter by user_id ONLY for tables that have the column
  const tablesWithUserId = ['sleep_user_profiles', 'user_clinical_profile'];
  if (userId && tablesWithUserId.includes(table as string)) {
    query = query.eq('user_id', userId);
  }

  // Additional filters - support PostgREST operators (eq., gte., gt., lte., lt., like., ilike., in., etc.)
  if (params.filters) {
    Object.entries(params.filters).forEach(([key, value]) => {
      if (value.startsWith('gte.')) {
        query = query.gte(key, value.slice(4));
      } else if (value.startsWith('gt.')) {
        query = query.gt(key, value.slice(3));
      } else if (value.startsWith('lte.')) {
        query = query.lte(key, value.slice(4));
      } else if (value.startsWith('lt.')) {
        query = query.lt(key, value.slice(3));
      } else if (value.startsWith('like.')) {
        query = query.like(key, value.slice(5));
      } else if (value.startsWith('ilike.')) {
        query = query.ilike(key, value.slice(6));
      } else if (value.startsWith('in.')) {
        query = query.in(key, value.slice(3).split(','));
      } else if (value.startsWith('neq.')) {
        query = query.neq(key, value.slice(4));
      } else if (value.startsWith('is.')) {
        query = query.is(key, value.slice(3));
      } else if (value.startsWith('eq.')) {
        query = query.eq(key, value.slice(3));
      } else {
        // Default to exact match (no prefix)
        query = query.eq(key, value);
      }
    });
  }

  // Ordering
  if (params.order) {
    query = query.order(params.order.column, { ascending: params.order.ascending ?? false });
  }

  // Pagination
  if (params.limit) {
    query = query.limit(params.limit);
  } else if (params.range) {
    query = query.range(params.range[0], params.range[1]);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Supabase ${table}: ${error.message}`);
  return (data as T[]) || [];
}

// ============================================================
// TYPED FETCH FUNCTIONS (all async)
// ============================================================
export async function sbGetComputedDailyScores(
  daysBack = 30,
  options?: { userId?: string }
): Promise<Database['public']['Tables']['computed_daily_scores']['Row'][]> {
  const since = new Date(Date.now() - daysBack * 86_400_000).toISOString().split('T')[0];
  return request('computed_daily_scores', {
    filters: { log_date: `gte.${since}` },
    order: { column: 'log_date', ascending: false },
    limit: daysBack + 5,
  });
}

export async function sbGetRawBiometrics(
  daysBack = 30
): Promise<Database['public']['Tables']['daily_raw_biometrics']['Row'][]> {
  const since = new Date(Date.now() - daysBack * 86_400_000).toISOString().split('T')[0];
  return request('daily_raw_biometrics', {
    filters: { log_date: `gte.${since}` },
    order: { column: 'log_date', ascending: false },
    limit: daysBack + 5,
  });
}

export async function sbGetSleepSegmentations(
  daysBack = 30
): Promise<Database['public']['Tables']['sleep_segmentations']['Row'][]> {
  const since = new Date(Date.now() - daysBack * 86_400_000).toISOString().split('T')[0];
  return request('sleep_segmentations', {
    filters: { log_date: `gte.${since}` },
    order: { column: 'log_date', ascending: false },
    limit: daysBack,
  });
}

export async function sbGetSleepEpochs(
  segmentationId: number
): Promise<Database['public']['Tables']['sleep_epoch_features']['Row'][]> {
  return request('sleep_epoch_features', {
    filters: { segmentation_id: `eq.${segmentationId}` },
    order: { column: 'epoch_index', ascending: true },
  });
}

export async function sbGetNightObservations(
  daysBack = 30
): Promise<Database['public']['Tables']['sleep_night_observations']['Row'][]> {
  const since = new Date(Date.now() - daysBack * 86_400_000).toISOString().split('T')[0];
  return request('sleep_night_observations', {
    filters: { log_date: `gte.${since}` },
    order: { column: 'log_date', ascending: false },
    limit: daysBack,
  });
}

export async function sbGetSleepProfile(): Promise<Database['public']['Tables']['sleep_user_profiles']['Row'] | null> {
  const userId = getUserId();
  if (!userId) return null;
  const data = await request<Database['public']['Tables']['sleep_user_profiles']['Row']>('sleep_user_profiles', {
    filters: { user_id: `eq.${userId}` },
    limit: 1,
  });
  return data[0] || null;
}

export async function sbGetSleepDailyScores(
  daysBack = 30
): Promise<Database['public']['Views']['sleep_daily_scores']['Row'][]> {
  const since = new Date(Date.now() - daysBack * 86_400_000).toISOString().split('T')[0];
  return request<Database['public']['Views']['sleep_daily_scores']['Row']>('sleep_daily_scores', {
    filters: { log_date: `gte.${since}` },
    order: { column: 'log_date', ascending: false },
    limit: daysBack,
  });
}

export async function sbGetUserProfile(): Promise<Database['public']['Tables']['user_clinical_profile']['Row'] | null> {
  const userId = getUserId();
  if (!userId) return null;
  const data = await request<Database['public']['Tables']['user_clinical_profile']['Row']>('user_clinical_profile', {
    filters: { id: `eq.${userId}` },
    limit: 1,
  });
  return data[0] || null;
}

// ============================================================
// WRITE HELPERS (raw biometrics only — computed is server-side)
// ============================================================
export async function sbUpsertRawBiometric(
  payload: Database['public']['Tables']['daily_raw_biometrics']['Insert']
): Promise<Database['public']['Tables']['daily_raw_biometrics']['Row']> {
  const client = await getClientAsync();
  if (!client) throw new Error('Supabase no configurado');
  const { data, error } = await client
    .from('daily_raw_biometrics')
    .upsert(payload, { onConflict: 'log_date' })
    .select()
    .single();
  if (error) throw new Error(`Upsert raw biometric: ${error.message}`);
  return data;
}

export async function sbInsertWebhookLog(
  payload: Database['public']['Tables']['webhook_logs']['Insert']
): Promise<Database['public']['Tables']['webhook_logs']['Row']> {
  const client = await getClientAsync();
  if (!client) throw new Error('Supabase no configurado');
  const { data, error } = await client
    .from('webhook_logs')
    .insert(payload)
    .select()
    .single();
  if (error) throw new Error(`Insert webhook log: ${error.message}`);
  return data;
}

// ============================================================
// RANGE LOADER (for sync)
// ============================================================
export async function sbLoadRange(
  startDate: string,
  endDate: string
): Promise<{
  raw: Record<string, Database['public']['Tables']['daily_raw_biometrics']['Row']>;
  computed: Record<string, Database['public']['Tables']['computed_daily_scores']['Row']>;
}> {
  const [rawData, compData] = await Promise.all([
    request<Database['public']['Tables']['daily_raw_biometrics']['Row']>('daily_raw_biometrics', {
      filters: { log_date: `gte.${startDate},lte.${endDate}` },
      order: { column: 'log_date', ascending: false },
      limit: 100,
    }),
    request<Database['public']['Tables']['computed_daily_scores']['Row']>('computed_daily_scores', {
      filters: { log_date: `gte.${startDate},lte.${endDate}` },
      order: { column: 'log_date', ascending: false },
      limit: 100,
    }),
  ]);

  const rawMap: Record<string, Database['public']['Tables']['daily_raw_biometrics']['Row']> = {};
  const compMap: Record<string, Database['public']['Tables']['computed_daily_scores']['Row']> = {};

  rawData.forEach((r: Database['public']['Tables']['daily_raw_biometrics']['Row']) => { rawMap[r.log_date] = r; });
  compData.forEach((c: Database['public']['Tables']['computed_daily_scores']['Row']) => { compMap[c.log_date] = c; });

  return { raw: rawMap, computed: compMap };
}

// ============================================================
// CONNECTION TEST
// ============================================================
export async function sbTestConnection(): Promise<boolean> {
  try {
    const client = await getClientAsync();
    if (!client) return false;
    const { error } = await client.from('computed_daily_scores').select('log_date').limit(1);
    return !error;
  } catch {
    return false;
  }
}