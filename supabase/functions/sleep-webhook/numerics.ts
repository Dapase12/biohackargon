/**
 * 1 Hz-native analytics family — pure math utilities.
 * Ported from python/argon_algorithms/util.py
 * All functions are pure. Where a statistic is undefined, they return null.
 */

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_SUPPORTED_CADENCE_SEC = 300.0;
const CADENCE_MODE_TOLERANCE = 2.0;
const CADENCE_MIN_MODE_FRACTION = 0.5;

const RR_MIN = 300.0;
const RR_MAX = 2000.0;
const RR_MAX_STEP = 200.0;

// ── Basic Statistics ────────────────────────────────────────────────────────

export function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stddev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  const s = xs.reduce((a, b) => a + (b - m) ** 2, 0);
  return Math.sqrt(s / (xs.length - 1));
}

export function stddevPop(xs: number[]): number | null {
  if (!xs.length) return null;
  const m = mean(xs)!;
  const s = xs.reduce((a, b) => a + (b - m) ** 2, 0);
  return Math.sqrt(s / xs.length);
}

export function percentileSorted(sortedXs: number[], p: number): number | null {
  if (!sortedXs.length) return null;
  if (sortedXs.length === 1) return sortedXs[0];
  const rank = (p / 100.0) * (sortedXs.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedXs[lo];
  const frac = rank - lo;
  return sortedXs[lo] + (sortedXs[hi] - sortedXs[lo]) * frac;
}

export function percentile(values: number[], p: number): number | null {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return null;
  return percentileSorted([...finite].sort((a, b) => a - b), p);
}

export function median(xs: number[]): number | null {
  return percentile(xs, 50.0);
}

export function mad(xs: number[], scaled = true): number | null {
  const finite = xs.filter(Number.isFinite);
  if (!finite.length) return null;
  const m = median(finite);
  if (m === null) return null;
  const dev = finite.map(x => Math.abs(x - m));
  const raw = median(dev);
  if (raw === null) return null;
  return scaled ? raw * 1.4826 : raw;
}

// ── Cadence Measurement ─────────────────────────────────────────────────────

export function sampleCadenceSeconds(tsSec: number[]): number | null {
  if (tsSec.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < tsSec.length; i++) {
    const g = tsSec[i] - tsSec[i - 1];
    if (g > 0) gaps.push(g);
  }
  const m = median(gaps);
  if (m === null || m > MAX_SUPPORTED_CADENCE_SEC) return null;
  let inMode = 0;
  for (const g of gaps) {
    if (g <= m * CADENCE_MODE_TOLERANCE && g * CADENCE_MODE_TOLERANCE >= m) {
      inMode++;
    }
  }
  if (inMode < gaps.length * CADENCE_MIN_MODE_FRACTION) return null;
  return m;
}

// ── Z-Scores ────────────────────────────────────────────────────────────────

export interface RobustScale {
  med: number;
  scale: number;
  z(x: number): number;
}

export function robustScaleOf(sample: number[]): RobustScale | null {
  if (sample.length < 2) return null;
  const m = median(sample);
  if (m === null) return null;
  const s = mad(sample);
  if (s === null || s === 0) return null;
  return {
    med: m,
    scale: s,
    z(x: number) { return (x - m) / s; },
  };
}

export function robustZ(x: number, sample: number[]): number | null {
  const scale = robustScaleOf(sample);
  if (!scale) return null;
  return scale.z(x);
}

export function zScore(x: number, sample: number[]): number | null {
  const m = mean(sample);
  const sd = stddev(sample);
  if (m === null || sd === null || sd === 0) return null;
  return (x - m) / sd;
}

// ── Regression ──────────────────────────────────────────────────────────────

export function olsSlope(y: number[], x?: number[]): number | null {
  const n = y.length;
  if (n < 2) return null;
  const xs = x ?? Array.from({ length: n }, (_, i) => i);
  const mx = mean(xs)!;
  const my = mean(y)!;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (y[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? null : num / den;
}

export interface LineFit {
  slope: number;
  intercept: number;
}

export function olsFit(y: number[], x?: number[]): LineFit | null {
  const n = y.length;
  if (n < 2) return null;
  const xs = x ?? Array.from({ length: n }, (_, i) => i);
  const s = olsSlope(y, xs);
  if (s === null) return null;
  const b = mean(y)!;
  const mx = mean(xs)!;
  return { slope: s, intercept: b - s * mx };
}

export function theilSen(y: number[], x?: number[]): number | null {
  const n = y.length;
  if (n < 2) return null;
  const xs = x ?? Array.from({ length: n }, (_, i) => i);
  const slopes: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = xs[j] - xs[i];
      if (dx === 0) continue;
      slopes.push((y[j] - y[i]) / dx);
    }
  }
  return median(slopes);
}

// ── Rounding ────────────────────────────────────────────────────────────────

export function round6(x: number): number | null {
  if (!Number.isFinite(x)) return null;
  return Math.round(x * 1_000_000) / 1_000_000;
}

export function roundTo(x: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(x * f) / f;
}

// ── Lomb–Scargle Periodogram ────────────────────────────────────────────────

export interface LsPoint {
  freqHz: number;
  psd: number;
}

export interface LombScargle {
  spectrum: LsPoint[];
  bandPower(loHz: number, hiHz: number): number;
  peakFreq(loHz: number, hiHz: number): number | null;
}

export function lombScargle(
  t: number[],
  y: number[],
  freqsHz: number[],
): LombScargle | null {
  const n = t.length;
  if (n < 4 || y.length !== n || !freqsHz.length) return null;

  const my = mean(y);
  if (my === null) return null;

  const yc = y.map(v => v - my);

  const variance = yc.reduce((a, v) => a + v * v, 0) / (n - 1);
  if (variance <= 0) return null;

  const tMin = Math.min(...t);
  const tMax = Math.max(...t);
  const span = tMax - tMin;
  if (span <= 0) return null;

  // One-sided periodogram → density: 2·Δt, with Δt the MEAN sample interval.
  const psdScale = 2.0 * span / (n - 1);

  const out: LsPoint[] = [];
  for (const fHz of freqsHz) {
    const w = 2.0 * Math.PI * fHz;
    if (w === 0) {
      out.push({ freqHz: 0.0, psd: 0.0 });
      continue;
    }

    let sin2 = 0.0, cos2 = 0.0;
    for (const ti of t) {
      sin2 += Math.sin(2.0 * w * ti);
      cos2 += Math.cos(2.0 * w * ti);
    }
    const tau = Math.atan2(sin2, cos2) / (2.0 * w);

    let cNum = 0.0, cDen = 0.0, sNum = 0.0, sDen = 0.0;
    for (let i = 0; i < n; i++) {
      const arg = w * (t[i] - tau);
      const c = Math.cos(arg);
      const s = Math.sin(arg);
      cNum += yc[i] * c;
      cDen += c * c;
      sNum += yc[i] * s;
      sDen += s * s;
    }

    const term1 = cDen === 0 ? 0.0 : (cNum * cNum) / cDen;
    const term2 = sDen === 0 ? 0.0 : (sNum * sNum) / sDen;
    out.push({ freqHz: fHz, psd: 0.5 * (term1 + term2) * psdScale });
  }

  return {
    spectrum: out,
    bandPower(loHz: number, hiHz: number): number {
      let p = 0.0;
      for (let i = 0; i < this.spectrum.length; i++) {
        const pt = this.spectrum[i];
        const f = pt.freqHz;
        if (f < loHz || f >= hiHz) continue;
        let df: number;
        if (i > 0) {
          df = pt.freqHz - this.spectrum[i - 1].freqHz;
        } else if (this.spectrum.length > 1) {
          df = this.spectrum[1].freqHz - this.spectrum[0].freqHz;
        } else {
          df = 0.0;
        }
        p += pt.psd * df;
      }
      return p;
    },
    peakFreq(loHz: number, hiHz: number): number | null {
      let best: number | null = null;
      let bestP = -Infinity;
      for (const pt of this.spectrum) {
        if (pt.freqHz < loHz || pt.freqHz > hiHz) continue;
        if (pt.psd > bestP) {
          bestP = pt.psd;
          best = pt.freqHz;
        }
      }
      return best;
    },
  };
}

export function freqGrid(loHz: number, hiHz: number, n: number): number[] {
  if (n < 1) return [];
  if (n === 1) return [loHz];
  const step = (hiHz - loHz) / (n - 1);
  return Array.from({ length: n }, (_, i) => loHz + step * i);
}

// ── Calendar Days ───────────────────────────────────────────────────────────

export function calendarDays(dates: string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < dates.length; i++) {
    const dStr = dates[i];
    try {
      const d = new Date(dStr + 'T00:00:00Z');
      out.push(Math.floor(d.getTime() / 86400000));
    } catch {
      out.push(i);
    }
  }
  return out;
}

