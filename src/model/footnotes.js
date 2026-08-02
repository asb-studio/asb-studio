/* ==========================================================================
   model/footnotes.js
   --------------------------------------------------------------------------
   Reading, writing and checking footnotes.

   The old studio kept footnote text in a textarea with no connection to the
   references in the prose, and renumbered the references automatically. Delete
   one note and every note after it silently attached itself to the wrong
   number. Nothing warned anyone.

   So two rules hold here:

     1. References and definitions are always read together, from the one
        place they actually live - the Markdown itself.
     2. Renumbering NEVER happens on its own. It is a command the editor
        chooses to run, it rewrites references and definitions in the same
        pass, and it reports what it did.

   This module must never touch the DOM.
   ========================================================================== */

const DEF_LINE = /^\[\^([^\]]+)\]:[ \t]*(.*)$/;
const REF_ANY = /\[\^([^\]\s]+)\]/g;

/* --------------------------------------------------------------------------
   Reading
   -------------------------------------------------------------------------- */

/**
 * Reads every footnote reference and definition out of a body.
 *
 * A definition runs from its own line until the next blank line or the next
 * definition, so notes spanning several lines are kept whole.
 *
 * @param {string} body
 * @returns {{ notes: Array, issues: Array }}
 *   notes: [{ id, refLine, defLine, defEndLine, text, order }]
 */
export function readFootnotes(body) {
  const lines = body.split('\n');

  /* --- definitions --- */
  const defs = new Map();
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(DEF_LINE);
    if (!match) continue;

    const id = match[1];
    const parts = [match[2]];
    let end = i;

    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '' || DEF_LINE.test(lines[j])) break;
      parts.push(lines[j].trim());
      end = j;
    }

    if (!defs.has(id)) defs.set(id, { id, defLine: i, defEndLine: end, text: parts.join(' ').trim() });
  }

  /* --- references, in the order the reader meets them --- */
  const refs = new Map();
  let order = 0;
  lines.forEach((line, i) => {
    if (DEF_LINE.test(line)) return;
    REF_ANY.lastIndex = 0;
    let match;
    while ((match = REF_ANY.exec(line)) !== null) {
      if (refs.has(match[1])) continue;
      refs.set(match[1], { id: match[1], refLine: i, order: order++ });
    }
  });

  /* --- merge --- */
  const ids = new Set([...refs.keys(), ...defs.keys()]);
  const notes = [...ids].map((id) => ({
    id,
    order: refs.has(id) ? refs.get(id).order : Number.MAX_SAFE_INTEGER,
    refLine: refs.has(id) ? refs.get(id).refLine + 1 : null,
    defLine: defs.has(id) ? defs.get(id).defLine + 1 : null,
    defEndLine: defs.has(id) ? defs.get(id).defEndLine + 1 : null,
    text: defs.has(id) ? defs.get(id).text : '',
  })).sort((a, b) => a.order - b.order || String(a.id).localeCompare(String(b.id)));

  return { notes, issues: checkFootnotes(notes) };
}

/** Everything that can go wrong with a set of footnotes. */
export function checkFootnotes(notes) {
  const issues = [];

  for (const note of notes) {
    if (note.refLine === null) {
      issues.push({ id: note.id, kind: 'orphan',
        message: `پانویس ${note.id} تعریف دارد ولی هیچ ارجاعی در متن ندارد.` });
    } else if (note.defLine === null) {
      issues.push({ id: note.id, kind: 'undefined',
        message: `پانویس ${note.id} در متن هست ولی تعریفش نیست؛ در صفحه عیناً چاپ می‌شود.` });
    } else if (note.text === '') {
      issues.push({ id: note.id, kind: 'empty',
        message: `تعریف پانویس ${note.id} خالی است.` });
    }
  }

  // Numeric ids out of reading order, or with gaps, are legal Markdown but
  // almost always a mistake left behind by an edit.
  const numeric = notes.filter((n) => /^\d+$/.test(n.id) && n.refLine !== null);
  const sequence = numeric.map((n) => Number(n.id));
  const tidy = sequence.every((value, index) => value === index + 1);
  if (numeric.length > 1 && !tidy) {
    issues.push({ id: null, kind: 'order',
      message: 'شماره‌ی پانویس‌ها با ترتیب متن نمی‌خواند یا پرش دارد.' });
  }

  return issues;
}

/* --------------------------------------------------------------------------
   Writing
   -------------------------------------------------------------------------- */

/** Replaces the text of one definition, leaving everything else untouched. */
export function setFootnoteText(body, id, text) {
  const lines = body.split('\n');
  const { notes } = readFootnotes(body);
  const note = notes.find((n) => n.id === id);
  const clean = String(text).replace(/\s*\n\s*/g, ' ').trim();

  if (!note || note.defLine === null) {
    // No definition yet: append one at the end of the file.
    const tail = lines.join('\n').replace(/\s+$/, '');
    return `${tail}\n\n[^${id}]: ${clean}`;
  }

  lines.splice(note.defLine - 1, note.defEndLine - note.defLine + 1, `[^${id}]: ${clean}`);
  return lines.join('\n');
}

