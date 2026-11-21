/**
 * ARGON v6.0 — Workout Helpers Component
 * Workout data access, modal rendering, and workout card.
 * Import from: import { getWorkouts, injectWorkoutModal, openWorkoutModal, renderWorkoutCard } from '@/components/app/workout-helpers';
 */

import { config } from '@/config';
import { kcalOf } from '@/utils/format';
import { sheet, HEAD, IN, LB, wireSheet, openModal, closeModal } from './modal-helpers';

const WKEY = 'argon_workouts_v1';
const TKEY = 'argon_wk_timer';
let wkType = 'weights';
let tInt: number | null = null;

const WTYPES = [
  ['weights', '🏋️ Pesas', 7],
  ['pickle', '🏓 Pickleball', 7],
  ['cardio', '🏃 Cardio', 6],
  ['hiit', '⚡ HIIT', 9],
  ['walk', '🚶 Caminata', 3],
  ['other', '✨ Otro', 5],
] as const;

const RPE_TXT = ['', 'Muy suave', 'Suave', 'Ligero', 'Moderado', 'Algo duro', 'Duro', 'Muy duro', 'Intenso', 'Casi máximo', 'Máximo'];

function lsGet(key: string, def: any) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(def)); } catch { return def; }
}

function rd1(x: number) { return Math.round(x * 10) / 10; }

interface ZonesData {
  real: boolean;
  walking_steps: number;
  z1: number;
  z2: number;
  z3: number;
  z4: number;
  z5: number;
}

