/* ==========================================================================
   model/normalize.js
   --------------------------------------------------------------------------
   Brings a document's frontmatter into the shape RAHNAMANEVESHTAN.md defines.

   THREE RULES, all from the guide:

     1. THE ORDER IS THE GUIDE'S ORDER (بخش دو), summary last because it is
        the longest.
     2. NO EMPTY KEYS, EVER. build.py refuses a file whose frontmatter carries
        an empty key ("a frontmatter key was left empty") - so normalizing
        not only never creates one, it REMOVES empty ones an older save or a
        hand-edited file left behind. خانه‌ای که لازم نداری را کلاً پاک کن.
     3. DATES ARE QUOTED. A bare 1405-05-03 is a YAML timestamp to the Python
        side; the guide wants the string, in quotes. Existing bare dates are
        re-rendered, not just new ones - see Frontmatter.reformat().

   Only keys the studio KNOWS are removed or rewritten. Anything else -
   summary of a future build.py, a private note key, whatever - passes through
   untouched, after the canonical block. That part of the old contract stands.

   This module must never touch the DOM.
   ========================================================================== */

import {
  FIELD_ORDER,
  CREATOR_ORDER,
  KNOWN_FIELDS,
  newBookId,
  todayJalali,
} from './schema.js';
import { detectType } from './doctype.js';

/* Keys whose value is a date or a time, and therefore must be quoted. */
const DATEISH_KEYS = ['date', 'release_date', 'sale_until', 'release_time'];

/* The keys normalizing keeps alive with real values, because build.py reads
   them on every work and they always mean something. reader: false and
   premium: false are answers, not absences - they stay even though a string
   field with no value would go. */
const WORK_STRUCTURE = ['book_id', 'category', 'language', 'reader', 'premium', 'date'];

function isEmptyValue(entry) {
  if (!entry || entry.kind !== 'field') return false;
  if (entry.valueType === 'empty' || entry.valueType === 'null') return true;
  if (entry.value === null || entry.value === undefined) return true;
  if (typeof entry.value === 'string' && entry.value.trim() === '') return true;
  if (Array.isArray(entry.value) && entry.value.length === 0) return true;
  return false;
}

function entryOf(fm, key) {
  return fm.entries.find((e) => (e.kind === 'field' || e.kind === 'map') && e.key === key);
}

/**
 * @param {import('./document.js').AsbDocument} doc
 * @returns {{ added: string[], removed: string[], requoted: string[], reordered: boolean }}
 */
export function normalizeFrontmatter(doc) {
  const fm = doc.frontmatter;
  const creator = detectType(doc) === 'creator';

  const before = fm.keys().join(',');
  const added = [];
  const removed = [];
  const requoted = [];

  /* --- structural defaults: few, and each carries a real value ---------- */
  if (!creator) {
    if (!fm.has('book_id')) { fm.set('book_id', newBookId()); added.push('book_id'); }
    if (!fm.has('category')) { fm.set('category', 'short-story/single'); added.push('category'); }
    if (!fm.has('language')) { fm.set('language', 'fa'); added.push('language'); }
    if (!fm.has('reader')) { fm.set('reader', false); added.push('reader'); }
    if (!fm.has('premium')) { fm.set('premium', false); added.push('premium'); }
    if (!fm.has('date')) { fm.set('date', todayJalali()); added.push('date'); }
  } else if (String(fm.get('category') || '') !== 'creators') {
    // A creator profile keeps its explicit category so build.py takes the
    // profile branch whatever folder the file sits in.
    fm.set('category', 'creators');
    added.push('category');
  }

  /* --- empty known keys go; empty unknown keys are not ours to judge ----- */
  for (const key of [...fm.keys()]) {
    if (!KNOWN_FIELDS.includes(key)) continue;
    const entry = entryOf(fm, key);
    if (!isEmptyValue(entry)) continue;
    if (WORK_STRUCTURE.includes(key) && typeof entry.value === 'boolean') continue;
    fm.remove(key);
    removed.push(key);
  }

  /* --- quotes on every date the file already carries --------------------- */
  for (const key of DATEISH_KEYS) {
    if (fm.has(key) && fm.reformat(key)) requoted.push(key);
  }

  /* --- the guide's order -------------------------------------------------- */
  fm.reorder(creator ? [...CREATOR_ORDER] : FIELD_ORDER);

  return {
    added,
    removed,
    requoted,
    reordered: fm.keys().join(',') !== before,
  };
}

/** Reports what normalizing would change, without changing anything. */
export function previewNormalize(doc) {
  const fm = doc.frontmatter;
  const creator = detectType(doc) === 'creator';

  const order = creator ? CREATOR_ORDER : FIELD_ORDER;

  const added = [];
  if (!creator) {
    for (const key of WORK_STRUCTURE) {
      if (!fm.has(key)) added.push(key);
    }
  } else if (String(fm.get('category') || '') !== 'creators') {
    added.push('category');
  }

  const present = fm.keys().filter((k) => order.includes(k));
  const wanted = order.filter((k) => present.includes(k));
  const outOfOrder = present.join(',') !== wanted.join(',');

  const removed = fm.keys().filter((key) => {
    if (!KNOWN_FIELDS.includes(key)) return false;
    const entry = entryOf(fm, key);
    if (!isEmptyValue(entry)) return false;
    return !(WORK_STRUCTURE.includes(key) && typeof entry.value === 'boolean');
  });

  const requoted = DATEISH_KEYS.filter((key) => {
    const entry = fm.entries.find((e) => e.kind === 'field' && e.key === key);
    if (!entry) return false;
    const value = String(entry.raw).slice(String(entry.raw).indexOf(':') + 1).trim();
    return !/^"[^"]*"$/.test(value);
  });

  return { added, removed, requoted, outOfOrder };
}
