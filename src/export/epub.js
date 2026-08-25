/* ==========================================================================
   export/epub.js
   --------------------------------------------------------------------------
   Builds an EPUB 3 from the Markdown.

   FROM THE MARKDOWN, not from the site's HTML and not from the premium JSON.
   Markdown is the source of truth; HTML, JSON and EPUB are all destinations.
   Building the book from one of the other destinations would mean building a
   copy of a copy, and every flaw in that intermediate step would ride along
   into the book.

   The output is a right-to-left EPUB 3 with a navigation document, chapters
   split at headings, and footnotes marked up so Apple Books and Thorium show
   them in a popup instead of jumping the reader to the end.

   This module must never touch the DOM.
   ========================================================================== */

import { createRenderer } from '../markdown/preview.js';
import { readFootnotes } from '../model/footnotes.js';
import { directionOfHtml } from '../markdown/direction.js';
import { expandSiteBlocks } from '../markdown/site-blocks.js';
import { makeZip } from './zip.js';
import { MARKERS } from '../model/schema.js';

const renderer = createRenderer({ xhtml: true });
const EN_TO_FA = { 0: '۰', 1: '۱', 2: '۲', 3: '۳', 4: '۴', 5: '۵', 6: '۶', 7: '۷', 8: '۸', 9: '۹' };

const escapeXml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/* --------------------------------------------------------------------------
   The book's stylesheet
   Deliberately close to the site's, so a work reads the same on paper-white
   e-ink as it does in a browser. Colours are left to the reading device.
   -------------------------------------------------------------------------- */
const BOOK_CSS = `@charset "utf-8";

html { direction: rtl; }
body {
  margin: 0 5%;
  line-height: 1.9;
  text-align: justify;
  font-family: serif;
}

h1, h2, h3, h4 { line-height: 1.5; text-align: start; margin: 2em 0 0.8em; page-break-after: avoid; }
h1 { font-size: 1.5em; }
h2 { font-size: 1.28em; }
h3 { font-size: 1.1em; }

p { margin: 0 0 0.9em; text-indent: 1.6em; }
p.no-indent, h1 + p, h2 + p, h3 + p, blockquote + p, hr + p, p:first-of-type { text-indent: 0; }

blockquote { margin: 1.5em 1.2em; font-style: italic; }
blockquote p { text-indent: 0; }

/* Newlines carry meaning inside a poem - the same rule the site relies on,
   which is why a poem needs no backslash and no trailing spaces. */
p.poem {
  white-space: pre-line;
  text-indent: 0;
  text-align: center;
  font-style: italic;
  margin: 1.8em auto;
  padding: 1em;
  border: 1px solid currentColor;
  border-radius: 8px;
  line-height: 1.8;
}

p.text-center { text-indent: 0; text-align: center; }
.scene-start { font-weight: bold; }

hr { border: 0; border-top: 1px solid currentColor; width: 35%; margin: 2.2em auto; opacity: 0.4; }

ol, ul { padding-right: 1.5em; padding-left: 1.5em; }
li { margin-bottom: 0.5em; }
ol li:dir(rtl) { list-style-type: persian; }
ol li:dir(ltr) { list-style-type: decimal; }

sup a.footnote-ref { text-decoration: none; font-weight: bold; }

.footnote { margin-top: 2.5em; padding-top: 1em; border-top: 1px solid currentColor; font-size: 0.9em; }
.footnote h3 { font-size: 1em; margin-top: 0; }
.footnote li p { display: inline; text-indent: 0; }
a.footnote-backref { text-decoration: none; margin: 0 6px; }

table { width: 100%; border-collapse: collapse; margin: 1.4em 0; }
th, td { border: 1px solid currentColor; padding: 0.4em 0.6em; text-align: start; }

/* --- the guide's classes ------------------------------------------------ */
.pullquote { font-size: 1.15em; font-weight: bold; text-align: center; text-indent: 0;
             margin: 2em auto; padding: 0.8em 0; max-width: 34ch;
             border-top: 1px solid currentColor; border-bottom: 1px solid currentColor; }
.colophon { font-size: 0.8em; text-align: left; text-indent: 0; margin-top: 2.4em; opacity: 0.75; }
.editor-note { font-size: 0.85em; font-style: italic; text-indent: 0; margin-top: 1.6em;
               padding-top: 0.5em; border-top: 1px solid currentColor; opacity: 0.85; }
.small { font-size: 0.85em; }
.mag-article-deck { font-size: 1.05em; text-indent: 0; opacity: 0.85; }
.story-deck { font-size: 0.95em; text-indent: 0; opacity: 0.85; }
mark { font-weight: bold; }

/* In the book a scene break is white space, the way a printed page does it. */
div.scene-break { visibility: hidden; margin: 2em 0; }

.admonition { margin: 1.6em 0; padding: 0.7em 1.1em; text-indent: 0;
              border: 1px solid currentColor; border-radius: 6px; }
.admonition p { text-indent: 0; }
.admonition-title { font-weight: bold; margin: 0 0 0.4em; }
.admonition.note .admonition-title, .admonition.important .admonition-title,
.admonition.hint .admonition-title { color: #8c6200; }
.admonition.tip .admonition-title { color: #1d6a86; }
.admonition.warning .admonition-title, .admonition.attention .admonition-title,
.admonition.caution .admonition-title, .admonition.danger .admonition-title,
.admonition.error .admonition-title { color: #a3302a; }

details.admonition { margin: 1.6em 0; padding: 0.5em 1em; border: 1px solid currentColor; border-radius: 6px; }
details.admonition summary { font-weight: bold; margin: 0.4em 0; }
details.admonition p { text-indent: 0; }

dl { margin: 1.4em 0; }
dt { font-weight: bold; margin-top: 0.8em; }
dd { margin: 0 1.4em 0.5em 0; opacity: 0.85; }

.title-page { text-align: center; margin-top: 25%; }
.title-page h1 { font-size: 1.9em; text-align: center; margin-bottom: 0.6em; }
.title-page p { text-indent: 0; margin: 0.3em 0; }
`;

