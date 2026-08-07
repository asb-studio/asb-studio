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
import { BLOCK_COLOURS, loadCategories, todayJalali } from './model/schema.js';
import { measure } from './model/stats.js';
import { readFootnotes, nextFootnoteId } from './model/footnotes.js';
import { UsageTracker } from './model/usage.js';
import { renderPreview, renderMarkedPreview } from './markdown/preview.js';
import { lintDocument, SEVERITY } from './markdown/lint.js';
import { repairBody, repairOne, previewRepair } from './markdown/repair.js';
import { findChanges, countChanges } from './markdown/critic.js';
import {
  isTracking, startTracking, stopTracking, baselineOf, rebaseline,
} from './model/track.js';
import { diffSummary, changeList, resolveChange } from './markdown/diff.js';
import { buildReviewReport } from './export/review-report.js';
import { migrateBody, findRemainingHtml } from './markdown/migrate.js';
import { MarkdownEditor } from './editor/editor.js';
import { Sidebar } from './ui/sidebar.js';
import { Tabs } from './ui/tabs.js';
import { FootnotePanel } from './ui/footnotes.js';
import { SourcePanel } from './ui/sources.js';
import { FindPanel } from './ui/find.js';
import { Toolbar, bindAppShortcuts, editorShortcuts } from './ui/toolbar.js';
import { MenuBar } from './ui/menubar.js';
import { initTheme, nextTheme, setTheme, getTheme, getThemeLabel } from './ui/theme.js';
import { openTableBuilder } from './ui/table-builder.js';
import { openArchive } from './ui/archive.js';
import { openToolbarConfig } from './ui/toolbar-config.js';
import { place, follow, claim } from './ui/popover.js';
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
  find: null,
  usage: new UsageTracker(),
  menubar: null,
  toolbar: null,
  view: 'split',
  effectiveView: 'split',
  showMarkup: true,   // Word's All Markup / No Markup
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
   Who is signed in, and who else is here

   These three went missing in an earlier round of edits, which is why the
   account button never stopped saying "ورود | ثبت‌نام" however many times
   somebody signed in. Every call site was still there; only the functions
   were gone.
   -------------------------------------------------------------------------- */

function startPresence() {
  if (!app.user) return;
  remote.joinPresence(
    { email: app.user.email, name: remote.displayName(app.user) },
    (people) => { app.present = people; renderPresence(); }
  );
}

/* Everyone here, minus yourself - you already know you are here. */
function renderPresence() {
  const el = $('#presence');
  if (!el) return;

  const others = app.present.filter((p) => !app.user || p.email !== app.user.email);
  if (others.length === 0) { el.hidden = true; return; }

  el.hidden = false;
  el.innerHTML = '';

  for (const person of others) {
    const chip = document.createElement('span');
    chip.className = 'presence__who';
    chip.innerHTML = '<span class="presence__dot"></span>';
    chip.appendChild(document.createTextNode(person.name || person.email));
    chip.dataset.tip = `${person.name || ''} (${person.email}) الان آنلاین است`;
    el.appendChild(chip);
  }
}

