/* ARGON MBE+ (módulo autónomo). Añadir en index.html antes de </body>:
   <script src="argon-mbe.js"></script>
   Lee Supabase directo (argon_sb_url / argon_sb_key de localStorage). No toca el motor del cliente. */
(function () {
  'use strict';
  const TZ = 'America/Caracas';
  const LS = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } };
  const cfg = () => ({ url: (localStorage.getItem('argon_sb_url') || 'https://eqbvzgqumwvksiovboth.supabase.co').trim(), key: (localStorage.getItem('argon_sb_key') || '').trim() });
  const st = { raw: [], comp: [] };

  async function sbGet(path) {
    const c = cfg();
    if (!c.key) throw new Error('Falta la Anon Key en ⚙️');
    const r = await fetch(c.url + '/rest/v1/' + path, { headers: { apikey: c.key, Authorization: 'Bearer ' + c.key } });
    if (!r.ok) throw new Error('Supabase ' + r.status);
    return r.json();
  }

  // ---------- utilidades puras ----------
  const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
  const sd = (a, m) => a.length > 1 ? Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length) : 0;
  const hhmm = ms => new Intl.DateTimeFormat('es-VE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
  const m18 = t => { const [h, m] = String(t).slice(0, 5).split(':').map(Number); return (((h * 60 + m - 1080) % 1440) + 1440) % 1440; };
  const pace = p => { const m = Math.floor(p), s = Math.round((p - m) * 60); return `${m}:${String(s === 60 ? 0 : s).padStart(2, '0')}`; };
  const isSeed = r => parseFloat(r.rmssd_ms) === 50 && parseFloat(r.rhr_bpm) === 54.5;

  function retrain(strain, rec, debtH, hoursSince) {
    // Heurística (no validada como fórmula única): base por carga del día, modulada por recuperación y deuda de sueño
    const base = strain < 8 ? 12 : strain < 12 ? 24 : strain < 16 ? 36 : 48;
    const f = (rec == null) ? 1 : rec >= 67 ? 0.85 : rec < 34 ? 1.3 : 1;
    const need = Math.round(base * f * (debtH > 2 ? 1.1 : 1));
    return { need, left: Math.max(0, Math.round(need - hoursSince)) };
  }

  function ltCalc(km, hr) {
    // Friel: LTHR = FC media de los últimos 20 min de una contrarreloj de 30 min en solitario
    const p30 = 30 / km;
    const zs = [['Z1 Recuperación', 0, .85], ['Z2 Aeróbica', .85, .89], ['Z3 Tempo', .90, .94], ['Z4 Sub-umbral', .95, .99], ['Z5a Super-umbral', 1, 1.02], ['Z5b Capacidad aeróbica', 1.03, 1.06]];
    return { lthr: Math.round(hr), p30, pThr: p30 * 1.04, zones: zs.map(z => [z[0], z[1] ? Math.round(hr * z[1]) : 0, Math.round(hr * z[2])]) };
  }

  // ---------- UI helpers ----------
  const card = (t, sub, body) => `<section class="native-card p-4 space-y-2.5"><div><h4 class="text-[11px] font-extrabold uppercase tracking-wider text-cyan-300">${t}</h4><p class="text-[10px] text-slate-400">${sub}</p></div>${body}</section>`;
  const note = t => `<p class="text-[10px] text-slate-400 leading-snug">${t}</p>`;
  const empty = t => `<p class="text-[11px] text-amber-300/90">${t}</p>`;
  const ex = r => (r && r.hr_zones_minutes && r.hr_zones_minutes.x) || {};

  // ---------- secciones ----------
  function secBed() {
    const c = st.comp[0]; if (!c || !c.optimal_bedtime_start) return card('Hora de dormir', 'Ventana óptima', empty('Sin datos calculados.'));
    const prof = LS('argon_profile_v1', {}); const wake = prof.wake || '06:00';
    const span = 1080, x = m => Math.max(0, Math.min(100, m / span * 100));
    const a = m18(c.optimal_bedtime_start), b = m18(c.optimal_bedtime_end), w = m18(wake);
    const h = ex(st.raw[0]).hypno; let real = '';
    if (h && h.seg && h.seg.length) {
      const s0 = m18(hhmm(h.t0)), last = h.seg[h.seg.length - 1], len = last[1] + last[2];
      real = `<div class="absolute top-1 h-2 rounded bg-purple-500/80" style="left:${x(s0)}%;width:${Math.max(1, x(s0 + len) - x(s0))}%" title="Sueño real"></div>`;
    }
    const ticks = [18, 21, 0, 3, 6, 9, 12].map(hh => `<span class="absolute text-[9px] text-slate-500" style="left:${x(m18(String(hh).padStart(2, '0') + ':00'))}%;top:28px;transform:translateX(-50%)">${String(hh).padStart(2, '0')}h</span>`).join('');
    const bar = `<div class="relative h-12 rounded-xl bg-slate-900 border border-slate-800 overflow-hidden"><div class="absolute inset-y-0 bg-emerald-500/30 border-x border-emerald-400" style="left:${x(a)}%;width:${Math.max(2, x(b) - x(a))}%"></div>${real}<div class="absolute inset-y-0 w-0.5 bg-amber-400" style="left:${x(w)}%"></div>${ticks}</div>`;
    return card('🌙 Hora de dormir recomendada', 'Línea verde = ventana · violeta = sueño real · ámbar = despertar', `<div class="flex items-end justify-between"><div><div class="text-2xl font-black font-mono text-emerald-400">${c.optimal_bedtime_start.slice(0, 5)}–${c.optimal_bedtime_end.slice(0, 5)}</div><div class="text-[10px] text-slate-400">Necesidad hoy: ${c.dynamic_sleep_need_hours} h · despertar ${wake}</div></div></div>${bar}` + note('Ventana = despertar − (necesidad dinámica ÷ eficiencia). La necesidad base (7.5 h) es un valor personal calibrable; el rango poblacional adulto es 7–9 h (AASM/SRS, Watson 2015).'));
  }

  function secHypno() {
    const h = ex(st.raw[0]).hypno;
    if (!h || !h.seg || !h.seg.length) return card('📊 Hipnograma', 'Fases de la última noche', empty('Aún no hay fases guardadas. Se llenan con el próximo webhook de sueño (requiere Code.txt actualizado).'));
    const last = h.seg[h.seg.length - 1], span = last[1] + last[2], W = 300, row = { A: 0, R: 1, L: 2, D: 3 };
    const col = { A: '#94a3b8', R: '#a855f7', L: '#475569', D: '#3b82f6' };
    const rects = h.seg.map(s => `<rect x="${(s[1] / span * W).toFixed(1)}" y="${row[s[0]] * 16 + 2}" width="${Math.max(0.8, s[2] / span * W).toFixed(1)}" height="12" rx="2" fill="${col[s[0]]}"/>`).join('');
    const lab = ['Despierto', 'REM', 'Ligero', 'Profundo'].map((t, i) => `<text x="2" y="${i * 16 + 11}" font-size="8" fill="#94a3b8">${t}</text>`).join('');
    const tot = k => h.seg.filter(s => s[0] === k).reduce((q, s) => q + s[2], 0);
    return card('📊 Hipnograma', `${hhmm(h.t0)} → ${hhmm(h.t0 + span * 60000)}`, `<svg viewBox="0 0 ${W} 66" class="w-full">${rects}${lab}</svg>` + note(`Profundo ${tot('D')}m · REM ${tot('R')}m · Ligero ${tot('L')}m · Despierto ${tot('A')}m. Las fases por PPG de muñeca tienen concordancia moderada con PSG (κ≈0.4–0.6): útil para tendencias, no para diagnóstico.`));
  }

  function secNaps() {
    const n = ex(st.raw[0]).naps || [], tot = n.reduce((s, v) => s + v.min, 0);
    const body = n.length ? n.map(v => `<div class="flex justify-between text-xs"><span>🛌 ${v.t}</span><span class="font-mono text-purple-300">${v.min} min</span></div>`).join('') + `<div class="text-xs font-bold">Total hoy: ${tot} min</div>` : empty('Sin siestas detectadas hoy (se detectan episodios de 10–240 min que empiezan entre 08:00 y 20:00).');
    return card('😴 Siestas', 'Se suman a las horas del día', body + note('Siestas ≤30 min y antes de ~15:00 mejoran alerta con poco efecto sobre el sueño nocturno; >60 min aumentan inercia de sueño (Milner & Cote 2009). En guardia, una siesta profiláctica de 20–30 min reduce errores.'));
  }

  function secHrv() {
    const rows = st.raw.filter(r => parseFloat(r.rmssd_ms) > 0 && !isSeed(r)).slice().reverse();
    if (rows.length < 3) return card('💓 VFC nocturna vs diurna', 'lnRMSSD', empty('Se necesitan ≥3 días con VFC real.'));
    const ln = rows.map(r => Math.log(Math.max(5, parseFloat(r.rmssd_ms))));
    const base = ln.slice(-15, -1), mB = mean(base), sB = Math.max(0.04, sd(base, mB));
    const l7 = ln.slice(-7), m7 = mean(l7), cv7 = sd(l7, m7) / m7 * 100;
    const diff = m7 - mB, swc = 0.5 * sB;
    const stat = Math.abs(diff) <= swc ? ['Estable (dentro del SWC)', 'text-emerald-400'] : diff > 0 ? ['Por encima del SWC', 'text-cyan-300'] : ['Por debajo del SWC (fatiga/estrés)', 'text-amber-400'];
    const t = rows[rows.length - 1], rr = 60000 / (parseFloat(t.rhr_bpm) || 60), norm = (parseFloat(t.rmssd_ms) / rr * 100);
    const day = ex(st.raw[0]).hrv_day;
    const nap = ex(st.raw[0]).hrv_nap; const napTxt = nap ? `<div class="text-xs">Siesta: mediana <b class="font-mono">${nap.median} ms</b> · n=${nap.n} <span class="text-slate-400">(no entra en la base)</span></div>` : '';
    const dayTxt = day ? `<div class="text-xs">Diurna (reposo/actividad): mediana <b class="font-mono">${day.median} ms</b> · n=${day.n} · rango ${day.min}–${day.max}</div>` : '<div class="text-[11px] text-slate-400">Sin muestras diurnas guardadas.</div>';
    return card('💓 VFC nocturna vs diurna', 'Base: lnRMSSD, media 7 d vs línea base 14 d',
      `<div class="grid grid-cols-3 gap-2 text-center"><div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">Noche hoy</div><div class="font-mono font-black">${t.rmssd_ms} ms</div><div class="text-[9px] text-cyan-400 font-mono">ln ${Math.log(t.rmssd_ms).toFixed(2)}</div></div><div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">Media 7 d (ln)</div><div class="font-mono font-black">${m7.toFixed(2)}</div><div class="text-[9px] text-slate-400 font-mono">base ${mB.toFixed(2)}</div></div><div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">SWC (0.5·SD)</div><div class="font-mono font-black">±${swc.toFixed(3)}</div><div class="text-[9px] text-slate-400 font-mono">CV7 ${cv7.toFixed(1)}%</div></div></div>
       <div class="text-xs font-bold ${stat[1]}">${stat[0]} · Δ ${diff >= 0 ? '+' : ''}${diff.toFixed(3)}</div>${dayTxt}${napTxt}
       <div class="text-[10px] text-slate-400 font-mono">RMSSD/RR (normalizado por FC): ${norm.toFixed(1)}%</div>` +
      note('Se usa ln (transformación validada: Plews 2013; Buchheit 2014). La raíz cuadrada no tiene validación comparable, por eso no es la base. CV7 alto (>10%) = respuesta inestable. La VFC diurna por PPG es ruidosa y depende de postura/actividad: se muestra aparte y NO entra en la línea base ni en la recuperación.'));
  }

  function secWorkouts() {
    const list = [];
    st.raw.slice(0, 7).forEach(r => (ex(r).workouts || []).forEach(w => list.push(Object.assign({ date: r.log_date }, w))));
    list.sort((a, b) => (b.end_ms || 0) - (a.end_ms || 0));
    const body = list.length ? list.slice(0, 8).map(w => `<div class="flex items-center justify-between p-2 rounded-xl bg-slate-900 text-xs"><div><div class="font-bold">${w.type}</div><div class="text-[10px] text-slate-400">${w.date.slice(5)} · ${w.start || '--'}–${w.end || '--'}</div></div><div class="text-right font-mono"><div>${w.min} min</div><div class="text-[10px] text-amber-300">${w.kcal != null ? (w.kcal_est ? '~' : '') + w.kcal + ' kcal' : 'kcal n/d'}${w.avg_hr ? ' · ' + w.avg_hr + ' lpm' : ''}</div><div class="text-[9px] text-slate-400">${w.dist_m ? (w.dist_m / 1000).toFixed(2) + ' km' : ''}${w.steps ? ' · ' + w.steps + ' pasos' : ''}${w.max_hr ? ' · máx ' + w.max_hr : ''}</div></div></div>`).join('') : empty('Sin entrenamientos guardados. Se llenan con el próximo webhook de ejercicio (Code.txt actualizado).');
    return card('🏃 Entrenamientos recientes (Zepp)', 'Últimos 7 días' + (ex(st.raw[0]).active_kcal ? ' · kcal activas hoy (Zepp): ' + ex(st.raw[0]).active_kcal : ''), body + note('Zepp no envía kcal por sesión: las marcadas con ~ se estiman con la FC (Keytel 2005, fórmula masculina; error típico ±20–30%, tiende a sobreestimar con FC baja). No se suman a la ingesta ni se usan para "comer lo quemado".'));
  }

  function secSteps() {
    const goal = LS('argon_steps_goal', 8000), today = parseInt((st.raw[0] || {}).steps_count, 10) || 0;
    const last7 = st.raw.slice(0, 7).map(r => parseInt(r.steps_count, 10) || 0), hit = last7.filter(v => v >= goal).length;
    const pct = Math.min(100, today / goal * 100), C = 251.2;
    return card('👣 Pasos', 'Meta diaria editable', `<div class="flex items-center gap-4"><svg viewBox="0 0 100 100" class="w-20 h-20"><circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="9"/><circle cx="50" cy="50" r="40" fill="none" stroke="#22d3ee" stroke-width="9" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${(C - pct / 100 * C).toFixed(1)}" transform="rotate(-90 50 50)"/><text x="50" y="55" text-anchor="middle" font-size="16" font-weight="800" fill="#fff">${Math.round(pct)}%</text></svg><div class="text-xs space-y-1"><div class="font-mono font-black text-lg">${today.toLocaleString()} <span class="text-slate-400 text-xs">/ <input id="mbe-goal" type="number" value="${goal}" class="w-16 bg-slate-800 rounded px-1 text-white"></span></div><div class="text-slate-400">Media 7 d: ${Math.round(mean(last7)).toLocaleString()} · meta cumplida ${hit}/7 días</div></div></div>` + note('Meta por defecto 8 000: en adultos <60 años el riesgo de mortalidad se estabiliza hacia 8 000–10 000 pasos/día (Paluch, Lancet Public Health 2022); 8 000 vs 4 000 se asoció a ~51% menos mortalidad total (Saint-Maurice, JAMA 2020). Es asociación observacional.'));
  }

  function secRetrain() {
    const c = st.comp[0], r0 = st.raw[0];
    if (!c) return card('⏱️ Volver a entrenar', 'Heurística', empty('Sin datos.'));
    let last = null;
    st.raw.slice(0, 4).forEach(r => (ex(r).workouts || []).forEach(w => { if (w.end_ms && (!last || w.end_ms > last.end_ms)) last = w; }));
    let since, src = 'hora real de término';
    if (last) since = (Date.now() - last.end_ms) / 3600000;
    else if (parseFloat((r0 || {}).pickleball_or_gym_minutes) > 0) { const e = new Date(r0.log_date + 'T18:00:00-04:00').getTime(); since = (Date.now() - e) / 3600000; src = 'sin hora de término: se asume 18:00'; }
    else return card('⏱️ Volver a entrenar', 'Heurística', empty('No hay sesión reciente registrada.'));
    const strain = parseFloat(c.strain_score) || 0, rec = c.recovery_score == null ? null : parseFloat(c.recovery_score);
    const q = retrain(strain, rec, parseFloat(c.cumulative_sleep_debt_hours) || 0, Math.max(0, since));
    const ok = q.left === 0;
    return card('⏱️ Volver a entrenar', 'Regla transparente (heurística)', `<div class="text-2xl font-black font-mono ${ok ? 'text-emerald-400' : 'text-amber-400'}">${ok ? 'Listo para entrenar' : 'Faltan ~' + q.left + ' h'}</div><div class="text-[11px] text-slate-300">Recuperación sugerida: ${q.need} h · transcurridas: ${Math.round(since)} h (${src})</div>` + note('Base por strain de la sesión (<8: 12 h · 8–12: 24 h · 12–16: 36 h · ≥16: 48 h) × recuperación (≥67: ×0.85, <34: ×1.3) × deuda de sueño >2 h (×1.1). Apoyo: el daño/síntesis proteica tras fuerza se normaliza en ~24–72 h según volumen y grupo muscular, y el entrenamiento guiado por VFC mejora respuesta frente a planes fijos (Kiviniemi 2007). No es una fórmula validada: úsala como guía, no como regla.'));
  }

  function secLT() {
    const hist = LS('argon_lt_v1', []);
    const prof = LS('argon_profile_v1', {}); const birth = new Date((prof.birth || '1997-11-12') + 'T12:00:00-04:00');
    const age = (Date.now() - birth.getTime()) / (365.2425 * 86400000), hrMax = Math.round(208 - 0.7 * age);
    const lastT = hist[hist.length - 1];
    const out = lastT ? (() => { const r = ltCalc(lastT.km, lastT.hr); return `<div class="grid grid-cols-3 gap-2 text-center text-xs"><div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">LTHR</div><div class="font-mono font-black text-lg text-rose-400">${r.lthr}</div></div><div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">Ritmo 30′</div><div class="font-mono font-black">${pace(r.p30)}/km</div></div><div class="p-2 rounded-xl bg-slate-900"><div class="text-[9px] text-slate-400">Ritmo umbral ≈</div><div class="font-mono font-black">${pace(r.pThr)}/km</div></div></div>` + r.zones.map(z => `<div class="flex justify-between text-[11px] font-mono"><span class="text-slate-300">${z[0]}</span><span>${z[1] ? z[1] + '–' : '<'}${z[2]} lpm</span></div>`).join('') + `<div class="text-[10px] text-slate-400">Último test: ${lastT.date}</div>`; })()
      : `<div class="text-xs">Estimación sin test (baja confianza): ${Math.round(hrMax * .85)}–${Math.round(hrMax * .90)} lpm (85–90% de FCmáx Tanaka ${hrMax}).</div>`;
    return card('🫁 Umbral de lactato en carrera', 'Test de campo de 30 min (Friel)', out + `<div class="grid grid-cols-3 gap-1.5 pt-1"><input id="lt-km" type="number" step="0.01" placeholder="km en 30′" class="bg-slate-800 rounded-xl px-2 py-1.5 text-xs text-white"><input id="lt-hr" type="number" placeholder="FC media últ. 20′" class="bg-slate-800 rounded-xl px-2 py-1.5 text-xs text-white"><button id="lt-save" class="rounded-xl bg-cyan-500 text-black font-black text-[11px]">Calcular</button></div>` + note('Protocolo: calentar 10–15′, correr 30′ al máximo ritmo sostenible y constante, solo, plano, sin pausas; pulsa "lap" a los 10′. LTHR = FC media de los últimos 20′. Correlaciona razonablemente con el umbral de laboratorio pero con error individual de varios lpm; el ritmo umbral estricto ≈ ritmo de 60′ (por eso se aplica +4% a tu ritmo de 30′). Repetir cada 6–8 semanas, descansado, mismas condiciones.'));
  }

  // ---------- Paquete D ----------
  const ACC = { cyan: '#22d3ee', emerald: '#34d399', violet: '#a78bfa', amber: '#fbbf24', rose: '#fb7185' };
  function applyAccent(k) {
    const c = ACC[k] || ACC.cyan; let s = document.getElementById('mbe-acc');
    if (!s) { s = document.createElement('style'); s.id = 'mbe-acc'; document.head.appendChild(s); }
    s.textContent = k && k !== 'cyan' ? `.text-cyan-300,.text-cyan-400,.text-cyan-200{color:${c}!important}.border-cyan-500\\/30,.border-cyan-500\\/40,.border-cyan-500\\/45{border-color:${c}66!important}.bg-cyan-500\\/15,.bg-cyan-500\\/10,.bg-cyan-500\\/20{background-color:${c}26!important}.tab-btn-active{color:${c}!important;border-color:${c}73!important}` : '';
    const t = document.querySelector('meta[name=theme-color]'); if (t) t.content = '#05080F';
  }
  window.mbeAccent = k => { localStorage.setItem('argon_accent', k); applyAccent(k); renderAll(); };

  function secHeat() {
    const rows = st.comp.slice(0, 30).reverse();
    if (!rows.length) return card('🗓️ Mapa de calor · 30 días', 'Recuperación diaria', empty('Sin datos.'));
    const col = v => v == null ? '#334155' : v >= 67 ? '#10B981' : v >= 34 ? '#F59E0B' : '#EF4444';
    const cells = rows.map(r => `<div title="${r.log_date}: ${r.recovery_score == null ? 'calibrando' : r.recovery_score + '%'}" class="aspect-square rounded-md" style="background:${col(r.recovery_score)};opacity:${r.recovery_score == null ? .5 : .35 + .65 * Math.min(1, r.recovery_score / 100)}"></div>`).join('');
    return card('🗓️ Mapa de calor · 30 días', 'Recuperación diaria (más antiguo → hoy)', `<div class="grid grid-cols-10 gap-1">${cells}</div><div class="flex gap-3 text-[9px] text-slate-400"><span><b style="color:#10B981">■</b> ≥67</span><span><b style="color:#F59E0B">■</b> 34–66</span><span><b style="color:#EF4444">■</b> &lt;34</span><span><b style="color:#64748b">■</b> calibrando</span></div>`);
  }

  function secAch() {
    const goal = LS('argon_steps_goal', 8000), r7 = st.raw.slice(0, 7), c7 = st.comp.slice(0, 7), c14 = st.comp.slice(0, 14);
    const n = (a, f) => a.filter(f).length;
    const L = [
      ['👣', 'Pasos: meta 7/7', n(r7, r => (parseInt(r.steps_count, 10) || 0) >= goal), 7],
      ['🌙', 'Sueño ≥7 h: 5 de 7', n(r7, r => (parseInt(r.total_sleep_min, 10) || 0) >= 420), 5],
      ['🥩', 'Proteína ≥90% de meta: 5 de 7', n(c7, c => c.target_protein_g > 0 && c.intake_protein_g / c.target_protein_g >= 0.9), 5],
      ['💚', 'Recuperación ≥67: 3 de 7', n(c7, c => c.recovery_score != null && c.recovery_score >= 67), 3],
      ['📅', 'Registro constante 14 d', c14.length, 14],
      ['🏋️', 'Entrenos: 3 en 7 d', n(r7, r => parseFloat(r.pickleball_or_gym_minutes) > 0), 3]
    ];
    const chips = L.map(([i, t, v, g]) => { const ok = v >= g; return `<div class="flex items-center justify-between p-2 rounded-xl border ${ok ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-slate-900 border-slate-800'}"><span class="text-xs">${i} ${t}</span><span class="text-[11px] font-mono ${ok ? 'text-emerald-400 font-bold' : 'text-slate-400'}">${ok ? '✓' : Math.min(v, g) + '/' + g}</span></div>`; }).join('');
    return card('🏆 Logros', 'Ventana móvil de 7–14 días', `<div class="space-y-1.5">${chips}</div>`);
  }

  function weekStats() {
    const c = st.comp.slice(0, 7), r = st.raw.slice(0, 7); if (!c.length) return null;
    const av = a => { a = a.filter(v => isFinite(v)); return a.length ? mean(a) : NaN; };
    return {
      from: c[c.length - 1].log_date, to: c[0].log_date,
      rec: av(c.map(x => x.recovery_score == null ? NaN : +x.recovery_score)),
      sleep: av(r.map(x => (parseInt(x.total_sleep_min, 10) || NaN) / 60)),
      steps: av(r.map(x => parseInt(x.steps_count, 10) || NaN)),
      strain: av(c.map(x => parseFloat(x.strain_score))),
      prot: av(c.map(x => x.target_protein_g > 0 ? x.intake_protein_g / x.target_protein_g * 100 : NaN)),
      dw: c.length > 1 ? parseFloat(c[0].trend_weight_kg) - parseFloat(c[c.length - 1].trend_weight_kg) : NaN
    };
  }
  const fx = (v, d = 0) => isFinite(v) ? v.toFixed(d) : '--';

  function secWeek() {
    const w = weekStats(); if (!w) return card('📤 Tarjeta semanal', 'Compartible', empty('Sin datos.'));
    const t = (l, v) => `<div class="p-2 rounded-xl bg-slate-900 text-center"><div class="text-[9px] text-slate-400">${l}</div><div class="font-mono font-black text-sm">${v}</div></div>`;
    return card('📤 Tarjeta semanal', `${w.from} → ${w.to}`, `<div class="grid grid-cols-3 gap-2">${t('Recuperación', fx(w.rec) + '%')}${t('Sueño', fx(w.sleep, 1) + ' h')}${t('Pasos', fx(w.steps).replace(/\B(?=(\d{3})+(?!\d))/g, ','))}${t('Strain', fx(w.strain, 1))}${t('Proteína', fx(w.prot) + '%')}${t('Δ Peso', (isFinite(w.dw) ? (w.dw > 0 ? '+' : '') + w.dw.toFixed(2) : '--') + ' kg')}</div><button onclick="mbeShare()" class="w-full py-2.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-black font-black text-xs uppercase tracking-wider">Compartir imagen</button>`);
  }

  window.mbeShare = async () => {
    const w = weekStats(); if (!w) return;
    const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1350; const x = cv.getContext('2d');
    const ac = ACC[localStorage.getItem('argon_accent')] || ACC.cyan;
    const g = x.createLinearGradient(0, 0, 0, 1350); g.addColorStop(0, '#0B1220'); g.addColorStop(1, '#05080F'); x.fillStyle = g; x.fillRect(0, 0, 1080, 1350);
    x.fillStyle = ac; x.font = '800 64px system-ui,sans-serif'; x.fillText('ARGON', 70, 120);
    x.fillStyle = '#94A3B8'; x.font = '500 34px system-ui,sans-serif'; x.fillText('Resumen semanal · ' + w.from + ' → ' + w.to, 70, 175);
    const T = [['Recuperación', fx(w.rec) + '%'], ['Sueño', fx(w.sleep, 1) + ' h'], ['Pasos/día', fx(w.steps).replace(/\B(?=(\d{3})+(?!\d))/g, ',')], ['Strain medio', fx(w.strain, 1) + ' / 21'], ['Proteína vs meta', fx(w.prot) + '%'], ['Δ Peso (tendencia)', (isFinite(w.dw) ? (w.dw > 0 ? '+' : '') + w.dw.toFixed(2) : '--') + ' kg']];
    T.forEach((t, i) => {
      const cx = 70 + (i % 2) * 480, cy = 250 + Math.floor(i / 2) * 330;
      x.fillStyle = 'rgba(30,41,59,.75)'; x.beginPath(); x.roundRect(cx, cy, 460, 300, 36); x.fill();
      x.fillStyle = '#94A3B8'; x.font = '500 32px system-ui,sans-serif'; x.fillText(t[0], cx + 36, cy + 78);
      x.fillStyle = '#F8FAFC'; x.font = '800 78px ui-monospace,monospace'; x.fillText(t[1], cx + 36, cy + 200);
    });
    x.fillStyle = '#64748B'; x.font = '400 28px system-ui,sans-serif'; x.fillText('Biometría clínica MBE · generado con ARGON', 70, 1290);
    cv.toBlob(async b => {
      const f = new File([b], 'argon-semana.png', { type: 'image/png' });
      try { if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: 'ARGON semanal' }); return; } } catch (_) { return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'argon-semana.png'; a.click();
    });
  };

  function secTheme() {
    const cur = localStorage.getItem('argon_accent') || 'cyan';
    const chips = Object.keys(ACC).map(k => `<button onclick="mbeAccent('${k}')" aria-label="${k}" class="w-9 h-9 rounded-full" style="background:${ACC[k]};outline:${k === cur ? '3px solid #fff' : 'none'};outline-offset:2px"></button>`).join('');
    return card('🎨 Color de acento', 'Se guarda en este dispositivo', `<div class="flex gap-3">${chips}</div>`);
  }

  // ---------- inyección en las pestañas ----------
  const SLOTS = { 0: [secSteps, secRetrain, secWorkouts], 1: [secBed, secHypno, secNaps, secHrv], 2: [secLT], 4: [secHeat, secAch, secWeek, secTheme] };

  function wire() {
    const g = document.getElementById('mbe-goal'); if (g) g.onchange = () => { localStorage.setItem('argon_steps_goal', JSON.stringify(Math.max(1000, parseInt(g.value, 10) || 8000))); renderAll(); };
    const b = document.getElementById('lt-save');
    if (b) b.onclick = () => {
      const km = parseFloat(document.getElementById('lt-km').value), hr = parseFloat(document.getElementById('lt-hr').value);
      if (!(km >= 2 && km <= 12) || !(hr >= 120 && hr <= 220)) return alert('Datos fuera de rango (km 2–12, FC 120–220).');
      const h = LS('argon_lt_v1', []); h.push({ date: new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()), km, hr }); localStorage.setItem('argon_lt_v1', JSON.stringify(h.slice(-10))); renderAll();
    };
  }

  function renderAll(errMsg) {
    const slides = document.querySelectorAll('.argon-main-swiper .swiper-slide');
    Object.keys(SLOTS).forEach(i => {
      const s = slides[i]; if (!s) return;
      let box = s.querySelector(':scope > .mbe-slot');
      if (!box) { box = document.createElement('div'); box.className = 'mbe-slot space-y-3.5'; s.appendChild(box); }
      box.innerHTML = (errMsg && i == 1 ? card('MBE+', 'Datos', empty(errMsg)) : '') + SLOTS[i].map(f => { try { return f(); } catch (e) { return card('Error', f.name, empty(e.message)); } }).join('');
    });
    wire();
    if (typeof argonSwiper !== 'undefined' && argonSwiper) setTimeout(() => argonSwiper.updateAutoHeight(200), 60);
  }

  async function load() {
    try {
      const [raw, comp] = await Promise.all([sbGet('daily_raw_biometrics?order=log_date.desc&limit=30'), sbGet('computed_daily_scores?order=log_date.desc&limit=30')]);
      st.raw = raw; st.comp = comp; renderAll();
    } catch (e) { renderAll('No se pudieron cargar los datos MBE+: ' + e.message); }
  }

  window.openMbe = () => { if (typeof goToArgonTab === 'function') goToArgonTab(1); load(); };

  function init() {
    applyAccent(localStorage.getItem('argon_accent') || 'cyan');
    setTimeout(load, 1200);
    const wrap = () => { const s = window.syncFromSupabase; if (typeof s === 'function' && !s._mbe) { const w = async function () { const r = await s.apply(this, arguments); load(); return r; }; w._mbe = true; window.syncFromSupabase = w; } };
    setTimeout(wrap, 1500);
  }

  if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init(); }
  if (typeof module !== 'undefined') module.exports = { retrain, ltCalc, m18, pace, st, secs: { secBed, secHypno, secNaps, secHrv, secWorkouts, secSteps, secRetrain, secLT, secHeat, secAch, secWeek, secTheme } };
})();
