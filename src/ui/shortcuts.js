/* ==========================================================================
   ui/shortcuts.js
   --------------------------------------------------------------------------
   The keyboard reference card.

   Half of it is generated from commands/registry.js, so a command that gains
   a shortcut appears here on its own. The other half lists the keys that
   belong to CodeMirror or to the file layer rather than to a command, and
   those are written out by hand because nothing else knows about them.
   ========================================================================== */

import { COMMANDS } from '../commands/registry.js';

/* Shortcuts that live outside the command registry. */
const EXTRA = [
  { section: 'فایل و سندها', items: [
    ['Ctrl + O', 'باز کردن فایل'],
    ['Ctrl + S', 'ذخیره روی همان فایل'],
    ['Ctrl + Shift + S', 'ذخیره با نام تازه'],
    ['Ctrl + Alt + W', 'بستن سند'],
    ['Ctrl + Alt + ← / →', 'سند بعدی و قبلی'],
    ['Ctrl + Alt + ۱ تا ۹', 'رفتن مستقیم به سند'],
  ]},
  { section: 'جست‌وجو', items: [
    ['Ctrl + F', 'جست‌وجو'],
    ['Ctrl + H', 'جست‌وجو و جایگزینی'],
    ['Enter', 'مورد بعدی — فقط داخل نوار جست‌وجو'],
    ['Shift + Enter', 'مورد قبلی — فقط داخل نوار جست‌وجو'],
    ['Esc', 'بستن نوار جست‌وجو'],
  ]},
  { section: 'ویرایش متن', items: [
    ['Enter', 'خط تازه. دو بار یعنی پاراگراف تازه'],
    ['Ctrl + Z', 'واگرد'],
    ['Ctrl + Y', 'ازنو'],
    ['Ctrl + A', 'انتخاب همه'],
    ['Alt + ↑ / ↓', 'جابه‌جا کردن همین خط به بالا و پایین'],
    ['Alt + کلیک', 'مکان‌نمای دوم — چند جا با هم تایپ کن'],
    ['Home / End', 'ابتدا و انتهای خط'],
    ['Shift + Home / End', 'انتخاب تا ابتدا یا انتهای خط'],
  ]},
  { section: 'پنل‌ها', items: [
    ['Ctrl + Shift + D', 'شناسنامه و انتشار'],
    ['Ctrl + Shift + F', 'پانویس‌ها'],
    ['Ctrl + Shift + R', 'تغییرهای ردیابی‌شده'],
    ['Ctrl + Shift + E', 'روشن/خاموش کردن ردیاب'],
    ['F1', 'همین راهنما'],
    ['Esc', 'بستن پنجره‌ها'],
  ]},
];

const KEY_LABELS = {
  'Mod-b': 'Ctrl + B', 'Mod-i': 'Ctrl + I', 'Mod-k': 'Ctrl + K', 'Mod-f': 'Ctrl + F',
};

/* Keys already spelled out in EXTRA, so the generated list does not repeat
   them under a second heading. */
const LISTED_ELSEWHERE = new Set(['Mod-o', 'Mod-s', 'Mod-Shift-s', 'Mod-Alt-n', 'Mod-Shift-e', 'Mod-f']);

let dialog = null;

function build() {
  const el = document.createElement('div');
  el.className = 'overlay';
  el.id = 'shortcuts';
  el.hidden = true;

  const fromRegistry = COMMANDS
    .filter((c) => c.key && !LISTED_ELSEWHERE.has(c.key))
    .map((c) => [KEY_LABELS[c.key] || c.key, (c.tip || c.label || c.id).replace(/\s*\([^)]*\)\s*$/, '')]);

  const sections = [
    ...EXTRA.slice(0, 1),
    { section: 'قالب', items: fromRegistry },
    ...EXTRA.slice(1),
  ];

  el.innerHTML = `
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
      <header class="dialog__head">
        <h2 id="shortcuts-title">کلیدهای میان‌بر</h2>
        <button class="btn btn--quiet" data-close>بستن</button>
      </header>
      <div class="dialog__body keys">
        ${sections.map((group) => `
          <section class="keys__group">
            <h3>${group.section}</h3>
            <dl>
              ${group.items.map(([key, what]) => `
                <div class="keys__row">
                  <dt><kbd>${key}</kbd></dt>
                  <dd>${what}</dd>
                </div>`).join('')}
            </dl>
          </section>`).join('')}
      </div>
      <footer class="dialog__actions" style="display:block">
        بقیه‌ی ابزارها میان‌بر ندارند و از منوها در دسترس‌اند.
        <br>
        میان‌برها با <b>دکمه‌ی فیزیکی</b> کار می‌کنند، پس با صفحه‌کلید فارسی هم درست‌اند.
      </footer>
    </div>`;

  el.addEventListener('click', (event) => {
    // Clicking the backdrop, or the close button, dismisses the card.
    if (event.target === el || event.target.hasAttribute('data-close')) close();
  });

  document.body.appendChild(el);
  return el;
}

export function open() {
  if (!dialog) dialog = build();
  dialog.hidden = false;
  dialog.querySelector('[data-close]').focus();
}

export function close() {
  if (dialog) dialog.hidden = true;
}

export function toggle() {
  if (!dialog || dialog.hidden) open(); else close();
}

export function isOpen() {
  return Boolean(dialog) && !dialog.hidden;
}
