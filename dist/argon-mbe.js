// src/constants/index.ts
var SYNC_DAYS_DEFAULT = 45;
var DEFAULTS = {
  // User profile
  birthYear: 1985,
  heightCm: 175,
  weightKg: 75,
  bodyFatPct: 20,
  biologicalSex: "male",
  basalSleepNeedH: 7.5,
  habitualWake: "07:00",
  timezone: "America/Caracas",
  goalWeightKg: 72,
  goalDate: null,
  dailyDeficitKcal: -500,
  // Targets (computed server-side)
  targetKcal: 2200,
  targetProteinG: 150,
  targetCarbsG: 200,
  targetFatG: 73,
  // Hydration
  hydrationMlPerKg: 35,
  // Training
  lthrBpm: 170,
  ftpWatts: 250,
  // App behavior
  syncDays: SYNC_DAYS_DEFAULT,
  showSiestaInDebt: true
};
var STORAGE_KEYS = {
  // Supabase
  SB_URL: "argon_sb_url",
  SB_KEY: "argon_sb_key",
  USER_ID: "argon_user_id",
  // App config
  WEBAPP_URL: "ARGON_WEBAPP_URL",
  CONFIG: "argon_config",
  // Local data
  LOCAL_STORE: "argon_local_store",
  SELECTED_DATE: "argon_selected_date",
  // UI state
  THEME: "argon_theme",
  ONBOARDING_DONE: "argon_onboarding_done"
};
var TZ = DEFAULTS.timezone;

// src/utils/date.ts
function getTimezone() {
  return TZ;
}
function todayIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(/* @__PURE__ */ new Date());
}
function m18(hhmm2) {
  const [h, m] = hhmm2.split(":").map(Number);
  const mins = h * 60 + m;
  const ref = 18 * 60;
  return (mins - ref + 1440) % 1440;
}

// src/utils/math.ts
function num(v) {
  if (v === null || v === void 0 || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
function mean(values) {
  const valid = values.map(num).filter((n) => n !== null);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

// src/components/mbe/utils.ts
var ACC = {
  cyan: "#22d3ee",
  emerald: "#34d399",
  violet: "#a78bfa",
  amber: "#fbbf24",
  rose: "#fb7185"
};
var TZ2 = getTimezone();
var LS = (key, def) => {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : def;
  } catch {
    return def;
  }
};
var hhmm = (ms) => {
  const d = new Date(ms);
  return d.toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ2 });
};
var pace = (p) => {
  const m = Math.floor(p);
  const s = Math.round((p - m) * 60);
  return `${m}:${String(s === 60 ? 0 : s).padStart(2, "0")}`;
};
function retrain(strain, rec, debtH, hoursSince) {
  const base = strain < 8 ? 12 : strain < 12 ? 24 : strain < 16 ? 36 : 48;
  const f = rec == null ? 1 : rec >= 67 ? 0.85 : rec < 34 ? 1.3 : 1;
  const need = Math.round(base * f * (debtH > 2 ? 1.1 : 1));
  return { need, left: Math.max(0, Math.round(need - hoursSince)) };
}
function ltCalc(km, hr) {
  const p30 = 30 / km;
  const zs = [
    ["Z1 Recuperaci\xF3n", 0, 0.85],
    ["Z2 Aer\xF3bica", 0.85, 0.89],
    ["Z3 Tempo", 0.9, 0.94],
    ["Z4 Sub-umbral", 0.95, 0.99],
    ["Z5a Super-umbral", 1, 1.02],
    ["Z5b Capacidad aer\xF3bica", 1.03, 1.06]
  ];
  return {
    lthr: Math.round(hr),
    p30,
    pThr: p30 * 1.04,
    zones: zs.map((z) => [z[0], z[1] ? Math.round(hr * z[1]) : 0, Math.round(hr * z[2])])
  };
}
var card = (title, subtitle, body) => `<section class="native-card p-4 space-y-2.5"><div><h4 class="text-[11px] font-extrabold uppercase tracking-wider text-cyan-300">${title}</h4><p class="text-[10px] text-slate-400">${subtitle}</p></div>${body}</section>`;
var note = (text) => `<p class="text-[10px] text-slate-400 leading-snug">${text}</p>`;
var empty2 = (text) => `<p class="text-[11px] text-amber-300/90">${text}</p>`;
var ex = (r) => r && r.hr_zones_minutes && r.hr_zones_minutes.x || {};
function getSelectedDay(state2) {
  const target = state2.selectedDate;
  if (!target) return { raw: state2.raw[0], comp: state2.comp[0] };
  const raw = state2.raw.find((r) => r && r.log_date === target) || state2.raw[0];
  const comp = state2.comp.find((c) => c && c.log_date === target) || state2.comp[0];
  return { raw, comp };
}

// src/api/client.ts
import { createClient } from "@supabase/supabase-js";
function getSbConfig() {
  const url = (localStorage.getItem(STORAGE_KEYS.SB_URL) || "").trim();
  const key = (localStorage.getItem(STORAGE_KEYS.SB_KEY) || "").trim();
  return { url, key };
}
function getUserId() {
  const stored = localStorage.getItem(STORAGE_KEYS.USER_ID);
  return stored?.trim() || null;
}
var _client = null;
function getClient() {
  if (_client) return _client;
  const { url, key } = getSbConfig();
  if (!url || !key) {
    throw new Error("Supabase no configurado: ve a \u2699\uFE0F Ajustes");
  }
  _client = createClient(url, key, {
    auth: { persistSession: false },
    global: { headers: { "x-client-info": "argon-pwa/6.0" } }
  });
  return _client;
}
var supabaseClient = new Proxy({}, {
  get(_, prop) {
    return getClient()[prop];
  }
});
async function request(table, params = {}) {
  const client = getClient();
  const userId = getUserId();
  const qb = client;
  let query = qb.from(table).select(params.select || "*");
  if (userId && table !== "webhook_logs") {
    query = query.eq("user_id", userId);
  }
  if (params.filters) {
    Object.entries(params.filters).forEach(([key, value]) => {
      query = query.eq(key, value);
    });
  }
  if (params.order) {
    query = query.order(params.order.column, { ascending: params.order.ascending ?? false });
  }
  if (params.limit) {
    query = query.limit(params.limit);
  } else if (params.range) {
    query = query.range(params.range[0], params.range[1]);
  }
  const { data, error } = await query;
  if (error) throw new Error(`Supabase ${table}: ${error.message}`);
  return data || [];
}
async function sbGetComputedDailyScores(daysBack = 30, options) {
  const since = new Date(Date.now() - daysBack * 864e5).toISOString().split("T")[0];
  return request("computed_daily_scores", {
    filters: { log_date: `gte.${since}` },
    order: { column: "log_date", ascending: false },
    limit: daysBack + 5
  });
}
async function sbGetRawBiometrics(daysBack = 30) {
  const since = new Date(Date.now() - daysBack * 864e5).toISOString().split("T")[0];
  return request("daily_raw_biometrics", {
    filters: { log_date: `gte.${since}` },
    order: { column: "log_date", ascending: false },
    limit: daysBack + 5
  });
}

