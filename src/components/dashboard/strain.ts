/**
 * Strain ring dashboard component.
 */

import { s, sf } from '../../utils';

const CIRC = 251.2;

/**
 * Render strain ring and related elements.
 */
export function renderStrain(record: any): void {
  const strainVal = s(record, 'strain_score', '0');
  const ringStrain = document.getElementById('ring-strain');
  if (ringStrain) ringStrain.style.strokeDashoffset = `${CIRC - (Math.min(21, strainVal) / 21.0) * CIRC}`;

  const valStrain = document.getElementById('val-strain');
  if (valStrain) valStrain.textContent = sf(record, 'strain_score', 1);

  const ringStrainEl = document.getElementById('ring-strain');
  if (ringStrainEl) {
    const maxStrain = s(record, 'recommended_max_strain', '21');
    ringStrainEl.style.stroke = strainVal > maxStrain ? '#EF4444' :
      (strainVal >= maxStrain * 0.8 ? '#F59E0B' : '#06B6D4');
  }

  const badgeStrainTarget = document.getElementById('badge-strain-target');
  if (badgeStrainTarget) badgeStrainTarget.textContent = `Meta: ${s(record, 'recommended_max_strain', '21')}`;

  const subStrain = document.getElementById('sub-strain');
  if (subStrain) subStrain.textContent = `${Number(s(record, 'steps_count', 0)).toLocaleString('es-ES')} pasos`;
}