/**
 * Week strip dashboard component.
 */

import { s } from '../../utils';

/**
 * Render week strip (last 7 days recovery scores).
 */
export function renderWeek(record: any, allRecordsSorted: any[]): void {
  const wk = document.getElementById('week-strip');
  if (!wk || !allRecordsSorted?.length) return;

  const recordDate = record?.log_date;
  const last7 = allRecordsSorted
    .filter(r => !recordDate || r.log_date <= recordDate)
    .slice(-7);

  wk.innerHTML = last7.map(r => {
    const v = s(r, 'recovery_score', 0);
    const c = v >= 67 ? '#10B981' : (v >= 34 ? '#F59E0B' : '#EF4444');
    const sel = recordDate && r.log_date === recordDate;
    const dow = ['D', 'L', 'M', 'M', 'J', 'V', 'S'][new Date(r.log_date + 'T12:00:00').getDay()];
    return `<div class="flex flex-col items-center flex-1 ${sel ? '' : 'opacity-70'}"><span class="text-[9px] font-mono text-slate-300">${v}</span><div class="w-full max-w-[26px] rounded-md mt-0.5" style="height:${Math.max(6, Math.round(v * 0.38))}px;background:${c}"></div><span class="text-[9px] mt-1 ${sel ? 'text-cyan-300 font-bold' : 'text-slate-500'}">${dow}</span></div>`;
  }).join('');
}