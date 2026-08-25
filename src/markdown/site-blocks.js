/* ==========================================================================
   markdown/site-blocks.js
   --------------------------------------------------------------------------
   The four site features that are NOT plain Python-Markdown syntax, expanded
   into HTML before the renderer runs - so the preview, the EPUB and the
   review report all show what build.py shows:

     /// note | title        pymdownx.blocks.admonition
     /// details | title     pymdownx.blocks.details   (with "open: true")
     واژه / :   تعریف        def_list (part of 'extra')
     *[SF]: متن             abbr (part of 'extra')

   Everything here works on the SOURCE, before Markdown, and emits HTML the
   renderer passes through untouched (html: true). One subtlety carries the
   design: markdown-it closes an HTML block at the first blank line, so every
   generated block has its blank lines compressed. The tags carry the
   structure; the newlines are cosmetic.

   Abbreviations go FIRST, while the text is still prose - running them over
   generated HTML would one day match inside a tag name.

   This module must never touch the DOM.
   ========================================================================== */

import { ADMONITION_KINDS } from '../model/schema.js';

const FENCE_LINE = /^\s{0,3}(`{3,}|~{3,})/;

const escapeHtml = (s) => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* --------------------------------------------------------------------------
   Abbreviations:  *[SF]: Science Fiction
   Every whole-word, case-sensitive occurrence becomes <abbr title>.
   Fenced blocks and inline code spans are skipped - code is atomic.
   -------------------------------------------------------------------------- */

const ABBR_DEF = /^\s*\*\[([^\]]+)\]:\s*(.+?)\s*$/;

export function applyAbbreviations(source) {
  const lines = source.split('\n');
  const defs = [];
  const kept = [];
  let inFence = false;

  for (const line of lines) {
    if (FENCE_LINE.test(line)) { inFence = !inFence; kept.push(line); continue; }
    if (!inFence) {
      const def = line.match(ABBR_DEF);
      if (def) { defs.push({ abbr: def[1], title: def[2] }); continue; }
    }
    kept.push(line);
  }

  if (defs.length === 0) return source;

  // Longest first, so an abbr that contains another is not eaten halfway.
  defs.sort((a, b) => b.abbr.length - a.abbr.length);

  const rules = defs.map((d) => ({
    re: new RegExp(`\\b${d.abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'),
    html: `<abbr title="${escapeHtml(d.title)}">${escapeHtml(d.abbr)}</abbr>`,
  }));

  const outsideCodeSpans = (text) =>
    text.split(/(`[^`]*`)/).map((part, index) =>
      index % 2 === 1 ? part : rules.reduce((acc, r) => acc.replace(r.re, r.html), part)
    ).join('');

  const out = [];
  inFence = false;
  for (const line of kept) {
    if (FENCE_LINE.test(line)) inFence = !inFence;
    out.push(inFence ? line : outsideCodeSpans(line));
  }
  return out.join('\n');
}

/* --------------------------------------------------------------------------
   Definition lists:  term, then one or more ": definition" lines.
   An indented continuation line joins the definition above it. Terms and
   definitions go through renderInline, so *italics* inside them survive.
   -------------------------------------------------------------------------- */

const DEF_LINE = /^\s{0,3}:\s+(.*)$/;

export function expandDefinitionLists(source, md) {
  const lines = source.split('\n');
  const out = [];
  let i = 0;
  let inFence = false;

  while (i < lines.length) {
    const line = lines[i];

    if (FENCE_LINE.test(line)) { inFence = !inFence; out.push(line); i++; continue; }
    if (inFence) { out.push(line); i++; continue; }

    // A term: a non-empty line that is not itself a definition, whose next
    // line is one. The term is consumed FIRST, then definitions and further
    // terms follow until the group ends - so the scanner always advances.
    if (line.trim() && !DEF_LINE.test(line) && DEF_LINE.test(lines[i + 1] || '')) {
      const start = i;
      const parts = [{ dt: true, text: line.trim() }];
      i++;

      while (i < lines.length) {
        const l = lines[i];
        if (FENCE_LINE.test(l) || l.trim() === '') break;

        const d = l.match(DEF_LINE);
        if (d) { parts.push({ dt: false, text: d[1] }); i++; continue; }

        // An indented continuation joins the definition above it.
        if (/^\s+\S/.test(l) && !parts[parts.length - 1].dt) {
          parts[parts.length - 1].text += ' ' + l.trim();
          i++;
          continue;
        }

        if (!parts[parts.length - 1].dt) { parts.push({ dt: true, text: l.trim() }); i++; continue; }
        break;
      }

      if (parts.some((p) => !p.dt)) {
        const html = ['<dl>',
          ...parts.map((p) => p.dt
            ? `<dt>${md.renderInline(escapeHtml(p.text))}</dt>`
            : `<dd>${md.renderInline(escapeHtml(p.text))}</dd>`),
          '</dl>'].join('\n');
        out.push('', html, '');
        continue;
      }

      // No definitions after all: hand the consumed lines back verbatim.
      for (let k = start; k < i; k++) out.push(lines[k]);
      continue;
    }

    out.push(line);
    i++;
  }
  return out.join('\n');
}

/* --------------------------------------------------------------------------
   /// callouts — admonition and details.
   Options (like "open: true") are indented key: value lines between the
   opening fence and the first blank line. Content runs to the matching
   closing fence, honouring nested callouts and fenced code inside.
   -------------------------------------------------------------------------- */

const OPEN_LINE = /^\s{0,3}\/\/\/\s*([A-Za-z]+)\s*(?:\|\s*(.*))?$/;
const CLOSE_LINE = /^\s{0,3}\/\/\/\s*$/;
const OPTION_LINE = /^\s{4,}([A-Za-z][\w-]*)\s*:\s*(.*?)\s*$/;

export function expandCallouts(source, md, kinds = ADMONITION_KINDS) {
  const lines = source.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const open = lines[i].match(OPEN_LINE);
    if (!open) { out.push(lines[i]); i++; continue; }

    const kind = open[1].toLowerCase();
    const explicitTitle = (open[2] || '').trim();
    const isDetails = kind === 'details';

    const options = {};
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== '' && !CLOSE_LINE.test(lines[j])) {
      const opt = lines[j].match(OPTION_LINE);
      if (!opt) break;
      options[opt[1]] = opt[2];
      j++;
    }

    // Walk the content, counting depth so a nested callout or a fenced block
    // cannot end this one early.
    const inner = [];
    let depth = 1;
    let inFence = false;
    j++;
    let closed = false;
    while (j < lines.length) {
      const l = lines[j];
      if (FENCE_LINE.test(l)) inFence = !inFence;

      if (!inFence) {
        if (CLOSE_LINE.test(l)) {
          depth--;
          j++;
          if (depth === 0) { closed = true; break; }
          continue;
        }
        if (OPEN_LINE.test(l)) depth++;
      }

      inner.push(l);
      j++;
    }

    // Unterminated block: hand the rest through untouched rather than guess.
    if (!closed) {
      for (let k = i; k < lines.length; k++) out.push(lines[k]);
      break;
    }

    const content = md.render(inner.join('\n'));
    let html;

    if (isDetails) {
      // Same classes pymdownx.blocks.details emits, so the studio's DOM and
      // the site's are interchangeable.
      const isOpen = String(options.open || '').trim().toLowerCase() === 'true';
      const title = explicitTitle || 'بیشتر';
      html = `<details class="admonition details"${isOpen ? ' open' : ''}>\n`
        + `<summary>${escapeHtml(title)}</summary>\n${content}</details>`;
    } else {
      // pymdownx.blocks.admonition emits the TYPE as the second class; the
      // site stylesheet keys its colours off that name.
      const meta = kinds[kind] || { tone: 'ochre', label: kind };
      const title = explicitTitle || meta.label;
      html = `<div class="admonition ${kind}">\n`
        + `<p class="admonition-title">${escapeHtml(title)}</p>\n${content}</div>`;
    }

    // markdown-it ends an HTML block at a blank line; the tags carry the
    // structure, so the blank lines inside can go.
    out.push('', html.replace(/\n{2,}/g, '\n'), '');
    i = j;
  }
  return out.join('\n');
}

/* --------------------------------------------------------------------------
   The one entry point the renderers call.
   -------------------------------------------------------------------------- */

export function expandSiteBlocks(source, md, kinds) {
  let out = applyAbbreviations(source);
  out = expandDefinitionLists(out, md);
  out = expandCallouts(out, md, kinds);
  return out;
}
