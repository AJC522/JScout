/**
 * The local mirror of AppSettings.theme. public/theme-init.js reads the same key before
 * React loads (to avoid a flash of the wrong theme), so the key and values must match it.
 */
import type { ThemePreference } from '../../shared/types';

export const THEME_STORAGE_KEY = 'jscout.theme';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function readStoredTheme(): ThemePreference | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(value) ? value : null;
  } catch {
    return null;
  }
}

export function storeTheme(theme: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private mode or quota: the server copy still applies on the next load, just after a brief flash.
  }
}

/** Sets the attribute styles.css keys the palette on. */
export function applyTheme(theme: ThemePreference): void {
  document.documentElement.setAttribute('data-theme', theme);
}