/** The account button, the recording light, and the presence chips. */
function updateStatusBar() {
  const button = $('#btn-account');
  const current = tab();

  if (button) {
    if (app.user) {
      button.textContent = remote.displayName(app.user);
      button.classList.add('who--in');
      button.dataset.tip = app.user.email;
    } else {
      button.innerHTML =
        '<span data-mode="signin">ورود</span>'
        + '<span class="who__sep">|</span>'
        + '<span data-mode="signup">ثبت‌نام</span>';
      button.classList.remove('who--in');
      button.dataset.tip = 'ورود یا ثبت‌نام';
    }
  }

  const light = $('#track-light');
  if (light) {
    const on = current ? isTracking(current) : false;
    light.hidden = !on;

    if (on) {
      const base = baselineOf(current);
      const n = base === null ? 0 : diffSummary(base, current.doc.body).total;
      light.textContent = n ? `ردیاب روشن · ${fa(n)} تغییر` : 'ردیاب روشن';
    }
  }

  renderPresence();
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

  /* While tracking is on, the preview shows the marks - Word's "All Markup".
     Turn the display off and it shows the text as it would be published,
     which is Word's "No Markup". The document itself is the same either way. */
  const baseline = current ? baselineOf(current) : null;
  const showMarkup = app.showMarkup && baseline !== null;

  preview.innerHTML = empty
    ? WELCOME
    : (showMarkup ? renderMarkedPreview(baseline, body) : renderPreview(body));
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

/* --------------------------------------------------------------------------
   The other person's saves

   A read-only view is a photograph of the moment it opened, which is no use
   when the point is watching someone work. So the row is watched, and when
   they save it arrives here.

   A viewer is updated in place. Someone holding the lock is only told - their
   own text must never be replaced under their hands.
   -------------------------------------------------------------------------- */

function watchRemote(target) {
  if (!target.remotePath) return;

  remote.watchDocument(target.remotePath, (row) => {
    const who = String(row.updated_email || '').split('@')[0];

    if (target.readOnly) {
      const isShowing = tab() && tab().id === target.id;
      const caret = isShowing ? app.editor.getCaret() : target.caret;

      target.doc = parseDocument(row.content);

      if (isShowing) {
        app.switching = true;
        app.editor.setText(target.doc.body);
        app.editor.setCaret(caret);
        app.sidebar.render(target.doc);
        app.switching = false;
        refresh();
      }

      toast(`${who} ذخیره کرد — متن به‌روز شد`);
      return;
    }

    toast(`${who} همین سند را در فضای مشترک ذخیره کرد`);
  });
}

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

  /* A shared document that has changed since it was last sent is the one case
     worth stopping for: the other person is looking at the old text. */
  if (target && target.remotePath && !target.readOnly && target.dirty) {
    const answer = await dialog.custom('این سند در فضای مشترک است',
      Object.assign(document.createElement('div'), {
        innerHTML: '<p class="dialog__text">از آخرین باری که فرستادی، متن عوض شده.'
          + ' اگر ببندی، دلبر همان نسخه‌ی قدیمی را می‌بیند.</p>',
      }),
      [
        { label: 'بستن بدون ذخیره', value: 'close', danger: true },
        { label: 'انصراف', value: null, cancel: true },
        { label: 'ذخیره و ببند', value: 'save', primary: true },
      ]);

    if (answer === null) return;
    if (answer === 'save') await ctx.saveToWorkspace();
  }
  if (!target) return;

  if (target.dirty) {
    const keep = await dialog.ask('تغییرات ذخیره نشده',
      `«${target.name}» تغییرهای ذخیره‌نشده دارد. اگر ببندی از بین می‌روند.`,
      { confirmLabel: 'ببند و بی‌خیال شو', cancelLabel: 'برگرد', danger: true });
    if (!keep) return;
  }

  // Hand the lock back, so the other person is not left waiting on a tab
  // that is not even open any more.
  if (target.remotePath) {
    remote.unwatchDocument(target.remotePath);
    if (!target.readOnly) remote.releaseDocument(target.remotePath).catch(() => {});
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
  /* Reference at the caret, definition at the foot of the file - and the view
     stays exactly where it was.

     The old version rebuilt the whole document with setText to append the
     definition, which reset the scroll and threw the caret back to the top of
     the text. Appending as an edit leaves everything else untouched. */
  async insertFootnote() {
    const id = nextFootnoteId(app.editor.getText());

    const values = await dialog.form(`پانویس ${fa(id)}`, [
      { name: 'text', label: 'متن پانویس', value: '',
        placeholder: 'احمد اخوت، تا روشنایی بنویس، ص ۱۶۱.',
        hint: 'خالی بگذار تا بعداً در پانل پانویس‌ها بنویسی.' },
    ], { confirmLabel: 'درج' });

    if (!values) return;

    app.editor.replaceSelection(`[^${id}]`);
    app.editor.appendDefinition(`[^${id}]: ${values.text.trim()}`);

    markDirty(true);
    refresh();
    toast(`پانویس ${fa(id)} درج شد`);
  },

  toggleFootnotePanel() {
    // Every drawer lives along the same strip, so only one can be up.
    if (!app.footnotes.isOpen) closeOtherDrawers('footnotes');
    app.footnotes.toggle();
    $('#btn-footnotes').setAttribute('aria-pressed', String(app.footnotes.isOpen));
    syncDrawerHeight();
  },

  openFind() {
    if (!app.find.isOpen) closeOtherDrawers('find');
    app.find.toggle(app.editor.getSelectionText());
    syncDrawerHeight();
  },

  toggleSourcePanel() {
    if (!app.sources.isOpen) closeOtherDrawers('sources');
    app.sources.toggle();
    $('#btn-sources').setAttribute('aria-pressed', String(app.sources.isOpen));
    syncDrawerHeight();
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
      const form = document.createElement('div');

      const field = document.createElement('div');
      field.className = 'field';
      const label = document.createElement('label');
      label.textContent = 'نام نمایشی';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'control';
      input.value = remote.displayName(app.user);
      const hint = document.createElement('div');
      hint.className = 'field__hint';
      hint.textContent = `همین نام را بقیه کنار سندهای باز می‌بینند. ایمیل: ${app.user.email}`;
      field.append(label, input, hint);
      form.appendChild(field);

      const result = await dialog.custom('حساب کاربری', form, [
        { label: 'خروج از حساب', value: 'out', danger: true },
        { label: 'بستن', value: null, cancel: true },
        { label: 'ذخیره‌ی نام', value: 'save', primary: true },
      ]);

      if (result === 'out') { ctx.signOut(); return; }
      if (result !== 'save') return;

      const name = input.value.trim();
      if (name && name !== remote.displayName(app.user)) {
        try {
          await remote.updateName(name);
          app.user = await remote.currentUser();
          startPresence();
          updateStatusBar();
          toast('نامت عوض شد');
        } catch {
          toast('عوض کردن نام ممکن نشد');
        }
      }
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
        watchRemote(created);

        toast(readOnly ? `${name} — فقط خواندنی` : `${name} باز شد`);
      },
    });
  },

  /* Saving to the workspace is deliberate, not automatic. Every save is a
     request against a free-tier quota, and a timer spending it while nobody is
     typing is spending it on nothing. Ctrl+Shift+U, when you decide. */
  async saveToWorkspace() {
    const current = tab();
    if (!current) { toast('اول یک سند باز کن'); return; }

    if (!current.remotePath) { ctx.pushToWorkspace(); return; }
    if (current.readOnly) { toast('این سند فقط خواندنی است'); return; }

    syncLoadedTab();
    normalizeFrontmatter(current.doc);

    try {
      await remote.writeDocument(current.remotePath, current.doc.serialize());
      current.pushedAt = Date.now();
      markDirty(false);
      updateStatusBar();
      toast('در فضای مشترک ذخیره شد');
    } catch (err) {
      dialog.say('ذخیره نشد', String(err.message || err));
    }
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
    watchRemote(current);
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
  setView(mode) { requestView(mode); },
  showUsage() { showUsage(); },

  /* --- tracked changes ---------------------------------------------------- */

  isTracking() { return isTracking(tab()); },
  markupShown() { return app.showMarkup; },

  toggleMarkup() {
    app.showMarkup = !app.showMarkup;
    refresh();
    toast(app.showMarkup ? 'نمایش تغییرات' : 'متن نهایی');
  },

  /* A switch, the way Word has one - and it works by remembering, not by
     asking. Turning it on stores the text as it stands; everything after is
     worked out by comparing that snapshot with the text now. */
  toggleTracking() {
    const current = tab();
    if (!current) { toast('اول یک سند باز کن'); return; }

    syncLoadedTab();

    if (isTracking(current)) {
      stopTracking(current);
      updateStatusBar();
      toast('ردیاب خاموش شد');
      return;
    }

    const ok = startTracking(current, current.doc.body);
    updateStatusBar();

    toast(ok
      ? 'ردیاب روشن شد — از این لحظه هر تغییری ثبت می‌شود'
      : 'ردیاب روشن شد، ولی حافظه‌ی مرورگر پر است و نسخه‌ی مبنا ذخیره نشد');
  },

  trackNote() {
    const selected = app.editor.getSelectionText();
    app.editor.replaceSelection(`{>>${selected || 'یادداشت'}<<}`);
  },

  acceptAll() { resolveAll('accept', false); },
  rejectAll() { resolveAll('reject', false); },
  acceptAllAndStop() { resolveAll('accept', true); },
  rejectAllAndStop() { resolveAll('reject', true); },

  /* The page an author is sent. A .md full of marks is readable to anyone who
     knows CriticMarkup and opaque to every writer who has just handed over a
     story - so it becomes a page they can open on a phone. */
  async exportReviewReport() {
    const current = tab();
    if (!current) { toast('اول یک سند باز کن'); return; }

    syncLoadedTab();

    const baseline = baselineOf(current);
    if (baseline === null) {
      await dialog.say('گزارش تغییرات',
        'ردیاب برای این سند روشن نشده، پس نسخه‌ای برای مقایسه وجود ندارد. '
        + 'اول ردیاب را روشن کن، بعد ویرایش کن.');
      return;
    }

    if (diffSummary(baseline, current.doc.body).total === 0
        && countChanges(current.doc.body) === 0) {
      await dialog.say('گزارش تغییرات', 'از وقتی ردیاب روشن شده، چیزی عوض نشده.');
      return;
    }

    const fm = current.doc.frontmatter;

    const values = await dialog.form('گزارش برای پدیدآورنده', [
      { name: 'title', label: 'عنوان صفحه', value: String(fm.get('title') || ''),
        hint: 'بالای گزارش می‌نشیند. می‌تواند با عنوان اثر فرق کند.' },
      { name: 'author', label: 'پدیدآورنده', value: String(fm.get('author') || '') },
      { name: 'translator', label: 'مترجم', value: String(fm.get('translator') || ''),
        hint: 'خالی بگذار اگر اثر ترجمه نیست.' },
      { name: 'editor', label: 'ویراستار',
        value: String(fm.get('editor') || '') || (app.user ? remote.displayName(app.user) : '') },
      { name: 'date', label: 'تاریخ ویرایش', value: todayJalali() },
      { name: 'note', label: 'یادداشت بالای صفحه', value: '',
        hint: 'اختیاری — چند خط برای پدیدآورنده، بالای متن.' },
    ], { confirmLabel: 'ساختن صفحه' });

    if (!values) return;

    const { html, filename, changes, comments } = buildReviewReport({
      doc: current.doc,
      baseline,
      title: values.title,
      editor: values.editor,
      author: values.author,
      translator: values.translator,
      date: values.date,
      note: values.note,
    });

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    const parts = [`${fa(changes)} تغییر`];
    if (comments) parts.push(`${fa(comments)} یادداشت`);
    toast(`صفحه با ${parts.join(' و ')} ساخته شد — بفرستش برای پدیدآورنده`);
  },

  /* The replies the author sent back. The report page cannot post anywhere -
     it is a file on their machine - so it hands them a small file instead,
     and this reads it. No server, no account, nothing to keep running. */
  async importReplies() {
    const current = tab();
    if (!current) { toast('اول همان سندی را باز کن که گزارشش را فرستادی'); return; }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';

    const file = await new Promise((resolve) => {
      input.addEventListener('change', () => resolve(input.files[0] || null));
      input.click();
    });
    if (!file) return;

    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      dialog.say('خوانده نشد', 'این فایل، فایل نظرهای پدیدآورنده نیست.');
      return;
    }

    if (!payload || payload.kind !== 'asb-review-replies' || !Array.isArray(payload.replies)) {
      dialog.say('خوانده نشد', 'این فایل، فایل نظرهای پدیدآورنده نیست.');
      return;
    }

    if (payload.replies.length === 0) {
      dialog.say('نظرها', 'پدیدآورنده یادداشتی ننوشته.');
      return;
    }

    const node = document.createElement('div');
    node.innerHTML = `
      <p class="dialog__text">${fa(payload.replies.length)} یادداشت از پدیدآورنده:</p>
      ${payload.replies.map((r) => `
        <div class="reply">
          <div class="reply__quote">${esc(r.quote || '')}</div>
          <div class="reply__text">${esc(r.text)}</div>
        </div>`).join('')}`;

    const go = await dialog.custom('نظرهای پدیدآورنده', node, [
      { label: 'بستن', value: false, cancel: true },
      { label: 'درج در متن به شکل یادداشت', value: true, primary: true },
    ], { wide: true });
    if (!go) return;

    /* Appended rather than threaded into the text: the paragraph numbers in
       the report belong to the version that was sent, and the text has moved
       on since. The quote is what actually locates each one. */
    const block = payload.replies
      .map((r) => `{>>پدیدآورنده — «${String(r.quote || '').slice(0, 60)}»: ${r.text}<<}`)
      .join('\n\n');

    app.editor.appendDefinition(`\n${block}`);
    markDirty(true);
    refresh();
    toast(`${fa(payload.replies.length)} یادداشت درج شد`);
  },

  toggleReviewPanel() {
    if ($('#review').hidden) openReview(); else closeReview();
  },

  togglePaperView() {
    const pane = $('.pane--preview');
    const on = pane.classList.toggle('paper-view');
    toast(on
      ? 'نمای کاغذ — متن به عرض واقعی صفحه‌ی سایت'
      : 'نمای عادی — متن تمام پنجره');
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

  const current = tab();
  const list = $('#review-list');
  const summary = $('#review-summary');

  list.innerHTML = '';

  if (!current) {
    summary.textContent = 'سندی باز نیست';
    summary.className = '';
    setReviewButtons(false);
    return;
  }

  const baseline = baselineOf(current);
  const body = app.editor.getText();
  const notes = findChanges(body).filter((c) => c.type === 'comment');

  if (baseline === null) {
    summary.textContent = 'ردیاب خاموش است';
    summary.className = '';
    setReviewButtons(false);
    list.innerHTML = `<p class="rv-empty">
      ردیاب را روشن کن (<b>Ctrl+Shift+E</b>) و بعد ویرایش کن. از آن لحظه هر تغییری
      خودش ثبت می‌شود؛ لازم نیست چیزی را دستی علامت بزنی.
    </p>`;
    return;
  }

  const changes = changeList(baseline, body);
  setReviewButtons(changes.length > 0);

  summary.textContent = changes.length || notes.length
    ? `${fa(changes.length)} تغییر · ${fa(notes.length)} یادداشت`
    : 'از وقتی ردیاب روشن شده چیزی عوض نشده';
  summary.className = changes.length ? 'status--warn' : 'status--ok';

  if (changes.length === 0 && notes.length === 0) {
    list.innerHTML = '<p class="rv-empty">چیزی برای رسیدگی نیست.</p>';
    return;
  }

  for (const change of changes) list.appendChild(changeRow(change));
  for (const note of notes) list.appendChild(noteRow(note));
}

