/* ==========================================================================
   main.js
   --------------------------------------------------------------------------
   The wiring layer. This file knows about every other module, and no other
   module knows about this one. That is why it exists: everything below it
   stays independently testable.

       disk .md -> session tab -> frontmatter -> publish panel
                               -> body        -> editor buffer
                                                   |
                                                   +-> renderPreview
                                                   +-> lintDocument
                                                   +-> readFootnotes
                                                   +-> serialize -> disk .md

   The editor holds the body of whichever tab is active. The frontmatter
   travels beside it in the document object and is written back untouched,
   which is what keeps fields like summary, price and roles from being lost.
   ========================================================================== */

import { Session } from './model/session.js';
import { hasEmbeddedFrontmatter, liftEmbeddedFrontmatter } from './model/document.js';
import { assignParagraphIds, countMissingIds } from './model/paragraph-ids.js';
import { validateAll } from './model/validate.js';
import { normalizeFrontmatter, previewNormalize } from './model/normalize.js';
import { BLOCK_COLOURS, loadCategories } from './model/schema.js';
import { measure } from './model/stats.js';
import { readFootnotes, nextFootnoteId } from './model/footnotes.js';
import { UsageTracker } from './model/usage.js';
import { renderPreview } from './markdown/preview.js';
import { lintDocument, SEVERITY } from './markdown/lint.js';
import { repairBody, repairOne, previewRepair } from './markdown/repair.js';
import { findChanges, resolveOne, resolveAll, countChanges } from './markdown/critic.js';
import { migrateBody, findRemainingHtml } from './markdown/migrate.js';
import { MarkdownEditor } from './editor/editor.js';
import { Sidebar } from './ui/sidebar.js';
import { Tabs } from './ui/tabs.js';
import { FootnotePanel } from './ui/footnotes.js';
import { SourcePanel } from './ui/sources.js';
import { Toolbar, bindShortcuts } from './ui/toolbar.js';
import { MenuBar } from './ui/menubar.js';
import { initTheme, nextTheme, setTheme, getTheme, getThemeLabel } from './ui/theme.js';
import { openTableBuilder } from './ui/table-builder.js';
import { openArchive } from './ui/archive.js';
import { openToolbarConfig } from './ui/toolbar-config.js';
import { initTooltips } from './ui/tooltip.js';
import { mountLogos } from './ui/logo.js';
import { buildEpub } from './export/epub.js';
import * as shortcuts from './ui/shortcuts.js';
import * as dialog from './ui/dialog.js';
import * as files from './storage/files.js';
import * as remote from './storage/supabase.js';
import { openAuth } from './ui/auth.js';
import { openWorkspace as showWorkspace, pushToWorkspace as sendToWorkspace } from './ui/workspace.js';
import { LOCK_REFRESH_MS } from './storage/config.js';

/* --------------------------------------------------------------------------
   Helpers
   -------------------------------------------------------------------------- */

const $ = (sel) => document.querySelector(sel);
const fa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2800);
}

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

const WELCOME = `
  <div class="welcome">
    <div class="welcome__mark" data-logo role="img" aria-label="نشان نشر اسب"></div>
    <div class="welcome__name">استودیوی اسب</div>
    <p class="welcome__hint">
      یک فایل <kbd>.md</kbd> را بکش و اینجا رها کن، یا <kbd>Ctrl + O</kbd> بزن.
      برای دیدن همه‌ی کلیدها <kbd>F1</kbd>.
    </p>
  </div>`;

/* --------------------------------------------------------------------------
   State
   -------------------------------------------------------------------------- */

const app = {
  session: new Session(),
  editor: null,
  sidebar: null,
  tabs: null,
  footnotes: null,
  sources: null,
  usage: new UsageTracker(),
  menubar: null,
  toolbar: null,
  view: 'split',
  user: null,       // the signed-in person, or null
  present: [],      // everyone else who is online right now
  lockTimer: null,  // keeps the workspace lock alive while a document is open
  switching: false,   // guards the editor's change event during a tab swap
  loadedId: null,     // the tab whose text is currently in the editor
};

const tab = () => app.session.active;

function markDirty(value) {
  const current = tab();
  if (current) current.dirty = value;
  app.tabs.render(app.session);
}

/* --------------------------------------------------------------------------
   Derived views
   -------------------------------------------------------------------------- */

function refresh() {
  const current = tab();
  const body = current ? app.editor.getText() : '';
  if (current) current.doc.setBody(body);

  const preview = $('#preview');
  const empty = body.trim() === '';
  preview.innerHTML = empty ? WELCOME : renderPreview(body);
  preview.parentElement.classList.toggle('is-empty', empty);
  if (empty) mountLogos(preview);

  renderIssues(current ? lintDocument(current.doc) : []);
  renderReadiness();
  if (app.footnotes) app.footnotes.render();
  if (app.sources) app.sources.render();
  renderReview();

  const tracked = countChanges(body);
  $('#btn-review').textContent = tracked ? `تغییرها (${fa(tracked)})` : 'تغییرها';

  const stats = measure(body);
  $('#wordcount').textContent = `${fa(stats.words)} کلمه`;

  const notes = readFootnotes(body);
  $('#btn-footnotes').textContent = notes.notes.length
    ? `پانویس‌ها (${fa(notes.notes.length)})`
    : 'پانویس‌ها';

  const missing = countMissingIds(body);
  $('#ids-status').textContent = missing
    ? `${fa(missing)} پاراگراف بی‌شناسه`
    : 'همه‌ی پاراگراف‌ها شناسه دارند';
  $('#ids-status').className = missing ? 'status--warn' : 'status--ok';

  $('#fm-count').textContent = current
    ? `${fa(current.doc.frontmatter.keys().length)} فیلد`
    : '۰ فیلد';
}

const refreshSoon = debounce(refresh, 190);

function renderIssues(issues) {
  const list = $('#issue-list');
  const errors = issues.filter((i) => i.severity === SEVERITY.ERROR).length;
  const warnings = issues.filter((i) => i.severity === SEVERITY.WARN).length;

  const badge = $('#lint-status');
  if (issues.length === 0) {
    badge.textContent = 'بدون ایراد';
    badge.className = 'status--ok';
  } else if (errors > 0) {
    badge.textContent = `${fa(errors)} خطا` + (warnings ? ` و ${fa(warnings)} هشدار` : '');
    badge.className = 'status--err';
  } else {
    badge.textContent = `${fa(warnings)} هشدار`;
    badge.className = 'status--warn';
  }
  $('#issue-count').textContent = fa(issues.length);

  list.innerHTML = '';
  if (issues.length === 0) {
    list.innerHTML = '<p class="issues__empty">این فایل تمیز است. همه‌چیزش در سایت درست رندر می‌شود.</p>';
    return;
  }
  for (const issue of issues) list.appendChild(issueRow(issue));
}

