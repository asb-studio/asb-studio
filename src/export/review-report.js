/* ==========================================================================
   export/review-report.js
   --------------------------------------------------------------------------
   The page an author is sent to see what an edit did to their work.

   Built from a comparison, not from hand-placed marks: the studio kept a
   snapshot of the text when tracking was switched on, and everything shown
   here is the difference between that and the text now. So the editor edits
   normally and this page still knows exactly what moved.

   Two views, the way Word has them:

     نمایش تغییرات   every addition and deletion visible
     متن نهایی       the text as it would be published

   Comments survive both, because a comment is a question put to the author
   and is not part of the text either way.

   One self-contained file: no server, no build, nothing to install. It opens
   on a phone and can be attached to an email.
   ========================================================================== */

import { diffWords, diffSummary } from '../markdown/diff.js';
import { findChanges } from '../markdown/critic.js';
import { createRenderer } from '../markdown/preview.js';
import { textDirection } from '../markdown/direction.js';

const renderer = createRenderer();

const esc = (s) => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const fa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

/* Sentinels, so the marks survive being run through the Markdown renderer.
   Private use codepoints cannot occur in real Persian prose. */
const S = {
  insOpen: '\uE010', insClose: '\uE011',
  delOpen: '\uE012', delClose: '\uE013',
  noteOpen: '\uE014', noteClose: '\uE015',
};

/* The house mark, inlined so the page needs nothing from anywhere. */
const HORSE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" aria-hidden="true"><path d="M378 172.1c-46.5 5.2-97.7 22.5-133.7 45.2-4.6 2.8-8.3 5.4-8.3 5.7s2.2 1.6 4.8 3.1c5.2 2.8 38.5 21.9 39.1 22.5.2.1-1.5 4.5-3.7 9.6-8.7 20.4-13.7 42.7-14.8 66.9-1.1 23.8 1.4 41.8 11.1 80.9 10.2 41.1 14.8 70.3 16.4 105.3 1.2 24.4 1.8 26 12.9 34.8 17.5 14 27.9 19.5 34.5 18.5 7.4-1.2 35.7-20.4 40.4-27.4 3-4.6 4.3-11.6 4.3-23.7 0-27.1 6-45.4 19.5-59.1 5.9-6.1 8.9-8.1 19.4-13.4 20.1-10 27.7-19.9 32.3-41.6 4.3-21.1 0-55.1-9.4-73.7-3.5-7-1.1-5 4.9 4 11.5 17.1 17.2 29.7 21.4 46.4 2 8 2.3 11.9 2.3 25.9 0 17.5-1.3 24.8-8 46.9-7.9 25.9-25.5 56.6-56.5 98.1-37.2 50-56.3 85.3-69.2 128-9.1 29.9-12 51.7-12.1 91l-.1 29.5 2.8 5.7c3.4 6.9 9.2 12 16.2 14.2 4.6 1.5 24.2 1.6 219 1.4l214-.3 5.1-2.7c5.3-2.8 10.1-7.6 13.1-13.1 1.6-2.9 1.8-6.4 1.7-34.7-.1-41.1-2.5-72.6-8.5-113.9-3.7-25.1-11.5-65.5-13.6-69.8-2.7-5.7-6.6-6.7-23.3-5.9-56.7 2.6-120.5 17.1-175.2 40-45.9 19.1-89.6 46.2-126.7 78.2-17.6 15.3-19.3 16.5-9.6 6.5 11.3-11.6 28.3-26.9 43.1-38.7C551 608.5 644.1 570.5 744.5 556c17.2-2.5 20.2-3.2 21.8-5.1.9-1.2 1.7-3 1.7-4 0-2.6-9.5-31.1-18.1-54-50.2-135-106.9-218-185.3-271.4-43.2-29.4-85.2-44.8-135.1-49.5-12.7-1.2-40.6-1.1-51.5.1"/></svg>`;

/* --------------------------------------------------------------------------
   Marking up the text
   -------------------------------------------------------------------------- */

