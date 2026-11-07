// ============================================================================
// ARGON v6.0 — CONFIGURACIÓN DE USUARIO
// ============================================================================
// INSTRUCCIONES:
// 1. Copia este archivo a config.js (gitignored)
// 2. Edita config.js con TUS datos
// 3. NO comitees config.js — solo config.template.js
// ============================================================================

/** @type {import('./config.types').ArgonConfig} */
export const CONFIG = {
  // ---------------------------------------------------------------------------
  // SUPABASE (crea tu proyecto en supabase.com → Settings → API)
  // ---------------------------------------------------------------------------
  supabase: {
    // URL de tu proyecto: https://TU_PROJECT_ID.supabase.co
    url: 'https://TU_PROJECT_ID.supabase.co',

    // Clave anon/pública (segura en cliente): Settings → API → anon public
    anonKey: 'TU_ANON_KEY_AQUI',
  },

  // ---------------------------------------------------------------------------
  // GOOGLE APPS SCRIPT (backend de cálculo)
  // ---------------------------------------------------------------------------
  gas: {
    // URL del webhook desplegado: Deploy → New deployment → Web app → URL
    // Formato: https://script.google.com/macros/s/TU_SCRIPT_ID/exec
    webhookUrl: 'https://script.google.com/macros/s/TU_SCRIPT_ID/exec',
  },

  // ---------------------------------------------------------------------------
  // PERFIL DE USUARIO (edita con tus datos reales)
  // ---------------------------------------------------------------------------
  profile: {
    // Zona horaria IANA (ej: 'America/Caracas', 'Europe/Madrid', 'America/New_York')
    // Ver lista: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
    timezone: 'America/Caracas',

    // Fecha de nacimiento ISO (YYYY-MM-DD)
    birthDate: '1990-01-01',

    // Altura en metros
    heightM: 1.75,

    // Necesidad basal de sueño en horas (7-9 típico)
    basalSleepNeedH: 7.5,

    // Hora habitual de despertar (HH:MM, 24h)
    habitualWake: '06:30',

    // Peso objetivo en kg
    goalWeightKg: 75,

    // Fecha objetivo (YYYY-MM-DD)
    goalDate: '2026-12-31',

    // Déficit calórico diario objetivo (kcal)
    dailyDeficitKcal: 500,

    // Sexo biológico para fórmulas: 'M' | 'F'
    biologicalSex: 'M',
  },

  // ---------------------------------------------------------------------------
  // DEFAULTS DE SENSORES (no tocar salvo que sepas lo que haces)
  // Se usan como fallback si no hay datos previos en Supabase
  // ---------------------------------------------------------------------------
  defaults: {
    // Peso inicial (kg) — usado solo en primera ejecución sin datos
    weightKg: 70,

    // % Grasa corporal inicial — usado solo en primera ejecución sin datos
    bodyFatPct: 20,
  },

  // ---------------------------------------------------------------------------
  // UI / PREFERENCIAS LOCALES (opcional, se guardan en localStorage)
  // ---------------------------------------------------------------------------
  ui: {
    // Meta diaria de pasos
    stepsGoal: 8000,

    // Color de acento: 'cyan' | 'emerald' | 'amber' | 'rose' | 'violet'
    accentColor: 'cyan',

    // Mostrar test de longevidad en drawer
    showLongevityTest: true,
  },
};