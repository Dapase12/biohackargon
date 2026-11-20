/**
 * Recovery ring dashboard component.
 */

import { s } from '../../utils';

const CIRC = 251.2;

/**
 * Render recovery ring and related elements.
 */
export function renderRecovery(record: any): void {
  const recPct = record.recovery_score == null ? 0 : record.recovery_score;
  const recRing = document.getElementById('ring-recovery');
  if (recRing) recRing.style.strokeDashoffset = `${CIRC - (recPct / 100) * CIRC}`;

  const recColor = recPct >= 67 ? '#10B981' : (recPct >= 34 ? '#F59E0B' : '#EF4444');
  if (recRing) recRing.style.stroke = recColor;

  const valRecovery = document.getElementById('val-recovery');
  if (valRecovery) valRecovery.textContent = record.recovery_score == null ? '--%' : `${recPct}%`;

  const badgeRec = document.getElementById('badge-recovery');
  if (badgeRec) {
    badgeRec.textContent = record.sleep_missing ? 'SIN SUEÑO' :
      record.hrv_missing ? 'SIN VFC' :
      record.calibrating ? 'CALIBRANDO' :
      (recPct >= 67 ? 'ÓPTIMO' : (recPct >= 34 ? 'MODERADO' : 'FATIGA SNC'));
    badgeRec.style.color = recColor;
  }

  const subRecovery = document.getElementById('sub-recovery');
  if (subRecovery) subRecovery.textContent = `VFC: ${s(record, 'rmssd_ms', '--')} ms`;
}