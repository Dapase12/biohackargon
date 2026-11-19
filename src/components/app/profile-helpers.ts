/**
 * ARGON v6.0 — Profile Helpers Component
 * Profile data access and profile modal rendering.
 * Import from: import { getProfile, renderProfileModal, saveProfile } from '@/components/app/profile-helpers';
 */

import { todayIso } from '@/utils/date';
import { config } from '@/config';
import { STORAGE_KEYS } from '@/constants';
import { sheet, HEAD, IN, LB, wireSheet, openModal, closeModal } from './modal-helpers';

function lsGet(k: string, d: any) {
  try { return JSON.parse(localStorage.getItem(k) || JSON.stringify(d)); } catch { return d; }
}

function rd1(x: number) { return Math.round(x * 10) / 10; }

export interface ProfileData {
  birth: string;
  height_m: number;
  wake: string;
  deficit: number;
}

/**
 * Get current profile data from localStorage with config fallback
 */
export function getProfile(): ProfileData {
  let p: any = {};
  try { p = JSON.parse(localStorage.getItem('argon_profile_v1') || '{}'); } catch {}
  const wake = localStorage.getItem('argon_wake_time') || (config.profile?.habitualWake || '06:30');
  const h = parseFloat(p.height_cm);
  const d = parseFloat(p.deficit);
  // Profile schema uses birthYear, heightCm, dailyDeficitKcal (negative)
  const birthYear = config.profile?.birthYear || 1990;
  const birth = /^\d{4}-\d{2}-\d{2}$/.test(p.birth || '') ? p.birth : `${birthYear}-01-01`;
  const heightM = config.profile?.heightCm ? config.profile.heightCm / 100 : 1.75;
  const deficit = Math.abs(config.profile?.dailyDeficitKcal || 500); // schema stores negative
  return {
    birth,
    height_m: (h >= 120 && h <= 230) ? h / 100 : heightM,
    wake: /^\d{2}:\d{2}$/.test(wake) ? wake : (config.profile?.habitualWake || '06:30'),
    deficit: (d >= 250 && d <= 900) ? d : deficit,
  };
}

/**
 * Render and inject profile modal into DOM
 */
export function injectProfileModal(): void {
  document.body.insertAdjacentHTML('beforeend',
    sheet('profile-modal', `<div id="pf-head"></div><p id="pf-sub" class="text-[11px] text-slate-400 leading-relaxed"></p>
      <div class="grid grid-cols-2 gap-2.5">
        <div><label class="${LB}">Fecha de nacimiento</label><input id="pf-birth" type="date" class="${IN}" /></div>
        <div><label class="${LB}">Altura (cm)</label><input id="pf-height" type="number" step="0.5" class="${IN}" /></div>
        <div><label class="${LB}">Peso actual de inicio (kg)</label><input id="pf-start" type="number" step="0.1" class="${IN}" /></div>
        <div><label class="${LB}">Peso meta (kg)</label><input id="pf-target" type="number" step="0.5" class="${IN}" /></div>
        <div><label class="${LB}">Fecha objetivo</label><input id="pf-goal" type="date" class="${IN}" /></div>
        <div><label class="${LB}">Hora de despertar</label><input id="pf-wake" type="time" class="${IN}" /></div>
        <div class="col-span-2"><label class="${LB}">Déficit calórico base (kcal/día, 250–900)</label><input id="pf-deficit" type="number" step="25" class="${IN}" /></div>
      </div>
      <button onclick="saveProfile()" id="pf-save" class="w-full py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-black font-black text-xs uppercase tracking-wider">Guardar y recalcular</button>
      <button onclick="skipOnboarding()" id="pf-skip" class="hidden w-full py-2 text-[11px] text-slate-400">Más tarde</button>`)
  );
  wireSheet('profile-modal');
}

/**
 * Open profile modal
 */
