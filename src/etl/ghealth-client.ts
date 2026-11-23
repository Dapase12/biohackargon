/**
 * ARGON v7.0 — ghealth CLI Client
 * Wrapper for ghealth CLI (Google Health API v4) with pagination, retries, and type parsing.
 * Uses child_process to execute ghealth binary.
 */

import { spawn } from 'child_process';
import type { SpawnOptions } from 'child_process';
import type {
  GHealthSleepListResponse,
  GHealthHrvListResponse,
  GHealthExerciseListResponse,
  GHealthHrListResponse,
  GHealthWeightListResponse,
  GHealthBodyFatListResponse,
  GHealthRestingHeartRateListResponse,
  GHealthRespiratoryRateListResponse,
  GHealthOxygenSaturationListResponse,
  GHealthStepsListResponse,
} from '@/etl/types';

interface GHealthCliOptions {
  configDir: string;
  from?: string;      // YYYY-MM-DD, ISO 8601, 'today', 'yesterday'
  to?: string;        // YYYY-MM-DD, ISO 8601, 'today', 'yesterday'
  limit?: number;
  pageToken?: string;
  detail?: boolean;   // for sleep list --detail
}

interface CliResult<T> {
  data: T;
  nextPageToken: string | null;
}

/**
 * Execute ghealth CLI command and parse JSON output
 * Config dir is passed via GHEALTH_CONFIG_DIR env var (not a flag)
 */
async function executeGHealth<T>(
  command: string[],
  options: GHealthCliOptions
): Promise<CliResult<T>> {
  const args = [
    '--format', 'json',
    ...command,
  ];

  if (options.from) {
    args.push('--from', options.from);
  }
  if (options.to) {
    args.push('--to', options.to);
  }
  if (options.limit) {
    args.push('--limit', String(options.limit));
  }
  if (options.pageToken) {
    args.push('--page-token', options.pageToken);
  }
  if (options.detail) {
    args.push('--detail');
  }

  const env = {
    ...process.env,
    GHEALTH_CONFIG_DIR: options.configDir,
  };

  return new Promise((resolve, reject) => {
    const proc = spawn('ghealth', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    } as SpawnOptions);

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    // 60 second timeout - store timer reference to clear it on completion
    const timeoutTimer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('ghealth command timed out after 60s'));
    }, 60000);

    proc.on('close', (code) => {
      // Clear timeout timer to prevent memory leak
      clearTimeout(timeoutTimer);

      if (code !== 0) {
        reject(new Error(`ghealth exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout.trim());
        resolve({
          data: parsed,
          nextPageToken: parsed.nextPageToken ?? null,
        });
      } catch (e) {
        reject(new Error(`Failed to parse ghealth output: ${stdout}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutTimer);
      reject(new Error(`Failed to spawn ghealth: ${err.message}`));
    });
  });
}

/**
 * Retry configuration for rate limit handling
 */
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number; // 0-1, e.g., 0.3 = ±30% jitter
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterFactor: 0.3,
};

/**
 * Check if an error is a rate limit error (429, RESOURCE_EXHAUSTED, etc.)
 */
export function isRateLimitError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('429') ||
    message.includes('resource_exhausted') ||
    message.includes('too many requests') ||
    message.includes('quota exceeded')
  );
}

/**
 * Extract Retry-After seconds from error message if present
 */
export function extractRetryAfter(error: Error): number | null {
  const match = error.message.match(/retry-after:\s*(\d+)/i);
  return match && match[1] ? parseInt(match[1], 10) * 1000 : null;
}

