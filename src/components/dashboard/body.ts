/**
 * Body composition dashboard component (bioimpedance).
 */

import { s, sf } from '../../utils';

/**
 * Render body composition metrics.
 */
export function renderBody(record: any): void {
  const weightTrend = document.getElementById('weight-trend');
  if (weightTrend) weightTrend.textContent = `${sf(record, 'weight_kg', 2)} kg`;

  const ffmLabel = document.getElementById('ffm-label');
  if (ffmLabel) ffmLabel.textContent = `Sin grasa: ${s(record, 'ffm_kg')}kg | EWMA: ${s(record, 'trend_weight_kg')}`;

  const bfTrend = document.getElementById('bf-trend');
  if (bfTrend) bfTrend.textContent = `${sf(record, 'body_fat_pct', 1)}%`;

  const fatKgLabel = document.getElementById('fat-kg-label');
  if (fatKgLabel) fatKgLabel.textContent = `Grasa: ${s(record, 'fat_mass_kg')} kg | IMC: ${sf(record, 'bmi', 1)}`;

  const metricMuscle = document.getElementById('metric-muscle');
  if (metricMuscle) metricMuscle.textContent = `${sf(record, 'skeletal_muscle_pct', 1)}%`;

  const muscleMassSub = document.getElementById('muscle-mass-sub');
  if (muscleMassSub) muscleMassSub.textContent = `Muscular: ${s(record, 'muscle_mass_kg')} kg`;

  const metricVisceral = document.getElementById('metric-visceral');
  if (metricVisceral) metricVisceral.textContent = `${s(record, 'visceral_fat_index')}`;

  const metricWater = document.getElementById('metric-water');
  if (metricWater) metricWater.textContent = `${sf(record, 'body_water_pct', 1)}%`;

  const waterProtSub = document.getElementById('water-prot-sub');
  if (waterProtSub) waterProtSub.textContent = `${s(record, 'water_mass_kg')} kg`;

  const metricTmb = document.getElementById('metric-tmb');
  if (metricTmb) metricTmb.textContent = `${s(record, 'tmb_kcal')} kcal`;

  const tmbSub = document.getElementById('tmb-sub');
  if (tmbSub) tmbSub.textContent = `Ósea: ${s(record, 'bone_mass_kg')}kg`;
}