/* Which change the Previous / Next buttons are sitting on. Word keeps the
   same idea: you walk the changes rather than hunting for them. */
let reviewCursor = 0;

function stepReview(delta) {
  const current = tab();
  const baseline = current ? baselineOf(current) : null;
  if (baseline === null) return;

  const changes = changeList(baseline, app.editor.getText());
  if (changes.length === 0) { toast('تغییری نیست'); return; }

  reviewCursor = (reviewCursor + delta + changes.length) % changes.length;
  const change = changes[reviewCursor];

  // Only an insertion exists in the current text; a deletion is not there to
  // scroll to, so the caret goes to where it was taken out.
  app.editor.goToOffset(change.bFrom);

  const rows = $('#review-list').querySelectorAll('.rv-row');
  rows.forEach((row, i) => row.classList.toggle('rv-row--at', i === reviewCursor));
  if (rows[reviewCursor]) rows[reviewCursor].scrollIntoView({ block: 'nearest' });

  toast(`تغییر ${fa(reviewCursor + 1)} از ${fa(changes.length)}`);
}

function setReviewButtons(enabled) {
  for (const id of ['btn-accept-all', 'btn-reject-all', 'btn-accept-stop', 'btn-reject-stop',
                    'btn-prev-change', 'btn-next-change']) {
    const button = $(`#${id}`);
    if (button) button.disabled = !enabled;
  }
}