/**
 * Sleep utility with abort signal support
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(new Error('Aborted'));
      });
    }
  });
}

/**
 * Execute a function with exponential backoff retry for rate limit errors
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  signal?: AbortSignal
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs, jitterFactor } = {
    ...DEFAULT_RETRY_CONFIG,
    ...config,
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on last attempt
      if (attempt === maxRetries) {
        break;
      }

      // Only retry on rate limit errors
      if (!isRateLimitError(lastError)) {
        throw lastError;
      }

      // Check for Retry-After header
      const retryAfterMs = extractRetryAfter(lastError);

      // Calculate delay with exponential backoff + jitter
      let delayMs: number;
      if (retryAfterMs !== null) {
        delayMs = retryAfterMs;
      } else {
        const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
        const jitter = exponentialDelay * jitterFactor * (Math.random() * 2 - 1); // ±jitterFactor
        delayMs = Math.min(exponentialDelay + jitter, maxDelayMs);
        delayMs = Math.max(delayMs, 0);
      }

      // Wait before retry
      await sleep(delayMs, signal);
    }
  }

  throw lastError;
}

/**
 * Fetch all pages for a given endpoint with retry on rate limit
 */
async function fetchAllPages<T, R>(
  command: string[],
  options: GHealthCliOptions,
  extractItems: (data: T) => R[],
  extractToken: (data: T) => string | null,
  retryConfig?: Partial<RetryConfig>
): Promise<R[]> {
  const allItems: R[] = [];
  let pageToken: string | undefined;

  do {
    const cliOptions = { ...options, pageToken };
    const result = await retryWithBackoff(
      () => executeGHealth<T>(command, cliOptions),
      retryConfig
    );
    const items = extractItems(result.data);
    allItems.push(...items);
    pageToken = result.nextPageToken ?? undefined;
  } while (pageToken);

  return allItems;
}

// ========================================================================
// PUBLIC API
// ========================================================================

export interface GHealthClientConfig {
  configDir: string;
}

export class GHealthClient {
  private config: GHealthClientConfig;

  constructor(config: GHealthClientConfig) {
    this.config = config;
  }

  /**
   * Fetch sleep sessions for date range
   */
  async getSleepSessions(
    from: string,
    to: string
  ): Promise<GHealthSleepListResponse['dataPoints']> {
    const sessions = await fetchAllPages<
      GHealthSleepListResponse,
      GHealthSleepListResponse['dataPoints'][0]
    >(
      ['data', 'sleep', 'list'],
      { ...this.config, from, to, limit: 100, detail: true },
      (data) => data.dataPoints ?? [],
      (data) => data.nextPageToken ?? null
    );
    return sessions;
  }

  /**
   * Fetch HRV samples for date range
   */
  async getHrvSamples(
    from: string,
    to: string
  ): Promise<GHealthHrvListResponse['dataPoints']> {
    const samples = await fetchAllPages<
      GHealthHrvListResponse,
      GHealthHrvListResponse['dataPoints'][0]
    >(
      ['data', 'heart-rate-variability', 'list'],
      { ...this.config, from, to, limit: 500 },
      (data) => data.dataPoints ?? [],
      (data) => data.nextPageToken ?? null
    );
    return samples;
  }

  /**
   * Fetch exercise sessions for date range
   */
  async getExerciseSessions(
    from: string,
    to: string
  ): Promise<GHealthExerciseListResponse['dataPoints']> {
    const sessions = await fetchAllPages<
      GHealthExerciseListResponse,
      GHealthExerciseListResponse['dataPoints'][0]
    >(
      ['data', 'exercise', 'list'],
      { ...this.config, from, to, limit: 100 },
      (data) => data.dataPoints ?? [],
      (data) => data.nextPageToken ?? null
    );
    return sessions;
  }

  /**
   * Fetch heart rate samples for date range
   * limit 500 per page to avoid large payloads (ghealth default max)
   */
  async getHeartRateSamples(
    from: string,
    to: string
  ): Promise<GHealthHrListResponse['dataPoints']> {
    const samples = await fetchAllPages<
      GHealthHrListResponse,
      GHealthHrListResponse['dataPoints'][0]
    >(
      ['data', 'heart-rate', 'list'],
      { ...this.config, from, to, limit: 500 },
      (data) => data.dataPoints ?? [],
      (data) => data.nextPageToken ?? null
    );
    return samples;
  }