// src/components/mbe/mbe-data.ts
var state = {
  raw: [],
  comp: [],
  selectedDate: null
};
function getMbeState() {
  return state;
}
function setSelectedDate(date) {
  state.selectedDate = date;
}
async function loadMbeData(dateStr) {
  if (dateStr) state.selectedDate = dateStr;
  const target = state.selectedDate || todayIso();
  try {
    const [raw, comp] = await Promise.all([
      sbGetRawBiometrics(1).then((arr) => arr.filter((r) => r.log_date === target)),
      sbGetComputedDailyScores(1).then((arr) => arr.filter((c) => c.log_date === target))
    ]);
    const [rawHist, compHist] = await Promise.all([
      sbGetRawBiometrics(30),
      sbGetComputedDailyScores(30)
    ]);
    state.raw = [raw[0], ...rawHist.slice(1)].filter(Boolean);
    state.comp = [comp[0], ...compHist.slice(1)].filter(Boolean);
  } catch (e) {
    console.error("Error loading MBE data:", e);
    throw e;
  }
}

// src/components/mbe/sections/date-picker.ts
function renderDatePicker(options) {
  const { state: state2, onDateChange, onTodayClick } = options;
  const today = todayIso();
  const selected = state2.selectedDate || today;
  const opts = state2.comp.slice(0, 30).map(
    (r) => `<option value="${r.log_date}" ${r.log_date === selected ? "selected" : ""}>
      ${r.log_date} ${r.recovery_score != null ? "\xB7 Rec " + r.recovery_score + "%" : ""}${r.total_sleep_min ? " \xB7 " + (r.total_sleep_min / 60).toFixed(1) + "h" : ""}
    </option>`
  ).join("");
  return card(
    "\u{1F4C5} D\xEDa",
    "Selector de fecha (hist\xF3rico 30 d)",
    `<div class="flex items-center gap-3">
      <label class="text-xs text-slate-400">Fecha</label>
      <select id="mbe-date" onchange="mbeLoad(this.value)" class="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm">${opts}</select>
      <button onclick="mbeLoad('${today}')" class="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-xl text-xs font-bold">Hoy</button>
    </div>` + note("Las tarjetas muestran datos computados por el servidor para el d\xEDa seleccionado. El servidor recalcula al recibir datos raw (webhook o guardado manual).")
  );
}

// src/components/mbe/sections/bed-time.ts
function renderBedTime(options) {
  const { state: state2 } = options;
  const { comp: c, raw: r0 } = getSelectedDay(state2);
  if (!c || !c.optimal_bedtime_start) return card("Hora de dormir", "Ventana \xF3ptima", empty2("Sin datos calculados."));
  const prof = LS("argon_profile_v1", {});
  const wake = prof.wake || "06:00";
  const span = 1080;
  const x = (m) => Math.max(0, Math.min(100, m / span * 100));
  const a = m18(c.optimal_bedtime_start);
  const b = m18(c.optimal_bedtime_end);
  const w = m18(wake);
  const h = ex(r0).hypno;
  let real = "";
  if (h && h.seg && h.seg.length) {
    const s0 = m18(hhmm(h.t0));
    const last = h.seg[h.seg.length - 1];
    const len = last[1] + last[2];
    real = `<div class="absolute top-1 h-2 rounded bg-purple-500/80" style="left:${x(s0)}%;width:${Math.max(1, x(s0 + len) - x(s0))}%" title="Sue\xF1o real"></div>`;
  }
  const ticks = [18, 21, 0, 3, 6, 9, 12].map(
    (hh) => `<span class="absolute text-[9px] text-slate-500" style="left:${x(m18(String(hh).padStart(2, "0") + ":00"))}%;top:28px;transform:translateX(-50%)">${String(hh).padStart(2, "0")}h</span>`
  ).join("");
  const bar = `<div class="relative h-12 rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
    <div class="absolute inset-y-0 bg-emerald-500/30 border-x border-emerald-400" style="left:${x(a)}%;width:${Math.max(2, x(b) - x(a))}%"></div>
    ${real}
    <div class="absolute inset-y-0 w-0.5 bg-amber-400" style="left:${x(w)}%"></div>
    ${ticks}
  </div>`;
  return card(
    "\u{1F319} Hora de dormir recomendada",
    "L\xEDnea verde = ventana \xB7 violeta = sue\xF1o real \xB7 \xE1mbar = despertar",
    `<div class="flex items-end justify-between">
      <div>
        <div class="text-2xl font-black font-mono text-emerald-400">${c.optimal_bedtime_start.slice(0, 5)}\u2013${c.optimal_bedtime_end.slice(0, 5)}</div>
        <div class="text-[10px] text-slate-400">Necesidad hoy: ${c.dynamic_sleep_need_hours} h \xB7 despertar ${wake}</div>
      </div>
    </div>${bar}` + note("Ventana = despertar \u2212 (necesidad din\xE1mica \xF7 eficiencia). La necesidad base (7.5 h) es un valor personal calibrable; el rango poblacional adulto es 7\u20139 h (AASM/SRS, Watson 2015).")
  );
}