/* --------------------------------------------------------------------------
   Comments are not edits

   A note is something said ABOUT the text, not a change to it - so it takes no
   part in the comparison. Feeding it to the diff made the word it was attached
   to look rewritten, and counted a question as a change.

   So the two texts are compared with comments stripped, and the notes are
   spliced back afterwards at the exact offsets they occupied. Because the
   marked-up result contains every character of the new text in order, walking
   the ops gives those offsets precisely.
   -------------------------------------------------------------------------- */

/** Every mark resolved, comments included - the text as it would be read. */
function plain(text) {
  return text
    .replace(/\{\+\+([\s\S]*?)\+\+\}/g, '$1')
    .replace(/\{--([\s\S]*?)--\}/g, '')
    .replace(/\{~~([\s\S]*?)~>([\s\S]*?)~~\}/g, '$2')
    .replace(/\{==([\s\S]*?)==\}/g, '$1')
    .replace(/\{>>([\s\S]*?)<<\}/g, '');
}

/** Strips comments, remembering where each one sat. */
function extractComments(text) {
  const notes = [];
  let out = '';
  let index = 0;

  const pattern = /\{>>([\s\S]*?)<<\}/g;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    out += text.slice(index, match.index);
    notes.push({ at: out.length, body: match[1] });
    index = match.index + match[0].length;
  }
  out += text.slice(index);

  return { text: out, notes };
}

/** The text, marked up with sentinels ready for the renderer. */
function markedSource(before, after) {
  // Trailing blank lines differ between a saved file and a live buffer, and a
  // deleted newline at the very end renders as a stray mark that also breaks
  // the attribute list on the last line.
  const beforePlain = plain(before).replace(/\s+$/, '');
  const { text: afterPlain, notes } = extractComments(
    after
      .replace(/\{\+\+([\s\S]*?)\+\+\}/g, '$1')
      .replace(/\{--([\s\S]*?)--\}/g, '')
      .replace(/\{~~([\s\S]*?)~>([\s\S]*?)~~\}/g, '$2')
      .replace(/\{==([\s\S]*?)==\}/g, '$1')
      .replace(/\s+$/, '')
  );

  let out = '';
  let cursor = 0;   // how far through afterPlain the ops have taken us
  let next = 0;     // the next note waiting to be placed

  const emit = (text, wrap) => {
    // A deletion is not part of the new text, so it carries no notes and does
    // not move the cursor.
    if (wrap === 'del') { out += S.delOpen + text + S.delClose; return; }

    let rest = text;
    let base = cursor;

    while (next < notes.length && notes[next].at <= base + rest.length) {
      const cut = notes[next].at - base;
      const head = rest.slice(0, cut);

      out += wrap === 'ins' && head ? S.insOpen + head + S.insClose : head;
      out += S.noteOpen + notes[next].body + S.noteClose;

      rest = rest.slice(cut);
      base = notes[next].at;
      next++;
    }

    if (rest) out += wrap === 'ins' ? S.insOpen + rest + S.insClose : rest;
    cursor += text.length;
  };

  for (const op of diffWords(beforePlain, afterPlain)) {
    emit(op.text, op.type === 'ins' ? 'ins' : op.type === 'del' ? 'del' : 'same');
  }

  // Anything left over sat at the very end of the text.
  while (next < notes.length) {
    out += S.noteOpen + notes[next].body + S.noteClose;
    next++;
  }

  return out;
}