  /**
   * Fetch weight samples for date range
   */
  async getWeightSamples(
    from: string,
    to: string
  ): Promise<GHealthWeightListResponse['dataPoints']> {
    const samples = await fetchAllPages<
      GHealthWeightListResponse,
      GHealthWeightListResponse['dataPoints'][0]
    >(
      ['data', 'weight', 'list'],
      { ...this.config, from, to, limit: 100 },
      (data) => data.dataPoints ?? [],
      (data) => data.nextPageToken ?? null
    );
    return samples;
  }

  /**
   * Fetch body fat samples for date range
   */
  async getBodyFatSamples(
    from: string,
    to: string
  ): Promise<GHealthBodyFatListResponse['dataPoints']> {
    const samples = await fetchAllPages<
      GHealthBodyFatListResponse,
      GHealthBodyFatListResponse['dataPoints'][0]
    >(
      ['data', 'body-fat', 'list'],
      { ...this.config, from, to, limit: 100 },
      (data) => data.dataPoints ?? [],
      (data) => data.nextPageToken ?? null
    );
    return samples;
  }

  /**
   * Fetch resting heart rate samples for date range
   */
  async getRestingHeartRateSamples(
    from: string,
    to: string
  ): Promise<GHealthRestingHeartRateListResponse['dataPoints']> {
    const samples = await fetchAllPages<
      GHealthRestingHeartRateListResponse,
      GHealthRestingHeartRateListResponse['dataPoints'][0]
    >(
      ['data', 'resting-heart-rate', 'list'],
      { ...this.config, from, to, limit: 500 },
      (data) => data.dataPoints ?? [],
      (data) => data.nextPageToken ?? null
    );
    return samples;
  }

  /**
   * Fetch respiratory rate samples for date range
   */
  async getRespiratoryRateSamples(
    from: string,
    to: string
  ): Promise<GHealthRespiratoryRateListResponse['dataPoints']> {
    const samples = await fetchAllPages<
      GHealthRespiratoryRateListResponse,
      GHealthRespiratoryRateListResponse['dataPoints'][0]
    >(
      ['data', 'respiratory-rate', 'list'],
      { ...this.config, from, to, limit: 500 },
      (data) => data.dataPoints ?? [],
      (data) => data.nextPageToken ?? null
    );
    return samples;
  }

  /**
   * Fetch oxygen saturation samples for date range
   */
  async getOxygenSaturationSamples(
    from: string,
    to: string
  ): Promise<GHealthOxygenSaturationListResponse['dataPoints']> {
    const samples = await fetchAllPages<
      GHealthOxygenSaturationListResponse,
      GHealthOxygenSaturationListResponse['dataPoints'][0]
    >(
      ['data', 'oxygen-saturation', 'list'],
      { ...this.config, from, to, limit: 500 },
      (data) => data.dataPoints ?? [],
      (data) => data.nextPageToken ?? null
    );
    return samples;
  }

  /**
   * Fetch steps samples for date range
   */
  async getStepsSamples(
    from: string,
    to: string
  ): Promise<GHealthStepsListResponse['dataPoints']> {
    const samples = await fetchAllPages<
      GHealthStepsListResponse,
      GHealthStepsListResponse['dataPoints'][0]
    >(
      ['data', 'steps', 'list'],
      { ...this.config, from, to, limit: 500 },
      (data) => data.dataPoints ?? [],
      (data) => data.nextPageToken ?? null
    );
    return samples;
  }

  /**
   * Fetch exercise events for date range (pause/resume)
   * Note: ghealth CLI doesn't have a separate events endpoint; events are embedded in sessions
   * This method returns empty array for compatibility
   */
  async getExerciseEvents(
    _from: string,
    _to: string
  ): Promise<Array<{ startTimeMillis: string; endTimeMillis: string; type: 'PAUSE' | 'RESUME' }>> {
    // ghealth doesn't expose exercise events separately
    return [];
  }