export function openProfileModal(welcome: boolean): void {
  const pr = getProfile();
  const headEl = document.getElementById('pf-head');
  const subEl = document.getElementById('pf-sub');
  if (headEl) headEl.innerHTML = HEAD(welcome === true ? '👋 Bienvenido a ARGON' : '👤 Perfil y metas', 'profile-modal');
  if (subEl) subEl.textContent = welcome === true
    ? 'Confirma tus datos: calibran edad fisiológica, IMC, ventana de sueño y déficit calórico.'
    : 'Estos datos alimentan el motor (edad fisiológica, IMC, sueño y nutrición).';
  const birthEl = document.getElementById('pf-birth') as HTMLInputElement;
  const heightEl = document.getElementById('pf-height') as HTMLInputElement;
  const wakeEl = document.getElementById('pf-wake') as HTMLInputElement;
  const deficitEl = document.getElementById('pf-deficit') as HTMLInputElement;
  const targetEl = document.getElementById('pf-target') as HTMLInputElement;
  const startEl = document.getElementById('pf-start') as HTMLInputElement;
  const goalEl = document.getElementById('pf-goal') as HTMLInputElement;
  const skipEl = document.getElementById('pf-skip') as HTMLElement;
  if (birthEl) birthEl.value = pr.birth;
  if (heightEl) heightEl.value = String(Math.round(pr.height_m * 1000) / 10);
  if (wakeEl) wakeEl.value = pr.wake;
  if (deficitEl) deficitEl.value = String(pr.deficit);
  if (targetEl) targetEl.value = localStorage.getItem('argon_target_w') || '80';
  if (startEl) startEl.value = localStorage.getItem('argon_start_w') || '';
  if (goalEl) goalEl.value = localStorage.getItem('argon_goal_date') || '2026-12-07';
  if (skipEl) skipEl.classList.toggle('hidden', welcome !== true);
  openModal('profile-modal');
}

/**
 * Skip onboarding
 */
export function skipOnboarding(): void {
  localStorage.setItem('argon_onboard_seen', '1');
  closeModal('profile-modal');
}

/**
 * Save profile and trigger recompute
 */
export async function saveProfile(recomputeFn?: () => Promise<void>): Promise<void> {
  const v = (id: string) => (document.getElementById(id) as HTMLInputElement)?.value || '';
  const today = todayIso();
  const birth = v('pf-birth');
  const h = parseFloat(v('pf-height'));
  const tw = parseFloat(v('pf-target'));
  const sw = parseFloat(v('pf-start'));
  const df = parseFloat(v('pf-deficit'));
  const wake = v('pf-wake');
  const goal = v('pf-goal');
  const maxBirth = new Date(Date.now() - 14 * 365.25 * 86400000).toISOString().slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth) || birth < '1930-01-01' || birth > maxBirth) return showToast('Fecha de nacimiento inválida');
  if (!(h >= 120 && h <= 230)) return showToast('Altura entre 120 y 230 cm');
  if (!(tw >= 40 && tw <= 200)) return showToast('Peso meta entre 40 y 200 kg');
  if (!(df >= 250 && df <= 900)) return showToast('Déficit entre 250 y 900 kcal');
  if (!/^\d{2}:\d{2}$/.test(wake)) return showToast('Hora de despertar inválida');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(goal) || goal < today) return showToast('La fecha objetivo debe ser futura');

  localStorage.setItem('argon_profile_v1', JSON.stringify({ birth, height_cm: h, deficit: df }));
  localStorage.setItem('argon_target_w', String(tw));
  localStorage.setItem('argon_wake_time', wake);
  localStorage.setItem('argon_goal_date', goal);
  if (sw >= 40) localStorage.setItem('argon_start_w', String(sw));

  const a = document.getElementById('cfg-target-weight'); if (a) (a as HTMLInputElement).value = String(tw);
  const b = document.getElementById('cfg-wake-time'); if (b) (b as HTMLInputElement).value = wake;

  closeModal('profile-modal');
  try { if (recomputeFn) await recomputeFn(); } catch (e) { console.error(e); }
  showToast('✓ Perfil guardado y datos recalculados');

  const gasUrl = (localStorage.getItem('argon_gas_url') || '').trim();
  if (gasUrl) {
    try {
      await fetch(gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'set_profile', profile: { birth, height_m: h / 100, wake, deficit: df, target_w: tw, goal_date: goal } })
      });
    } catch { showToast('Perfil guardado local; no se pudo avisar al servidor'); }
  }
}

// These need to be available globally - they'll be attached to window in main-app
declare global {
  interface Window {
    showToast: (msg: string) => void;
  }
}

function showToast(msg: string): void {
  if (typeof window !== 'undefined' && window.showToast) {
    window.showToast(msg);
  } else {
    console.log('Toast:', msg);
  }
}