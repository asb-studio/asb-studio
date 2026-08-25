/* ==========================================================================
   ui/workspace.js
   --------------------------------------------------------------------------
   The shared workspace browser.

   Lists what is in the workspace, who touched each document last, and who has
   it open right now. Opening one takes the lock; opening one somebody else
   holds gives you a read-only copy, which is the honest thing to do rather
   than pretending and losing the save later.
   ========================================================================== */

import {
  listDocuments, readDocument, claimDocument, writeDocument, deleteDocument,
  suggestPath,
} from '../storage/supabase.js';
import { CATEGORIES } from '../model/schema.js';
import * as dialog from './dialog.js';

const fa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** "۳ دقیقه پیش" reads better than a timestamp for something this recent. */
function ago(iso) {
  if (!iso) return '—';
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);

  if (seconds < 60) return 'همین حالا';
  if (seconds < 3600) return `${fa(Math.floor(seconds / 60))} دقیقه پیش`;
  if (seconds < 86400) return `${fa(Math.floor(seconds / 3600))} ساعت پیش`;
  if (seconds < 604800) return `${fa(Math.floor(seconds / 86400))} روز پیش`;

  return new Date(iso).toLocaleDateString('fa-IR');
}

/**
 * Opens the browser.
 * @param {object} handlers  { openDocument({path, content, readOnly}), currentEmail, toast }
 */
export async function openWorkspace(handlers) {
  const body = document.createElement('div');
  body.innerHTML = '<p class="dialog__text">در حال خواندن…</p>';

  const card = dialog.custom('فضای مشترک', body, [
    { label: 'بستن', value: null, primary: true, cancel: true },
  ], { wide: true });

  // Passed down so a deletion can redraw the list without closing it.
  handlers.refresh = async () => {
    try {
      render(body, await listDocuments(), handlers);
    } catch { /* the dialog already said what went wrong */ }
  };

  try {
    const rows = await listDocuments();
    render(body, rows, handlers);
  } catch (err) {
    body.innerHTML = `<p class="dialog__text">خواندن فضای مشترک ممکن نشد: ${esc(String(err.message || err))}</p>`;
  }

  await card;
}

function render(root, rows, handlers) {
  root.innerHTML = '';

  if (rows.length === 0) {
    root.innerHTML = `<p class="ws-empty">
      هنوز سندی در فضای مشترک نیست. یک فایل را باز کن و «فرستادن به فضای مشترک» را بزن.
    </p>`;
    return;
  }

  const mine = handlers.currentEmail;

  for (const row of rows) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'ws-row';

    const path = document.createElement('span');
    path.className = 'ws-path';
    path.textContent = row.path;

    const meta = document.createElement('span');
    meta.className = 'ws-meta';
    // The part before the @ is the closest thing to a name the row carries;
    // a full address here is noise in a list of twenty.
    const who = String(row.updated_email || '').split('@')[0] || '—';
    meta.textContent = `${who} · ${ago(row.updated_at)}`;

    item.append(path, meta);

    if (row.isLocked) {
      const lock = document.createElement('span');
      const isMine = row.lockedBy === mine;
      lock.className = 'ws-lock' + (isMine ? ' ws-lock--mine' : '');
      lock.textContent = isMine ? 'دست خودت' : `دست ${String(row.lockedBy).split('@')[0]}`;
      item.appendChild(lock);
    }

    item.addEventListener('click', () => openOne(row, handlers));

    /* A workspace with no way to remove anything is not a workspace, it is a
       loft. Deletion sits on the row rather than behind a menu, because the
       moment you want it is the moment you are looking at the thing. */
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ws-remove';
    remove.dataset.tip = 'حذف از فضای مشترک';
    remove.setAttribute('aria-label', `حذف ${row.path}`);
    remove.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13"/></svg>`;

    remove.addEventListener('click', async (event) => {
      event.stopPropagation();
      await removeOne(row, handlers);
    });

    const line = document.createElement('div');
    line.className = 'ws-line';
    line.append(item, remove);
    root.appendChild(line);
  }
}

/* Deleting is not undoable and there is no bin, so the path has to be typed.
   That sounds heavy-handed until you picture losing the wrong manuscript. */
async function removeOne(row, handlers) {
  if (row.isLocked && row.lockedBy !== handlers.currentEmail) {
    await dialog.say('نمی‌شود حذف کرد',
      `${row.lockedBy} الان این سند را باز دارد.`);
    return;
  }

  const body = document.createElement('div');
  body.innerHTML = `
    <p class="dialog__text">
      این سند از فضای مشترک برداشته می‌شود. نسخه‌ی روی کامپیوترها دست نمی‌خورد،
      پس اگر لازم شد می‌شود دوباره فرستادش.
    </p>
    <p class="dialog__text mono" style="color:var(--fg-dim);font-size:0.78rem">${esc(row.path)}</p>`;

  const go = await dialog.custom('کارت با این سند تمام شده؟', body, [
    { label: 'نه', value: false, cancel: true },
    { label: 'بله، حذف کن', value: true, danger: true },
  ]);
  if (!go) return;

  try {
    await deleteDocument(row.path);
    handlers.toast('از فضای مشترک حذف شد');
    handlers.refresh();
  } catch (err) {
    await dialog.say('حذف نشد', String(err.message || err));
  }
}