// src/components/mbe/sections/hypnogram.ts
function renderHypnogram(options) {
  const { state: state2 } = options;
  const { raw: r0 } = getSelectedDay(state2);
  const h = ex(r0).hypno;
  if (!h || !h.seg || !h.seg.length) return card("\u{1F4CA} Hipnograma", "Fases de la \xFAltima noche", empty2("A\xFAn no hay fases guardadas. Se llenan con el pr\xF3ximo webhook de sue\xF1o (requiere Code.txt actualizado)."));
  const last = h.seg[h.seg.length - 1];
  const span = last[1] + last[2];
  const W = 300;
  const row = { A: 0, R: 1, L: 2, D: 3 };
  const col = { A: "#94a3b8", R: "#a855f7", L: "#475569", D: "#3b82f6" };
  const rects = h.seg.map(
    (s) => `<rect x="${(s[1] / span * W).toFixed(1)}" y="${row[s[0]] * 16 + 2}" width="${Math.max(0.8, s[2] / span * W).toFixed(1)}" height="12" rx="2" fill="${col[s[0]]}"/>`
  ).join("");
  const lab = ["Despierto", "REM", "Ligero", "Profundo"].map(
    (t2, i) => `<text x="2" y="${i * 16 + 11}" font-size="8" fill="#94a3b8">${t2}</text>`
  ).join("");
  const tot = (k) => h.seg.filter((s) => s[0] === k).reduce((q, s) => q + s[2], 0);
  return card(
    "\u{1F4CA} Hipnograma",
    `${hhmm(h.t0)} \u2192 ${hhmm(h.t0 + span * 6e4)}`,
    `<svg viewBox="0 0 ${W} 66" class="w-full">${rects}${lab}</svg>` + note(`Profundo ${tot("D")}m \xB7 REM ${tot("R")}m \xB7 Ligero ${tot("L")}m \xB7 Despierto ${tot("A")}m. Las fases por PPG de mu\xF1eca tienen concordancia moderada con PSG (\u03BA\u22480.4\u20130.6): \xFAtil para tendencias, no para diagn\xF3stico.`)
  );
}

// src/components/mbe/sections/naps.ts
function renderNaps(options) {
  const { state: state2 } = options;
  const { raw: r0 } = getSelectedDay(state2);
  const n = ex(r0).naps || [];
  const tot = n.reduce((s, v) => s + v.min, 0);
  const body = n.length ? n.map((v) => `<div class="flex justify-between text-xs"><span>\u{1F6CC} ${v.t}</span><span class="font-mono text-purple-300">${v.min} min</span></div>`).join("") + `<div class="text-xs font-bold">Total hoy: ${tot} min</div>` : empty2("Sin siestas detectadas hoy (se detectan episodios de 10\u2013240 min que empiezan entre 08:00 y 20:00).");
  return card("\u{1F634} Siestas", "Se suman a las horas del d\xEDa", body + note("Siestas \u226430 min y antes de ~15:00 mejoran alerta con poco efecto sobre el sue\xF1o nocturno; >60 min aumentan inercia de sue\xF1o (Milner & Cote 2009). En guardia, una siesta profil\xE1ctica de 20\u201330 min reduce errores."));
}

// src/components/mbe/sections/hrv.ts
function renderHrv(options) {
  const { state: state2 } = options;
  const { comp: c, raw: r0 } = getSelectedDay(state2);
  if (!c || c.ln_rmssd == null) return card("\u{1F493} VFC nocturna vs diurna", "lnRMSSD (servidor)", empty("Sin datos de VFC computados por el servidor a\xFAn."));
  const lnToday = parseFloat(c.ln_rmssd);
  const lnBase = parseFloat(c.ln_rmssd_14d_mean);
  const lnBaseSd = parseFloat(c.ln_rmssd_14d_sd);
  const hrvZ = parseFloat(c.hrv_z_score);
  const rhrZ = parseFloat(c.rhr_z_score);
  const recScore = c.recovery_score;
  const recStatus = c.recovery_status || "\u2014";
  const recMaxStrain = c.recommended_max_strain;
  const cv7 = parseFloat(c.cv_lnrmssd_7d_pct);
  const swc = parseFloat(c.swc_lnrmssd);
  const calibrating = c.calibrating;
  const rmssd = parseFloat(c.rmssd_ms);
  const rhr = parseFloat(c.rhr_bpm);
  const rmssd14d = parseFloat(c.rmssd_14d_mean_ms);
  const rhr14d = parseFloat(c.rhr_14d_mean_bpm);
  const resp = parseFloat(c.resp_rate_brpm);
  const resp14d = parseFloat(c.resp_14d_mean_brpm);
  const spo2 = parseFloat(c.spo2_pct);
  const nap = ex(r0).hrv_nap;
  const napTxt = nap ? `<div class="text-xs">Siesta: mediana <b class="font-mono">${nap.median} ms</b> \xB7 n=${nap.n} <span class="text-slate-400">(no entra en la base)</span></div>` : "";
  const day = ex(r0).hrv_day;
  const dayTxt = day ? `<div class="text-xs">Diurna (reposo/actividad): mediana <b class="font-mono">${day.median} ms</b> \xB7 n=${day.n} \xB7 rango ${day.min}\u2013${day.max}</div>` : '<div class="text-[11px] text-slate-400">Sin muestras diurnas guardadas.</div>';
  const stat = recScore != null ? recScore >= 67 ? ["Recuperado", "text-emerald-400"] : recScore >= 34 ? ["Equilibrado", "text-cyan-300"] : ["Fatiga/estr\xE9s", "text-amber-400"] : ["Calibrando", "text-slate-400"];
  const norm = rhr > 0 ? (rmssd / (6e4 / rhr) * 100).toFixed(1) : "--";
  return card(
    "\u{1F493} VFC nocturna vs diurna",
    "Datos del servidor (lnRMSSD 7d vs base 14d, SWC=0.5\xB7SD)",
    `<div class="grid grid-cols-3 gap-2 text-center">
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">RMSSD noche</div><div class="font-mono font-black">${rmssd.toFixed(0)} ms</div><div class="text-[9px] text-cyan-400 font-mono">ln ${lnToday.toFixed(2)}</div></div>
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">Base 14 d (ln)</div><div class="font-mono font-black">${lnBase.toFixed(2)}</div><div class="text-[9px] text-slate-400 font-mono">SD ${lnBaseSd.toFixed(3)}</div></div>
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">SWC (0.5\xB7SD)</div><div class="font-mono font-black">\xB1${swc.toFixed(3)}</div><div class="text-[9px] text-slate-400 font-mono">CV7 ${cv7.toFixed(1)}%</div></div>
    </div>
    <div class="grid grid-cols-3 gap-2 text-center mt-2">
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">z-score HRV</div><div class="font-mono font-black text-cyan-300">${hrvZ.toFixed(2)}</div></div>
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">z-score RHR</div><div class="font-mono font-black text-cyan-300">${rhrZ.toFixed(2)}</div></div>
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">RHR / 14d</div><div class="font-mono font-black">${rhr} / ${rhr14d} bpm</div></div>
    </div>
    <div class="grid grid-cols-3 gap-2 text-center mt-2">
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">Resp. / 14d</div><div class="font-mono font-black">${resp} / ${resp14d} rpm</div></div>
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">SpO\u2082</div><div class="font-mono font-black">${spo2}%</div></div>
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">RMSSD/RR norm</div><div class="font-mono font-black">${norm}%</div></div>
    </div>
    <div class="text-xs font-bold ${stat[1]} mt-2">Recuperaci\xF3n: ${recScore != null ? recScore + "%" : "calibrando"} \xB7 ${recStatus} ${recMaxStrain != null ? "\xB7 Strain m\xE1x: " + recMaxStrain.toFixed(1) : ""}${calibrating ? ' <span class="text-amber-400">(calibrando)</span>' : ""}</div>
    ${dayTxt}${napTxt}` + note("C\xE1lculo servidor: lnRMSSD media 7 d vs base 14 d (Plews 2013; Buchheit 2014). SWC = 0.5\xB7SD. FR > 20 rpm penaliza. z-scores vs base 14 d. Recuperaci\xF3n: pesos 0.55/0.20/0.25 provisionales (HRV/RHR/FR).")
  );
}

