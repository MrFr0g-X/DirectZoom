// Appearance: dark, light or follow Windows. Stored per user in localStorage and applied as
// <html data-theme="dark|light">; native dialogs follow through Electron's nativeTheme.
export type ThemePreference = 'system' | 'dark' | 'light';

const KEY = 'directzoom.theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

export function themePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(KEY);
    if (value === 'dark' || value === 'light' || value === 'system') return value;
  } catch {}
  return 'dark';
}

function apply(preference: ThemePreference) {
  const resolved = preference === 'system' ? (media().matches ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = resolved;
}

export function setThemePreference(preference: ThemePreference) {
  try { localStorage.setItem(KEY, preference); } catch {}
  apply(preference);
  window.dz?.setTheme?.(preference).catch(() => {});
  window.dispatchEvent(new Event('dz-theme'));
}

/** Applies the saved theme and keeps "system" in step with Windows. Call once at startup. */
export function initTheme() {
  apply(themePreference());
  window.dz?.setTheme?.(themePreference()).catch(() => {});
  media().addEventListener('change', () => { if (themePreference() === 'system') apply('system'); });
  // Other windows (recording bar, camera preview) pick up changes made in the main window.
  window.addEventListener('storage', event => { if (event.key === KEY) apply(themePreference()); });
}
