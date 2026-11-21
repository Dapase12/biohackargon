/**
 * ARGON v6.0 — Meal Helpers Component
 * Meal data access, modal rendering, food search, AI estimation, and meal card.
 * Import from: import { getMeals, injectMealModal, openMealModal, renderMealCard } from '@/components/app/meal-helpers';
 */

import { config } from '@/config';
import { kcalOf } from '@/utils/format';
import { sheet, HEAD, IN, LB, wireSheet, openModal, closeModal } from './modal-helpers';

const MKEY = 'argon_meals_v2';
const MFTYPES = ['ayuno', 'desayuno', 'comida', 'merienda', 'cena'] as const;

function lsGet(key: string, def: any) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(def)); } catch { return def; }
}

function rd1(x: number) { return Math.round(x * 10) / 10; }

export interface MealData {
  [date: string]: {
    [mf: string]: {
      foods: any[];
      kcal: number;
      protein: number;
      carbs: number;
      fat: number;
      water_ml: number;
    }
  };
}

export function getAllMeals(): MealData {
  return lsGet(MKEY, {});
}

export function getDayMeals(date: string): MealData[string] {
  return getAllMeals()[date] || {};
}

export function setDayMeals(date: string, obj: MealData[string]): void {
  const s = getAllMeals();
  s[date] = obj;
  const ks = Object.keys(s).sort();
  while (ks.length > 60) delete s[ks.shift()!];
  localStorage.setItem(MKEY, JSON.stringify(s));
}

export function getMealTypes(): typeof MFTYPES {
  return MFTYPES;
}

/**
 * Inject meal modal into DOM
 */
export function injectMealModal(): void {
  document.body.insertAdjacentHTML('beforeend',
    sheet('meal-modal', `${HEAD('🍽️ Registrar comida', 'meal-modal')}
      <div class="grid grid-cols-2 gap-2.5">
        <div><label class="${LB}" for="mf-type">Tipo de comida</label>
          <select id="mf-type" class="${IN} bg-slate-800">
            ${MFTYPES.map(t => `<option value="${t}">${t.charAt(0).toUpperCase() + t.slice(1)}</option>`).join('')}
          </select>
        </div>
        <div><label class="${LB}" for="mf-time">Hora</label><input id="mf-time" type="time" class="${IN}" /></div>
      </div>
      <div class="flex gap-1.5"><input id="mf-search" type="text" placeholder="Buscar alimento..." class="${IN} flex-1" oninput="mfDebouncedSearch()" /><button onclick="mfAiEstimate()" class="jchip" style="min-width:auto">🤖 IA</button></div>
      <div id="mf-results" class="max-h-48 overflow-y-auto space-y-1"></div>
      <div class="grid grid-cols-4 gap-2 text-center">
        <div class="bg-slate-950/60 rounded-xl p-2 border border-slate-800"><div class="text-[10px] text-slate-400">kcal</div><div id="mf-kcal" class="font-mono text-cyan-300">0</div></div>
        <div class="bg-slate-950/60 rounded-xl p-2 border border-slate-800"><div class="text-[10px] text-slate-400">P</div><div id="mf-p" class="font-mono text-emerald-300">0g</div></div>
        <div class="bg-slate-950/60 rounded-xl p-2 border border-slate-800"><div class="text-[10px] text-slate-400">C</div><div id="mf-c" class="font-mono text-violet-300">0g</div></div>
        <div class="bg-slate-950/60 rounded-xl p-2 border border-slate-800"><div class="text-[10px] text-slate-400">G</div><div id="mf-f" class="font-mono text-amber-300">0g</div></div>
      </div>
      <div id="mf-selected" class="space-y-1 max-h-40 overflow-y-auto"></div>
      <div class="flex gap-1.5"><button onclick="mfSave()" class="jchip on flex-1">Guardar comida</button><button onclick="mfQuickWater()" class="jchip" style="min-width:auto">💧 Agua</button></div>
      <div id="mf-list" class="space-y-1.5"></div>`)
  );
  wireSheet('meal-modal');
}

let mfSearchTimer: number | null = null;
// Edamam config would come from localStorage or config.js - for now use empty strings
const EDAMAM_APP_ID = '';
const EDAMAM_APP_KEY = '';

function getLocalStore(): Record<string, any> {
  try { return JSON.parse(localStorage.getItem('argon_local_store') || '{}'); } catch { return {}; }
}

