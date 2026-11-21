/**
 * ARGON v6.0 — MBE Date Picker Section
 * Renders the date selector for MBE dashboard.
 * Import from: import { renderDatePicker } from '@/components/mbe/sections/date-picker';
 */

import { todayIso } from '@/utils/date';
import { card, note, getSelectedDay } from '../utils';
import type { ComputedDailyScore } from '@/api/schemas';

interface DatePickerOptions {
  state: { comp: ComputedDailyScore[]; selectedDate: string | null };
  onDateChange: (date: string) => void;
  onTodayClick: () => void;
}

/**
 * Render date picker section
 */
export function renderDatePicker(options: DatePickerOptions): string {
  const { state, onDateChange, onTodayClick } = options;
  const today = todayIso();
  const selected = state.selectedDate || today;
  const opts = state.comp.slice(0, 30).map(r =>
    `<option value="${r.log_date}" ${r.log_date === selected ? 'selected' : ''}>
      ${r.log_date} ${r.recovery_score != null ? '· Rec ' + r.recovery_score + '%' : ''}${r.total_sleep_min ? ' · ' + (r.total_sleep_min / 60).toFixed(1) + 'h' : ''}
    </option>`
  ).join('');
  return card('📅 Día', 'Selector de fecha (histórico 30 d)',
    `<div class="flex items-center gap-3">
      <label class="text-xs text-slate-400" for="mbe-date">Fecha</label>
      <select id="mbe-date" onchange="mbeLoad(this.value)" class="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm">${opts}</select>
      <button onclick="mbeLoad('${today}')" class="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-xl text-xs font-bold">Hoy</button>
    </div>` +
    note('Las tarjetas muestran datos computados por el servidor para el día seleccionado. El servidor recalcula al recibir datos raw (webhook o guardado manual).')
  );
}