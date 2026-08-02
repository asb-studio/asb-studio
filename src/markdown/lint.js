/* ==========================================================================
   markdown/lint.js
   --------------------------------------------------------------------------
   Detects Markdown that the site's build pipeline cannot render.

   IMPORTANT CONTEXT
   build.py does NOT use CommonMark and does NOT use Pandoc. It uses
   Python-Markdown with:

       extensions = ['extra', 'tables', 'attr_list', 'footnotes',
                     'pymdownx.blocks.html']
       footnotes SEPARATOR = '-'

   Every rule below was verified by running that exact configuration. The
   painful part is that Python-Markdown never raises an error on any of it:
   it just prints the broken syntax to the page as literal text. So these
   mistakes are invisible until a reader sees them.

   This module must never touch the DOM.
   ========================================================================== */

export const SEVERITY = { ERROR: 'error', WARN: 'warn', INFO: 'info' };

/* --------------------------------------------------------------------------
   Helpers
   -------------------------------------------------------------------------- */

/* Returns a Set of 0-based line indexes that sit inside a fenced code block,
   so code samples are never linted as prose. */
function fencedLines(lines) {
  const inside = new Set();
  let open = false;
  lines.forEach((line, i) => {
    if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) { open = !open; inside.add(i); return; }
    if (open) inside.add(i);
  });
  return inside;
}

function finding(rule, severity, lineIndex, message, excerpt, fix) {
  // `fix` is the corrected text. `fixable` says the studio can apply it
  // itself - which is only true when repair.js has a rule for it, and is what
  // puts the button on the row in the issues drawer.
  return {
    rule, severity, line: lineIndex + 1, message, excerpt, fix,
    fixable: FIXABLE.has(rule),
  };
}

/* Rules markdown/repair.js knows how to correct. Kept here so a finding can
   say for itself whether it is fixable, rather than the drawer guessing. */
const FIXABLE = new Set([
  'attr-same-line',
  'heading-attr-own-line',
  'backslash-break',
  'pandoc-span',
  'sources-heading',
  'frontmatter-in-body',
]);

/* --------------------------------------------------------------------------
   Rules
   -------------------------------------------------------------------------- */

/* R1. Block attribute list written on the same line as the text.
   Python-Markdown only reads a block attribute list when it sits ALONE on
   the last line of the block. On the same line it renders as literal text.

       broken:  یک پاراگراف {: .poem #p-abc12345 }
       works:   یک پاراگراف
                {: .poem #p-abc12345 }

   Headings are the exception and are handled by R1b below.
   An attribute list glued directly to an inline element (no space before the
   brace, e.g. *متن*{: .x }) is a different, valid feature and is skipped. */
