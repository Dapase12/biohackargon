/**
 * ARGON v6.0 — MBE Hypnogram Section
 * Renders sleep hypnogram from raw data.
 * Import from: import { renderHypnogram } from '@/components/mbe/sections/hypnogram';
 */

import { hhmm } from '../utils';
import { card, note, empty, getSelectedDay, ex } from '../utils';
import type { RawBiometric } from '@/api/schemas';

interface HypnogramOptions {
  state: { raw: RawBiometric[]; comp: any[]; selectedDate: string | null };
}

/**
 * Render hypnogram section
 */
export function renderHypnogram(options: HypnogramOptions): string {
  const { state } = options;
  const { raw: r0 } = getSelectedDay(state);
  const h = ex(r0).hypno;
  if (!h || !h.seg || !h.seg.length) return card('📊 Hipnograma', 'Fases de la última noche', empty('Aún no hay fases guardadas. Se llenan con el próximo webhook de sueño (requiere Code.txt actualizado).'));
  const last = h.seg[h.seg.length - 1];
  const span = last[1] + last[2];
  const W = 300;
  const row = { A: 0, R: 1, L: 2, D: 3 };
  const col = { A: '#94a3b8', R: '#a855f7', L: '#475569', D: '#3b82f6' };
  const rects = h.seg.map(s =>
    `<rect x="${(s[1] / span * W).toFixed(1)}" y="${row[s[0]] * 16 + 2}" width="${Math.max(0.8, s[2] / span * W).toFixed(1)}" height="12" rx="2" fill="${col[s[0]]}"/>`
  ).join('');
  const lab = ['Despierto', 'REM', 'Ligero', 'Profundo'].map((t, i) =>
    `<text x="2" y="${i * 16 + 11}" font-size="8" fill="#94a3b8">${t}</text>`
  ).join('');
  const tot = (k: string) => h.seg.filter(s => s[0] === k).reduce((q, s) => q + s[2], 0);
  return card('📊 Hipnograma', `${hhmm(h.t0)} → ${hhmm(h.t0 + span * 60000)}`,
    `<svg viewBox="0 0 ${W} 66" class="w-full">${rects}${lab}</svg>` +
    note(`Profundo ${tot('D')}m · REM ${tot('R')}m · Ligero ${tot('L')}m · Despierto ${tot('A')}m. Las fases por PPG de muñeca tienen concordancia moderada con PSG (κ≈0.4–0.6): útil para tendencias, no para diagnóstico.`)
  );
}