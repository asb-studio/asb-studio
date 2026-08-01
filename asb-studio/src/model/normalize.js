/* ==========================================================================
   model/normalize.js
   --------------------------------------------------------------------------
   Brings a document's frontmatter into the canonical shape.

   Every saved file then looks the same: the same keys, in the same order,
   present whether or not they carry a value. A block that reshuffles itself
   makes every git diff unreadable, and a key that is sometimes there and
   sometimes not makes the file impossible to skim.

   TWO THINGS THIS DOES NOT DO:

     - it never removes a key the studio does not recognise. summary, price,
       roles, socials and anything a future build.py invents all come through
       untouched, sitting after the canonical block.
     - it never rewrites a line whose value has not changed, so quoting style
       stays exactly as it was found.

   Run on save. The first save of an older file therefore reorders its
   frontmatter - which is the point.

   This module must never touch the DOM.
   ========================================================================== */

import {
  FIELD_ORDER, FIELD_DEFAULTS,
  CREATOR_ORDER, CREATOR_DEFAULTS,
} from './schema.js';
import { detectType } from './doctype.js';

/**
 * @param {import('./document.js').AsbDocument} doc
 * @returns {{ added: string[], reordered: boolean }}
 */
export function normalizeFrontmatter(doc) {
  const type = detectType(doc);
  const order = type === 'creator' ? CREATOR_ORDER : FIELD_ORDER;
  const defaults = type === 'creator' ? CREATOR_DEFAULTS : FIELD_DEFAULTS;

  const fm = doc.frontmatter;
  const before = fm.keys().join(',');
  const added = [];

  for (const key of order) {
    if (fm.has(key)) continue;

    const make = defaults[key];
    if (!make) continue;             // socials has no default; absent is fine

    fm.set(key, make());
    added.push(key);
  }

  // A creator profile keeps its explicit category so build.py takes the
  // profile branch whatever folder the file sits in.
  const tail = type === 'creator' ? [...order, 'category'] : order;
  fm.reorder(tail);

  return { added, reordered: fm.keys().join(',') !== before };
}

/** Reports what normalizing would change, without changing anything. */
export function previewNormalize(doc) {
  const type = detectType(doc);
  const order = type === 'creator' ? CREATOR_ORDER : FIELD_ORDER;
  const defaults = type === 'creator' ? CREATOR_DEFAULTS : FIELD_DEFAULTS;

  const missing = order.filter((key) => defaults[key] && !doc.frontmatter.has(key));

  const present = doc.frontmatter.keys().filter((k) => order.includes(k));
  const wanted = order.filter((k) => present.includes(k));
  const outOfOrder = present.join(',') !== wanted.join(',');

  return { missing, outOfOrder };
}