function ruleAttrSameLine(lines, skip, out) {
  lines.forEach((line, i) => {
    if (skip.has(i)) return;
    if (/^\s{0,3}#{1,6}\s/.test(line)) return; // headings: see R1b
    const m = line.match(/^(.*\S)[ \t]+(\{:?[ \t]*[.#][^}]*\})[ \t]*$/);
    if (!m) return;
    out.push(finding(
      'attr-same-line', SEVERITY.ERROR, i,
      'فهرست ویژگی روی همان خط متن است و رندر نمی‌شود. باید در خط بعد و تنها باشد.',
      line.trim(),
      m[1] + '\n' + m[2]
    ));
  });
}

/* R1b. Attribute list on its own line beneath a heading.
   Headings behave the exact opposite way to paragraphs: Python-Markdown only
   reads their attributes from the SAME line. A list underneath becomes a
   stray paragraph of literal text.

       broken:  # فصل یک
                {: #chapter-1 }
       works:   # فصل یک {#chapter-1}

   This is the rule that makes an automatic table of contents possible, so it
   is worth getting right. */
function ruleHeadingAttrOwnLine(lines, skip, out) {
  lines.forEach((line, i) => {
    if (skip.has(i)) return;
    if (!/^[ \t]*\{:?[ \t]*[.#][^}]*\}[ \t]*$/.test(line)) return;

    const previous = lines[i - 1];
    if (previous === undefined || !/^\s{0,3}#{1,6}\s/.test(previous)) return;

    const spec = line.trim().replace(/^\{:?[ \t]*/, '').replace(/[ \t]*\}$/, '');
    out.push(finding(
      'heading-attr-own-line', SEVERITY.ERROR, i,
      'ویژگی عنوان باید روی همان خط عنوان باشد، نه خط بعد. این‌طوری یک پاراگراف اضافه با متن خام ساخته می‌شود.',
      previous.trim() + '\n' + line.trim(),
      previous.trim() + ' {' + spec + '}'
    ));
  });
}

/* R2. Backslash at end of line as a hard line break.
   Pandoc and CommonMark support this. Python-Markdown does not - the
   backslash is printed literally, which is what happens to poems today.

   The site's .poem style already preserves newlines, so inside a poem the
   backslash should simply be deleted. Outside a poem, where the line break
   really is needed, two trailing spaces are the portable form. */
function ruleBackslashBreak(lines, skip, out) {
  lines.forEach((line, i) => {
    if (skip.has(i)) return;
    if (!/\S\\$/.test(line)) return;
    out.push(finding(
      'backslash-break', SEVERITY.ERROR, i,
      'شکست خط با بک‌اسلش کار نمی‌کند و خودِ بک‌اسلش چاپ می‌شود. داخل بلوک شعر فقط پاکش کن؛ جای دیگر دو فاصله در انتهای خط بگذار.',
      line.trim(),
      line.replace(/\\$/, '')
    ));
  });
}

/* R3. Pandoc bracketed span: [text]{.class}
   Not a feature of Python-Markdown at all. This is what the old studio
   emitted for "scene start", so every one of them is literal text on the
   live site. The supported equivalent attaches to a real inline element,
   for example *text*{: .scene-start } or **text**{: .scene-start }. */
function rulePandocSpan(lines, skip, out) {
  const re = /\[([^\]\n]*)\]\{[ \t]*[.#][^}\n]*\}/g;
  lines.forEach((line, i) => {
    if (skip.has(i)) return;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(line)) !== null) {
      out.push(finding(
        'pandoc-span', SEVERITY.ERROR, i,
        'نحو [متن]{.کلاس} مخصوص پندوک است و پایتون‌مارک‌دان آن را نمی‌شناسد؛ عیناً چاپ می‌شود.',
        m[0],
        null
      ));
    }
  });
}

/* R4. Footnote references with no matching definition, and the reverse.
   A reference without a definition renders as literal [^1] in the text. */
function ruleFootnotes(text, lines, skip, out) {
  const defs = new Map();
  const refs = new Map();

  lines.forEach((line, i) => {
    if (skip.has(i)) return;
    const def = line.match(/^\[\^([^\]]+)\]:/);
    if (def) { if (!defs.has(def[1])) defs.set(def[1], i); return; }

    const re = /\[\^([^\]\s]+)\]/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      if (!refs.has(m[1])) refs.set(m[1], i);
    }
  });

  for (const [id, line] of refs) {
    if (!defs.has(id)) {
      out.push(finding(
        'footnote-missing-def', SEVERITY.ERROR, line,
        `پانویس [^${id}] در متن هست ولی تعریفش نیست؛ در صفحه عیناً چاپ می‌شود.`,
        `[^${id}]`, null
      ));
    }
  }
  for (const [id, line] of defs) {
    if (!refs.has(id)) {
      out.push(finding(
        'footnote-orphan-def', SEVERITY.WARN, line,
        `تعریف پانویس [^${id}] هست ولی هیچ ارجاعی در متن ندارد.`,
        `[^${id}]:`, null
      ));
    }
  }
}

/* R5. Duplicate permanent paragraph IDs.
   Highlights and reading positions are anchored to these. A duplicate means
   two different paragraphs claim the same anchor. */
function ruleDuplicateIds(lines, skip, out) {
  const seen = new Map();
  lines.forEach((line, i) => {
    if (skip.has(i)) return;
    const re = /#(p-[A-Za-z0-9-]+)/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      if (seen.has(m[1])) {
        out.push(finding(
          'duplicate-id', SEVERITY.ERROR, i,
          `شناسه‌ی ${m[1]} تکراری است (اولین بار در خط ${seen.get(m[1]) + 1}).`,
          m[0], null
        ));
      } else {
        seen.set(m[1], i);
      }
    }
  });
}

/* R6. Sources heading wording.
   build.py wraps the sources block by searching an h2/h3/h4 whose text
   contains «سرچشمه». A heading that says «منابع» is never matched, so the
   sources-container styling is silently skipped. */
function ruleSourcesHeading(lines, skip, out) {
  lines.forEach((line, i) => {
    if (skip.has(i)) return;
    if (/^#{1,6}\s/.test(line) && /منابع/.test(line) && !/سرچشمه/.test(line)) {
      out.push(finding(
        'sources-heading', SEVERITY.WARN, i,
        'build.py دنبال «سرچشمه‌ها» می‌گردد، نه «منابع». با این عنوان، بلوک سرچشمه‌ها استایل نمی‌گیرد.',
        line.trim(),
        line.replace(/منابع/, 'سرچشمه‌ها')
      ));
    }
  });
}

/* --------------------------------------------------------------------------
   Public API
   -------------------------------------------------------------------------- */

/**
 * Lints a Markdown body.
 * @param {string} body  the body text, without frontmatter
 * @returns {Array} findings, sorted by line
 */
export function lintBody(body) {
  const lines = body.split('\n');
  const skip = fencedLines(lines);
  const out = [];

  ruleAttrSameLine(lines, skip, out);
  ruleHeadingAttrOwnLine(lines, skip, out);
  ruleBackslashBreak(lines, skip, out);
  rulePandocSpan(lines, skip, out);
  ruleFootnotes(body, lines, skip, out);
  ruleDuplicateIds(lines, skip, out);
  ruleSourcesHeading(lines, skip, out);

  return out.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}

/**
 * Lints the whole document, including checks that need frontmatter context.
 * @param {import('../model/document.js').AsbDocument} doc
 */
export function lintDocument(doc) {
  const out = lintBody(doc.body);
  const fm = doc.frontmatter;

  // Frontmatter typed into the text pane instead of the publish panel. The
  // saved file then carries two blocks and the copy renders as a rule with a
  // wall of text under it.
  if (/^---\n[\s\S]*?\n---(\n|$)/.test(doc.body) &&
      /^[A-Za-z_][A-Za-z0-9_-]*\s*:/m.test(doc.body.slice(4, doc.body.indexOf('\n---', 4)))) {
    out.unshift({
      rule: 'frontmatter-in-body', severity: SEVERITY.ERROR, line: 1,
      message: 'یک بلوک فرانت‌متر داخل خودِ متن است. شناسنامه جای پنل «آماده‌ی انتشار» است، نه ستون متن.',
      excerpt: doc.body.split('\n').slice(0, 3).join('\n'), fix: null, fixable: true,
    });
  }

  const isPremium = fm.get('premium') === true || fm.get('premium') === 'true';
  const isReader = fm.get('reader') === true || fm.get('reader') === 'true';

  if (isPremium && !doc.body.includes('<!-- PAYWALL -->')) {
    out.unshift({
      rule: 'premium-no-paywall', severity: SEVERITY.ERROR, line: 0,
      message: 'اثر پولی است ولی نشانگر <!-- PAYWALL --> ندارد. build.py کل متن را مسدود می‌کند و به‌جایش هشدار امنیتی چاپ می‌شود.',
      excerpt: 'premium: true', fix: null,
    });
  }

  if (isReader && !doc.body.includes('<!-- EREADER-START -->')) {
    out.unshift({
      rule: 'reader-no-marker', severity: SEVERITY.WARN, line: 0,
      message: 'حالت مطالعه فعال است ولی نشانگر <!-- EREADER-START --> نیست؛ صفحه‌ی لندینگ بدون مقدمه ساخته می‌شود.',
      excerpt: 'reader: true', fix: null,
    });
  }

  if (!fm.has('slug')) {
    out.unshift({
      rule: 'missing-slug', severity: SEVERITY.WARN, line: 0,
      message: 'فیلد slug در فرانت‌متر نیست؛ build.py از نام فایل استفاده می‌کند.',
      excerpt: '', fix: null,
    });
  }

  if (isPremium && !fm.has('price')) {
    out.unshift({
      rule: 'premium-no-price', severity: SEVERITY.WARN, line: 0,
      message: 'اثر پولی است ولی فیلد price ندارد؛ قیمت صفر به سوپابیس می‌رود.',
      excerpt: 'premium: true', fix: null,
    });
  }

  return out;
}