function issueRow(issue) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'issue issue--' + (issue.severity === SEVERITY.ERROR ? 'error' : 'warn');

  const top = document.createElement('div');
  top.className = 'issue__top';

  const tag = document.createElement('span');
  tag.className = 'issue__tag';
  tag.textContent = issue.severity === SEVERITY.ERROR ? 'خطا' : 'هشدار';

  const where = document.createElement('span');
  where.className = 'issue__where';
  where.textContent = issue.line ? `خط ${fa(issue.line)}` : 'شناسنامه';

  const rule = document.createElement('span');
  rule.className = 'issue__rule';
  rule.textContent = issue.rule;

  top.append(tag, where, rule);

  const message = document.createElement('div');
  message.className = 'issue__msg';
  message.textContent = issue.message;

  row.append(top, message);

  if (issue.excerpt) {
    const code = document.createElement('div');
    code.className = 'issue__code';
    code.innerHTML = '<b>الان این است:</b>';
    code.appendChild(document.createTextNode(issue.excerpt));
    row.appendChild(code);
  }
  if (issue.fix) {
    const code = document.createElement('div');
    code.className = 'issue__code issue__code--fix';
    code.innerHTML = '<b>باید این باشد:</b>';
    code.appendChild(document.createTextNode(issue.fix));
    row.appendChild(code);
  }

  /* A fix the studio can apply gets a button. Telling someone what is wrong
     and then making them go and do it by hand is only half an answer. */
  if (issue.fixable) {
    const actions = document.createElement('div');
    actions.className = 'issue__actions';

    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'btn btn--primary';
    apply.textContent = 'اصلاح کن';
    apply.addEventListener('click', (event) => {
      event.stopPropagation();
      applyOneFix(issue);
    });

    actions.appendChild(apply);
    row.appendChild(actions);
  }

  if (issue.line) {
    row.addEventListener('click', () => { app.editor.goToLine(issue.line); closeIssues(); });
  }
  return row;
}

/** Corrects one reported mistake, in place. Ctrl+Z takes it back. */
function applyOneFix(issue) {
  const current = tab();
  if (!current) return;

  // Frontmatter typed into the text is not a line-level mistake; it is handled
  // by lifting the whole block.
  if (issue.rule === 'frontmatter-in-body') {
    syncLoadedTab();
    const { moved, fields } = liftEmbeddedFrontmatter(current.doc);
    app.editor.setText(current.doc.body);
    app.sidebar.render(current.doc);
    markDirty(true);
    refresh();
    toast(moved ? `فرانت‌متر به شناسنامه منتقل شد (${fa(fields)} فیلد)` : 'فرانت‌متر تکراری برداشته شد');
    return;
  }

  const { body, changed } = repairOne(app.editor.getText(), issue.rule, issue.line);
  if (!changed) { toast('این مورد را نشد خودکار اصلاح کرد'); return; }

  app.editor.setText(body);
  markDirty(true);
  refresh();
  toast('اصلاح شد');
}

/* --------------------------------------------------------------------------
   Readiness
   -------------------------------------------------------------------------- */

function renderReadiness() {
  const current = tab();
  const untouched = current && !current.doc.body.trim() && !current.doc.frontmatter.has('title');
  const problems = current && !untouched ? validateAll(current.doc, current.name) : [];
  const blockers = problems.filter((p) => p.severity === 'block');
  const warnings = problems.filter((p) => p.severity === 'warn');

  const badge = $('#btn-ready');
  if (!current) {
    badge.textContent = 'سندی باز نیست';
    badge.className = '';
  } else if (untouched) {
    badge.textContent = 'سند خالی';
    badge.className = '';
  } else if (blockers.length) {
    badge.textContent = `${fa(blockers.length)} مورد مانده`;
    badge.className = 'status--err';
  } else if (warnings.length) {
    badge.textContent = `${fa(warnings.length)} هشدار انتشار`;
    badge.className = 'status--warn';
  } else {
    badge.textContent = 'آماده‌ی انتشار';
    badge.className = 'status--ok';
  }

  const kind = blockers.length ? 'block' : warnings.length ? 'warn' : 'ok';
  const title = untouched
    ? 'هنوز چیزی نوشته نشده'
    : blockers.length ? 'هنوز آماده‌ی انتشار نیست'
    : warnings.length ? 'می‌شود منتشر کرد، ولی' : 'آماده‌ی انتشار است';

  $('#ready').innerHTML = `
    <div class="ready ready--${kind}">
      <div class="ready__title">${title}</div>
      ${problems.length === 0
        ? `<div class="ready__item">${untouched
             ? 'وقتی متن را نوشتی، اینجا می‌گوید چه چیزی برای انتشار کم است.'
             : 'همه‌چیز سرجایش است.'}</div>`
        : `<ul class="ready__list">${problems.map((p) => `
             <li class="ready__item"><span><b>${esc(p.field)}</b> — ${esc(p.message)}</span></li>`).join('')}
           </ul>`}
    </div>`;
}

/* --------------------------------------------------------------------------
   Publish panel
   -------------------------------------------------------------------------- */

function openPanel() {
  if (!tab()) { toast('اول یک سند باز کن'); return; }
  renderReadiness();
  $('#panel').classList.add('is-open');
  $('#panel').setAttribute('aria-hidden', 'false');
  $('#panel-scrim').classList.add('is-open');
  const first = $('#panel').querySelector('input, select, textarea, button');
  if (first) first.focus();
}

function closePanel() {
  $('#panel').classList.remove('is-open');
  $('#panel').setAttribute('aria-hidden', 'true');
  $('#panel-scrim').classList.remove('is-open');
  app.editor.focus();
}

const panelIsOpen = () => $('#panel').classList.contains('is-open');

/* --------------------------------------------------------------------------
   Tabs
   -------------------------------------------------------------------------- */

/**
 * Moves the editor onto a tab, remembering where the last one was left.
 *
 * The outgoing text is captured from `loadedId` - the tab the editor is really
 * showing - and NOT from whatever the session calls active. Those two are not
 * the same thing at the moment this runs: open() and restore() both point the
 * session at the new tab before handing over, so reading the session here made
 * the studio write the editor's old (often empty) contents straight over the
 * document it was about to display. A restored draft came back blank and an
 * opened file showed the previous one's text.
 */
function activate(id) {
  const loaded = app.session.tabs.find((t) => t.id === app.loadedId);
  if (loaded && loaded.id !== id) {
    loaded.doc.setBody(app.editor.getText());
    loaded.caret = app.editor.getCaret();
  }

  app.switching = true;
  app.session.setActive(id);

  const current = tab();
  if (current) {
    app.editor.setText(current.doc.body);
    app.editor.setCaret(current.caret);
    app.sidebar.render(current.doc);
  } else {
    app.editor.setText('');
  }
  app.loadedId = current ? current.id : null;
  app.switching = false;

  app.tabs.render(app.session);
  refresh();
  updateStatusBar();
  app.editor.focus();
}

/* --------------------------------------------------------------------------
   Keeping a workspace lock alive

   A lock lapses after thirty minutes so a closed laptop cannot block the
   other person forever. While a document is genuinely open, it is renewed -
   otherwise a long editing session would expire under the author.
   -------------------------------------------------------------------------- */

function startLockRefresh() {
  if (app.lockTimer) return;

  app.lockTimer = setInterval(async () => {
    for (const t of app.session.tabs) {
      if (!t.remotePath || t.readOnly) continue;
      try { await remote.claimDocument(t.remotePath); } catch { /* lost it; the save will say so */ }
    }
  }, LOCK_REFRESH_MS);
}