/* --------------------------------------------------------------------------
   Splitting the manuscript into chapters
   -------------------------------------------------------------------------- */

/**
 * Cuts a body at headings of the chosen level.
 * @param {string} body
 * @param {number} level  1, 2, or 0 for one single chapter
 * @returns {Array<{title: string, markdown: string}>}
 */
export function splitChapters(body, level) {
  if (!level) return [{ title: '', markdown: body.trim() }];

  const marker = '#'.repeat(level);
  const lines = body.split('\n');
  const chapters = [];
  let current = { title: '', lines: [] };
  let insideFence = false;

  for (const line of lines) {
    if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) insideFence = !insideFence;

    const heading = insideFence ? null : line.match(new RegExp(`^${marker}\\s+(.*)$`));
    if (heading) {
      if (current.lines.join('\n').trim() || current.title) chapters.push(current);
      current = { title: heading[1].replace(/\s*\{:?[^}]*\}\s*$/, '').trim(), lines: [line] };
      continue;
    }
    current.lines.push(line);
  }

  if (current.lines.join('\n').trim() || current.title) chapters.push(current);

  return chapters
    .map((c) => ({ title: c.title, markdown: c.lines.join('\n').trim() }))
    .filter((c) => c.markdown);
}

/* --------------------------------------------------------------------------
   Footnotes across chapter boundaries

   Definitions live at the foot of the whole manuscript, but the references
   are scattered through it. Split the book into chapters naively and every
   reference loses its definition and prints as a bare [^1] - which is exactly
   what happened the first time this was built.

   So the definitions are lifted out before splitting, and each chapter gets
   back the ones its own text actually refers to.
   -------------------------------------------------------------------------- */

function liftFootnotes(body) {
  const { notes } = readFootnotes(body);
  const defs = new Map();
  const lines = body.split('\n');
  const drop = new Set();

  for (const note of notes) {
    if (note.defLine === null) continue;
    defs.set(note.id, note.text);
    for (let n = note.defLine; n <= note.defEndLine; n++) drop.add(n - 1);
  }

  const stripped = lines.filter((_, index) => !drop.has(index)).join('\n');
  return { body: stripped.replace(/\n{3,}/g, '\n\n'), defs };
}

/** Puts back only the definitions this chapter refers to. */
function attachFootnotes(markdown, defs) {
  if (defs.size === 0) return markdown;

  const used = new Set(
    [...markdown.matchAll(/\[\^([^\]\s]+)\]/g)]
      .map((match) => match[1])
      .filter((id) => defs.has(id))
  );
  if (used.size === 0) return markdown;

  const block = [...used].map((id) => `[^${id}]: ${defs.get(id)}`).join('\n');
  return `${markdown.replace(/\s+$/, '')}\n\n${block}\n`;
}

/* --------------------------------------------------------------------------
   Markdown to XHTML
   -------------------------------------------------------------------------- */

