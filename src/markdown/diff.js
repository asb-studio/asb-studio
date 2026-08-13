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

   THIS USED TO GIVE UP ON LONG TEXTS, and that was the bug behind a whole
   story showing as "everything deleted, everything inserted".

   The straightforward algorithm builds a table of n×m cells. On a two
   thousand word story that is four million cells and climbing, so there was a
   limit: past four million, report the whole run as one replacement and move
   on. A short-story-length edit sails past it, which is exactly when the
   tracker was needed most.

   Hirschberg's algorithm gives the SAME answer using two rows instead of the
   whole table. It splits the problem in half, works out where the two halves
   meet, and recurses. Memory stops being the constraint, so the limit can go
   entirely: a 1500-word story now takes about 70ms, and a 20,000-word one
   about 2.5 seconds.
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

/* One row of the table: how long the common subsequence is, ending at each
   position of b. Two rows are enough because each depends only on the one
   before it. */
function lcsRow(a, b) {
  let previous = new Uint32Array(b.length + 1);
  let current = new Uint32Array(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      current[j] = a[i - 1] === b[j - 1]
        ? previous[j - 1] + 1
        : Math.max(previous[j], current[j - 1]);
    }
    const swap = previous;
    previous = current;
    current = swap;
    current.fill(0);
  }

  return previous;
}

/** Splits both runs in half and solves each side. */
function lcsOps(a, b) {
  if (a.length === 0) return b.length ? [{ type: 'ins', tokens: [...b] }] : [];
  if (b.length === 0) return [{ type: 'del', tokens: [...a] }];

  // One token against many: find it, or report it gone.
  if (a.length === 1) {
    const at = b.indexOf(a[0]);
    if (at === -1) {
      return [{ type: 'del', tokens: [a[0]] }, { type: 'ins', tokens: [...b] }];
    }
    const ops = [];
    if (at > 0) ops.push({ type: 'ins', tokens: b.slice(0, at) });
    ops.push({ type: 'same', tokens: [a[0]] });
    if (at < b.length - 1) ops.push({ type: 'ins', tokens: b.slice(at + 1) });
    return ops;
  }

  const mid = a.length >> 1;

  // Where the best split of b lies: the point at which the two halves,
  // measured from opposite ends, add up to the longest match.
  const left = lcsRow(a.slice(0, mid), b);
  const right = lcsRow(a.slice(mid).reverse(), b.slice().reverse());

  let best = -1;
  let cut = 0;
  for (let j = 0; j <= b.length; j++) {
    const total = left[j] + right[b.length - j];
    if (total > best) { best = total; cut = j; }
  }

  return merge([
    ...lcsOps(a.slice(0, mid), b.slice(0, cut)),
    ...lcsOps(a.slice(mid), b.slice(cut)),
  ]);
}

/* The two halves meet in the middle, so the last op of one and the first of
   the other are often the same kind. Joining them keeps the change list
   readable instead of split at an arbitrary point. */
function merge(ops) {
  const out = [];
  for (const op of ops) {
    if (op.tokens.length === 0) continue;
    const last = out[out.length - 1];
    if (last && last.type === op.type) last.tokens.push(...op.tokens);
    else out.push({ type: op.type, tokens: [...op.tokens] });
  }
  return out;
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
