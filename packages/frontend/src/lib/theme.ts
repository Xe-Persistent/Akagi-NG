import type { Theme } from '@/types';

/** Where the renderer keeps the theme; the inline script in `index.html` reads it too. */
export const THEME_STORAGE_KEY = 'theme';

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** A hand-edited or stale value falls back to following the system. */
export function readStoredTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return isTheme(stored) ? stored : 'system';
}
