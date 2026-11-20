/**
 * ============================================================================
 * ARGON v6.0 — Sleep Webhook Integration for Google Apps Script
 * Add this to your GAS project (code.txt) to send raw 1Hz sleep data
 * to the Supabase sleep-webhook Edge Function.
 * ============================================================================
 */

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const SLEEP_WEBHOOK_CONFIG = {
  // URL del Edge Function sleep-webhook
  // Configurar en Script Properties: SLEEP_WEBHOOK_URL
  get URL() {
    return PropertiesService.getScriptProperties().getProperty('SLEEP_WEBHOOK_URL') || '';
  },
  // Service Role Key para autenticación server-to-server
  // Configurar en Script Properties: SUPABASE_SERVICE_ROLE_KEY
  get SERVICE_ROLE_KEY() {
    return PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_ROLE_KEY') || '';
  },
  // User ID del usuario ARGON (obtener desde profile o Properties)
  // Configurar en Script Properties: ARGON_USER_ID
  get USER_ID() {
    return PropertiesService.getScriptProperties().getProperty('ARGON_USER_ID') || '';
  }
};

/**
 * Envía datos de sueño crudos (1Hz) al sleep-webhook Edge Function.
 * Debe llamarse después de procesar el payload de Health Connect en doPostInner_.
 *
 * @param {Object} payload - Payload original de Health Connect
 * @param {Object} extractedDay - Día extraído por extractHealthConnectByDate_
 * @param {string} dateStr - Fecha en formato YYYY-MM-DD
 */
function sendSleepDataToWebhook_(payload, extractedDay, dateStr) {
  try {
    // 1. Obtener user_id (desde config o profile)
    const userId = SLEEP_WEBHOOK_CONFIG.USER_ID;
    if (!userId) {
      Logger.log('Sleep webhook: USER_ID no configurado, saltando envío');
      return { skipped: true, reason: 'USER_ID missing' };
    }

    // 2. Obtener sesión de sueño principal (no siesta)
    const sleepSession = getMainSleepSession_(extractedDay);
    if (!sleepSession) {
      Logger.log('Sleep webhook: No hay sesión de sueño principal válida');
      return { skipped: true, reason: 'No main sleep session' };
    }

    const { startMs, endMs, stages } = sleepSession;
    const inBedStartS = Math.floor(startMs / 1000);
    const inBedEndS = Math.floor(endMs / 1000);

    // 3. Extraer datos crudos 1Hz del payload original
    const rawData = extractRaw1HzData_(payload, startMs, endMs);

    if (!rawData.accel.length || !rawData.hr.length) {
      Logger.log('Sleep webhook: Datos 1Hz insuficientes (accel: ' + rawData.accel.length + ', hr: ' + rawData.hr.length + ')');
      return { skipped: true, reason: 'Insufficient 1Hz data' };
    }

    // 4. Construir payload para sleep-webhook
    const webhookPayload = {
      user_id: userId,
      log_date: dateStr,
      in_bed_start_s: inBedStartS,
      in_bed_end_s: inBedEndS,
      config: { epoch_sec: 30 },
      accel: rawData.accel,
      hr: rawData.hr,
      rr: rawData.rr
    };

    // 5. Enviar a Edge Function
    const response = callSleepWebhook_(webhookPayload);

    if (response.success) {
      Logger.log('Sleep webhook: Enviado OK - ' + response.data.segmentation.stages.length + ' épocas, stored: ' + response.data.stored);
      return { success: true, epochs: response.data.segmentation.stages.length, stored: response.data.stored };
    } else {
      Logger.log('Sleep webhook: Error - ' + (response.error || 'Unknown error'));
      return { success: false, error: response.error };
    }

  } catch (e) {
    Logger.log('Sleep webhook: Excepción - ' + e.message + '\n' + e.stack);
    return { success: false, error: e.message };
  }
}

/**
 * Extrae la sesión de sueño principal (no siesta) del día extraído.
 * @param {Object} extractedDay - Resultado de extractHealthConnectByDate_
 * @return {Object|null} {startMs, endMs, stages} o null
 */