function toXhtml(markdown) {
  // The callouts and definition lists become HTML first, with the same
  // expansion the site's extensions would apply.
  let source = expandSiteBlocks(markdown, renderer);

  // The two structural markers are instructions to build.py, not content.
  source = source
    .split(MARKERS.ereader).join('')
    .split(MARKERS.paywall).join('')
    .replace(/<!--[\s\S]*?-->/g, '');

  // A trailing backslash is not a line break in this pipeline, so it must not
  // become one in the book either.
  source = source.replace(/\\(\r?\n)/g, '$1');

  let html = renderer.render(source);

  // Persian reference numbers, the way the site prints them.
  html = html.replace(/(<a class="footnote-ref"[^>]*>)(\d+)(<\/a>)/g,
    (_, open, digits, close) => open + digits.replace(/\d/g, (d) => EN_TO_FA[d]) + close);

  // markdown-it names the block <section class="footnotes">; give it the same
  // shape and heading the site uses, and the EPUB semantics readers look for.
  html = html.replace(/<hr class="footnotes-sep"\s*\/?>\s*/g, '');
  html = html.replace(/<section class="footnotes">/,
    '<section class="footnote" epub:type="footnotes"><h3>پانویس‌ها</h3>');
  html = html.replace(/<\/section>\s*$/, '</section>');
  // Per-note direction, decided by content - see markdown/direction.js.
  html = html.replace(
    /<li id="fn-(\d+)" class="footnote-item">([\s\S]*?)<\/li>/g,
    (whole, id, inner) =>
      `<li id="fn-${id}" class="footnote-item" dir="${directionOfHtml(inner)}" epub:type="footnote">${inner}</li>`
  );

  return html;
}

/** XHTML has no bare ampersands and no unclosed tags; markdown-it in xhtmlOut
    mode handles the tags, this catches stray entities in the prose. */
