/* ==========================================================================
   model/paragraph-ids.js
   --------------------------------------------------------------------------
   Assigns permanent #p-xxxxxxxx identifiers to paragraphs.

   This is a port of freeze_ids.py, and the reason it exists inside the studio
   is simple: an id that is assigned only when a separate script is remembered
   is an id that will eventually be forgotten. Readers' highlights and reading
   positions are anchored to these, so a missed run costs real data.

   TWO DIFFERENCES FROM THE PYTHON SCRIPT, both deliberate:

   1. The attribute list always goes on its OWN line. The Python version
      appends it to the end of the paragraph for non-quote blocks, and
      Python-Markdown does not read it there - it prints it as literal text.

   2. The skip list is narrower. The Python version skips any block starting
      with '*' or '-', which silently denies an id to every paragraph that
      opens with an italic word or a dash. Here only real list markers,
      headings, rules, HTML and footnote definitions are skipped.

   Ids are checked for uniqueness within the open document only. The studio
   cannot see the rest of the repository, so freeze_ids.py stays the authority
   for repository-wide uniqueness. With 8 hex characters a clash is unlikely,
   but "unlikely" is not "impossible" and it is worth knowing which is which.

   This module must never touch the DOM.
   ========================================================================== */

const ID_PATTERN = /#p-([a-f0-9]{8})/g;

/* Block openings that must never receive a paragraph id. */
const SKIP = [
  /^\s{0,3}#{1,6}\s/,          // heading
  /^\s{0,3}(\*{3,}|-{3,}|_{3,})\s*$/, // horizontal rule
  /^\s{0,3}([-*+])\s/,          // unordered list item
  /^\s{0,3}\d+[.)]\s/,          // ordered list item
  /^\s{0,3}\[\^[^\]]+\]:/,      // footnote definition
  /^\s{0,3}\*\[[^\]]+\]:/,      // abbreviation definition
  /^\s{0,3}\/\/\//,             // admonition / details fence
  /^\s{0,3}</,                  // raw HTML block or comment marker
  /^\s{0,3}\|/,                 // table row
  /^\s{0,3}(`{3,}|~{3,})/,      // fenced code
  /^\s{0,3}\{:?\s*[.#]/,        // a lone attribute list
];

/** Collects every permanent id already used in a body. */
export function collectIds(body) {
  const found = new Set();
  let match;
  ID_PATTERN.lastIndex = 0;
  while ((match = ID_PATTERN.exec(body)) !== null) found.add(match[1]);
  return found;
}

function makeId(used) {
  for (;;) {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    const id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    if (!used.has(id)) { used.add(id); return id; }
  }
}

/**
 * Adds a permanent id to every paragraph that lacks one.
 *
 * @param {string} body  markdown body, without frontmatter
 * @returns {{ body: string, added: number }}
 */
export function assignParagraphIds(body) {
  const blocks = body.split(/(\n{2,})/); // separators are kept, so spacing survives
  let added = 0;
  const used = collectIds(body);
  let insideFence = false;

  const out = blocks.map((block) => {
    // Separator chunks come back untouched.
    if (/^\n+$/.test(block) || block.trim() === '') return block;

    const lines = block.split('\n');

    // Track fenced code across blocks so a blank line inside a fence is safe.
    const fenceCount = lines.filter((l) => /^\s{0,3}(`{3,}|~{3,})/.test(l)).length;
    const wasInside = insideFence;
    if (fenceCount % 2 === 1) insideFence = !insideFence;
    if (wasInside || insideFence) return block;

    if (SKIP.some((re) => re.test(lines[0]))) return block;

    // A closing /// inside the block means the fence would no longer be last,
    // and a definition list rewrites its lines wholesale. Both stay untouched.
    if (lines.some((l) => /^\s{0,3}\/\/\/\s*$/.test(l))) return block;
    if (lines.some((l) => /^\s{0,3}:\s/.test(l))) return block;

    const lastIndex = lines.length - 1;
    const last = lines[lastIndex];
    const attrMatch = last.match(/^(\s*)\{:?\s*([^}]*)\}\s*$/);

    if (attrMatch) {
      // The block already ends with an attribute list on its own line.
      if (attrMatch[2].includes('#p-')) return block;
      const id = makeId(used);
      lines[lastIndex] = `${attrMatch[1]}{: ${attrMatch[2].trim()} #p-${id} }`;
      added++;
      return lines.join('\n');
    }

    // Anything already carrying an id somewhere is left alone.
    if (block.includes('#p-')) return block;

    const id = makeId(used);
    added++;
    return `${block.replace(/\s+$/, '')}\n{: #p-${id} }`;
  });

  return { body: out.join(''), added };
}

/**
 * Reports paragraphs that would receive an id, without changing anything.
 * Used to keep the toolbar button honest about whether it has work to do.
 */
export function countMissingIds(body) {
  return assignParagraphIds(body).added;
}