/* One row per change, each with its own accept and reject - the way Word does
   it. A whole-document decision is the exception, not the only option. */
function changeRow(change) {
  const row = document.createElement('div');
  row.className = 'rv-row';

  const kind = document.createElement('span');
  kind.className = `rv-kind rv-kind--${change.type === 'ins' ? 'insert' : 'delete'}`;
  kind.textContent = change.type === 'ins' ? 'افزوده' : 'حذف';

  const text = document.createElement('div');
  text.className = 'rv-text';
  const inner = document.createElement(change.type === 'ins' ? 'ins' : 'del');
  inner.textContent = change.text.replace(/\s+/g, ' ').trim() || '(فاصله)';
  text.appendChild(inner);

  const actions = document.createElement('div');
  actions.className = 'rv-actions';

  // Only an insertion exists in the current text, so only that one can be
  // jumped to. A deletion is not there to scroll to.
  if (change.type === 'ins') {
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'rv-where';
    go.textContent = 'نشانم بده';
    go.addEventListener('click', () => app.editor.goToOffset(change.bFrom));
    actions.appendChild(go);
  }

  const accept = document.createElement('button');
  accept.type = 'button';
  accept.className = 'btn btn--primary';
  accept.textContent = 'بپذیر';
  accept.addEventListener('click', () => resolveOne(change.index, 'accept'));

  const reject = document.createElement('button');
  reject.type = 'button';
  reject.className = 'btn btn--outline';
  reject.textContent = 'رد کن';
  reject.addEventListener('click', () => resolveOne(change.index, 'reject'));

  actions.append(accept, reject);
  row.append(kind, text, actions);
  return row;
}

