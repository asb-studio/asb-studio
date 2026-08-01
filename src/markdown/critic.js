/* ==========================================================================
   markdown/critic.js
   --------------------------------------------------------------------------
   Tracked changes, in plain text.

   This is CriticMarkup - an existing convention, not something invented here:

       {++ افزوده ++}          an insertion
       {-- حذف‌شده --}          a deletion
       {~~ غلط ~> درست ~~}     a substitution
       {>> یادداشت <<}          a comment for the author
       {== برجسته ==}          a highlight

   Why this and not a revisions table in a database: the marks live inside the
   .md file. Git diffs them, the file can be handed to a translator who opens
   it in this same studio, and nothing is lost if a server goes away. An
   editorial mark that only exists in one machine's storage is a mark that
   will eventually be lost.

   The marks must never reach the published site. Python-Markdown does not
   understand them and would print them raw, so validate.js blocks publishing
   while any remain - accept or reject them first.

   This module must never touch the DOM.
   ========================================================================== */

export const CRITIC = {
  insert: { open: '{++', close: '++}' },
  delete: { open: '{--', close: '--}' },
  comment: { open: '{>>', close: '<<}' },
  highlight: { open: '{==', close: '==}' },
};

/* Ordered so a substitution is recognised before a bare deletion, since both
   begin with the same two characters. */
const PATTERN = /\{~~([\s\S]*?)~>([\s\S]*?)~~\}|\{\+\+([\s\S]*?)\+\+\}|\{--([\s\S]*?)--\}|\{>>([\s\S]*?)<<\}|\{==([\s\S]*?)==\}/g;

const LABELS = {
  substitute: 'جایگزینی',
  insert: 'افزودن',
  delete: 'حذف',
  comment: 'یادداشت',
  highlight: 'برجسته',
};

/**
 * Lists every tracked change in a body, in document order.
 * @returns {Array<{type, label, from, to, line, raw, before, after}>}
 */
export function findChanges(body) {
  const found = [];
  PATTERN.lastIndex = 0;
  let match;

  while ((match = PATTERN.exec(body)) !== null) {
    const [raw, subFrom, subTo, added, removed, note, marked] = match;

    let type, before = '', after = '';
    if (subFrom !== undefined) { type = 'substitute'; before = subFrom; after = subTo; }
    else if (added !== undefined) { type = 'insert'; after = added; }
    else if (removed !== undefined) { type = 'delete'; before = removed; }
    else if (note !== undefined) { type = 'comment'; after = note; }
    else { type = 'highlight'; after = marked; }

    found.push({
      type,
      label: LABELS[type],
      from: match.index,
      to: match.index + raw.length,
      line: body.slice(0, match.index).split('\n').length,
      raw,
      before,
      after,
    });
  }

  return found;
}

export function hasChanges(body) {
  PATTERN.lastIndex = 0;
  return PATTERN.test(body);
}

export function countChanges(body) {
  return findChanges(body).length;
}

/* --------------------------------------------------------------------------
   Resolving
   -------------------------------------------------------------------------- */

/** What a mark becomes when the change is taken. */
function accepted(change) {
  switch (change.type) {
    case 'insert': return change.after;
    case 'delete': return '';
    case 'substitute': return change.after;
    case 'comment': return '';
    case 'highlight': return change.after;
    default: return change.raw;
  }
}

/** What a mark becomes when the change is turned down. */
function rejected(change) {
  switch (change.type) {
    case 'insert': return '';
    case 'delete': return change.before;
    case 'substitute': return change.before;
    case 'comment': return '';
    case 'highlight': return change.after;
    default: return change.raw;
  }
}

/**
 * Resolves one change by its position in findChanges() order.
 * @param {'accept'|'reject'} action
 */
export function resolveOne(body, index, action) {
  const changes = findChanges(body);
  const change = changes[index];
  if (!change) return body;

  const replacement = action === 'accept' ? accepted(change) : rejected(change);
  return body.slice(0, change.from) + replacement + body.slice(change.to);
}

/**
 * Resolves every change at once.
 * @param {'accept'|'reject'} action
 * @returns {{ body: string, count: number }}
 */
export function resolveAll(body, action) {
  const changes = findChanges(body);
  if (changes.length === 0) return { body, count: 0 };

  // Applied back to front so earlier offsets stay valid.
  let out = body;
  for (let i = changes.length - 1; i >= 0; i--) {
    const change = changes[i];
    const replacement = action === 'accept' ? accepted(change) : rejected(change);
    out = out.slice(0, change.from) + replacement + out.slice(change.to);
  }

  return { body: out, count: changes.length };
}

/* --------------------------------------------------------------------------
   Preview
   -------------------------------------------------------------------------- */

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Swaps the marks for HTML the preview can style, before Markdown runs.
 *
 * This is the one place the preview deliberately shows something the site
 * never will - and it is safe precisely because a document carrying marks is
 * blocked from publishing.
 */
export function markupForPreview(body) {
  PATTERN.lastIndex = 0;
  return body.replace(PATTERN, (raw, subFrom, subTo, added, removed, note, marked) => {
    if (subFrom !== undefined) {
      return `<del class="critic critic--del">${escapeHtml(subFrom)}</del>` +
             `<ins class="critic critic--ins">${escapeHtml(subTo)}</ins>`;
    }
    if (added !== undefined) return `<ins class="critic critic--ins">${escapeHtml(added)}</ins>`;
    if (removed !== undefined) return `<del class="critic critic--del">${escapeHtml(removed)}</del>`;
    if (note !== undefined) return `<span class="critic critic--note">${escapeHtml(note)}</span>`;
    return `<mark class="critic critic--mark">${escapeHtml(marked)}</mark>`;
  });
}
