// ============================================================================
// ARGON v6.0 — CONFIGURACIÓN DEMO (para deploy en GitHub Pages)
// ============================================================================
// ESTE ARCHIVO SE DEPLOYA A PAGES — SIN SECRETOS REALES
// Usuario real: copia config.template.js a config.js local y edita con TUS claves
// ============================================================================

window.CONFIG = {
  // ---------------------------------------------------------------------------
  // SUPABASE (configura el tuyo en supabase.com → Settings → API)
  // ---------------------------------------------------------------------------
  supabase: {
    // URL de tu proyecto: https://TU_PROJECT_ID.supabase.co
    url: 'https://demo.supabase.co',

    // Clave anon/pública (segura en cliente): Settings → API → anon public
    anonKey: 'demo-anon-key-replace-with-real',
  },

  // ---------------------------------------------------------------------------
  // GOOGLE APPS SCRIPT (backend de cálculo)
  // ---------------------------------------------------------------------------
  gas: {
    // URL del webhook desplegado: Deploy → New deployment → Web app → URL
    // Formato: https://script.google.com/macros/s/TU_SCRIPT_ID/exec
    webhookUrl: '',
  },

  // ---------------------------------------------------------------------------
  // PERFIL DE USUARIO (valores demo genéricos)
  // ---------------------------------------------------------------------------
  profile: {
    // Zona horaria IANA (ej: 'America/Caracas', 'Europe/Madrid', 'America/New_York')
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
  // DEFAULTS DE SENSORES (fallback si no hay datos en Supabase)
  // ---------------------------------------------------------------------------
  defaults: {
    // Peso inicial (kg) — usado solo en primera ejecución sin datos
    weightKg: 70,

    // % Grasa corporal inicial — usado solo en primera ejecución sin datos
    bodyFatPct: 20,
  },

  // ---------------------------------------------------------------------------
  // UI / PREFERENCIAS LOCALES
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