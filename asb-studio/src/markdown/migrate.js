/* ==========================================================================
   markdown/migrate.js
   --------------------------------------------------------------------------
   Converts files written by the old studio into plain Markdown.

   The old studio reached for raw HTML wherever it did not know the Markdown
   for something - hand-built footnotes, coloured spans, page-break divs. All
   of it works, and all of it is presentation smuggled into the manuscript.
   Once it is HTML, no tool can read it: the linter cannot check those
   footnotes, the footnote panel cannot list them, the EPUB exporter cannot
   turn them into real notes, and renumbering means retyping eleven items by
   hand.

   Everything converted here has an exact Markdown equivalent that
   Python-Markdown already understands. Nothing is guessed at.

   These are one-time conversions for the legacy archive, which is why they
   live apart from repair.js - that file fixes mistakes that can still be made
   today; this one closes a chapter.

   This module must never touch the DOM.
   ========================================================================== */

const FA_TO_EN = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
                   '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };

const toEnglish = (s) => String(s).replace(/[۰-۹]/g, (d) => FA_TO_EN[d]);

/* --------------------------------------------------------------------------
   1. Footnote references
        <sup class="fn-ref"><a href="#fn1" id="ref1">۱</a></sup>   ->   [^1]
   -------------------------------------------------------------------------- */

function convertFootnoteRefs(text) {
  let count = 0;
  const out = text.replace(
    /<sup[^>]*class="[^"]*fn-ref[^"]*"[^>]*>\s*<a[^>]*href="#fn(\d+)"[^>]*>[\s\S]*?<\/a>\s*<\/sup>/g,
    (_, id) => { count++; return `[^${id}]`; }
  );
  return { text: out, count };
}

/* --------------------------------------------------------------------------
   2. The hand-built footnote block
        <div class="footnotes-container">
          <div ... id="fn1"><a href="#ref1" ...>۱.</a> TEXT</div>
          ...
        </div>
      becomes one definition per note. The direction classes (fa / en) are
      dropped on purpose: build.py sets dir="auto" on every note, which reads
      the language of the note itself and is never wrong.
   -------------------------------------------------------------------------- */

function convertFootnoteBlock(text) {
  const openMatch = text.match(/<div[^>]*class="[^"]*footnotes-container[^"]*"[^>]*>/);
  if (!openMatch) return { text, count: 0 };

  const start = openMatch.index;
  const bodyStart = start + openMatch[0].length;

  // The container holds one <div> per note, so the closing tag has to be
  // found by counting depth. A non-greedy regex stops at the FIRST </div>,
  // which quietly swallowed every note after the first pair.
  const end = findClosingDiv(text, bodyStart);
  if (end === -1) return { text, count: 0 };

  const inner = text.slice(bodyStart, end);
  const items = [...inner.matchAll(/<div[^>]*id="fn(\d+)"[^>]*>([\s\S]*?)<\/div>/g)];
  if (items.length === 0) return { text, count: 0 };

  const definitions = items.map(([, id, body]) => {
    const clean = body
      .replace(/<a[^>]*class="[^"]*fn-back[^"]*"[^>]*>[\s\S]*?<\/a>/g, '')  // the back-link
      .replace(/<[^>]+>/g, '')                                              // any leftover tags
      .replace(/^\s*[۰-۹0-9]+[.．]\s*/, '')                                 // a typed-in number
      .replace(/\s+/g, ' ')
      .trim();
    return `[^${id}]: ${clean}`;
  });

  let out = text.slice(0, start) + definitions.join('\n') + text.slice(end + '</div>'.length);

  // The old file printed its own heading and rule above the block.
  // Python-Markdown builds both, so the handmade pair goes.
  out = out.replace(/\n\*{3,}\s*\n+#{1,6}\s*پانویس[^\n]*\n+(?=\[\^)/, '\n\n');
  out = out.replace(/\n#{1,6}\s*پانویس[^\n]*\n+(?=\[\^)/, '\n\n');

  return { text: out, count: definitions.length };
}

/** Walks forward from `from`, counting <div> depth, and returns the index of
    the </div> that closes the container. -1 when the markup is unbalanced. */
function findClosingDiv(text, from) {
  const tags = /<div\b[^>]*>|<\/div>/g;
  tags.lastIndex = from;

  let depth = 0;
  let match;
  while ((match = tags.exec(text)) !== null) {
    if (match[0] === '</div>') {
      if (depth === 0) return match.index;
      depth--;
    } else {
      depth++;
    }
  }
  return -1;
}

/* --------------------------------------------------------------------------
   3. Colour spans
        <span class="color-ochre">**متن**</span>
      When the span wraps a whole line, the class moves into that block's
      attribute list, which is where a presentation class belongs. When it
      wraps part of a line it is left alone - moving it would change which
      words are coloured.
   -------------------------------------------------------------------------- */

function convertColourSpans(lines) {
  let count = 0;

  for (let i = 0; i < lines.length; i++) {
    const whole = lines[i].match(/^\s*<span[^>]*class="([^"]*)"[^>]*>([\s\S]*)<\/span>\s*$/);
    if (!whole) continue;

    const classes = whole[1].trim().split(/\s+/).filter(Boolean);
    lines[i] = whole[2].trim();
    count++;

    // Fold the classes into the attribute list on the following line, or
    // start one if the block has none.
    const next = lines[i + 1];
    const attrs = next && next.match(/^(\s*)\{:?\s*([^}]*)\}\s*$/);

    if (attrs) {
      const existing = attrs[2].trim().split(/\s+/).filter(Boolean);
      const merged = [...classes.map((c) => `.${c}`), ...existing];
      lines[i + 1] = `${attrs[1]}{: ${merged.join(' ')} }`;
    } else {
      lines.splice(i + 1, 0, `{: ${classes.map((c) => `.${c}`).join(' ')} }`);
      i++;
    }
  }

  return count;
}