function render(source) {
  let html = renderer.render(
    source
      .replace(/<!--\s*(EREADER-START|PAYWALL)\s*-->/g, '')
      .replace(/\\(\r?\n)/g, '$1')
  );

  // Sentinels become real elements only after Markdown has run, so a mark
  // spanning a bold word or a link cannot break the syntax around it.
  html = html
    .split(S.insOpen).join('<ins class="c-ins">').split(S.insClose).join('</ins>')
    .split(S.delOpen).join('<del class="c-del">').split(S.delClose).join('</del>');

  // Comments become a marker the reader taps rather than a block of text
  // sitting in the middle of a sentence.
  let noteIndex = 0;
  while (html.includes(S.noteOpen)) {
    noteIndex++;
    const start = html.indexOf(S.noteOpen);
    const end = html.indexOf(S.noteClose, start);
    if (end === -1) break;

    const body = html.slice(start + 1, end);
    html = html.slice(0, start)
      + `<button class="c-note" type="button" data-note="${noteIndex}"
           aria-label="یادداشت ویراستار ${noteIndex}">
           <span class="c-note__pin">${fa(noteIndex)}</span>
           <span class="c-note__body">${body}</span>
         </button>`
      + html.slice(end + 1);
  }

  /* Every paragraph is given a number so a reply can name the place it is
     about. The permanent #p- ids would be better, but a paragraph the editor
     added has none - and a reply that cannot say where it belongs is a reply
     nobody can act on. */
  let blockIndex = 0;
  html = html.replace(/<(p|h1|h2|h3|blockquote)(\s|>)/g, (whole, tag, tail) => {
    blockIndex++;
    return `<${tag} data-block="${blockIndex}"${tail}`;
  });

  // Footnotes, in the shape the site uses.
  html = html.replace(/(<a class="footnote-ref"[^>]*>)(\d+)(<\/a>)/g,
    (_, open, digits, close) => open + fa(digits) + close);
  html = html.replace(/<hr class="footnotes-sep"\s*\/?>\s*/g, '');
  html = html.replace(/<section class="footnotes">/, '<section class="footnote"><h3>پانویس‌ها</h3>');
  html = html.replace(/<li id="fn-(\d+)" class="footnote-item">([\s\S]*?)<\/li>/g,
    (whole, id, inner) =>
      `<li id="fn-${id}" dir="${textDirection(inner.replace(/<[^>]+>/g, ' '))}">${inner}</li>`);

  return html;
}

/* --------------------------------------------------------------------------
   The page
   -------------------------------------------------------------------------- */