function noteRow(note) {
  const row = document.createElement('div');
  row.className = 'rv-row';

  const kind = document.createElement('span');
  kind.className = 'rv-kind rv-kind--comment';
  kind.textContent = 'یادداشت';

  const text = document.createElement('div');
  text.className = 'rv-text';
  text.textContent = note.after;

  const actions = document.createElement('div');
  actions.className = 'rv-actions';

  const where = document.createElement('button');
  where.type = 'button';
  where.className = 'rv-where';
  where.textContent = `خط ${fa(note.line)}`;
  where.addEventListener('click', () => app.editor.goToLine(note.line));

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn btn--outline';
  remove.textContent = 'حذف';
  remove.addEventListener('click', () => {
    const body = app.editor.getText();
    app.editor.setText(body.slice(0, note.from) + body.slice(note.to));
    markDirty(true);
    refresh();
  });

  actions.append(where, remove);
  row.append(kind, text, actions);
  return row;
}

/* --------------------------------------------------------------------------
   Resolving

   Accepting moves the baseline forward; rejecting puts the text back. Which of
   the two texts changes is the whole difference between them - see
   markdown/diff.js.
   -------------------------------------------------------------------------- */

function resolveOne(index, action) {
  const current = tab();
  if (!current) return;

  const baseline = baselineOf(current);
  if (baseline === null) return;

  const result = resolveChange(baseline, app.editor.getText(), index, action);

  if (result.after !== app.editor.getText()) {
    app.editor.setText(result.after);
    markDirty(true);
  }
  rebaseline(current, result.before);

  const left = changeList(result.before, result.after).length;
  if (reviewCursor >= left) reviewCursor = Math.max(0, left - 1);

  refresh();
}

