/**
 * ARGON v6.0 — Configuration Management
 * Single source of truth for runtime config (localStorage + config.js fallback).
 * Import from: import { config, loadConfig, saveConfig } from '@/config';
 */

import { ProfileSchema, type Profile } from '@/api/schemas';
import { DEFAULTS, STORAGE_KEYS } from '@/constants';

// Global window.CONFIG declaration for backward compatibility
declare global {
  interface Window {
    CONFIG: {
      profile?: Partial<Profile>;
      supabase?: { url: string; anonKey: string };
      webappUrl?: string;
      userId?: string;
      defaults?: Partial<Profile>;
    };
  }
}

// Save original window.CONFIG from config.js BEFORE creating the Proxy
// This must be done at module load time, before any Proxy is created
let originalConfigJs: {
  profile?: Partial<Profile>;
  supabase?: { url: string; anonKey: string };
  webappUrl?: string;
  userId?: string;
  defaults?: Partial<Profile>;
} | undefined;

if (typeof window !== 'undefined') {
  originalConfigJs = window.CONFIG;
}

// ============================================================
// RUNTIME CONFIG STATE
// ============================================================
interface RuntimeConfig {
  profile: Profile;
  supabase: { url: string; anonKey: string };
  webappUrl: string;
  userId: string;
  theme: 'light' | 'dark' | 'system';
  onboardingDone: boolean;
}

let _config: RuntimeConfig | null = null;
let _configLoaded = false;

// ============================================================
// LOAD / SAVE
// ============================================================

/** Load config from localStorage + config.js fallback */
export function loadConfig(): RuntimeConfig {
  if (_configLoaded && _config) return _config;

  // 1. Try localStorage first (user-edited via Settings)
  const lsProfile = loadProfileFromLS();
  const lsSupabase = loadSupabaseFromLS();
  const lsWebappUrl = localStorage.getItem(STORAGE_KEYS.WEBAPP_URL) || '';
  const lsUserId = localStorage.getItem(STORAGE_KEYS.USER_ID) || '';
  const lsTheme = (localStorage.getItem(STORAGE_KEYS.THEME) as 'light' | 'dark' | 'system') || 'system';
  const lsOnboarding = localStorage.getItem(STORAGE_KEYS.ONBOARDING_DONE) === 'true';

  // 2. Fallback to original config.js (saved before Proxy creation)
  const wc = originalConfigJs;

  // 3. Merge with DEFAULTS as last resort
  const profile: Profile = ProfileSchema.parse({
    ...DEFAULTS,
    ...wc?.defaults,
    ...wc?.profile,
    ...lsProfile,
  });

  _config = {
    profile,
    supabase: {
      url: lsSupabase.url || wc?.supabase?.url || '',
      anonKey: lsSupabase.key || wc?.supabase?.anonKey || '',
    },
    webappUrl: lsWebappUrl || wc?.webappUrl || '',
    userId: lsUserId || wc?.userId || '',
    theme: lsTheme,
    onboardingDone: lsOnboarding,
  };

  _configLoaded = true;
  return _config;
}

/** Get current config (loads if needed) */
export function getConfig(): RuntimeConfig {
  return _configLoaded && _config ? _config : loadConfig();
}

/** Save profile to localStorage */
export function saveProfile(profile: Partial<Profile>): void {
  const current = getConfig();
  const merged = { ...current.profile, ...profile };
  const validated = ProfileSchema.parse(merged);
  current.profile = validated;
  localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(validated));
  _config = current;
}

/** Save Supabase credentials */
export function saveSupabase(url: string, anonKey: string): void {
  const current = getConfig();
  current.supabase = { url: url.trim(), anonKey: anonKey.trim() };
  localStorage.setItem(STORAGE_KEYS.SB_URL, current.supabase.url);
  localStorage.setItem(STORAGE_KEYS.SB_KEY, current.supabase.anonKey);
  _config = current;
  // Reset Supabase client so it picks up new credentials
  import('@/api/client').then(m => m.resetClient?.());
}

/** Save webapp URL */
export function saveWebappUrl(url: string): void {
  const current = getConfig();
  current.webappUrl = url.trim();
  localStorage.setItem(STORAGE_KEYS.WEBAPP_URL, current.webappUrl);
  _config = current;
}

/** Save user ID */
export function saveUserId(userId: string): void {
  const current = getConfig();
  current.userId = userId.trim();
  localStorage.setItem(STORAGE_KEYS.USER_ID, current.userId);
  _config = current;
}

/** Save theme */
export function saveTheme(theme: 'light' | 'dark' | 'system'): void {
  const current = getConfig();
  current.theme = theme;
  localStorage.setItem(STORAGE_KEYS.THEME, theme);
  _config = current;
  applyTheme(theme);
}

/** Mark onboarding complete */
export function completeOnboarding(): void {
  const current = getConfig();
  current.onboardingDone = true;
  localStorage.setItem(STORAGE_KEYS.ONBOARDING_DONE, 'true');
  _config = current;
}

// ============================================================
// HELPERS
// ============================================================

function loadProfileFromLS(): Partial<Profile> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CONFIG);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function loadSupabaseFromLS(): { url: string; key: string } {
  return {
    url: localStorage.getItem(STORAGE_KEYS.SB_URL) || '',
    key: localStorage.getItem(STORAGE_KEYS.SB_KEY) || '',
  };
}

/** Apply theme to document */
export function applyTheme(theme: 'light' | 'dark' | 'system'): void {
  const root = document.documentElement;
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.toggle('dark', prefersDark);
  } else {
    root.classList.toggle('dark', theme === 'dark');
  }
}

/** Initialize theme on app start */
export function initTheme(): void {
  const { theme } = getConfig();
  applyTheme(theme);
}

/** Reset config (logout) */
export function resetConfig(): void {
  _config = null;
  _configLoaded = false;
  // Don't clear localStorage - user may want to keep credentials
}

// ============================================================
// CONVENIENCE GETTERS
// ============================================================

export const config = {
  get profile() { return getConfig().profile; },
  get supabase() { return getConfig().supabase; },
  get webappUrl() { return getConfig().webappUrl; },
  get userId() { return getConfig().userId; },
  get theme() { return getConfig().theme; },
  get onboardingDone() { return getConfig().onboardingDone; },

  // Timezone from profile
  get timezone() { return getConfig().profile.timezone; },

  // Computed targets (from profile + server)
  get targets() {
    const p = getConfig().profile;
    return {
      kcal: p.targetKcal ?? 2200,
      protein: p.targetProteinG ?? 150,
      carbs: p.targetCarbsG ?? 200,
      fat: p.targetFatG ?? 73,
    };
  },
};

// Backward compatibility: window.CONFIG proxy
if (typeof window !== 'undefined') {
  window.CONFIG = new Proxy({} as any, {
    get(_, prop) {
      const c = getConfig();
      if (prop === 'profile') return c.profile;
      if (prop === 'supabase') return c.supabase;
      if (prop === 'webappUrl') return c.webappUrl;
      if (prop === 'userId') return c.userId;
      if (prop === 'defaults') return originalConfigJs?.defaults ?? DEFAULTS;
      return c.profile[prop as keyof Profile];
    },
    set(_, prop, value) {
      const c = getConfig();
      if (prop === 'profile') return false;
      if (prop === 'supabase') return false;
      if (prop in c.profile) {
        saveProfile({ [prop]: value } as Partial<Profile>);
        return true;
      }
      return false;
    },
  });
}