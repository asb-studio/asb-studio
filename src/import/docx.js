/* ==========================================================================
   import/docx.js
   --------------------------------------------------------------------------
   Reading a Word manuscript into Markdown.

   A .docx is a zip of XML files. Everything needed is in three of them:

     word/document.xml    the text, its paragraphs and their styles
     word/footnotes.xml   the notes, stored properly rather than as text
     word/styles.xml      what each style id is actually called

   WHY NOT A LIBRARY. Mammoth and its kin map Word to HTML, which would then
   have to be mapped back to Markdown - two lossy steps where one will do. And
   none of them know what «بدنه» or «جداکننده» mean, which is the part that
   actually matters here: a manuscript's styles are named by the person who
   made them, and those names carry the structure.

   STYLE NAMES, NOT LOOKS. Word records that a paragraph is «زیرعنوان»; it also
   records that it is 16pt bold centred. Reading the name gives structure;
   reading the appearance gives guesswork. So the names are read, and the
   mapping below is by name.

   This module must never touch the DOM beyond DOMParser.
   ========================================================================== */

/* --------------------------------------------------------------------------
   Style names → Markdown

   Taken from a real manuscript. Anything not listed becomes an ordinary
   paragraph, which is the right default: an unknown style is a look, not a
   structure, and Markdown has no room for looks.
   -------------------------------------------------------------------------- */
const STYLE_MAP = {
  // headings, by what they mean rather than how big they are
  'زیرعنوان': { block: 'h1' },
  'درشت (شروع داستان)': { block: 'h2' },
  'درشت، وسط، آخرین داستان': { block: 'h2' },
  'اسم نویسنده': { block: 'p', attrs: '.text-center' },
  'اسم مترجم و نویسنده صفحه‌ی اول': { block: 'p', attrs: '.text-center' },
  'زیرنوشت عنوان اصلی داستان': { block: 'p', attrs: '.text-center' },

  // centred display lines
  'درشت وسط صفحه': { block: 'p', attrs: '.text-center', wrap: '**' },
  'درشت وسط صفحه (فونت رؤیا)': { block: 'p', attrs: '.text-center', wrap: '**' },
  'کج وسط صفحه': { block: 'p', attrs: '.text-center', wrap: '*' },
  'ساده وسط صفحه (فونت رؤیا)': { block: 'p', attrs: '.text-center' },
  'تقدیم': { block: 'p', attrs: '.text-center' },

  // a scene break is a rule, and the paragraph after it does not indent
  'جداکننده': { block: 'hr' },
  'متن بعد از جداکننده': { block: 'p', attrs: '.no-indent' },
  'شروع داستان و جداساز': { block: 'p', attrs: '.no-indent' },

  // quoted or set-apart matter
  'کج': { block: 'quote' },
  'متن معرفی‌نامه': { block: 'quote' },

  // plain body text
  'بدنه': { block: 'p' },
  'متفرقه': { block: 'p' },
  'فهرست': { block: 'h2' },
};

/* --------------------------------------------------------------------------
   Reading the zip

   Only the three files that matter are unpacked, and only the stored or
   deflated entries a .docx actually uses.
   -------------------------------------------------------------------------- */

async function unzip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // The end-of-central-directory record is at the tail, after any comment.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('این فایل ورد سالم نیست.');

  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);

  const files = new Map();
  const decoder = new TextDecoder();

  for (let i = 0; i < count; i++) {
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));

    if (/^word\/(document|footnotes|styles)\.xml$/.test(name)) {
      const method = view.getUint16(localAt + 8, true);
      const compressed = view.getUint32(localAt + 18, true);
      const localName = view.getUint16(localAt + 26, true);
      const localExtra = view.getUint16(localAt + 28, true);
      const start = localAt + 30 + localName + localExtra;
      const raw = bytes.subarray(start, start + compressed);

      files.set(name, method === 0 ? raw : await inflate(raw));
    }

    at += 46 + nameLength + extraLength + commentLength;
  }

  return files;
}

