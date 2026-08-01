/* ==========================================================================
   commands/registry.js
   --------------------------------------------------------------------------
   Every action the studio can perform, defined exactly once.

   Two surfaces are BUILT FROM this list and neither contains any logic of its
   own:

     the menu bar   - every command, always reachable, at any window width
     the toolbar    - the frequent ones as icons, overflowing into a ⋮ button

   That split is what makes the studio survive a narrow screen. A single row
   of thirty tools fits a 1920 monitor and silently loses its right-hand third
   on a 1280 one, with no way to reach what fell off. A menu never does that.

   A command is:
     id       stable name
     label    Persian text, shown in menus and on labelled buttons
     tip      Persian tooltip for the toolbar, including any shortcut
     menu     which menu it belongs to
     group    which toolbar cluster it belongs to, or absent to stay in menus
     icon     inline SVG path data, or null for a text button
     key      keyboard shortcut, bound automatically
     checked  optional (ctx) => boolean, drawn as a tick in the menu
     run(ctx) what it does
   ========================================================================== */

import { MARKERS } from '../model/schema.js';

/* Icons are stroked 24x24 outlines drawn on one grid. */
const ICONS = {
  bold: 'M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z',
  italic: 'M15 5h-5M14 19H9M13 5l-3 14',
  strike: 'M16 6H10a2.5 2.5 0 0 0-1.6 4M13.5 12A3 3 0 0 1 14 18H7M4 12h16',
  code: 'M9 8l-4 4 4 4M15 8l4 4-4 4',
  quote: 'M8 7H5a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h2v1a2 2 0 0 1-2 2M18 7h-3a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h2v1a2 2 0 0 1-2 2',
  poem: 'M12 4v16M8 8l4-4 4 4M9 20h6',
  center: 'M4 6h16M7 12h10M4 18h16',
  noindent: 'M4 6h16M4 12h16M4 18h10',
  colour: 'M12 3l6 7a6 6 0 1 1-12 0z',
  link: 'M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1-1',
  image: 'M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6',
  table: 'M3 5h18v14H3zM3 10h18M9 10v9M15 10v9',
  footnote: 'M4 6h11M4 11h11M4 16h7M18 4v7M15 7h6',
  notes: 'M5 3h14v18l-7-4-7 4zM9 8h6M9 12h6',
  rule: 'M4 12h16',
  list: 'M8 6h13M8 12h13M8 18h13M4 6h.01M4 12h.01M4 18h.01',
  reader: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
  paywall: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  ids: 'M4 7h16M4 12h10M4 17h16M17 12h3',
  find: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-4',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h4',
  toc: 'M4 6h16M4 12h16M4 18h16M20 6v12',
  repair: 'M9.5 4.5a3.5 3.5 0 1 0 3 5.9l6.6 6.6a1.5 1.5 0 0 0 2.1-2.1l-6.6-6.6a3.5 3.5 0 0 0-5.1-3.8zM4 20l4-4',
  stats: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  publish: 'M12 3v12M8 7l4-4 4 4M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4',
  paper: 'M6 3h9l5 5v13H6zM15 3v5h5M9 13h6M9 17h6',
  book: 'M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2zM4 17h15M9 3v14',
  migrate: 'M4 7h9M4 7l3-3M4 7l3 3M20 17h-9M20 17l-3-3M20 17l-3 3',
  open: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  archive: 'M3 5h18v4H3zM5 9v10h14V9M9 13h6',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8',
  newdoc: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M12 12v6M9 15h6',
  close: 'M6 6l12 12M18 6L6 18',
  trackInsert: 'M12 5v14M5 12h14',
  trackDelete: 'M5 12h14',
  trackReplace: 'M4 8h10l-3-3M20 16H10l3 3',
  trackNote: 'M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z',
  review: 'M4 7l3 3 5-6M4 17l3 3 5-6M14 8h7M14 18h7',
  theme: 'M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4L7 17M17 7l1.4-1.4',
  keys: 'M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8',
  record: 'M8 3h8a2 2 0 0 1 2 2v16l-6-3-6 3V5a2 2 0 0 1 2-2zM9 8h6M9 12h4',
  layout: 'M3 6h18M3 6v12h18V6M9 18V6M15 18V6',
  tidy: 'M4 6h16M4 11h11M4 16h16M17 9l3 3-3 3',
};

export function iconSvg(name) {
  const path = ICONS[name];
  if (!path) return '';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
}

/* --------------------------------------------------------------------------
   Menus, in display order
   -------------------------------------------------------------------------- */
