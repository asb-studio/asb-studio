/* ==========================================================================
   markdown/diff.js
   --------------------------------------------------------------------------
   What changed between two versions of a text.

   THIS IS WHAT MAKES TRACKING AUTOMATIC. The old approach asked the editor to
   reach for a button every time they changed a word - which is not editing,
   it is bookkeeping, and nobody keeps it up. Word does not work that way and
   neither should this: you turn recording on, you edit normally, and the tool
   works out afterwards what you did.

   So tracking on means one thing - remember the text as it stands. Everything
   after that is a comparison between that snapshot and the text now.

   The algorithm is a word-level longest common subsequence. Word level rather
   than character level because a diff that reports «می‌کرد» → «می‌کند» as
   "delete د, insert ن" is technically right and useless to read; a reader
   wants whole words.

   This module must never touch the DOM.
   ========================================================================== */

/* A token is a word or a run of whitespace. Keeping whitespace as tokens means
   the text can be rebuilt exactly, and a paragraph break shows up as a real
   change rather than being silently absorbed. */
const TOKEN = /(\s+)/;

/* Windows writes \r\n, the workspace stores \n, and a file that has been
   through both ends up differing on EVERY SINGLE LINE - which is how a few
   small edits were reported as 280 changes. The carriage returns mean nothing
   to the text, so they go before anything is compared. */
export function normalize(text) {
  return String(text || '').replace(/\r\n?/g, '\n');
}

export function tokenize(text) {
  return normalize(text).split(TOKEN).filter((t) => t !== '');
}

/* --------------------------------------------------------------------------
   Longest common subsequence

   The classic table is O(n·m) in memory, which on a novel is gigabytes. So the
   ends are trimmed first - edits are almost always local, and trimming the
   shared head and tail usually leaves a few dozen tokens to compare properly.
   -------------------------------------------------------------------------- */

function commonPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function commonSuffix(a, b, from) {
  let i = 0;
  while (i < a.length - from && i < b.length - from
         && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

/** LCS table for two short token runs. */
function lcsOps(a, b) {
  const n = a.length;
  const m = b.length;

  // A safety valve: past this the table is not worth building, and the whole
  // run is reported as one replacement. Better a coarse answer than a hung tab.
  if (n * m > 4_000_000) {
    const ops = [];
    if (n) ops.push({ type: 'del', tokens: a });
    if (m) ops.push({ type: 'ins', tokens: b });
    return ops;
  }

  const table = new Uint32Array((n + 1) * (m + 1));
  const at = (i, j) => i * (m + 1) + j;

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[at(i, j)] = a[i] === b[j]
        ? table[at(i + 1, j + 1)] + 1
        : Math.max(table[at(i + 1, j)], table[at(i, j + 1)]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;

  const push = (type, token) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.tokens.push(token);
    else ops.push({ type, tokens: [token] });
  };

  while (i < n && j < m) {
    if (a[i] === b[j]) { push('same', a[i]); i++; j++; }
    else if (table[at(i + 1, j)] >= table[at(i, j + 1)]) { push('del', a[i]); i++; }
    else { push('ins', b[j]); j++; }
  }
  while (i < n) { push('del', a[i]); i++; }
  while (j < m) { push('ins', b[j]); j++; }

  return ops;
}

/**
 * Compares two texts.
 *
 * Each op carries where it sits in BOTH texts, which is what makes accepting
 * and rejecting a single change possible: rejecting an insertion means cutting
 * it out of the new text, and rejecting a deletion means putting it back - and
 * neither can be done without knowing the offsets.
 *
 * @returns {Array<{type:'same'|'ins'|'del', text:string, aFrom:number, aTo:number, bFrom:number, bTo:number}>}
 *   a is the old text, b is the new one.
 */
export function diffWords(before, after) {
  const a = tokenize(before);
  const b = tokenize(after);

  const head = commonPrefix(a, b);
  const tail = commonSuffix(a, b, head);

  const middle = lcsOps(
    a.slice(head, a.length - tail),
    b.slice(head, b.length - tail)
  );

  const ops = [];
  const push = (type, text) => {
    if (text === '') return;
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.text += text;
    else ops.push({ type, text });
  };

  push('same', a.slice(0, head).join(''));
  for (const op of middle) push(op.type, op.tokens.join(''));
  push('same', a.slice(a.length - tail).join(''));

  // Offsets, walked once now that the ops are merged.
  let aAt = 0;
  let bAt = 0;

  for (const op of ops) {
    op.aFrom = aAt;
    op.bFrom = bAt;

    if (op.type !== 'ins') aAt += op.text.length;
    if (op.type !== 'del') bAt += op.text.length;

    op.aTo = aAt;
    op.bTo = bAt;
  }

  return ops;
}

/** Just the changes, numbered the way the review panel lists them. */
export function changeList(before, after) {
  return diffWords(before, after)
    .filter((op) => op.type !== 'same')
    .map((op, index) => ({ ...op, index }));
}

/* --------------------------------------------------------------------------
   Accepting and rejecting

   Both texts move, and which one moves is the whole difference:

     accept  the new text is right, so the OLD text is brought into line - the
             change stops being a change
     reject  the old text was right, so the NEW text is put back the way it was

   Returning both means the caller never has to work out which to write where.
   -------------------------------------------------------------------------- */

/**
 * @param {'accept'|'reject'} action
 * @returns {{ before: string, after: string }} the two texts afterwards
 */
export function resolveChange(before, after, index, action) {
  const changes = changeList(before, after);
  const op = changes[index];
  if (!op) return { before, after };

  if (action === 'accept') {
    // The old text catches up: an insertion is added to it, a deletion removed.
    const patched = op.type === 'ins'
      ? before.slice(0, op.aFrom) + op.text + before.slice(op.aFrom)
      : before.slice(0, op.aFrom) + before.slice(op.aTo);
    return { before: patched, after };
  }

  // Reject: the new text goes back to what it was.
  const patched = op.type === 'ins'
    ? after.slice(0, op.bFrom) + after.slice(op.bTo)
    : after.slice(0, op.bFrom) + op.text + after.slice(op.bFrom);
  return { before, after: patched };
}

/** How much changed, for a summary line. */
export function diffSummary(before, after) {
  let added = 0;
  let removed = 0;

  for (const op of diffWords(before, after)) {
    const words = op.text.trim() ? op.text.trim().split(/\s+/).length : 0;
    if (op.type === 'ins') added += words;
    if (op.type === 'del') removed += words;
  }

  return { added, removed, total: added + removed };
}

/**
 * Turns a diff into CriticMarkup, so the change set can live in the .md the
 * same way a hand-written mark does - and be accepted or rejected one at a
 * time in the review panel.
 */
export function diffToCritic(before, after) {
  let out = '';

  for (const op of diffWords(before, after)) {
    if (op.type === 'same') out += op.text;
    else if (op.type === 'ins') out += `{++${op.text}++}`;
    else out += `{--${op.text}--}`;
  }

  return out;
}