async function openOne(row, handlers) {
  try {
    const full = await readDocument(row.path);
    if (!full) { handlers.toast('این سند دیگر آنجا نیست'); return; }

    if (String(full.content || '').trim() === '') {
      await dialog.say('این سند خالی است',
        'در فضای مشترک برای این مسیر متنی ثبت نشده. اگر قبلاً چیزی فرستاده بودی، '
        + 'ذخیره‌اش ناتمام مانده — نسخه‌ی روی دیسک خودت را باز کن و دوباره بفرست.');
      return;
    }

    const heldByOther = full.isLocked && full.lockedBy !== handlers.currentEmail;

    if (heldByOther) {
      const readOnly = await dialog.ask('این فایل باز است',
        `${full.lockedBy} الان این فایل را باز دارد. می‌توانی بازش کنی و بخوانی، ولی تا وقتی رهایش نکرده ذخیره نمی‌شود.`,
        { confirmLabel: 'فقط بخوان', cancelLabel: 'بی‌خیال' });
      if (!readOnly) return;

      dialog.close();
      handlers.openDocument({
        path: full.path, content: full.content,
        baseline: full.baseline, readOnly: true,
      });
      return;
    }

    await claimDocument(full.path);
    dialog.close();
    handlers.openDocument({
      path: full.path, content: full.content,
      baseline: full.baseline, readOnly: false,
    });
  } catch (err) {
    if (err && err.code === 'locked') {
      await dialog.say('این فایل باز است', err.message);
      return;
    }
    await dialog.say('باز کردن ممکن نشد', String(err.message || err));
  }
}

/**
 * Sends the document in front of the author to the workspace, asking where it
 * should live. The path is its identity, so it is worth getting right once.
 */
export async function pushToWorkspace(doc, fileName, content, handlers) {
  const category = String(doc.frontmatter.get('category') || '');
  const slug = String(doc.frontmatter.get('slug') || '').trim();

  /* A NAME, NOT A SLUG. A piece being drafted has no slug yet - that is
     decided at publication - and refusing to name a file until then meant
     everything in the workspace was called "بدون‌نام". The name is what a
     person calls the thing; the slug is what the site calls it. */
  const suggestedName = slug || String(fileName).replace(/\.(md|markdown)$/i, '')
    .replace(/^بدون‌نام$/, '');

  /* The folder is a CHOICE, not a spelling test. The sections come from the
     same list the site uses (data/categories.json), the document's own
     category pre-selects itself, and a legacy value that is no longer on the
     list still shows - marked - rather than silently jumping somewhere else. */
  const folderOptions = {};
  for (const [slug, label] of Object.entries(CATEGORIES)) {
    folderOptions[slug] = `${label} — ${slug}`;
  }
  if (category && !folderOptions[category]) {
    folderOptions[category] = `${category} (قدیمی)`;
  }
  if (!category) {
    folderOptions.main = 'بدون پوشه — main';
  }

  const values = await dialog.form('ذخیره در فضای مشترک', [
    { name: 'name', label: 'نام فایل', value: suggestedName,
      hint: 'هرچه بخواهی. بعداً هم می‌شود عوضش کرد.' },
    { name: 'folder', label: 'بخش', type: 'select',
      value: category || 'main', options: folderOptions,
      hint: 'همان بخشی از سایت که این نوشته به آن تعلق دارد.' },
  ], { confirmLabel: 'ذخیره' });

  if (!values || !values.name.trim()) return null;

  const clean = values.name.trim().replace(/\.(md|markdown)$/i, '');
  const folder = values.folder.trim().replace(/^\/+|\/+$/g, '');
  const path = folder ? `${folder}/${clean}.md` : `${clean}.md`;

  try {
    /* THE TEXT GOES UP BEFORE THE LOCK, and the order matters more than it
       looks. Claiming first creates the row with empty content; if the write
       that follows then fails, what is left behind is a blank document that
       looks saved. Writing first means a failure leaves nothing at all -
       which is the honest outcome. */
    await writeDocument(path, content, handlers.baseline);
    await claimDocument(path);
    handlers.toast('در فضای مشترک ذخیره شد');
    return { path, name: `${clean}.md` };
  } catch (err) {
    if (err && err.code === 'locked') {
      await dialog.say('این مسیر باز است', err.message);
      return null;
    }
    await dialog.say('فرستادن ممکن نشد', String(err.message || err));
    return null;
  }
}
