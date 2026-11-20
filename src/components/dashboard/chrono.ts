/**
 * Chronological age dashboard component.
 */

/**
 * Render chronological age label.
 */
export function renderChrono(record: any): void {
  const chronoEl = document.getElementById('chrono-age-label');
  if (chronoEl) chronoEl.textContent = `Edad Cronológica: ${(record.chronological_age || 28.9).toFixed(1)}a`;
}