  /**
   * Fetch combined body composition samples (weight + body fat)
   * Fetches both and merges by timestamp
   */
  async getBodyCompositionSamples(
    from: string,
    to: string
  ): Promise<{
    weight: GHealthWeightListResponse['dataPoints'];
    bodyFat: GHealthBodyFatListResponse['dataPoints'];
  }> {
    const [weight, bodyFat] = await Promise.all([
      this.getWeightSamples(from, to),
      this.getBodyFatSamples(from, to),
    ]);
    return { weight, bodyFat };
  }

  /**
   * Fetch all data types for a date range (for sync)
   */
  async fetchAllForSync(
    from: string,
    to: string
  ): Promise<{
    sleep: GHealthSleepListResponse['dataPoints'];
    hrv: GHealthHrvListResponse['dataPoints'];
    exercise: GHealthExerciseListResponse['dataPoints'];
    heartRate: GHealthHrListResponse['dataPoints'];
    weight: GHealthWeightListResponse['dataPoints'];
    bodyFat: GHealthBodyFatListResponse['dataPoints'];
    restingHeartRate: GHealthRestingHeartRateListResponse['dataPoints'];
    respiratoryRate: GHealthRespiratoryRateListResponse['dataPoints'];
    oxygenSaturation: GHealthOxygenSaturationListResponse['dataPoints'];
    steps: GHealthStepsListResponse['dataPoints'];
  }> {
    const [
      sleep,
      hrv,
      exercise,
      heartRate,
      weight,
      bodyFat,
      restingHeartRate,
      respiratoryRate,
      oxygenSaturation,
      steps,
    ] = await Promise.all([
      this.getSleepSessions(from, to),
      this.getHrvSamples(from, to),
      this.getExerciseSessions(from, to),
      this.getHeartRateSamples(from, to),
      this.getWeightSamples(from, to),
      this.getBodyFatSamples(from, to),
      this.getRestingHeartRateSamples(from, to),
      this.getRespiratoryRateSamples(from, to),
      this.getOxygenSaturationSamples(from, to),
      this.getStepsSamples(from, to),
    ]);

    return {
      sleep,
      hrv,
      exercise,
      heartRate,
      weight,
      bodyFat,
      restingHeartRate,
      respiratoryRate,
      oxygenSaturation,
      steps,
    };
  }
}

/**
 * Create client from environment variables
 * Reads all credentials (client_secret.json, credentials.json, config.toml) from GHEALTH_CONFIG_DIR
 */
export function createGHealthClient(config?: GHealthClientConfig): GHealthClient {
  const configDir = config?.configDir ?? process.env.GHEALTH_CONFIG_DIR;

  if (!configDir) {
    throw new Error('GHEALTH_CONFIG_DIR must be set');
  }

  return new GHealthClient({ configDir });
}

/**
 * Inter-day delay helper to avoid rate limits during backfill
 * Call this between day iterations when a 429 was encountered on the previous day
 */
export async function interDayDelay(
  delayMs: number = 2000,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, delayMs);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(new Error('Aborted'));
      });
    }
  });
}

/**
 * Configuration for sync with rate limit handling
 */
export interface SyncRateLimitConfig {
  /** Delay in ms between days when 429 encountered on previous day */
  interDayDelayMs: number;
  /** Retry config for individual API calls */
  retryConfig: Partial<RetryConfig>;
}

/**
 * Default sync rate limit configuration
 */
export const DEFAULT_SYNC_RATE_LIMIT_CONFIG: SyncRateLimitConfig = {
  interDayDelayMs: 2000,
  retryConfig: DEFAULT_RETRY_CONFIG,
};

// Re-export new ghealth response types from types.ts
export type {
  GHealthRestingHeartRateListResponse,
  GHealthRespiratoryRateListResponse,
  GHealthOxygenSaturationListResponse,
  GHealthStepsListResponse,
} from '@/etl/types';