function getMainSleepSession_(extractedDay) {
  // Buscar en hypno (sesión principal con etapas)
  if (extractedDay.hypno && extractedDay.hypno.seg && extractedDay.hypno.seg.length > 0) {
    const t0 = extractedDay.hypno.t0;
    const segs = extractedDay.hypno.seg;
    const lastSeg = segs[segs.length - 1];
    const endMs = t0 + (lastSeg[1] + lastSeg[2]) * 60000;
    return { startMs: t0, endMs: endMs, stages: segs };
  }

  // Fallback: usar sleep_total_min y sleep_tib_min
  if (extractedDay.sleep_total_min && extractedDay.sleep_total_min >= 120) {
    // Estimar start/end desde HRV nocturnal si está disponible
    const hrvNight = extractedDay.hrv_night || [];
    if (hrvNight.length > 0) {
      const startMs = hrvNight[0][0] * 1000; // hrv_night guarda timestamp en segundos
      const endMs = hrvNight[hrvNight.length - 1][0] * 1000;
      return { startMs, endMs, stages: [] };
    }
  }

  return null;
}

/**
 * Extrae datos crudos 1Hz (accel, HR, RR) del payload de Health Connect
 * para la ventana de tiempo dada.
 *
 * @param {Object} payload - Payload original de Health Connect
 * @param {number} startMs - Inicio de ventana en ms
 * @param {number} endMs - Fin de ventana en ms
 * @return {Object} {accel: [], hr: [], rr: []}
 */
function extractRaw1HzData_(payload, startMs, endMs) {
  const accel = [];
  const hr = [];
  const rr = [];

  // Recorrer todo el payload buscando datos en la ventana temporal
  function processRecord(rec) {
    if (!rec || typeof rec !== 'object') return;
    const cat = String(rec.type || rec.record_type || rec.recordType || '').toLowerCase();

    // Acelerómetro (categoría: accelerometer, accel, activity)
    if (cat === 'accelerometer' || cat === 'accel' || cat.includes('accel') || cat === 'activity') {
      const ts = extractTimestamp_(rec);
      if (ts && startMs <= ts && ts <= endMs) {
        const x = extractAccel_(rec, ['x', 'X']);
        const y = extractAccel_(rec, ['y', 'Y']);
        const z = extractAccel_(rec, ['z', 'Z']);
        if (x !== null && y !== null && z !== null) {
          accel.push({ ts_ms: ts, x: x, y: y, z: z, valid: true });
        }
      }
    }

    // Frecuencia cardíaca (categoría: heart_rate, heartrate)
    if (cat === 'heart_rate' || cat === 'heartrate') {
      const ts = extractTimestamp_(rec);
      const bpm = extractHR_(rec, ['bpm', 'hr', 'heart_rate', 'value', 'avg']);
      if (ts && bpm !== null && startMs <= ts && ts <= endMs) {
        hr.push({ ts_ms: ts, hr: Math.round(bpm) });
      }
    }

    // Variabilidad cardíaca / RR intervals (categoría: heart_rate_variability, hrv, variability)
    if (cat.includes('variability') || cat.includes('hrv') || cat === 'heart_rate_variability') {
      const ts = extractTimestamp_(rec);
      // RR intervals pueden venir como array rr_ms, rr_intervals, o como rmssd_ms
      const rrMs = rec.rr_ms || rec.rr_intervals || rec.rr || rec.rmssd_ms;
      const rrTs = rec.ts_ms || rec.timestamps || rec.rr_timestamps;

      if (ts && startMs <= ts && ts <= endMs) {
        if (Array.isArray(rrMs) && rrMs.length > 0) {
          // Formato: timestamp único + array de RR intervals
          const validRr = rrMs.map(n => extractNumber_(null, [n], { min: 300, max: 2000 })).filter(n => n !== null);
          if (validRr.length > 0) {
            rr.push({ ts_ms: ts, rr_ms: validRr });
          }
        } else if (Array.isArray(rrTs) && Array.isArray(rrMs) && rrTs.length === rrMs.length) {
          // Formato: array de timestamps + array de RR intervals
          const pairs = [];
          for (let i = 0; i < rrTs.length; i++) {
            const rrt = extractTimestamp_({ timestamp: rrTs[i] }); // Reutiliza validación de timestamp
            const rrm = extractNumber_(null, [rrMs[i]], { min: 300, max: 2000 });
            if (rrt && rrm !== null && startMs <= rrt && rrt <= endMs) {
              pairs.push({ ts: rrt, rr: rrm });
            }
          }
          if (pairs.length > 0) {
            rr.push({
              ts_ms: pairs.map(p => p.ts),
              rr_ms: pairs.map(p => p.rr)
            });
          }
        } else if (typeof rrMs === 'number') {
          const rrm = extractNumber_(null, [rrMs], { min: 300, max: 2000 });
          // Solo rmssd_ms disponible - no sirve para RR raw, ignorar
        }
      }
    }
  }

  // Recorrer payload (misma lógica que extractHealthConnectByDate_)
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    Object.keys(payload).forEach(topKey => {
      const val = payload[topKey];
      if (Array.isArray(val)) {
        val.forEach(processRecord);
      } else if (val && typeof val === 'object') {
        if (Array.isArray(val.records)) val.records.forEach(processRecord);
        else if (Array.isArray(val.data)) val.data.forEach(processRecord);
        else processRecord(val);
      }
    });
  } else if (Array.isArray(payload)) {
    payload.forEach(processRecord);
  }

  // Ordenar por timestamp
  accel.sort((a, b) => a.ts_ms - b.ts_ms);
  hr.sort((a, b) => a.ts_ms - b.ts_ms);
  rr.sort((a, b) => {
    const ta = Array.isArray(a.ts_ms) ? a.ts_ms[0] : a.ts_ms;
    const tb = Array.isArray(b.ts_ms) ? b.ts_ms[0] : b.ts_ms;
    return ta - tb;
  });

  return { accel, hr, rr };
}