// src/components/mbe/sections/workouts.ts
function renderWorkouts(options) {
  const { state: state2 } = options;
  const { raw: r0 } = getSelectedDay(state2);
  const list = [];
  state2.raw.slice(0, 7).forEach((r) => (ex(r).workouts || []).forEach((w) => list.push(Object.assign({ date: r.log_date }, w))));
  list.sort((a, b) => (b.end_ms || 0) - (a.end_ms || 0));
  const body = list.length ? list.slice(0, 8).map(
    (w) => `<div class="flex items-center justify-between p-2 rounded-xl bg-slate-900 text-xs">
        <div>
          <div class="font-bold">${w.type}</div>
          <div class="text-[10px] text-slate-400">${w.date.slice(5)} \xB7 ${w.start || "--"}\u2013${w.end || "--"}</div>
        </div>
        <div class="text-right font-mono">
          <div>${w.min} min</div>
          <div class="text-[10px] text-amber-300">${w.kcal != null ? (w.kcal_est ? "~" : "") + w.kcal + " kcal" : "kcal n/d"}${w.avg_hr ? " \xB7 " + w.avg_hr + " lpm" : ""}</div>
          <div class="text-[9px] text-slate-400">${w.dist_m ? (w.dist_m / 1e3).toFixed(2) + " km" : ""}${w.steps ? " \xB7 " + w.steps + " pasos" : ""}${w.max_hr ? " \xB7 m\xE1x " + w.max_hr : ""}</div>
        </div>
      </div>`
  ).join("") : empty2("Sin entrenamientos guardados. Se llenan con el pr\xF3ximo webhook de ejercicio (Code.txt actualizado).");
  const rr = [];
  state2.raw.slice(1, 8).forEach((r) => {
    const z = ex(r).active_kcal;
    const c = state2.comp.find((q) => q.log_date === r.log_date);
    const tmb = parseFloat(r.tmb_kcal);
    if (z && c && tmb && c.dynamic_tdee_kcal) {
      const ap = c.dynamic_tdee_kcal - tmb * 1.05;
      if (ap > 50) rr.push([z, ap]);
    }
  });
  const calTxt = rr.length >= 3 ? `<div class="text-[11px] text-amber-300">Calibraci\xF3n: kcal "activas" de Zepp \u2248 \xD7${(mean(rr.map((q) => q[0])) / mean(rr.map((q) => q[1]))).toFixed(2)} vs estimaci\xF3n ARGON (${rr.length} d\xEDas). La dieta usa la de ARGON.</div>` : "";
  return card("\u{1F3C3} Entrenamientos recientes (Zepp)", "\xDAltimos 7 d\xEDas" + (ex(r0).active_kcal ? " \xB7 kcal activas d\xEDa seleccionado (Zepp): " + ex(r0).active_kcal : ""), body + calTxt + note('Zepp no env\xEDa kcal por sesi\xF3n: las marcadas con ~ se estiman con la FC (Keytel 2005, f\xF3rmula masculina; error t\xEDpico \xB120\u201330%, tiende a sobreestimar con FC baja). No se suman a la ingesta ni se usan para "comer lo quemado".'));
}