function styles() {
  return `
  @font-face {
    font-family: 'Vazirmatn';
    src: url('https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Regular.woff2') format('woff2');
    font-weight: 400; font-display: swap;
  }
  @font-face {
    font-family: 'Vazirmatn';
    src: url('https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Bold.woff2') format('woff2');
    font-weight: 700; font-display: swap;
  }

  :root {
    --paper: #fdf9ee; --bg: #e7e0cf; --ink: #3a352c; --dim: #6b6354;
    --line: #d5ccb4; --ochre: #b07d00;
    --ins: #1f6b46; --ins-bg: rgba(31, 107, 70, 0.13);
    --del: #a3302a; --del-bg: rgba(163, 48, 42, 0.11);
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Vazirmatn', Tahoma, sans-serif;
    background: var(--bg); color: var(--ink);
    line-height: 2.1; padding: 22px 14px 60px;
  }

  .sheet {
    max-width: 46rem; margin: 0 auto; background: var(--paper);
    border: 1px solid var(--line); border-radius: 12px;
    padding: 40px 44px 50px;
  }

  header { text-align: center; padding-bottom: 24px; border-bottom: 1px solid var(--line); }
  .mark { width: 58px; height: 58px; margin: 0 auto 14px; }
  .mark svg { width: 100%; height: 100%; display: block; fill: var(--ink); }
  h1 { font-size: 1.5rem; line-height: 1.6; margin-bottom: 8px; }
  .byline { font-size: 0.88rem; color: var(--dim); }

  .credits {
    display: grid; gap: 1px; margin: 22px 0 4px;
    border: 1px solid var(--line); border-radius: 10px; overflow: hidden;
    background: var(--line);
  }
  .credits > div {
    display: grid; grid-template-columns: 8.5rem 1fr;
    background: var(--paper);
  }
  .credits dt {
    padding: 10px 16px; font-size: 0.82rem; color: var(--dim);
    background: rgba(176, 125, 0, 0.05);
  }
  .credits dd { padding: 10px 16px; font-size: 0.9rem; font-weight: 700; }

  .note-to-author {
    margin: 0 0 28px; padding: 16px 20px;
    border-inline-start: 3px solid var(--ochre);
    background: rgba(176, 125, 0, 0.05);
    font-size: 0.9rem; line-height: 2;
  }

  /* --- the two views ---------------------------------------------------- */
  .views {
    display: flex; gap: 6px; justify-content: center;
    margin: 24px 0 6px; flex-wrap: wrap;
  }
  .views button {
    font-family: inherit; font-size: 0.83rem; color: var(--dim);
    background: transparent; border: 1px solid var(--line);
    border-radius: 20px; padding: 8px 20px; cursor: pointer;
    transition: all .15s;
  }
  .views button:hover { border-color: var(--ochre); color: var(--ink); }
  .views button[aria-pressed="true"] {
    background: var(--ochre); border-color: var(--ochre); color: #fff; font-weight: 700;
  }

  .tally {
    display: flex; flex-wrap: wrap; gap: 8px; justify-content: center;
    margin: 14px 0 26px; font-size: 0.78rem; color: var(--dim);
  }
  .tally span { padding: 4px 12px; border-radius: 20px; border: 1px solid var(--line); }

  .legend {
    margin: 0 0 30px; padding: 18px 20px;
    background: rgba(176, 125, 0, 0.06);
    border: 1px solid var(--line); border-radius: 10px;
    font-size: 0.86rem; line-height: 2;
  }
  .legend h2 { font-size: 0.95rem; margin-bottom: 8px; }
  .legend p { color: var(--dim); margin-bottom: 10px; }
  .legend ul { list-style: none; display: grid; gap: 7px; }
  .legend li { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }

  /* --- the text --------------------------------------------------------- */
  article { font-size: 1.04rem; text-align: justify; }
  article p { margin-bottom: 1.1em; text-indent: 1.7em; }
  article p:first-of-type, article h1 + p, article h2 + p, article h3 + p,
  article blockquote + p, article hr + p, article p.no-indent { text-indent: 0; }
  article h1, article h2, article h3 { margin: 1.9em 0 .7em; line-height: 1.6; text-align: start; }
  article h1 { font-size: 1.35rem; } article h2 { font-size: 1.2rem; }
  article h3 { font-size: 1.06rem; color: var(--ochre); }
  article blockquote {
    margin: 1.6em 0; padding: .3em 1.2em;
    border-inline-start: 3px solid var(--ochre); color: var(--dim); font-style: italic;
  }
  article blockquote p { text-indent: 0; }
  article .poem {
    white-space: pre-line; text-indent: 0; text-align: center; font-style: italic;
    margin: 1.9em auto; padding: 1.3em; border: 1px solid var(--line); border-radius: 12px;
  }
  article .text-center { text-indent: 0; text-align: center; }
  article hr { border: 0; border-top: 1px solid var(--line); width: 38%; margin: 2.4em auto; }
  article a { color: var(--ochre); font-weight: 700; text-decoration: none; }
  article ol, article ul { padding-inline-start: 1.6em; margin-bottom: 1.1em; }
  article li { margin-bottom: .5em; }

  /* Colour and shape both, so the page still reads printed in black and white
     or by someone who cannot tell the two colours apart. */
  ins.c-ins {
    background: var(--ins-bg); color: var(--ins);
    text-decoration: underline; text-underline-offset: 3px;
    padding: 1px 2px; border-radius: 3px;
  }
  del.c-del {
    background: var(--del-bg); color: var(--del);
    text-decoration: line-through; padding: 1px 2px; border-radius: 3px;
  }

  /* --- comments --------------------------------------------------------- */
  .c-note {
    display: inline; font: inherit; color: inherit;
    background: none; border: 0; padding: 0; cursor: pointer;
    position: relative;
  }
  .c-note__pin {
    display: inline-grid; place-items: center;
    width: 19px; height: 19px; border-radius: 50%;
    background: var(--ochre); color: #fff;
    font-size: .68rem; font-weight: 700; vertical-align: middle;
    margin: 0 2px;
  }
  .c-note__body {
    display: none; position: absolute; z-index: 5;
    inset-inline-start: 0; top: calc(100% + 6px);
    width: min(280px, 74vw); padding: 11px 14px;
    background: var(--ink); color: #f7f3e8;
    border-radius: 9px; font-size: .82rem; line-height: 1.9;
    text-align: start; text-indent: 0;
    box-shadow: 0 6px 20px rgba(0,0,0,.25);
  }
  .c-note.open .c-note__body { display: block; }

  /* --- the clean view --------------------------------------------------- */
  body.clean ins.c-ins { background: none; color: inherit; text-decoration: none; padding: 0; }
  body.clean del.c-del { display: none; }

  /* --- the author's replies -------------------------------------------- */
  .reply-btn {
    display: block; margin: 6px 0 0 auto;
    font: inherit; font-size: .74rem; color: var(--dim);
    background: none; border: 1px dashed var(--line); border-radius: 20px;
    padding: 3px 12px; cursor: pointer;
  }
  .reply-btn:hover { border-color: var(--ochre); color: var(--ochre); }
  .reply-btn.has { border-style: solid; border-color: var(--ochre); color: var(--ochre); }

  .reply-box {
    margin: 8px 0 4px; padding: 12px 14px;
    background: rgba(176,125,0,.06);
    border-inline-start: 3px solid var(--ochre); border-radius: 0 8px 8px 0;
  }
  .reply-box textarea {
    width: 100%; min-height: 68px; resize: vertical;
    font: inherit; font-size: .88rem; line-height: 1.9;
    color: var(--ink); background: var(--paper);
    border: 1px solid var(--line); border-radius: 6px; padding: 9px 11px;
  }
  .reply-box .row { display: flex; gap: 8px; margin-top: 8px; }
  .reply-box button {
    font: inherit; font-size: .78rem; padding: 6px 16px;
    border-radius: 6px; cursor: pointer;
    background: var(--ochre); color: #fff; border: 0;
  }
  .reply-box button.quiet { background: none; color: var(--dim); border: 1px solid var(--line); }

  .replies-bar {
    position: sticky; bottom: 0; z-index: 10;
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    margin: 30px -44px -50px; padding: 14px 44px;
    background: var(--paper); border-top: 1px solid var(--line);
    font-size: .84rem; color: var(--dim);
  }
  .replies-bar button {
    font: inherit; padding: 8px 18px; border-radius: 8px; cursor: pointer;
    background: var(--ochre); color: #fff; border: 0; font-weight: 700;
  }
  .replies-bar button.quiet { background: none; color: var(--dim); border: 1px solid var(--line); font-weight: 400; }

  .footnote { margin-top: 3rem; padding-top: 1.4rem; border-top: 1px solid var(--line); font-size: .9rem; color: var(--dim); }
  .footnote h3 { font-size: 1rem; margin-bottom: 1rem; }
  .footnote li { margin-bottom: .7em; }
  .footnote li p { display: inline; text-indent: 0; }

  footer {
    margin-top: 44px; padding-top: 22px; border-top: 1px solid var(--line);
    text-align: center; color: var(--dim); font-size: .85rem; line-height: 2;
  }
  footer strong { color: var(--ink); }

  @media (max-width: 640px) {
    body { padding: 10px 8px 40px; }
    .sheet { padding: 24px 18px 34px; border-radius: 10px; }
    h1 { font-size: 1.2rem; }
    article { font-size: 1rem; }
    .views button { padding: 7px 15px; font-size: .78rem; }
    .replies-bar { margin: 24px -20px -36px; padding: 12px 20px; }
    .credits > div { grid-template-columns: 6.5rem 1fr; }
    .credits dt, .credits dd { padding: 8px 12px; font-size: 0.8rem; }
  }

  @media print {
    body { background: #fff; padding: 0; }
    .sheet { border: 0; max-width: none; padding: 0; }
    .views { display: none; }
    .legend, .c-note__body { break-inside: avoid; }
    .c-note__body { display: block; position: static; width: auto; background: none;
                    color: var(--dim); border: 1px dashed var(--ochre); box-shadow: none; }
  }
  `;
}