/**
 * Extrae timestamp en ms de un registro Health Connect.
 * Valida límites: rechaza timestamps antes de 2020 o después de 2030, y maneja NaN/Infinity.
 */
function extractTimestamp_(rec) {
  const candidates = [
    rec.start_time, rec.startTime, rec.time, rec.timestamp,
    rec.date_time, rec.dateTime, rec.end_time, rec.endTime,
    rec.metadata && (rec.metadata.start_time || rec.metadata.startTime || rec.metadata.time)
  ];

  // Límites de validación: 2020-01-01 a 2030-12-31 en ms
  const MIN_TIMESTAMP_MS = 1577836800000; // 2020-01-01T00:00:00.000Z
  const MAX_TIMESTAMP_MS = 1893455999000; // 2030-12-31T23:59:59.000Z

  for (const c of candidates) {
    if (c === undefined || c === null || c === '') continue;
    let ms;
    if (typeof c === 'number') {
      // Rechazar NaN e Infinity
      if (!isFinite(c)) continue;
      ms = c < 1e11 ? c * 1000 : c; // seconds -> ms
    } else if (typeof c === 'string') {
      // Try parsing as ISO date string first (contains 'T' or matches date pattern)
      const looksLikeIsoDate = c.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(c);
      if (looksLikeIsoDate) {
        const dt = new Date(c);
        const dtMs = dt.getTime();
        if (!isNaN(dtMs) && isFinite(dtMs)) {
          ms = dtMs;
        }
      } else {
        // Fallback: try parsing as numeric string (seconds or ms since epoch)
        const num = parseFloat(c);
        if (!isNaN(num) && isFinite(num)) {
          ms = num < 1e11 ? num * 1000 : num;
        }
      }
    }
    // Validar rango y que sea un timestamp válido en ms
    if (ms && isFinite(ms) && ms >= MIN_TIMESTAMP_MS && ms <= MAX_TIMESTAMP_MS && ms > 1e12) {
      return Math.round(ms);
    }
  }
  return null;
}

/**
 * Extrae número de un registro probando múltiples claves con validación de límites.
 * Si rec es null, trata keys como valores directos a validar.
 *
 * @param {Object|null} rec - Registro de Health Connect o null para valores directos
 * @param {string[]|number[]} keys - Claves a probar en orden, o valores directos si rec es null
 * @param {Object} options - Opciones de validación
 * @param {number} options.min - Valor mínimo permitido
 * @param {number} options.max - Valor máximo permitido
 * @return {number|null} Número validado o null si no válido
 */
