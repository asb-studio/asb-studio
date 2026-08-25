/* build.py finds this block by looking for a heading whose text contains
   «سرچشمه», wraps everything from there to the end in .sources-container, and
   sets the direction of each item by its own language. So the block is not
   free-form prose: its heading has to match, and it has to be a list.

   RAHNAMANEVESHTAN.md, بخش هشت: five headings are accepted - سرچشمه،
   سرچشمه‌ها، کتابنامه، کتاب‌نامه، منابع - and all of them wrap. The studio
   reads the same five so the panel never pretends a working block is absent.
   Getting that right by hand every time is exactly the kind of thing a tool
   should do, which is why the studio can now read and write it rather than
   leaving it to memory.

   This module must never touch the DOM.
   ========================================================================== */

const HEADING = /^(#{2,4})\s*(سرچشمه‌ها|سرچشمه|کتابنامه|کتاب‌نامه|منابع|منبع)\s*$/;
const ITEM = /^\s*(?:\d+[.)]|[-*+])\s+(.*)$/;

/** The heading the site actually looks for. */
export const SOURCES_HEADING = '### سرچشمه';

/**
 * Reads the sources block.
 * @returns {{ present: boolean, headingLine: number|null, level: string,
 *             title: string, items: string[], from: number, to: number }}
 */
export function readSources(body) {
  const lines = body.split('\n');

  let headingIndex = -1;
  let level = '###';
  let title = 'سرچشمه';

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(HEADING);
    if (!match) continue;
    headingIndex = i;
    level = match[1];
    title = match[2];
  }

  if (headingIndex === -1) {
    return { present: false, headingLine: null, level, title, items: [], from: -1, to: -1 };
  }

  const items = [];
  let end = headingIndex;

  for (let i = headingIndex + 1; i < lines.length; i++) {
    const line = lines[i];

    // Footnote definitions live below the sources and are not part of them.
    if (/^\[\^[^\]]+\]:/.test(line)) break;
    if (/^#{1,6}\s/.test(line)) break;

    const item = line.match(ITEM);
    if (item) { items.push(item[1].trim()); end = i; continue; }
    if (line.trim() === '') continue;

    break;   // prose after the list ends the block
  }

  return {
    present: true,
    headingLine: headingIndex + 1,
    level,
    title,
    items,
    from: headingIndex,
    to: end,
  };
}

/**
 * Writes the block back, creating it if it is not there.
 *
 * It is placed above the footnote definitions, because build.py moves the
 * footnote block to sit just before the sources heading - putting it after
 * would have the two swap places on the published page.
 *
 * @param {string[]} items  one entry per source; empty entries are dropped
 */
export function writeSources(body, items) {
  const clean = items.map((t) => String(t).trim()).filter(Boolean);
  const current = readSources(body);
  const lines = body.split('\n');

  if (clean.length === 0) {
    if (!current.present) return body;
    lines.splice(current.from, current.to - current.from + 1);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
  }

  const heading = current.present ? `${current.level} ${current.title}` : SOURCES_HEADING;
  const block = [heading, '', ...clean.map((text, i) => `${i + 1}. ${text}`)];

  if (current.present) {
    lines.splice(current.from, current.to - current.from + 1, ...block);
    return lines.join('\n');
  }

  // No block yet: insert above the first footnote definition, or append.
  const firstDef = lines.findIndex((line) => /^\[\^[^\]]+\]:/.test(line));
  if (firstDef === -1) {
    return `${body.replace(/\s+$/, '')}\n\n${block.join('\n')}\n`;
  }

  lines.splice(firstDef, 0, ...block, '');
  return lines.join('\n');
}