/**
 * @param {'accept'|'reject'} action
 * @param {boolean} stop  also switch tracking off, the way Word offers
 */
async function resolveAll(action, stop) {
  const current = tab();
  if (!current) return;

  const baseline = baselineOf(current);
  if (baseline === null) { toast('ردیاب روشن نیست'); return; }

  syncLoadedTab();
  const count = changeList(baseline, current.doc.body).length;
  if (count === 0 && !stop) { toast('چیزی برای رسیدگی نیست'); return; }

  const yes = await dialog.ask(
    action === 'accept' ? 'پذیرش همه' : 'رد همه',
    action === 'accept'
      ? `${fa(count)} تغییر پذیرفته می‌شود. متن دست نمی‌خورد و فقط دیگر تغییر شمرده نمی‌شود.`
      : `${fa(count)} تغییر رد می‌شود و متن به همان شکلی برمی‌گردد که ردیاب روشن شد. `
        + 'این کار واگرد دارد، ولی هرچه از آن زمان نوشته‌ای برمی‌گردد.',
    { confirmLabel: action === 'accept' ? 'بپذیر' : 'رد کن', danger: action === 'reject' });
  if (!yes) return;

  if (action === 'accept') {
    // The new text is right, so it becomes the starting point.
    rebaseline(current, current.doc.body);
  } else {
    // The old text was right, so the document goes back to it.
    app.editor.setText(baseline);
    markDirty(true);
  }

  if (stop) stopTracking(current);

  refresh();
  updateStatusBar();
  toast(stop
    ? `${fa(count)} تغییر رسیدگی شد و ردیاب خاموش شد`
    : `${fa(count)} تغییر رسیدگی شد`);
}

function openReview() {
  closeOtherDrawers('review');
  $('#review').hidden = false;
  setDrawerHeight(true);
  $('#btn-review').setAttribute('aria-pressed', 'true');
  renderReview();
}

function closeReview() {
  $('#review').hidden = true;
  $('#btn-review').setAttribute('aria-pressed', 'false');
  syncDrawerHeight();
}

const NARROW = window.matchMedia('(max-width: 820px)');

function setView(mode) {
  // Two columns on a phone is two columns of two words. Below the breakpoint
  // there is only ever one pane, so asking for "split" gives the text.
  const effective = NARROW.matches && mode === 'split' ? 'source' : mode;

  const shell = $('.app');
  shell.classList.remove('view-source', 'view-preview');
  if (effective !== 'split') shell.classList.add(`view-${effective}`);

  app.view = mode;               // what was asked for
  app.effectiveView = effective; // what is on screen

}

/* Asking for two columns on a phone is asking for something the screen cannot
   do. Saying so is better than silently giving something else. */
async function requestView(mode) {
  if (mode === 'split' && NARROW.matches) {
    await dialog.say('دو ستونی',
      'روی صفحه‌ی گوشی جا برای دو ستون نیست. با «فقط متن» و «فقط پیش‌نمایش» بین آن‌ها جابه‌جا شو.');
    return;
  }
  setView(mode);
}

/* --------------------------------------------------------------------------
   Issues drawer
   -------------------------------------------------------------------------- */

/* How tall an open drawer is. Set as a grid row, so the editor and the
   preview actually shrink and nothing ends up hidden underneath. */
function setDrawerHeight(open) {
  document.querySelector('.app').style.setProperty('--drawer-h', open ? 'min(38vh, 380px)' : '0px');
}

