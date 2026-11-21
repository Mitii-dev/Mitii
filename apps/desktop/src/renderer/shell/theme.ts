/** Desktop light/dark theme preference (persisted). */

export type DesktopTheme = 'light' | 'dark';

const STORAGE_KEY = 'mitii.desktop.theme';

export function readStoredTheme(): DesktopTheme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* ignore */
  }
  return null;
}

export function systemTheme(): DesktopTheme {
  if (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark';
  }
  return 'light';
}

export function resolveTheme(stored: DesktopTheme | null = readStoredTheme()): DesktopTheme {
  return stored ?? systemTheme();
}

export function applyTheme(theme: DesktopTheme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function persistTheme(theme: DesktopTheme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
  applyTheme(theme);
}

/** Call before React mounts so first paint matches preference. */
export function initTheme(): DesktopTheme {
  const theme = resolveTheme();
  applyTheme(theme);
  return theme;
}
