/**
 * ARGON v6.0 — Date/Time Utilities
 * Timezone-aware (IANA), immutable, pure functions.
 * Import from: import { todayIso, addDays, fmtHHMM, ... } from '@/utils/date';
 */

import { TZ, DEFAULTS, setTimezone as setTZ } from '@/constants';

// ============================================================
// TIMEZONE HANDLING (delegate to constants)
// ============================================================
export { setTZ as setTimezone };

export function getTimezone(): string {
  return TZ;
}

// ============================================================
// CORE DATE OPERATIONS (all return new objects, no mutation)
// ============================================================

/** Current date in user timezone as YYYY-MM-DD */
export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

/** Yesterday in user timezone as YYYY-MM-DD */
export function yesterdayIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
}

/** Add/subtract days from ISO date string, return new ISO string */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(dt);
}

/** Difference in days between two ISO dates (date2 - date1) */
export function daysBetween(iso1: string, iso2: string): number {
  const d1 = new Date(`${iso1}T00:00:00`);
  const d2 = new Date(`${iso2}T00:00:00`);
  return Math.round((d2.getTime() - d1.getTime()) / 86_400_000);
}

/** Start of day (00:00) as timestamp in user TZ */
export function startOfDay(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getTime();
}

/** End of day (23:59:59.999) as timestamp in user TZ */
export function endOfDay(iso: string): number {
  return startOfDay(iso) + 86_399_999;
}

/** Parse HH:MM string to minutes since midnight */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** Format minutes as HH:MM in user TZ */
export function minutesToHhmm(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

// ============================================================
// FORMATTING (Intl-based, timezone-aware)
// ============================================================

/** YYYY-MM-DD */
export function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(`${iso}T00:00:00`));
}

/** DD/MM/YYYY */
export function fmtDateShort(iso: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(`${iso}T00:00:00`));
}

/** "lunes, 15 de enero" */
export function fmtDateLong(iso: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${iso}T00:00:00`));
}

/** HH:MM (24h) */
export function fmtHHMM(ts: number): string {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ts));
}

/** HH:MM:SS */
export function fmtHHMMSS(ts: number): string {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(ts));
}

/** Relative: "hace 2 días", "hoy", "mañana" */
export function fmtRelative(iso: string): string {
  const today = todayIso();
  const diff = daysBetween(today, iso);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  if (diff === -1) return 'Ayer';
  if (diff > 0) return `En ${diff} días`;
  return `Hace ${Math.abs(diff)} días`;
}

/** Weekday short: "lun", "mar" */
export function fmtWeekday(iso: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: TZ,
    weekday: 'short',
  }).format(new Date(`${iso}T00:00:00`));
}

// ============================================================
// RANGE HELPERS
// ============================================================

/** Array of last N days ISO strings (including today), descending */
export function lastNDays(n: number): string[] {
  const today = todayIso();
  return Array.from({ length: n }, (_, i) => addDays(today, -i));
}

/** Array of ISO strings from start to end (inclusive) */
export function dateRange(start: string, end: string): string[] {
  const days = daysBetween(start, end) + 1;
  return Array.from({ length: days }, (_, i) => addDays(start, i));
}

/** Check if date is within range (inclusive) */
export function inRange(iso: string, start: string, end: string): boolean {
  return iso >= start && iso <= end;
}

/** Get ISO week number (1-53) */
export function isoWeek(iso: string): number {
  const date = new Date(`${iso}T00:00:00`);
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}

/** Get year-week string: "2026-W03" */
export function isoWeekString(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  const week = isoWeek(iso);
  return `${date.getUTCFullYear()}-W${week.toString().padStart(2, '0')}`;
}

// ============================================================
// M18 HELPER (18-month window for trends)
// ============================================================

/** Check if date is within last 18 months */
export function withinM18(iso: string): boolean {
  const cutoff = addDays(todayIso(), -540); // ~18 months
  return iso >= cutoff;
}

/** Convert HH:MM to minutes from 18:00 (for bed time visualization) */
export function m18(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const mins = h * 60 + m;
  const ref = 18 * 60; // 18:00 = 1080 min
  return (mins - ref + 1440) % 1440; // Wrap around midnight
}