function showToast(msg: string): void {
  if (typeof window !== 'undefined' && window.showToast) window.showToast(msg);
  else console.log('Toast:', msg);
}

function mfTypeLabel(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function openMealModal(): void {
  const dateEl = document.getElementById('selected-date') as HTMLInputElement;
  const d = dateEl?.value ?? new Date().toISOString().split('T')[0];
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  (document.getElementById('mf-time') as HTMLInputElement).value = `${hh}:${mm}`;
  (document.getElementById('mf-search') as HTMLInputElement).value = '';
  const res = document.getElementById('mf-results'); if (res) res.innerHTML = '';
  const sel = document.getElementById('mf-selected'); if (sel) sel.innerHTML = '';
  ([['mf-kcal', '0'], ['mf-p', '0g'], ['mf-c', '0g'], ['mf-f', '0g']] as const).forEach(([id, v]) => { const el = document.getElementById(id); if (el) el.textContent = v; });
  mfRenderList();
  openModal('meal-modal');
}

export function closeMealModal(): void {
  closeModal('meal-modal');
}

export async function mfDebouncedSearch(): Promise<void> {
  const q = (document.getElementById('mf-search') as HTMLInputElement).value.trim();
  const res = document.getElementById('mf-results');
  if (!res) return;
  if (!q || q.length < 2) { res.innerHTML = ''; return; }
  if (mfSearchTimer) clearTimeout(mfSearchTimer);
  mfSearchTimer = window.setTimeout(async () => {
    if (!EDAMAM_APP_ID || !EDAMAM_APP_KEY) { res.innerHTML = '<div class="text-[11px] text-slate-500 p-2">Configura Edamam en Ajustes</div>'; return; }
    try {
      const url = `https://api.edamam.com/api/food-database/v2/parser?app_id=${EDAMAM_APP_ID}&app_key=${EDAMAM_APP_KEY}&ingr=${encodeURIComponent(q)}&nutrition-type=cooking`;
      const r = await fetch(url);
      const data = await r.json();
      const items = (data.hints || []).slice(0, 8).map((h: any) => h.food);
      if (!items.length) { res.innerHTML = '<div class="text-[11px] text-slate-500 p-2">Sin resultados</div>'; return; }
      res.innerHTML = items.map((f: any) => `<button onclick="mfAddFood(${JSON.stringify(f).replace(/"/g, '"')})" class="w-full text-left p-2 rounded-xl bg-slate-800/50 border border-slate-700/50 hover:bg-slate-800 flex justify-between"><span class="truncate">${f.label} <span class="text-[10px] text-slate-400">(${f.brand || 'genérico'})</span></span><span class="text-[11px] font-mono text-cyan-300">${Math.round(f.nutrients?.ENERC_KCAL || 0)} kcal</span></button>`).join('');
    } catch { res.innerHTML = '<div class="text-[11px] text-rose-400 p-2">Error en búsqueda</div>'; }
  }, 250);
}

export function mfAddFood(f: any): void {
  const mf = (document.getElementById('mf-type') as HTMLSelectElement).value;
  const time = (document.getElementById('mf-time') as HTMLInputElement).value || new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false });
  const meals = getDayMeals((document.getElementById('selected-date') as HTMLInputElement)?.value ?? new Date().toISOString().split('T')[0]);
  const mc = meals[mf] || { foods: [], kcal: 0, protein: 0, carbs: 0, fat: 0, water_ml: 0 };
  const food = {
    label: f.label,
    brand: f.brand,
    kcal: Math.round(f.nutrients?.ENERC_KCAL || 0),
    protein: rd1(f.nutrients?.PROCNT || 0),
    carbs: rd1(f.nutrients?.CHOCDF || 0),
    fat: rd1(f.nutrients?.FAT || 0),
    qty: 100,
    unit: 'g',
    time,
  };
  mc.foods.push(food);
  mc.kcal += food.kcal;
  mc.protein = rd1(mc.protein + food.protein);
  mc.carbs = rd1(mc.carbs + food.carbs);
  mc.fat = rd1(mc.fat + food.fat);
  meals[mf] = mc;
  setDayMeals((document.getElementById('selected-date') as HTMLInputElement)?.value ?? new Date().toISOString().split('T')[0], meals);
  mfUpdateTotals();
  mfRenderSelected();
  showToast(`✓ ${food.label} añadido`);
}