// ── Ranking ─────────────────────────────────────────────────────────────────

export function averageRanks(xs: number[]): number[] {
  const n = xs.length;
  if (n === 0) return [];
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => xs[a] - xs[b]);
  const ranks = new Array(n).fill(0);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && xs[idx[j + 1]] === xs[idx[i]]) j++;
    const shared = (i + 1 + j + 1) / 2.0;
    for (let k = i; k <= j; k++) ranks[idx[k]] = shared;
    i = j + 1;
  }
  return ranks;
}

// ── P-Values ────────────────────────────────────────────────────────────────

export function normalTwoSidedP(zScore: number): number {
  if (!Number.isFinite(zScore)) return 1.0;
  const x = Math.abs(zScore) / Math.sqrt(2.0);
  const t = 1.0 / (1.0 + 0.5 * x);
  const ans = t * Math.exp(
    -x * x
    - 1.26551223
    + t * (
      1.00002368
      + t * (
        0.37409196
        + t * (
          0.09678418
          + t * (
            -0.18628806
            + t * (
              0.27886807
              + t * (
                -1.13520398
                + t * (
                  1.48851587
                  + t * (-0.82215223 + t * 0.17087277)
                )
              )
            )
          )
        )
      )
    )
  );
  return Math.max(0.0, Math.min(1.0, ans));
}

