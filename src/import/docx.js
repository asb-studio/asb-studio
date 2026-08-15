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
  'شروع داستان و جداساز': { block: 'p', attrs: '.no-indent', boldFirst: true },
  'ابتدای داستان': { block: 'p', attrs: '.no-indent', boldFirst: true },

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

/** The document body, which every pass needs. */
function body0(documentXml) {
  const body = documentXml.getElementsByTagNameNS(W, 'body')[0];
  if (!body) throw new Error('متن این فایل پیدا نشد.');
  return body;
}

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

    /* Bold and italic can live on the STYLE rather than on the text.
       Word offers three places to put them and uses whichever the author
       reached for: the run itself, a character style applied to the run, or
       the paragraph style. Reading only the first - which is what this did -
       loses every emphasis in a manuscript whose translator used styles, and
       loses it silently. */
    const runProps = style.getElementsByTagNameNS(W, 'rPr')[0];

    styles.set(id, {
      id,
      name: nameEl ? nameEl.getAttributeNS(W, 'val') : id,
      basedOn: baseEl ? baseEl.getAttributeNS(W, 'val') : null,
      outline: outlineEl ? Number(outlineEl.getAttributeNS(W, 'val')) : null,
      align: alignEl ? alignEl.getAttributeNS(W, 'val') : null,
      bold: hasFlag(runProps, 'b'),
      italic: hasFlag(runProps, 'i'),
    });
  }

  return styles;
}

/* Is a flag set on these run properties?

   Persian text carries its formatting on the "complex script" variants - bCs
   and iCs - as often as on the plain ones, because that is the field Word
   uses for right-to-left runs. Checking only b and i misses half of them. */
function hasFlag(props, which) {
  if (!props) return false;

  for (const tag of [which, which + 'Cs']) {
    const el = props.getElementsByTagNameNS(W, tag)[0];
    if (!el) continue;

    // <w:b w:val="0"/> is Word switching it OFF again.
    const val = el.getAttributeNS(W, 'val');
    if (val === '0' || val === 'false') continue;

    return true;
  }

  return false;
}

