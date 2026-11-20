/**
 * Safe field access helpers for handling null/undefined/NaN values.
 * Used by dashboard components and main-app.
 */

/**
 * Safe get with default - returns default if value is null, undefined, or NaN.
 */
export function s(obj: any, key: string, def: any = '--'): any {
  const v = obj?.[key];
  return (v === null || v === undefined || Number.isNaN(v)) ? def : v;
}

/**
 * Safe get with number formatting - returns formatted number or default.
 */
export function sf(obj: any, key: string, fixed = 1, def: any = '--'): any {
  const v = obj?.[key];
  return (v === null || v === undefined || Number.isNaN(v)) ? def : Number(v).toFixed(fixed);
}

/**
 * Safe get with string conversion - returns string or default.
 */
export function si(obj: any, key: string, def: any = '--'): any {
  const v = obj?.[key];
  return (v === null || v === undefined || Number.isNaN(v)) ? def : String(v);
}