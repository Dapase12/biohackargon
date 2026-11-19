/**
 * ARGON v6.0 — MBE Theme Section
 * Renders accent color selector.
 * Import from: import { renderTheme, applyAccent } from '@/components/mbe/sections/theme';
 */

import { card, ACC } from '../utils';

interface ThemeOptions {
  currentAccent: string;
}

/**
 * Render theme section
 */
export function renderTheme(options: ThemeOptions): string {
  const { currentAccent } = options;
  const chips = Object.keys(ACC).map(k =>
    `<button onclick="mbeAccent('${k}')" aria-label="${k}" class="w-9 h-9 rounded-full" style="background:${ACC[k]};outline:${k === currentAccent ? '3px solid #fff' : 'none'};outline-offset:2px"></button>`
  ).join('');
  return card('🎨 Color de acento', 'Se guarda en este dispositivo', `<div class="flex gap-3">${chips}</div>`);
}

/**
 * Apply accent color
 */
export function applyAccent(k: string): void {
  const c = ACC[k] || ACC.cyan;
  let s = document.getElementById('mbe-acc');
  if (!s) {
    s = document.createElement('style');
    s.id = 'mbe-acc';
    document.head.appendChild(s);
  }
  s.textContent = k && k !== 'cyan'
    ? `.text-cyan-300,.text-cyan-400,.text-cyan-200{color:${c}!important}.border-cyan-500\\/30,.border-cyan-500\\/40,.border-cyan-500\\/45{border-color:${c}66!important}.bg-cyan-500\\/15,.bg-cyan-500\\/10,.bg-cyan-500\\/20{background-color:${c}26!important}.tab-btn-active{color:${c}!important;border-color:${c}73!important}`
    : '';
  const t = document.querySelector('meta[name=theme-color]');
  if (t) t.content = '#05080F';
}