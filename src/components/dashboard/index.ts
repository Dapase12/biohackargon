/**
 * Dashboard main entry point - composes all dashboard components.
 */

import { renderChrono } from './chrono';
import { renderRecovery } from './recovery';
import { renderStrain } from './strain';
import { renderSleep } from './sleep';
import { renderClinical } from './clinical';
import { renderWeek } from './week';
import { renderBody } from './body';
import { renderNutrition } from './nutrition';

/**
 * Main dashboard rendering function.
 * Composes all individual dashboard components.
 */
export function renderDashboard(record: any, allRecordsSorted: any[]): void {
  renderChrono(record);
  renderRecovery(record);
  renderStrain(record);
  renderSleep(record);
  renderClinical(record);
  renderWeek(record, allRecordsSorted);
  renderBody(record);
  renderNutrition(record);
}

// Re-export individual components for testing
export {
  renderChrono,
  renderRecovery,
  renderStrain,
  renderSleep,
  renderClinical,
  renderWeek,
  renderBody,
  renderNutrition,
};