/** Follows basedOn upward to see whether a style ends up bold or italic. */
function styleFlag(styles, id, flag, depth = 0) {
  if (!id || depth > 8) return false;

  const style = styles.get(id);
  if (!style) return false;
  if (style[flag]) return true;

  return styleFlag(styles, style.basedOn, flag, depth + 1);
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
function footnoteTexts(footnotesXml, names, styles) {
  const notes = new Map();
  if (!footnotesXml) return notes;

  for (const note of Array.from(footnotesXml.getElementsByTagNameNS(W, 'footnote'))) {
    const id = note.getAttributeNS(W, 'id');
    if (Number(id) < 1) continue;   // -1 and 0 are Word's own separators

    /* The footnote's own runs go through the same pass as the body, so a book
       title in italics inside a note stays in italics. Passing null for the
       footnote order is what stops a note referring to itself. */
    const parts = [];
    for (const p of Array.from(note.getElementsByTagNameNS(W, 'p'))) {
      parts.push(runsToMarkdown(p, names, null, styles, null).trim());
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

function runsToMarkdown(paragraph, names, footnoteOrder, styles, paragraphStyleId) {
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
        const inner = runsToMarkdown(child, names, footnoteOrder, styles, paragraphStyleId).trim();
        if (inner) add(inner, false, false);
        continue;
      }

      if (tag !== 'r') { walk(child); continue; }

      /* --- a run --- */
      const props = child.getElementsByTagNameNS(W, 'rPr')[0];

      // A character style applied to this run, which may itself be bold.
      const rStyleEl = props && props.getElementsByTagNameNS(W, 'rStyle')[0];
      const rStyle = rStyleEl ? rStyleEl.getAttributeNS(W, 'val') : null;

      const bold = hasFlag(props, 'b')
        || (styles && styleFlag(styles, rStyle, 'bold'));
      const italic = hasFlag(props, 'i')
        || (styles && styleFlag(styles, rStyle, 'italic'));

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

  /* The paragraph's own style can be bold or italic too, and then every run
     inside it is - even the ones carrying no properties of their own. */
  if (styles && paragraphStyleId) {
    const pBold = styleFlag(styles, paragraphStyleId, 'bold');
    const pItalic = styleFlag(styles, paragraphStyleId, 'italic');

    if (pBold || pItalic) {
      for (const piece of pieces) {
        piece.bold = piece.bold || pBold;
        piece.italic = piece.italic || pItalic;
      }
    }
  }

  /* A stretch that is nothing but space belongs to whatever surrounds it, not
     to itself. Word emits «درد» and «ی » as two italic runs; if the trailing
     space keeps its own markers the result is *درد**ی* - two words where there
     was one. Merging a space-only stretch into its neighbour fixes it. */
  for (let i = pieces.length - 1; i > 0; i--) {
    if (pieces[i].text.trim() !== '') continue;
    if (pieces[i].bold !== pieces[i - 1].bold) continue;
    if (pieces[i].italic !== pieces[i - 1].italic) continue;

    pieces[i - 1].text += pieces[i].text;
    pieces.splice(i, 1);
  }

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
 * Reads the file and reports what is in it, WITHOUT converting.
 *
 * The point is to ask before acting: a manuscript's own styles carry meaning
 * no algorithm can be sure of, and one question answered once beats a hundred
 * paragraphs corrected afterwards.
 *
 * @returns {{ styles: Array, footnotes: number, paragraphs: number }}
 */
export async function analyseDocx(buffer) {
  const files = await unzip(buffer);
  const documentXml = parse(files.get('word/document.xml'));
  const stylesXml = files.has('word/styles.xml') ? parse(files.get('word/styles.xml')) : null;

  const styles = readStyles(stylesXml);
  const names = styleNames(styles);

  const body = documentXml.getElementsByTagNameNS(W, 'body')[0];
  if (!body) throw new Error('متن این فایل پیدا نشد.');

  const found = new Map();
  let paragraphs = 0;

  for (const p of Array.from(body.getElementsByTagNameNS(W, 'p'))) {
    paragraphs++;

    const styleEl = p.getElementsByTagNameNS(W, 'pStyle')[0];
    const styleId = styleEl ? styleEl.getAttributeNS(W, 'val') : null;
    const styleName = styleId ? (names.get(styleId) || styleId) : '(بدون استایل)';

    let text = '';
    for (const t of Array.from(p.getElementsByTagNameNS(W, 't'))) text += t.textContent;

    if (!found.has(styleName)) {
      const own = p.getElementsByTagNameNS(W, 'jc')[0];
      const align = own ? own.getAttributeNS(W, 'val')
        : (styles.get(styleId) ? styles.get(styleId).align : null);

      found.set(styleName, {
        name: styleName,
        id: styleId,
        count: 0,
        empty: 0,
        centred: align === 'center',
        heading: headingLevel(styles, styleId),
        known: Boolean(STYLE_MAP[styleName]),
        samples: [],
      });
    }

    const entry = found.get(styleName);
    entry.count++;
    if (!text.trim()) entry.empty++;
    else if (entry.samples.length < 2) entry.samples.push(text.trim().slice(0, 80));
  }

  const list = [...found.values()].map((entry) => ({
    ...entry,
    mostlyEmpty: entry.count > 0 && entry.empty / entry.count > 0.8,
    guess: entry.known ? null
      : entry.heading !== null
        ? (entry.heading <= 1 ? 'h1' : entry.heading === 2 ? 'h2' : 'h3')
        : guessRule(entry.name, entry.centred, entry.count > 0 && entry.empty / entry.count > 0.8),
  })).sort((a, b) => b.count - a.count);

  const footnotes = files.has('word/footnotes.xml')
    ? footnoteTexts(parse(files.get('word/footnotes.xml')), names, styles).size : 0;

  return { styles: list, footnotes, paragraphs };
}

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
  const notes = footnoteTexts(footnotesXml, names, styles);

  /* Footnotes are renumbered in the order they appear in the text. Word's own
     ids are not sequential once notes have been added and deleted, and a
     manuscript whose notes read 1, 4, 2 is a manuscript nobody trusts. */
  const footnoteOrder = new Map();

  const blocks = [];
  const unknownStyles = new Map();

  /* How often each style is used, so a rare empty paragraph can be told from
     an ordinary blank line. */
  const styleCounts = new Map();
  for (const p of Array.from(body0(documentXml).getElementsByTagNameNS(W, 'p'))) {
    const el = p.getElementsByTagNameNS(W, 'pStyle')[0];
    const id = el ? el.getAttributeNS(W, 'val') : null;
    const nm = id ? (names.get(id) || id) : '';
    styleCounts.set(nm, (styleCounts.get(nm) || 0) + 1);
  }

  const body = body0(documentXml);

  for (const p of Array.from(body.getElementsByTagNameNS(W, 'p'))) {
    const styleEl = p.getElementsByTagNameNS(W, 'pStyle')[0];
    const styleId = styleEl ? styleEl.getAttributeNS(W, 'val') : null;
    const styleName = styleId ? (names.get(styleId) || styleId) : '';

    let rule = ruleFor(styles, styleId, styleName, p, overrides, styleCounts);

    let text = runsToMarkdown(p, names, footnoteOrder, styles, styleId);
    text = clean(text);

    /* The paragraph's own content overrules a guess made from its style -
       a line of asterisks is a scene break whatever the style is called. */
    if (!overrides || !overrides[styleName]) {
      const own = p.getElementsByTagNameNS(W, 'jc')[0];
      const align = own ? own.getAttributeNS(W, 'val')
        : (styles.get(styleId) ? styles.get(styleId).align : null);

      const clue = contentClue(text, align === 'center', !text.trim(), styleCounts, styleName);
      if (clue) rule = clue;
    }

    if (styleName && !rule.recognised) {
      unknownStyles.set(styleName, (unknownStyles.get(styleName) || 0) + 1);
    }

    if (rule.block === 'hr') {
      // Never two rules in a row, however many blank paragraphs there were.
      if (blocks.length && blocks[blocks.length - 1].kind === 'hr') continue;
      blocks.push({ kind: 'hr' });
      continue;
    }

    if (rule.block === 'skip') continue;
    if (!text.trim()) continue;

    /* A paragraph bold from END TO END is a display line, not emphasis - its
       style already says so, and carrying the markers too would double up with
       the class. But bold on PART of a line is the author's own emphasis and
       must survive, which is what unwrapWhole is careful about. */
    text = unwrapWhole(text);

    if (rule.wrap) text = `${rule.wrap}${text.trim()}${rule.wrap}`;

    /* The opening paragraph of a story, with its first word set bold. Some
       translators do this with a character style Word records; some do it by
       hand; some rely on the paragraph style alone, in which case nothing in
       the file says so and only the author can. */
    if (rule.boldFirst) text = boldFirstWord(text);

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

/* --------------------------------------------------------------------------
   What the paragraph itself says

   A style called «جداساز» in one manuscript is «جداکننده» in the next and
   "Scene Break" in a third. No amount of cleverness will guess the word. But
   what the paragraph CONTAINS is the same in all three: a line holding
   nothing but asterisks, or holding nothing at all.

   That is a clue no naming convention can take away.
   -------------------------------------------------------------------------- */

/* A line that is only symbols - ***, * * *, — — —, ~~~ - is a scene break in
   every manuscript ever typed. */
const SEPARATOR_TEXT = /^[\s*\u2022\u2014\u2013~#.\-_=+]{1,20}$/;

function contentClue(text, isCentred, isEmpty, styleCounts, styleName) {
  const trimmed = text.trim();

  if (trimmed && SEPARATOR_TEXT.test(trimmed)) return { block: 'hr', recognised: true };

  /* An empty paragraph in a style of its own, used a handful of times, is a
     scene break made of white space - which is how a great many translators
     mark one. An empty paragraph in the BODY style is just a blank line. */
  if (isEmpty && styleName && styleCounts.get(styleName) <= 40
      && styleName !== '' && isCentred) {
    return { block: 'hr', recognised: true };
  }

  return null;
}

/**
 * What a paragraph should become. The clues, in descending order of how much
 * they actually tell you.
 */
function ruleFor(styles, styleId, styleName, paragraph, overrides, styleCounts) {
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
   What the studio can offer as a guess

   Shown beside each unrecognised style in the import dialog, so the author is
   choosing rather than starting from nothing.
   -------------------------------------------------------------------------- */

export const IMPORT_RULES = {
  p: { label: 'پاراگراف عادی', rule: { block: 'p' } },
  'p-noindent': { label: 'پاراگراف بدون تورفتگی', rule: { block: 'p', attrs: '.no-indent' } },
  'p-opening': {
    label: 'شروع داستان (بدون تورفتگی، کلمه‌ی اول ضخیم)',
    rule: { block: 'p', attrs: '.no-indent', boldFirst: true },
  },
  'p-center': { label: 'وسط‌چین', rule: { block: 'p', attrs: '.text-center' } },
  h1: { label: 'عنوان یک', rule: { block: 'h1' } },
  h2: { label: 'عنوان دو', rule: { block: 'h2' } },
  h3: { label: 'عنوان سه', rule: { block: 'h3' } },
  quote: { label: 'نقل‌قول', rule: { block: 'quote' } },
  hr: { label: 'جداکننده', rule: { block: 'hr' } },
  skip: { label: 'نادیده بگیر', rule: { block: 'skip' } },
};

/* A first guess for a style nobody has mapped yet. Word-shape first, then the
   handful of Persian words that recur across manuscripts - not as a rule, but
   as a starting point the author can overrule in one click. */
const NAME_HINTS = [
  [/جداساز|جداکننده|جدا‌کننده|separator|scene\s*break|ستاره/i, 'hr'],
  [/بدنه|متن\s*اصلی|body|normal/i, 'p'],
  [/ابتدا|شروع|آغاز|opening|first\s*para/i, 'p-opening'],
  [/عنوان|تیتر|title|heading/i, 'h2'],
  [/نقل|نقل‌قول|quote|blockquote/i, 'quote'],
  [/شناس|مشخصات|colophon|byline|نویسنده|مترجم/i, 'p-center'],
  [/وسط|center|centre/i, 'p-center'],
];

function guessRule(styleName, isCentred, mostlyEmpty) {
  if (mostlyEmpty) return 'hr';

  for (const [pattern, key] of NAME_HINTS) {
    if (pattern.test(styleName)) return key;
  }

  return isCentred ? 'p-center' : 'p';
}

/* --------------------------------------------------------------------------
   Cleaning

   Everything a Persian text picks up inside Word and should not carry out of
   it. Doing this on the way in means it never reaches the manuscript, rather
   than being hunted down later.
   -------------------------------------------------------------------------- */

/** Sets the first word in bold, unless it already carries emphasis. */
function boldFirstWord(text) {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('*')) return text;   // already emphasised

  const lead = text.slice(0, text.length - trimmed.length);
  const match = trimmed.match(/^(\S+)([\s\S]*)$/);
  if (!match) return text;

  return `${lead}**${match[1]}**${match[2]}`;
}

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
    /* HARAKAT, BUT NOT THE TANWIN. U+064B sits at the start of the harakat
       range, so stripping the range took «لطفاً» down to «لطفا» - and that is
       not a decoration coming off, it is a spelling being broken. The tanwin
       is part of how the word is written in Persian; fatha, kasra and damma
       are not. The range now starts one codepoint later. */
    .replace(/[\u064c-\u0652]/g, '')
    .replace(/\u064a/g, '\u06cc')   // Arabic ya  -> Persian
    .replace(/\u0649/g, '\u06cc')   // alef maqsura
    .replace(/\u0643/g, '\u06a9')   // Arabic kaf -> Persian
    .replace(/\u200f|\u200e/g, '')  // direction marks
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([.،؛:!؟])/g, '$1') // a space before punctuation
    .trim();
}