/* The browser's own decompressor. Every .docx Word writes uses deflate. */
async function inflate(bytes) {
  const stream = new Blob([bytes]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* --------------------------------------------------------------------------
   Reading the XML
   -------------------------------------------------------------------------- */

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function parse(bytes) {
  const text = new TextDecoder().decode(bytes);
  const doc = new DOMParser().parseFromString(text, 'application/xml');

  // getElementsByTagName rather than querySelector: the check has to work on
  // any DOM implementation, and a parser error element is all we are after.
  const failed = doc.getElementsByTagName('parsererror');
  if (failed && failed.length) throw new Error('XML این فایل خوانده نشد.');

  return doc;
}

/* --------------------------------------------------------------------------
   Reading a style

   A NAMED STYLE IS NOT THE ONLY CLUE, and relying on the name alone would
   only ever work for one manuscript. Word records four things, and they are
   tried in this order:

     1. the name the author gave it        «زیرعنوان»
     2. the built-in style it is based on  basedOn="Heading1"
     3. the outline level                  outlineLvl="0"
     4. how it is aligned                  jc="center"

   The second is what makes this general. A translator who builds «زیرعنوان»
   by modifying Heading 1 leaves that link behind, so the file still says
   "this is a first-level heading" even though nothing in it is in English.
   The chain is followed upward, because a style based on a style based on
   Heading 2 is still a second-level heading.
   -------------------------------------------------------------------------- */

function readStyles(stylesXml) {
  const styles = new Map();
  if (!stylesXml) return styles;

  for (const style of Array.from(stylesXml.getElementsByTagNameNS(W, 'style'))) {
    const id = style.getAttributeNS(W, 'styleId');
    if (!id) continue;

    const nameEl = style.getElementsByTagNameNS(W, 'name')[0];
    const baseEl = style.getElementsByTagNameNS(W, 'basedOn')[0];
    const outlineEl = style.getElementsByTagNameNS(W, 'outlineLvl')[0];
    const alignEl = style.getElementsByTagNameNS(W, 'jc')[0];

    styles.set(id, {
      id,
      name: nameEl ? nameEl.getAttributeNS(W, 'val') : id,
      basedOn: baseEl ? baseEl.getAttributeNS(W, 'val') : null,
      outline: outlineEl ? Number(outlineEl.getAttributeNS(W, 'val')) : null,
      align: alignEl ? alignEl.getAttributeNS(W, 'val') : null,
    });
  }

  return styles;
}

/* Word's own heading styles, under every id and name they ship with. */
const BUILT_IN_HEADING = /^(Heading|heading\s*|عنوان\s*|سرصفحه\s*)([1-6])$/i;

/** The heading level of a style, following basedOn upward. Null if not one. */
function headingLevel(styles, id, depth = 0) {
  if (!id || depth > 8) return null;

  const style = styles.get(id);
  if (!style) {
    const direct = BUILT_IN_HEADING.exec(id);
    return direct ? Number(direct[2]) : null;
  }

  const byId = BUILT_IN_HEADING.exec(style.id);
  if (byId) return Number(byId[2]);

  const byName = BUILT_IN_HEADING.exec(style.name);
  if (byName) return Number(byName[2]);

  // outlineLvl counts from zero.
  if (style.outline !== null && style.outline >= 0 && style.outline <= 5) {
    return style.outline + 1;
  }

  return headingLevel(styles, style.basedOn, depth + 1);
}

/** Kept for the footnote pass, which only ever needs the names. */
function styleNames(styles) {
  const names = new Map();
  for (const [id, style] of styles) names.set(id, style.name);
  return names;
}

/** footnote id -> its text, already converted to Markdown. */
function footnoteTexts(footnotesXml, names) {
  const notes = new Map();
  if (!footnotesXml) return notes;

  for (const note of Array.from(footnotesXml.getElementsByTagNameNS(W, 'footnote'))) {
    const id = note.getAttributeNS(W, 'id');
    if (Number(id) < 1) continue;   // -1 and 0 are Word's own separators

    const parts = [];
    for (const p of Array.from(note.getElementsByTagNameNS(W, 'p'))) {
      parts.push(runsToMarkdown(p, names, null).trim());
    }

    // Word puts a space and often a full stop before the note's own text.
    notes.set(id, parts.join(' ').replace(/^[\s.،]+/, '').trim());
  }

  return notes;
}

/* --------------------------------------------------------------------------
   Runs → Markdown

   A run is a stretch of text with one set of properties. Bold and italic are
   carried; colour, font and size are not, because Markdown has no way to say
   them and the site's stylesheet decides them anyway.
   -------------------------------------------------------------------------- */

function runsToMarkdown(paragraph, names, footnoteOrder) {
  /* Collected first, marked afterwards.

     WORD SPLITS A WORD ACROSS RUNS for reasons of its own - a spell-check
     boundary, a revision id, a font hint - and every piece carries the same
     bold flag. Marking each piece as it arrives turns «رؤیاهایش» into
     ***رؤیا******هایش***, which is six asterisks Markdown reads as nothing at
     all. So adjacent runs with identical formatting are joined first, and the
     markers go on once, around the whole stretch. */
  const pieces = [];

  const add = (text, bold, italic) => {
    if (!text) return;
    const last = pieces[pieces.length - 1];
    if (last && last.bold === bold && last.italic === italic) last.text += text;
    else pieces.push({ text, bold, italic });
  };

  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType !== 1) continue;
      const tag = child.localName;

      if (tag === 'hyperlink') {
        // The target lives in the relationships file; without it the text is
        // still correct, and a bare link is better than a broken one.
        const inner = runsToMarkdown(child, names, footnoteOrder).trim();
        if (inner) add(inner, false, false);
        continue;
      }

      if (tag !== 'r') { walk(child); continue; }

      /* --- a run --- */
      const props = child.getElementsByTagNameNS(W, 'rPr')[0];
      const bold = props && props.getElementsByTagNameNS(W, 'b').length > 0;
      const italic = props && props.getElementsByTagNameNS(W, 'i').length > 0;

      // A footnote reference has no text of its own.
      const ref = child.getElementsByTagNameNS(W, 'footnoteReference')[0];
      if (ref && footnoteOrder) {
        const id = ref.getAttributeNS(W, 'id');
        if (!footnoteOrder.has(id)) footnoteOrder.set(id, footnoteOrder.size + 1);
        add(`[^${footnoteOrder.get(id)}]`, false, false);
        continue;
      }

      let text = '';
      for (const t of Array.from(child.getElementsByTagNameNS(W, 't'))) text += t.textContent;
      for (const _ of Array.from(child.getElementsByTagNameNS(W, 'tab'))) text += ' ';
      for (const _ of Array.from(child.getElementsByTagNameNS(W, 'br'))) text += '\n';

      add(text, Boolean(bold), Boolean(italic));
    }
  };

  walk(paragraph);

  /* Now the markers, once per stretch. They go OUTSIDE the spaces: `**word **`
     is not bold in Markdown, because the closing marker has to touch a
     non-space character. */
  let out = '';

  for (const piece of pieces) {
    if (!piece.bold && !piece.italic) { out += piece.text; continue; }

    const head = piece.text.match(/^\s*/)[0];
    const tail = piece.text.match(/\s*$/)[0];
    const core = piece.text.slice(head.length, piece.text.length - tail.length);

    if (!core) { out += piece.text; continue; }

    const mark = piece.bold && piece.italic ? '***' : piece.bold ? '**' : '*';
    out += `${head}${mark}${core}${mark}${tail}`;
  }

  return out;
}

