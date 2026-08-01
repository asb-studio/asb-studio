/* ==========================================================================
   ui/archive.js
   --------------------------------------------------------------------------
   The archive browser.

   Point it at the site's `main/` folder once and it reads every .md under it,
   reports what each one needs, and opens any of them with a click. For an
   archive of a few hundred files that is the difference between knowing its
   condition and guessing at it.

   It can also repair in bulk - but never quietly. Every batch run says
   beforehand which files it will touch and afterwards exactly what it did.
   ========================================================================== */

import { pickFolder, scanMarkdown, writeFile, groupByFolder, canBrowseFolders } from '../storage/archive.js';
import { parseDocument, serializeDocument } from '../model/document.js';
import { lintDocument, SEVERITY } from '../markdown/lint.js';
import { validateDocument, validateFileName } from '../model/validate.js';
import { repairBody } from '../markdown/repair.js';
import { migrateBody, findRemainingHtml } from '../markdown/migrate.js';
import { countMissingIds, assignParagraphIds } from '../model/paragraph-ids.js';
import { countChanges } from '../markdown/critic.js';
import { detectType } from '../model/doctype.js';
import * as dialog from './dialog.js';

const fa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Kept between openings so the folder is only chosen once per session. */
let folderHandle = null;
let scanned = [];

/** What a single file needs, without changing anything. */
function inspect(file) {
  const doc = parseDocument(file.text);
  const lint = lintDocument(doc);

  // The core contract: open a file, change nothing, save it - and get the
  // same bytes back. This used to be checked by a separate test page. It
  // belongs here instead, in the tool that already reads every file, so a
  // file that is unsafe to open says so before it is opened.
  let roundTrip = true;
  try {
    roundTrip = serializeDocument(parseDocument(file.text)) === file.text;
  } catch {
    roundTrip = false;
  }

  const type = detectType(doc);

  return {
    ...file,
    doc,
    type,
    roundTrip,
    errors: lint.filter((i) => i.severity === SEVERITY.ERROR).length,
    warnings: lint.filter((i) => i.severity === SEVERITY.WARN).length,
    blockers: validateDocument(doc).filter((i) => i.severity === 'block').length,
    badName: validateFileName(file.name).length > 0,
    repairable: repairBody(doc.body).total,
    legacy: migrateBody(doc.body).total,
    rawHtml: findRemainingHtml(doc.body).length,
    missingIds: countMissingIds(doc.body),
    tracked: countChanges(doc.body),
    // A profile has a name, not a title.
    title: String(doc.frontmatter.get('title') || doc.frontmatter.get('name') || file.name),
    people: type === 'work' ? {
      author: String(doc.frontmatter.get('author') || '').trim(),
      translator: String(doc.frontmatter.get('translator') || '').trim(),
      editor: String(doc.frontmatter.get('editor') || '').trim(),
    } : null,
    unlinked: [],
  };
}

/* --------------------------------------------------------------------------
   Names that do not connect

   build.py joins a work to a profile page by matching the author, translator
   and editor names EXACTLY against the `name` field of each creator file. One
   extra space and the link simply is not made - no error, no missing page,
   just a name that never becomes a link and works that never appear on the
   profile.

   Nothing but a whole-archive view can catch that, which is why it lives here
   and not in the linter.
   -------------------------------------------------------------------------- */

function crossCheckNames(files) {
  const known = new Set(
    files
      .filter((f) => f.type === 'creator')
      .map((f) => String(f.doc.frontmatter.get('name') || '').trim())
      .filter(Boolean)
  );

  const ROLE_LABELS = { author: 'نویسنده', translator: 'مترجم', editor: 'ویراستار' };

  for (const file of files) {
    file.unlinked = [];
    if (!file.people) continue;

    for (const [role, name] of Object.entries(file.people)) {
      if (!name || known.has(name)) continue;

      // A near miss is far more useful to report than a bare "not found".
      const near = [...known].find((k) => k.replace(/\s+/g, '') === name.replace(/\s+/g, ''));
      file.unlinked.push({
        role: ROLE_LABELS[role],
        name,
        near: near || null,
      });
    }
  }

  return files;
}

function statusOf(file) {
  // Worst first: a file that cannot survive a round trip must not be edited
  // here at all, whatever else is or is not wrong with it.
  if (!file.roundTrip) return { kind: 'unsafe', label: 'ناسالم' };
  if (file.legacy > 0) return { kind: 'legacy', label: 'قدیمی' };
  if (file.unlinked.length > 0) return { kind: 'unlinked', label: 'نام جدا' };
  if (file.badName) return { kind: 'warn', label: 'نام فایل' };
  if (file.errors > 0 || file.blockers > 0) return { kind: 'error', label: 'ایراد' };
  if (file.tracked > 0) return { kind: 'tracked', label: 'تغییر باز' };
  if (file.missingIds > 0 || file.warnings > 0) return { kind: 'warn', label: 'هشدار' };
  return { kind: 'ok', label: 'سالم' };
}

