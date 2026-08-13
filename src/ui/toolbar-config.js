/* ==========================================================================
   ui/toolbar-config.js
   --------------------------------------------------------------------------
   Which tools sit on the toolbar.

   Everything is always reachable from the menus, so the toolbar is a matter
   of habit rather than of access - and one person's habit is not another's. A
   translator reaches for footnotes twenty times an hour; an editor reaches for
   the review panel. Neither should have to hunt past the other's tools.

   The choice is kept in this browser's storage, so it follows the person and
   not the file.
   ========================================================================== */

import { COMMANDS } from '../commands/registry.js';
import * as dialog from './dialog.js';

const KEY = 'asb-studio:toolbar';

/* The starting set. Chosen for the work this studio is actually used for:
   writing, marking up, footnoting and getting a file ready to publish. */
export const DEFAULT_TOOLS = [
  'undo', 'redo',
  'bold', 'italic', 'strike', 'code',
  'h1', 'h2', 'h3', 'quote', 'list',
  'poem', 'center', 'noindent', 'colour',
  'link', 'image', 'table', 'footnote',
  'ereader', 'paywall',
  'excerpt',
  'find', 'ids', 'review', 'publish',
];

/* Every command that could sit on a toolbar - it needs a picture to sit in. */
export function availableTools() {
  return COMMANDS.filter((c) => c.icon || c.textIcon);
}

export function loadTools() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [...DEFAULT_TOOLS];

    const saved = JSON.parse(raw);
    if (!Array.isArray(saved) || saved.length === 0) return [...DEFAULT_TOOLS];

    // Drop ids that no longer exist, so an old saved list cannot break the bar.
    const known = new Set(availableTools().map((c) => c.id));
    return saved.filter((id) => known.has(id));
  } catch {
    return [...DEFAULT_TOOLS];
  }
}

export function saveTools(ids) {
  try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* private mode */ }
}

export function resetTools() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to do */ }
  return [...DEFAULT_TOOLS];
}

/* --------------------------------------------------------------------------
   The chooser
   -------------------------------------------------------------------------- */

const MENU_TITLES = {
  file: 'پرونده', edit: 'ویرایش', insert: 'درج',
  format: 'قالب', track: 'بازبینی', tools: 'ابزار', view: 'نما', theme: 'پوسته',
};

/**
 * Opens the chooser.
 * @returns {Promise<string[]|null>} the new list, or null if cancelled
 */
export async function openToolbarConfig() {
  const chosen = new Set(loadTools());

  const root = document.createElement('div');

  const note = document.createElement('p');
  note.className = 'dialog__text';
  note.textContent = 'هر ابزاری که تیک بخورد در نوار ابزار می‌آید. هرچه جا نشود، زیر دکمه‌ی ⋮ می‌رود. همه‌شان در منوها هم هستند.';
  root.appendChild(note);

  const byMenu = new Map();
  for (const command of availableTools()) {
    if (!byMenu.has(command.menu)) byMenu.set(command.menu, []);
    byMenu.get(command.menu).push(command);
  }

  for (const [menu, commands] of byMenu) {
    const section = document.createElement('section');
    section.className = 'stats__section';

    const title = document.createElement('h3');
    title.textContent = MENU_TITLES[menu] || menu;
    section.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'tool-grid';

    for (const command of commands) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'tool-toggle';
      item.setAttribute('aria-pressed', String(chosen.has(command.id)));
      item.textContent = command.label || command.id;
      item.addEventListener('click', () => {
        if (chosen.has(command.id)) chosen.delete(command.id);
        else chosen.add(command.id);
        item.setAttribute('aria-pressed', String(chosen.has(command.id)));
      });
      grid.appendChild(item);
    }

    section.appendChild(grid);
    root.appendChild(section);
  }

  const result = await dialog.custom('چیدمان نوار ابزار', root, [
    { label: 'بازگشت به پیش‌فرض', value: 'reset' },
    { label: 'انصراف', value: null, cancel: true },
    { label: 'اعمال', value: 'ok', primary: true },
  ], { wide: true });

  if (result === 'reset') return resetTools();
  if (result !== 'ok') return null;

  // Kept in registry order, not click order, so the bar always reads the same.
  const ids = availableTools().map((c) => c.id).filter((id) => chosen.has(id));
  saveTools(ids);
  return ids;
}