/* --------------------------------------------------------------------------
   The whole document
   -------------------------------------------------------------------------- */

/**
 * @param {ArrayBuffer} buffer  the .docx file
 * @param {object|null} overrides  style name -> rule, chosen by the author
 * @returns {{ markdown: string, report: object }}
 */
export async function importDocx(buffer, overrides = null) {
  const files = await unzip(buffer);

  const documentXml = parse(files.get('word/document.xml'));
  const stylesXml = files.has('word/styles.xml') ? parse(files.get('word/styles.xml')) : null;
  const footnotesXml = files.has('word/footnotes.xml')
    ? parse(files.get('word/footnotes.xml')) : null;

  const styles = readStyles(stylesXml);
  const names = styleNames(styles);
  const notes = footnoteTexts(footnotesXml, names);

  /* Footnotes are renumbered in the order they appear in the text. Word's own
     ids are not sequential once notes have been added and deleted, and a
     manuscript whose notes read 1, 4, 2 is a manuscript nobody trusts. */
  const footnoteOrder = new Map();

  const blocks = [];
  const unknownStyles = new Map();

  const body = documentXml.getElementsByTagNameNS(W, 'body')[0];
  if (!body) throw new Error('متن این فایل پیدا نشد.');

  for (const p of Array.from(body.getElementsByTagNameNS(W, 'p'))) {
    const styleEl = p.getElementsByTagNameNS(W, 'pStyle')[0];
    const styleId = styleEl ? styleEl.getAttributeNS(W, 'val') : null;
    const styleName = styleId ? (names.get(styleId) || styleId) : '';

    const rule = ruleFor(styles, styleId, styleName, p, overrides);
    if (styleName && !STYLE_MAP[styleName] && !rule.recognised) {
      unknownStyles.set(styleName, (unknownStyles.get(styleName) || 0) + 1);
    }

    if (rule.block === 'hr') { blocks.push({ kind: 'hr' }); continue; }

    let text = runsToMarkdown(p, names, footnoteOrder);
    text = clean(text);
    if (!text.trim()) continue;

    /* A paragraph that is bold from end to end is not emphasis - it is a
       display line, and its style has already said so. Carrying the markers
       too would double up with the class. */
    text = unwrapWhole(text);

    if (rule.wrap) text = `${rule.wrap}${text.trim()}${rule.wrap}`;

    blocks.push({ kind: rule.block, text, attrs: rule.attrs || null });
  }

  /* --- assemble --- */
  const lines = [];

  for (const block of blocks) {
    if (block.kind === 'hr') { lines.push('***', ''); continue; }

    if (block.kind === 'h1') { lines.push(`# ${block.text.trim()}`, ''); continue; }
    if (block.kind === 'h2') { lines.push(`## ${block.text.trim()}`, ''); continue; }

    if (block.kind === 'quote') {
      lines.push(...block.text.trim().split('\n').map((l) => `> ${l}`), '');
      continue;
    }

    lines.push(block.text.trim());
    if (block.attrs) lines.push(`{: ${block.attrs} }`);
    lines.push('');
  }

  /* Footnote definitions, in the order the references appeared. */
  const ordered = [...footnoteOrder.entries()].sort((a, b) => a[1] - b[1]);
  if (ordered.length) {
    lines.push('');
    for (const [id, number] of ordered) {
      lines.push(`[^${number}]: ${clean(notes.get(id) || '')}`);
    }
  }

  return {
    markdown: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n',
    report: {
      paragraphs: blocks.filter((b) => b.kind !== 'hr').length,
      headings: blocks.filter((b) => b.kind === 'h1' || b.kind === 'h2').length,
      quotes: blocks.filter((b) => b.kind === 'quote').length,
      breaks: blocks.filter((b) => b.kind === 'hr').length,
      footnotes: ordered.length,
      unknownStyles: [...unknownStyles.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count })),
    },
  };
}