function mfUpdateTotals(): void {
  const dateEl = document.getElementById('selected-date') as HTMLInputElement;
  const d = dateEl?.value ?? new Date().toISOString().split('T')[0];
  const meals = getDayMeals(d);
  const mf = (document.getElementById('mf-type') as HTMLSelectElement).value;
  const mc = meals[mf];
  if (mc) {
    (document.getElementById('mf-kcal') as HTMLElement).textContent = String(mc.kcal);
    (document.getElementById('mf-p') as HTMLElement).textContent = `${mc.protein}g`;
    (document.getElementById('mf-c') as HTMLElement).textContent = `${mc.carbs}g`;
    (document.getElementById('mf-f') as HTMLElement).textContent = `${mc.fat}g`;
  }
}

function mfRenderSelected(): void {
  const dateEl = document.getElementById('selected-date') as HTMLInputElement;
  const d = dateEl?.value ?? new Date().toISOString().split('T')[0];
  const meals = getDayMeals(d);
  const mf = (document.getElementById('mf-type') as HTMLSelectElement).value;
  const mc = meals[mf];
  const el = document.getElementById('mf-selected');
  if (!el || !mc || !mc.foods.length) { if (el) el.innerHTML = ''; return; }
  el.innerHTML = mc.foods.map((f: any, i: number) => `<div class="flex justify-between items-center p-2 rounded-xl bg-slate-800/50 border border-slate-700/50"><span class="text-xs truncate pr-2">${f.label} <span class="text-[10px] text-slate-400">${f.qty}${f.unit}</span></span><div class="flex items-center gap-2"><span class="text-[11px] font-mono text-cyan-300">${f.kcal} kcal</span><button onclick="mfRemoveFood(${i})" class="text-rose-400 text-sm">✕</button></div></div>`).join('');
}

export function mfRemoveFood(idx: number): void {
  const dateEl = document.getElementById('selected-date') as HTMLInputElement;
  const d = dateEl?.value ?? new Date().toISOString().split('T')[0];
  const meals = getDayMeals(d);
  const mf = (document.getElementById('mf-type') as HTMLSelectElement).value;
  const mc = meals[mf];
  if (!mc || !mc.foods[idx]) return;
  const f = mc.foods.splice(idx, 1)[0];
  mc.kcal = Math.max(0, mc.kcal - f.kcal);
  mc.protein = rd1(Math.max(0, mc.protein - f.protein));
  mc.carbs = rd1(Math.max(0, mc.carbs - f.carbs));
  mc.fat = rd1(Math.max(0, mc.fat - f.fat));
  meals[mf] = mc;
  setDayMeals(d, meals);
  mfUpdateTotals();
  mfRenderSelected();
  mfRenderList();
  showToast(`✕ ${f.label} eliminado`);
}

export async function mfAiEstimate(): Promise<void> {
  showToast('🤖 Estimación IA: próximamente (requiere API key)');
}

export function mfQuickWater(): void {
  const dateEl = document.getElementById('selected-date') as HTMLInputElement;
  const d = dateEl?.value ?? new Date().toISOString().split('T')[0];
  const meals = getDayMeals(d);
  const mf = (document.getElementById('mf-type') as HTMLSelectElement).value;
  const mc = meals[mf] || { foods: [], kcal: 0, protein: 0, carbs: 0, fat: 0, water_ml: 0 };
  mc.water_ml = (mc.water_ml || 0) + 250;
  meals[mf] = mc;
  setDayMeals(d, meals);
  mfRenderList();
  showToast('💧 +250 ml agua');
}

export async function mfSave(renderMealCardFn?: () => void): Promise<void> {
  const mf = (document.getElementById('mf-type') as HTMLSelectElement).value;
  const time = (document.getElementById('mf-time') as HTMLInputElement).value;
  if (!time) return showToast('Selecciona una hora');
  showToast(`✓ ${mfTypeLabel(mf)} guardada`);
  if (renderMealCardFn) renderMealCardFn();
  closeMealModal();
}

export function mfRenderList(): void {
  const dateEl = document.getElementById('selected-date') as HTMLInputElement;
  const d = dateEl?.value ?? new Date().toISOString().split('T')[0];
  const meals = getDayMeals(d);
  const el = document.getElementById('mf-list');
  if (!el) return;
  el.innerHTML = MFTYPES.map(t => {
    const mc = meals[t];
    if (!mc || (!mc.foods.length && !mc.water_ml)) return `<div class="text-[11px] text-slate-500 py-1">${mfTypeLabel(t)}: —</div>`;
    const foods = mc.foods.map((f: any) => `${f.label} ${f.kcal}kcal`).join(' · ');
    return `<div class="p-2 rounded-xl bg-slate-950/60 border border-slate-800/70"><div class="flex justify-between text-xs"><span class="font-medium">${mfTypeLabel(t)}</span><span class="font-mono text-cyan-300">${mc.kcal} kcal</span></div><div class="text-[10px] text-slate-400 truncate">${foods || `Agua: ${mc.water_ml}ml`}</div></div>`;
  }).join('');
}