export function benjaminiHochberg(ps: (number | null)[]): (number | null)[] {
  const idx = ps.map((p, i) => p !== null ? i : -1).filter(i => i !== -1);
  idx.sort((a, b) => (ps[a] ?? 0) - (ps[b] ?? 0));
  const m = idx.length;
  const out: (number | null)[] = new Array(ps.length).fill(null);
  let running = 1.0;
  for (let k = m - 1; k >= 0; k--) {
    const q = (ps[idx[k]] ?? 0) * m / (k + 1);
    running = Math.min(running, q);
    out[idx[k]] = running;
  }
  return out;
}

// ── Beat Cleaning ───────────────────────────────────────────────────────────

export function cleanBeatsInWindow(
  rrMs: number[],
  rrTsMs: number[],
  windowStartMs: number,
  windowEndMs: number,
): [number[], number[]] {
  const windowBeats: [number, number][] = [];
  for (let i = 0; i < rrMs.length; i++) {
    if (windowStartMs <= rrTsMs[i] && rrTsMs[i] <= windowEndMs) {
      windowBeats.push([rrTsMs[i], rrMs[i]]);
    }
  }

  if (!windowBeats.length) return [[], []];

  windowBeats.sort((a, b) => a[0] - b[0]);

  const filteredTs: number[] = [];
  const filteredRr: number[] = [];

  for (const [ts, rr] of windowBeats) {
    if (rr < RR_MIN || rr > RR_MAX) continue;
    if (filteredRr.length && Math.abs(rr - filteredRr[filteredRr.length - 1]) > RR_MAX_STEP) continue;
    filteredTs.push(ts);
    filteredRr.push(rr);
  }

  return [filteredRr, filteredTs];
}