/**
 * What a paragraph should become. Four clues, in descending order of how much
 * they actually tell you.
 */
function ruleFor(styles, styleId, styleName, paragraph, overrides) {
  // 0. Whatever the author said in the import dialog wins outright.
  if (overrides && overrides[styleName]) {
    return { ...overrides[styleName], recognised: true };
  }

  // 1. A style name this studio knows.
  if (STYLE_MAP[styleName]) return { ...STYLE_MAP[styleName], recognised: true };

  // 2. A heading, however it was named or however deep the basedOn chain.
  const level = headingLevel(styles, styleId);
  if (level !== null) {
    return { block: level <= 1 ? 'h1' : level === 2 ? 'h2' : 'h3', recognised: true };
  }

  /* 3. Alignment, from the style or from the paragraph itself. This is
        appearance rather than structure, and it is the last resort for
        exactly that reason - but a centred line in an unknown style is far
        more likely to be a display line than an accident. */
  const own = paragraph.getElementsByTagNameNS(W, 'jc')[0];
  const align = own ? own.getAttributeNS(W, 'val')
    : (styles.get(styleId) ? styles.get(styleId).align : null);

  if (align === 'center') return { block: 'p', attrs: '.text-center', recognised: false };

  return { block: 'p', recognised: false };
}

/* --------------------------------------------------------------------------
   Cleaning

   Everything a Persian text picks up inside Word and should not carry out of
   it. Doing this on the way in means it never reaches the manuscript, rather
   than being hunted down later.
   -------------------------------------------------------------------------- */

/* Strips markers that wrap the entire paragraph. */
function unwrapWhole(text) {
  const trimmed = text.trim();

  for (const mark of ['***', '**', '*']) {
    if (trimmed.length <= mark.length * 2) continue;
    if (!trimmed.startsWith(mark) || !trimmed.endsWith(mark)) continue;

    const inner = trimmed.slice(mark.length, -mark.length);
    // Only when the markers really do span the whole line.
    if (!inner.includes(mark)) return inner;
  }

  return text;
}

function clean(text) {
  return String(text)
    .replace(/\u00a0/g, ' ')        // Word's non-breaking space
    .replace(/\u0640+/g, '')        // kashida, a typesetting artefact
    .replace(/[\u064b-\u0652]/g, '') // harakat
    .replace(/\u064a/g, '\u06cc')   // Arabic ya  -> Persian
    .replace(/\u0649/g, '\u06cc')   // alef maqsura
    .replace(/\u0643/g, '\u06a9')   // Arabic kaf -> Persian
    .replace(/\u200f|\u200e/g, '')  // direction marks
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([.،؛:!؟])/g, '$1') // a space before punctuation
    .trim();
}
