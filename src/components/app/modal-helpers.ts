/**
 * ARGON v6.0 — Modal Helpers Component
 * Bottom sheet modal rendering and interaction helpers.
 * Import from: import { sheet, wireSheet, openModal, closeModal } from '@/components/app/modal-helpers';
 */

/**
 * Create a bottom sheet modal HTML structure
 */
export function sheet(id: string, inner: string): string {
  return `<div id="${id}" class="fixed inset-0 z-50 hidden bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center"><div class="bottom-sheet-panel bg-slate-900 border-t sm:border border-slate-700/80 rounded-t-3xl sm:rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 space-y-3"><div class="w-12 h-1.5 bg-slate-700 rounded-full mx-auto -mt-1"></div>${inner}</div></div>`;
}

/**
 * Wire up touch gestures for bottom sheet dismissal
 */
export function wireSheet(id: string): void {
  const m = document.getElementById(id);
  const p = m?.querySelector('.bottom-sheet-panel') as HTMLElement | null;
  if (!m || !p) return;
  let y0: number | null = null;
  let dy = 0;
  m.addEventListener('click', e => { if (e.target === m) closeModal(id); });
  p.addEventListener('touchstart', (e: TouchEvent) => {
    if (p.scrollTop > 5 || (e.target as HTMLElement).closest('input,textarea,select')) return;
    const touch = e.touches[0];
    if (!touch) return;
    y0 = touch.clientY;
    dy = 0;
    p.style.transition = 'none';
  }, { passive: true });
  p.addEventListener('touchmove', (e: TouchEvent) => {
    if (y0 === null) return;
    const touch = e.touches[0];
    if (!touch) return;
    dy = touch.clientY - y0;
    if (dy > 0) p.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  p.addEventListener('touchend', () => {
    if (y0 === null) return;
    y0 = null;
    p.style.transition = 'transform .22s cubic-bezier(.16,1,.3,1)';
    if (dy > 95) {
      p.style.transform = 'translateY(100%)';
      setTimeout(() => closeModal(id), 200);
    } else p.style.transform = 'translateY(0)';
  });
}

/**
 * Open a modal by ID
 */
export function openModal(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const panel = el.querySelector('.bottom-sheet-panel') as HTMLElement | null;
  if (panel) {
    panel.style.transform = 'translateY(0px)';
    panel.style.transition = '';
  }
  el.classList.remove('hidden');
}

/**
 * Close a modal by ID
 */
export function closeModal(id: string): void {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

// Common style classes for modal inputs
export const IN = 'w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs';
export const LB = 'text-slate-400 block mb-1 text-[11px]';
export const HEAD = (t: string, id: string) => `<div class="flex justify-between items-center"><h3 class="text-sm font-black uppercase tracking-wider text-cyan-400">${t}</h3><button onclick="closeModal('${id}')" class="text-slate-400 hover:text-white text-sm px-2">✕</button></div>`;