/** Hands back every lock this browser holds. */
async function releaseAllLocks() {
  for (const t of app.session.tabs) {
    if (!t.remotePath || t.readOnly) continue;
    try { await remote.releaseDocument(t.remotePath); } catch { /* best effort */ }
  }
}

/** Pushes the editor's text into the tab it belongs to. Call before anything
    that reads a document rather than the editor - saving, snapshotting. */
function syncLoadedTab() {
  const loaded = app.session.tabs.find((t) => t.id === app.loadedId);
  if (loaded) loaded.doc.setBody(app.editor.getText());
  return loaded;
}

function openInTab(name, text, handle) {
  const existing = app.session.findByName(name);
  if (existing) {
    activate(existing.id);
    toast(`${name} از قبل باز بود`);
    return existing;
  }

  // An untitled tab with nothing in it is a placeholder, not a document, so
  // opening a file takes its place instead of leaving a blank tab behind -
  // the way every editor with tabs behaves.
  const placeholder = disposablePlaceholder();

  const created = app.session.open(name, text, handle);
  app.usage.noteOpen(name);
  activate(created.id);

  if (placeholder) {
    if (app.loadedId === placeholder.id) app.loadedId = null;
    app.session.close(placeholder.id);
    app.tabs.render(app.session);
  }

  return created;
}

/** The current tab, when it is an untouched blank one. Otherwise null. */
function disposablePlaceholder() {
  const current = tab();
  if (!current) return null;
  if (current.dirty || current.handle) return null;
  if (current.doc.body.trim()) return null;
  if (current.doc.frontmatter.keys().length > 0) return null;
  return current;
}

async function closeTab(id) {
  const target = app.session.tabs.find((t) => t.id === id);
  if (!target) return;

  if (target.dirty) {
    const keep = await dialog.ask('تغییرات ذخیره نشده',
      `«${target.name}» تغییرهای ذخیره‌نشده دارد. اگر ببندی از بین می‌روند.`,
      { confirmLabel: 'ببند و بی‌خیال شو', cancelLabel: 'برگرد', danger: true });
    if (!keep) return;
  }

  // Hand the lock back, so the other person is not left waiting on a tab
  // that is not even open any more.
  if (target.remotePath && !target.readOnly) {
    remote.releaseDocument(target.remotePath).catch(() => {});
  }

  const wasActive = app.session.activeId === id;
  if (app.loadedId === id) app.loadedId = null;
  app.session.close(id);

  if (wasActive) activate(app.session.activeId);
  else app.tabs.render(app.session);

  saveSessionSoon();
}

/* --------------------------------------------------------------------------
   Command context
   -------------------------------------------------------------------------- */

