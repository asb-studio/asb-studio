/* ==========================================================================
   export/review-report.js
   --------------------------------------------------------------------------
   The page an author is sent to see what was done to their work.

   A .md file full of {++ ++} and {-- --} is perfectly readable to somebody who
   knows CriticMarkup, and completely opaque to everybody else - which is every
   writer who has just handed over a story. So the marks become a page: one
   self-contained HTML file, no server, no build, nothing to install. It opens
   on a phone, and it can be attached to an email.

   Everything is inlined - the font, the styles, the marks - because the file
   has to survive being forwarded, downloaded, and opened offline.

   This module must never touch the DOM.
   ========================================================================== */

import { findChanges } from '../markdown/critic.js';
import { createRenderer } from '../markdown/preview.js';
import { markupForPreview } from '../markdown/critic.js';
import { textDirection } from '../markdown/direction.js';

const renderer = createRenderer();

const esc = (s) => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const fa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

const KINDS = {
  insert: { label: 'افزوده', cls: 'ins' },
  delete: { label: 'حذف‌شده', cls: 'del' },
  substitute: { label: 'جایگزین‌شده', cls: 'sub' },
  comment: { label: 'یادداشت ویراستار', cls: 'note' },
  highlight: { label: 'برجسته', cls: 'mark' },
};

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
    --paper: #fdf9ee;
    --bg: #e7e0cf;
    --ink: #3a352c;
    --dim: #6b6354;
    --faint: #9a9180;
    --line: #d5ccb4;
    --ochre: #b07d00;
    --ins: #2c7550;
    --ins-bg: rgba(44, 117, 80, 0.12);
    --del: #ab362d;
    --del-bg: rgba(171, 54, 45, 0.10);
    --note: #8c6200;
    --note-bg: rgba(176, 125, 0, 0.10);
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Vazirmatn', Tahoma, sans-serif;
    background: var(--bg); color: var(--ink);
    line-height: 2.1; padding: 24px 16px 60px;
  }

  .sheet {
    max-width: 46rem; margin: 0 auto;
    background: var(--paper);
    border: 1px solid var(--line); border-radius: 12px;
    padding: 44px 48px 56px;
  }

  header { text-align: center; padding-bottom: 26px; border-bottom: 1px solid var(--line); }
  .mark { width: 62px; height: 62px; margin: 0 auto 14px; color: var(--ink); }
  .mark svg { width: 100%; height: 100%; display: block; fill: currentColor; }
  h1 { font-size: 1.5rem; line-height: 1.6; margin-bottom: 8px; }
  .byline { font-size: 0.88rem; color: var(--dim); }

  .legend {
    margin: 26px 0; padding: 18px 20px;
    background: rgba(176, 125, 0, 0.06);
    border: 1px solid var(--line); border-radius: 10px;
    font-size: 0.86rem; line-height: 2;
  }
  .legend h2 { font-size: 0.95rem; margin-bottom: 8px; }
  .legend p { color: var(--dim); margin-bottom: 10px; }
  .legend ul { list-style: none; display: grid; gap: 6px; }
  .legend li { display: flex; align-items: center; gap: 9px; }

  .tally {
    display: flex; flex-wrap: wrap; gap: 8px; margin: 22px 0 30px;
  }
  .tally span {
    font-size: 0.78rem; padding: 5px 12px; border-radius: 20px;
    border: 1px solid var(--line); color: var(--dim);
  }

  article { font-size: 1.04rem; text-align: justify; }
  article p { margin-bottom: 1.1em; text-indent: 1.7em; }
  article p:first-of-type, article h1 + p, article h2 + p, article h3 + p,
  article blockquote + p, article hr + p, article p.no-indent { text-indent: 0; }
  article h1, article h2, article h3 { margin: 1.9em 0 0.7em; line-height: 1.6; text-align: start; }
  article h1 { font-size: 1.35rem; }
  article h2 { font-size: 1.2rem; }
  article h3 { font-size: 1.06rem; color: var(--ochre); }
  article blockquote {
    margin: 1.6em 0; padding: 0.3em 1.2em;
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
  article li { margin-bottom: 0.5em; }

  /* The marks. Colour and shape both, so the page still reads when printed
     in black and white or seen by someone who cannot tell the two apart. */
  ins.c, del.c, .c-note, .c-mark {
    text-decoration: none; padding: 1px 3px; border-radius: 3px;
  }
  ins.c { background: var(--ins-bg); color: var(--ins); text-decoration: underline; }
  del.c { background: var(--del-bg); color: var(--del); text-decoration: line-through; }
  .c-note {
    background: var(--note-bg); color: var(--note);
    border: 1px dashed var(--ochre); font-size: 0.9em;
  }
  .c-mark { background: rgba(176, 125, 0, 0.16); }

  .sup {
    font-size: 0.72em; color: var(--ochre); font-weight: 700;
    vertical-align: super; padding: 0 2px;
  }

  .footnote { margin-top: 3rem; padding-top: 1.4rem; border-top: 1px solid var(--line); font-size: 0.9rem; color: var(--dim); }
  .footnote h3 { font-size: 1rem; margin-bottom: 1rem; }
  .footnote li { margin-bottom: 0.7em; }
  .footnote li p { display: inline; text-indent: 0; }

  footer {
    margin-top: 44px; padding-top: 22px; border-top: 1px solid var(--line);
    text-align: center; color: var(--dim); font-size: 0.85rem; line-height: 2;
  }
  footer strong { color: var(--ink); }

  @media (max-width: 640px) {
    body { padding: 12px 8px 40px; }
    .sheet { padding: 26px 20px 36px; border-radius: 10px; }
    h1 { font-size: 1.25rem; }
    article { font-size: 1rem; }
  }

  @media print {
    body { background: #fff; padding: 0; }
    .sheet { border: 0; max-width: none; padding: 0; }
    .legend { break-inside: avoid; }
  }
  `;
}

/* The house mark, inlined so the page needs nothing from anywhere. */
const HORSE = `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M378 172.1c-46.5 5.2-97.7 22.5-133.7 45.2-4.6 2.8-8.3 5.4-8.3 5.7s2.2 1.6 4.8 3.1c5.2 2.8 38.5 21.9 39.1 22.5.2.1-1.5 4.5-3.7 9.6-8.7 20.4-13.7 42.7-14.8 66.9-1.1 23.8 1.4 41.8 11.1 80.9 10.2 41.1 14.8 70.3 16.4 105.3 1.2 24.4 1.8 26 12.9 34.8 17.5 14 27.9 19.5 34.5 18.5 7.4-1.2 35.7-20.4 40.4-27.4 3-4.6 4.3-11.2 3.4-16.8-.4-2.4-2.4-14.6-4.5-27.1-4.6-27.6-5.9-45.9-4.6-64.6 1.9-27.3 8.3-46.6 22.9-68.9 21-32.2 55.7-56.4 96.6-67.5 20.8-5.6 30.5-6.7 61.5-6.7 25.6 0 30.6.3 43 2.4 42.7 7.3 78.7 24.4 106.5 50.5 30.4 28.6 47.3 63.9 51.5 107.5 1.4 14.9.6 44-1.5 57.3-6.9 42.6-27.2 82.7-57.5 113.4-40.2 40.9-95.4 63.5-155.7 63.8-11.5 0-14.3.3-15.5 1.7-1.3 1.4-1.5 8.1-1.5 45.4 0 43.4 0 43.7 2.2 45.9 2 2 3.1 2.2 11.5 2 34.9-.9 74.1-8.4 106.6-20.3 87.2-32.1 154.3-99.7 184.9-186.5 30.9-87.6 20.9-183.1-27.3-260.4-11.2-18-22-31.6-37.5-47.2-46.2-46.4-105.4-75.6-172.1-84.8-13.2-1.8-19.8-2.1-52.6-2-20.6.1-45.1.8-54.6 1.5z"/></svg>`;

/* --------------------------------------------------------------------------
   Rendering
   -------------------------------------------------------------------------- */

/** The marked-up body, as HTML the author can read. */
function renderBody(body) {
  let source = body
    .replace(/<!--\s*(EREADER-START|PAYWALL)\s*-->/g, '')
    .replace(/\\(\r?\n)/g, '$1');

  source = markupForPreview(source);

  let html = renderer.render(source);

  // markupForPreview emits the studio's own class names; the page uses its own.
  html = html
    .replace(/<ins class="critic critic--ins">/g, '<ins class="c">')
    .replace(/<del class="critic critic--del">/g, '<del class="c">')
    .replace(/<span class="critic critic--note">/g, '<span class="c-note">')
    .replace(/<mark class="critic critic--mark">/g, '<mark class="c-mark">');

  // Footnote references and the block, in the shape the site uses.
  html = html.replace(/(<a class="footnote-ref"[^>]*>)(\d+)(<\/a>)/g,
    (_, open, digits, close) => open + fa(digits) + close);
  html = html.replace(/<hr class="footnotes-sep"\s*\/?>\s*/g, '');
  html = html.replace(/<section class="footnotes">/, '<section class="footnote"><h3>پانویس‌ها</h3>');
  html = html.replace(/<li id="fn-(\d+)" class="footnote-item">([\s\S]*?)<\/li>/g,
    (whole, id, inner) => `<li id="fn-${id}" dir="${textDirection(inner.replace(/<[^>]+>/g, ' '))}">${inner}</li>`);

  return html;
}

function tally(changes) {
  const counts = new Map();
  for (const change of changes) {
    counts.set(change.type, (counts.get(change.type) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([type, n]) => `<span>${KINDS[type] ? KINDS[type].label : type}: ${fa(n)}</span>`)
    .join('');
}

/**
 * Builds the page.
 *
 * @param {object} options
 *   doc       the AsbDocument
 *   editor    the name to sign the changes with
 * @returns {{ html: string, filename: string, changes: number }}
 */
export function buildReviewReport({ doc, editor = '' }) {
  const fm = doc.frontmatter;
  const title = String(fm.get('title') || 'بدون عنوان');
  const author = String(fm.get('author') || '');
  const translator = String(fm.get('translator') || '');
  const slug = String(fm.get('slug') || 'review');

  const changes = findChanges(doc.body);

  const byline = [
    author && `نوشته‌ی ${esc(author)}`,
    translator && `ترجمه‌ی ${esc(translator)}`,
    editor && `ویرایش ${esc(editor)}`,
  ].filter(Boolean).join(' · ');

  const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ویرایش «${esc(title)}» — نشر اسب</title>
<style>${styles()}</style>
</head>
<body>
<div class="sheet">

  <header>
    <div class="mark">${HORSE}</div>
    <h1>${esc(title)}</h1>
    ${byline ? `<p class="byline">${byline}</p>` : ''}
  </header>

  <section class="legend">
    <h2>این صفحه چیست</h2>
    <p>
      این نسخه‌ی ویرایش‌شده‌ی اثر شماست. هر تغییری که روی متن انجام شده، همین‌جا
      رنگی و مشخص است تا ببینید دقیقاً چه چیزی عوض شده و چرا.
    </p>
    <ul>
      <li><ins class="c">متنی که اضافه شده</ins></li>
      <li><del class="c">متنی که برداشته شده</del></li>
      <li><del class="c">شکل قبلی</del> <ins class="c">شکل پیشنهادی</ins> — جایگزینی</li>
      <li><span class="c-note">یادداشت ویراستار</span> — پرسش یا توضیحی برای شما، نه بخشی از متن</li>
    </ul>
    <p style="margin-top:12px;margin-bottom:0">
      هرکدام را که نپسندیدید، همان را به ما بگویید. هیچ تغییری بدون تأیید شما نهایی نمی‌شود.
    </p>
  </section>

  ${changes.length ? `<div class="tally">${tally(changes)}<span>مجموع: ${fa(changes.length)}</span></div>` : ''}

  <article>
${renderBody(doc.body)}
  </article>

  <footer>
    <strong>تحریریه‌ی نشر اسب</strong>
  </footer>

</div>
</body>
</html>`;

  return { html, filename: `${slug}-review.html`, changes: changes.length };
}