/**
 * Opens the browser.
 * @param {object} handlers  { openFile({name, text, handle}), toast(msg) }
 */
export async function openArchive(handlers) {
  if (!canBrowseFolders) {
    await dialog.say('مرور آرشیو',
      'این قابلیت به دسترسی مرورگر به پوشه نیاز دارد که فقط کروم و اِج می‌دهند. روی فایرفاکس فایل‌ها را یکی‌یکی باز کن.');
    return;
  }

  if (!folderHandle) {
    try {
      folderHandle = await pickFolder();
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      await dialog.say('مرور آرشیو', 'دسترسی به پوشه ممکن نشد.');
      return;
    }
    if (!folderHandle) return;
  }

  const body = document.createElement('div');
  body.innerHTML = '<p class="dialog__text">در حال خواندن پوشه…</p>';
  const card = dialog.custom('مرور آرشیو', body, [
    { label: 'بستن', value: null, primary: true, cancel: true },
  ], { wide: true });

  try {
    const files = await scanMarkdown(folderHandle);
    scanned = crossCheckNames(files.map(inspect));
    renderList(body, handlers);
  } catch (err) {
    body.innerHTML = `<p class="dialog__text">خواندن پوشه ممکن نشد: ${esc(String(err.message || err))}</p>`;
  }

  await card;
}

function renderList(root, handlers) {
  const totals = {
    all: scanned.length,
    unsafe: scanned.filter((f) => !f.roundTrip).length,
    unlinked: scanned.filter((f) => f.unlinked.length > 0).length,
    legacy: scanned.filter((f) => f.roundTrip && f.legacy > 0).length,
    errors: scanned.filter((f) => f.errors > 0 || f.blockers > 0).length,
    ids: scanned.filter((f) => f.roundTrip && f.missingIds > 0).length,
    repairable: scanned.filter((f) => f.roundTrip && f.repairable > 0).length,
  };

  root.innerHTML = `
    <div class="stats__grid">
      <div class="stats__cell"><span class="stats__value">${fa(totals.all)}</span>
        <span class="stats__label">فایل</span></div>
      <div class="stats__cell"><span class="stats__value">${fa(totals.legacy)}</span>
        <span class="stats__label">نیازمند تبدیل</span></div>
      <div class="stats__cell"><span class="stats__value">${fa(totals.errors)}</span>
        <span class="stats__label">دارای ایراد</span></div>
      <div class="stats__cell"><span class="stats__value">${fa(totals.unlinked)}</span>
        <span class="stats__label">نام وصل‌نشده</span></div>
      <div class="stats__cell"><span class="stats__value">${fa(totals.unsafe)}</span>
        <span class="stats__label">ناسالم</span></div>
    </div>`;

  /* --- batch actions --- */
  const actions = document.createElement('div');
  actions.className = 'ar-actions';

  const safe = scanned.filter((f) => f.roundTrip);
  const batch = (label, count, kind) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--outline';
    button.textContent = `${label} (${fa(count)})`;
    button.disabled = count === 0;
    button.addEventListener('click', () => runBatch(kind, root, handlers));
    return button;
  };

  actions.append(
    batch('تبدیل فایل‌های قدیمی', totals.legacy, 'migrate'),
    batch('تعمیر خودکار', totals.repairable, 'repair'),
    batch('دادن شناسه', totals.ids, 'ids'));
  root.appendChild(actions);

  /* --- the tree --- */
  const tree = document.createElement('div');
  tree.className = 'ar-tree';

  for (const group of groupByFolder(scanned)) {
    const folder = document.createElement('div');
    folder.className = 'ar-folder';
    folder.textContent = group.folder || '(ریشه)';
    tree.appendChild(folder);

    for (const file of group.items) {
      tree.appendChild(fileRow(file, handlers));
    }
  }

  root.appendChild(tree);
}