// src/components/mbe/sections/steps.ts
function renderSteps(options) {
  const { state: state2 } = options;
  const { raw: r0 } = getSelectedDay(state2);
  const goal = LS("argon_steps_goal", 8e3);
  const today = parseInt((r0 || {}).steps_count, 10) || 0;
  const last7 = state2.raw.slice(0, 7).map((r) => parseInt(r.steps_count, 10) || 0);
  const hit = last7.filter((v) => v >= goal).length;
  const pct = Math.min(100, today / goal * 100);
  const C = 251.2;
  return card(
    "\u{1F463} Pasos",
    "Meta diaria editable",
    `<div class="flex items-center gap-4">
      <svg viewBox="0 0 100 100" class="w-20 h-20">
        <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="9"/>
        <circle cx="50" cy="50" r="40" fill="none" stroke="#22d3ee" stroke-width="9" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${(C - pct / 100 * C).toFixed(1)}" transform="rotate(-90 50 50)"/>
        <text x="50" y="55" text-anchor="middle" font-size="16" font-weight="800" fill="#fff">${Math.round(pct)}%</text>
      </svg>
      <div class="text-xs space-y-1">
        <div class="font-mono font-black text-lg">${today.toLocaleString()} <span class="text-slate-400 text-xs">/ <input id="mbe-goal" type="number" value="${goal}" class="w-16 bg-slate-800 rounded px-1 text-white"></span></div>
        <div class="text-slate-400">Media 7 d: ${Math.round(mean(last7)).toLocaleString()} \xB7 meta cumplida ${hit}/7 d\xEDas</div>
      </div>
    </div>` + note("Meta por defecto 8 000: en adultos <60 a\xF1os el riesgo de mortalidad se estabiliza hacia 8 000\u201310 000 pasos/d\xEDa (Paluch, Lancet Public Health 2022); 8 000 vs 4 000 se asoci\xF3 a ~51% menos mortalidad total (Saint-Maurice, JAMA 2020). Es asociaci\xF3n observacional.")
  );
}

// src/components/mbe/sections/retrain.ts
function renderRetrain(options) {
  const { state: state2 } = options;
  const { comp: c, raw: r0 } = getSelectedDay(state2);
  if (!c) return card("\u23F1\uFE0F Volver a entrenar", "Heur\xEDstica", empty2("Sin datos."));
  let last = null;
  state2.raw.slice(0, 4).forEach((r) => (ex(r).workouts || []).forEach((w) => {
    if (w.end_ms && (!last || w.end_ms > last.end_ms)) last = w;
  }));
  let since;
  let src = "hora real de t\xE9rmino";
  if (last) since = (Date.now() - last.end_ms) / 36e5;
  else if (parseFloat((r0 || {}).pickleball_or_gym_minutes) > 0) {
    const e = (/* @__PURE__ */ new Date(r0.log_date + "T18:00:00-04:00")).getTime();
    since = (Date.now() - e) / 36e5;
    src = "sin hora de t\xE9rmino: se asume 18:00";
  } else return card("\u23F1\uFE0F Volver a entrenar", "Heur\xEDstica", empty2("No hay sesi\xF3n reciente registrada."));
  const strain = parseFloat(c.strain_score) || 0;
  const rec = c.recovery_score == null ? null : parseFloat(c.recovery_score);
  const q = retrain(strain, rec, parseFloat(c.cumulative_sleep_debt_hours) || 0, Math.max(0, since));
  const ok = q.left === 0;
  return card(
    "\u23F1\uFE0F Volver a entrenar",
    "Regla transparente (heur\xEDstica)",
    `<div class="text-2xl font-black font-mono ${ok ? "text-emerald-400" : "text-amber-400"}">${ok ? "Listo para entrenar" : "Faltan ~" + q.left + " h"}</div>
    <div class="text-[11px] text-slate-300">Recuperaci\xF3n sugerida: ${q.need} h \xB7 transcurridas: ${Math.round(since)} h (${src})</div>` + note("Base por strain de la sesi\xF3n (<8: 12 h \xB7 8\u201312: 24 h \xB7 12\u201316: 36 h \xB7 \u226516: 48 h) \xD7 recuperaci\xF3n (\u226567: \xD70.85, <34: \xD71.3) \xD7 deuda de sue\xF1o >2 h (\xD71.1). Apoyo: el da\xF1o/s\xEDntesis proteica tras fuerza se normaliza en ~24\u201372 h seg\xFAn volumen y grupo muscular, y el entrenamiento guiado por VFC mejora respuesta frente a planes fijos (Kiviniemi 2007). No es una f\xF3rmula validada: \xFAsala como gu\xEDa, no como regla.")
  );
}

// src/components/mbe/sections/lt.ts
function renderLT(options) {
  const { state: state2 } = options;
  const hist = LS("argon_lt_v1", []);
  const prof = LS("argon_profile_v1", {});
  const cfg = window.CONFIG?.profile || {};
  const birth = /* @__PURE__ */ new Date((prof.birth || cfg.birthDate || "1990-01-01") + "T12:00:00");
  const age = (Date.now() - birth.getTime()) / (365.2425 * 864e5);
  const hrMax = Math.round(208 - 0.7 * age);
  const lastT = hist[hist.length - 1];
  const out = lastT ? (() => {
    const r = ltCalc(lastT.km, lastT.hr);
    return `<div class="grid grid-cols-3 gap-2 text-center text-xs">
          <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">LTHR</div><div class="font-mono font-black text-lg text-rose-400">${r.lthr}</div></div>
          <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">Ritmo 30\u2032</div><div class="font-mono font-black">${pace(r.p30)}/km</div></div>
          <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">Ritmo umbral \u2248</div><div class="font-mono font-black">${pace(r.pThr)}/km</div></div>
        </div>` + r.zones.map(
      (z) => `<div class="flex justify-between text-[11px] font-mono"><span class="text-slate-300">${z[0]}</span><span>${z[1] ? z[1] + "\u2013" : "<"}${z[2]} lpm</span></div>`
    ).join("") + `<div class="text-[10px] text-slate-400">\xDAltimo test: ${lastT.date}</div>`;
  })() : `<div class="text-xs">Estimaci\xF3n sin test (baja confianza): ${Math.round(hrMax * 0.85)}\u2013${Math.round(hrMax * 0.9)} lpm (85\u201390% de FCm\xE1x Tanaka ${hrMax}).</div>`;
  return card(
    "\u{1FAC1} Umbral de lactato en carrera",
    "Test de campo de 30 min (Friel)",
    out + `<div class="grid grid-cols-3 gap-1.5 pt-1">
      <input id="lt-km" type="number" step="0.01" placeholder="km en 30\u2032" class="bg-slate-800 rounded-xl px-2 py-1.5 text-xs text-white">
      <input id="lt-hr" type="number" placeholder="FC media \xFAlt. 20\u2032" class="bg-slate-800 rounded-xl px-2 py-1.5 text-xs text-white">
      <button id="lt-save" class="rounded-xl bg-cyan-500 text-black font-black text-[11px]">Calcular</button>
    </div>` + note('Protocolo: calentar 10\u201315\u2032, correr 30\u2032 al m\xE1ximo ritmo sostenible y constante, solo, plano, sin pausas; pulsa "lap" a los 10\u2032. LTHR = FC media de los \xFAltimos 20\u2032. Correlaciona razonablemente con el umbral de laboratorio pero con error individual de varios lpm; el ritmo umbral estricto \u2248 ritmo de 60\u2032 (por eso se aplica +4% a tu ritmo de 30\u2032). Repetir cada 6\u20138 semanas, descansado, mismas condiciones.')
  );
}