/** Removes a footnote entirely: its definition and every reference to it. */
export function removeFootnote(body, id) {
  const lines = body.split('\n');
  const { notes } = readFootnotes(body);
  const note = notes.find((n) => n.id === id);

  if (note && note.defLine !== null) {
    lines.splice(note.defLine - 1, note.defEndLine - note.defLine + 1);
  }

  const escaped = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return lines.join('\n').replace(new RegExp(`\\[\\^${escaped}\\]`, 'g'), '');
}

/**
 * Renumbers every numeric footnote to match the order it is met in the text.
 * References and definitions are rewritten in one pass, so they can never
 * drift apart. Non-numeric ids are left alone - a named note is named on
 * purpose.
 *
 * @returns {{ body: string, changed: number }}
 */
export function renumberFootnotes(body) {
  const { notes } = readFootnotes(body);
  const numbered = notes.filter((n) => /^\d+$/.test(n.id) && n.refLine !== null);
  if (numbered.length === 0) return { body, changed: 0 };

  const mapping = new Map();
  numbered.forEach((note, index) => mapping.set(note.id, String(index + 1)));

  let changed = 0;
  for (const [from, to] of mapping) if (from !== to) changed++;

  /* Renaming the ids is only half the job. The definitions themselves sit in
     whatever order they were written, so after renaming you get

         [^2]: تعریف یک.
         [^1]: تعریف سه.

     - correct, but unreadable, and it looks broken to anyone opening the file.
     They are sorted below, which is the part that was missing. */
  const needsSort = definitionsOutOfOrder(body, mapping);
  if (changed === 0 && !needsSort) return { body, changed: 0 };

  // Rewritten through placeholders so a note becoming "2" cannot collide with
  // the note that is still "2" at that moment.
  const placeholder = (id) => `\u0000FN${id}\u0000`;

  let out = body;
  for (const [from] of mapping) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out
      .replace(new RegExp(`\\[\\^${escaped}\\]:`, 'g'), `[^${placeholder(from)}]:`)
      .replace(new RegExp(`\\[\\^${escaped}\\]`, 'g'), `[^${placeholder(from)}]`);
  }
  for (const [from, to] of mapping) {
    out = out.split(placeholder(from)).join(to);
  }

  return { body: sortDefinitions(out), changed: Math.max(changed, needsSort ? 1 : 0) };
}

/** True when the definition lines are not in the order the ids will end up. */
function definitionsOutOfOrder(body, mapping) {
  const { notes } = readFootnotes(body);
  const defs = notes
    .filter((n) => n.defLine !== null && mapping.has(n.id))
    .sort((a, b) => a.defLine - b.defLine)
    .map((n) => Number(mapping.get(n.id)));

  return defs.some((value, index) => index > 0 && value < defs[index - 1]);
}

/**
 * Puts the definition block in numeric order, in place.
 *
 * Only the block itself moves: the lines around it, and any note whose id is
 * not a number, stay exactly where they are. A note spanning several lines
 * moves as one piece.
 */
export function sortDefinitions(body) {
  const { notes } = readFootnotes(body);
  const defined = notes.filter((n) => n.defLine !== null);
  if (defined.length < 2) return body;

  const lines = body.split('\n');

  // The block runs from the first definition line to the last, and is only
  // safe to reorder when nothing else is mixed in with it.
  const first = Math.min(...defined.map((n) => n.defLine)) - 1;
  const last = Math.max(...defined.map((n) => n.defEndLine)) - 1;

  const owned = new Set();
  for (const note of defined) {
    for (let i = note.defLine - 1; i <= note.defEndLine - 1; i++) owned.add(i);
  }
  for (let i = first; i <= last; i++) {
    if (!owned.has(i) && lines[i].trim() !== '') return body;   // prose in between
  }

  const blank = lines.slice(first, last + 1).some((line) => line.trim() === '');

  const blocks = defined
    .map((note) => ({
      id: note.id,
      numeric: /^\d+$/.test(note.id) ? Number(note.id) : Number.MAX_SAFE_INTEGER,
      text: lines.slice(note.defLine - 1, note.defEndLine).join('\n'),
    }))
    .sort((a, b) => a.numeric - b.numeric || String(a.id).localeCompare(String(b.id)));

  const rebuilt = blocks.map((b) => b.text).join(blank ? '\n\n' : '\n');
  lines.splice(first, last - first + 1, ...rebuilt.split('\n'));

  return lines.join('\n');
}

/** The next free numeric id. */
export function nextFootnoteId(body) {
  const used = [...body.matchAll(/\[\^(\d+)\]/g)].map((m) => parseInt(m[1], 10));
  return used.length ? Math.max(...used) + 1 : 1;
}