function fileRow(file, handlers) {
  const status = statusOf(file);

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'ar-row';

  const badge = document.createElement('span');
  badge.className = `ar-status ar-status--${status.kind}`;
  badge.textContent = status.label;

  const name = document.createElement('span');
  name.className = 'ar-name';
  name.textContent = file.title;

  const path = document.createElement('span');
  path.className = 'ar-path mono';
  path.textContent = file.name;

  const notes = [];
  if (!file.roundTrip) notes.push('باز و بسته کردنش فایل را عوض می‌کند — با استودیو ویرایشش نکن');
  if (file.legacy) notes.push(`${fa(file.legacy)} مورد قدیمی`);
  if (file.rawHtml) notes.push(`${fa(file.rawHtml)} جا HTML`);
  if (file.errors) notes.push(`${fa(file.errors)} خطا`);
  if (file.blockers) notes.push(`${fa(file.blockers)} مانع انتشار`);
  if (file.missingIds) notes.push(`${fa(file.missingIds)} بی‌شناسه`);
  if (file.badName) notes.push('نام فایل کاراکتر غیرمجاز دارد و در آدرس صفحه می‌آید');
  if (file.tracked) notes.push(`${fa(file.tracked)} تغییر باز`);
  for (const miss of file.unlinked) {
    notes.push(miss.near
      ? `${miss.role} «${miss.name}» به هیچ صفحه‌ای وصل نیست — شاید منظورت «${miss.near}» بوده`
      : `${miss.role} «${miss.name}» صفحه‌ی پدیدآورنده ندارد`);
  }

  const detail = document.createElement('span');
  detail.className = 'ar-detail';
  detail.textContent = notes.join(' · ');

  row.append(badge, name, path, detail);
  row.addEventListener('click', () => {
    dialog.close();
    handlers.openFile({ name: file.name, text: file.text, handle: file.handle });
  });

  return row;
}

/* --------------------------------------------------------------------------
   Batch runs
   -------------------------------------------------------------------------- */

const BATCH = {
  migrate: {
    title: 'تبدیل فایل‌های قدیمی',
    verb: 'تبدیل',
    pick: (f) => f.legacy > 0,
    apply: (body) => migrateBody(body),
  },
  repair: {
    title: 'تعمیر خودکار',
    verb: 'تعمیر',
    pick: (f) => f.repairable > 0,
    apply: (body) => repairBody(body),
  },
  ids: {
    title: 'دادن شناسه‌ی دائمی',
    verb: 'شناسه‌گذاری',
    pick: (f) => f.missingIds > 0,
    apply: (body) => {
      const result = assignParagraphIds(body);
      return { body: result.body, total: result.added };
    },
  },
};

async function runBatch(kind, root, handlers) {
  const job = BATCH[kind];
  const targets = scanned.filter((f) => f.roundTrip && job.pick(f));
  if (targets.length === 0) return;

  const list = document.createElement('div');
  list.innerHTML = `
    <p class="dialog__text">
      ${fa(targets.length)} فایل روی دیسک بازنویسی می‌شود. این کار <b>واگرد ندارد</b> —
      قبلش مطمئن شو تغییرهای فعلی‌ات را در گیت کامیت کرده‌ای.
    </p>
    ${targets.slice(0, 20).map((f) => `
      <div class="stats__row"><span class="mono">${esc(f.path)}</span>
        <span class="spacer"></span></div>`).join('')}
    ${targets.length > 20 ? `<p class="dialog__text">و ${fa(targets.length - 20)} فایل دیگر…</p>` : ''}`;

  const go = await dialog.custom(job.title, list, [
    { label: 'انصراف', value: false, cancel: true },
    { label: `${job.verb} ${fa(targets.length)} فایل`, value: true, danger: true },
  ], { wide: true });
  if (!go) return;

  let changed = 0;
  let items = 0;
  const failed = [];

  for (const file of targets) {
    try {
      const doc = parseDocument(file.text);
      const result = job.apply(doc.body);
      if (!result.total) continue;

      doc.setBody(result.body);
      const text = doc.serialize();
      await writeFile(file.handle, text);

      file.text = text;
      changed++;
      items += result.total;
    } catch (err) {
      failed.push(`${file.path}: ${err.message || err}`);
    }
  }

  // Re-inspect from the text now on disk, so the list tells the truth.
  scanned = crossCheckNames(
    scanned.map((f) => inspect({ path: f.path, name: f.name, handle: f.handle, text: f.text })));
  renderList(root, handlers);

  const report = document.createElement('div');
  report.innerHTML = `
    <p class="dialog__text">
      ${fa(changed)} فایل بازنویسی شد و در مجموع ${fa(items)} مورد ${job.verb} شد.
    </p>
    ${failed.length ? `<div class="stats__section"><h3>ناموفق</h3>
      ${failed.map((f) => `<div class="stats__row"><span class="mono">${esc(f)}</span></div>`).join('')}
    </div>` : ''}`;

  await dialog.custom(job.title, report,
    [{ label: 'باشد', value: true, primary: true, cancel: true }], { wide: true });
}

/** Forgets the folder, so the next open asks again. */
export function forgetFolder() {
  folderHandle = null;
  scanned = [];
}