function tidyXhtml(html) {
  return html.replace(/&(?!#?\w+;)/g, '&amp;');
}

function page(title, bodyHtml, language) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"
      lang="${escapeXml(language)}" xml:lang="${escapeXml(language)}" dir="rtl">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="../style.css"/>
</head>
<body dir="rtl">
${bodyHtml}
</body>
</html>`;
}

/* --------------------------------------------------------------------------
   Package files
   -------------------------------------------------------------------------- */

function contentOpf(meta, chapters, hasCover) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  const creators = [];
  if (meta.author) creators.push({ role: 'aut', name: meta.author });
  if (meta.translator) creators.push({ role: 'trl', name: meta.translator });
  if (meta.editor) creators.push({ role: 'edt', name: meta.editor });

  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="style" href="style.css" media-type="text/css"/>',
    hasCover ? `<item id="cover-image" href="images/cover.${meta.coverExt}" media-type="${meta.coverType}" properties="cover-image"/>` : '',
    hasCover ? '<item id="cover" href="text/cover.xhtml" media-type="application/xhtml+xml"/>' : '',
    '<item id="titlepage" href="text/titlepage.xhtml" media-type="application/xhtml+xml"/>',
    ...chapters.map((_, i) =>
      `<item id="ch${i + 1}" href="text/chapter-${String(i + 1).padStart(3, '0')}.xhtml" media-type="application/xhtml+xml"/>`),
  ].filter(Boolean);

  const spine = [
    hasCover ? '<itemref idref="cover"/>' : '',
    '<itemref idref="titlepage"/>',
    '<itemref idref="nav"/>',
    ...chapters.map((_, i) => `<itemref idref="ch${i + 1}"/>`),
  ].filter(Boolean);

  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id"
         xml:lang="${escapeXml(meta.language)}" dir="rtl">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:${escapeXml(meta.identifier)}</dc:identifier>
    <dc:title>${escapeXml(meta.title)}</dc:title>
    <dc:language>${escapeXml(meta.language)}</dc:language>
${creators.map((c, i) => `    <dc:creator id="creator-${i}">${escapeXml(c.name)}</dc:creator>
    <meta refines="#creator-${i}" property="role" scheme="marc:relators">${c.role}</meta>`).join('\n')}
    <dc:publisher>نشر اسب</dc:publisher>
${meta.date ? `    <dc:date>${escapeXml(meta.date)}</dc:date>` : ''}
${meta.summary ? `    <dc:description>${escapeXml(meta.summary)}</dc:description>` : ''}
${(meta.tags || []).map((t) => `    <dc:subject>${escapeXml(t)}</dc:subject>`).join('\n')}
    <meta property="dcterms:modified">${now}</meta>
${hasCover ? '    <meta name="cover" content="cover-image"/>' : ''}
  </metadata>
  <manifest>
${manifest.map((m) => '    ' + m).join('\n')}
  </manifest>
  <spine page-progression-direction="rtl">
${spine.map((s) => '    ' + s).join('\n')}
  </spine>
</package>`;
}

function navXhtml(meta, chapters) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"
      lang="${escapeXml(meta.language)}" xml:lang="${escapeXml(meta.language)}" dir="rtl">
<head>
  <meta charset="utf-8"/>
  <title>فهرست مطالب</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body dir="rtl">
  <nav epub:type="toc" id="toc">
    <h1>فهرست مطالب</h1>
    <ol>
${chapters.map((c, i) => `      <li><a href="text/chapter-${String(i + 1).padStart(3, '0')}.xhtml">${escapeXml(c.title || `بخش ${i + 1}`)}</a></li>`).join('\n')}
    </ol>
  </nav>
  <nav epub:type="landmarks" hidden="hidden">
    <ol>
      <li><a epub:type="bodymatter" href="text/chapter-001.xhtml">آغاز متن</a></li>
    </ol>
  </nav>
</body>
</html>`;
}

function titlePage(meta) {
  const people = [
    meta.author && `<p>${escapeXml(meta.author)}</p>`,
    meta.translator && `<p>ترجمه‌ی ${escapeXml(meta.translator)}</p>`,
    meta.editor && `<p>ویرایش ${escapeXml(meta.editor)}</p>`,
  ].filter(Boolean).join('\n    ');

  return page('عنوان', `  <div class="title-page">
    <h1>${escapeXml(meta.title)}</h1>
    ${people}
    <p>نشر اسب</p>
  </div>`, meta.language);
}

/* --------------------------------------------------------------------------
   Public API
   -------------------------------------------------------------------------- */

/**
 * Builds the book.
 *
 * @param {object} options
 *   doc        the AsbDocument
 *   splitLevel 1, 2, or 0 for a single chapter
 *   sampleOnly stop at the paywall marker, producing a free sample
 *   cover      optional { bytes: Uint8Array, type: string, ext: string }
 * @returns {Promise<{ blob: Blob, filename: string, chapters: number }>}
 */
export async function buildEpub({ doc, splitLevel = 1, sampleOnly = false, cover = null }) {
  const fm = doc.frontmatter;

  let body = doc.body;
  if (sampleOnly && body.includes(MARKERS.paywall)) {
    body = body.split(MARKERS.paywall)[0];
  }

  const meta = {
    title: String(fm.get('title') || 'بدون عنوان'),
    author: String(fm.get('author') || ''),
    translator: String(fm.get('translator') || ''),
    editor: String(fm.get('editor') || ''),
    language: String(fm.get('language') || 'fa'),
    date: String(fm.get('date') || ''),
    summary: String(fm.get('summary') || ''),
    tags: Array.isArray(fm.get('tags')) ? fm.get('tags') : [],
    identifier: String(fm.get('book_id') || crypto.randomUUID()),
    coverExt: cover ? cover.ext : '',
    coverType: cover ? cover.type : '',
  };

  // Lift the definitions out first, then hand each chapter back its own.
  const lifted = liftFootnotes(body);
  const chapters = splitChapters(lifted.body, splitLevel)
    .map((chapter) => ({ ...chapter, markdown: attachFootnotes(chapter.markdown, lifted.defs) }));

  if (chapters.length === 0) throw new Error('متنی برای ساختن کتاب نیست.');

  const entries = [
    // The format demands this entry first, stored, exactly these bytes.
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    { name: 'META-INF/container.xml', data: `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>` },
    { name: 'OEBPS/style.css', data: BOOK_CSS },
    { name: 'OEBPS/content.opf', data: contentOpf(meta, chapters, Boolean(cover)) },
    { name: 'OEBPS/nav.xhtml', data: navXhtml(meta, chapters) },
    { name: 'OEBPS/text/titlepage.xhtml', data: titlePage(meta) },
  ];

  if (cover) {
    entries.push({ name: `OEBPS/images/cover.${cover.ext}`, data: cover.bytes });
    entries.push({ name: 'OEBPS/text/cover.xhtml', data: page('جلد',
      `  <div style="text-align:center;margin:0;padding:0">
    <img src="../images/cover.${cover.ext}" alt="${escapeXml(meta.title)}" style="max-width:100%;height:auto"/>
  </div>`, meta.language) });
  }

  chapters.forEach((chapter, index) => {
    entries.push({
      name: `OEBPS/text/chapter-${String(index + 1).padStart(3, '0')}.xhtml`,
      data: page(chapter.title || meta.title, tidyXhtml(toXhtml(chapter.markdown)), meta.language),
    });
  });

  const blob = await makeZip(entries, 'application/epub+zip');
  const slug = String(fm.get('slug') || 'book');
  const filename = sampleOnly ? `${slug}-sample.epub` : `${slug}.epub`;

  return { blob, filename, chapters: chapters.length };
}