const SCRIPT = `
(function () {
  var body = document.body;

  /* --- the two views ---------------------------------------------------- */
  var viewButtons = document.querySelectorAll('[data-view]');

  function show(view) {
    body.classList.toggle('clean', view === 'clean');
    viewButtons.forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.view === view));
    });
  }

  viewButtons.forEach(function (b) {
    b.addEventListener('click', function () { show(b.dataset.view); });
  });
  show('marked');

  /* --- the editor's comments -------------------------------------------- */
  document.addEventListener('click', function (event) {
    var note = event.target.closest('.c-note');
    document.querySelectorAll('.c-note.open').forEach(function (n) {
      if (n !== note) n.classList.remove('open');
    });
    if (note) note.classList.toggle('open');
  });

  /* --- the author's replies ---------------------------------------------
     Kept in this browser while the page is open, so a long read can be put
     down and picked up. Sending is a download, because there is no server on
     the other end of this file - and a file is something an author already
     knows how to send back. */
  var KEY = 'asb-review:' + (document.title || 'review');
  var replies = {};

  try { replies = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { replies = {}; }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(replies)); } catch (e) {}
    refreshBar();
  }

  var bar = document.getElementById('replies-bar');
  var count = document.getElementById('replies-count');

  function refreshBar() {
    var n = Object.keys(replies).filter(function (k) { return replies[k].trim(); }).length;
    bar.hidden = n === 0;
    count.textContent = n === 0 ? '' : n + ' یادداشت نوشته‌اید';

    document.querySelectorAll('.reply-btn').forEach(function (b) {
      var has = (replies[b.dataset.for] || '').trim() !== '';
      b.classList.toggle('has', has);
      b.textContent = has ? 'یادداشت شما ✓' : 'یادداشت';
    });
  }

  document.querySelectorAll('article [data-block]').forEach(function (block) {
    var id = block.dataset.block;

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'reply-btn';
    button.dataset.for = id;
    button.textContent = 'یادداشت';
    block.insertAdjacentElement('afterend', button);

    button.addEventListener('click', function () {
      if (button.nextElementSibling && button.nextElementSibling.classList.contains('reply-box')) {
        button.nextElementSibling.remove();
        return;
      }

      var box = document.createElement('div');
      box.className = 'reply-box';

      var area = document.createElement('textarea');
      area.value = replies[id] || '';
      area.placeholder = 'نظرتان درباره‌ی این بخش…';

      var row = document.createElement('div');
      row.className = 'row';

      var ok = document.createElement('button');
      ok.type = 'button';
      ok.textContent = 'ثبت';
      ok.addEventListener('click', function () {
        if (area.value.trim()) replies[id] = area.value.trim();
        else delete replies[id];
        save();
        box.remove();
      });

      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'quiet';
      cancel.textContent = 'انصراف';
      cancel.addEventListener('click', function () { box.remove(); });

      row.appendChild(ok);
      row.appendChild(cancel);
      box.appendChild(area);
      box.appendChild(row);
      button.insertAdjacentElement('afterend', box);
      area.focus();
    });
  });

  document.getElementById('btn-send-replies').addEventListener('click', function () {
    var payload = {
      kind: 'asb-review-replies',
      title: document.title.replace(' — نشر اسب', ''),
      slug: body.dataset.slug || '',
      at: new Date().toISOString(),
      replies: Object.keys(replies).map(function (id) {
        var block = document.querySelector('article [data-block="' + id + '"]');
        return {
          block: Number(id),
          quote: block ? block.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) : '',
          text: replies[id]
        };
      }).filter(function (r) { return r.text && r.text.trim(); })
    };

    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = (payload.slug || 'review') + '-replies.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
  });

  document.getElementById('btn-clear-replies').addEventListener('click', function () {
    if (!confirm('همه‌ی یادداشت‌های شما پاک شود؟')) return;
    replies = {};
    save();
  });

  refreshBar();
})();
`;