function extractNumber_(rec, keys, options = {}) {
  const { min = -Infinity, max = Infinity } = options;

  for (const k of keys) {
    let value;
    if (rec === null) {
      // Valor directo pasado en keys
      value = k;
    } else {
      // Valor desde objeto
      if (rec[k] === undefined || rec[k] === null) continue;
      value = rec[k];
    }
    const n = Number(value);
    // Validar NaN, Infinity y límites
    if (!isNaN(n) && isFinite(n) && n >= min && n <= max) {
      return n;
    }
  }
  return null;
}

/**
 * Extrae y valida frecuencia cardíaca (30-250 bpm)
 */
function extractHR_(rec, keys) {
  return extractNumber_(rec, keys, { min: 30, max: 250 });
}

/**
 * Extrae y valida aceleración en g (-10 a 10 g)
 */
function extractAccel_(rec, keys) {
  return extractNumber_(rec, keys, { min: -10, max: 10 });
}

/**
 * Extrae y valida intervalos RR en ms (300-2000 ms)
 */
function extractRR_(rec, keys) {
  return extractNumber_(rec, keys, { min: 300, max: 2000 });
}

/**
 * Valida que la configuración del webhook esté completa.
 * @return {Object} {valid: boolean, error?: string}
 */
function validateSleepWebhookConfig_() {
  const url = SLEEP_WEBHOOK_CONFIG.URL;
  const apiKey = SLEEP_WEBHOOK_CONFIG.SERVICE_ROLE_KEY;
  const userId = SLEEP_WEBHOOK_CONFIG.USER_ID;

  if (!url) {
    return { valid: false, error: 'SLEEP_WEBHOOK_URL no configurado en Script Properties' };
  }
  if (!apiKey) {
    return { valid: false, error: 'SUPABASE_SERVICE_ROLE_KEY no configurado en Script Properties' };
  }
  if (!userId) {
    return { valid: false, error: 'ARGON_USER_ID no configurado en Script Properties' };
  }
  // Validar formato de URL
  try {
    new URL(url);
  } catch (e) {
    return { valid: false, error: 'SLEEP_WEBHOOK_URL tiene formato inválido' };
  }
  return { valid: true };
}

/**
 * Llama al Edge Function sleep-webhook.
 *
 * @param {Object} webhookPayload - Payload formateado para sleep-webhook
 * @return {Object} Respuesta parseada
 */
function callSleepWebhook_(webhookPayload) {
  // Validar configuración antes de hacer la petición
  const configValidation = validateSleepWebhookConfig_();
  if (!configValidation.valid) {
    Logger.log('Sleep webhook: Config inválida - ' + configValidation.error);
    return { success: false, error: configValidation.error };
  }

  const url = SLEEP_WEBHOOK_CONFIG.URL;
  const apiKey = SLEEP_WEBHOOK_CONFIG.SERVICE_ROLE_KEY;

  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    },
    payload: JSON.stringify(webhookPayload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    const text = response.getContentText();

    if (code === 200) {
      try {
        return JSON.parse(text);
      } catch (parseError) {
        Logger.log('Sleep webhook: Error parseando respuesta - ' + parseError.message);
        return { success: false, error: 'Respuesta inválida del servidor' };
      }
    } else {
      Logger.log('Sleep webhook HTTP ' + code + ': ' + text);
      return { success: false, error: 'HTTP ' + code + ': ' + text };
    }
  } catch (e) {
    Logger.log('Sleep webhook: Error de red - ' + e.message);
    return { success: false, error: 'Error de red: ' + e.message };
  }
}

/**
 * Función de prueba para enviar datos de prueba al sleep-webhook.
 * Útil para verificar la integración sin esperar datos reales de Health Connect.
 */
function testSleepWebhook_() {
  // Datos de prueba simulados (2 horas de sueño)
  const testPayload = generateTestSleepPayload_();
  const result = callSleepWebhook_(testPayload);
  Logger.log('Test result: ' + JSON.stringify(result));
  return result;
}

/**
 * Genera payload de prueba con datos sintéticos de sueño.
 */
