/**
 * Clinical notes dashboard component.
 */

import { s } from '../../utils';

/**
 * Render clinical coach notes.
 */
export function renderClinical(record: any): void {
  const clinicalNotes = document.getElementById('clinical-coach-notes');
  if (clinicalNotes) clinicalNotes.textContent = s(record, 'clinical_coach_notes', 'Sin datos');
}