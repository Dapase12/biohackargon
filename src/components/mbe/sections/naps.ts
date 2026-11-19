/**
 * ARGON v6.0 — MBE Naps Section
 * Renders naps data from raw biometrics.
 * Import from: import { renderNaps } from '@/components/mbe/sections/naps';
 */

import { card, note, empty, getSelectedDay, ex } from '../utils';
import type { RawBiometric } from '@/api/schemas';

interface NapsOptions {
  state: { raw: RawBiometric[]; comp: any[]; selectedDate: string | null };
}

/**
 * Render naps section
 */
export function renderNaps(options: NapsOptions): string {
  const { state } = options;
  const { raw: r0 } = getSelectedDay(state);
  const n = ex(r0).naps || [];
  const tot = n.reduce((s, v) => s + v.min, 0);
  const body = n.length
    ? n.map(v => `<div class="flex justify-between text-xs"><span>🛌 ${v.t}</span><span class="font-mono text-purple-300">${v.min} min</span></div>`).join('') +
      `<div class="text-xs font-bold">Total hoy: ${tot} min</div>`
    : empty('Sin siestas detectadas hoy (se detectan episodios de 10–240 min que empiezan entre 08:00 y 20:00).');
  return card('😴 Siestas', 'Se suman a las horas del día', body + note('Siestas ≤30 min y antes de ~15:00 mejoran alerta con poco efecto sobre el sueño nocturno; >60 min aumentan inercia de sueño (Milner & Cote 2009). En guardia, una siesta profiláctica de 20–30 min reduce errores.'));
}