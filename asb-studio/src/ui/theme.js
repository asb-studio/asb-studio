/* ==========================================================================
   ui/theme.js
   --------------------------------------------------------------------------
   Day and night. The theme is a single attribute on <html>; every colour in
   the studio is a CSS variable, so nothing else in the codebase has to know
   which theme is running.

   First visit follows the operating system. After that the author's own
   choice wins and is remembered.
   ========================================================================== */

const STORAGE_KEY = 'asb-studio:theme';
/* Order matters: the theme button steps through this list. */
export const THEMES = [
  { id: 'paper', label: 'کاغذ' },
  { id: 'white', label: 'سفید' },
  { id: 'grey', label: 'خاکستری' },
  { id: 'dark', label: 'شب' },
];

const IDS = THEMES.map((t) => t.id);

function systemPreference() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'paper';
}

function read() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return IDS.includes(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function getTheme() {
  return document.documentElement.getAttribute('data-theme') || 'paper';
}

export function getThemeLabel() {
  const found = THEMES.find((t) => t.id === getTheme());
  return found ? found.label : 'کاغذ';
}

export function setTheme(theme) {
  const next = IDS.includes(theme) ? theme : 'paper';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* private mode */ }
  return next;
}

/** Steps to the next theme in THEMES order and returns it. */
export function nextTheme() {
  const index = IDS.indexOf(getTheme());
  return setTheme(IDS[(index + 1) % IDS.length]);
}

/** Applies the stored or system theme. Call once, as early as possible. */
export function initTheme() {
  const theme = read() || systemPreference();
  document.documentElement.setAttribute('data-theme', theme);

  // Follow the system only while the author has not chosen for themselves.
  if (!read() && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
      if (!read()) document.documentElement.setAttribute('data-theme', event.matches ? 'dark' : 'paper');
    });
  }

  return theme;
}