/**
 * Render meal card in swiper slide
 */
export function renderMealCard(): void {
  const dateEl = document.getElementById('selected-date') as HTMLInputElement;
  const d = dateEl?.value ?? new Date().toISOString().split('T')[0];
  const meals = getDayMeals(d);
  const mealCard = document.getElementById('meal-card');
  if (!mealCard) return;
  const totalKcal = MFTYPES.reduce((s, t) => s + (meals[t]?.kcal || 0), 0);
  const totalProtein = MFTYPES.reduce((s, t) => s + (meals[t]?.protein || 0), 0);
  const totalCarbs = MFTYPES.reduce((s, t) => s + (meals[t]?.carbs || 0), 0);
  const totalFat = MFTYPES.reduce((s, t) => s + (meals[t]?.fat || 0), 0);
  const totalWater = MFTYPES.reduce((s, t) => s + (meals[t]?.water_ml || 0), 0);
  const store = getLocalStore();
  const rec = store[d];
  // Use targetKcal from computed scores or config.targets.kcal
  const target = rec?.target_kcal || config.targets?.kcal || 2200;
  const deficit = target - totalKcal;
  mealCard.innerHTML = `<div class="flex items-center justify-between"><div><h2 class="text-xs font-extrabold uppercase tracking-wider text-white">🍽️ Nutrición</h2><p class="text-[10px] text-slate-400">${totalKcal}/${target} kcal · Déficit: ${deficit > 0 ? '+' : ''}${deficit} kcal</p></div><button onclick="openMealModal()" class="jchip on">+ Registrar</button></div>
    <div class="grid grid-cols-4 gap-2 text-center">
      <div class="bg-slate-950/60 rounded-xl p-2 border border-slate-800"><div class="text-[10px] text-slate-400">kcal</div><div class="font-mono text-cyan-300">${totalKcal}</div></div>
      <div class="bg-slate-950/60 rounded-xl p-2 border border-slate-800"><div class="text-[10px] text-slate-400">P</div><div class="font-mono text-emerald-300">${totalProtein}g</div></div>
      <div class="bg-slate-950/60 rounded-xl p-2 border border-slate-800"><div class="text-[10px] text-slate-400">C</div><div class="font-mono text-violet-300">${totalCarbs}g</div></div>
      <div class="bg-slate-950/60 rounded-xl p-2 border border-slate-800"><div class="text-[10px] text-slate-400">G</div><div class="font-mono text-amber-300">${totalFat}g</div></div>
    </div>
    <div class="text-[10px] text-slate-400">Agua: ${totalWater} ml</div>
    ${MFTYPES.map(t => {
      const mc = meals[t];
      if (!mc || (!mc.foods.length && !mc.water_ml)) return '';
      return `<div class="p-2 rounded-xl bg-slate-950/60 border border-slate-800/70"><div class="flex justify-between text-xs"><span>${mfTypeLabel(t)}</span><span class="font-mono text-cyan-300">${mc.kcal} kcal</span></div><div class="text-[10px] text-slate-400 truncate">${mc.foods.map((f: any) => f.label).join(' · ') || `Agua: ${mc.water_ml}ml`}</div></div>`;
    }).join('') || `<div class="text-[11px] text-slate-500">Sin comidas registradas hoy.</div>`}`;
}

// Attach global functions for inline onclick handlers
if (typeof window !== 'undefined') {
  (window as any).mfDebouncedSearch = mfDebouncedSearch;
  (window as any).mfAddFood = mfAddFood;
  (window as any).mfRemoveFood = mfRemoveFood;
  (window as any).mfAiEstimate = mfAiEstimate;
  (window as any).mfQuickWater = mfQuickWater;
  (window as any).mfSave = mfSave;
  (window as any).mfRenderList = mfRenderList;
  (window as any).mfUpdateTotals = mfUpdateTotals;
  (window as any).openMealModal = openMealModal;
  (window as any).closeMealModal = closeMealModal;
}