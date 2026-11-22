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
  GHealthExerciseEventsResponse,
  GHealthBodyCompositionResponse,
} from '@/etl/types';

interface GHealthCliOptions {
  credentialsFile: string;
  configDir: string;
  startTime?: string; // RFC3339
  endTime?: string;   // RFC3339
  pageSize?: number;
  pageToken?: string;
}

interface CliResult<T> {
  data: T;
  nextPageToken: string | null;
}

/**
 * Execute ghealth CLI command and parse JSON output
 */
async function executeGHealth<T>(
  command: string[],
  options: GHealthCliOptions
): Promise<CliResult<T>> {
  const args = [
    '--credentials', options.credentialsFile,
    '--config', options.configDir,
    '--format', 'json',
    ...command,
  ];

  if (options.startTime) {
    args.push('--start-time', options.startTime);
  }
  if (options.endTime) {
    args.push('--end-time', options.endTime);
  }
  if (options.pageSize) {
    args.push('--page-size', String(options.pageSize));
  }
  if (options.pageToken) {
    args.push('--page-token', options.pageToken);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('ghealth', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
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
  credentialsFile: string;
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
    startTime: string,
    endTime: string
  ): Promise<GHealthSleepListResponse['sessions']> {
    const sessions = await fetchAllPages<
      GHealthSleepListResponse,
      GHealthSleepListResponse['sessions'][0]
    >(
      ['data', 'sleep', 'list'],
      { ...this.config, startTime, endTime, pageSize: 100 },
      (data) => data.sessions ?? [],
      (data) => data.nextPageToken ?? null
    );
    return sessions;
  }

  /**
   * Fetch HRV samples for date range
   */
  async getHrvSamples(
    startTime: string,
    endTime: string
  ): Promise<GHealthHrvListResponse['samples']> {
    const samples = await fetchAllPages<
      GHealthHrvListResponse,
      GHealthHrvListResponse['samples'][0]
    >(
      ['data', 'heart-rate-variability', 'list'],
      { ...this.config, startTime, endTime, pageSize: 500 },
      (data) => data.samples ?? [],
      (data) => data.nextPageToken ?? null
    );
    return samples;
  }

  /**
   * Fetch exercise sessions for date range
   */
  async getExerciseSessions(
    startTime: string,
    endTime: string
  ): Promise<GHealthExerciseListResponse['sessions']> {
    const sessions = await fetchAllPages<
      GHealthExerciseListResponse,
      GHealthExerciseListResponse['sessions'][0]
    >(
      ['data', 'exercise', 'list'],
      { ...this.config, startTime, endTime, pageSize: 100 },
      (data) => data.sessions ?? [],
      (data) => data.nextPageToken ?? null
    );
    return sessions;
  }

  /**
   * Fetch heart rate samples for date range
   */
  async getHeartRateSamples(
    startTime: string,
    endTime: string
  ): Promise<GHealthHrListResponse['samples']> {
    const samples = await fetchAllPages<
      GHealthHrListResponse,
      GHealthHrListResponse['samples'][0]
    >(
      ['data', 'heart-rate', 'list'],
      { ...this.config, startTime, endTime, pageSize: 1000 },
      (data) => data.samples ?? [],
      (data) => data.nextPageToken ?? null
    );
    return samples;
  }

  /**
   * Fetch exercise events (pause/resume) for date range
   */
  async getExerciseEvents(
    startTime: string,
    endTime: string
  ): Promise<GHealthExerciseEventsResponse['events']> {
    const events = await fetchAllPages<
      GHealthExerciseEventsResponse,
      GHealthExerciseEventsResponse['events'][0]
    >(
      ['data', 'exercise', 'events'],
      { ...this.config, startTime, endTime, pageSize: 100 },
      (data) => data.events ?? [],
      (data) => data.nextPageToken ?? null
    );
    return events;
  }

  /**
   * Fetch body composition samples for date range
   */
  async getBodyCompositionSamples(
    startTime: string,
    endTime: string
  ): Promise<GHealthBodyCompositionResponse['samples']> {
    const samples = await fetchAllPages<
      GHealthBodyCompositionResponse,
      GHealthBodyCompositionResponse['samples'][0]
    >(
      ['data', 'weight', 'list'],
      { ...this.config, startTime, endTime, pageSize: 100 },
      (data) => data.samples ?? [],
      (data) => data.nextPageToken ?? null
    );
    return samples;
  }

  /**
   * Fetch all data types for a date range (for sync)
   */
  async fetchAllForSync(
    startTime: string,
    endTime: string
  ): Promise<{
    sleep: GHealthSleepListResponse['sessions'];
    hrv: GHealthHrvListResponse['samples'];
    exercise: GHealthExerciseListResponse['sessions'];
    heartRate: GHealthHrListResponse['samples'];
    exerciseEvents: GHealthExerciseEventsResponse['events'];
    bodyComposition: GHealthBodyCompositionResponse['samples'];
  }> {
    const [sleep, hrv, exercise, heartRate, exerciseEvents, bodyComposition] = await Promise.all([
      this.getSleepSessions(startTime, endTime),
      this.getHrvSamples(startTime, endTime),
      this.getExerciseSessions(startTime, endTime),
      this.getHeartRateSamples(startTime, endTime),
      this.getExerciseEvents(startTime, endTime),
      this.getBodyCompositionSamples(startTime, endTime),
    ]);

    return { sleep, hrv, exercise, heartRate, exerciseEvents, bodyComposition };
  }
}

/**
 * Create client from environment variables
 * Supports two modes:
 * 1. Explicit GHEALTH_CREDENTIALS_FILE + GHEALTH_CONFIG_DIR
 * 2. Only GHEALTH_CONFIG_DIR (falls back to ${configDir}/credentials.json)
 */
export function createGHealthClient(): GHealthClient {
  const configDir = process.env.GHEALTH_CONFIG_DIR;
  let credentialsFile = process.env.GHEALTH_CREDENTIALS_FILE;

  if (!configDir) {
    throw new Error('GHEALTH_CONFIG_DIR must be set');
  }

  // Fallback: if credentials file not explicitly set, use default location in config dir
  if (!credentialsFile) {
    credentialsFile = `${configDir}/credentials.json`;
  }

  return new GHealthClient({ credentialsFile, configDir });
}