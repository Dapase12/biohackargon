/**
 * ARGON v7.0 — ghealth CLI Client
 * Wrapper for ghealth CLI (Google Health API v4) with pagination, retries, and type parsing.
 * Uses child_process to execute ghealth binary.
 */

import { spawn, SpawnOptions } from 'child_process';
import type {
  GHealthSleepListResponse,
  GHealthHrvListResponse,
  GHealthExerciseListResponse,
  GHealthHrListResponse,
  GHealthWeightListResponse,
  GHealthBodyFatListResponse,
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

    proc.on('close', (code) => {
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
      reject(new Error(`Failed to spawn ghealth: ${err.message}`));
    });

    // 60 second timeout
    setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('ghealth command timed out after 60s'));
    }, 60000);
  });
}

/**
 * Fetch all pages for a given endpoint
 */
async function fetchAllPages<T, R>(
  command: string[],
  options: GHealthCliOptions,
  extractItems: (data: T) => R[],
  extractToken: (data: T) => string | null
): Promise<R[]> {
  const allItems: R[] = [];
  let pageToken: string | undefined;

  do {
    const cliOptions = { ...options, pageToken };
    const result = await executeGHealth<T>(command, cliOptions);
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
      { ...this.config, from, to, limit: 1000 },
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
  }> {
    const [sleep, hrv, exercise, heartRate, weight, bodyFat] = await Promise.all([
      this.getSleepSessions(from, to),
      this.getHrvSamples(from, to),
      this.getExerciseSessions(from, to),
      this.getHeartRateSamples(from, to),
      this.getWeightSamples(from, to),
      this.getBodyFatSamples(from, to),
    ]);

    return { sleep, hrv, exercise, heartRate, weight, bodyFat };
  }
}

/**
 * Create client from environment variables
 * Reads all credentials (client_secret.json, credentials.json, config.toml) from GHEALTH_CONFIG_DIR
 */
export function createGHealthClient(): GHealthClient {
  const configDir = process.env.GHEALTH_CONFIG_DIR;

  if (!configDir) {
    throw new Error('GHEALTH_CONFIG_DIR must be set');
  }

  return new GHealthClient({ configDir });
}