/** Only one drawer can occupy the strip at the foot of the window. */
function closeOtherDrawers(keep) {
  if (keep !== 'issues') {
    $('#issues').hidden = true;
    $('#btn-issues').setAttribute('aria-pressed', 'false');
  }
  if (keep !== 'footnotes' && app.footnotes && app.footnotes.isOpen) {
    app.footnotes.close();
    $('#btn-footnotes').setAttribute('aria-pressed', 'false');
  }
  if (keep !== 'find' && app.find && app.find.isOpen) app.find.close();
  if (keep !== 'sources' && app.sources && app.sources.isOpen) {
    app.sources.close();
    $('#btn-sources').setAttribute('aria-pressed', 'false');
  }
  if (keep !== 'review') {
    $('#review').hidden = true;
    $('#btn-review').setAttribute('aria-pressed', 'false');
  }
}

function openIssues() {
  closeOtherDrawers('issues');
  $('#issues').hidden = false;
  setDrawerHeight(true);
  $('#btn-issues').setAttribute('aria-pressed', 'true');
}
function closeIssues() {
  $('#issues').hidden = true;
  $('#btn-issues').setAttribute('aria-pressed', 'false');
  syncDrawerHeight();
}

/** True when any drawer is showing. */
function syncDrawerHeight() {
  const open = !$('#issues').hidden
    || !$('#review').hidden
    || (app.find && app.find.isOpen)
    || (app.footnotes && app.footnotes.isOpen)
    || (app.sources && app.sources.isOpen);
  setDrawerHeight(open);
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
  /* Supabase leaves #error=... in the address bar when a link it sent has
     already been spent. It means nothing once the page has loaded, and leaving
     it there makes every later reload look like a failure. */
  if (window.location.hash.includes('error')) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }

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

    /* Typing or pasting with no tab open used to write into nothing. Text has
       to belong to a document, so one is made for it here rather than sitting
       empty from boot waiting to be used. */
    if (!tab() && app.editor.getText().trim()) {
      const created = app.session.openBlank();
      created.doc.setBody(app.editor.getText());
      app.loadedId = created.id;
      app.session.setActive(created.id);
      app.sidebar.render(created.doc);
      app.tabs.render(app.session);
    }

    markDirty(true);
    app.usage.ping();
    refreshSoon();
    saveSessionSoon();
  }, editorShortcuts(ctx));

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
    onClose: () => { closeOtherDrawers(null); syncDrawerHeight(); },
    getBody: () => app.editor.getText(),
    setBody: (text) => { app.editor.setText(text); markDirty(true); refresh(); },
    goToLine: (line) => app.editor.goToLine(line),
    toast,
    confirm: (title, message) => dialog.ask(title, message, { danger: true }),
  };

  app.sources = new SourcePanel($('#sources'), panelHandlers);

  app.find = new FindPanel($('#find'), {
    onClose: () => { closeOtherDrawers(null); syncDrawerHeight(); },
    getText: () => app.editor.getText(),
    setText: (text) => { app.editor.setText(text); markDirty(true); refresh(); },
    goTo: (from, to) => app.editor.select(from, to),
    toast,
  });

  app.footnotes = new FootnotePanel($('#footnotes'), panelHandlers);

  app.menubar = new MenuBar($('#menubar'), ctx);
  app.toolbar = new Toolbar($('#toolbar'), ctx);
  bindAppShortcuts(ctx);

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
  // Rotating the phone, or dragging a desktop window narrow, changes which
  // views are possible - so the current one is re-applied.
  NARROW.addEventListener('change', () => setView(app.view));

  setupStatusMenu();

  $('#btn-account').addEventListener('click', (event) => {
    if (app.user) { ctx.openAccount(); return; }
    const target = event.target.closest('[data-mode]');
    ctx.openAccount(target ? target.dataset.mode : 'signin');
  });
  $('#btn-review').addEventListener('click', () => ctx.toggleReviewPanel());
  $('#btn-review-close').addEventListener('click', closeReview);
  $('#btn-review-report').addEventListener('click', () => ctx.exportReviewReport());
  $('#btn-prev-change').addEventListener('click', () => stepReview(-1));
  $('#btn-next-change').addEventListener('click', () => stepReview(1));
  $('#btn-accept-all').addEventListener('click', () => resolveAll('accept', false));
  $('#btn-reject-all').addEventListener('click', () => resolveAll('reject', false));
  $('#btn-accept-stop').addEventListener('click', () => resolveAll('accept', true));
  $('#btn-reject-stop').addEventListener('click', () => resolveAll('reject', true));
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
      if (app.find.isOpen) { ctx.openFind(); return; }
      if (app.sources.isOpen) { ctx.toggleSourcePanel(); return; }
      if (app.footnotes.isOpen) { ctx.toggleFootnotePanel(); return; }
      if (!$('#issues').hidden) { closeIssues(); return; }
      return;
    }

    /* Tab switching lives on Ctrl+Alt, and every other combination was tried
       first: Ctrl+W and Ctrl+Tab belong to the browser and Chrome ignores
       preventDefault on them; plain Alt+Left and Alt+Right are back and
       forward; Alt+digit is taken on some platforms. Ctrl+Alt is free. */
    if (e.altKey && (e.ctrlKey || e.metaKey)) {
      // Digit1..Digit9, not the character - a Persian layout prints ۱ here.
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit) {
        const target = app.session.tabs[Number(digit[1]) - 1];
        if (target) { e.preventDefault(); activate(target.id); }
        return;
      }
      if (e.code === 'KeyW') {
        e.preventDefault();
        if (tab()) closeTab(tab().id);
        return;
      }
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        const list = app.session.tabs;
        if (list.length < 2) return;
        e.preventDefault();
        const index = list.findIndex((t) => t.id === app.session.activeId);
        const step = e.code === 'ArrowRight' ? -1 : 1;   // RTL: right means back
        activate(list[(index + step + list.length) % list.length].id);
        return;
      }
    }

    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;   // Ctrl+Alt combinations were handled above

    /* event.code, not event.key: on a Persian keyboard the B key reports 'ذ'
       and every one of these shortcuts silently stopped working. The physical
       key never changes. */
    const code = e.code;

    if (code === 'Slash') { e.preventDefault(); shortcuts.toggle(); }
    // Not Ctrl+Shift+P: it sits one slipped modifier away from the browser's
    // print dialog, and a publish panel is not worth that risk.
    else if (e.shiftKey && code === 'KeyD') { e.preventDefault(); openPanel(); }
    else if (e.shiftKey && code === 'KeyF') { e.preventDefault(); ctx.toggleFootnotePanel(); }
    else if (e.shiftKey && code === 'KeyR') { e.preventDefault(); ctx.toggleReviewPanel(); }
    else if (e.shiftKey && code === 'KeyE') { e.preventDefault(); ctx.toggleTracking(); }
    else if (e.shiftKey && code === 'KeyU') { e.preventDefault(); ctx.saveToWorkspace(); }
    else if (e.shiftKey && code === 'KeyS') { e.preventDefault(); doSaveAs(); }
    else if (code === 'KeyS') { e.preventDefault(); doSave(); }
    else if (code === 'KeyO') { e.preventDefault(); doOpen(); }
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
    remote.unwatchAll();
    remote.leavePresence();
    if (!app.session.hasUnsaved) return;
    e.preventDefault();
    e.returnValue = '';
  });

  setupGutter();
  setView(app.view);
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
    /* No blank tab on an empty start. An untitled document nobody asked for is
       clutter, and the welcome panel says what to do far better than an empty
       text pane does. One is opened the moment anything is typed or pasted -
       see the editor's change handler. */
    activate(app.session.activeId);
    updateStatusBar();
  });
}