// src/components/mbe/sections/argon-age.ts
function renderArgonAge(options) {
  const { state: state2 } = options;
  const { comp: c } = getSelectedDay(state2);
  if (!c || c.chronological_age == null) return card("\u{1F9EC} Edad Fisiol\xF3gica ARGON", "Modelo multivariante (servidor)", empty3("Sin datos computados por el servidor a\xFAn."));
  const chrono = parseFloat(c.chronological_age);
  const physio = parseFloat(c.argon_physiological_age);
  const delta = parseFloat(c.total_age_delta);
  const paceVal = parseFloat(c.pace_of_aging_x);
  const vo2 = parseFloat(c.vo2_max_ml_kg_min);
  const dVO2 = parseFloat(c.delta_vo2_years);
  const dRHR = parseFloat(c.delta_rhr_years);
  const dLnR = parseFloat(c.delta_lnrmssd_years);
  const dFFM = parseFloat(c.delta_ffm_years);
  const dSleep = parseFloat(c.delta_sleep_years);
  const dAct = parseFloat(c.delta_act_years);
  const paceColor = paceVal <= 0.85 ? "text-emerald-400" : paceVal <= 1 ? "text-cyan-300" : paceVal <= 1.15 ? "text-amber-400" : "text-rose-400";
  const deltaColor = delta <= -2 ? "text-emerald-400" : delta <= 0 ? "text-cyan-300" : delta <= 2 ? "text-amber-400" : "text-rose-400";
  return card(
    "\u{1F9EC} Edad Fisiol\xF3gica ARGON",
    `Edad cronol\xF3gica: ${chrono.toFixed(1)} a\xF1os \xB7 Modelo: VO\u2082max + RHR + lnRMSSD + FFM + Sue\xF1o + Actividad`,
    `<div class="grid grid-cols-2 gap-3">
      <div class="p-3 rounded-xl bg-slate-900 border border-slate-800"><div class="text-[10px] text-slate-400">Edad fisiol\xF3gica</div><div class="text-3xl font-black font-mono ${deltaColor}">${physio.toFixed(1)} a\xF1os</div></div>
      <div class="p-3 rounded-xl bg-slate-900 border border-slate-800"><div class="text-[10px] text-slate-400">Delta total</div><div class="text-3xl font-black font-mono ${deltaColor}">${delta >= 0 ? "+" : ""}${delta.toFixed(1)} a\xF1os</div></div>
      <div class="p-3 rounded-xl bg-slate-900 border border-slate-800"><div class="text-[10px] text-slate-400">Pace of Aging</div><div class="text-3xl font-black font-mono ${paceColor}">${paceVal.toFixed(2)}\xD7</div><div class="text-[9px] text-slate-400">(<1 = envejeces m\xE1s lento)</div></div>
      <div class="p-3 rounded-xl bg-slate-900 border border-slate-800"><div class="text-[10px] text-slate-400">VO\u2082max</div><div class="text-3xl font-black font-mono text-cyan-300">${vo2.toFixed(1)}</div><div class="text-[9px] text-slate-400">ml/kg/min</div></div>
    </div>
    <div class="grid grid-cols-3 gap-2 mt-3 text-center">
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">\u0394 VO\u2082max</div><div class="font-mono font-black ${dVO2 < 0 ? "text-emerald-400" : "text-rose-400"}">${dVO2 >= 0 ? "+" : ""}${dVO2.toFixed(1)} a</div></div>
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">\u0394 RHR</div><div class="font-mono font-black ${dRHR < 0 ? "text-emerald-400" : "text-rose-400"}">${dRHR >= 0 ? "+" : ""}${dRHR.toFixed(1)} a</div></div>
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">\u0394 lnRMSSD</div><div class="font-mono font-black ${dLnR < 0 ? "text-emerald-400" : "text-rose-400"}">${dLnR >= 0 ? "+" : ""}${dLnR.toFixed(1)} a</div></div>
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">\u0394 FFM</div><div class="font-mono font-black ${dFFM < 0 ? "text-emerald-400" : "text-rose-400"}">${dFFM >= 0 ? "+" : ""}${dFFM.toFixed(1)} a</div></div>
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">\u0394 Sue\xF1o</div><div class="font-mono font-black ${dSleep < 0 ? "text-emerald-400" : "text-rose-400"}">${dSleep >= 0 ? "+" : ""}${dSleep.toFixed(1)} a</div></div>
      <div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">\u0394 Actividad</div><div class="font-mono font-black ${dAct < 0 ? "text-emerald-400" : "text-rose-400"}">${dAct >= 0 ? "+" : ""}${dAct.toFixed(1)} a</div></div>
    </div>` + note("Modelo servidor: edad fisiol\xF3gica = edad cronol\xF3gica + \u03A3(deltas ponderados). Cada delta = (valor_observado \u2212 valor_referencia_edad) / pendiente_envejecimiento. Pace of Aging = edad_fisiol\xF3gica / edad_cronol\xF3gica. Referencias: VO\u2082max (Jackson 1995), RHR (Zhang 2016), lnRMSSD (Plews 2013), FFM (Janssen 2000), Sue\xF1o (Ohayon 2004), Actividad (Paluch 2022). Par\xE1metros provisionales \u2014 validar 4\u20136 semanas.")
  );
}
function empty3(text) {
  return `<p class="text-[11px] text-amber-300/90">${text}</p>`;
}