const ctx = {
  get editor() { return app.editor; },
  openPanel,

  async insertLink() {
    const selected = app.editor.getSelectionText();
    const values = await dialog.form('درج پیوند', [
      { name: 'text', label: 'متن پیوند', value: selected, placeholder: 'متنی که خوانده می‌شود' },
      { name: 'url', label: 'نشانی', value: 'https://', ltr: true },
    ]);
    if (!values || !values.url) return;
    app.editor.replaceSelection(`[${values.text || 'متن پیوند'}](${values.url})`);
  },

  async insertImage() {
    const values = await dialog.form('درج تصویر', [
      { name: 'src', label: 'نام فایل', value: '', placeholder: 'cover.jpg', ltr: true,
        hint: 'تصویر باید کنار همین فایل .md باشد.' },
      { name: 'alt', label: 'توضیح تصویر', value: '',
        hint: 'برای خواننده‌ای که تصویر را نمی‌بیند.' },
    ]);
    if (!values || !values.src) return;
    app.editor.insertBlock(`![${values.alt}](${values.src})`);
  },

  async insertTable() {
    const markdown = await openTableBuilder();
    if (markdown) app.editor.insertBlock(markdown);
  },

  /* The reference goes in at the caret, the definition at the end of the file,
     and the drawer opens so the text can be written straight away. */
  insertFootnote() {
    const id = nextFootnoteId(app.editor.getText());
    app.editor.replaceSelection(`[^${id}]`);

    const current = app.editor.getText().replace(/\s+$/, '');
    app.editor.setText(`${current}\n\n[^${id}]: `);

    refresh();
    app.footnotes.open();
    const field = $('#footnote-list').querySelector('.fn-row:last-of-type .fn-text');
    if (field) field.focus();
    toast(`پانویس ${fa(id)} ساخته شد`);
  },

  toggleFootnotePanel() {
    // Every drawer lives along the same strip, so only one can be up.
    if (!app.footnotes.isOpen) closeOtherDrawers('footnotes');
    app.footnotes.toggle();
    $('#btn-footnotes').setAttribute('aria-pressed', String(app.footnotes.isOpen));
  },

  toggleSourcePanel() {
    if (!app.sources.isOpen) closeOtherDrawers('sources');
    app.sources.toggle();
    $('#btn-sources').setAttribute('aria-pressed', String(app.sources.isOpen));
  },

  buildTableOfContents() {
    const lines = app.editor.getText().split('\n');
    const entries = [];
    let changed = false;

    lines.forEach((line, index) => {
      const match = line.match(/^(#{1,6})\s+(.*?)\s*$/);
      if (!match) return;

      const idMatch = match[2].match(/\{:?\s*[^}]*#([^\s}]+)[^}]*\}\s*$/);
      let id = idMatch ? idMatch[1] : null;
      const title = match[2].replace(/\s*\{:?[^}]*\}\s*$/, '');

      if (!id) {
        id = 'h-' + (index + 1) + '-' + Math.random().toString(16).slice(2, 6);
        lines[index] = `${match[1]} ${title} {#${id}}`;
        changed = true;
      }
      entries.push({ level: match[1].length, title, id });
    });

    if (entries.length === 0) {
      toast('هیچ عنوانی پیدا نشد. اول با دکمه‌های ع۱ تا ع۳ عنوان بساز.');
      return;
    }

    const minLevel = Math.min(...entries.map((e) => e.level));
    const toc = ['## فهرست مطالب', ''];
    for (const entry of entries) {
      toc.push('  '.repeat(entry.level - minLevel) + `- [${entry.title}](#${entry.id})`);
    }

    app.editor.setText(`${toc.join('\n')}\n\n${lines.join('\n')}`);
    markDirty(true);
    refresh();
    toast(`فهرست با ${fa(entries.length)} عنوان ساخته شد` + (changed ? ' و لنگرها اضافه شدند' : ''));
  },

  assignIds() {
    const { body, added } = assignParagraphIds(app.editor.getText());
    if (added === 0) { toast('همه‌ی پاراگراف‌ها از قبل شناسه دارند'); return; }
    app.editor.setText(body);
    markDirty(true);
    refresh();
    toast(`${fa(added)} شناسه‌ی دائمی اضافه شد`);
  },

  /* Colour is applied as a class on the block, never as a <span>. A span is
     presentation smuggled into the manuscript: the linter cannot see through
     it, the EPUB exporter cannot use it, and it survives forever because no
     tool dares touch raw HTML. */
  async setBlockColour() {
    const values = await dialog.form('رنگ پاراگراف', [
      { name: 'colour', label: 'رنگ', type: 'select', value: '',
        options: BLOCK_COLOURS,
        hint: 'به‌صورت کلاس روی خود پاراگراف می‌نشیند، نه با تگ HTML.' },
    ], { confirmLabel: 'اعمال' });
    if (!values) return;

    // Remove whichever colour is on the block, then add the new one.
    for (const name of Object.keys(BLOCK_COLOURS)) {
      if (!name) continue;
      const line = app.editor.getBlockAttrs();
      if (line.includes('.' + name)) app.editor.setBlockAttrs('.' + name);
    }
    if (values.colour) app.editor.setBlockAttrs('.' + values.colour);

    markDirty(true);
    refresh();
  },

  /* One-time conversion of the old studio's hand-built HTML. Every rule has
     an exact Markdown equivalent; nothing here is a guess. */
  async migrateLegacy() {
    const before = app.editor.getText();
    const { body, report, total, remainingHtml } = migrateBody(before);

    if (total === 0) {
      const leftover = findRemainingHtml(before);
      await dialog.say('تبدیل فایل قدیمی', leftover.length === 0
        ? 'این فایل از قبل مارک‌دان خالص است. چیزی برای تبدیل نبود.'
        : `چیزی از الگوهای شناخته‌شده پیدا نشد، ولی ${fa(leftover.length)} جا HTML هست که باید دستی نگاهش کنی.`);
      return;
    }

    const node = document.createElement('div');
    node.innerHTML = `
      <p class="dialog__text">این تبدیل‌ها انجام می‌شود. با <kbd>Ctrl + Z</kbd> هم برمی‌گردد:</p>
      ${report.map((r) => `
        <div class="repair__row"><span>${esc(r.label)}</span>
          <span class="count">${fa(r.count)} مورد</span></div>`).join('')}
      ${remainingHtml.length ? `
        <div class="stats__section">
          <h3>HTML‌ای که دست نخورد</h3>
          <p class="empty">این‌ها الگوی شناخته‌شده نبودند و باید خودت نگاهشان کنی:</p>
          ${remainingHtml.slice(0, 8).map((h) => `
            <div class="stats__row"><span class="mono">${esc(h.snippet)}</span>
              <span class="spacer"></span><span class="count">خط ${fa(h.line)}</span></div>`).join('')}
        </div>` : `
        <div class="stats__section">
          <h3>نتیجه</h3>
          <p class="empty">بعد از تبدیل، هیچ HTMLی در این فایل باقی نمی‌ماند.</p>
        </div>`}`;

    const go = await dialog.custom('تبدیل فایل قدیمی', node, [
      { label: 'انصراف', value: false, cancel: true },
      { label: `تبدیل ${fa(total)} مورد`, value: true, primary: true },
    ], { wide: true });
    if (!go) return;

    app.editor.setText(body);
    markDirty(true);
    refresh();
    toast(`${fa(total)} مورد به مارک‌دان تبدیل شد`);
  },

  async repairAll() {
    const current = tab();
    if (current) current.doc.setBody(app.editor.getText());

    // A frontmatter block sitting in the text is handled first, because every
    // other rule would otherwise be reading YAML as if it were prose.
    let liftedNote = null;
    if (current && hasEmbeddedFrontmatter(current.doc)) {
      const { moved, fields } = liftEmbeddedFrontmatter(current.doc);
      app.editor.setText(current.doc.body);
      app.sidebar.render(current.doc);
      liftedNote = moved
        ? `فرانت‌متر از داخل متن به شناسنامه منتقل شد (${fa(fields)} فیلد).`
        : 'نسخه‌ی تکراری فرانت‌متر از داخل متن برداشته شد؛ شناسنامه از قبل پر بود.';
      markDirty(true);
    }

    const { body, report, total } = repairBody(app.editor.getText());

    if (total === 0) {
      if (liftedNote) {
        refresh();
        await dialog.say('تعمیر خودکار', liftedNote);
        return;
      }
      await dialog.say('تعمیر خودکار', 'چیزی برای تعمیر پیدا نشد. این فایل تمیز است.');
      return;
    }

    const node = document.createElement('div');
    node.innerHTML = `
      ${liftedNote ? `<p class="dialog__text">${esc(liftedNote)}</p>` : ''}
      <p class="dialog__text">این تغییرها انجام می‌شود. با <kbd>Ctrl + Z</kbd> هم برمی‌گردد:</p>
      ${report.map((r) => `
        <div class="repair__row"><span>${esc(r.label)}</span>
          <span class="count">${fa(r.count)} مورد</span></div>`).join('')}`;

    const go = await dialog.custom('تعمیر خودکار', node, [
      { label: 'انصراف', value: false, cancel: true },
      { label: `تعمیر ${fa(total)} مورد`, value: true, primary: true },
    ]);
    if (!go) return;

    app.editor.setText(body);
    markDirty(true);
    refresh();
    toast(`${fa(total)} مورد تعمیر شد`);
  },

  async showStats() {
    const stats = measure(app.editor.getText());
    const cell = (value, label) =>
      `<div class="stats__cell"><span class="stats__value">${value}</span>
       <span class="stats__label">${label}</span></div>`;

    const node = document.createElement('div');
    node.innerHTML = `
      <div class="stats__grid">
        ${cell(fa(stats.words), 'کلمه')}
        ${cell(fa(stats.paragraphs), 'پاراگراف')}
        ${cell(fa(stats.sentences), 'جمله')}
        ${cell(fa(stats.averageSentence), 'میانگین طول جمله')}
        ${cell(fa(stats.longestSentence), 'بلندترین جمله')}
        ${cell(fa(stats.readingMinutes), 'دقیقه مطالعه')}
      </div>
      <section class="stats__section">
        <h3>پاراگراف‌های بلند</h3>
        ${stats.longParagraphs.length === 0
          ? '<p class="empty">هیچ پاراگرافی از ۱۲۰ کلمه بلندتر نیست.</p>'
          : stats.longParagraphs.map((p) => `
              <div class="stats__row"><button data-line="${p.line}">خط ${fa(p.line)}</button>
                <span class="count">${fa(p.words)} کلمه</span><span class="spacer"></span></div>`).join('')}
      </section>
      <section class="stats__section">
        <h3>کلمه‌های تکرارشده در فاصله‌ی نزدیک</h3>
        ${stats.repeats.length === 0
          ? '<p class="empty">تکرار نزدیکی پیدا نشد.</p>'
          : stats.repeats.map((r) => `
              <div class="stats__row"><span>${esc(r.word)}</span><span class="spacer"></span>
                <span class="count">${fa(r.times)} بار</span></div>`).join('')}
      </section>`;

    node.addEventListener('click', (event) => {
      const target = event.target.closest('[data-line]');
      if (!target) return;
      dialog.close();
      app.editor.goToLine(parseInt(target.dataset.line, 10));
    });

    await dialog.custom('آمار این متن', node,
      [{ label: 'بستن', value: true, primary: true, cancel: true }], { wide: true });
  },

  /* The book is built from the Markdown, never from the site's HTML or the
     premium JSON. Those are destinations too; building from one of them would
     be building a copy of a copy. */
  async exportEpub() {
    const current = tab();
    if (!current) { toast('اول یک سند باز کن'); return; }

    current.doc.setBody(app.editor.getText());
    const hasPaywall = current.doc.body.includes('<!-- PAYWALL -->');

    const values = await dialog.form('ساختن کتاب EPUB', [
      { name: 'split', label: 'هر فصل از کجا شروع شود', type: 'select',
        value: '1',
        options: {
          1: 'از عنوان‌های سطح یک (#)',
          2: 'از عنوان‌های سطح دو (##)',
          0: 'کل متن، یک فصل',
        },
        hint: 'فهرست کتاب از روی همین عنوان‌ها ساخته می‌شود.' },
      ...(hasPaywall ? [{ name: 'scope', label: 'چه مقدار از متن', type: 'select',
        value: 'full',
        options: { full: 'کل کتاب', sample: 'فقط تا دیوار پرداخت (نمونه‌ی رایگان)' } }] : []),
    ], { confirmLabel: 'بساز' });

    if (!values) return;

    try {
      const { blob, filename, chapters } = await buildEpub({
        doc: current.doc,
        splitLevel: parseInt(values.split, 10),
        sampleOnly: values.scope === 'sample',
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      toast(`${filename} با ${fa(chapters)} فصل ساخته شد`);
    } catch (err) {
      dialog.say('ساختن کتاب ممکن نشد', String(err && err.message ? err.message : err));
    }
  },

  /* --- file, view and app-level commands, so the menus can reach them --- */
  newDocument() { app.session.openBlank(); activate(app.session.activeId); },
  openDocument() { doOpen(); },
  saveDocument() { doSave(); },
  saveDocumentAs() { doSaveAs(); },
  closeDocument() { if (tab()) closeTab(tab().id); },
  showShortcuts() { shortcuts.toggle(); },
  cycleTheme() { nextTheme(); toast(`پوسته: ${getThemeLabel()}`); },

  /* --- state the menus read to draw their tick marks --- */
  currentTheme() { return getTheme(); },
  currentView() { return app.view; },
  paperViewOn() { return $('.pane--preview').classList.contains('paper-view'); },

  pickTheme(id) {
    setTheme(id);
    toast(`پوسته: ${getThemeLabel()}`);
  },

  async configureToolbar() {
    const ids = await openToolbarConfig();
    if (!ids) return;
    app.toolbar.refresh();
    toast(`${fa(ids.length)} ابزار روی نوار`);
  },

  /* Every field, always, in the same order. Unknown keys are never touched -
     see model/normalize.js. */
  async tidyFrontmatter() {
    const current = tab();
    if (!current) { toast('اول یک سند باز کن'); return; }

    syncLoadedTab();
    const plan = previewNormalize(current.doc);

    if (plan.missing.length === 0 && !plan.outOfOrder) {
      await dialog.say('مرتب کردن شناسنامه', 'شناسنامه از قبل مرتب است.');
      return;
    }

    const node = document.createElement('div');
    node.innerHTML = `
      ${plan.missing.length ? `
        <p class="dialog__text">این فیلدها با مقدار پیش‌فرض اضافه می‌شوند:</p>
        ${plan.missing.map((k) => `
          <div class="repair__row"><span class="mono">${esc(k)}</span></div>`).join('')}` : ''}
      ${plan.outOfOrder ? '<p class="dialog__text">ترتیب فیلدها هم به شکل استاندارد درمی‌آید.</p>' : ''}
      <p class="dialog__text" style="color:var(--fg-dim);font-size:0.79rem">
        فیلدهایی که استودیو نمی‌شناسد — مثل summary و price و socials — دست نمی‌خورند و
        بعد از بلوک استاندارد سرجایشان می‌مانند.
      </p>`;

    const go = await dialog.custom('مرتب کردن شناسنامه', node, [
      { label: 'انصراف', value: false, cancel: true },
      { label: 'مرتب کن', value: true, primary: true },
    ]);
    if (!go) return;

    normalizeFrontmatter(current.doc);
    app.sidebar.render(current.doc);
    markDirty(true);
    refresh();
    toast('شناسنامه مرتب شد');
  },

  /* --- the shared workspace --------------------------------------------- */

  async openAccount(mode = 'signin') {
    if (app.user) {
      const out = await dialog.ask('حساب کاربری',
        `وارد شده‌ای با ${remote.displayName(app.user)} — ${app.user.email}`,
        { confirmLabel: 'خروج', cancelLabel: 'بستن', danger: true });
      if (out) ctx.signOut();
      return;
    }

    const user = await openAuth(mode);
    if (!user) return;

    app.user = user;
    startPresence();
    updateStatusBar();
    toast(`خوش آمدی، ${remote.displayName(user)}`);
  },

  /** Everything shared needs a name on it, so it asks first. */
  async requireAccount() {
    if (app.user) return true;

    const yes = await dialog.ask('برای این کار باید وارد شوی',
      'فضای مشترک نیاز دارد بداند هر تغییر را چه کسی ذخیره کرده. ویرایش روی همین کامپیوتر بدون حساب هم کار می‌کند.',
      { confirmLabel: 'ورود یا ثبت‌نام' });
    if (!yes) return false;

    const user = await openAuth('signin');
    if (!user) return false;

    app.user = user;
    startPresence();
    updateStatusBar();
    return true;
  },

  async openWorkspace() {
    if (!(await ctx.requireAccount())) return;
    showWorkspace({
      currentEmail: app.user ? app.user.email : null,
      toast,
      openDocument: ({ path, content, readOnly }) => {
        const existing = app.session.tabs.find((t) => t.remotePath === path);
        if (existing) { activate(existing.id); return; }

        const name = path.split('/').pop();
        const created = app.session.open(name, content, null);
        created.remotePath = path;
        created.readOnly = readOnly;
        activate(created.id);
        startLockRefresh();

        toast(readOnly ? `${name} — فقط خواندنی` : `${name} باز شد`);
      },
    });
  },

  async pushToWorkspace() {
    const current = tab();
    if (!current) { toast('اول یک سند باز کن'); return; }
    if (!(await ctx.requireAccount())) return;

    syncLoadedTab();
    normalizeFrontmatter(current.doc);

    const path = await sendToWorkspace(
      current.doc, current.name, current.doc.serialize(), { toast });

    if (!path) return;

    current.remotePath = path;
    current.readOnly = false;
    markDirty(false);
    startLockRefresh();
    updateStatusBar();
  },

  async signOut() {
    if (!app.user) { toast('وارد نشده‌ای'); return; }

    await releaseAllLocks();
    await remote.leavePresence();
    await remote.signOut();

    app.user = null;
    app.present = [];
    updateStatusBar();
    toast('خارج شدی');
  },

  browseArchive() {
    openArchive({
      openFile: ({ name, text, handle }) => {
        openInTab(name, text, handle);
        toast(`${name} باز شد`);
      },
      toast,
    });
  },
  setView(mode) { setView(mode); },
  showUsage() { showUsage(); },

  /* --- tracked changes ---------------------------------------------------- */

  /* The selected words stay as the "before" side and the caret lands in the
     "after" side, ready to type the replacement. */
  trackReplace() {
    const selected = app.editor.getSelectionText();
    if (!selected) { toast('اول متنی را انتخاب کن که می‌خواهی عوض شود'); return; }
    app.editor.replaceSelection(`{~~${selected}~>${selected}~~}`);
  },

  trackNote() {
    const selected = app.editor.getSelectionText();
    app.editor.replaceSelection(`{>>${selected || 'یادداشت'}<<}`);
  },

  toggleReviewPanel() {
    if ($('#review').hidden) openReview(); else closeReview();
  },

  togglePaperView() {
    const pane = $('.pane--preview');
    pane.classList.toggle('paper-view');
    toast(pane.classList.contains('paper-view') ? 'نمای کاغذ روشن شد' : 'نمای کاغذ خاموش شد');
  },
};

/* --------------------------------------------------------------------------
   Usage report
   -------------------------------------------------------------------------- */

async function showUsage() {
  const report = app.usage.report();
  const since = report.since ? new Date(report.since).toLocaleDateString('fa-IR') : '—';
  const cell = (value, label) =>
    `<div class="stats__cell"><span class="stats__value">${value}</span>
     <span class="stats__label">${label}</span></div>`;

  const node = document.createElement('div');
  node.innerHTML = `
    <div class="stats__grid">
      ${cell(fa(report.documentCount), 'سند')}
      ${cell(fa(report.hours), 'ساعت کار')}
      ${cell(fa(report.saves), 'بار ذخیره')}
      ${cell(esc(since), 'از تاریخ')}
    </div>

    <section class="stats__section">
      <h3>سندهایی که رویشان کار شده</h3>
      ${report.documents.length === 0
        ? '<p class="empty">هنوز چیزی ثبت نشده.</p>'
        : report.documents.map((d) => `
            <div class="stats__row"><span class="mono">${esc(d.name)}</span>
              <span class="spacer"></span>
              <span class="count">${fa(d.minutes)} دقیقه · ${fa(d.saves)} ذخیره</span></div>`).join('')}
    </section>

    <section class="stats__section">
      <h3>چهارده روز اخیر</h3>
      ${report.days.length === 0
        ? '<p class="empty">هنوز چیزی ثبت نشده.</p>'
        : report.days.map((d) => `
            <div class="stats__row"><span class="mono">${esc(d.day)}</span>
              <span class="spacer"></span>
              <span class="count">${fa(d.minutes)} دقیقه</span></div>`).join('')}
    </section>

    <p class="dialog__text" style="color:var(--fg-dim);font-size:0.79rem">
      این کارنامه فقط در همین مرورگر و روی همین لپ‌تاپ نگه داشته می‌شود. اگر داده‌های
      مرورگر را پاک کنی از بین می‌رود، و مرورگر دیگر یا لپ‌تاپ دیگر کارنامه‌ی جدای خودش
      را دارد. آمار مشترکِ نشر نیست، کارنامه‌ی کار توست. زمان هم فقط وقتی شمرده می‌شود
      که واقعاً تایپ می‌کنی — تبِ باز و رهاشده چیزی اضافه نمی‌کند.
    </p>`;

  const reset = await dialog.custom('کارنامه‌ی کار', node, [
    { label: 'پاک کردن کارنامه', value: 'reset', danger: true },
    { label: 'بستن', value: null, primary: true, cancel: true },
  ], { wide: true });

  if (reset !== 'reset') return;
  const sure = await dialog.ask('پاک کردن کارنامه',
    'همه‌ی سابقه‌ی کار پاک می‌شود و برنمی‌گردد.',
    { confirmLabel: 'پاک کن', danger: true });
  if (sure) { app.usage.reset(); toast('کارنامه پاک شد'); }
}

/* --------------------------------------------------------------------------
   File operations
   -------------------------------------------------------------------------- */

const saveSessionSoon = debounce(() => {
  syncLoadedTab();
  files.saveSession(app.session.snapshot());
}, 900);

async function doOpen() {
  try {
    const result = await files.openFile();
    if (!result) return;
    openInTab(result.name, result.text, result.handle);
    toast(`${result.name} باز شد`);
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    dialog.say('باز کردن ممکن نشد', 'مرورگر نتوانست فایل را بخواند.');
  }
}

async function doSave() {
  const current = tab();
  if (!current) return false;

  if (current.readOnly) {
    dialog.say('فقط خواندنی',
      'این سند دست کس دیگری باز است. تا رهایش نکرده نمی‌شود ذخیره‌اش کرد.');
    return false;
  }

  syncLoadedTab();
  // Every saved file carries the same keys in the same order. The first save
  // of an older file therefore reorders its frontmatter, which is the point.
  normalizeFrontmatter(current.doc);
  const text = current.doc.serialize();

  // A tab from the workspace saves there, not to disk. The two are never
  // both true, so there is no question of which one wins.
  if (current.remotePath) {
    try {
      await remote.writeDocument(current.remotePath, text);
      markDirty(false);
      app.sidebar.render(current.doc);
      app.usage.noteSave(current.name);
      toast('در فضای مشترک ذخیره شد');
      return true;
    } catch (err) {
      dialog.say('ذخیره نشد', String(err.message || err));
      return false;
    }
  }

  try {
    if (current.handle && (await files.saveToHandle(current.handle, text))) {
      markDirty(false);
      app.sidebar.render(current.doc);
      app.usage.noteSave(current.name);
      saveSessionSoon();
      toast('ذخیره شد');
      return true;
    }
    return await doSaveAs();
  } catch (err) {
    if (err && err.name === 'AbortError') return false;
    dialog.say('ذخیره ممکن نشد', 'مرورگر اجازه‌ی نوشتن روی فایل را نداد.');
    return false;
  }
}

async function doSaveAs() {
  const current = tab();
  if (!current) return false;

  syncLoadedTab();
  normalizeFrontmatter(current.doc);
  const text = current.doc.serialize();
  const slug = current.doc.frontmatter.get('slug');
  const suggested = slug ? `${slug}.md` : current.name;

  try {
    const handle = await files.saveAs(text, suggested);
    if (handle) {
      current.handle = handle;
      current.name = (await handle.getFile()).name;
      document.title = `${current.name} — استودیوی اسب`;
    }
    markDirty(false);
    app.usage.noteSave(current.name);
    saveSessionSoon();
    toast(files.canWriteInPlace ? 'ذخیره شد' : 'فایل دانلود شد — از پوشه‌ی دانلود بردارش');
    return true;
  } catch (err) {
    if (err && err.name === 'AbortError') return false;
    dialog.say('ذخیره ممکن نشد', 'مرورگر اجازه‌ی نوشتن روی فایل را نداد.');
    return false;
  }
}

/* --------------------------------------------------------------------------
   Review drawer

   One row per tracked change, each with accept and reject. Nothing is resolved
   automatically: an editorial mark is a question put to a person, and the
   studio's job is to make answering it easy, not to answer it.
   -------------------------------------------------------------------------- */

function renderReview() {
  if ($('#review').hidden) return;

  const body = app.editor.getText();
  const changes = findChanges(body);
  const list = $('#review-list');

  $('#review-summary').textContent = changes.length
    ? `${fa(changes.length)} تغییر`
    : 'هیچ تغییر ردیابی‌شده‌ای نیست';
  $('#review-summary').className = changes.length ? 'status--warn' : 'status--ok';

  list.innerHTML = '';
  if (changes.length === 0) {
    list.innerHTML = `<p class="rv-empty">متنی را انتخاب کن و از منوی «بازبینی» علامت بزن.
      علامت‌ها داخل خود فایل می‌مانند، پس با گیت هم دیده می‌شوند.</p>`;
    return;
  }

  changes.forEach((change, index) => list.appendChild(reviewRow(change, index)));
}

function reviewRow(change, index) {
  const row = document.createElement('div');
  row.className = 'rv-row';

  const kind = document.createElement('span');
  kind.className = `rv-kind rv-kind--${change.type}`;
  kind.textContent = change.label;

  const text = document.createElement('div');
  text.className = 'rv-text';
  if (change.type === 'substitute') {
    text.innerHTML = `<del>${esc(change.before)}</del> ← <ins>${esc(change.after)}</ins>`;
  } else if (change.type === 'delete') {
    text.innerHTML = `<del>${esc(change.before)}</del>`;
  } else {
    text.textContent = change.after;
  }

  const actions = document.createElement('div');
  actions.className = 'rv-actions';

  const where = document.createElement('button');
  where.type = 'button';
  where.className = 'rv-where';
  where.textContent = `خط ${fa(change.line)}`;
  where.addEventListener('click', () => app.editor.goToLine(change.line));

  const accept = document.createElement('button');
  accept.type = 'button';
  accept.className = 'btn btn--primary';
  accept.textContent = 'بپذیر';
  accept.addEventListener('click', () => applyReview(index, 'accept'));

  const reject = document.createElement('button');
  reject.type = 'button';
  reject.className = 'btn btn--outline';
  reject.textContent = 'رد کن';
  reject.addEventListener('click', () => applyReview(index, 'reject'));

  actions.append(where, accept, reject);
  row.append(kind, text, actions);
  return row;
}

function applyReview(index, action) {
  app.editor.setText(resolveOne(app.editor.getText(), index, action));
  markDirty(true);
  refresh();
}

async function applyReviewAll(action) {
  const count = countChanges(app.editor.getText());
  if (count === 0) { toast('تغییری برای رسیدگی نیست'); return; }

  const yes = await dialog.ask(
    action === 'accept' ? 'پذیرفتن همه' : 'رد کردن همه',
    `${fa(count)} تغییر یک‌جا ${action === 'accept' ? 'پذیرفته' : 'رد'} می‌شود. با Ctrl+Z برمی‌گردد.`,
    { confirmLabel: action === 'accept' ? 'بپذیر' : 'رد کن', danger: action === 'reject' });
  if (!yes) return;

  const { body } = resolveAll(app.editor.getText(), action);
  app.editor.setText(body);
  markDirty(true);
  refresh();
  toast(`${fa(count)} تغییر رسیدگی شد`);
}

function openReview() {
  closeOtherDrawers('review');
  $('#review').hidden = false;
  $('#btn-review').setAttribute('aria-pressed', 'true');
  renderReview();
}

function closeReview() {
  $('#review').hidden = true;
  $('#btn-review').setAttribute('aria-pressed', 'false');
}

function setView(mode) {
  const shell = $('.app');
  shell.classList.remove('view-source', 'view-preview');
  if (mode !== 'split') shell.classList.add(`view-${mode}`);
  app.view = mode;
}

/* --------------------------------------------------------------------------
   Issues drawer
   -------------------------------------------------------------------------- */

/** Only one drawer can occupy the strip at the foot of the window. */
function closeOtherDrawers(keep) {
  if (keep !== 'issues') closeIssues();
  if (keep !== 'footnotes' && app.footnotes && app.footnotes.isOpen) {
    app.footnotes.close();
    $('#btn-footnotes').setAttribute('aria-pressed', 'false');
  }
  if (keep !== 'sources' && app.sources && app.sources.isOpen) {
    app.sources.close();
    $('#btn-sources').setAttribute('aria-pressed', 'false');
  }
  if (keep !== 'review') closeReview();
}

function openIssues() {
  closeOtherDrawers('issues');
  $('#issues').hidden = false;
  $('#btn-issues').setAttribute('aria-pressed', 'true');
}
function closeIssues() {
  $('#issues').hidden = true;
  $('#btn-issues').setAttribute('aria-pressed', 'false');
}

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */

function boot() {
  initTheme();
  initTooltips();

  /* Signing in is optional. The studio saves to the local disk whether or not
     anybody has an account; a login only buys the shared workspace. So the
     app starts, and the session is picked up in the background if there is
     one. */
  remote.currentUser().then((user) => {
    app.user = user;
    if (user) startPresence();
    updateStatusBar();
  });

  remote.onAuthChange((user) => {
    app.user = user;
    if (user) startPresence(); else remote.leavePresence();
    updateStatusBar();
  });

  app.editor = new MarkdownEditor($('#editor'), () => {
    if (app.switching) return;   // a tab swap is not an author's edit

    // Typing with every tab closed used to write into nothing. Text has to
    // belong to a document, so one is opened for it.
    if (!tab() && app.editor.getText().trim()) {
      const created = app.session.openBlank();
      created.doc.setBody(app.editor.getText());
      app.loadedId = created.id;
      app.sidebar.render(created.doc);
    }

    markDirty(true);
    app.usage.ping();
    refreshSoon();
    saveSessionSoon();
  });

  app.editor.onCursor(({ line, column, total }) => {
    $('#cursor').textContent = `خط ${fa(line)} از ${fa(total)} · ستون ${fa(column)}`;
  });

  app.sidebar = new Sidebar($('#sidebar'), () => {
    markDirty(true);
    refresh();
    saveSessionSoon();
  });

  app.tabs = new Tabs($('#tabstrip'), {
    onSelect: activate,
    onClose: closeTab,
    onNew: () => { app.session.openBlank(); activate(app.session.activeId); },
  });

  const panelHandlers = {
    getBody: () => app.editor.getText(),
    setBody: (text) => { app.editor.setText(text); markDirty(true); refresh(); },
    goToLine: (line) => app.editor.goToLine(line),
    toast,
    confirm: (title, message) => dialog.ask(title, message, { danger: true }),
  };

  app.sources = new SourcePanel($('#sources'), panelHandlers);

  app.footnotes = new FootnotePanel($('#footnotes'), {
    getBody: () => app.editor.getText(),
    setBody: (text) => { app.editor.setText(text); markDirty(true); refresh(); },
    goToLine: (line) => app.editor.goToLine(line),
    toast,
    confirm: (title, message) => dialog.ask(title, message, { danger: true }),
  });

  app.menubar = new MenuBar($('#menubar'), ctx);
  app.toolbar = new Toolbar($('#toolbar'), ctx);
  bindShortcuts(ctx);

  /* --- title bar --- */
  $('#btn-open').addEventListener('click', doOpen);
  $('#btn-save').addEventListener('click', doSave);
  $('#btn-saveas').addEventListener('click', doSaveAs);

  /* --- publish panel --- */
  $('#btn-ready').addEventListener('click', openPanel);
  $('#btn-panel-close').addEventListener('click', closePanel);
  $('#panel-scrim').addEventListener('click', closePanel);
  $('#btn-panel-saveas').addEventListener('click', () => doSaveAs());
  $('#btn-panel-save').addEventListener('click', async () => { if (await doSave()) closePanel(); });

  /* --- status bar --- */
  $('#btn-stats').addEventListener('click', () => ctx.showStats());
  $('#btn-usage').addEventListener('click', showUsage);
  // Two words, two doors: clicking the right half opens sign-in, the left
  // half sign-up. Signed in, the whole thing is the account menu.
  $('#btn-account').addEventListener('click', (event) => {
    if (app.user) { ctx.openAccount(); return; }
    const target = event.target.closest('[data-mode]');
    ctx.openAccount(target ? target.dataset.mode : 'signin');
  });
  $('#btn-review').addEventListener('click', () => ctx.toggleReviewPanel());
  $('#btn-review-close').addEventListener('click', closeReview);
  $('#btn-review-accept-all').addEventListener('click', () => applyReviewAll('accept'));
  $('#btn-review-reject-all').addEventListener('click', () => applyReviewAll('reject'));
  $('#btn-footnotes').addEventListener('click', () => ctx.toggleFootnotePanel());
  $('#btn-sources').addEventListener('click', () => ctx.toggleSourcePanel());
  $('#btn-issues').addEventListener('click', () => { if ($('#issues').hidden) openIssues(); else closeIssues(); });
  $('#btn-issues-close').addEventListener('click', closeIssues);

  /* --- keyboard --- */
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F1') { e.preventDefault(); shortcuts.toggle(); return; }

    if (e.key === 'Escape') {
      if (dialog.isOpen()) return;              // the dialog handles its own
      if (shortcuts.isOpen()) { shortcuts.close(); return; }
      if (panelIsOpen()) { closePanel(); return; }
      if (!$('#review').hidden) { closeReview(); return; }
      if (app.sources.isOpen) { ctx.toggleSourcePanel(); return; }
      if (app.footnotes.isOpen) { ctx.toggleFootnotePanel(); return; }
      if (!$('#issues').hidden) { closeIssues(); return; }
      return;
    }

    // Alt keys first: Ctrl+W and Ctrl+Tab belong to the browser, and Chrome
    // ignores preventDefault on both. Reaching for them would have closed the
    // whole browser tab instead of a document.
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const digit = parseInt(e.key, 10);
      if (Number.isFinite(digit) && digit >= 1 && digit <= 9) {
        const target = app.session.tabs[digit - 1];
        if (target) { e.preventDefault(); activate(target.id); }
        return;
      }
      if (e.key.toLowerCase() === 'w') {
        e.preventDefault();
        if (tab()) closeTab(tab().id);
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const list = app.session.tabs;
        if (list.length < 2) return;
        e.preventDefault();
        const index = list.findIndex((t) => t.id === app.session.activeId);
        const step = e.key === 'ArrowRight' ? -1 : 1;   // RTL: right means back
        activate(list[(index + step + list.length) % list.length].id);
        return;
      }
    }

    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const key = e.key.toLowerCase();

    if (key === '/') { e.preventDefault(); shortcuts.toggle(); }
    else if (e.shiftKey && key === 'p') { e.preventDefault(); openPanel(); }
    else if (e.shiftKey && key === 'f') { e.preventDefault(); ctx.toggleFootnotePanel(); }
    else if (e.shiftKey && key === 'r') { e.preventDefault(); ctx.toggleReviewPanel(); }
    else if (e.shiftKey && key === 's') { e.preventDefault(); doSaveAs(); }
    else if (key === 's') { e.preventDefault(); doSave(); }
    else if (key === 'o') { e.preventDefault(); doOpen(); }
  });

  /* --- drag and drop anywhere --- */
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    const dropped = [...(e.dataTransfer.files || [])].filter((f) => /\.(md|markdown)$/i.test(f.name));
    for (const file of dropped) {
      const result = await files.readDroppedFile(file);
      openInTab(result.name, result.text, null);
    }
    if (dropped.length) toast(`${fa(dropped.length)} فایل باز شد`);
  });

  window.addEventListener('beforeunload', (e) => {
    syncLoadedTab();
    files.saveSession(app.session.snapshot());
    releaseAllLocks();
    remote.leavePresence();
    if (!app.session.hasUnsaved) return;
    e.preventDefault();
    e.returnValue = '';
  });

  setupGutter();
  mountLogos();
  app.usage.start(() => (tab() ? tab().name : null));

  // The category list comes from build.py when its export has been copied in,
  // so the two cannot drift. A missing file just leaves the built-in list.
  loadCategories().then((info) => {
    if (info.source === 'build.py') {
      console.info(`categories: ${info.count} loaded from build.py export`);
    }
    return restoreSession();
  }).then(() => {
    if (app.session.count === 0) app.session.openBlank();
    activate(app.session.activeId);
    updateStatusBar();
  });
}