/* --------------------------------------------------------------------------
   The status bar's overflow menu

   On a phone the bar keeps only what has to be read at a glance. The rest goes
   here - as a list with room for a full label and its current value, rather
   than a row of half-cut words.
   -------------------------------------------------------------------------- */

function setupStatusMenu() {
  const button = $('#btn-more');
  const menu = $('#st-menu');
  let unfollow = null;

  let release = null;

  const close = () => {
    menu.hidden = true;
    if (unfollow) { unfollow(); unfollow = null; }
    if (release) { release(); release = null; }
  };

  const open = () => {
    menu.innerHTML = '';

    // Built from the folded items themselves, so the menu can never drift out
    // of step with the bar.
    for (const source of document.querySelectorAll('.statusbar .st-fold')) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'st-menu__item';

      if (source.tagName === 'BUTTON') {
        item.textContent = source.textContent;
        if (source.getAttribute('aria-pressed') === 'true') {
          item.classList.add('st-menu__item--on');
        }
        item.addEventListener('click', () => { close(); source.click(); });
      } else {
        // A read-out rather than an action: show its label and its value.
        item.disabled = true;
        item.innerHTML = `<span>${esc(labelFor(source.id))}</span>` +
          `<span class="value">${esc(source.textContent)}</span>`;
      }

      menu.appendChild(item);
    }

    menu.hidden = false;
    place(menu, button, 'end');
    unfollow = follow(menu, button, close);
    release = claim(close);
  };

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (menu.hidden) open(); else close();
  });

  document.addEventListener('click', close);
}

const STATUS_LABELS = {
  wordcount: 'حجم متن',
  'ids-status': 'شناسه‌ها',
  'lint-status': 'ایرادها',
};

function labelFor(id) {
  return STATUS_LABELS[id] || '';
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