// src/components/mbe/sections/heat.ts
function renderHeatMap(options) {
  const { state: state2 } = options;
  const rows = state2.comp.slice(0, 30).reverse();
  if (!rows.length) return card("\u{1F5D3}\uFE0F Mapa de calor \xB7 30 d\xEDas", "Recuperaci\xF3n diaria", empty2("Sin datos."));
  const col = (v) => v == null ? "#334155" : v >= 67 ? "#10B981" : v >= 34 ? "#F59E0B" : "#EF4444";
  const cells = rows.map(
    (r) => `<div title="${r.log_date}: ${r.recovery_score == null ? "calibrando" : r.recovery_score + "%"}" class="aspect-square rounded-md" style="background:${col(r.recovery_score)};opacity:${r.recovery_score == null ? 0.5 : 0.35 + 0.65 * Math.min(1, r.recovery_score / 100)}"></div>`
  ).join("");
  return card(
    "\u{1F5D3}\uFE0F Mapa de calor \xB7 30 d\xEDas",
    "Recuperaci\xF3n diaria (m\xE1s antiguo \u2192 hoy)",
    `<div class="grid grid-cols-10 gap-1">${cells}</div>
    <div class="flex gap-3 text-[9px] text-slate-400">
      <span><b style="color:#10B981">\u25A0</b> \u226567</span>
      <span><b style="color:#F59E0B">\u25A0</b> 34\u201366</span>
      <span><b style="color:#EF4444">\u25A0</b> <34</span>
      <span><b style="color:#64748b">\u25A0</b> calibrando</span>
    </div>`
  );
}

// src/components/mbe/sections/achievements.ts
function renderAchievements(options) {
  const { state: state2 } = options;
  const goal = LS("argon_steps_goal", 8e3);
  const r7 = state2.raw.slice(0, 7);
  const c7 = state2.comp.slice(0, 7);
  const c14 = state2.comp.slice(0, 14);
  const n = (a, f) => a.filter(f).length;
  const L = [
    ["\u{1F463}", "Pasos: meta 7/7", n(r7, (r) => (parseInt(r.steps_count, 10) || 0) >= goal), 7],
    ["\u{1F319}", "Sue\xF1o \u22657 h: 5 de 7", n(r7, (r) => (parseInt(r.total_sleep_min, 10) || 0) >= 420), 5],
    ["\u{1F969}", "Prote\xEDna \u226590% de meta: 5 de 7", n(c7, (c) => c.target_protein_g > 0 && c.intake_protein_g / c.target_protein_g >= 0.9), 5],
    ["\u{1F49A}", "Recuperaci\xF3n \u226567: 3 de 7", n(c7, (c) => c.recovery_score != null && c.recovery_score >= 67), 3],
    ["\u{1F4C5}", "Registro constante 14 d", c14.length, 14],
    ["\u{1F3CB}\uFE0F", "Entrenos: 3 en 7 d", n(r7, (r) => parseFloat(r.pickleball_or_gym_minutes) > 0), 3]
  ];
  const chips = L.map(([i, t2, v, g]) => {
    const ok = v >= g;
    return `<div class="flex items-center justify-between p-2 rounded-xl border ${ok ? "bg-emerald-500/10 border-emerald-500/40" : "bg-slate-900 border-slate-800"}"><span class="text-xs">${i} ${t2}</span><span class="text-[11px] font-mono ${ok ? "text-emerald-400 font-bold" : "text-slate-400"}">${ok ? "\u2713" : Math.min(v, g) + "/" + g}</span></div>`;
  }).join("");
  return card("\u{1F3C6} Logros", "Ventana m\xF3vil de 7\u201314 d\xEDas", `<div class="space-y-1.5">${chips}</div>`);
}

// src/components/mbe/sections/week.ts
function weekStats(state2) {
  const c = state2.comp.slice(0, 7);
  const r = state2.raw.slice(0, 7);
  if (!c.length) return null;
  const av = (a) => {
    const v = a.filter((v2) => isFinite(v2));
    return v.length ? mean(v) : NaN;
  };
  return {
    from: c[c.length - 1].log_date,
    to: c[0].log_date,
    rec: av(c.map((x) => x.recovery_score == null ? NaN : +x.recovery_score)),
    sleep: av(r.map((x) => (parseInt(x.total_sleep_min, 10) || NaN) / 60)),
    steps: av(r.map((x) => parseInt(x.steps_count, 10) || NaN)),
    strain: av(c.map((x) => parseFloat(x.strain_score))),
    prot: av(c.map((x) => x.target_protein_g > 0 ? x.intake_protein_g / x.target_protein_g * 100 : NaN)),
    dw: c.length > 1 ? parseFloat(c[0].trend_weight_kg) - parseFloat(c[c.length - 1].trend_weight_kg) : NaN
  };
}
var fx = (v, d = 0) => isFinite(v) ? v.toFixed(d) : "--";
var t = (l, v) => `<div class="p-2 rounded-xl bg-slate-900 text-center"><div class="text-[9px] text-slate-400">${l}</div><div class="font-mono font-black text-sm">${v}</div></div>`;
function renderWeek(options) {
  const { state: state2 } = options;
  const w = weekStats(state2);
  if (!w) return card("\u{1F4E4} Tarjeta semanal", "Compartible", empty2("Sin datos."));
  return card(
    "\u{1F4E4} Tarjeta semanal",
    `${w.from} \u2192 ${w.to}`,
    `<div class="grid grid-cols-3 gap-2">
      ${t("Recuperaci\xF3n", fx(w.rec) + "%")}
      ${t("Sue\xF1o", fx(w.sleep, 1) + " h")}
      ${t("Pasos", fx(w.steps).replace(/\B(?=(\d{3})+(?!\d))/g, ","))}
      ${t("Strain", fx(w.strain, 1))}
      ${t("Prote\xEDna", fx(w.prot) + "%")}
      ${t("\u0394 Peso", (isFinite(w.dw) ? (w.dw > 0 ? "+" : "") + w.dw.toFixed(2) : "--") + " kg")}
    </div>
    <button onclick="mbeShare()" class="w-full py-2.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-black font-black text-xs uppercase tracking-wider">Compartir imagen</button>`
  );
}