/* Draggable divider between the two panes. */
function setupGutter() {
  const gutter = $('#gutter');
  const split = $('#split');
  let dragging = false;

  const move = (clientX) => {
    const rect = split.getBoundingClientRect();
    // The source pane sits on the left in this RTL layout, so the ratio is
    // measured from the right edge of the split.
    const ratio = (rect.right - clientX) / rect.width;
    const clamped = Math.min(0.78, Math.max(0.22, ratio));
    split.style.setProperty('--preview-w', `${(1 - clamped) * 100}%`);
    split.style.setProperty('--source-w', `${clamped * 100}%`);
  };

  gutter.addEventListener('pointerdown', (e) => {
    dragging = true;
    gutter.classList.add('is-dragging');
    gutter.setPointerCapture(e.pointerId);
  });
  gutter.addEventListener('pointermove', (e) => { if (dragging) move(e.clientX); });
  gutter.addEventListener('pointerup', (e) => {
    dragging = false;
    gutter.classList.remove('is-dragging');
    gutter.releasePointerCapture(e.pointerId);
  });
}

/* --------------------------------------------------------------------------
   Session recovery
   A crash must not cost the four other documents that were open. The whole
   set comes back, and the card says exactly what is in it.
   -------------------------------------------------------------------------- */

async function restoreSession() {
  const saved = files.loadSession();
  if (!saved || !saved.tabs || saved.tabs.length === 0) return;

  const unsaved = saved.tabs.filter((t) => t.dirty);
  if (unsaved.length === 0) { files.clearSession(); return; }

  const when = new Date(saved.at).toLocaleString('fa-IR');
  const node = document.createElement('div');
  node.innerHTML = `
    <p class="dialog__text">
      دفعه‌ی قبل ${fa(unsaved.length)} سند ذخیره‌نشده باز بود (${esc(when)}).
      می‌توانی برشان گردانی یا از نو شروع کنی.
    </p>
    ${unsaved.map((t) => {
      const stats = measure(t.text);
      const repairs = previewRepair(t.text);
      return `<div class="stats__row">
        <span class="mono">${esc(t.name)}</span><span class="spacer"></span>
        <span class="count">${fa(stats.words)} کلمه${repairs ? ` · ${fa(repairs)} ایراد` : ''}</span>
      </div>`;
    }).join('')}`;

  const keep = await dialog.custom('کار ذخیره‌نشده', node, [
    { label: 'از نو شروع کن', value: false, danger: true },
    { label: 'برشان گردان', value: true, primary: true, cancel: true },
  ]);

  if (keep) {
    app.session.restore(unsaved);
    toast('سندها برگشتند — هنوز روی دیسک ذخیره نشده‌اند');
  } else {
    files.clearSession();
  }
}

boot();