/* --------------------------------------------------------------------------
   4. Break divs
        <div class="page-break"></div>  ->  ***
   -------------------------------------------------------------------------- */

function convertBreakDivs(lines) {
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*<div[^>]*class="[^"]*(page-break|scene-break)[^"]*"[^>]*>\s*<\/div>\s*$/.test(lines[i])) continue;
    lines[i] = '***';
    count++;
  }
  return count;
}

/* --------------------------------------------------------------------------
   5. Reader marker
        <div class="ereader-marker">…</div>  ->  <!-- EREADER-START -->
   -------------------------------------------------------------------------- */

function convertReaderMarker(lines) {
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*<div[^>]*class="[^"]*ereader-marker[^"]*"[^>]*>[\s\S]*?<\/div>\s*$/.test(lines[i])) continue;
    lines[i] = '<!-- EREADER-START -->';
    count++;
  }
  return count;
}

/* --------------------------------------------------------------------------
   Public API
   -------------------------------------------------------------------------- */

/**
 * Converts a legacy body to plain Markdown.
 * @param {string} body
 * @returns {{ body: string, report: Array<{label, count}>, total: number,
 *             remainingHtml: Array<{line, snippet}> }}
 */
export function migrateBody(body) {
  const report = [];
  let working = body;

  const refs = convertFootnoteRefs(working);
  working = refs.text;
  if (refs.count) report.push({ label: 'ارجاع پانویس دستی', count: refs.count });

  const block = convertFootnoteBlock(working);
  working = block.text;
  if (block.count) report.push({ label: 'تعریف پانویس دستی', count: block.count });

  const lines = working.split('\n');

  const colours = convertColourSpans(lines);
  if (colours) report.push({ label: 'اسپن رنگ به ویژگی بلوک', count: colours });

  const breaks = convertBreakDivs(lines);
  if (breaks) report.push({ label: 'جداکننده‌ی HTML', count: breaks });

  const markers = convertReaderMarker(lines);
  if (markers) report.push({ label: 'نشانگر شروع مطالعه', count: markers });

  working = lines.join('\n').replace(/\n{3,}/g, '\n\n');

  const total = report.reduce((sum, item) => sum + item.count, 0);
  return { body: working, report, total, remainingHtml: findRemainingHtml(working) };
}

/**
 * Lists HTML the migration did not handle, so nothing is converted silently
 * and nothing is silently left behind either. The two structural markers are
 * not reported: they are where Markdown genuinely falls short.
 */
export function findRemainingHtml(body) {
  const found = [];
  const lines = body.split('\n');
  let insideFence = false;

  lines.forEach((line, index) => {
    if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) { insideFence = !insideFence; return; }
    if (insideFence) return;

    const stripped = line.replace(/<!--\s*(EREADER-START|PAYWALL)\s*-->/g, '');
    const tag = stripped.match(/<\/?[a-zA-Z][^>]*>/);
    if (tag) found.push({ line: index + 1, snippet: tag[0].slice(0, 70) });
  });

  return found;
}

/** Counts what a migration would change, without changing anything. */
export function previewMigration(body) {
  return migrateBody(body).total;
}
