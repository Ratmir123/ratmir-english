// No 'use client': the root layout (a server component) imports THEME_BOOT_SCRIPT as a plain string.
/** Appearance chosen on this device: follow the system or force light/dark (`:root[data-theme]` overrides the media query). */
export type ThemePreference = 'system' | 'light' | 'dark';
export const THEME_STORAGE_KEY = 'smooth-talk-theme';
export const THEME_LABEL: Record<ThemePreference, string> = { system: 'Как в системе', light: 'Светлая', dark: 'Тёмная' };

const valid = (value: unknown): value is ThemePreference => value === 'system' || value === 'light' || value === 'dark';

export function readThemePreference(): ThemePreference {
  try { const value = window.localStorage.getItem(THEME_STORAGE_KEY); return valid(value) ? value : 'system'; } catch { return 'system'; }
}

export function applyThemePreference(value: ThemePreference) {
  const root = document.documentElement;
  if (value === 'system') delete root.dataset.theme; else root.dataset.theme = value;
  // Desktop shell: the native title bar follows too (older shells have no bridge method; ignore failures).
  window.ratmirDesktop?.setTheme?.(value)?.catch(() => undefined);
}

export function saveThemePreference(value: ThemePreference) {
  applyThemePreference(value);
  try { if (value === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY); else window.localStorage.setItem(THEME_STORAGE_KEY, value); } catch { /* private mode: still applied for this session */ }
}

/** Keeps every window of the app (main + quick coach) in step when the choice changes in another one. */
export function followThemeChanges(onChange: (value: ThemePreference) => void): () => void {
  const listener = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    const value = readThemePreference();
    applyThemePreference(value); onChange(value);
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}

/** Runs in <head> before the first paint, so a forced theme never flashes the system one. */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;
