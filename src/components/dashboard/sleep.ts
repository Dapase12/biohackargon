/**
 * Sleep ring dashboard component.
 */

import { s } from '../../utils';

const CIRC = 251.2;

/**
 * Render sleep ring and related elements.
 */
export function renderSleep(record: any): void {
  const sleepPct = Math.round(s(record, 'sleep_architecture_score', '0'));
  const ringSleep = document.getElementById('ring-sleep');
  if (ringSleep) ringSleep.style.strokeDashoffset = `${CIRC - (sleepPct / 100) * CIRC}`;

  const valSleep = document.getElementById('val-sleep');
  if (valSleep) valSleep.textContent = record.sleep_missing ? '--' : `${sleepPct}%`;

  const badgeSleepEff = document.getElementById('badge-sleep-eff');
  if (badgeSleepEff) badgeSleepEff.textContent = `Efic: ${Math.round(s(record, 'sleep_efficiency_pct', '0'))}%`;

  const subSleep = document.getElementById('sub-sleep');
  if (subSleep) subSleep.textContent = `Deuda: ${s(record, 'cumulative_sleep_debt_hours', '0')}h`;
}