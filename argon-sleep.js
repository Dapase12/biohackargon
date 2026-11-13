/**
 * ARGON Sleep Staging Dashboard Module
 *
 * Fetches sleep staging data from Supabase and renders:
 * - Hypnogram (sleep stage timeline)
 * - HRV trends (lnRMSSD, recovery score)
 * - Sleep scores (TST, SWS%, REM%, efficiency, debt)
 * - Cardio epoch features charts
 *
 * Usage: <script src="argon-sleep.js"></script>
 * Requires: window.CONFIG with supabase.url and supabase.anonKey
 * Requires: localStorage 'argon_sb_url' and 'argon_sb_key' (set in Settings)
 */

(function () {
  'use strict';

  const TZ = window.CONFIG?.profile?.timezone || 'UTC';
  const LS = (k, d) => {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : d;
    } catch (_) { return d; }
  };

  const cfg = () => ({
    url: (localStorage.getItem('argon_sb_url') || (window.CONFIG?.supabase?.url || '')).trim(),
    key: (localStorage.getItem('argon_sb_key') || '').trim(),
  });

  const state = {
    segmentations: [],
    epochFeatures: [],
    nightObservations: [],
    userProfile: null,
    dailyScores: [],
    selectedDate: null,
  };

  // ============================================================
  // UTILITIES
  // ============================================================
  const hhmm = (ms) =>
    new Intl.DateTimeFormat('es-VE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
      .format(new Date(ms));

  const hhmmss = (ms) =>
    new Intl.DateTimeFormat('es-VE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      .format(new Date(ms));

  const fmtDur = (min) => {
    if (!min && min !== 0) return '--';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const pct = (n, d = 1) => (n == null ? '--' : n.toFixed(d) + '%');

  // ============================================================
  // SUPABASE FETCH HELPERS
  // ============================================================
  async function sbGet(path, params = {}) {
    const c = cfg();
    if (!c.key) throw new Error('Falta Anon Key en ⚙️ Ajustes');

    const url = new URL(c.url + '/rest/v1/' + path);
    Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));

    const r = await fetch(url, {
      headers: { apikey: c.key, Authorization: 'Bearer ' + c.key },
    });
    if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + await r.text());
    return r.json();
  }

  // ============================================================
  // DATA LOADING
  // ============================================================
  async function loadSleepData(targetDate) {
    if (!cfg().key) return;

    try {
      const dateStr = targetDate || new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

      // 1. Sleep segmentations (last 30 days)
      state.segmentations = await sbGet('sleep_segmentations', {
        user_id: 'eq.' + (await getCurrentUserId()),
        log_date: 'gte.' + new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0],
        order: 'log_date.desc',
        limit: 30,
      });

      // 2. Epoch features for selected date's segmentation
      const todaySeg = state.segmentations.find(s => s.log_date === dateStr);
      if (todaySeg) {
        state.epochFeatures = await sbGet('sleep_epoch_features', {
          segmentation_id: 'eq.' + todaySeg.id,
          order: 'epoch_index.asc',
        });
      }

      // 3. Night observations (last 30 days)
      state.nightObservations = await sbGet('sleep_night_observations', {
        user_id: 'eq.' + (await getCurrentUserId()),
        log_date: 'gte.' + new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0],
        order: 'log_date.desc',
        limit: 30,
      });

      // 4. User profile
      const profileData = await sbGet('sleep_user_profiles', {
        user_id: 'eq.' + (await getCurrentUserId()),
      });
      state.userProfile = profileData[0] || null;

      // 5. Daily sleep scores (from view)
      state.dailyScores = await sbGet('sleep_daily_scores', {
        user_id: 'eq.' + (await getCurrentUserId()),
        log_date: 'gte.' + new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0],
        order: 'log_date.desc',
        limit: 30,
      });

      state.selectedDate = dateStr;
      renderAll();
    } catch (e) {
      console.error('Error loading sleep data:', e);
      showToast('Error cargando datos de sueño: ' + e.message);
    }
  }

  async function getCurrentUserId() {
    // Try to get from auth (if using Supabase auth)
    const c = cfg();
    if (!c.key) return '';

    const r = await fetch(c.url + '/auth/v1/user', {
      headers: { apikey: c.key, Authorization: 'Bearer ' + c.key },
    });
    if (r.ok) {
      const data = await r.json();
      return data.id || '';
    }
    return '';
  }

  // ============================================================
  // HYPNOGRAM RENDERING
  // ============================================================
  function renderHypnogram(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const todaySeg = state.segmentations.find(s => s.log_date === state.selectedDate);
    if (!todaySeg || !todaySeg.stages?.length) {
      el.innerHTML = '<p class="text-slate-400 text-center py-8">Sin datos de hipnograma para esta noche</p>';
      return;
    }

    const stages = todaySeg.stages; // 0=wake, 1=nrem, 2=rem
    const deepFlags = todaySeg.deep_flag || [];
    const epochSec = todaySeg.epoch_sec || 30;
    const sessionStart = new Date(todaySeg.session_start).getTime();
    const sleepOnset = todaySeg.sleep_onset ? new Date(todaySeg.sleep_onset).getTime() : null;
    const sleepOffset = todaySeg.sleep_offset ? new Date(todaySeg.sleep_offset).getTime() : null;

    const totalEpochs = stages.length;
    const totalMinutes = (totalEpochs * epochSec) / 60;
    const W = Math.min(600, totalEpochs * 4); // Max width 600px
    const H = 80;

    const stageColors = {
      0: '#94a3b8', // wake - slate
      1: '#3b82f6', // nrem - blue
      2: '#a855f7', // rem - purple
    };

    const stageLabels = { 0: 'Despierto', 1: 'NREM', 2: 'REM' };

    // Count minutes per stage
    const counts = { 0: 0, 1: 0, 2: 0 };
    let deepMin = 0;
    stages.forEach((s, i) => {
      counts[s] = (counts[s] || 0) + epochSec / 60;
      if (s === 1 && deepFlags[i]) deepMin += epochSec / 60;
    });

    const rects = stages.map((s, i) => {
      const x = (i / totalEpochs) * W;
      const w = Math.max(1, W / totalEpochs);
      const y = s === 0 ? 10 : s === 1 ? 30 : 50;
      const color = deepFlags[i] && s === 1 ? '#1e40af' : stageColors[s]; // Darker blue for deep
      return `<rect x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="16" rx="1" fill="${color}" data-stage="${s}" data-epoch="${i}" data-time="${hhmm(sessionStart + i * epochSec * 1000)}" />`;
    }).join('');

    // Time markers every hour
    const timeMarkers = [];
    for (let h = 0; h <= Math.ceil(totalMinutes / 60); h++) {
      const x = (h * 60 / totalMinutes) * W;
      const label = hhmm(sessionStart + h * 60 * 60 * 1000);
      timeMarkers.push(`<text x="${x}" y="${H - 2}" font-size="8" fill="#64748b" text-anchor="middle">${label}</text>`);
    }

    // Sleep onset/offset markers
    let onsetMarker = '', offsetMarker = '';
    if (sleepOnset && sleepOffset) {
      const onsetX = ((sleepOnset - sessionStart) / 1000 / epochSec / totalEpochs) * W;
      const offsetX = ((sleepOffset - sessionStart) / 1000 / epochSec / totalEpochs) * W;
      onsetMarker = `<line x1="${onsetX}" y1="0" x2="${onsetX}" y2="${H}" stroke="#10b981" stroke-width="2" stroke-dasharray="4,4" />`;
      offsetMarker = `<line x1="${offsetX}" y1="0" x2="${offsetX}" y2="${H}" stroke="#ef4444" stroke-width="2" stroke-dasharray="4,4" />`;
    }

    // Stage legend
    const legend = Object.entries(stageColors).map(([k, v]) => {
      const label = stageLabels[k];
      const count = counts[k] || 0;
      const c = k == '1' ? `<span style="color:${v}">■</span> ${label} ${fmtDur(count)} <span style="color:#1e40af">(Deep ${fmtDur(deepMin)})</span>` :
        `<span style="color:${v}">■</span> ${label} ${fmtDur(count)}`;
      return c;
    }).join(' · ');

    el.innerHTML = `
      <div class="space-y-2">
        <div class="flex items-center justify-between text-xs">
          <span class="text-slate-400">${hhmm(sessionStart)} → ${hhmm(sessionStart + totalMinutes * 60000)}</span>
          <span class="text-slate-300 font-mono">${fmtDur(totalMinutes)} en cama · Eficiencia ${pct(todaySeg.sleep_onset && todaySeg.sleep_offset ?
            (sleepOffset - sleepOnset) / (new Date(todaySeg.session_end).getTime() - new Date(todaySeg.session_start).getTime()) * 100 : 0)}</span>
        </div>
        <div class="relative" style="width:${W}px;height:${H}px">
          <svg viewBox="0 0 ${W} ${H}" class="w-full h-full" style="max-width:100%">
            <!-- Stage rows backgrounds -->
            <rect x="0" y="8" width="${W}" height="20" fill="rgba(59,130,246,0.05)"/>
            <rect x="0" y="28" width="${W}" height="20" fill="rgba(168,85,247,0.05)"/>
            <rect x="0" y="48" width="${W}" height="20" fill="rgba(148,163,184,0.05)"/>
            ${onsetMarker}
            ${offsetMarker}
            ${rects}
            ${timeMarkers.join('')}
            <!-- Stage labels on left -->
            <text x="2" y="22" font-size="8" fill="#64748b">NREM</text>
            <text x="2" y="42" font-size="8" fill="#64748b">REM</text>
            <text x="2" y="62" font-size="8" fill="#64748b">Wake</text>
          </svg>
        </div>
        <div class="text-[10px] text-slate-400 flex flex-wrap gap-3">${legend}</div>
        <div class="text-[10px] text-slate-500">
          Confianza: ${(todaySeg.confidence * 100).toFixed(0)}% · Épocas: ${totalEpochs} × ${epochSec}s · Sin datos: ${todaySeg.unobserved_sec}s
        </div>
      </div>
    `;
  }

  // ============================================================
  // HRV TRENDS CHART (using ApexCharts if available)
  // ============================================================
  function renderHrvTrends(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;

    // Prepare data from night observations
    const obs = state.nightObservations.slice().reverse(); // oldest first
    if (!obs.length) {
      el.innerHTML = '<p class="text-slate-400 text-center py-8">Sin datos de VFC nocturnos</p>';
      return;
    }

    const dates = obs.map(o => o.log_date);
    const rmssd = obs.map(o => o.rmssd_med_ms);
    const lfhf = obs.map(o => o.lfhf_med);
    const rk = obs.map(o => o.rk_med_bpm);

    // Also get recovery scores from daily scores
    const daily = state.dailyScores.slice().reverse();
    const recovery = daily.map(d => d.recovery_score);

    if (typeof ApexCharts === 'undefined') {
      el.innerHTML = '<p class="text-slate-400 text-center py-8">ApexCharts no cargado</p>';
      return;
    }

    const options = {
      series: [
        { name: 'RMSSD (ms)', data: rmssd, type: 'line', color: '#22d3ee' },
        { name: 'LF/HF', data: lfhf, type: 'line', color: '#a855f7', yAxisIndex: 1 },
        { name: 'RK (bpm)', data: rk, type: 'line', color: '#fbbf24', yAxisIndex: 2 },
      ],
      chart: { type: 'line', height: 280, toolbar: { show: false }, fontFamily: 'Inter, sans-serif' },
      colors: ['#22d3ee', '#a855f7', '#fbbf24'],
      stroke: { width: 2, curve: 'smooth' },
      markers: { size: 3 },
      xaxis: { categories: dates, labels: { style: { colors: '#94a3b8', fontSize: '10px' } }, axisBorder: { show: false }, axisTicks: { show: false } },
      yaxis: [
        { title: { text: 'RMSSD (ms)', style: { color: '#22d3ee', fontSize: '10px' } }, labels: { style: { colors: '#22d3ee', fontSize: '10px' }, formatter: v => v.toFixed(0) }, min: 0 },
        { title: { text: 'LF/HF', style: { color: '#a855f7', fontSize: '10px' } }, labels: { style: { colors: '#a855f7', fontSize: '10px' }, formatter: v => v.toFixed(2) }, opposite: true, min: 0 },
        { title: { text: 'RK (bpm)', style: { color: '#fbbf24', fontSize: '10px' } }, labels: { style: { colors: '#fbbf24', fontSize: '10px' }, formatter: v => v.toFixed(1) }, opposite: true, min: 0 },
      ],
      grid: { borderColor: 'rgba(255,255,255,0.05)', row: { colors: ['transparent', 'rgba(255,255,255,0.02)'] } },
      legend: { show: true, position: 'top', fontSize: '10px', labels: { colors: '#94a3b8' } },
      tooltip: { theme: 'dark', shared: true, x: { format: 'dd MMM' } },
    };

    if (el._chart) el._chart.destroy();
    el._chart = new ApexCharts(el, options);
    el._chart.render();
  }

  // ============================================================
  // SLEEP SCORES CARDS
  // ============================================================
  function renderSleepScores(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const todaySeg = state.segmentations.find(s => s.log_date === state.selectedDate);
    const todayScore = state.dailyScores.find(d => d.log_date === state.selectedDate);
    const todayObs = state.nightObservations.find(o => o.log_date === state.selectedDate);

    if (!todaySeg && !todayScore) {
      el.innerHTML = '<p class="text-slate-400 text-center py-8">Sin puntuaciones de sueño para hoy</p>';
      return;
    }

    const tst = todayScore?.total_sleep_min || (todaySeg?.sleep_onset && todaySeg?.sleep_offset ?
      Math.round((new Date(todaySeg.sleep_offset).getTime() - new Date(todaySeg.sleep_onset).getTime()) / 60000) : 0);
    const deepMin = todayScore?.deep_sleep_min || 0;
    const remMin = todayScore?.rem_sleep_min || 0;
    const lightMin = todayScore?.light_sleep_min || 0;
    const efficiency = todayScore?.sleep_efficiency_pct || 0;
    const waso = todayScore?.waso_min || 0;
    const tib = todayScore?.time_in_bed_min || (todaySeg ? Math.round((new Date(todaySeg.session_end).getTime() - new Date(todaySeg.session_start).getTime()) / 60000) : 0);
    const debt = todayScore?.sleep_debt_hours || 0;
    const need = todayScore?.dynamic_sleep_need_hours || 7.5;

    const deepPct = tst > 0 ? (deepMin / tst * 100).toFixed(1) : 0;
    const remPct = tst > 0 ? (remMin / tst * 100).toFixed(1) : 0;
    const lightPct = tst > 0 ? (lightMin / tst * 100).toFixed(1) : 0;

    // HRV from observation
    const rmssd = todayObs?.rmssd_med_ms;
    const lfhf = todayObs?.lfhf_med;
    const hrSleep = todayObs?.hr_sleep_median;
    const hrArousal = todayObs?.hr_arousal;

    // Profile baselines
    const profile = state.userProfile;
    const rmssdBase = profile?.rmssd_med_ms;
    const rmssdMad = profile?.rmssd_mad_ms;

    el.innerHTML = `
      <div class="space-y-3">
        <!-- Main sleep rings -->
        <div class="grid grid-cols-3 gap-3">
          ${sleepRing('TST', fmtDur(tst), tst > 0 ? Math.min(100, tst / (need * 60) * 100) : 0, '#8b5cf6', 'sleep-tst-ring')}
          ${sleepRing('Eficiencia', efficiency + '%', efficiency, efficiency >= 85 ? '#10b981' : efficiency >= 70 ? '#f59e0b' : '#ef4444', 'sleep-eff-ring')}
          ${sleepRing('Deuda', debt > 0 ? '+' + debt.toFixed(1) + 'h' : '0h', debt > 0 ? Math.min(100, debt / 5 * 100) : 100, debt > 2 ? '#ef4444' : debt > 0 ? '#f59e0b' : '#10b981', 'sleep-debt-ring')}
        </div>

        <!-- Stage breakdown -->
        <div class="p-3 rounded-2xl bg-slate-950/60 border border-slate-800/50">
          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Arquitectura del Sueño</div>
          <div class="w-full h-6 rounded-full bg-slate-900 overflow-hidden flex border border-slate-800 mb-2">
            <div class="bg-blue-500 h-full transition-all duration-500" style="width: ${deepPct}%"></div>
            <div class="bg-purple-500 h-full transition-all duration-500" style="width: ${remPct}%"></div>
            <div class="bg-slate-600 h-full transition-all duration-500" style="width: ${lightPct}%"></div>
          </div>
          <div class="flex justify-between text-[10px] text-slate-300 font-medium">
            <span class="text-blue-400">🟦 Profundo (SWS): ${fmtDur(deepMin)} (${deepPct}%)</span>
            <span class="text-purple-400">🟪 REM: ${fmtDur(remMin)} (${remPct}%)</span>
            <span class="text-slate-400">⬜ Ligero: ${fmtDur(lightMin)} (${lightPct}%)</span>
          </div>
        </div>

        <!-- Metrics grid -->
        <div class="grid grid-cols-2 gap-2">
          ${metricCard('TIB', fmtDur(tib), 'Tiempo en cama', '#64748b')}
          ${metricCard('WASO', fmtDur(waso), 'Despertares tras inicio', waso > 30 ? '#ef4444' : '#10b981')}
          ${metricCard('Latencia', todaySeg?.sleep_onset && todaySeg?.session_start ?
            fmtDur(Math.round((new Date(todaySeg.sleep_onset).getTime() - new Date(todaySeg.session_start).getTime()) / 60000)) : '--', 'Inicio de sueño', '#22d3ee')}
          ${metricCard('Necesidad', need.toFixed(1) + 'h', 'Necesidad dinámica', '#a855f7')}
        </div>

        <!-- HRV card -->
        ${rmssd ? `
        <div class="p-3 rounded-2xl bg-slate-950/60 border border-slate-800/50">
          <div class="text-[10px] font-bold uppercase tracking-wider text-emerald-400 mb-2">VFC Nocturna (HRV)</div>
          <div class="grid grid-cols-3 gap-2 text-center">
            <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">RMSSD</div><div class="font-mono font-black text-emerald-300">${rmssd.toFixed(0)} ms</div></div>
            <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">LF/HF</div><div class="font-mono font-black text-purple-300">${lfhf ? lfhf.toFixed(2) : '--'}</div></div>
            <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">FC Sueño</div><div class="font-mono font-black text-cyan-300">${hrSleep ? hrSleep.toFixed(0) : '--'} lpm</div></div>
          </div>
          ${rmssdBase && rmssdMad ? `
          <div class="mt-2 text-[10px] text-slate-400">
            Base 14d: ${rmssdBase.toFixed(0)} ms ± ${rmssdMad.toFixed(0)} MAD ·
            Z-score: ${rmssdMad > 0 ? ((rmssd - rmssdBase) / (1.4826 * rmssdMad)).toFixed(2) : '--'} SD
          </div>
          ` : ''}
          ${hrArousal ? `<div class="mt-1 text-[10px] text-amber-400">FC umbral arousal: ${hrArousal.toFixed(0)} lpm</div>` : ''}
        </div>
        ` : ''}
      </div>
    `;
  }

  function sleepRing(label, value, pct, color, id) {
    const C = 157; // 2 * PI * 25
    const offset = C - (pct / 100) * C;
    return `
      <div onclick="goToArgonTab(1)" class="flex flex-col items-center cursor-pointer active:scale-95 transition p-3 rounded-2xl bg-slate-950/60 border border-slate-800/50">
        <div class="relative w-20 h-20">
          <svg class="w-full h-full" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="25" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="6"/>
            <circle id="${id}" cx="50" cy="50" r="25" fill="none" stroke="${color}" stroke-width="6"
              stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${offset}"
              transform="rotate(-90 50 50)" style="transition: stroke-dashoffset 0.8s cubic-bezier(0.16,1,0.3,1)"/>
          </svg>
          <div class="absolute inset-0 flex flex-col items-center justify-center">
            <span class="text-lg font-black text-white leading-none">${value}</span>
          </div>
        </div>
        <span class="text-[10px] font-bold text-slate-200 mt-2">${label}</span>
      </div>
    `;
  }

  function metricCard(label, value, sub, color) {
    return `
      <div class="p-3 rounded-2xl bg-slate-950/60 border border-slate-800/50 text-center">
        <div class="text-[9px] text-slate-400">${label}</div>
        <div class="font-mono font-black text-lg" style="color:${color}">${value}</div>
        <div class="text-[9px] text-slate-500">${sub}</div>
      </div>
    `;
  }

  // ============================================================
  // EPOCH FEATURES CHARTS (HR, HRV, Movement across night)
  // ============================================================
  function renderEpochCharts(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (!state.epochFeatures.length) {
      el.innerHTML = '<p class="text-slate-400 text-center py-8">Sin datos de épocas para esta noche</p>';
      return;
    }

    if (typeof ApexCharts === 'undefined') {
      el.innerHTML = '<p class="text-slate-400 text-center py-8">ApexCharts no cargado</p>';
      return;
    }

    const epochs = state.epochFeatures;
    const indices = epochs.map((_, i) => i);
    const times = epochs.map(e => {
      const d = new Date(e.epoch_start);
      return d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
    });

    const hr = epochs.map(e => e.hr_median);
    const rmssd = epochs.map(e => e.rmssd_ms);
    const enmo = epochs.map(e => e.enmo_median);
    const stages = epochs.map(e => e.stage); // 0=wake, 1=nrem, 2=rem

    // Create stage background areas
    const stageAreas = [];
    let currentStage = stages[0];
    let startIdx = 0;
    for (let i = 1; i <= stages.length; i++) {
      if (i === stages.length || stages[i] !== currentStage) {
        const color = currentStage === 0 ? 'rgba(148,163,184,0.15)' : currentStage === 1 ? 'rgba(59,130,246,0.15)' : 'rgba(168,85,247,0.15)';
        stageAreas.push({
          x1: startIdx,
          x2: i - 1,
          color,
        });
        if (i < stages.length) {
          currentStage = stages[i];
          startIdx = i;
        }
      }
    }

    const options = {
      series: [
        { name: 'FC (lpm)', data: hr, color: '#ef4444', type: 'line' },
        { name: 'RMSSD (ms)', data: rmssd, color: '#22d3ee', type: 'line', yAxisIndex: 1 },
        { name: 'ENMO (g)', data: enmo, color: '#10b981', type: 'area', yAxisIndex: 2, fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.3, opacityTo: 0.05 } } },
      ],
      chart: { type: 'line', height: 320, toolbar: { show: false }, fontFamily: 'Inter, sans-serif', animations: { enabled: true } },
      colors: ['#ef4444', '#22d3ee', '#10b981'],
      stroke: { width: [2, 2, 1], curve: 'smooth' },
      fill: { type: ['none', 'none', 'gradient'] },
      markers: { size: 0, hover: { size: 4 } },
      xaxis: {
        categories: times,
        labels: { style: { colors: '#94a3b8', fontSize: '9px' }, show: true },
        axisBorder: { show: false },
        axisTicks: { show: false },
        tooltip: { enabled: true },
      },
      yaxis: [
        { title: { text: 'FC (lpm)', style: { color: '#ef4444', fontSize: '10px' } }, labels: { style: { colors: '#ef4444', fontSize: '10px' }, formatter: v => v.toFixed(0) }, min: 30, max: 180 },
        { title: { text: 'RMSSD (ms)', style: { color: '#22d3ee', fontSize: '10px' } }, labels: { style: { colors: '#22d3ee', fontSize: '10px' }, formatter: v => v.toFixed(0) }, opposite: true, min: 0 },
        { title: { text: 'ENMO (g)', style: { color: '#10b981', fontSize: '10px' } }, labels: { style: { colors: '#10b981', fontSize: '10px' }, formatter: v => v.toFixed(3) }, opposite: true, min: 0 },
      ],
      grid: { borderColor: 'rgba(255,255,255,0.05)', row: { colors: ['transparent', 'rgba(255,255,255,0.02)'] }, padding: { left: 10, right: 10 } },
      legend: { show: true, position: 'top', fontSize: '10px', labels: { colors: '#94a3b8' } },
      tooltip: {
        theme: 'dark',
        shared: true,
        x: { format: 'HH:mm', show: true },
        y: {
          formatter: (val, { seriesIndex }) => {
            if (seriesIndex === 0) return val.toFixed(0) + ' lpm';
            if (seriesIndex === 1) return val.toFixed(0) + ' ms';
            return val.toFixed(3) + ' g';
          },
        },
      },
      annotations: {
        xaxis: stageAreas.map(a => ({
          x: a.x1,
          x2: a.x2,
          fillColor: a.color,
        })),
      },
    };

    if (el._chart) el._chart.destroy();
    el._chart = new ApexCharts(el, options);
    el._chart.render();
  }

  // ============================================================
  // PROFILE BASELINES
  // ============================================================
  function renderProfileBaselines(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const p = state.userProfile;
    if (!p || p.nights === 0) {
      el.innerHTML = '<p class="text-slate-400 text-center py-8">Perfil de sueño aún no calibrado (mín. 1 noche)</p>';
      return;
    }

    el.innerHTML = `
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <h4 class="text-xs font-extrabold uppercase tracking-wider text-cyan-300">Perfil Personal de Sueño (${p.nights} noches)</h4>
          <span class="text-[10px] text-amber-400 font-mono">Peso personal: ${(p.personal_weight * 100).toFixed(0)}%</span>
        </div>
        <div class="grid grid-cols-2 gap-2">
          ${p.hr_floor_p5 != null ? baseMetric('FC P5 (suelo)', p.hr_floor_p5.toFixed(0) + ' lpm', '#ef4444') : ''}
          ${p.hr_floor_p25 != null ? baseMetric('FC P25', p.hr_floor_p25.toFixed(0) + ' lpm', '#f59e0b') : ''}
          ${p.hr_sleep_median != null ? baseMetric('FC Mediana Sueño', p.hr_sleep_median.toFixed(0) + ' lpm', '#22d3ee') : ''}
          ${p.hr_arousal != null ? baseMetric('FC Arousal', p.hr_arousal.toFixed(0) + ' lpm', '#a855f7') : ''}
          ${p.rmssd_med_ms != null ? baseMetric('RMSSD Mediana', p.rmssd_med_ms.toFixed(0) + ' ms', '#10b981') : ''}
          ${p.rmssd_mad_ms != null ? baseMetric('RMSSD MAD', p.rmssd_mad_ms.toFixed(0) + ' ms', '#34d399') : ''}
          ${p.enmo_still_cut_g != null ? baseMetric('ENMO Still', p.enmo_still_cut_g.toFixed(3) + ' g', '#64748b') : ''}
          ${p.enmo_move_cut_g != null ? baseMetric('ENMO Move', p.enmo_move_cut_g.toFixed(3) + ' g', '#94a3b8') : ''}
          ${p.lfhf_med != null ? baseMetric('LF/HF Mediana', p.lfhf_med.toFixed(2), '#a855f7') : ''}
          ${p.rk_med_bpm != null ? baseMetric('RK Mediana', p.rk_med_bpm.toFixed(1) + ' bpm', '#fbbf24') : ''}
        </div>
        <div class="text-[10px] text-slate-500">
          Actualizado: ${p.updated_at ? new Date(p.updated_at).toLocaleDateString('es-VE', { timeZone: TZ }) : '—'}
        </div>
      </div>
    `;
  }

  function baseMetric(label, value, color) {
    return `
      <div class="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/50 text-center">
        <div class="text-[9px] text-slate-400">${label}</div>
        <div class="font-mono font-bold" style="color:${color}">${value}</div>
      </div>
    `;
  }

  // ============================================================
  // TREND CHARTS (7/14/30 days)
  // ============================================================
  function renderTrendCharts(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const daily = state.dailyScores.slice().reverse(); // oldest first
    if (!daily.length) {
      el.innerHTML = '<p class="text-slate-400 text-center py-8">Sin datos de tendencias</p>';
      return;
    }

    if (typeof ApexCharts === 'undefined') {
      el.innerHTML = '<p class="text-slate-400 text-center py-8">ApexCharts no cargado</p>';
      return;
    }

    const dates = daily.map(d => d.log_date);
    const tst = daily.map(d => d.total_sleep_min / 60);
    const efficiency = daily.map(d => d.sleep_efficiency_pct);
    const deepPct = daily.map(d => d.total_sleep_min > 0 ? (d.deep_sleep_min / d.total_sleep_min * 100) : 0);
    const remPct = daily.map(d => d.total_sleep_min > 0 ? (d.rem_sleep_min / d.total_sleep_min * 100) : 0);
    const debt = daily.map(d => d.sleep_debt_hours || 0);

    const options = {
      series: [
        { name: 'TST (h)', data: tst, color: '#8b5cf6', type: 'line' },
        { name: 'Eficiencia (%)', data: efficiency, color: '#10b981', type: 'line', yAxisIndex: 1 },
        { name: 'SWS (%)', data: deepPct, color: '#3b82f6', type: 'line', yAxisIndex: 1 },
        { name: 'REM (%)', data: remPct, color: '#a855f7', type: 'line', yAxisIndex: 1 },
        { name: 'Deuda (h)', data: debt, color: '#ef4444', type: 'area', yAxisIndex: 2, fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.3, opacityTo: 0 } } },
      ],
      chart: { type: 'line', height: 300, toolbar: { show: false }, fontFamily: 'Inter, sans-serif' },
      colors: ['#8b5cf6', '#10b981', '#3b82f6', '#a855f7', '#ef4444'],
      stroke: { width: [2, 2, 2, 2, 1], curve: 'smooth' },
      markers: { size: 3 },
      xaxis: { categories: dates, labels: { style: { colors: '#94a3b8', fontSize: '10px' } }, axisBorder: { show: false } },
      yaxis: [
        { title: { text: 'Horas', style: { color: '#8b5cf6', fontSize: '10px' } }, labels: { style: { colors: '#8b5cf6', fontSize: '10px' }, formatter: v => v.toFixed(1) }, min: 0 },
        { title: { text: '%', style: { color: '#10b981', fontSize: '10px' } }, labels: { style: { colors: '#10b981', fontSize: '10px' }, formatter: v => v.toFixed(0) }, opposite: true, min: 0, max: 100 },
        { title: { text: 'Deuda (h)', style: { color: '#ef4444', fontSize: '10px' } }, labels: { style: { colors: '#ef4444', fontSize: '10px' }, formatter: v => v.toFixed(1) }, opposite: true, min: 0 },
      ],
      grid: { borderColor: 'rgba(255,255,255,0.05)' },
      legend: { show: true, position: 'top', fontSize: '10px', labels: { colors: '#94a3b8' } },
      tooltip: { theme: 'dark', shared: true, x: { format: 'dd MMM' } },
    };

    if (el._chart) el._chart.destroy();
    el._chart = new ApexCharts(el, options);
    el._chart.render();
  }

  // ============================================================
  // MAIN RENDER ORCHESTRATOR
  // ============================================================
  function renderAll() {
    renderHypnogram('sleep-hypnogram');
    renderHrvTrends('sleep-hrv-trends');
    renderSleepScores('sleep-scores');
    renderEpochCharts('sleep-epoch-charts');
    renderProfileBaselines('sleep-profile-baselines');
    renderTrendCharts('sleep-trend-charts');
  }

  // ============================================================
  // PUBLIC API
  // ============================================================
  window.argonSleep = {
    load: loadSleepData,
    renderAll,
    getState: () => state,
  };

  // Auto-load if on sleep tab
  document.addEventListener('DOMContentLoaded', () => {
    // Check if we're on sleep tab (tab 1)
    const sleepTab = document.querySelector('[data-argon-tab="1"]') ||
                     document.querySelector('#nav-btn-1') ||
                     document.querySelector('.swiper-slide:nth-child(2)');
    if (sleepTab) {
      loadSleepData();
    }
  });

  // Listen for tab changes
  window.addEventListener('argon-tab-change', (e) => {
    if (e.detail === 1) { // Sleep tab
      loadSleepData();
    }
  });

})();