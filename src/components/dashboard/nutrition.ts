/**
 * Nutrition dashboard component (TDEE, macros, protein alert).
 */

import { s, sf } from '../../utils';

/**
 * Render nutrition metrics and macros.
 */
export function renderNutrition(record: any): void {
  const dynamicTdee = s(record, 'dynamic_tdee_kcal', '2400');
  const targetKcal = s(record, 'target_kcal', '2000');
  const deficitToday = Math.max(250, dynamicTdee - targetKcal);
  const weeklyFatLossKg = +((deficitToday * 7) / 7700).toFixed(2);
  const remainingKcal = Math.max(0, targetKcal - s(record, 'intake_kcal', '0'));

  const remainingPill = document.getElementById('remaining-kcal-pill');
  if (remainingPill) remainingPill.textContent = `Restan: ${remainingKcal} kcal`;

  const nutriTdee = document.getElementById('nutri-tdee');
  if (nutriTdee) nutriTdee.textContent = `${dynamicTdee} kcal`;

  const nutriDeficit = document.getElementById('nutri-deficit');
  if (nutriDeficit) nutriDeficit.textContent = `-${deficitToday} kcal`;

  const fatLossRate = document.getElementById('fat-loss-rate');
  if (fatLossRate) fatLossRate.textContent = `-${weeklyFatLossKg} kg/sem`;

  const nutriTarget = document.getElementById('nutri-target-kcal');
  if (nutriTarget) nutriTarget.textContent = `${targetKcal} kcal`;

  const nutriIntake = document.getElementById('nutri-intake-kcal');
  if (nutriIntake) nutriIntake.textContent = `Comido: ${s(record, 'intake_kcal', '0')}`;

  // MBE: TEF display
  const tefEl = document.getElementById('nutri-tef');
  if (tefEl) tefEl.textContent = `${s(record, 'tef_kcal', '0')} kcal`;

  const empSub = document.getElementById('nutri-emp-sub');
  if (empSub) empSub.textContent = s(record, 'empirical_tdee_kcal', '') ? `Empírico 14d: ${s(record, 'empirical_tdee_kcal', '')}` : 'TMB+Pasos+Ej';

  const macroProtText = document.getElementById('macro-prot-text');
  if (macroProtText) macroProtText.textContent = `${s(record, 'intake_protein_g', '0')} / ${s(record, 'target_protein_g', '0')} g`;

  const macroCarbText = document.getElementById('macro-carb-text');
  if (macroCarbText) macroCarbText.textContent = `${s(record, 'intake_carbs_g', '0')} / ${s(record, 'target_carbs_g', '0')} g`;

  const macroFatText = document.getElementById('macro-fat-text');
  if (macroFatText) macroFatText.textContent = `${s(record, 'intake_fat_g', '0')} / ${s(record, 'target_fat_g', '0')} g`;

  const protTarget = s(record, 'target_protein_g', '1');
  const carbTarget = s(record, 'target_carbs_g', '1');
  const fatTarget = s(record, 'target_fat_g', '1');

  const barProt = document.getElementById('bar-prot');
  if (barProt) barProt.style.width = `${Math.min(100, (s(record, 'intake_protein_g', '0') / Math.max(1, protTarget)) * 100)}%`;

  const barCarb = document.getElementById('bar-carb');
  if (barCarb) barCarb.style.width = `${Math.min(100, (s(record, 'intake_carbs_g', '0') / Math.max(1, carbTarget)) * 100)}%`;

  const barFat = document.getElementById('bar-fat');
  if (barFat) barFat.style.width = `${Math.min(100, (s(record, 'intake_fat_g', '0') / Math.max(1, fatTarget)) * 100)}%`;

  const protGap = Math.max(0, protTarget - s(record, 'intake_protein_g', '0'));
  const kcalLeftNow = Math.max(0, targetKcal - s(record, 'intake_kcal', '0'));
  const pAlert = document.getElementById('protein-alert');
  if (pAlert) {
    if (protGap >= 10 && kcalLeftNow < protGap * 4) {
      pAlert.classList.remove('hidden');
      pAlert.textContent = `⚠️ Faltan ${protGap} g de proteína (~${protGap * 4} kcal) y solo quedan ${kcalLeftNow} kcal. Prioriza proteína magra o whey y recorta carbohidratos/grasa.`;
    } else pAlert.classList.add('hidden');
  }
}