function aggregateWorkouts(ws: any[], pz: any): { min: number; rpe: number; zones: ZonesData | null } {
  const min = ws.reduce((s, w) => s + (+w.min || 0), 0);
  const rpe = min ? ws.reduce((s, w) => s + (+w.min || 0) * (+w.rpe || 0), 0) / min : 0;
  let zones: ZonesData | null = null;
  if (ws.length && ws.every(w => w.z)) {
    zones = { real: true, walking_steps: (pz && pz.walking_steps) || 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
    (['z1', 'z2', 'z3', 'z4', 'z5'] as const).forEach(k => {
      if (zones) zones[k] = Math.round(ws.reduce((s, w) => s + (+(w.z && (w.z as any)[k]) || 0), 0));
    });
  }
  return { min, rpe: +rpe.toFixed(2), zones };
}

export function getAllWorkouts(): Record<string, any[]> {
  return lsGet(WKEY, {});
}

export function getDayWorkouts(date: string): any[] {
  return getAllWorkouts()[date] || [];
}

export function setDayWorkouts(date: string, arr: any[]): void {
  const s = getAllWorkouts();
  s[date] = arr;
  const ks = Object.keys(s).sort();
  while (ks.length > 60) {
    const keyToDelete = ks.shift();
    if (keyToDelete) delete s[keyToDelete];
  }
  localStorage.setItem(WKEY, JSON.stringify(s));
}

export function getWorkoutTypes(): typeof WTYPES {
  return WTYPES;
}

export function getCurrentWorkoutType(): string {
  return wkType;
}

export function setWorkoutType(type: string): void {
  wkType = type;
}

export function getRpeLabels(): typeof RPE_TXT {
  return RPE_TXT;
}

/**
 * Inject workout modal into DOM
 */
export function injectWorkoutModal(): void {
  document.body.insertAdjacentHTML('beforeend',
    sheet('workout-modal', `${HEAD('🏋️ Registrar entrenamiento', 'workout-modal')}
      <div id="wk-types" class="flex flex-wrap gap-1.5"></div>
      <div class="p-3 rounded-2xl bg-slate-950/80 border border-slate-800 flex items-center justify-between">
        <div><div class="text-[10px] text-slate-400">Cronómetro</div><div id="wk-timer" class="text-2xl font-black font-mono text-white tnum">00:00</div></div>
        <div class="flex gap-1.5"><button id="wk-start" onclick="wkTimerStart()" class="jchip on">▶ Iniciar</button><button onclick="wkTimerStop()" class="jchip">■ Detener</button></div>
      </div>
      <div class="grid grid-cols-2 gap-2.5">
        <div><label class="${LB}" for="wk-min">Duración (min)</label><input id="wk-min" type="number" placeholder="60" class="${IN}" /></div>
        <div><label class="${LB}" for="wk-rpe">Esfuerzo percibido (RPE) <b id="wk-rpe-v" class="text-cyan-300"></b></label><input id="wk-rpe" type="range" min="1" max="10" step="0.5" class="w-full accent-cyan-400" oninput="wkRpeLabel()" /></div>
      </div>
      <details class="text-xs"><summary class="text-[11px] text-slate-300 cursor-pointer py-1">Zonas de FC de la sesión (opcional)</summary>
        <div class="grid grid-cols-5 gap-1 pt-2">${[1, 2, 3, 4, 5].map(i => `<input id="wk-z${i}" type="number" placeholder="Z${i}" class="bg-slate-800 border border-slate-700 rounded-xl px-1 py-2 text-white text-center text-xs" />`).join('')}</div>
        <p class="text-[10px] text-slate-500 pt-1">Si completas zonas en todas las sesiones del día, el motor las usa en lugar de la estimación por RPE.</p></details>
      <button onclick="wkSave()" class="w-full py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-black font-black text-xs uppercase tracking-wider">Guardar sesión</button>
      <div id="wk-list" class="space-y-1.5"></div>`)
  );
  wireSheet('workout-modal');
}

function fmtT(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function timerTick(): void {
  const t0Str = localStorage.getItem(TKEY);
  const t0 = t0Str ? parseInt(t0Str, 10) : 0;
  const el = document.getElementById('wk-timer');
  if (el) el.textContent = t0 ? fmtT(Date.now() - t0) : '00:00';
  const startEl = document.getElementById('wk-start');
  if (startEl) startEl.textContent = t0 ? '⏱ En curso' : '▶ Iniciar';
}

export function wkTimerStart(): void {
  if (!localStorage.getItem(TKEY)) localStorage.setItem(TKEY, String(Date.now()));
  timerTick();
}

export function wkTimerStop(): void {
  const t0Str = localStorage.getItem(TKEY);
  const t0 = t0Str ? parseInt(t0Str, 10) : 0;
  if (!t0) return;
  (document.getElementById('wk-min') as HTMLInputElement).value = String(Math.max(1, Math.round((Date.now() - t0) / 60000)));
  localStorage.removeItem(TKEY);
  timerTick();
}

export function wkPickType(k: string): void {
  wkType = k;
  const t = WTYPES.find(x => x[0] === k);
  if (t) (document.getElementById('wk-rpe') as HTMLInputElement).value = String(t[2]);
  wkRpeLabel();
  wkTypeButtons();
}

export function wkRpeLabel(): void {
  const v = parseFloat((document.getElementById('wk-rpe') as HTMLInputElement).value);
  const el = document.getElementById('wk-rpe-v');
  if (el) el.textContent = `${v} · ${RPE_TXT[Math.round(v)]}`;
}

function wkTypeButtons(): void {
  const el = document.getElementById('wk-types');
  if (el) el.innerHTML = WTYPES.map(t => `<button class="jchip ${t[0] === wkType ? 'on' : ''}" onclick="wkPickType('${t[0]}')">${t[1]}</button>`).join('');
}

function wkRenderList(): void {
  const dateEl = document.getElementById('selected-date') as HTMLInputElement;
  const d = dateEl?.value ?? new Date().toISOString().split('T')[0];
  const ws = getDayWorkouts(d);
  const lbl = (k: string) => (WTYPES.find(t => t[0] === k) || ['', '🏷️ ' + k])[1];
  const listEl = document.getElementById('wk-list');
  if (!listEl) return;
  listEl.innerHTML = `<div class="text-[11px] font-bold text-slate-300 pt-1">Sesiones del ${d}</div>` +
    (ws.length ? ws.map(w => `<div class="d-row" style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-radius:12px;background:rgba(2,6,23,.65);border:1px solid rgba(255,255,255,.06);font-size:12px"><span>${lbl(w.type)} · <b class="font-mono">${w.min}</b> min · RPE ${w.rpe}${w.z ? ' · zonas ✓' : ''}</span><button onclick="wkRemove('${w.id}')" class="text-rose-400 font-bold px-1">✕</button></div>`).join('') : '<div class="text-[11px] text-slate-500">Sin sesiones registradas.</div>');
}

export function openWorkoutModal(): void {
  wkPickType(wkType);
  timerTick();
  if (tInt) clearInterval(tInt);
  tInt = window.setInterval(timerTick, 500);
  wkRenderList();
  openModal('workout-modal');
}

export async function wkSave(applyWorkoutsFn?: (date: string) => Promise<void>, renderWkCardFn?: () => void): Promise<void> {
  const min = parseFloat((document.getElementById('wk-min') as HTMLInputElement).value);
  const rpe = parseFloat((document.getElementById('wk-rpe') as HTMLInputElement).value);
  const dateEl = document.getElementById('selected-date') as HTMLInputElement;
  const d = dateEl?.value ?? new Date().toISOString().split('T')[0];
  const store = getLocalStore();
  const cur = store[d];
  if (!cur) return showToast('No hay registro para esta fecha');
  if (!(min >= 1 && min <= 600)) return showToast('Duración entre 1 y 600 min');

  let ws = getDayWorkouts(d).slice();
  if (!ws.length && cur.pickleball_or_gym_minutes > 0) {
    ws.push({ id: 'm' + Date.now(), type: 'other', min: cur.pickleball_or_gym_minutes, rpe: cur.session_rpe || 7, manual: true });
  }
  const zs = [1, 2, 3, 4, 5].map(i => (document.getElementById(`wk-z${i}`) as HTMLInputElement)?.value ?? '');
  const z = zs.some(v => v !== '') ? { z1: +(zs[0] ?? '0'), z2: +(zs[1] ?? '0'), z3: +(zs[2] ?? '0'), z4: +(zs[3] ?? '0'), z5: +(zs[4] ?? '0') } : null;
  ws.push({ id: 'w' + Date.now(), type: wkType, min, rpe, z, ts: Date.now() });
  setDayWorkouts(d, ws);
  (document.getElementById('wk-min') as HTMLInputElement).value = '';
  [1, 2, 3, 4, 5].forEach(i => { const el = document.getElementById(`wk-z${i}`); if (el) (el as HTMLInputElement).value = ''; });
  wkRenderList();
  if (applyWorkoutsFn) await applyWorkoutsFn(d);
  if (renderWkCardFn) renderWkCardFn();
  showToast('✓ Sesión guardada');
}

export function wkRemove(id: string, applyWorkoutsFn?: (date: string) => Promise<void>, renderWkCardFn?: () => void): void {
  const dateEl = document.getElementById('selected-date') as HTMLInputElement;
  const d = dateEl?.value ?? new Date().toISOString().split('T')[0];
  setDayWorkouts(d, getDayWorkouts(d).filter(w => w.id !== id));
  wkRenderList();
  if (applyWorkoutsFn) applyWorkoutsFn(d);
  if (renderWkCardFn) renderWkCardFn();
}

export function closeWorkoutModal(): void {
  if (tInt) clearInterval(tInt);
  closeModal('workout-modal');
}

// Need getLocalStore from somewhere - import from main-app or config
function getLocalStore(): Record<string, any> {
  try {
    return JSON.parse(localStorage.getItem('argon_local_store') || '{}');
  } catch {
    return {};
  }
}

function showToast(msg: string): void {
  if (typeof window !== 'undefined' && window.showToast) {
    window.showToast(msg);
  } else {
    console.log('Toast:', msg);
  }
}

/**
 * Render workout card in swiper slide
 */
export function renderWorkoutCard(): void {
  const dateEl = document.getElementById('selected-date') as HTMLInputElement;
  const d = dateEl?.value ?? new Date().toISOString().split('T')[0];
  const ws = getDayWorkouts(d);
  const store = getLocalStore();
  const rec = store[d];
  const lbl = (k: string) => (WTYPES.find(t => t[0] === k) || ['', '🏷️'])[1];
  const wk = Object.keys(store).sort().slice(-7).map(x => store[x]);
  const mins = wk.reduce((s, r) => s + (r.pickleball_or_gym_minutes || 0), 0);
  const n = wk.filter(r => r.pickleball_or_gym_minutes > 0).length;
  const wkCard = document.getElementById('wk-card');
  if (wkCard) {
    wkCard.innerHTML = `<div class="flex items-center justify-between"><div><h2 class="text-xs font-extrabold uppercase tracking-wider text-white">🏋️ Entrenamientos</h2><p class="text-[10px] text-slate-400">7 días: ${n} sesiones · ${mins} min</p></div><button onclick="openWorkoutModal()" class="jchip on">+ Registrar</button></div>` +
      (ws.length ? ws.map(w => `<div class="flex justify-between text-xs p-2 rounded-xl bg-slate-950/60 border border-slate-800/70"><span>${lbl(w.type)}</span><span class="font-mono text-slate-300">${w.min} min · RPE ${w.rpe}</span></div>`).join('') : `<div class="text-[11px] text-slate-500">${rec && rec.pickleball_or_gym_minutes > 0 ? `Registro manual: ${rec.pickleball_or_gym_minutes} min.` : 'Sin sesiones este día.'}</div>`);
  }
}