// src/components/mbe/sections/theme.ts
function renderTheme(options) {
  const { currentAccent } = options;
  const chips = Object.keys(ACC).map(
    (k) => `<button onclick="mbeAccent('${k}')" aria-label="${k}" class="w-9 h-9 rounded-full" style="background:${ACC[k]};outline:${k === currentAccent ? "3px solid #fff" : "none"};outline-offset:2px"></button>`
  ).join("");
  return card("\u{1F3A8} Color de acento", "Se guarda en este dispositivo", `<div class="flex gap-3">${chips}</div>`);
}
function applyAccent(k) {
  const c = ACC[k] || ACC.cyan;
  let s = document.getElementById("mbe-acc");
  if (!s) {
    s = document.createElement("style");
    s.id = "mbe-acc";
    document.head.appendChild(s);
  }
  s.textContent = k && k !== "cyan" ? `.text-cyan-300,.text-cyan-400,.text-cyan-200{color:${c}!important}.border-cyan-500\\/30,.border-cyan-500\\/40,.border-cyan-500\\/45{border-color:${c}66!important}.bg-cyan-500\\/15,.bg-cyan-500\\/10,.bg-cyan-500\\/20{background-color:${c}26!important}.tab-btn-active{color:${c}!important;border-color:${c}73!important}` : "";
  const t2 = document.querySelector("meta[name=theme-color]");
  if (t2) t2.content = "#05080F";
}

// argon-mbe.js
var SLOTS = {
  0: [renderDatePicker, renderSteps, renderRetrain, renderWorkouts],
  1: [renderBedTime, renderHypnogram, renderNaps, renderHrv],
  2: [renderLT, renderArgonAge],
  4: [renderHeatMap, renderAchievements, renderWeek, renderTheme]
};
function wire() {
  const g = document.getElementById("mbe-goal");
  if (g) g.onchange = () => {
    const LS2 = (key, def) => {
      try {
        const v = localStorage.getItem(key);
        return v ? JSON.parse(v) : def;
      } catch {
        return def;
      }
    };
    localStorage.setItem("argon_steps_goal", JSON.stringify(Math.max(1e3, parseInt(g.value, 10) || 8e3)));
    renderAll();
  };
  const dp = document.getElementById("mbe-date");
  if (dp) dp.onchange = () => {
    load(dp.value);
  };
  const b = document.getElementById("lt-save");
  if (b) b.onclick = () => {
    const LS2 = (key, def) => {
      try {
        const v = localStorage.getItem(key);
        return v ? JSON.parse(v) : def;
      } catch {
        return def;
      }
    };
    const km = parseFloat(document.getElementById("lt-km").value);
    const hr = parseFloat(document.getElementById("lt-hr").value);
    if (!(km >= 2 && km <= 12) || !(hr >= 120 && hr <= 220)) return alert("Datos fuera de rango (km 2\u201312, FC 120\u2013220).");
    const h = LS2("argon_lt_v1", []);
    h.push({ date: todayIso(), km, hr });
    localStorage.setItem("argon_lt_v1", JSON.stringify(h.slice(-10)));
    renderAll();
  };
}
function renderAll(errMsg) {
  const state2 = getMbeState();
  const slides = document.querySelectorAll(".argon-main-swiper .swiper-slide");
  Object.keys(SLOTS).forEach((i) => {
    const s = slides[Number(i)];
    if (!s) return;
    let box = s.querySelector(":scope > .mbe-slot");
    if (!box) {
      box = document.createElement("div");
      box.className = "mbe-slot space-y-3.5";
      s.appendChild(box);
    }
    box.innerHTML = (errMsg && i == 1 ? renderDatePicker({ state: state2, onDateChange: () => {
    }, onTodayClick: () => {
    } }) : "") + SLOTS[Number(i)].map((f) => {
      try {
        return f({ state: state2 });
      } catch (e) {
        return renderDatePicker({ state: state2, onDateChange: () => {
        }, onTodayClick: () => {
        } });
      }
    }).join("");
  });
  wire();
  if (typeof window.argonSwiper !== "undefined" && window.argonSwiper) {
    setTimeout(() => window.argonSwiper.updateAutoHeight(200), 60);
  }
}
async function load(dateStr) {
  if (dateStr) setSelectedDate(dateStr);
  try {
    await loadMbeData(dateStr);
    renderAll();
  } catch (e) {
    renderAll("No se pudieron cargar los datos MBE+: " + (e instanceof Error ? e.message : String(e)));
  }
}
window.mbeLoad = load;
window.openMbe = () => {
  if (typeof window.goToArgonTab === "function") window.goToArgonTab(1);
  load();
};
function init() {
  applyAccent(localStorage.getItem("argon_accent") || "cyan");
  setTimeout(load, 1200);
  const wrap = () => {
    const s = window.syncFromSupabase;
    if (typeof s === "function" && !s._mbe) {
      const w = async function() {
        const r = await s.apply(this, arguments);
        load();
        return r;
      };
      w._mbe = true;
      window.syncFromSupabase = w;
    }
  };
  setTimeout(wrap, 1500);
}
if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}
export {
  getMbeState,
  load,
  renderAll,
  weekStats
};
//# sourceMappingURL=argon-mbe.js.map