/**
 * Builds the page.
 *
 * @param {object} options
 *   doc        the AsbDocument as it stands now
 *   baseline   the text as it was when tracking was switched on
 *   editor     who did the editing
 *   author     the author's name, overriding the frontmatter
 *   translator the translator's name, overriding the frontmatter
 *   date       the date of the pass, already written out in Persian
 *   note       a line to the author, above the text
 */
export function buildReviewReport({
  doc, baseline, editor = '', author = null, translator = null,
  date = '', note = '', title = null,
}) {
  const fm = doc.frontmatter;
  // The heading on this page is not always the title of the work - a report
  // may cover one pass, one chapter, or one round of questions.
  const heading = title === null || String(title).trim() === ''
    ? String(fm.get('title') || 'بدون عنوان')
    : String(title).trim();
  const theAuthor = author === null ? String(fm.get('author') || '') : String(author);
  const theTranslator = translator === null ? String(fm.get('translator') || '') : String(translator);
  const slug = String(fm.get('slug') || 'review');

  const before = baseline === null || baseline === undefined ? doc.body : baseline;
  // Counted on the text alone: a note added is not a word changed.
  const summary = diffSummary(
    plain(before).replace(/\s+$/, ''),
    plain(doc.body).replace(/\s+$/, '')
  );
  const comments = findChanges(doc.body).filter((c) => c.type === 'comment').length;

  /* Each credit on its own line rather than run together: an author reading
     this wants to see their own name, not hunt for it in a string. */
  const credits = [
    theAuthor && ['پدیدآورنده', theAuthor],
    theTranslator && ['مترجم', theTranslator],
    editor && ['ویراستار', editor],
    date && ['تاریخ ویرایش', date],
  ].filter(Boolean);

  const tally = [
    summary.added && `<span>افزوده: ${fa(summary.added)} کلمه</span>`,
    summary.removed && `<span>حذف‌شده: ${fa(summary.removed)} کلمه</span>`,
    comments && `<span>یادداشت: ${fa(comments)}</span>`,
  ].filter(Boolean).join('');

  const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(heading)} — نشر اسب</title>