function generateTestSleepPayload_() {
  const userId = SLEEP_WEBHOOK_CONFIG.USER_ID || 'test-user-id';
  const startMs = 1705334400000; // 2024-01-15 00:00:00 UTC
  const endMs = 1705341600000;   // 2024-01-15 02:00:00 UTC
  const inBedStartS = 1705334400;
  const inBedEndS = 1705341600;

  const accel = [];
  const hr = [];
  const rr = [];

  // Simular 2 horas de datos 1Hz
  for (let sec = 0; sec < 7200; sec++) {
    const ts = startMs + sec * 1000;
    // Sueño: muy quieto (ENMO bajo)
    const isWake = sec < 1800; // Primeros 30 min wake
    const x = isWake ? Math.random() * 0.2 - 0.1 : Math.random() * 0.04 - 0.02;
    const y = isWake ? Math.random() * 0.2 - 0.1 : Math.random() * 0.04 - 0.02;
    const z = isWake ? 0.9 + Math.random() * 0.2 : 0.98 + Math.random() * 0.04;
    accel.push({ ts_ms: ts, x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000, z: Math.round(z * 1000) / 1000, valid: true });

    // HR cada 5 seg
    if (sec % 5 === 0) {
      const bpm = isWake ? 65 + Math.floor(Math.random() * 10) : 50 + Math.floor(Math.random() * 10);
      hr.push({ ts_ms: ts, hr: bpm });
    }

    // RR cada 15 seg
    if (sec % 15 === 0) {
      const baseRr = isWake ? 1000 : 1100;
      const rrIntervals = Array.from({length: 5}, () => baseRr + Math.floor(Math.random() * 80) - 40);
      rr.push({ ts_ms: ts, rr_ms: rrIntervals });
    }
  }

  return {
    user_id: userId,
    log_date: '2024-01-15',
    in_bed_start_s: inBedStartS,
    in_bed_end_s: inBedEndS,
    config: { epoch_sec: 30 },
    accel: accel,
    hr: hr,
    rr: rr
  };
}

/**
 * ============================================================================
 * INSTRUCCIONES DE INTEGRACIÓN:
 * ============================================================================
 *
 * 1. Copia este archivo completo a tu proyecto GAS (code.txt)
 *
 * 2. En doPostInner_ (línea ~70), después de upsertAndComputeDayInSupabase_,
 *    agrega la llamada al webhook:
 *
 *    detectedDates.forEach(dateStr => {
 *      const dayComputed = upsertAndComputeDayInSupabase_(dateStr, parsedByDate[dateStr]);
 *      syncedSummaries.push({...});
 *
 *      // NUEVO: Enviar a sleep-webhook para staging automático
 *      const webhookResult = sendSleepDataToWebhook_(payload, parsedByDate[dateStr], dateStr);
 *      Logger.log('Sleep webhook result for ' + dateStr + ': ' + JSON.stringify(webhookResult));
 *    });
 *
 * 3. Configura en PropertiesService (Apps Script → Project Settings → Script properties):
 *    - SLEEP_WEBHOOK_URL: https://eqbvzgqumwvksiovboth.supabase.co/functions/v1/sleep-webhook
 *    - SUPABASE_SERVICE_ROLE_KEY: tu service role key (formato JWT legacy)
 *    - ARGON_USER_ID: UUID del usuario en auth.users (ej: b5a1af76-fae3-4623-b6f9-eed86c7b466f)
 *
 * 4. Para probar sin Health Connect, ejecuta testSleepWebhook_() en el editor GAS.
 *
 * ============================================================================
 * NOTAS IMPORTANTES:
 * ============================================================================
 * - Health Connect debe enviar datos crudos 1Hz en categorías separadas:
 *   * accelerometer / activity → accel (x, y, z @ 1Hz)
 *   * heart_rate → hr (bpm @ 1Hz o cada 5s)
 *   * heart_rate_variability → rr (intervalos RR en ms)
 * - Si Zepp/Amazfit no exporta acelerómetro crudo, el staging usará solo HR/HRV
 * - El webhook espera timestamps en ms (ts_ms) desde epoch UTC
 * - in_bed_start_s / in_bed_end_s en segundos (Unix timestamp UTC)
 * ============================================================================