export const MENUS = [
  { id: 'file', label: 'پرونده' },
  { id: 'edit', label: 'ویرایش' },
  { id: 'insert', label: 'درج' },
  { id: 'format', label: 'قالب' },
  { id: 'track', label: 'بازبینی' },
  { id: 'tools', label: 'ابزار' },
  { id: 'view', label: 'نما' },
  { id: 'theme', label: 'پوسته' },
];

/* Toolbar clusters, in display order. Separated by a hairline. */
export const GROUPS = ['history', 'text', 'block', 'insert', 'review'];

/* --------------------------------------------------------------------------
   The commands
   -------------------------------------------------------------------------- */

export const COMMANDS = [
  /* --- file ------------------------------------------------------------- */
  { id: 'new', menu: 'file', label: 'سند تازه', icon: 'newdoc', key: 'Mod-Alt-n',
    run: (ctx) => ctx.newDocument() },
  { id: 'open', menu: 'file', label: 'باز کردن', icon: 'open', key: 'Mod-o',
    run: (ctx) => ctx.openDocument() },
  { id: 'archive', menu: 'file', label: 'مرور آرشیو', icon: 'archive',
    tip: 'دیدن وضعیت همه‌ی فایل‌های پوشه‌ی main',
    run: (ctx) => ctx.browseArchive() },
  { id: 'save', menu: 'file', label: 'ذخیره', icon: 'save', key: 'Mod-s',
    run: (ctx) => ctx.saveDocument() },
  { id: 'saveas', menu: 'file', label: 'ذخیره با نام', key: 'Mod-Shift-s',
    run: (ctx) => ctx.saveDocumentAs() },
  { id: 'closetab', menu: 'file', label: 'بستن سند', separatorBefore: true,
    run: (ctx) => ctx.closeDocument() },
  { id: 'epub', menu: 'file', label: 'ساختن کتاب EPUB', icon: 'book', separatorBefore: true,
    run: (ctx) => ctx.exportEpub() },

  /* --- edit ------------------------------------------------------------- */
  { id: 'undo', menu: 'edit', group: 'history', label: 'واگرد', icon: 'undo',
    tip: 'واگرد (Ctrl+Z)', run: (ctx) => ctx.editor.undo() },
  { id: 'redo', menu: 'edit', group: 'history', label: 'ازنو', icon: 'redo',
    tip: 'ازنو (Ctrl+Y)', run: (ctx) => ctx.editor.redo() },
  { id: 'find', menu: 'edit', group: 'review', label: 'جست‌وجو و جایگزینی', icon: 'find',
    tip: 'جست‌وجو و جایگزینی (Ctrl+F)', separatorBefore: true,
    run: (ctx) => ctx.editor.openSearch() },

  /* --- insert ----------------------------------------------------------- */
  { id: 'link', menu: 'insert', group: 'insert', label: 'پیوند', icon: 'link',
    tip: 'پیوند (Ctrl+K)', key: 'Mod-k', run: (ctx) => ctx.insertLink() },
  { id: 'image', menu: 'insert', group: 'insert', label: 'تصویر', icon: 'image',
    tip: 'تصویر', run: (ctx) => ctx.insertImage() },
  { id: 'table', menu: 'insert', group: 'insert', label: 'جدول', icon: 'table',
    tip: 'جدول‌ساز', run: (ctx) => ctx.insertTable() },
  { id: 'footnote', menu: 'insert', group: 'insert', label: 'پانویس', icon: 'footnote',
    tip: 'پانویس تازه', run: (ctx) => ctx.insertFootnote() },
  { id: 'rule', menu: 'insert', label: 'جداکننده', icon: 'rule', separatorBefore: true,
    tip: 'جداکننده', run: (ctx) => ctx.editor.insertBlock('***') },
  { id: 'ereader', menu: 'insert', label: 'نقطه‌ی شروع مطالعه', icon: 'reader',
    tip: 'بالای این نشانه مقدمه است، پایینش متن اثر',
    run: (ctx) => ctx.editor.insertBlock(MARKERS.ereader) },
  { id: 'paywall', menu: 'insert', label: 'دیوار پرداخت', icon: 'paywall',
    tip: 'اثر پولی بدون این، اصلاً منتشر نمی‌شود',
    run: (ctx) => ctx.editor.insertBlock(MARKERS.paywall) },
  { id: 'toc', menu: 'insert', label: 'فهرست مطالب', icon: 'toc', separatorBefore: true,
    tip: 'ساختن فهرست از روی عنوان‌ها', run: (ctx) => ctx.buildTableOfContents() },

  /* --- format ----------------------------------------------------------- */
  { id: 'bold', menu: 'format', group: 'text', label: 'ضخیم', icon: 'bold',
    tip: 'ضخیم (Ctrl+B)', key: 'Mod-b', run: (ctx) => ctx.editor.wrapSelection('**') },
  { id: 'italic', menu: 'format', group: 'text', label: 'کج', icon: 'italic',
    tip: 'کج (Ctrl+I)', key: 'Mod-i', run: (ctx) => ctx.editor.wrapSelection('*') },
  { id: 'strike', menu: 'format', group: 'text', label: 'خط‌خورده', icon: 'strike',
    tip: 'خط‌خورده', run: (ctx) => ctx.editor.wrapSelection('~~') },
  { id: 'code', menu: 'format', group: 'text', label: 'کد درون‌خطی', icon: 'code',
    tip: 'کد درون‌خطی', run: (ctx) => ctx.editor.wrapSelection('`') },

  { id: 'h1', menu: 'format', group: 'block', label: 'عنوان یک', textIcon: 'ع۱',
    tip: 'عنوان یک', separatorBefore: true, run: (ctx) => ctx.editor.setLinePrefix('# ') },
  { id: 'h2', menu: 'format', group: 'block', label: 'عنوان دو', textIcon: 'ع۲',
    tip: 'عنوان دو', run: (ctx) => ctx.editor.setLinePrefix('## ') },
  { id: 'h3', menu: 'format', group: 'block', label: 'عنوان سه', textIcon: 'ع۳',
    tip: 'عنوان سه', run: (ctx) => ctx.editor.setLinePrefix('### ') },
  { id: 'quote', menu: 'format', group: 'block', label: 'نقل‌قول', icon: 'quote',
    tip: 'نقل‌قول', run: (ctx) => ctx.editor.setLinePrefix('> ') },
  { id: 'list', menu: 'format', group: 'block', label: 'فهرست', icon: 'list',
    tip: 'فهرست', run: (ctx) => ctx.editor.setLinePrefix('- ') },

  { id: 'poem', menu: 'format', group: 'block', label: 'شعر', icon: 'poem',
    tip: 'شعر — خط‌ها خودشان حفظ می‌شوند', separatorBefore: true,
    run: (ctx) => ctx.editor.setBlockAttrs('.poem') },
  { id: 'center', menu: 'format', group: 'block', label: 'وسط‌چین', icon: 'center',
    tip: 'وسط‌چین', run: (ctx) => ctx.editor.setBlockAttrs('.text-center') },
  { id: 'noindent', menu: 'format', group: 'block', label: 'بدون تورفتگی', icon: 'noindent',
    tip: 'بدون تورفتگی', run: (ctx) => ctx.editor.setBlockAttrs('.no-indent') },
  { id: 'colour', menu: 'format', group: 'block', label: 'رنگ پاراگراف', icon: 'colour',
    tip: 'رنگ پاراگراف', run: (ctx) => ctx.setBlockColour() },

  /* --- tracked changes --------------------------------------------------- */
  { id: 'track-insert', menu: 'track', group: 'review', label: 'علامت افزودن', icon: 'trackInsert',
    tip: 'متن انتخابی را افزوده علامت بزن', run: (ctx) => ctx.editor.wrapSelection('{++', '++}') },
  { id: 'track-delete', menu: 'track', label: 'علامت حذف', icon: 'trackDelete',
    tip: 'متن انتخابی را حذف‌شده علامت بزن', run: (ctx) => ctx.editor.wrapSelection('{--', '--}') },
  { id: 'track-replace', menu: 'track', label: 'علامت جایگزینی', icon: 'trackReplace',
    tip: 'متن انتخابی جای خودش می‌ماند و جایگزینش را می‌نویسی',
    run: (ctx) => ctx.trackReplace() },
  { id: 'track-note', menu: 'track', label: 'یادداشت برای نویسنده', icon: 'trackNote',
    tip: 'یادداشتی که در متن نهایی نمی‌ماند', run: (ctx) => ctx.trackNote() },
  { id: 'review', menu: 'track', group: 'review', label: 'پانل تغییرات', icon: 'review',
    tip: 'دیدن و پذیرفتن یا رد کردن تغییرها (Ctrl+Shift+R)', separatorBefore: true,
    run: (ctx) => ctx.toggleReviewPanel() },

  /* --- tools ------------------------------------------------------------- */
  { id: 'ids', menu: 'tools', group: 'review', label: 'شناسه‌ی پاراگراف‌ها', icon: 'ids',
    tip: 'دادن شناسه‌ی دائمی به پاراگراف‌های بی‌شناسه', run: (ctx) => ctx.assignIds() },
  { id: 'repair', menu: 'tools', label: 'تعمیر خودکار', icon: 'repair',
    tip: 'تعمیر ایرادهای قابل‌تعمیر', run: (ctx) => ctx.repairAll() },
  { id: 'migrate', menu: 'tools', label: 'تبدیل فایل قدیمی', icon: 'migrate',
    tip: 'تبدیل HTML دست‌ساز به مارک‌دان', run: (ctx) => ctx.migrateLegacy() },
  { id: 'footnote-panel', menu: 'tools', label: 'پانل پانویس‌ها', icon: 'notes',
    tip: 'پانل پانویس‌ها (Ctrl+Shift+F)', separatorBefore: true,
    run: (ctx) => ctx.toggleFootnotePanel() },
  { id: 'stats', menu: 'tools', label: 'آمار این متن', icon: 'stats',
    tip: 'طول جمله، پاراگراف بلند، تکرار کلمه', run: (ctx) => ctx.showStats() },
  { id: 'usage', menu: 'tools', label: 'کارنامه‌ی کار', icon: 'record',
    tip: 'کارنامه‌ی کار تو در این مرورگر', run: (ctx) => ctx.showUsage() },
  { id: 'tidy-frontmatter', menu: 'tools', label: 'مرتب کردن شناسنامه', icon: 'tidy',
    tip: 'همه‌ی فیلدها، به ترتیب ثابت', separatorBefore: true,
    run: (ctx) => ctx.tidyFrontmatter() },

  /* --- view -------------------------------------------------------------- */
  { id: 'publish', menu: 'view', group: 'review', label: 'شناسنامه و انتشار', icon: 'publish',
    tip: 'شناسنامه و بررسی نهایی (Ctrl+Shift+P)', run: (ctx) => ctx.openPanel() },
  { id: 'view-split', menu: 'view', label: 'دو ستونی', separatorBefore: true,
    checked: (ctx) => ctx.currentView() === 'split', run: (ctx) => ctx.setView('split') },
  { id: 'view-source', menu: 'view', label: 'فقط متن',
    checked: (ctx) => ctx.currentView() === 'source', run: (ctx) => ctx.setView('source') },
  { id: 'view-preview', menu: 'view', label: 'فقط پیش‌نمایش',
    checked: (ctx) => ctx.currentView() === 'preview', run: (ctx) => ctx.setView('preview') },
  { id: 'paper', menu: 'view', label: 'نمای کاغذ', icon: 'paper', separatorBefore: true,
    checked: (ctx) => ctx.paperViewOn(), tip: 'پیش‌نمایش به اندازه‌ی واقعی صفحه',
    run: (ctx) => ctx.togglePaperView() },
  /* Each theme is its own command in its own menu. A submenu inside a
     dropdown was fiddly to reach and, right to left, opened the wrong way. */
  { id: 'theme-paper', menu: 'theme', label: 'کاغذ',
    checked: (ctx) => ctx.currentTheme() === 'paper', run: (ctx) => ctx.pickTheme('paper') },
  { id: 'theme-white', menu: 'theme', label: 'سفید',
    checked: (ctx) => ctx.currentTheme() === 'white', run: (ctx) => ctx.pickTheme('white') },
  { id: 'theme-grey', menu: 'theme', label: 'خاکستری',
    checked: (ctx) => ctx.currentTheme() === 'grey', run: (ctx) => ctx.pickTheme('grey') },
  { id: 'theme-dark', menu: 'theme', label: 'شب',
    checked: (ctx) => ctx.currentTheme() === 'dark', run: (ctx) => ctx.pickTheme('dark') },
  { id: 'toolbar-config', menu: 'view', label: 'چیدمان نوار ابزار', icon: 'layout',
    separatorBefore: true, tip: 'انتخاب ابزارهای نوار',
    run: (ctx) => ctx.configureToolbar() },
  { id: 'keys', menu: 'view', label: 'کلیدهای میان‌بر', icon: 'keys', separatorBefore: true,
    tip: 'کلیدهای میان‌بر (F1)', run: (ctx) => ctx.showShortcuts() },
];

const BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));

export function getCommand(id) { return BY_ID.get(id); }

export function commandsInMenu(menuId) {
  return COMMANDS.filter((c) => c.menu === menuId);
}

export function commandsInGroup(groupId) {
  return COMMANDS.filter((c) => c.group === groupId);
}

export function runCommand(id, ctx) {
  const command = BY_ID.get(id);
  if (!command) throw new Error(`Unknown command: ${id}`);
  return command.run(ctx);
}