<style>${styles()}</style>
</head>
<body data-slug="${esc(slug)}">
<div class="sheet">

  <header>
    <div class="mark">${HORSE}</div>
    <h1>${esc(heading)}</h1>
  </header>

  ${credits.length ? `<dl class="credits">
    ${credits.map(([label, value]) =>
      `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}
  </dl>` : ''}

  <div class="views">
    <button type="button" data-view="marked" aria-pressed="true">نمایش تغییرات</button>
    <button type="button" data-view="clean" aria-pressed="false">متن نهایی</button>
  </div>

  ${tally ? `<div class="tally">${tally}</div>` : ''}

  <section class="legend">
    <h2>این صفحه چیست</h2>
    <p>
      این نسخه‌ی ویرایش‌شده‌ی اثر شماست. هر تغییری که روی متن انجام شده،
      همین‌جا مشخص است تا ببینید دقیقاً چه چیزی عوض شده.
    </p>
    <ul>
      <li><ins class="c-ins">متنی که اضافه شده</ins></li>
      <li><del class="c-del">متنی که برداشته شده</del></li>
      <li>
        <span class="c-note__pin">۱</span>
        یادداشت ویراستار — روی دایره بزنید تا متنش را ببینید
      </li>
    </ul>
    <p style="margin-top:12px;margin-bottom:0">
      با دکمه‌ی <b>متن نهایی</b> می‌توانید متن را بدون علامت‌ها و همان‌طور که
      منتشر می‌شود بخوانید.
    </p>
    <p style="margin-top:10px;margin-bottom:0">
      <b>نظرتان را همین‌جا بنویسید:</b> کنار هر پاراگراف دکمه‌ی «یادداشت» هست.
      وقتی تمام شد، دکمه‌ی <b>فرستادن نظرها</b> پایین صفحه یک فایل کوچک
      می‌سازد؛ همان را برای ما بفرستید.
    </p>
  </section>

  ${note ? `<section class="note-to-author"><p>${esc(note)}</p></section>` : ''}

  <article>
${render(markedSource(before, doc.body))}
  </article>

  <div class="replies-bar" id="replies-bar" hidden>
    <span id="replies-count"></span>
    <button type="button" id="btn-send-replies">فرستادن نظرها</button>
    <button type="button" id="btn-clear-replies" class="quiet">پاک کردن همه</button>
  </div>

  <footer>
    <strong>تحریریه‌ی نشر اسب</strong>
  </footer>

</div>
<script>${SCRIPT}</script>
</body>
</html>`;

  return {
    html,
    filename: `${slug}-review.html`,
    changes: summary.total,
    comments,
  };
}
